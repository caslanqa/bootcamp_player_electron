import { useEffect, useState } from 'react'
import { useStore } from './store'
import { LoginScreen } from './components/LoginScreen'
import { Player } from './components/Player'
import { Sidebar } from './components/Sidebar'
import { SettingsDialog } from './components/SettingsDialog'

export function App(): React.JSX.Element {
  const ready = useStore((s) => s.ready)
  const settings = useStore((s) => s.settings)
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const error = useStore((s) => s.error)
  const driveStatus = useStore((s) => s.driveStatus)
  const loginSkipped = useStore((s) => s.loginSkipped)
  const skipLogin = useStore((s) => s.skipLogin)
  const dismissError = useStore((s) => s.dismissError)
  const update = useStore((s) => s.update)
  const checkForUpdate = useStore((s) => s.checkForUpdate)
  const init = useStore((s) => s.init)

  const [showSidebar, setShowSidebar] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  // One quiet check a few seconds in, so a slow or rate-limited GitHub never
  // delays the window appearing. Failures land in the Updates panel, not a modal.
  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => void checkForUpdate(), 4000)
    return () => window.clearTimeout(timer)
  }, [ready, checkForUpdate])

  // 'system' leaves the attribute off so prefers-color-scheme decides.
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

  // Sign-in gate: skipped once the user has signed in, chosen a local folder,
  // or already has a source configured from an earlier run.
  const needsLogin =
    ready && !loginSkipped && !driveStatus?.signedIn && settings.sources.length === 0

  if (needsLogin) {
    return (
      <LoginScreen
        onUseLocalFolder={() => {
          skipLogin()
          setShowSettings(true)
        }}
      />
    )
  }

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
        {update?.available ? (
          <button
            type="button"
            className="icon-btn update-badge"
            data-testid="update-badge"
            onClick={() => setShowSettings(true)}
            title={`Version ${update.version} is available`}
          >
            ↑ Update to {update.version}
          </button>
        ) : null}
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
