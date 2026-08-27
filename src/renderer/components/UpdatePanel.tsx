import { useEffect } from 'react'
import { useStore } from '../store'

interface Props {
  open: boolean
}

/**
 * Check GitHub Releases, download the installer for this machine, hand it to the
 * OS. Not a silent auto-update: these builds are ad-hoc signed, and macOS
 * refuses to self-install an update that carries no Developer ID.
 */
export function UpdatePanel({ open }: Props): React.JSX.Element {
  const update = useStore((s) => s.update)
  const progress = useStore((s) => s.updateProgress)
  const hint = useStore((s) => s.updateHint)
  const check = useStore((s) => s.checkForUpdate)
  const download = useStore((s) => s.downloadUpdate)
  const install = useStore((s) => s.installUpdate)

  useEffect(() => {
    if (open && !update) void check()
  }, [open, update, check])

  const downloading = progress !== null && !progress.done
  const ready = progress?.done === true

  return (
    <fieldset data-testid="update-panel">
      <legend>Updates</legend>

      <div className="inline">
        <span data-testid="current-version">
          Version {update?.current ?? '—'}
        </span>
        <button
          type="button"
          className="btn"
          data-testid="check-update"
          disabled={downloading}
          onClick={() => void check()}
        >
          Check now
        </button>
      </div>

      {update?.error ? (
        <p className="hint" data-testid="update-error">
          Could not reach GitHub ({update.error}). The app works fine; try again later.
        </p>
      ) : null}

      {update && !update.available && !update.error ? (
        <p className="hint" data-testid="update-none">
          This is the latest release.
        </p>
      ) : null}

      {update?.available ? (
        <>
          <p data-testid="update-available">
            <strong>Version {update.version} is available.</strong>{' '}
            {update.releaseUrl ? (
              <a href={update.releaseUrl} target="_blank" rel="noreferrer">
                Release notes
              </a>
            ) : null}
          </p>

          {update.asset ? (
            <>
              <div className="inline">
                <button
                  type="button"
                  className="btn primary"
                  data-testid="install-update"
                  disabled={downloading}
                  onClick={() => void (ready ? install() : download().then(install))}
                >
                  {downloading
                    ? `Downloading ${progress.percent >= 0 ? `${progress.percent}%` : '…'}`
                    : ready
                      ? 'Open the installer'
                      : `Download and install (${Math.round(update.asset.size / 1024 / 1024)} MB)`}
                </button>
                {downloading ? (
                  <progress max={100} value={progress.percent >= 0 ? progress.percent : undefined} />
                ) : null}
              </div>
              {hint ? (
                <p className="hint" data-testid="update-hint">
                  {hint}
                </p>
              ) : null}
            </>
          ) : (
            <p className="hint">
              This release has no installer for your platform and architecture. Grab it from the
              release page instead.
            </p>
          )}
        </>
      ) : null}
    </fieldset>
  )
}
