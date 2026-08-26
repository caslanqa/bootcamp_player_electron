import { describe, expect, it } from 'vitest'
import { buildFfmpegArgs, decide, parseFfmpegProgress } from '@shared/codec'

describe('decide', () => {
  it('streams web-native files untouched', () => {
    expect(decide('mp4', { videoCodec: 'h264', audioCodec: 'aac' })).toEqual({
      mode: 'direct',
      copyVideo: true,
      copyAudio: true
    })
    expect(decide('webm', { videoCodec: 'vp9', audioCodec: 'opus' }).mode).toBe('direct')
    expect(decide('mp3', { audioCodec: 'mp3' }).mode).toBe('direct')
  })

  it('only remuxes when the container is the sole problem', () => {
    const d = decide('mkv', { videoCodec: 'h264', audioCodec: 'aac' })
    expect(d).toEqual({ mode: 'remux', copyVideo: true, copyAudio: true })
  })

  it('transcodes just the offending stream', () => {
    expect(decide('mp4', { videoCodec: 'hevc', audioCodec: 'aac' })).toEqual({
      mode: 'transcode',
      copyVideo: false,
      copyAudio: true
    })
    expect(decide('mkv', { videoCodec: 'h264', audioCodec: 'ac3' })).toEqual({
      mode: 'transcode',
      copyVideo: true,
      copyAudio: false
    })
    expect(decide('avi', { videoCodec: 'mpeg4', audioCodec: 'mp3' })).toEqual({
      mode: 'transcode',
      copyVideo: false,
      copyAudio: true
    })
  })

  it('is case-insensitive about the extension', () => {
    expect(decide('MP4', { videoCodec: 'h264', audioCodec: 'aac' }).mode).toBe('direct')
  })
})

describe('buildFfmpegArgs', () => {
  it('copies both streams for a remux', () => {
    const args = buildFfmpegArgs('in.mkv', 'out.mp4', {
      mode: 'remux',
      copyVideo: true,
      copyAudio: true
    })
    expect(args.join(' ')).toContain('-c:v copy')
    expect(args.join(' ')).toContain('-c:a copy')
    expect(args).toContain('+faststart')
    expect(args[args.length - 1]).toBe('out.mp4')
    // The real output path ends in ".part", so the container must be explicit.
    expect(args.slice(-3, -1)).toEqual(['-f', 'mp4'])
  })

  it('re-encodes only what cannot be copied', () => {
    const args = buildFfmpegArgs('in.mkv', 'out.mp4', {
      mode: 'transcode',
      copyVideo: true,
      copyAudio: false
    }).join(' ')
    expect(args).toContain('-c:v copy')
    expect(args).toContain('-c:a aac')
    expect(args).not.toContain('libx264')
  })

  it('always asks for machine-readable progress', () => {
    const args = buildFfmpegArgs('a', 'b', { mode: 'remux', copyVideo: true, copyAudio: true })
    expect(args).toContain('-progress')
    expect(args).toContain('pipe:1')
  })
})

describe('parseFfmpegProgress', () => {
  it('reads out_time_us as seconds', () => {
    expect(parseFfmpegProgress('frame=10\nout_time_us=1500000\nprogress=continue\n')).toEqual({
      outTimeSec: 1.5,
      finished: false
    })
  })

  it('detects the end marker', () => {
    expect(parseFfmpegProgress('out_time_us=3000000\nprogress=end\n')).toEqual({
      outTimeSec: 3,
      finished: true
    })
  })

  it('ignores junk and negative timestamps', () => {
    expect(parseFfmpegProgress('garbage\nout_time_us=N/A\n')).toEqual({
      outTimeSec: undefined,
      finished: false
    })
  })
})
