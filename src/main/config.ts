/**
 * Baked-in Google Drive setup.
 *
 * The course folder is the same for everyone, so nobody should have to paste a
 * client ID or a folder ID. A desktop-app client ID is not a secret either —
 * Google documents installed apps as unable to keep one confidential, which is
 * exactly why the sign-in flow uses PKCE. Shipping it in the binary is what
 * gcloud, rclone and gh all do.
 *
 * Both halves are injected at build time rather than committed. GitHub secrets
 * protect the *repository*, not the binary — every installer still carries these
 * values and they can be extracted in minutes. What it does buy:
 *
 *   - a committed `GOCSPX-…` string trips GitHub secret scanning, which tells
 *     Google, which can disable the credential and break every install
 *   - a client ID that is not in public git or search results cannot be lifted
 *     by someone else to burn this project's quota, or to put this app's name on
 *     their own consent screen
 *
 * Set both in a gitignored `.env` locally; CI reads them from repository secrets.
 * See electron.vite.config.ts.
 */

/** Replaced at build time by electron-vite `define`. */
declare const __GOOGLE_CLIENT_ID__: string
declare const __GOOGLE_CLIENT_SECRET__: string

// `typeof` guards because the identifiers only exist once esbuild has
// substituted them — under vitest they are simply absent.
export const GDRIVE = {
  /** OAuth client of type "Desktop app". */
  clientId: typeof __GOOGLE_CLIENT_ID__ === 'string' ? __GOOGLE_CLIENT_ID__ : '',

  clientSecret: typeof __GOOGLE_CLIENT_SECRET__ === 'string' ? __GOOGLE_CLIENT_SECRET__ : '',

  /** The course root. Sub-folders below it are walked lazily, as with a local source. */
  folderId: '1S_bC1BqGhFSuhktVhi8yXlOb03gEpxZf',

  /** Shown in the source picker. */
  sourceName: 'Bootcamp course'
}

/** Where update checks look for releases: "owner/repo" on GitHub. */
export const RELEASE_REPO = 'caslanqa/bootcamp_player_electron'

/**
 * Can this build actually complete a sign-in? Both halves have to be present:
 * the client ID is committed, but the secret is injected at build time and is
 * silently empty when GOOGLE_CLIENT_SECRET was not set. Google's token endpoint
 * requires it for this client, so an empty one means sign-in cannot work — the
 * UI should say so before anyone clicks.
 */
export function isDriveConfigured(): boolean {
  return GDRIVE.clientId.trim().length > 0 && GDRIVE.clientSecret.trim().length > 0
}

/**
 * Accept either a bare folder id or a pasted Drive URL, because
 * "drive.google.com/drive/u/1/folders/<id>?usp=sharing" is what the browser
 * actually gives you. Empty means My Drive.
 */
export function normalizeFolderId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'root'
  const fromUrl = /\/folders\/([^/?#]+)/.exec(trimmed)
  return (fromUrl ? fromUrl[1] : trimmed).split(/[?#]/)[0]
}

/** The configured course root, ready to hand to the Drive provider. */
export function driveRoot(): string {
  return normalizeFolderId(GDRIVE.folderId)
}

/**
 * Stable id for the Drive source. Watch progress and bookmarks are keyed by
 * source id, so this must never be regenerated — a fresh uuid on every sign-in
 * would silently orphan every lesson's progress.
 */
export const DRIVE_SOURCE_ID = 'gdrive-course'
