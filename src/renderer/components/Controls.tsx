import { useMemo, useState } from 'react'
import { formatTime } from '@shared/time'
import { RATE_PRESETS, usePlayer } from '../player-api'
import { useStore } from '../store'
import { flatten, neighbourMedia } from '../lib/tree'

export function Controls(): React.JSX.Element {
  const player = usePlayer()
  const [showRemaining, setShowRemaining] = useState(false)

  const current = useStore((s) => s.current)
  const tree = useStore((s) => s.tree)
  const expanded = useStore((s) => s.expanded)
  const bookmarks = useStore((s) => s.bookmarks)
  const step = useStore((s) => s.step)
  const settings = useStore((s) => s.settings)
  const patchSettings = useStore((s) => s.patchSettings)

  const { hasPrev, hasNext } = useMemo(() => {
    if (!current) return { hasPrev: false, hasNext: false }
    const rows = flatten(tree, expanded)
    return {
      hasPrev: neighbourMedia(rows, current.node.id, -1) !== null,
      hasNext: neighbourMedia(rows, current.node.id, 1) !== null
    }
  }, [current, tree, expanded])

  const playedPercent = player.duration > 0 ? (player.time / player.duration) * 100 : 0
  const bufferedPercent = player.duration > 0 ? (player.buffered / player.duration) * 100 : 0

  return (
    <>
      <div className="scrub">
        <time dateTime={`PT${Math.round(player.time)}S`}>{formatTime(player.time)}</time>
        <div className="timeline">
          <div className="track" aria-hidden="true">
            <div className="buffered" style={{ width: `${bufferedPercent}%` }} />
            <div className="played" style={{ width: `${playedPercent}%` }} />
          </div>
          <div className="marks" aria-hidden="true">
            {bookmarks.map((b) => (
              <i
                key={b.id}
                style={{
                  left: `${player.duration > 0 ? (b.time / player.duration) * 100 : 0}%`
                }}
              />
            ))}
          </div>
          <input
            type="range"
            data-testid="seek"
            aria-label="Seek"
            min={0}
            max={Math.max(player.duration, 0.1)}
            step={0.1}
            value={player.time}
            onChange={(e) => player.seek(Number(e.currentTarget.value))}
          />
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setShowRemaining((v) => !v)}
          title="Toggle remaining time"
        >
          <time dateTime={`PT${Math.round(player.duration)}S`}>
            {showRemaining
              ? `-${formatTime(Math.max(0, player.duration - player.time))}`
              : formatTime(player.duration)}
          </time>
        </button>
      </div>

      <div className="button-row">
        <button
          type="button"
          className="icon-btn"
          onClick={() => void step(-1)}
          disabled={!hasPrev}
          aria-label="Previous lesson"
          title="Previous lesson (P)"
        >
          ⏮
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => player.skip(-10)}
          aria-label="Back 10 seconds"
          title="Back 10s (J)"
        >
          ↺10
        </button>
        <button
          type="button"
          className="play-btn"
          data-testid="play"
          onClick={player.toggle}
          aria-label={player.playing ? 'Pause' : 'Play'}
          aria-pressed={player.playing}
          title="Play / Pause (Space)"
        >
          {player.playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => player.skip(10)}
          aria-label="Forward 10 seconds"
          title="Forward 10s (L)"
        >
          10↻
        </button>
        <button
          type="button"
          className="icon-btn"
          data-testid="next"
          onClick={() => void step(1)}
          disabled={!hasNext}
          aria-label="Next lesson"
          title="Next lesson (N)"
        >
          ⏭
        </button>

        <span className="divider" aria-hidden="true" />

        <div className="volume">
          <button
            type="button"
            className="icon-btn"
            onClick={player.toggleMute}
            aria-label={player.muted ? 'Unmute' : 'Mute'}
            aria-pressed={player.muted}
            title="Mute (M)"
          >
            {player.muted || player.volume === 0 ? '🔇' : '🔊'}
          </button>
          <input
            type="range"
            aria-label="Volume"
            min={0}
            max={1}
            step={0.01}
            value={player.muted ? 0 : player.volume}
            onChange={(e) => player.setVolume(Number(e.currentTarget.value))}
          />
        </div>

        <label className="inline">
          <span className="sr-only">Playback speed</span>
          <select
            className="compact"
            data-testid="rate"
            value={String(player.rate)}
            onChange={(e) => player.setRate(Number(e.currentTarget.value))}
          >
            {[...new Set([...RATE_PRESETS, player.rate])]
              .sort((a, b) => a - b)
              .map((preset) => (
                <option key={preset} value={preset}>
                  {preset}×
                </option>
              ))}
          </select>
        </label>

        {current && current.subtitles.length > 0 ? (
          <label className="inline">
            <span className="sr-only">Subtitles</span>
            <select
              className="compact"
              data-testid="subtitles"
              value={String(player.subtitleIndex)}
              onChange={(e) => player.setSubtitleIndex(Number(e.currentTarget.value))}
            >
              <option value="-1">Subtitles off</option>
              {current.subtitles.map((sub, index) => (
                <option key={sub.id} value={index}>
                  {sub.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <span className="spacer" style={{ flex: 1 }} />

        <button
          type="button"
          className="icon-btn"
          onClick={() => void patchSettings({ autoplayNext: !settings.autoplayNext })}
          aria-pressed={settings.autoplayNext}
          aria-label="Autoplay next lesson"
          title="Autoplay next lesson"
        >
          Auto
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={player.toggleFill}
          aria-pressed={player.fill}
          aria-label="Fill screen"
          title="Fill / fit"
        >
          ⛶
        </button>
        {player.pipSupported ? (
          <button
            type="button"
            className="icon-btn"
            onClick={player.togglePip}
            aria-label="Picture in picture"
            title="Picture in picture (I)"
          >
            ⧉
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn"
          onClick={player.toggleMini}
          aria-pressed={player.mini}
          aria-label="Mini player"
          title="Mini player"
        >
          ▭
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={player.toggleFullscreen}
          aria-pressed={player.fullscreen}
          aria-label="Fullscreen"
          title="Fullscreen (F)"
        >
          ⤢
        </button>
      </div>
    </>
  )
}
