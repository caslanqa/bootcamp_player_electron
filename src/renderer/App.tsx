import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Player } from './components/Player'
import { Sidebar } from './components/Sidebar'
import { SettingsDialog } from './components/SettingsDialog'

export function App(): React.JSX.Element {
  const ready = useStore((s) => s.ready)
  const settings = useStore((s) => s.settings)
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const error = useStore((s) => s.error)
  const dismissError = useStore((s) => s.dismissError)
  const init = useStore((s) => s.init)

  const [showSidebar, setShowSidebar] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  // 'system' leaves the attribute off so prefers-color-scheme decides.
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Bootcamp Player</span>
        <button
          type="button"
          className="icon-btn"
          aria-pressed={showSidebar}
          onClick={() => setShowSidebar((v) => !v)}
          aria-label="Toggle playlist"
          title="Toggle playlist"
        >
          ☰
        </button>
        <label className="sr-only" htmlFor="search">
          Search lessons
        </label>
        <input
          id="search"
          className="search"
          data-testid="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search loaded lessons…"
        />
        <span className="spacer" />
        <button
          type="button"
          className="icon-btn"
          data-testid="open-settings"
          onClick={() => setShowSettings(true)}
          aria-label="Settings"
          title="Settings"
        >
          ⚙ Settings
        </button>
      </header>

      {error ? (
        <div className="error-bar" role="alert">
          <p data-testid="error">{error}</p>
          <button type="button" className="btn" onClick={dismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="main" data-sidebar={showSidebar ? 'shown' : 'hidden'}>
        {showSidebar ? <Sidebar /> : <span />}
        <Player />
      </div>

      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      {!ready ? <span className="sr-only">Loading settings…</span> : null}
    </div>
  )
}
