import { BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import type {
  Bookmark,
  DataSource,
  MediaNode,
  PrepareResult,
  ProgressEntry,
  Settings,
  SubtitleTrack
} from '@shared/types'
import { subtitleLabelFor } from '@shared/media'
import { DRIVE_SOURCE_ID, driveRoot, GDRIVE } from './config'
import type { GDriveAuth } from './auth/gdrive-oauth'
import type { MediaPreparer } from './media/prepare'
import type { ProviderRegistry } from './providers/registry'
import { ProviderError } from './providers/types'
import type { StreamServer } from './server'
import { libraryKey, makeProgressEntry, type JsonStore, type LibraryData } from './store'

export interface AppContext {
  settings: JsonStore<Settings>
  library: JsonStore<LibraryData>
  registry: ProviderRegistry
  server: StreamServer
  preparer: MediaPreparer
  auth: GDriveAuth
  window(): BrowserWindow | null
}

/** Restored when leaving mini mode. */
let normalBounds: Electron.Rectangle | null = null

export function registerIpc(ctx: AppContext): void {
  const handle = <A extends unknown[], R>(
    channel: string,
    fn: (...args: A) => R | Promise<R>
  ): void => {
    ipcMain.handle(channel, (_event, ...args) => fn(...(args as A)))
  }

  handle('settings:get', () => ctx.settings.get())

  handle('settings:patch', (patch: Partial<Settings>) => {
    const next = ctx.settings.set(patch)
    if (patch.sources) ctx.registry.clear()
    if (patch.theme) nativeTheme.themeSource = patch.theme
    return next
  })

  handle('sources:pickFolder', async () => {
    const win = ctx.window()
    const options: Electron.OpenDialogOptions = {
      title: 'Select course folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle('sources:add', (input: Omit<DataSource, 'id'>) => {
    if (input.type === 'local') {
      if (!input.root) throw new Error('Pick a folder first')
      let isDir = false
      try {
        isDir = statSync(input.root).isDirectory()
      } catch {
        isDir = false
      }
      if (!isDir) throw new Error(`Not a folder: ${input.root}`)
    }

    const source: DataSource = {
      id: randomUUID(),
      name: input.name.trim() || defaultName(input),
      type: input.type,
      root: input.type === 'gdrive' ? input.root.trim() || 'root' : input.root
    }
    const current = ctx.settings.get()
    ctx.settings.set({
      sources: [...current.sources, source],
      activeSourceId: current.activeSourceId ?? source.id
    })
    ctx.registry.clear()
    return source
  })

  handle('sources:remove', (id: string) => {
    const current = ctx.settings.get()
    const sources = current.sources.filter((s) => s.id !== id)
    ctx.settings.set({
      sources,
      activeSourceId: current.activeSourceId === id ? (sources[0]?.id ?? null) : current.activeSourceId
    })
    ctx.registry.clear()
  })

  handle('tree:list', (sourceId: string, parentId?: string): Promise<MediaNode[]> => {
    return ctx.registry.get(sourceId).list(parentId)
  })

  handle('media:prepare', async (sourceId: string, nodeId: string): Promise<PrepareResult> => {
    const provider = ctx.registry.get(sourceId)
    const node = await provider.stat(nodeId)
    if (!node) throw new ProviderError(`Media not found: ${nodeId}`, 404)

    const prepared = await ctx.preparer.prepare(sourceId, provider, node)
    const url = prepared.cacheKey
      ? ctx.server.cacheUrl(prepared.cacheKey)
      : ctx.server.rawUrl(sourceId, nodeId)

    const subtitles: SubtitleTrack[] = (await provider.findSubtitles(nodeId).catch(() => [])).map(
      (sub) => ({
        id: sub.id,
        label: subtitleLabelFor(node.name, sub.name) ?? sub.name,
        url: ctx.server.subtitleUrl(sourceId, sub.id)
      })
    )

    return { url, mode: prepared.mode, durationSec: prepared.durationSec, subtitles }
  })

  handle('media:cancelPrepare', async (sourceId: string, nodeId: string) => {
    const node = await ctx.registry.get(sourceId).stat(nodeId)
    if (node) ctx.preparer.cancel(sourceId, node)
  })

  handle('progress:get', (sourceId: string, nodeId: string): ProgressEntry | null => {
    return ctx.library.get().progress[libraryKey(sourceId, nodeId)] ?? null
  })

  handle('progress:set', (sourceId: string, nodeId: string, position: number, duration: number) => {
    const key = libraryKey(sourceId, nodeId)
    const all = ctx.library.get().progress
    const entry = makeProgressEntry(position, duration, ctx.settings.get().watchedRatio, all[key])
    ctx.library.set({ progress: { ...all, [key]: entry } })
    return entry
  })

  handle('progress:many', (sourceId: string, nodeIds: string[]) => {
    const all = ctx.library.get().progress
    const out: Record<string, ProgressEntry> = {}
    for (const nodeId of nodeIds) {
      const entry = all[libraryKey(sourceId, nodeId)]
      if (entry) out[nodeId] = entry
    }
    return out
  })

  handle('progress:clear', (sourceId: string, nodeId: string) => {
    const progress = { ...ctx.library.get().progress }
    delete progress[libraryKey(sourceId, nodeId)]
    ctx.library.set({ progress })
  })

  handle('bookmarks:list', (sourceId: string, nodeId: string): Bookmark[] => {
    return ctx.library.get().bookmarks[libraryKey(sourceId, nodeId)] ?? []
  })

  handle('bookmarks:add', (sourceId: string, nodeId: string, time: number, note: string) => {
    const key = libraryKey(sourceId, nodeId)
    const all = ctx.library.get().bookmarks
    const list = [
      ...(all[key] ?? []),
      { id: randomUUID(), time, note: note.trim(), createdAt: Date.now() }
    ].sort((a, b) => a.time - b.time)
    ctx.library.set({ bookmarks: { ...all, [key]: list } })
    return list
  })

  handle('bookmarks:remove', (sourceId: string, nodeId: string, bookmarkId: string) => {
    const key = libraryKey(sourceId, nodeId)
    const all = ctx.library.get().bookmarks
    const list = (all[key] ?? []).filter((b) => b.id !== bookmarkId)
    ctx.library.set({ bookmarks: { ...all, [key]: list } })
    return list
  })

  handle('gdrive:status', () => ctx.auth.status())

  handle('gdrive:signIn', async () => {
    const status = await ctx.auth.signIn()
    // The folder is fixed, so the source appears on its own — no form to fill in.
    syncDriveSource(ctx)
    return status
  })

  handle('gdrive:signOut', async () => {
    const status = await ctx.auth.signOut()
    // Drop the source, keep the progress: it is keyed by DRIVE_SOURCE_ID, which
    // never changes, so signing back in restores every watched mark.
    const current = ctx.settings.get()
    const sources = current.sources.filter((s) => s.id !== DRIVE_SOURCE_ID)
    ctx.settings.set({
      sources,
      activeSourceId:
        current.activeSourceId === DRIVE_SOURCE_ID
          ? (sources[0]?.id ?? null)
          : current.activeSourceId
    })
    ctx.registry.clear()
    return status
  })

  handle('win:setMini', (on: boolean) => {
    const win = ctx.window()
    if (!win) return false
    if (on) {
      normalBounds = win.getBounds()
      win.setAlwaysOnTop(true, 'floating')
      const { x, y } = win.getBounds()
      win.setBounds({ x, y, width: 480, height: 300 }, true)
    } else {
      win.setAlwaysOnTop(false)
      if (normalBounds) win.setBounds(normalBounds, true)
    }
    return on
  })
}

function defaultName(input: Omit<DataSource, 'id'>): string {
  if (input.type === 'gdrive') return 'Google Drive'
  const parts = input.root.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? 'Local folder'
}

/**
 * Create or refresh the one fixed Drive source and make it active. Called after
 * a successful sign-in and at startup, so a folder id changed in a new build
 * reaches installs that are already signed in.
 */
export function syncDriveSource(ctx: AppContext): DataSource {
  const source: DataSource = {
    id: DRIVE_SOURCE_ID,
    name: GDRIVE.sourceName,
    type: 'gdrive',
    root: driveRoot()
  }
  const current = ctx.settings.get()
  const exists = current.sources.some((s) => s.id === DRIVE_SOURCE_ID)
  ctx.settings.set({
    sources: exists
      ? current.sources.map((s) => (s.id === DRIVE_SOURCE_ID ? source : s))
      : [...current.sources, source],
    activeSourceId: DRIVE_SOURCE_ID
  })
  ctx.registry.clear()
  return source
}
