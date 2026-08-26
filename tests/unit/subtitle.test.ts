import { describe, expect, it } from 'vitest'
import { srtToVtt, toVtt } from '@shared/subtitle'

const SRT = '1\r\n00:00:00,500 --> 00:00:02,000\r\nHello there\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nSecond\r\n'

describe('srtToVtt', () => {
  it('adds the header and swaps the decimal separator', () => {
    const vtt = srtToVtt(SRT)
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('00:00:00.500 --> 00:00:02.000')
    expect(vtt).not.toContain(',500')
  })

  it('normalises CRLF and strips a BOM', () => {
    const vtt = srtToVtt('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n')
    expect(vtt).not.toContain('\r')
    expect(vtt).not.toContain('﻿')
  })

  it('keeps cue text intact', () => {
    expect(srtToVtt(SRT)).toContain('Second')
  })
})

describe('toVtt', () => {
  it('passes real VTT through', () => {
    const input = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n'
    expect(toVtt('vtt', input)).toBe(input)
  })

  it('adds a header to a VTT file that is missing one', () => {
    expect(toVtt('vtt', '00:00:01.000 --> 00:00:02.000\nHi\n').startsWith('WEBVTT')).toBe(true)
  })

  it('converts srt', () => {
    expect(toVtt('SRT', SRT)).toContain('00:00:00.500')
  })
})
