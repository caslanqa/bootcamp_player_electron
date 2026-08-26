import { useCallback, useEffect, useRef, useState } from 'react'
import { formatTime } from '@shared/time'
import { MAX_RATE, MIN_RATE, PlayerContext, type PlayerApi } from '../player-api'
import { useShortcuts } from '../hooks/useShortcuts'
import { useStore } from '../store'
import { Controls } from './Controls'
import { NotesPanel } from './NotesPanel'

const MODE_LABEL: Record<string, string> = {
  direct: 'direct stream',
  remux: 'remuxed',
  transcode: 'transcoded'
}

/** Skip the saved position when it is at the very start or effectively the end. */
const RESUME_MIN = 3
const RESUME_TAIL = 10

export function Player(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const resumeRef = useRef(0)
  const overlayTimer = useRef<number | null>(null)

  const current = useStore((s) => s.current)
  const preparing = useStore((s) => s.preparing)
  const settings = useStore((s) => s.settings)
  const saveProgress = useStore((s) => s.saveProgress)
  const step = useStore((s) => s.step)
  const patchSettings = useStore((s) => s.patchSettings)

  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolumeState] = useState(settings.volume)
  const [muted, setMuted] = useState(false)
  const [rate, setRateState] = useState(settings.rate)
  const [fill, setFill] = useState(false)
  const [mini, setMini] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [subtitleIndex, setSubtitleIndex] = useState(-1)
  const [overlay, setOverlay] = useState<'play' | 'pause' | null>(null)

  // Capture the resume point once per media item, before timeupdate overwrites it.
  useEffect(() => {
    if (!current) return
    resumeRef.current = useStore.getState().progress[current.node.id]?.position ?? 0
    setReady(false)
    setTime(0)
    setDuration(current.durationSec ?? 0)
    setBuffered(0)
    setSubtitleIndex(settings.subtitlesEnabled && current.subtitles.length > 0 ? 0 : -1)
  }, [current, settings.subtitlesEnabled])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    for (let i = 0; i < video.textTracks.length; i += 1) {
      video.textTracks[i].mode = i === subtitleIndex ? 'showing' : 'disabled'
    }
  }, [subtitleIndex, current])

  useEffect(() => {
    const onFullscreenChange = (): void => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const flashOverlay = useCallback((kind: 'play' | 'pause') => {
    setOverlay(kind)
    if (overlayTimer.current) window.clearTimeout(overlayTimer.current)
    overlayTimer.current = window.setTimeout(() => setOverlay(null), 800)
  }, [])

  const toggle = useCallback(() => {
    const video = videoRef.current
    if (!video || !current) return
    if (video.paused) {
      void video.play()
      flashOverlay('play')
    } else {
      video.pause()
      flashOverlay('pause')
    }
  }, [current, flashOverlay])

  const seek = useCallback((seconds: number) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) return
    video.currentTime = Math.max(0, Math.min(seconds, video.duration))
    setTime(video.currentTime)
  }, [])

  const api: PlayerApi = {
    ready,
    playing,
    time,
    duration,
    buffered,
    volume,
    muted,
    rate,
    fill,
    mini,
    fullscreen,
    pipSupported: typeof document !== 'undefined' && document.pictureInPictureEnabled,
    subtitleIndex,
    toggle,
    seek,
    skip: (delta) => seek(time + delta),
    seekRatio: (ratio) => seek(ratio * duration),
    setVolume: (next) => {
      const video = videoRef.current
      const clamped = Math.max(0, Math.min(1, next))
      setVolumeState(clamped)
      if (video) {
        video.volume = clamped
        video.muted = clamped === 0
      }
      void patchSettings({ volume: clamped })
    },
    toggleMute: () => {
      const video = videoRef.current
      if (!video) return
      video.muted = !video.muted
      setMuted(video.muted)
    },
    setRate: (next) => {
      const clamped = Math.max(MIN_RATE, Math.min(MAX_RATE, next))
      setRateState(clamped)
      if (videoRef.current) videoRef.current.playbackRate = clamped
      void patchSettings({ rate: clamped })
    },
    nudgeRate: (delta) => api.setRate(Number((rate + delta).toFixed(2))),
    setSubtitleIndex,
    toggleFill: () => setFill((f) => !f),
    toggleMini: () => {
      const next = !mini
      setMini(next)
      void window.api.win.setMini(next)
    },
    toggleFullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void wrapRef.current?.requestFullscreen()
    },
    togglePip: () => {
      const video = videoRef.current
      if (!video || !document.pictureInPictureEnabled) return
      if (document.pictureInPictureElement) void document.exitPictureInPicture()
      else void video.requestPictureInPicture()
    }
  }

  return (
    <PlayerContext.Provider value={api}>
      <section className="stage" aria-label="Player">
        <div className="video-wrap" ref={wrapRef} data-fill={fill}>
          {current ? (
            <video
              ref={videoRef}
              data-testid="video"
              src={current.url}
              crossOrigin="anonymous"
              preload="metadata"
              playsInline
              onClick={toggle}
              onLoadedMetadata={(e) => {
                const video = e.currentTarget
                setDuration(video.duration)
                video.volume = volume
                video.muted = muted
                video.playbackRate = rate
                if (
                  resumeRef.current > RESUME_MIN &&
                  resumeRef.current < video.duration - RESUME_TAIL
                ) {
                  video.currentTime = resumeRef.current
                }
                setReady(true)
                void video.play().catch(() => undefined)
              }}
              onTimeUpdate={(e) => {
                const video = e.currentTarget
                setTime(video.currentTime)
                saveProgress(video.currentTime, video.duration)
              }}
              onProgress={(e) => {
                const ranges = e.currentTarget.buffered
                setBuffered(ranges.length ? ranges.end(ranges.length - 1) : 0)
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
              onEnded={(e) => {
                const video = e.currentTarget
                saveProgress(video.duration, video.duration)
                setPlaying(false)
                if (settings.autoplayNext) void step(1)
              }}
              onError={() => {
                useStore
                  .getState()
                  .fail(`Playback failed for ${current.node.name}. The file may be corrupt.`)
              }}
            >
              {current.subtitles.map((sub, index) => (
                <track
                  key={sub.id}
                  kind="subtitles"
                  label={sub.label}
                  src={sub.url}
                  default={index === subtitleIndex}
                />
              ))}
            </video>
          ) : (
            <p className="stage-placeholder" data-testid="stage-placeholder">
              Pick a lesson from the playlist to start. Add a course folder or a Google Drive
              folder in Settings first.
            </p>
          )}

          <div className="overlay-icon" data-show={overlay !== null} aria-hidden="true">
            <span>{overlay === 'pause' ? '❚❚' : '▶'}</span>
          </div>

          {preparing && !preparing.done ? (
            <div className="prepare-toast" role="status" data-testid="prepare-toast">
              <span>
                {preparing.mode === 'remux' ? 'Repackaging' : 'Converting'}{' '}
                {preparing.percent >= 0 ? `${preparing.percent}%` : '…'}
              </span>
              <progress
                max={100}
                value={preparing.percent >= 0 ? preparing.percent : undefined}
              />
            </div>
          ) : null}
        </div>

        {current ? (
          <div className="controls">
            <div className="now-playing">
              <strong data-testid="now-playing">{current.node.name}</strong>
              <span className="mode">{MODE_LABEL[current.mode] ?? current.mode}</span>
              <span className="sr-only">
                {formatTime(time)} of {formatTime(duration)}
              </span>
            </div>
            <Controls />
          </div>
        ) : null}
        <NotesPanel />
        <Shortcuts />
      </section>
    </PlayerContext.Provider>
  )
}

/** Lives inside the provider so the key handler can reach the player API. */
function Shortcuts(): null {
  useShortcuts()
  return null
}
