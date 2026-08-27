import { useEffect, useState } from 'react'
import type { AccessEntry, AdminStatus } from '@shared/types'
import { useStore } from '../store'

interface Props {
  /** Re-fetched whenever the Settings dialog opens. */
  open: boolean
}

/**
 * Access management for the account that owns the course folder.
 *
 * Grant and revoke go straight to Drive permissions, so what you see here is
 * the real access list — not a copy the app keeps. That also means Drive is the
 * thing enforcing it: nobody can patch their way past a folder that was never
 * shared with them.
 */
export function AdminPanel({ open }: Props): React.JSX.Element | null {
  const fail = useStore((s) => s.fail)

  const [status, setStatus] = useState<AdminStatus>({ isAdmin: false, canManage: false })
  const [access, setAccess] = useState<AccessEntry[] | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [elevateTried, setElevateTried] = useState(false)

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

  useEffect(() => {
    if (!open) return
    setAccess(null)
    void window.api.admin.status().then(setStatus)
  }, [open])

  useEffect(() => {
    if (!open || !status.isAdmin) return
    void window.api.admin
      .list()
      .then(setAccess)
      .catch((err: Error) => fail(err.message))
  }, [open, status.isAdmin, fail])

  if (!status.isAdmin) return null

  return (
    <fieldset data-testid="admin-panel">
      <legend>Course access (admin)</legend>

      {!status.canManage ? (
        <>
          <p className="hint">
            You own the course folder, so you can manage who reads it. Adding and removing people
            needs Drive write permission, which the app asks for separately — a student’s consent
            screen never mentions write access.
          </p>
          <button
            type="button"
            className="btn primary"
            data-testid="admin-elevate"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setElevateTried(true)
                setStatus(await window.api.admin.elevate())
              })
            }
          >
            Allow this app to manage sharing
          </button>
          {elevateTried ? (
            <p className="hint" data-testid="elevate-failed">
              Google did not grant write access, so the controls below stay inert. Add{' '}
              <code>https://www.googleapis.com/auth/drive</code> to the OAuth consent screen’s
              scope list in Google Cloud Console, then try again.
            </p>
          ) : null}
        </>
      ) : null}

      <ul className="source-list" data-testid="access-list">
        {access === null ? (
          <li className="hint">Loading…</li>
        ) : access.length === 0 ? (
          <li className="hint">Nobody but you has access yet.</li>
        ) : (
          access.map((entry) => (
            <li key={entry.id}>
              <div className="meta">
                <strong>{entry.name ?? entry.email ?? 'Unknown'}</strong>
                <small>
                  {entry.email ?? 'link access'} · {entry.role}
                  {entry.isSelf ? ' · you' : ''}
                </small>
              </div>
              <button
                type="button"
                className="btn danger"
                data-name={entry.email ?? entry.id}
                disabled={busy || !status.canManage || entry.isOwner}
                title={
                  entry.isOwner
                    ? 'The owner cannot be removed'
                    : status.canManage
                      ? 'Revoke access'
                      : 'Needs Drive write permission — use the button above'
                }
                onClick={() =>
                  void run(async () => setAccess(await window.api.admin.revoke(entry.id)))
                }
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>

      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            setAccess(await window.api.admin.grant(email))
            setEmail('')
          })
        }}
      >
        <label className="sr-only" htmlFor="grant-email">
          Google account to grant access to
        </label>
        <input
          id="grant-email"
          type="email"
          data-testid="grant-email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          placeholder="student@example.com"
          style={{ flex: 1 }}
          disabled={!status.canManage}
          title={status.canManage ? '' : 'Needs Drive write permission — use the button above'}
        />
        <button
          type="submit"
          className="btn primary"
          data-testid="grant-access"
          disabled={busy || !status.canManage || email.trim().length === 0}
          title={status.canManage ? '' : 'Needs Drive write permission — use the button above'}
        >
          Grant access
        </button>
      </form>
      <p className="hint">
        Google emails them the folder link. Access takes effect immediately — the next time they
        sign in, the course is there.
      </p>
    </fieldset>
  )
}
