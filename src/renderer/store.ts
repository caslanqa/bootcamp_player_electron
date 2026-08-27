import { create } from 'zustand'
import type {
  Bookmark,
  DataSource,
  MediaNode,
  PrepareMode,
  PrepareProgress,
  ProgressEntry,
  Settings,
  SubtitleTrack
} from '@shared/types'
import { flatten, neighbourMedia, nextCollapsedFolder, ROOT_KEY, type TreeMap } from './lib/tree'

export interface Current {
  sourceId: string
  node: MediaNode
  url: string
  mode: PrepareMode
  subtitles: SubtitleTrack[]
  durationSec?: number
}

interface AppState {
  ready: boolean
  settings: Settings
  tree: TreeMap
  expanded: Record<string, boolean>
  progress: Record<string, ProgressEntry>
  loading: Record<string, boolean>
  query: string
  current: Current | null
  preparing: PrepareProgress | null
  bookmarks: Bookmark[]
  error: string | null

  init(): Promise<void>
  patchSettings(patch: Partial<Settings>): Promise<void>
  addSource(input: Omit<DataSource, 'id'>): Promise<void>
  removeSource(id: string): Promise<void>
  selectSource(id: string): Promise<void>
  reloadSources(): Promise<void>
  loadChildren(parentId?: string): Promise<void>
  toggleFolder(node: MediaNode): Promise<void>
  play(node: MediaNode): Promise<void>
  step(direction: 1 | -1): Promise<boolean>
  saveProgress(position: number, duration: number): void
  addBookmark(time: number, note: string): Promise<void>
  removeBookmark(id: string): Promise<void>
  setQuery(query: string): void
  fail(message: string): void
  dismissError(): void
}

const EMPTY_SETTINGS: Settings = {
  sources: [],
  activeSourceId: null,
  theme: 'system',
  volume: 0.8,
  rate: 1,
  autoplayNext: true,
  subtitlesEnabled: true,
  watchedRatio: 0.92
}

/** Progress is written at most this often while playing. */
const PROGRESS_SAVE_MS = 4000

export const useStore = create<AppState>((set, get) => {
  let lastSaved = 0

  const activeId = (): string => {
    const id = get().settings.activeSourceId
    if (!id) throw new Error('No data source selected')
    return id
  }

  return {
    ready: false,
    settings: EMPTY_SETTINGS,
    tree: {},
    expanded: {},
    progress: {},
    loading: {},
    query: '',
    current: null,
    preparing: null,
    bookmarks: [],
    error: null,

    async init() {
      const settings = await window.api.settings.get()
      set({ settings, ready: true })
      window.api.media.onPrepareProgress((p) => {
        set({ preparing: p.done && !p.error ? null : p })
        if (p.error) get().fail(p.error)
      })
      if (settings.activeSourceId) await get().loadChildren()
    },

    async patchSettings(patch) {
      const settings = await window.api.settings.patch(patch)
      set({ settings })
    },

    async addSource(input) {
      const source = await window.api.sources.add(input)
      const settings = await window.api.settings.get()
      set({ settings })
      await get().selectSource(source.id)
    },

    async removeSource(id) {
      await window.api.sources.remove(id)
      const settings = await window.api.settings.get()
      const wasActive = get().settings.activeSourceId === id
      set({ settings, ...(wasActive ? { tree: {}, expanded: {}, current: null } : {}) })
      if (wasActive && settings.activeSourceId) await get().loadChildren()
    },

    /** Settings changed in main (Drive sign-in/out adds or drops the fixed source). */
    async reloadSources() {
      const settings = await window.api.settings.get()
      set({ settings, tree: {}, expanded: {}, current: null, progress: {}, query: '' })
      if (settings.activeSourceId) await get().loadChildren()
    },

    async selectSource(id) {
      await get().patchSettings({ activeSourceId: id })
      set({ tree: {}, expanded: {}, current: null, progress: {}, query: '' })
      await get().loadChildren()
    },

    async loadChildren(parentId) {
      const key = parentId ?? ROOT_KEY
      if (get().tree[key] || get().loading[key]) return
      set((s) => ({ loading: { ...s.loading, [key]: true } }))
      try {
        const children = await window.api.tree.list(activeId(), parentId)
        const mediaIds = children.filter((c) => c.kind === 'media').map((c) => c.id)
        const progress = mediaIds.length
          ? await window.api.progress.many(activeId(), mediaIds)
          : {}
        set((s) => ({
          tree: { ...s.tree, [key]: children },
          progress: { ...s.progress, ...progress }
        }))
      } catch (err) {
        get().fail((err as Error).message)
      } finally {
        set((s) => ({ loading: { ...s.loading, [key]: false } }))
      }
    },

    async toggleFolder(node) {
      const open = !get().expanded[node.id]
      set((s) => ({ expanded: { ...s.expanded, [node.id]: open } }))
      if (open) await get().loadChildren(node.id)
    },

    async play(node) {
      const sourceId = activeId()
      set({ preparing: null })
      try {
        const prepared = await window.api.media.prepare(sourceId, node.id)
        set({
          current: {
            sourceId,
            node,
            url: prepared.url,
            mode: prepared.mode,
            subtitles: prepared.subtitles,
            durationSec: prepared.durationSec
          },
          preparing: null
        })
        const bookmarks = await window.api.bookmarks.list(sourceId, node.id)
        set({ bookmarks })
      } catch (err) {
        get().fail((err as Error).message)
      }
    },

    async step(direction) {
      const current = get().current
      if (!current) return false
      const rows = flatten(get().tree, get().expanded)
      const next = neighbourMedia(rows, current.node.id, direction)
      if (next) {
        await get().play(next)
        return true
      }
      // Off the end of the current folder: pull in the next one and start it.
      if (direction === 1) {
        const folder = nextCollapsedFolder(rows, get().expanded, current.node.id)
        if (folder) {
          await get().toggleFolder(folder)
          const first = flatten(get().tree, get().expanded)
            .filter((r) => r.node.kind === 'media')
            .find((r) => r.parentKey === folder.id)
          if (first) {
            await get().play(first.node)
            return true
          }
        }
      }
      return false
    },

    saveProgress(position, duration) {
      const current = get().current
      if (!current || !Number.isFinite(duration) || duration <= 0) return
      const now = Date.now()
      // Always record the last second so a finished lesson is marked watched.
      const atEnd = position >= duration - 1
      if (!atEnd && now - lastSaved < PROGRESS_SAVE_MS) return
      lastSaved = now

      void window.api.progress
        .set(current.sourceId, current.node.id, position, duration)
        .then((entry) => {
          set((s) => ({ progress: { ...s.progress, [current.node.id]: entry } }))
        })
    },

    async addBookmark(time, note) {
      const current = get().current
      if (!current) return
      const bookmarks = await window.api.bookmarks.add(
        current.sourceId,
        current.node.id,
        time,
        note
      )
      set({ bookmarks })
    },

    async removeBookmark(id) {
      const current = get().current
      if (!current) return
      const bookmarks = await window.api.bookmarks.remove(current.sourceId, current.node.id, id)
      set({ bookmarks })
    },

    setQuery(query) {
      set({ query })
    },

    fail(message) {
      set({ error: message })
    },

    dismissError() {
      set({ error: null })
    }
  }
})
