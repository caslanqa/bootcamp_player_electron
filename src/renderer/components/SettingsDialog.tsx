import { useEffect, useRef, useState } from 'react'
import type { GDriveStatus, ThemeSetting } from '@shared/types'
import { useStore } from '../store'
import { AdminPanel } from './AdminPanel'

interface Props {
  open: boolean
  onClose(): void
}

const SHORTCUTS: Array<[string, string]> = [
  ['Space / K', 'Play / pause'],
  ['J / L', 'Back / forward 10s'],
  ['← / →', 'Back / forward 5s'],
  ['↑ / ↓', 'Volume'],
  ['0–9', 'Jump to 0–90%'],
  ['N / P', 'Next / previous lesson'],
  ['< / >', 'Slower / faster'],
  ['M', 'Mute'],
  ['F', 'Fullscreen'],
  ['I', 'Picture in picture']
]

export function SettingsDialog({ open, onClose }: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const settings = useStore((s) => s.settings)
  const patchSettings = useStore((s) => s.patchSettings)
  const addSource = useStore((s) => s.addSource)
  const reloadSources = useStore((s) => s.reloadSources)
  const signOutOfGoogle = useStore((s) => s.signOutOfGoogle)
  const removeSource = useStore((s) => s.removeSource)
  const fail = useStore((s) => s.fail)

  const [localPath, setLocalPath] = useState('')
  const [localName, setLocalName] = useState('')
  const [drive, setDrive] = useState<GDriveStatus>({ configured: false, signedIn: false })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    void window.api.gdrive.status().then(setDrive)
  }, [open])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      fail((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} data-testid="settings-dialog">
      <div className="dialog-head">
        <h2>Settings</h2>
      </div>

      <div className="dialog-body">
        <fieldset>
          <legend>Data sources</legend>
          {settings.sources.length === 0 ? (
            <p className="hint">Nothing configured yet.</p>
          ) : (
            <ul className="source-list">
              {settings.sources.map((source) => (
                <li key={source.id}>
                  <div className="meta">
                    <strong>{source.name}</strong>
                    <small>
                      {source.type === 'local' ? source.root : `Drive folder ${source.root}`}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => void removeSource(source.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="field">
            <label htmlFor="local-path">Local folder (SSD, NAS, mounted drive)</label>
            <div className="inline">
              <input
                id="local-path"
                data-testid="local-path"
                value={localPath}
                onChange={(e) => setLocalPath(e.currentTarget.value)}
                placeholder="/Volumes/SSD/bootcamp"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void run(async () => {
                    const picked = await window.api.sources.pickFolder()
                    if (picked) setLocalPath(picked)
                  })
                }
              >
                Browse…
              </button>
            </div>
            <div className="inline">
              <input
                aria-label="Local source name"
                value={localName}
                onChange={(e) => setLocalName(e.currentTarget.value)}
                placeholder="Name (optional)"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn primary"
                data-testid="add-local-source"
                disabled={busy || localPath.trim().length === 0}
                onClick={() =>
                  void run(async () => {
                    await addSource({ name: localName, type: 'local', root: localPath.trim() })
                    setLocalPath('')
                    setLocalName('')
                  })
                }
              >
                Add local source
              </button>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Google Drive</legend>
          {!drive.configured ? (
            <p className="hint">
              This build is missing its Google credentials, so Drive sign-in is unavailable. See
              <strong> Google Drive</strong> in the README — the client secret is injected at
              build time from <code>GOOGLE_CLIENT_SECRET</code>.
            </p>
          ) : drive.signedIn ? (
            <div className="inline">
              <span data-testid="drive-status">
                Signed in{drive.email ? ` as ${drive.email}` : ''} — the course folder is in the
                source list.
              </span>
              <button
                type="button"
                className="btn danger"
                data-testid="drive-sign-out"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await signOutOfGoogle()
                    setDrive(await window.api.gdrive.status())
                  })
                }
              >
                Sign out
              </button>
            </div>
          ) : (
            <>
              <p className="hint">
                Sign in with the Google account the course folder was shared with. The app asks
                for read-only Drive access, opens the consent screen in your own browser, and
                keeps the refresh token in your OS keychain — never your password.
              </p>
              <div className="inline">
                <button
                  type="button"
                  className="btn primary"
                  data-testid="drive-sign-in"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setDrive(await window.api.gdrive.signIn())
                      await reloadSources()
                    })
                  }
                >
                  Sign in with Google
                </button>
                <span className="hint" data-testid="drive-status">
                  Not connected
                </span>
              </div>
            </>
          )}
        </fieldset>

        <AdminPanel open={open} />

        <fieldset>
          <legend>Playback</legend>
          <div className="field">
            <label htmlFor="theme-select">Theme</label>
            <select
              id="theme-select"
              data-testid="theme-select"
              value={settings.theme}
              onChange={(e) =>
                void patchSettings({ theme: e.currentTarget.value as ThemeSetting })
              }
            >
              <option value="system">Follow system</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <label className="inline">
            <input
              type="checkbox"
              checked={settings.autoplayNext}
              onChange={(e) => void patchSettings({ autoplayNext: e.currentTarget.checked })}
            />
            Autoplay the next lesson
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={settings.subtitlesEnabled}
              onChange={(e) => void patchSettings({ subtitlesEnabled: e.currentTarget.checked })}
            />
            Turn subtitles on automatically when a matching .srt/.vtt exists
          </label>
        </fieldset>

        <fieldset>
          <legend>Keyboard</legend>
          <ul className="source-list">
            {SHORTCUTS.map(([keys, what]) => (
              <li key={keys}>
                <strong style={{ minWidth: 110 }}>{keys}</strong>
                <span className="meta">{what}</span>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>

      <div className="dialog-foot">
        <button type="button" className="btn primary" data-testid="close-settings" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  )
}
