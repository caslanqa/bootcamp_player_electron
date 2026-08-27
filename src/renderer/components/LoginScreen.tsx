import { useState } from 'react'
import { useStore } from '../store'

interface Props {
  onUseLocalFolder(): void
}

/**
 * Startup gate. There is no password: signing in with Google *is* the
 * membership check, because the course folder is shared with specific accounts
 * and Google turns everyone else away. So account recovery, two-factor and the
 * rest are Google's job, not ours.
 */
export function LoginScreen({ onUseLocalFolder }: Props): React.JSX.Element {
  const driveStatus = useStore((s) => s.driveStatus)
  const signIn = useStore((s) => s.signInWithGoogle)
  const error = useStore((s) => s.error)
  const dismissError = useStore((s) => s.dismissError)

  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)

  const configured = driveStatus?.configured ?? false

  return (
    <main className="login" aria-labelledby="login-title">
      <div className="login-card">
        <img src="./icon.png" alt="" width={88} height={88} />
        <h1 id="login-title">Bootcamp Player</h1>
        <p className="login-lead">
          Sign in with the Google account your course folder was shared with.
        </p>

        {error ? (
          <div className="error-bar" role="alert">
            <p data-testid="login-error">{error}</p>
            <button type="button" className="btn" onClick={dismissError}>
              Dismiss
            </button>
          </div>
        ) : null}

        {configured ? (
          <>
            <button
              type="button"
              className="btn primary login-google"
              data-testid="login-google"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void signIn(remember).finally(() => setBusy(false))
              }}
            >
              {busy ? 'Waiting for your browser…' : 'Sign in with Google'}
            </button>

            <label className="inline login-remember">
              <input
                type="checkbox"
                data-testid="login-remember"
                checked={remember}
                onChange={(e) => setRemember(e.currentTarget.checked)}
              />
              Keep me signed in on this computer
            </label>

            <p className="hint">
              Unticked, you sign in again next launch. The app never sees your password —
              consent happens in your own browser.
            </p>
          </>
        ) : (
          <p className="hint" data-testid="login-unconfigured">
            This build has no Google client ID compiled in, so Drive sign-in is unavailable. You
            can still play a local folder.
          </p>
        )}

        <div className="login-alt">
          <button
            type="button"
            className="btn"
            data-testid="login-use-local"
            onClick={onUseLocalFolder}
          >
            Use a local folder instead
          </button>
          <a
            href="https://accounts.google.com/signin/recovery"
            target="_blank"
            rel="noreferrer"
            className="hint"
          >
            Trouble signing in?
          </a>
        </div>
      </div>
    </main>
  )
}
