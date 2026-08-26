import { useEffect } from 'react'
import { usePlayer } from '../player-api'
import { useStore } from '../store'

/** Typing in a field must never trigger a transport shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function useShortcuts(): void {
  const player = usePlayer()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (document.querySelector('dialog[open]')) return

      const step = useStore.getState().step
      const key = event.key

      switch (key) {
        case ' ':
        case 'k':
          player.toggle()
          break
        case 'j':
          player.skip(-10)
          break
        case 'l':
          player.skip(10)
          break
        case 'ArrowLeft':
          player.skip(-5)
          break
        case 'ArrowRight':
          player.skip(5)
          break
        case 'ArrowUp':
          player.setVolume(player.volume + 0.05)
          break
        case 'ArrowDown':
          player.setVolume(player.volume - 0.05)
          break
        case 'm':
          player.toggleMute()
          break
        case 'f':
          player.toggleFullscreen()
          break
        case 'i':
          player.togglePip()
          break
        case 'n':
          void step(1)
          break
        case 'p':
          void step(-1)
          break
        case '>':
        case '.':
          player.nudgeRate(0.25)
          break
        case '<':
        case ',':
          player.nudgeRate(-0.25)
          break
        default:
          // 0-9 jump to that tenth of the file, like every other player.
          if (/^[0-9]$/.test(key)) player.seekRatio(Number(key) / 10)
          else return
      }
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [player])
}
