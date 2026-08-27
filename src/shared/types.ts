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


export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface UpdateInfo {
  /** The running version. */
  current: string
  available: boolean
  version?: string
  tag?: string
  notes?: string
  releaseUrl?: string
  /** The installer for this platform and architecture, when the release has one. */
  asset?: ReleaseAsset
  /** Set when the check itself failed — offline, rate-limited, no releases yet. */
  error?: string
}

export interface UpdateProgress {
  received: number
  total: number
  /** 0..100, -1 when the size is unknown. */
  percent: number
  done: boolean
}
