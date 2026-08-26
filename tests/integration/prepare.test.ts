import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { MediaNode, PrepareProgress } from '@shared/types'
import { MediaPreparer, cacheKey } from '../../src/main/media/prepare'
import { LocalProvider } from '../../src/main/providers/local'
import { buildFixtures, ffmpegUsable, probeCodecs, type Fixtures } from '../helpers/fixtures'

const SOURCE_ID = 'src'
const HAS_FFMPEG = await ffmpegUsable()

let paths: Fixtures
let provider: LocalProvider

beforeAll(async () => {
  if (!HAS_FFMPEG) return
  paths = await buildFixtures()
  provider = new LocalProvider(paths.course)
}, 180_000)

function makePreparer(
  events: PrepareProgress[] = [],
  cacheDir = mkdtempSync(join(tmpdir(), 'bootcamp-prepare-')),
  ffmpeg?: string
): MediaPreparer {
  return new MediaPreparer({
    cacheDir,
    rawUrl: (sourceId, nodeId) => `http://127.0.0.1:1/raw/${sourceId}/${nodeId}`,
    onProgress: (p) => events.push(p),
    ffmpeg
  })
}

describe.runIf(HAS_FFMPEG)('MediaPreparer', () => {
  it('streams a web-native mp4 without touching ffmpeg', async () => {
    const node = (await provider.stat(paths.welcome)) as MediaNode
    const result = await makePreparer().prepare(SOURCE_ID, provider, node)
    expect(result).toMatchObject({ mode: 'direct', cacheKey: null })
    expect(result.durationSec).toBeGreaterThan(2)
  })

  it('remuxes an mkv into a seekable mp4 and reports progress', async () => {
    const events: PrepareProgress[] = []
    const preparer = makePreparer(events)
    const node = (await provider.stat(paths.exoticMkv)) as MediaNode

    const result = await preparer.prepare(SOURCE_ID, provider, node)
    expect(result.mode).toBe('remux')
    expect(result.cacheKey).toBe(cacheKey(SOURCE_ID, node))

    const output = preparer.cachePath(result.cacheKey!)
    expect(existsSync(output)).toBe(true)
    const probed = await probeCodecs(output)
    expect(probed.container).toContain('mp4')
    // A remux copies the stream, so the codec must be unchanged.
    expect(probed.video).toBe('h264')

    expect(events[0]).toMatchObject({ mode: 'remux', done: false })
    expect(events.at(-1)).toMatchObject({ percent: 100, done: true })
    expect(events.some((e) => e.error)).toBe(false)
  })

  it('reuses the cached file on a later call', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'bootcamp-reuse-'))
    const node = (await provider.stat(paths.exoticMkv)) as MediaNode

    const first = await makePreparer([], cacheDir).prepare(SOURCE_ID, provider, node)
    expect(existsSync(makePreparer([], cacheDir).cachePath(first.cacheKey!))).toBe(true)

    const events: PrepareProgress[] = []
    const second = await makePreparer(events, cacheDir).prepare(SOURCE_ID, provider, node)
    expect(second.cacheKey).toBe(first.cacheKey)
    // Cache hit: no conversion, therefore no progress events at all.
    expect(events).toEqual([])
  })

  it('collapses two concurrent requests into one conversion', async () => {
    const events: PrepareProgress[] = []
    const preparer = makePreparer(events)
    const node = (await provider.stat(paths.exoticMkv)) as MediaNode

    const [a, b] = await Promise.all([
      preparer.prepare(SOURCE_ID, provider, node),
      preparer.prepare(SOURCE_ID, provider, node)
    ])
    expect(a.cacheKey).toBe(b.cacheKey)
    expect(events.filter((e) => e.done && e.percent === 100)).toHaveLength(1)
  })

  it('keys the cache on source, size and mtime so edits invalidate it', async () => {
    const node = (await provider.stat(paths.exoticMkv)) as MediaNode
    const edited: MediaNode = { ...node, modifiedAt: (node.modifiedAt ?? 0) + 1000 }
    expect(cacheKey(SOURCE_ID, edited)).not.toBe(cacheKey(SOURCE_ID, node))
    expect(cacheKey('other-source', node)).not.toBe(cacheKey(SOURCE_ID, node))
  })

  it('surfaces a conversion failure and leaves no partial file behind', async () => {
    const events: PrepareProgress[] = []
    const cacheDir = mkdtempSync(join(tmpdir(), 'bootcamp-fail-'))
    const broken = makePreparer(events, cacheDir, join(tmpdir(), 'definitely-not-ffmpeg'))
    const node = (await provider.stat(paths.exoticMkv)) as MediaNode

    await expect(broken.prepare(SOURCE_ID, provider, node)).rejects.toThrow()
    expect(events.some((e) => e.error)).toBe(true)
    expect(existsSync(`${broken.cachePath(cacheKey(SOURCE_ID, node))}.part`)).toBe(false)
  })
})
