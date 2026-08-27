import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReleaseAsset, UpdateInfo, UpdateProgress } from '@shared/types'

/**
 * Check GitHub Releases, download the installer for this machine, hand it to the
 * OS.
 *
 * Not electron-updater: on macOS that goes through Squirrel.Mac, which refuses
 * to install an update that is not signed with a Developer ID. These builds are
 * ad-hoc signed, so it would fail on the one platform this app is built for.
 *
 * A file we fetch ourselves also never gets the com.apple.quarantine flag —
 * only downloads that go through a browser do — so updating this way skips the
 * `xattr` dance a fresh install needs.
 */

interface GithubAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GithubRelease {
  tag_name: string
  name?: string
  body?: string
  html_url: string
  draft?: boolean
  prerelease?: boolean
  assets?: GithubAsset[]
}

/** `v1.2.3` and `1.2.3` both mean the same release. */
export function parseVersion(value: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Strictly newer, so a matching or older tag never prompts anyone. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/**
 * The one asset this machine can actually install. Names come from
 * electron-builder's artifactName, e.g. BootcampPlayer-1.1.0-arm64.dmg and
 * BootcampPlayer-Setup-1.1.0-x64.exe.
 */
export function pickAsset(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform,
  arch: string
): ReleaseAsset | null {
  const named = (suffix: string): ReleaseAsset[] =>
    assets.filter((a) => a.name.toLowerCase().endsWith(suffix))

  if (platform === 'darwin') {
    const dmgs = named('.dmg')
    const exact =
      dmgs.find((a) => a.name.includes(arch)) ?? dmgs.find((a) => /universal/i.test(a.name))
    if (exact) return exact

    // A dmg whose name carries no architecture is assumed to run anywhere. One
    // built for the *other* architecture is not: handing an arm64 dmg to an
    // Intel Mac only produces "bad CPU type in executable".
    const archless = dmgs.filter((a) => !/arm64|x64|x86_64|aarch64/i.test(a.name))
    return archless.length === 1 ? archless[0] : null
  }
  if (platform === 'win32') {
    const exes = named('.exe')
    // The NSIS installer upgrades in place; the portable exe would not.
    return exes.find((a) => /setup/i.test(a.name)) ?? null
  }
  if (platform === 'linux') {
    return named('.appimage')[0] ?? named('.deb')[0] ?? null
  }
  return null
}

export interface UpdaterOptions {
  /** "owner/repo" on GitHub. */
  repo: string
  currentVersion: string
  cacheDir: string
  platform?: NodeJS.Platform
  arch?: string
  fetchImpl?: typeof fetch
}

export class Updater {
  private readonly fetchImpl: typeof fetch
  private readonly platform: NodeJS.Platform
  private readonly arch: string

  constructor(private readonly opts: UpdaterOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.platform = opts.platform ?? process.platform
    this.arch = opts.arch ?? process.arch
  }

  /**
   * Never throws for the ordinary reasons — offline, rate-limited, no releases
   * yet. A failed check is not something to interrupt someone's lesson over.
   */
  async check(): Promise<UpdateInfo> {
    const current = this.opts.currentVersion
    const none: UpdateInfo = { current, available: false }

    let release: GithubRelease
    try {
      const res = await this.fetchImpl(
        `https://api.github.com/repos/${this.opts.repo}/releases/latest`,
        { headers: { Accept: 'application/vnd.github+json' } }
      )
      if (!res.ok) return { ...none, error: `GitHub answered ${res.status}` }
      release = (await res.json()) as GithubRelease
    } catch (err) {
      return { ...none, error: (err as Error).message }
    }

    if (release.draft || release.prerelease) return none
    const version = release.tag_name.replace(/^v/, '')
    if (!isNewer(version, current)) return none

    const assets: ReleaseAsset[] = (release.assets ?? []).map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      size: a.size
    }))

    return {
      current,
      available: true,
      version,
      tag: release.tag_name,
      notes: release.body?.trim() || undefined,
      releaseUrl: release.html_url,
      asset: pickAsset(assets, this.platform, this.arch) ?? undefined
    }
  }

  private filePath(asset: ReleaseAsset): string {
    return join(this.opts.cacheDir, asset.name)
  }

  /** Resumes nothing, but does skip a file that is already complete. */
  async download(
    asset: ReleaseAsset,
    onProgress: (p: UpdateProgress) => void
  ): Promise<string> {
    await mkdir(this.opts.cacheDir, { recursive: true })
    const target = this.filePath(asset)

    try {
      const existing = await stat(target)
      if (existing.size === asset.size) {
        onProgress({ received: asset.size, total: asset.size, percent: 100, done: true })
        return target
      }
      await unlink(target)
    } catch {
      // Not there yet, which is the normal case.
    }

    const res = await this.fetchImpl(asset.url)
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`)

    const total = Number(res.headers.get('content-length')) || asset.size
    let received = 0
    const partial = `${target}.part`

    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    source.on('data', (chunk: Buffer) => {
      received += chunk.length
      onProgress({
        received,
        total,
        percent: total > 0 ? Math.round((received / total) * 100) : -1,
        done: false
      })
    })

    try {
      await pipeline(source, createWriteStream(partial))
    } catch (err) {
      await unlink(partial).catch(() => undefined)
      throw err
    }

    await rename(partial, target)
    onProgress({ received: total, total, percent: 100, done: true })
    return target
  }

  /** What the user has to do after we hand the file over. */
  installHint(): string {
    if (this.platform === 'darwin') {
      return 'Quit Bootcamp Player, then drag the new version from the disk image into Applications, replacing the old one. No security prompt this time: a file the app downloaded itself is not quarantined.'
    }
    if (this.platform === 'win32') {
      return 'The installer will ask to close Bootcamp Player, then upgrade it in place.'
    }
    return 'Make the AppImage executable (chmod +x) and run it, or install the .deb with apt.'
  }
}
