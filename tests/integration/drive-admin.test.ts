import { describe, expect, it } from 'vitest'
import { DriveAdmin } from '../../src/main/drive-admin'
import { ProviderError } from '../../src/main/providers/types'

const FOLDER = '1S_bC1BqGhFSuhktVhi8yXlOb03gEpxZf'

interface Call {
  method: string
  url: string
  body?: unknown
}

function fake(handler: (url: URL, init: RequestInit) => Response): {
  impl: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({
      method: init.method ?? 'GET',
      url: String(input),
      body: init.body ? JSON.parse(String(init.body)) : undefined
    })
    return handler(url, init)
  }) as typeof fetch
  return { impl, calls }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const admin = (impl: typeof fetch): DriveAdmin =>
  new DriveAdmin(FOLDER, async () => 'token', impl)

describe('ownerEmail', () => {
  it('reads the folder owner', async () => {
    const { impl, calls } = fake(() => json({ owners: [{ emailAddress: 'owner@example.com' }] }))
    expect(await admin(impl).ownerEmail()).toBe('owner@example.com')
    expect(calls[0].url).toContain('fields=owners')
  })

  it('returns null rather than throwing when Drive says no', async () => {
    const { impl } = fake(() => new Response('nope', { status: 403 }))
    expect(await admin(impl).ownerEmail()).toBeNull()
  })

  it('returns null when the folder somehow has no owner', async () => {
    const { impl } = fake(() => json({}))
    expect(await admin(impl).ownerEmail()).toBeNull()
  })
})

describe('listAccess', () => {
  it('maps permissions, marks owner and self, and sorts', async () => {
    const { impl, calls } = fake(() =>
      json({
        permissions: [
          { id: 'p2', type: 'user', role: 'reader', emailAddress: 'zoe@example.com', displayName: 'Zoe' },
          { id: 'p1', type: 'user', role: 'owner', emailAddress: 'owner@example.com', displayName: 'Owner' }
        ]
      })
    )
    const list = await admin(impl).listAccess('zoe@example.com')
    expect(list.map((e) => e.id)).toEqual(['p1', 'p2'])
    expect(list[0]).toMatchObject({ isOwner: true, isSelf: false })
    expect(list[1]).toMatchObject({ isOwner: false, isSelf: true })
    expect(calls[0].url).toContain(`/files/${FOLDER}/permissions`)
  })

  it('follows pagination', async () => {
    const { impl, calls } = fake((url) =>
      url.searchParams.get('pageToken')
        ? json({ permissions: [{ id: 'p2', type: 'user', role: 'reader' }] })
        : json({
            permissions: [{ id: 'p1', type: 'user', role: 'reader' }],
            nextPageToken: 'next'
          })
    )
    expect((await admin(impl).listAccess(null)).map((e) => e.id)).toEqual(['p1', 'p2'])
    expect(calls).toHaveLength(2)
  })

  it('skips permissions Drive has already deleted', async () => {
    const { impl } = fake(() =>
      json({
        permissions: [
          { id: 'p1', type: 'user', role: 'reader', emailAddress: 'a@b.com' },
          { id: 'p2', type: 'user', role: 'reader', emailAddress: 'gone@b.com', deleted: true }
        ]
      })
    )
    expect((await admin(impl).listAccess(null)).map((e) => e.id)).toEqual(['p1'])
  })

  it('surfaces a failure with its status', async () => {
    const { impl } = fake(() => new Response('denied', { status: 403 }))
    await expect(admin(impl).listAccess(null)).rejects.toThrow(/Could not read the access list: 403/)
  })

  it('retries once with a refreshed token after a 401', async () => {
    let issued = 0
    const { impl, calls } = fake((_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization
      return auth === 'Bearer stale'
        ? new Response('expired', { status: 401 })
        : json({ permissions: [] })
    })
    const subject = new DriveAdmin(FOLDER, async (force) => {
      issued += 1
      return force ? 'fresh' : 'stale'
    }, impl)
    await expect(subject.listAccess(null)).resolves.toEqual([])
    expect(calls).toHaveLength(2)
    expect(issued).toBe(2)
  })
})

describe('grant', () => {
  it('adds a reader and asks Google to notify them', async () => {
    const { impl, calls } = fake((url) =>
      url.pathname.endsWith('/permissions') && url.searchParams.has('sendNotificationEmail')
        ? json({ id: 'new' })
        : json({ permissions: [] })
    )
    await admin(impl).grant('  student@example.com  ', 'owner@example.com')

    const create = calls[0]
    expect(create.method).toBe('POST')
    expect(create.body).toEqual({
      role: 'reader',
      type: 'user',
      emailAddress: 'student@example.com'
    })
    expect(create.url).toContain('sendNotificationEmail=true')
    // Returns the refreshed list, so the panel never shows stale rows.
    expect(calls[1].method).toBe('GET')
  })

  it('rejects a malformed address without calling Drive', async () => {
    const { impl, calls } = fake(() => json({}))
    await expect(admin(impl).grant('not-an-email', null)).rejects.toThrow(ProviderError)
    expect(calls).toEqual([])
  })

  it('surfaces a Drive refusal', async () => {
    const { impl } = fake(() => new Response('bad', { status: 400 }))
    await expect(admin(impl).grant('a@b.com', null)).rejects.toThrow(/Could not grant access: 400/)
  })
})

describe('revoke', () => {
  it('deletes the permission and returns the refreshed list', async () => {
    const { impl, calls } = fake((_url, init) =>
      init.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ permissions: [] })
    )
    await admin(impl).revoke('perm-9', null)
    expect(calls[0].method).toBe('DELETE')
    expect(calls[0].url).toContain('/permissions/perm-9')
    expect(calls[1].method).toBe('GET')
  })

  it('treats an already-gone permission as success', async () => {
    const { impl } = fake((_url, init) =>
      init.method === 'DELETE' ? new Response('', { status: 404 }) : json({ permissions: [] })
    )
    await expect(admin(impl).revoke('perm-9', null)).resolves.toEqual([])
  })

  it('surfaces any other failure', async () => {
    const { impl } = fake((_url, init) =>
      init.method === 'DELETE' ? new Response('nope', { status: 403 }) : json({ permissions: [] })
    )
    await expect(admin(impl).revoke('perm-9', null)).rejects.toThrow(/Could not revoke access: 403/)
  })
})

describe('canRead', () => {
  it('is true when Drive serves the folder', async () => {
    const { impl, calls } = fake(() => json({ id: FOLDER }))
    expect(await admin(impl).canRead()).toBe(true)
    expect(calls[0].url).toContain('fields=id')
  })

  it('is false for a folder that was never shared', async () => {
    // Drive answers 404, not 403, for a file the account cannot see at all.
    const { impl } = fake(() => new Response('not found', { status: 404 }))
    expect(await admin(impl).canRead()).toBe(false)
  })

  it('is false when access was revoked', async () => {
    const { impl } = fake(() => new Response('forbidden', { status: 403 }))
    expect(await admin(impl).canRead()).toBe(false)
  })
})
