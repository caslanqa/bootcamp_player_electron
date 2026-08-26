import { describe, expect, it } from 'vitest'
import { formatTime, parseTimestamp } from '@shared/time'

describe('formatTime', () => {
  it('uses mm:ss below an hour', () => {
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(9)).toBe('00:09')
    expect(formatTime(61)).toBe('01:01')
    expect(formatTime(3599)).toBe('59:59')
  })

  it('adds hours only when needed', () => {
    expect(formatTime(3600)).toBe('1:00:00')
    expect(formatTime(7325)).toBe('2:02:05')
  })

  it('never renders NaN or negatives', () => {
    expect(formatTime(NaN)).toBe('00:00')
    expect(formatTime(Infinity)).toBe('00:00')
    expect(formatTime(-5)).toBe('00:00')
  })
})

describe('parseTimestamp', () => {
  it('accepts both separators', () => {
    expect(parseTimestamp('00:00:02,500')).toBe(2.5)
    expect(parseTimestamp('01:02:03.250')).toBe(3723.25)
  })

  it('pads short millisecond fields', () => {
    expect(parseTimestamp('00:00:01.5')).toBe(1.5)
  })

  it('returns NaN for garbage', () => {
    expect(parseTimestamp('nope')).toBeNaN()
  })
})
