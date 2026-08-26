import { describe, expect, it } from 'vitest'
import {
  baseName,
  compareNodes,
  extOf,
  isAudioOnly,
  isMediaFile,
  isSubtitleFile,
  subtitleLabelFor
} from '@shared/media'

describe('extOf / baseName', () => {
  it('handles dotted names and extensionless files', () => {
    expect(extOf('01.Intro.To.Java.mp4')).toBe('mp4')
    expect(baseName('01.Intro.To.Java.mp4')).toBe('01.Intro.To.Java')
    expect(extOf('README')).toBe('')
    expect(extOf('.gitignore')).toBe('')
  })
})

describe('file classification', () => {
  it('recognises media and subtitles case-insensitively', () => {
    expect(isMediaFile('lesson.MP4')).toBe(true)
    expect(isMediaFile('lesson.mkv')).toBe(true)
    expect(isMediaFile('notes.txt')).toBe(false)
    expect(isSubtitleFile('lesson.SRT')).toBe(true)
    expect(isAudioOnly('podcast.mp3')).toBe(true)
    expect(isAudioOnly('lesson.mp4')).toBe(false)
  })
})

describe('subtitleLabelFor', () => {
  it('labels a bare sidecar and a language-tagged one', () => {
    expect(subtitleLabelFor('01 welcome.mp4', '01 welcome.srt')).toBe('Subtitles')
    expect(subtitleLabelFor('01 welcome.mp4', '01 welcome.tr.vtt')).toBe('tr')
  })

  it('rejects a subtitle for a different video', () => {
    expect(subtitleLabelFor('01 welcome.mp4', '02 setup.srt')).toBeNull()
    expect(subtitleLabelFor('intro.mp4', 'intro-part2.srt')).toBeNull()
  })
})

describe('compareNodes', () => {
  it('puts folders first', () => {
    const sorted = [
      { name: 'zeta.mp4', kind: 'media' },
      { name: 'alpha', kind: 'folder' }
    ].sort(compareNodes)
    expect(sorted.map((n) => n.name)).toEqual(['alpha', 'zeta.mp4'])
  })

  it('sorts numbers the way humans read them', () => {
    const names = ['10 last.mp4', '2 second.mp4', '1 first.mp4', '09 ninth.mp4']
    const sorted = names
      .map((name) => ({ name, kind: 'media' }))
      .sort(compareNodes)
      .map((n) => n.name)
    expect(sorted).toEqual(['1 first.mp4', '2 second.mp4', '09 ninth.mp4', '10 last.mp4'])
  })
})
