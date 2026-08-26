import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { GDriveCredentials, GDriveStatus } from '@shared/types'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const LOGIN_TIMEOUT_MS = 5 * 60_000

export interface OAuthDeps {
  /** Hand the consent URL to the system browser — never render Google's login in-app. */
  openExternal(url: string): Promise<void>
  /** OS-keychain-backed encryption; identity functions in tests. */
  encrypt(plain: string): string
  decrypt(cipher: string): string
  getCredentials(): GDriveCredentials
  loadToken(): { token: string | null; email: string | null }
  saveToken(token: string | null, email: string | null): void
  fetchImpl?: typeof fetch
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
}

/**
 * Installed-app OAuth: PKCE + loopback redirect. No client secret is truly
 * secret in a desktop app, so PKCE is what actually protects the exchange.
 */
export class GDriveAuth {
  private accessToken: string | null = null
  private expiresAt = 0
  private readonly fetchImpl: typeof fetch

  constructor(private readonly deps: OAuthDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch
  }

  status(): GDriveStatus {
    const { clientId } = this.deps.getCredentials()
    const { token, email } = this.deps.loadToken()
    return {
      configured: clientId.trim().length > 0,
      signedIn: token !== null,
      email: email ?? undefined
    }
  }

  private refreshToken(): string | null {
    const { token } = this.deps.loadToken()
    if (!token) return null
    try {
      return this.deps.decrypt(token)
    } catch {
      return null
    }
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() < this.expiresAt) {
      return this.accessToken
    }
    const refresh = this.refreshToken()
    if (!refresh) throw new Error('Google Drive is not connected')

    const { clientId, clientSecret } = this.deps.getCredentials()
    const body = new URLSearchParams({
      client_id: clientId,
      refresh_token: refresh,
      grant_type: 'refresh_token'
    })
    if (clientSecret) body.set('client_secret', clientSecret)

    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    if (!res.ok) {
      // A dead refresh token can never recover; drop it so the UI asks for a new login.
      this.deps.saveToken(null, null)
      throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`)
    }
    const json = (await res.json()) as TokenResponse
    this.accessToken = json.access_token
    this.expiresAt = Date.now() + (json.expires_in - 60) * 1000
    return this.accessToken
  }

  async signIn(): Promise<GDriveStatus> {
    const { clientId, clientSecret } = this.deps.getCredentials()
    if (!clientId.trim()) throw new Error('Set a Google OAuth client ID in Settings first')

    const verifier = base64url(randomBytes(48))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(16))

    const { server, port, waitForCode } = await startLoopback(state)
    try {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: 'code',
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent'
      })
      await this.deps.openExternal(`${AUTH_URL}?${params}`)
      const code = await waitForCode

      const body = new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: `http://127.0.0.1:${port}`
      })
      if (clientSecret) body.set('client_secret', clientSecret)

      const res = await this.fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
      if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
      const json = (await res.json()) as TokenResponse
      if (!json.refresh_token) {
        throw new Error('Google returned no refresh token — revoke app access and retry')
      }

      this.accessToken = json.access_token
      this.expiresAt = Date.now() + (json.expires_in - 60) * 1000
      const email = await this.fetchEmail(json.access_token)
      this.deps.saveToken(this.deps.encrypt(json.refresh_token), email)
      return this.status()
    } finally {
      server.close()
    }
  }

  async signOut(): Promise<GDriveStatus> {
    const refresh = this.refreshToken()
    this.accessToken = null
    this.expiresAt = 0
    this.deps.saveToken(null, null)
    if (refresh) {
      // Best effort: local state is already cleared either way.
      await this.fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(refresh)}`, {
        method: 'POST'
      }).catch(() => undefined)
    }
    return this.status()
  }

  /** drive.readonly is enough to read the account label off /about. */
  private async fetchEmail(accessToken: string): Promise<string | null> {
    try {
      const res = await this.fetchImpl(
        'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!res.ok) return null
      const json = (await res.json()) as { user?: { emailAddress?: string } }
      return json.user?.emailAddress ?? null
    } catch {
      return null
    }
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

async function startLoopback(
  expectedState: string
): Promise<{ server: Server; port: number; waitForCode: Promise<string> }> {
  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  const waitForCode = new Promise<string>((res, rej) => {
    resolveCode = res
    rejectCode = rej
  })

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')
    const reply = (message: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:3rem">
         <h2>${message}</h2><p>You can close this tab.</p></body>`
      )
    }
    if (error) {
      reply('Sign-in cancelled.')
      rejectCode(new Error(`Google returned: ${error}`))
    } else if (!code || state !== expectedState) {
      reply('Unexpected response.')
      rejectCode(new Error('OAuth state mismatch'))
    } else {
      reply('Signed in.')
      resolveCode(code)
    }
  })

  const timer = setTimeout(() => rejectCode(new Error('Sign-in timed out')), LOGIN_TIMEOUT_MS)
  waitForCode.finally(() => clearTimeout(timer)).catch(() => undefined)

  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('Loopback bind failed')
  return { server, port: address.port, waitForCode }
}
