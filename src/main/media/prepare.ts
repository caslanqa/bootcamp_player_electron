import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaNode, PrepareMode, PrepareProgress } from '@shared/types'
import { buildFfmpegArgs, CACHE_VERSION, decide, parseFfmpegProgress, type Decision } from '@shared/codec'
import { extOf } from '@shared/media'
import { ffmpegPath, probe } from './ffmpeg'
import type { StorageProvider } from '../providers/types'

export interface PreparedMedia {
  mode: PrepareMode
  /** Set for remux/transcode: the ready-to-serve mp4 in the cache. */
  cacheKey: string | null
  durationSec?: number
}

export interface PreparerOptions {
  cacheDir: string
  /** URL an ffmpeg child can pull the original bytes from (remote sources). */
  rawUrl(sourceId: string, nodeId: string): string
  onProgress(p: PrepareProgress): void
  ffmpeg?: string
}

interface Job {
  child: ChildProcess | null
  cancelled: boolean
  promise: Promise<PreparedMedia> | null
}

/**
 * Turns anything into something a <video> element can play *and seek*:
 *   direct    — already web-native, stream the original bytes
 *   remux     — web-native codecs in a foreign container, `-c copy` into mp4 (seconds)
 *   transcode — re-encode only the offending stream into mp4 (slow, cached forever)
 *
 * ponytail: transcode-to-cache instead of live HLS. Costs an upfront wait on
 * exotic files, buys correct seeking and a single playback code path. Add an HLS
 * segmenter only if instant start on H.265 becomes a real complaint.
 */
export class MediaPreparer {
  private jobs = new Map<string, Job>()

  constructor(private readonly opts: PreparerOptions) {}

  cachePath(key: string): string {
    return join(this.opts.cacheDir, `${key}.mp4`)
  }

  async prepare(
    sourceId: string,
    provider: StorageProvider,
    node: MediaNode
  ): Promise<PreparedMedia> {
    // Local sources feed ffmpeg the file directly; remote ones go through our own proxy.
    const input = provider.localPath?.(node.id) ?? this.opts.rawUrl(sourceId, node.id)
    const info = await probe(input)
    const decision = decide(node.ext ?? extOf(node.name), info)

    if (decision.mode === 'direct') {
      return { mode: 'direct', cacheKey: null, durationSec: info.durationSec }
    }

    const key = cacheKey(sourceId, node)
    const out = this.cachePath(key)
    if (await isUsable(out)) {
      return { mode: decision.mode, cacheKey: key, durationSec: info.durationSec }
    }

    // Two double-clicks must not start two ffmpeg processes on the same file.
    const existing = this.jobs.get(key)
    if (existing?.promise) return existing.promise

    const job: Job = { child: null, cancelled: false, promise: null }
    job.promise = this.run(sourceId, node, key, out, decision, info.durationSec, input, job)
    this.jobs.set(key, job)
    try {
      return await job.promise
    } finally {
      this.jobs.delete(key)
    }
  }

  private async run(
    sourceId: string,
    node: MediaNode,
    key: string,
    out: string,
    decision: Decision,
    durationSec: number | undefined,
    input: string,
    job: Job
  ): Promise<PreparedMedia> {
    await mkdir(this.opts.cacheDir, { recursive: true })
    const partial = `${out}.part`
    await rm(partial, { force: true })

    const report = (percent: number, done: boolean, error?: string): void =>
      this.opts.onProgress({ sourceId, nodeId: node.id, mode: decision.mode, percent, done, error })

    report(0, false)

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.opts.ffmpeg ?? ffmpegPath, buildFfmpegArgs(input, partial, decision), {
          stdio: ['ignore', 'pipe', 'pipe']
        })
        job.child = child
        let stderr = ''

        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => {
          const { outTimeSec } = parseFfmpegProgress(chunk)
          if (outTimeSec === undefined) return
          const percent =
            durationSec && durationSec > 0
              ? Math.min(99, Math.round((outTimeSec / durationSec) * 100))
              : -1
          report(percent, false)
        })
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (chunk: string) => {
          stderr = (stderr + chunk).slice(-4000)
        })

        child.on('error', reject)
        child.on('close', (code) => {
          if (job.cancelled) reject(new Error('cancelled'))
          else if (code === 0) resolve()
          else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
        })
      })
    } catch (err) {
      await rm(partial, { force: true })
      report(0, true, (err as Error).message)
      throw err
    }

    await rename(partial, out)
    report(100, true)
    return { mode: decision.mode, cacheKey: key, durationSec }
  }

  cancel(sourceId: string, node: MediaNode): void {
    const job = this.jobs.get(cacheKey(sourceId, node))
    if (!job) return
    job.cancelled = true
    job.child?.kill('SIGKILL')
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) {
      job.cancelled = true
      job.child?.kill('SIGKILL')
    }
    this.jobs.clear()
  }
}

/** Size + mtime in the key: an edited source file re-converts instead of serving stale bytes. */
export function cacheKey(sourceId: string, node: MediaNode): string {
  return createHash('sha1')
    .update(`${CACHE_VERSION}|${sourceId}|${node.id}|${node.size ?? 0}|${node.modifiedAt ?? 0}`)
    .digest('hex')
}

async function isUsable(file: string): Promise<boolean> {
  if (!existsSync(file)) return false
  try {
    return (await stat(file)).size > 0
  } catch {
    return false
  }
}
