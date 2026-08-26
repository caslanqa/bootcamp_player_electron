import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProbeInfo } from '@shared/codec'

const execFileAsync = promisify(execFile)

/**
 * Bundled binaries live outside the asar (see asarUnpack in electron-builder.yml).
 * When the platform package is absent — cross-platform builds, or a dev machine
 * that skipped install scripts — fall back to whatever is on PATH.
 */
function resolveBin(pkg: string, fallback: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(pkg) as { path: string }
    return mod.path.replace('app.asar', 'app.asar.unpacked')
  } catch {
    return fallback
  }
}

export const ffmpegPath = resolveBin('@ffmpeg-installer/ffmpeg', 'ffmpeg')
export const ffprobePath = resolveBin('@ffprobe-installer/ffprobe', 'ffprobe')

interface FfprobeOutput {
  streams?: Array<{ codec_type?: string; codec_name?: string; duration?: string }>
  format?: { duration?: string }
}

/** First video + first audio codec and the duration. Input may be a path or an http URL. */
export async function probe(input: string, timeoutMs = 30_000): Promise<ProbeInfo> {
  const { stdout } = await execFileAsync(
    ffprobePath,
    [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      input
    ],
    { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }
  )
  const json = JSON.parse(stdout) as FfprobeOutput
  const streams = json.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  const rawDuration = json.format?.duration ?? video?.duration ?? audio?.duration
  const durationSec = rawDuration ? Number(rawDuration) : undefined

  return {
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    durationSec: Number.isFinite(durationSec) ? durationSec : undefined
  }
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync(ffmpegPath, ['-version'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}
