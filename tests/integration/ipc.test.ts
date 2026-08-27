import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bookmark, DataSource, PrepareResult, ProgressEntry, Settings } from '@shared/types'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
  theme: { themeSource: 'system' as string }
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, fn)
  },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  nativeTheme: mocks.theme,
  BrowserWindow: class {}
}))

const { registerIpc } = await import('../../src/main/ipc')
const { MediaPreparer } = await import('../../src/main/media/prepare')
const { ProviderRegistry } = await import('../../src/main/providers/registry')
const { StreamServer } = await import('../../src/main/server')
const { DEFAULT_LIBRARY, DEFAULT_SETTINGS, JsonStore, libraryKey } = await import(
  '../../src/main/store'
)
const { buildFixtures, ffmpegUsable } = await import('../helpers/fixtures')
const { ROOT_KEY } = await import('../../src/renderer/lib/tree')
const { DRIVE_SOURCE_ID, GDRIVE } = await import('../../src/main/config')

/** Mutable stand-ins so a test can put itself in the owner's shoes. */
const authState = {
  signedIn: false,
  email: undefined as string | undefined,
  manage: false
}
const updateState = {
  info: { current: '1.0.0', available: false } as Record<string, unknown>,
  downloaded: [] as string[]
}
const adminState = {
  canRead: true,
  owner: null as string | null,
  access: [] as Array<{ id: string; email: string | null }>,
  granted: [] as string[],
  revoked: [] as string[]
}

const HAS_FFMPEG = await ffmpegUsable()

/** Invoke a registered handler the way ipcMain would (event arg first). */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return (await handler({}, ...args)) as T
}

let fixtures: Awaited<ReturnType<typeof buildFixtures>>
let settings: InstanceType<typeof JsonStore<Settings>>
let library: InstanceType<typeof JsonStore<typeof DEFAULT_LIBRARY>>
let libraryFile: string
let server: InstanceType<typeof StreamServer>

beforeAll(async () => {
  fixtures = await buildFixtures()
}, 180_000)

afterEach(async () => {
  await server.stop()
})

beforeEach(async () => {
  authState.signedIn = false
  authState.email = undefined
  authState.manage = false
  updateState.info = { current: '1.0.0', available: false }
  updateState.downloaded = []
  adminState.canRead = true
  adminState.owner = null
  adminState.access = []
  adminState.granted = []
  adminState.revoked = []
  mocks.handlers.clear()
  mocks.showOpenDialog.mockReset()
  const dir = mkdtempSync(join(tmpdir(), 'bootcamp-ipc-'))

  libraryFile = join(dir, 'library.json')
  settings = new JsonStore<Settings>(join(dir, 'settings.json'), DEFAULT_SETTINGS, 0)
  library = new JsonStore(libraryFile, DEFAULT_LIBRARY, 0)

  const registry = new ProviderRegistry(
    () => settings.get().sources,
    async () => 'unused'
  )
  server = new StreamServer({ registry, cachePath: (key) => preparer.cachePath(key) })
  const preparer = new MediaPreparer({
    cacheDir: join(dir, 'cache'),
    rawUrl: (sourceId, nodeId) => server.rawUrl(sourceId, nodeId),
    onProgress: () => undefined
  })
  await server.start()

  registerIpc({
    settings,
    library,
    registry,
    server,
    preparer,
    auth: {
      status: () => ({ configured: true, signedIn: authState.signedIn, email: authState.email }),
      hasManageScope: () => authState.manage,
      signIn: async () => {
        authState.signedIn = true
        return { configured: true, signedIn: true, email: authState.email }
      },
      signOut: async () => {
        authState.signedIn = false
        return { configured: true, signedIn: false }
      },
      getAccessToken: async () => 'unused'
    } as never,
    driveAdmin: {
      canRead: async () => adminState.canRead,
      ownerEmail: async () => adminState.owner,
      listAccess: async () => adminState.access,
      grant: async (email: string) => {
        adminState.granted.push(email)
        return adminState.access
      },
      revoke: async (id: string) => {
        adminState.revoked.push(id)
        return adminState.access
      }
    } as never,
    updater: {
      check: async () => updateState.info,
      download: async (asset: { name: string }) => {
        updateState.downloaded.push(asset.name)
        return `/tmp/${asset.name}`
      },
      installHint: () => 'drag it into Applications'
    } as never,
    window: () => null
  })
})

describe('settings channel', () => {
  it('returns defaults and applies patches', async () => {
    expect(await call<Settings>('settings:get')).toMatchObject({ sources: [], theme: 'system' })
    const next = await call<Settings>('settings:patch', { volume: 0.4, theme: 'dark' })
    expect(next.volume).toBe(0.4)
    expect(mocks.theme.themeSource).toBe('dark')
    expect((await call<Settings>('settings:get')).theme).toBe('dark')
  })
})

describe('sources channel', () => {
  it('adds a local source, names it after the folder, and activates it', async () => {
    const source = await call<DataSource>('sources:add', {
      name: '',
      type: 'local',
      root: fixtures.course
    })
    expect(source.name).toBe('course')
    const current = await call<Settings>('settings:get')
    expect(current.sources).toHaveLength(1)
    expect(current.activeSourceId).toBe(source.id)
  })

  it('rejects a local source whose path is not a folder', async () => {
    await expect(
      call('sources:add', { name: 'x', type: 'local', root: join(fixtures.course, 'nope') })
    ).rejects.toThrow(/Not a folder/)
    await expect(call('sources:add', { name: 'x', type: 'local', root: '' })).rejects.toThrow(
      /Pick a folder/
    )
  })

  it('defaults a Drive source to the root folder', async () => {
    const source = await call<DataSource>('sources:add', { name: '', type: 'gdrive', root: '' })
    expect(source).toMatchObject({ name: 'Google Drive', root: 'root' })
  })

  it('moves the active source when the active one is removed', async () => {
    const first = await call<DataSource>('sources:add', {
      name: 'A',
      type: 'local',
      root: fixtures.course
    })
    const second = await call<DataSource>('sources:add', {
      name: 'B',
      type: 'local',
      root: fixtures.intro
    })
    await call('sources:remove', first.id)
    const current = await call<Settings>('settings:get')
    expect(current.sources.map((s) => s.id)).toEqual([second.id])
    expect(current.activeSourceId).toBe(second.id)
  })

  it('passes the picked folder through from the dialog', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/picked'] })
    expect(await call('sources:pickFolder')).toBe('/picked')
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await call('sources:pickFolder')).toBeNull()
  })
})

describe('tree channel', () => {
  it('lists the source root and a subfolder in natural order', async () => {
    const source = await call<DataSource>('sources:add', {
      name: 'C',
      type: 'local',
      root: fixtures.course
    })
    const roots = await call<Array<{ name: string }>>('tree:list', source.id)
    expect(roots.map((n) => n.name)).toEqual(['01 Intro', '02 Advanced', '03 Long'])

    const advanced = await call<Array<{ name: string }>>('tree:list', source.id, fixtures.advanced)
    expect(advanced.map((n) => n.name)).toEqual(['09 ninth.mp4', '10 last.mp4', 'exotic.mkv'])
    expect(ROOT_KEY).toBe('#root')
  })

  it('rejects an unknown source id', async () => {
    await expect(call('tree:list', 'ghost')).rejects.toThrow(/Unknown data source/)
  })
})

describe.runIf(HAS_FFMPEG)('media channel', () => {
  it('prepares a web-native mp4 as a direct stream with its subtitles', async () => {
    const source = await call<DataSource>('sources:add', {
      name: 'C',
      type: 'local',
      root: fixtures.course
    })
    const result = await call<PrepareResult>('media:prepare', source.id, fixtures.welcome)

    expect(result.mode).toBe('direct')
    expect(result.url).toContain('/raw/')
    expect(result.url).toContain(`t=${server.token}`)
    expect(result.durationSec).toBeGreaterThan(2)
    expect(result.subtitles.map((s) => s.label)).toEqual(['Subtitles', 'tr'])
    expect(result.subtitles[0].url).toContain('/sub/')

    // The URL it handed the renderer must actually serve bytes.
    const res = await fetch(result.url, { headers: { Range: 'bytes=0-7' } })
    expect(res.status).toBe(206)
    await res.arrayBuffer()
  })

  it('routes an mkv through the cache instead of the raw stream', async () => {
    const source = await call<DataSource>('sources:add', {
      name: 'C',
      type: 'local',
      root: fixtures.course
    })
    const result = await call<PrepareResult>('media:prepare', source.id, fixtures.exoticMkv)
    expect(result.mode).toBe('remux')
    expect(result.url).toContain('/cache/')
    expect((await fetch(result.url)).status).toBe(200)
  }, 120_000)

  it('errors clearly for a missing file', async () => {
    const source = await call<DataSource>('sources:add', {
      name: 'C',
      type: 'local',
      root: fixtures.course
    })
    await expect(
      call('media:prepare', source.id, join(fixtures.course, 'ghost.mp4'))
    ).rejects.toThrow(/Media not found/)
  })
})

describe('gdrive channel', () => {
  it('sign-in creates the fixed course source and activates it', async () => {
    const status = await call<{ signedIn: boolean }>('gdrive:signIn')
    expect(status.signedIn).toBe(true)

    const settings = await call<Settings>('settings:get')
    const source = settings.sources.find((s) => s.id === DRIVE_SOURCE_ID)
    expect(source).toMatchObject({
      id: DRIVE_SOURCE_ID,
      type: 'gdrive',
      name: GDRIVE.sourceName,
      root: GDRIVE.folderId.trim() || 'root'
    })
    expect(settings.activeSourceId).toBe(DRIVE_SOURCE_ID)
  })

  it('refuses an account the course folder was never shared with', async () => {
    adminState.canRead = false
    authState.email = 'outsider@example.com'

    await expect(call('gdrive:signIn')).rejects.toThrow(/does not have access to the course folder/)

    // No half-signed-in state left behind, and no source to click on.
    expect(authState.signedIn).toBe(false)
    const settings = await call<Settings>('settings:get')
    expect(settings.sources).toEqual([])
    expect(settings.activeSourceId).toBeNull()
  })

  it('signing in twice does not duplicate the source', async () => {
    await call('gdrive:signIn')
    await call('gdrive:signIn')
    const settings = await call<Settings>('settings:get')
    expect(settings.sources.filter((s) => s.id === DRIVE_SOURCE_ID)).toHaveLength(1)
  })

  it('sign-out drops the source but keeps its progress', async () => {
    await call('gdrive:signIn')
    await call('progress:set', DRIVE_SOURCE_ID, 'lesson-1', 30, 100)

    await call('gdrive:signOut')
    const settings = await call<Settings>('settings:get')
    expect(settings.sources.some((s) => s.id === DRIVE_SOURCE_ID)).toBe(false)
    expect(settings.activeSourceId).toBeNull()

    // The id is stable, so signing back in restores every watched mark.
    expect(await call('progress:get', DRIVE_SOURCE_ID, 'lesson-1')).toMatchObject({ position: 30 })
  })

  it('keeps a local source active when Drive signs out', async () => {
    const local = await call<DataSource>('sources:add', {
      name: 'C',
      type: 'local',
      root: fixtures.course
    })
    await call('gdrive:signIn')
    await call('gdrive:signOut')
    const settings = await call<Settings>('settings:get')
    expect(settings.activeSourceId).toBe(local.id)
  })
})

describe('update channel', () => {
  it('passes the check through', async () => {
    updateState.info = { current: '1.0.0', available: false }
    expect(await call('update:check')).toEqual({ current: '1.0.0', available: false })
  })

  it('refuses to download before a check has found something', async () => {
    await expect(call('update:download')).rejects.toThrow(/check for an update first/)
    await expect(call('update:install')).rejects.toThrow(/download an update first/)
  })

  it('downloads the asset the check remembered', async () => {
    updateState.info = {
      current: '1.0.0',
      available: true,
      version: '1.1.0',
      asset: { name: 'BootcampPlayer-1.1.0-arm64.dmg', url: 'https://x/y', size: 10 }
    }
    await call('update:check')

    const result = await call<{ path: string; hint: string }>('update:download')
    expect(updateState.downloaded).toEqual(['BootcampPlayer-1.1.0-arm64.dmg'])
    expect(result.path).toContain('BootcampPlayer-1.1.0-arm64.dmg')
    expect(result.hint).toBe('drag it into Applications')
  })

  it('does not remember an asset from a check that found nothing', async () => {
    updateState.info = {
      current: '1.0.0',
      available: true,
      version: '1.1.0',
      asset: { name: 'a.dmg', url: 'https://x/y', size: 1 }
    }
    await call('update:check')
    updateState.info = { current: '1.0.0', available: false }
    await call('update:check')
    await expect(call('update:download')).rejects.toThrow(/check for an update first/)
  })
})

describe('admin channel', () => {
  const asOwner = (): void => {
    authState.signedIn = true
    authState.email = 'owner@example.com'
    adminState.owner = 'Owner@Example.com'
  }

  it('nobody is admin while signed out', async () => {
    expect(await call('admin:status')).toEqual({ isAdmin: false, canManage: false })
  })

  it('the folder owner is the admin — no configured email', async () => {
    asOwner()
    // Case-insensitive: Google echoes the address in whatever case it stored.
    expect(await call('admin:status')).toEqual({ isAdmin: true, canManage: false })
    authState.manage = true
    expect(await call('admin:status')).toEqual({ isAdmin: true, canManage: true })
  })

  it('a signed-in non-owner is not the admin', async () => {
    authState.signedIn = true
    authState.email = 'student@example.com'
    adminState.owner = 'owner@example.com'
    expect(await call('admin:status')).toEqual({ isAdmin: false, canManage: false })
  })

  it('refuses every management call for a non-owner', async () => {
    authState.signedIn = true
    authState.email = 'student@example.com'
    adminState.owner = 'owner@example.com'
    await expect(call('admin:list')).rejects.toThrow(/only the course folder owner/i)
    await expect(call('admin:grant', 'x@y.com')).rejects.toThrow(/only the course folder owner/i)
    await expect(call('admin:revoke', 'perm-1')).rejects.toThrow(/only the course folder owner/i)
    expect(adminState.granted).toEqual([])
    expect(adminState.revoked).toEqual([])
  })

  it('lets the owner list, grant and revoke', async () => {
    asOwner()
    adminState.access = [{ id: 'perm-1', email: 'student@example.com' }]
    expect(await call('admin:list')).toEqual(adminState.access)

    await call('admin:grant', 'new@example.com')
    expect(adminState.granted).toEqual(['new@example.com'])

    await call('admin:revoke', 'perm-1')
    expect(adminState.revoked).toEqual(['perm-1'])
  })

  it('re-checks the owner after a sign-out, not a cached answer', async () => {
    asOwner()
    expect(await call<{ isAdmin: boolean }>('admin:status')).toMatchObject({ isAdmin: true })

    await call('gdrive:signOut')
    adminState.owner = 'someone-else@example.com'
    authState.email = undefined
    expect(await call('admin:status')).toEqual({ isAdmin: false, canManage: false })
  })
})

describe('progress channel', () => {
  it('round-trips an entry and keeps sources separate', async () => {
    const entry = await call<ProgressEntry>('progress:set', 's1', '/a.mp4', 42, 100)
    expect(entry).toMatchObject({ position: 42, duration: 100, watched: false })
    expect(await call('progress:get', 's1', '/a.mp4')).toEqual(entry)
    expect(await call('progress:get', 's2', '/a.mp4')).toBeNull()
  })

  it('applies the watched threshold from settings', async () => {
    expect((await call<ProgressEntry>('progress:set', 's1', '/a.mp4', 95, 100)).watched).toBe(true)
    // Rewinding must not un-watch it.
    expect((await call<ProgressEntry>('progress:set', 's1', '/a.mp4', 3, 100)).watched).toBe(true)

    await call('settings:patch', { watchedRatio: 0.5 })
    expect((await call<ProgressEntry>('progress:set', 's1', '/b.mp4', 60, 100)).watched).toBe(true)
  })

  it('bulk-reads only the ids that have progress', async () => {
    await call('progress:set', 's1', '/a.mp4', 1, 2)
    const many = await call<Record<string, ProgressEntry>>('progress:many', 's1', [
      '/a.mp4',
      '/b.mp4'
    ])
    expect(Object.keys(many)).toEqual(['/a.mp4'])
  })

  it('clears an entry', async () => {
    await call('progress:set', 's1', '/a.mp4', 1, 2)
    await call('progress:clear', 's1', '/a.mp4')
    expect(await call('progress:get', 's1', '/a.mp4')).toBeNull()
  })

  it('persists across a store reload', async () => {
    await call('progress:set', 's1', '/a.mp4', 7, 10)
    library.flush()
    const reopened = new JsonStore(libraryFile, DEFAULT_LIBRARY, 0)
    expect(reopened.get().progress[libraryKey('s1', '/a.mp4')]?.position).toBe(7)
  })
})

describe('bookmarks channel', () => {
  it('adds, sorts by time, and removes', async () => {
    await call('bookmarks:add', 's1', '/a.mp4', 90, 'later note')
    const list = await call<Bookmark[]>('bookmarks:add', 's1', '/a.mp4', 10, '  early  ')
    expect(list.map((b) => b.time)).toEqual([10, 90])
    expect(list[0].note).toBe('early')

    const after = await call<Bookmark[]>('bookmarks:remove', 's1', '/a.mp4', list[0].id)
    expect(after.map((b) => b.time)).toEqual([90])
    expect(await call<Bookmark[]>('bookmarks:list', 's1', '/a.mp4')).toHaveLength(1)
  })

  it('returns an empty list for an unknown lesson', async () => {
    expect(await call('bookmarks:list', 's1', '/nothing.mp4')).toEqual([])
  })
})
