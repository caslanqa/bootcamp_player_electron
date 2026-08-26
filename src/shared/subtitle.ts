/**
 * SubRip -> WebVTT. <track> only accepts VTT, and the two formats differ by
 * a header, a decimal separator and CRLF, so a rewrite beats a real parser.
 */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/(\d{1,3}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2')
    // VTT wants no positioning junk that SRT sometimes carries.
    .replace(/^(\d{1,3}:\d{2}:\d{2}\.\d{1,3} --> \d{1,3}:\d{2}:\d{2}\.\d{1,3}).*$/gm, '$1')
    .trim()
  return `WEBVTT\n\n${body}\n`
}

/** Passthrough for .vtt, conversion for .srt. */
export function toVtt(ext: string, text: string): string {
  if (ext.toLowerCase() === 'vtt') {
    return text.replace(/^﻿/, '').trimStart().startsWith('WEBVTT')
      ? text.replace(/^﻿/, '')
      : `WEBVTT\n\n${text.replace(/^﻿/, '')}`
  }
  return srtToVtt(text)
}
