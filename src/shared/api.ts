import type {
  Bookmark,
  DataSource,
  GDriveStatus,
  MediaNode,
  PrepareProgress,
  PrepareResult,
  ProgressEntry,
  Settings,
  UpdateInfo,
  UpdateProgress
} from './types'

/** The single surface the renderer is allowed to touch. Mirrored by the preload bridge. */
export interface Api {
  settings: {
    get(): Promise<Settings>
    patch(patch: Partial<Settings>): Promise<Settings>
  }
  sources: {
    add(source: Omit<DataSource, 'id'>): Promise<DataSource>
    remove(id: string): Promise<void>
    pickFolder(): Promise<string | null>
  }
  tree: {
    /** parentId omitted -> the source root. */
    list(sourceId: string, parentId?: string): Promise<MediaNode[]>
  }
  media: {
    prepare(sourceId: string, nodeId: string): Promise<PrepareResult>
    cancelPrepare(sourceId: string, nodeId: string): Promise<void>
    onPrepareProgress(cb: (p: PrepareProgress) => void): () => void
  }
  progress: {
    get(sourceId: string, nodeId: string): Promise<ProgressEntry | null>
    /** Main owns the watched/clamping rules and returns the stored entry. */
    set(
      sourceId: string,
      nodeId: string,
      position: number,
      duration: number
    ): Promise<ProgressEntry>
    many(sourceId: string, nodeIds: string[]): Promise<Record<string, ProgressEntry>>
    clear(sourceId: string, nodeId: string): Promise<void>
  }
  bookmarks: {
    list(sourceId: string, nodeId: string): Promise<Bookmark[]>
    add(sourceId: string, nodeId: string, time: number, note: string): Promise<Bookmark[]>
    remove(sourceId: string, nodeId: string, bookmarkId: string): Promise<Bookmark[]>
  }
  gdrive: {
    status(): Promise<GDriveStatus>
    /** `remember: false` keeps the token in memory for this session only. */
    signIn(options?: { remember?: boolean }): Promise<GDriveStatus>
    signOut(): Promise<GDriveStatus>
  }
  update: {
    /** Never rejects for offline or rate-limited; see UpdateInfo.error. */
    check(): Promise<UpdateInfo>
    /** Downloads the installer for this machine and returns its path. */
    download(): Promise<{ path: string; hint: string }>
    /** Hands the downloaded file to the OS installer. */
    install(): Promise<{ hint: string }>
    onProgress(cb: (p: UpdateProgress) => void): () => void
  }
  win: {
    /** Shrinks the OS window and pins it on top. HTML fullscreen is renderer-side. */
    setMini(on: boolean): Promise<boolean>
  }
}
