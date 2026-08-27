import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GDriveAuth, type OAuthDeps } from '../../src/main/auth/gdrive-oauth'

const CLIENT_ID = 'test-client.apps.googleusercontent.com'

interface Harness {
  auth: GDriveAuth
  stored: { token: string | null; email: string | null }
  authUrl(): URL
  tokenCalls: Array<Record<string, string>>
}

/**
 * Drives the real loopback flow: openExternal receives the consent URL, and the
 * harness plays the browser by calling the redirect URI back.
 */
function harness(options: {
  autoRedirect?: (url: URL) => Promise<void>
  tokenResponse?: (form: Record<string, string>) => Response
  credentials?: { clientId: string; clientSecret: string }
  roster?: string[]
} = {}): Harness {
  const stored = { token: null as string | null, email: null as string | null }
  const tokenCalls: Array<Record<string, string>> = []
  let seen: URL | null = null

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.href.startsWith('https://oauth2.googleapis.com/token')) {
      const form = Object.fromEntries(new URLSearchParams(String(init?.body)))
      tokenCalls.push(form)
      return (
        options.tokenResponse?.(form) ??
        new Response(
          JSON.stringify({ access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-1' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    }
    if (url.href.includes('drive/v3/about')) {
      return new Response(JSON.stringify({ user: { emailAddress: 'me@example.com' } }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }
    if (url.href.startsWith('https://oauth2.googleapis.com/revoke')) {
      return new Response('', { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url.href}`)
  }) as typeof fetch

  const deps: OAuthDeps = {
    openExternal: async (url) => {
      seen = new URL(url)
      if (options.autoRedirect) await options.autoRedirect(seen)
    },
    // Reversible stand-in for safeStorage so the assertions can see the payload.
    encrypt: (plain) => `enc(${plain})`,
    decrypt: (cipher) => {
      const m = /^enc\((.*)\)$/.exec(cipher)
      if (!m) throw new Error('cannot decrypt')
      return m[1]
    },
    getCredentials: () => options.credentials ?? { clientId: CLIENT_ID, clientSecret: 'shh' },
    isOnRoster: (email) =>
      !options.roster || options.roster.length === 0
        ? true
        : options.roster.some((e) => e.toLowerCase() === (email ?? '').toLowerCase()),
    loadToken: () => ({ ...stored }),
    saveToken: (token, email) => {
      stored.token = token
      stored.email = email
    },
    fetchImpl
  }

  return {
    auth: new GDriveAuth(deps),
    stored,
    tokenCalls,
    authUrl: () => {
      if (!seen) throw new Error('openExternal was never called')
      return seen
    }
  }
}

/** Play the browser: hit the loopback redirect the way Google would. */
async function redirect(url: URL, overrides: Record<string, string> = {}): Promise<void> {
  const redirectUri = new URL(url.searchParams.get('redirect_uri')!)
  redirectUri.searchParams.set('code', 'auth-code-1')
  redirectUri.searchParams.set('state', url.searchParams.get('state')!)
  for (const [k, v] of Object.entries(overrides)) redirectUri.searchParams.set(k, v)
  const res = await fetch(redirectUri)
  expect(res.status).toBe(200)
  await res.text()
}

describe('status', () => {
  it('reports unconfigured with no client id', () => {
    const h = harness({ credentials: { clientId: '  ', clientSecret: '' } })
    expect(h.auth.status()).toEqual({ configured: false, signedIn: false, email: undefined })
  })

  it('reports configured but signed out before any login', () => {
    expect(harness().auth.status()).toMatchObject({ configured: true, signedIn: false })
  })
})

describe('signIn', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses without a client id', async () => {
    const h = harness({ credentials: { clientId: '', clientSecret: '' } })
    await expect(h.auth.signIn()).rejects.toThrow(/client ID/)
  })

  it('sends a correct PKCE S256 challenge and read-only scope', async () => {
    const h = harness({ autoRedirect: (url) => redirect(url) })
    await h.auth.signIn()

    const url = h.authUrl()
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const verifier = h.tokenCalls[0].code_verifier
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(url.searchParams.get('code_challenge')).toBe(expected)
  })

  it('exchanges the code and stores the refresh token encrypted', async () => {
    const h = harness({ autoRedirect: (url) => redirect(url) })
    const status = await h.auth.signIn()

    expect(h.tokenCalls[0]).toMatchObject({
      grant_type: 'authorization_code',
      code: 'auth-code-1',
      client_id: CLIENT_ID,
      client_secret: 'shh'
    })
    expect(h.stored.token).toBe('enc(rt-1)')
    expect(h.stored.token).not.toContain('rt-1"')
    expect(status).toEqual({ configured: true, signedIn: true, email: 'me@example.com' })
  })

  it('rejects a mismatched state', async () => {
    const h = harness({ autoRedirect: (url) => redirect(url, { state: 'tampered' }) })
    await expect(h.auth.signIn()).rejects.toThrow(/state mismatch/)
    expect(h.stored.token).toBeNull()
  })

  it('surfaces a user-cancelled consent screen', async () => {
    const h = harness({
      autoRedirect: async (url) => {
        const redirectUri = new URL(url.searchParams.get('redirect_uri')!)
        redirectUri.searchParams.set('error', 'access_denied')
        await (await fetch(redirectUri)).text()
      }
    })
    await expect(h.auth.signIn()).rejects.toThrow(/access_denied/)
  })

  it('complains when Google withholds a refresh token', async () => {
    const h = harness({
      autoRedirect: (url) => redirect(url),
      tokenResponse: () =>
        new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), {
          headers: { 'Content-Type': 'application/json' }
        })
    })
    await expect(h.auth.signIn()).rejects.toThrow(/no refresh token/)
  })

  it('accepts an account that is on the roster', async () => {
    const h = harness({ autoRedirect: (url) => redirect(url), roster: ['ME@example.com'] })
    await expect(h.auth.signIn()).resolves.toMatchObject({ signedIn: true })
    expect(h.stored.token).toBe('enc(rt-1)')
  })

  it('refuses an account that is not, and keeps no token', async () => {
    const h = harness({ autoRedirect: (url) => redirect(url), roster: ['someone@else.com'] })
    await expect(h.auth.signIn()).rejects.toThrow(/not on the course roster/)
    expect(h.stored.token).toBeNull()
    await expect(h.auth.getAccessToken()).rejects.toThrow(/not connected/)
  })
})

describe('getAccessToken', () => {
  it('fails cleanly when nothing is connected', async () => {
    await expect(harness().auth.getAccessToken()).rejects.toThrow(/not connected/)
  })

  it('reuses the cached access token, then refreshes on demand', async () => {
    const h = harness({ autoRedirect: (url) => redirect(url) })
    await h.auth.signIn()
    expect(h.tokenCalls).toHaveLength(1)

    expect(await h.auth.getAccessToken()).toBe('at-1')
    expect(h.tokenCalls).toHaveLength(1)

    expect(await h.auth.getAccessToken(true)).toBe('at-1')
    expect(h.tokenCalls[1]).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1' })
  })

  it('drops a refresh token the server has rejected', async () => {
    let exchanged = false
    const h = harness({
      autoRedirect: (url) => redirect(url),
      tokenResponse: (form) => {
        if (form.grant_type === 'refresh_token') return new Response('invalid_grant', { status: 400 })
        exchanged = true
        return new Response(
          JSON.stringify({ access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-1' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }
    })
    await h.auth.signIn()
    expect(exchanged).toBe(true)
    await expect(h.auth.getAccessToken(true)).rejects.toThrow(/Token refresh failed/)
    expect(h.stored.token).toBeNull()
    expect(h.auth.status().signedIn).toBe(false)
  })
})

describe('signOut', () => {
  it('clears local state and revokes at Google', async () => {
    const h = harness({ autoRedirect: (url) => redirect(url) })
    await h.auth.signIn()
    const status = await h.auth.signOut()
    expect(status.signedIn).toBe(false)
    expect(h.stored).toEqual({ token: null, email: null })
    await expect(h.auth.getAccessToken()).rejects.toThrow(/not connected/)
  })
})
