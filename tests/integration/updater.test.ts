import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Updater } from '../../src/main/updater'

const REPO = 'caslanqa/bootcamp_player_electron'

const release = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  tag_name: 'v1.2.0',
  html_url: 'https://github.com/caslanqa/bootcamp_player_electron/releases/tag/v1.2.0',
  body: '### Features\n\n- something good',
  assets: [
    {
      name: 'BootcampPlayer-1.2.0-arm64.dmg',
      browser_download_url: 'https://x/dmg',
      size: 11
    }
  ],
  ...over
})

function fake(handler: (url: URL) => Response): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const impl = (async (input: string | URL) => {
    urls.push(String(input))
    return handler(new URL(String(input)))
  }) as typeof fetch
  return { impl, urls }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const updater = (impl: typeof fetch, current = '1.1.0'): Updater =>
  new Updater({
    repo: REPO,
    currentVersion: current,
    cacheDir: mkdtempSync(join(tmpdir(), 'bootcamp-upd-')),
    platform: 'darwin',
    arch: 'arm64',
    fetchImpl: impl
  })

describe('check', () => {
  it('reports a newer release with its asset and notes', async () => {
    const { impl, urls } = fake(() => json(release()))
    const info = await updater(impl).check()

    expect(urls[0]).toBe(`https://api.github.com/repos/${REPO}/releases/latest`)
    expect(info).toMatchObject({
      current: '1.1.0',
      available: true,
      version: '1.2.0',
      tag: 'v1.2.0'
    })
    expect(info.asset?.name).toBe('BootcampPlayer-1.2.0-arm64.dmg')
    expect(info.notes).toContain('something good')
  })

  it('says nothing is available when the tag matches the running version', async () => {
    const { impl } = fake(() => json(release()))
    expect(await updater(impl, '1.2.0').check()).toEqual({ current: '1.2.0', available: false })
  })

  it('ignores an older tag', async () => {
    const { impl } = fake(() => json(release({ tag_name: 'v1.0.0' })))
    expect((await updater(impl, '1.1.0').check()).available).toBe(false)
  })

  it('ignores drafts and pre-releases', async () => {
    const draft = fake(() => json(release({ draft: true })))
    expect((await updater(draft.impl).check()).available).toBe(false)
    const pre = fake(() => json(release({ prerelease: true })))
    expect((await updater(pre.impl).check()).available).toBe(false)
  })

  it('reports available with no asset when the release has none for this machine', async () => {
    const { impl } = fake(() => json(release({ assets: [{ name: 'notes.txt', browser_download_url: 'https://x/n', size: 1 }] })))
    const info = await updater(impl).check()
    expect(info.available).toBe(true)
    expect(info.asset).toBeUndefined()
    // The UI can still offer the release page.
    expect(info.releaseUrl).toContain('/releases/tag/v1.2.0')
  })

  it('never throws when GitHub is unhappy — it reports the reason', async () => {
    const rateLimited = fake(() => new Response('rate limited', { status: 403 }))
    expect(await updater(rateLimited.impl).check()).toMatchObject({
      available: false,
      error: 'GitHub answered 403'
    })
  })

  it('never throws when the network is down', async () => {
    const offline = (async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }) as unknown as typeof fetch
    expect(await updater(offline).check()).toMatchObject({
      available: false,
      error: 'getaddrinfo ENOTFOUND'
    })
  })

  it('reports no update for a repository with no releases yet', async () => {
    const { impl } = fake(() => new Response('Not Found', { status: 404 }))
    expect((await updater(impl).check()).available).toBe(false)
  })
})

describe('download', () => {
  const asset = { name: 'BootcampPlayer-1.2.0-arm64.dmg', url: 'https://x/dmg', size: 11 }

  it('writes the file and reports progress that ends at 100', async () => {
    const { impl } = fake(() => new Response('hello world', { headers: { 'Content-Length': '11' } }))
    const subject = updater(impl)
    const seen: number[] = []

    const path = await subject.download(asset, (p) => seen.push(p.percent))
    expect(readFileSync(path, 'utf8')).toBe('hello world')
    expect(seen.at(-1)).toBe(100)
    expect(path.endsWith(asset.name)).toBe(true)
  })

  it('leaves no .part file behind', async () => {
    const { impl } = fake(() => new Response('hello world', { headers: { 'Content-Length': '11' } }))
    const path = await updater(impl).download(asset, () => undefined)
    expect(() => readFileSync(`${path}.part`)).toThrow()
  })

  it('reuses a complete download instead of fetching again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootcamp-upd-'))
    writeFileSync(join(dir, asset.name), 'hello world')
    const { impl, urls } = fake(() => new Response('should not be needed'))

    const subject = new Updater({
      repo: REPO,
      currentVersion: '1.1.0',
      cacheDir: dir,
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: impl
    })
    await subject.download(asset, () => undefined)
    expect(urls).toEqual([])
  })

  it('re-downloads a file whose size does not match', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootcamp-upd-'))
    writeFileSync(join(dir, asset.name), 'truncated')
    const { impl, urls } = fake(() => new Response('hello world', { headers: { 'Content-Length': '11' } }))

    const subject = new Updater({
      repo: REPO,
      currentVersion: '1.1.0',
      cacheDir: dir,
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: impl
    })
    const path = await subject.download(asset, () => undefined)
    expect(urls).toEqual(['https://x/dmg'])
    expect(readFileSync(path, 'utf8')).toBe('hello world')
  })

  it('surfaces a failed download', async () => {
    const { impl } = fake(() => new Response('gone', { status: 404 }))
    await expect(updater(impl).download(asset, () => undefined)).rejects.toThrow(
      /Download failed: 404/
    )
  })
})

describe('installHint', () => {
  it('tells each platform what to do next', () => {
    const opts = { repo: REPO, currentVersion: '1.0.0', cacheDir: tmpdir() }
    expect(new Updater({ ...opts, platform: 'darwin' }).installHint()).toMatch(/drag/i)
    // The point of downloading it ourselves: no Gatekeeper prompt afterwards.
    expect(new Updater({ ...opts, platform: 'darwin' }).installHint()).toMatch(/not quarantined/i)
    expect(new Updater({ ...opts, platform: 'win32' }).installHint()).toMatch(/installer/i)
    expect(new Updater({ ...opts, platform: 'linux' }).installHint()).toMatch(/AppImage/)
  })
})
