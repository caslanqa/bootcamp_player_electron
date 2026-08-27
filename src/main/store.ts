import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Bookmark, ProgressEntry, Settings } from '@shared/types'

/**
 * Debounced, atomically-written JSON file. electron-store would do this too, but
 * it is ESM-only and this is 40 lines that unit-test without an Electron runtime.
 */
export class JsonStore<T extends object> {
  private data: T
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly file: string,
    private readonly defaults: T,
    private readonly debounceMs = 300
  ) {
    this.data = this.load()
  }

  private load(): T {
    try {
      const raw = readFileSync(this.file, 'utf8')
      // Shallow-merge so keys added in a later version get their default.
      return { ...this.defaults, ...(JSON.parse(raw) as T) }
    } catch {
      return { ...this.defaults }
    }
  }

  get(): T {
    return this.data
  }

  set(patch: Partial<T>): T {
    this.data = { ...this.data, ...patch }
    this.scheduleFlush()
    return this.data
  }

  private scheduleFlush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  /** Write now. Called on quit so nothing in the debounce window is lost. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const dir = dirname(this.file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }
}

export const DEFAULT_SETTINGS: Settings = {
  sources: [],
  activeSourceId: null,
  theme: 'system',
  volume: 0.8,
  rate: 1,
  autoplayNext: true,
  subtitlesEnabled: true,
  watchedRatio: 0.92
}

export interface LibraryData {
  progress: Record<string, ProgressEntry>
  bookmarks: Record<string, Bookmark[]>
  /** Encrypted (safeStorage) Google refresh token, base64. */
  gdriveToken: string | null
  gdriveEmail: string | null
}

export const DEFAULT_LIBRARY: LibraryData = {
  progress: {},
  bookmarks: {},
  gdriveToken: null,
  gdriveEmail: null
}

/**
 * Namespaced key so two sources can hold identically-named files. The separator
 * is NUL: the one byte that cannot appear in a filesystem path or a Drive id, so
 * "source A + path B" can never be confused with "source A' + path B'".
 */
export const KEY_SEPARATOR = String.fromCharCode(0)

export function libraryKey(sourceId: string, nodeId: string): string {
  return `${sourceId}${KEY_SEPARATOR}${nodeId}`
}

/** Watched once you are past `watchedRatio` of the duration. */
export function makeProgressEntry(
  position: number,
  duration: number,
  watchedRatio: number,
  previous?: ProgressEntry | null
): ProgressEntry {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const watched =
    previous?.watched === true ||
    (safeDuration > 0 && position / safeDuration >= watchedRatio)
  return {
    position: Math.max(0, Math.min(position, safeDuration || position)),
    duration: safeDuration,
    watched,
    updatedAt: Date.now()
  }
}
