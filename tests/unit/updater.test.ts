import { describe, expect, it } from 'vitest'
import type { ReleaseAsset } from '@shared/types'
import { isNewer, parseVersion, pickAsset } from '../../src/main/updater'

const asset = (name: string): ReleaseAsset => ({ name, url: `https://x/${name}`, size: 1 })

describe('parseVersion', () => {
  it('accepts a tag with or without the v', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion(' v10.0.4 ')).toEqual([10, 0, 4])
  })

  it('returns null for anything else', () => {
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('v1.2')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('isNewer', () => {
  it('compares numerically, not as text', () => {
    expect(isNewer('1.10.0', '1.9.0')).toBe(true)
    expect(isNewer('1.9.0', '1.10.0')).toBe(false)
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
  })

  it('is false for the same version, so nobody is nagged', () => {
    expect(isNewer('1.1.0', '1.1.0')).toBe(false)
    expect(isNewer('v1.1.0', '1.1.0')).toBe(false)
  })

  it('is false for an older release', () => {
    expect(isNewer('1.0.0', '1.1.0')).toBe(false)
  })

  it('is false when either side is unparseable — never prompt on a guess', () => {
    expect(isNewer('nightly', '1.0.0')).toBe(false)
    expect(isNewer('1.1.0', 'unknown')).toBe(false)
  })
})

describe('pickAsset', () => {
  const release = [
    asset('BootcampPlayer-1.1.0-arm64.dmg'),
    asset('BootcampPlayer-1.1.0-arm64.zip'),
    asset('BootcampPlayer-Setup-1.1.0-x64.exe'),
    asset('BootcampPlayer-1.1.0-x64.exe'),
    asset('BootcampPlayer-1.1.0-x64.AppImage'),
    asset('BootcampPlayer-1.1.0-x64.deb')
  ]

  it('takes the dmg matching the Mac architecture', () => {
    expect(pickAsset(release, 'darwin', 'arm64')?.name).toBe('BootcampPlayer-1.1.0-arm64.dmg')
  })

  it('refuses a dmg built for the other Mac architecture', () => {
    expect(pickAsset(release, 'darwin', 'x64')).toBeNull()
  })

  it('accepts a universal dmg for either architecture', () => {
    const universal = [asset('BootcampPlayer-1.1.0-universal.dmg')]
    expect(pickAsset(universal, 'darwin', 'arm64')?.name).toContain('universal')
    expect(pickAsset(universal, 'darwin', 'x64')?.name).toContain('universal')
  })

  it('accepts a lone dmg when the name carries no arch', () => {
    expect(pickAsset([asset('BootcampPlayer-1.1.0.dmg')], 'darwin', 'arm64')?.name).toBe(
      'BootcampPlayer-1.1.0.dmg'
    )
  })

  it('prefers the Windows installer over the portable exe', () => {
    // The portable build cannot upgrade an installed copy.
    expect(pickAsset(release, 'win32', 'x64')?.name).toBe('BootcampPlayer-Setup-1.1.0-x64.exe')
  })

  it('returns null on Windows when only a portable exe exists', () => {
    expect(pickAsset([asset('BootcampPlayer-1.1.0-x64.exe')], 'win32', 'x64')).toBeNull()
  })

  it('prefers the AppImage on Linux, falling back to the deb', () => {
    expect(pickAsset(release, 'linux', 'x64')?.name).toBe('BootcampPlayer-1.1.0-x64.AppImage')
    expect(pickAsset([asset('x.deb')], 'linux', 'x64')?.name).toBe('x.deb')
  })

  it('returns null when the release has nothing for this machine', () => {
    expect(pickAsset([asset('notes.txt')], 'darwin', 'arm64')).toBeNull()
    expect(pickAsset([], 'linux', 'x64')).toBeNull()
  })
})
