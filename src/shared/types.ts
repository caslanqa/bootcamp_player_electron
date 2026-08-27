export type SourceType = 'local' | 'gdrive'

export interface DataSource {
  id: string
  name: string
  type: SourceType
  /** local: absolute directory path. gdrive: folder id ('root' = My Drive). */
  root: string
}

export type NodeKind = 'folder' | 'media'

export interface MediaNode {
  /** Provider-scoped id. local: absolute path. gdrive: file id. */
  id: string
  name: string
  kind: NodeKind
  /** Media only. */
  ext?: string
  size?: number
  /** Epoch ms. */
  modifiedAt?: number
}

export type ThemeSetting = 'dark' | 'light' | 'system'

export interface GDriveCredentials {
  clientId: string
  clientSecret: string
}

export interface Settings {
  sources: DataSource[]
  activeSourceId: string | null
  theme: ThemeSetting
  volume: number
  rate: number
  autoplayNext: boolean
  subtitlesEnabled: boolean
  /** Seconds of playback after which an item counts as watched (as a ratio of duration). */
  watchedRatio: number
}

export interface ProgressEntry {
  /** Last playback position in seconds. */
  position: number
  duration: number
  watched: boolean
  updatedAt: number
}

export interface Bookmark {
  id: string
  time: number
  note: string
  createdAt: number
}

export type PrepareMode = 'direct' | 'remux' | 'transcode'

export interface SubtitleTrack {
  id: string
  label: string
  url: string
}

export interface PrepareResult {
  /** URL to feed straight into a <video> element. */
  url: string
  mode: PrepareMode
  durationSec?: number
  subtitles: SubtitleTrack[]
}

export interface PrepareProgress {
  sourceId: string
  nodeId: string
  mode: PrepareMode
  /** 0..100, -1 when unknown. */
  percent: number
  done: boolean
  error?: string
}

export interface GDriveStatus {
  configured: boolean
  signedIn: boolean
  email?: string
}

/** One entry in the course folder's Drive access list. */
export interface AccessEntry {
  /** Drive permission id — what revoke() needs. */
  id: string
  email: string | null
  name: string | null
  /** owner | organizer | fileOrganizer | writer | commenter | reader */
  role: string
  isOwner: boolean
  /** True for the account currently signed in. */
  isSelf: boolean
}

export interface AdminStatus {
  /** The signed-in account owns the course folder. */
  isAdmin: boolean
  /** Drive write scope granted, so grant/revoke can actually be called. */
  canManage: boolean
}
