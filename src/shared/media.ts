export const VIDEO_EXT = [
  'mp4', 'm4v', 'webm', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'ts', 'mpg', 'mpeg', 'ogv', '3gp'
] as const

export const AUDIO_EXT = [
  'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma'
] as const

export const SUBTITLE_EXT = ['srt', 'vtt'] as const

const MEDIA = new Set<string>([...VIDEO_EXT, ...AUDIO_EXT])
const SUBS = new Set<string>(SUBTITLE_EXT)

/** Lowercase extension without the dot, '' when there is none. */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function baseName(name: string): string {
  const i = name.lastIndexOf('.')
  return i <= 0 ? name : name.slice(0, i)
}

export function isMediaFile(name: string): boolean {
  return MEDIA.has(extOf(name))
}

export function isSubtitleFile(name: string): boolean {
  return SUBS.has(extOf(name))
}

export function isAudioOnly(name: string): boolean {
  return (AUDIO_EXT as readonly string[]).includes(extOf(name))
}

/**
 * "video.tr.srt" next to "video.mp4" -> label "tr". Bare "video.srt" -> label "Subtitles".
 * Returns null when the subtitle does not belong to the given media file.
 */
export function subtitleLabelFor(mediaName: string, subtitleName: string): string | null {
  const base = baseName(mediaName)
  const subBase = baseName(subtitleName)
  if (subBase === base) return 'Subtitles'
  if (subBase.startsWith(base + '.')) return subBase.slice(base.length + 1)
  return null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then natural-sorted names so "2. Lesson" lands before "10. Lesson". */
export function compareNodes(
  a: { name: string; kind: string },
  b: { name: string; kind: string }
): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  return collator.compare(a.name, b.name)
}
