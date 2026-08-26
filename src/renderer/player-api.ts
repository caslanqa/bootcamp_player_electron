import { createContext, useContext } from 'react'

/** Everything the control bar and the keyboard layer are allowed to do to the video. */
export interface PlayerApi {
  ready: boolean
  playing: boolean
  time: number
  duration: number
  buffered: number
  volume: number
  muted: boolean
  rate: number
  fill: boolean
  mini: boolean
  fullscreen: boolean
  pipSupported: boolean
  subtitleIndex: number

  toggle(): void
  seek(seconds: number): void
  skip(delta: number): void
  seekRatio(ratio: number): void
  setVolume(volume: number): void
  toggleMute(): void
  setRate(rate: number): void
  nudgeRate(delta: number): void
  setSubtitleIndex(index: number): void
  toggleFill(): void
  toggleMini(): void
  toggleFullscreen(): void
  togglePip(): void
}

export const PlayerContext = createContext<PlayerApi | null>(null)

export function usePlayer(): PlayerApi {
  const api = useContext(PlayerContext)
  if (!api) throw new Error('usePlayer must be used inside <Player>')
  return api
}

export const RATE_PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
export const MIN_RATE = 0.25
export const MAX_RATE = 4
