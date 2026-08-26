import { useEffect, useRef, useState } from 'react'
import type { GDriveStatus, ThemeSetting } from '@shared/types'
import { useStore } from '../store'

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
  const removeSource = useStore((s) => s.removeSource)
  const fail = useStore((s) => s.fail)

  const [localPath, setLocalPath] = useState('')
  const [localName, setLocalName] = useState('')
  const [driveFolder, setDriveFolder] = useState('root')
  const [driveName, setDriveName] = useState('')
  const [clientId, setClientId] = useState(settings.gdrive.clientId)
  const [clientSecret, setClientSecret] = useState(settings.gdrive.clientSecret)
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
    setClientId(settings.gdrive.clientId)
    setClientSecret(settings.gdrive.clientSecret)
    void window.api.gdrive.status().then(setDrive)
  }, [open, settings.gdrive])

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
          <p className="hint">
            Create an OAuth <em>Desktop app</em> client in Google Cloud Console with the Drive API
            enabled, then paste its client ID here. The app requests read-only Drive access and
            keeps the refresh token in your OS keychain.
          </p>
          <div className="field">
            <label htmlFor="client-id">OAuth client ID</label>
            <input
              id="client-id"
              value={clientId}
              onChange={(e) => setClientId(e.currentTarget.value)}
              placeholder="xxxxx.apps.googleusercontent.com"
            />
          </div>
          <div className="field">
            <label htmlFor="client-secret">OAuth client secret (if your client has one)</label>
            <input
              id="client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.currentTarget.value)}
            />
          </div>
          <div className="inline">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await patchSettings({ gdrive: { clientId, clientSecret } })
                  setDrive(await window.api.gdrive.status())
                })
              }
            >
              Save credentials
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !drive.configured}
              onClick={() => void run(async () => setDrive(await window.api.gdrive.signIn()))}
            >
              {drive.signedIn ? 'Re-authorize' : 'Sign in with Google'}
            </button>
            {drive.signedIn ? (
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => void run(async () => setDrive(await window.api.gdrive.signOut()))}
              >
                Sign out
              </button>
            ) : null}
            <span className="hint">
              {drive.signedIn ? `Connected${drive.email ? ` as ${drive.email}` : ''}` : 'Not connected'}
            </span>
          </div>

          <div className="field">
            <label htmlFor="drive-folder">Drive folder ID (or “root”)</label>
            <div className="inline">
              <input
                id="drive-folder"
                value={driveFolder}
                onChange={(e) => setDriveFolder(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <input
                aria-label="Drive source name"
                value={driveName}
                onChange={(e) => setDriveName(e.currentTarget.value)}
                placeholder="Name (optional)"
              />
              <button
                type="button"
                className="btn primary"
                disabled={busy || !drive.signedIn}
                onClick={() =>
                  void run(async () => {
                    await addSource({ name: driveName, type: 'gdrive', root: driveFolder.trim() })
                    setDriveName('')
                  })
                }
              >
                Add Drive source
              </button>
            </div>
            <p className="hint">
              The folder ID is the last path segment of its Drive URL:
              drive.google.com/drive/folders/<strong>&lt;id&gt;</strong>
            </p>
          </div>
        </fieldset>

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
