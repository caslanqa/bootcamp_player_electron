import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { LocalProvider } from '../../src/main/providers/local'
import { ProviderError } from '../../src/main/providers/types'
import { buildFixtures, FIXTURE_ROOT, type Fixtures } from '../helpers/fixtures'

let paths: Fixtures
let provider: LocalProvider

beforeAll(async () => {
  paths = await buildFixtures()
  provider = new LocalProvider(paths.course)
}, 180_000)

describe('LocalProvider.list', () => {
  it('returns folders first, then media, hiding everything else', async () => {
    const nodes = await provider.list()
    expect(nodes.map((n) => `${n.kind}:${n.name}`)).toEqual([
      'folder:01 Intro',
      'folder:02 Advanced',
      'folder:03 Long'
    ])
    expect(nodes.some((n) => n.name === 'notes.txt')).toBe(false)
    expect(nodes.some((n) => n.name === '.hidden.mp4')).toBe(false)
  })

  it('sorts numerically, not lexicographically', async () => {
    const nodes = await provider.list(paths.advanced)
    expect(nodes.map((n) => n.name)).toEqual(['09 ninth.mp4', '10 last.mp4', 'exotic.mkv'])
  })

  it('excludes subtitle sidecars from the playlist', async () => {
    const nodes = await provider.list(paths.intro)
    expect(nodes.map((n) => n.name)).toEqual(['01 welcome.mp4', '02 setup.mp4'])
  })

  it('reports a readable error for a missing directory', async () => {
    await expect(provider.list(join(paths.course, 'nope'))).rejects.toThrow(/Cannot read directory/)
  })
})

describe('LocalProvider.stat', () => {
  it('fills in size, mtime and extension', async () => {
    const node = await provider.stat(paths.welcome)
    expect(node?.kind).toBe('media')
    expect(node?.ext).toBe('mp4')
    expect(node?.size).toBeGreaterThan(0)
    expect(node?.modifiedAt).toBeGreaterThan(0)
  })

  it('returns null instead of throwing for a missing file', async () => {
    expect(await provider.stat(join(paths.course, 'ghost.mp4'))).toBeNull()
  })
})

describe('LocalProvider.read', () => {
  it('streams a byte range', async () => {
    const stream = await provider.read(paths.welcome, 0, 3)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const head = Buffer.concat(chunks)
    expect(head).toHaveLength(4)
    // Any mp4 starts with a box size followed by 'ftyp' at offset 4.
    const full = await provider.read(paths.welcome, 4, 7)
    const chunks2: Buffer[] = []
    for await (const chunk of full) chunks2.push(chunk as Buffer)
    expect(Buffer.concat(chunks2).toString('latin1')).toBe('ftyp')
  })
})

describe('LocalProvider.findSubtitles', () => {
  it('finds both the bare and the language-tagged sidecar', async () => {
    const subs = await provider.findSubtitles(paths.welcome)
    expect(subs.map((s) => s.name)).toEqual(['01 welcome.srt', '01 welcome.tr.vtt'])
  })

  it('does not attach another lesson subtitles', async () => {
    expect(await provider.findSubtitles(paths.setup)).toEqual([])
  })
})

describe('root containment', () => {
  it('refuses a path outside the configured root', async () => {
    const outside = join(FIXTURE_ROOT, 'outside-secret.txt')
    await expect(provider.stat(outside)).rejects.toThrow(ProviderError)
    await expect(provider.read(outside)).rejects.toThrow(/escapes source root/)
    await expect(provider.list(FIXTURE_ROOT)).rejects.toThrow(/escapes source root/)
  })

  it('refuses traversal through the root', async () => {
    await expect(provider.read(join(paths.course, '..', 'outside-secret.txt'))).rejects.toThrow(
      /escapes source root/
    )
  })
})
