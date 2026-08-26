import { describe, expect, it } from 'vitest'
import { decodeId, encodeId, parseRange } from '../../src/main/server'

describe('parseRange', () => {
  it('returns null when the client wants the whole file', () => {
    expect(parseRange(undefined, 1000)).toBeNull()
  })

  it('parses an open-ended range', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('parses a closed range and clamps the end', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('handles suffix ranges', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('rejects unsatisfiable and malformed ranges', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid')
    expect(parseRange('bytes=800-200', 1000)).toBe('invalid')
    expect(parseRange('bytes=-0', 1000)).toBe('invalid')
    expect(parseRange('bytes=-', 1000)).toBe('invalid')
    expect(parseRange('items=0-10', 1000)).toBe('invalid')
  })

  it('ignores ranges when the size is unknown', () => {
    expect(parseRange('bytes=0-10', 0)).toBeNull()
  })
})

describe('id encoding', () => {
  it('round-trips absolute paths and unicode', () => {
    for (const id of ['/Volumes/SSD/kurs/01 Giriş.mp4', 'C:\\kurs\\a+b/c?d.mp4', '1AbC_dEf-gH']) {
      expect(decodeId(encodeId(id))).toBe(id)
    }
  })

  it('produces URL-safe output', () => {
    expect(encodeId('/a/b c/ışık.mp4')).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
