import type { PrepareMode } from './types'

/**
 * Bump when buildFfmpegArgs changes so stale cache entries are regenerated
 * instead of silently reused.
 */
export const CACHE_VERSION = 1

/** Containers Chromium can demux. */
const WEB_CONTAINERS = new Set([
  'mp4', 'm4v', 'webm', 'ogg', 'ogv', 'mp3', 'm4a', 'wav', 'flac', 'oga', 'opus'
])

const WEB_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora'])

const WEB_AUDIO_CODECS = new Set([
  'aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le'
])

export interface ProbeInfo {
  videoCodec?: string
  audioCodec?: string
  durationSec?: number
}

export interface Decision {
  mode: PrepareMode
  copyVideo: boolean
  copyAudio: boolean
}

/**
 * Pick the cheapest path to something a <video> element will actually play:
 * stream as-is, remux the container, or re-encode the offending stream(s).
 */
export function decide(ext: string, info: ProbeInfo): Decision {
  const copyVideo = !info.videoCodec || WEB_VIDEO_CODECS.has(info.videoCodec)
  const copyAudio = !info.audioCodec || WEB_AUDIO_CODECS.has(info.audioCodec)
  const containerOk = WEB_CONTAINERS.has(ext.toLowerCase())

  let mode: PrepareMode
  if (copyVideo && copyAudio) mode = containerOk ? 'direct' : 'remux'
  else mode = 'transcode'

  return { mode, copyVideo, copyAudio }
}

/**
 * ffmpeg invocation for remux/transcode into a seekable, faststart mp4.
 * `-progress pipe:1` gives machine-readable progress on stdout.
 */
export function buildFfmpegArgs(input: string, output: string, d: Decision): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input]

  if (d.copyVideo) args.push('-c:v', 'copy')
  else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p')

  if (d.copyAudio) args.push('-c:a', 'copy')
  else args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2')

  // Drop anything mp4 cannot hold (image-based subs, data streams) rather than failing.
  args.push('-sn', '-dn', '-map_metadata', '-1')
  args.push('-movflags', '+faststart')
  args.push('-progress', 'pipe:1', '-nostats')
  // The output is written as "<key>.mp4.part", so ffmpeg cannot infer mp4 from
  // the extension — say it explicitly.
  args.push('-f', 'mp4', output)
  return args
}

/** Parse the `key=value` block stream that `-progress pipe:1` emits. */
export function parseFfmpegProgress(chunk: string): { outTimeSec?: number; finished: boolean } {
  let outTimeSec: number | undefined
  let finished = false
  for (const line of chunk.split(/\r?\n/)) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key === 'out_time_us' || key === 'out_time_ms') {
      // ffmpeg reports out_time_ms in microseconds too — same scale as out_time_us.
      const n = Number(value)
      if (Number.isFinite(n) && n >= 0) outTimeSec = n / 1_000_000
    } else if (key === 'progress' && value === 'end') {
      finished = true
    }
  }
  return { outTimeSec, finished }
}
