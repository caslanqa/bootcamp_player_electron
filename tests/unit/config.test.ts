import { afterEach, describe, expect, it } from 'vitest'
import {
  DRIVE_SOURCE_ID,
  driveRoot,
  GDRIVE,
  isDriveConfigured,
  normalizeFolderId
} from '../../src/main/config'

const originalClientId = GDRIVE.clientId
const originalFolderId = GDRIVE.folderId

afterEach(() => {
  GDRIVE.clientId = originalClientId
  GDRIVE.folderId = originalFolderId
})

describe('isDriveConfigured', () => {
  it('is false until a client id is compiled in', () => {
    GDRIVE.clientId = ''
    expect(isDriveConfigured()).toBe(false)
    GDRIVE.clientId = '   '
    expect(isDriveConfigured()).toBe(false)
    GDRIVE.clientId = 'abc.apps.googleusercontent.com'
    expect(isDriveConfigured()).toBe(true)
  })
})

describe('DRIVE_SOURCE_ID', () => {
  it('is a fixed literal — progress keys depend on it never changing', () => {
    expect(DRIVE_SOURCE_ID).toBe('gdrive-course')
  })
})

describe('normalizeFolderId', () => {
  it('passes a bare id through', () => {
    expect(normalizeFolderId('1S_bC1BqGhFSuhktVhi8yXlOb03gEpxZf')).toBe(
      '1S_bC1BqGhFSuhktVhi8yXlOb03gEpxZf'
    )
  })

  it('extracts the id from a pasted Drive URL, account index and all', () => {
    expect(
      normalizeFolderId('https://drive.google.com/drive/u/1/folders/1S_bC1BqGhFSuhktVhi8yXlOb03gEpxZf')
    ).toBe('1S_bC1BqGhFSuhktVhi8yXlOb03gEpxZf')
    expect(normalizeFolderId('https://drive.google.com/drive/folders/abc123?usp=sharing')).toBe(
      'abc123'
    )
  })

  it('strips a query or fragment off a bare id', () => {
    expect(normalizeFolderId('abc123?usp=drive_link')).toBe('abc123')
    expect(normalizeFolderId('abc123#x')).toBe('abc123')
  })

  it('falls back to My Drive when empty', () => {
    expect(normalizeFolderId('')).toBe('root')
    expect(normalizeFolderId('   ')).toBe('root')
  })
})

describe('driveRoot', () => {
  it('normalises whatever the config holds', () => {
    GDRIVE.folderId = 'https://drive.google.com/drive/u/1/folders/xyz789'
    expect(driveRoot()).toBe('xyz789')
  })

  it('resolves the shipped course folder', () => {
    expect(driveRoot()).toBe('1S_bC1BqGhFSuhktVhi8yXlOb03gEpxZf')
  })
})

describe('shipped credentials', () => {
  it('carries a client id so students never see a form', () => {
    expect(isDriveConfigured()).toBe(true)
    expect(GDRIVE.clientId).toMatch(/\.apps\.googleusercontent\.com$/)
  })

  it('keeps the client secret out of the repository', () => {
    // Injected at build time; a committed GOCSPX- string would be scanned and revoked.
    expect(GDRIVE.clientSecret).not.toMatch(/^GOCSPX-/)
  })
})
