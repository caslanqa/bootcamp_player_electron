/**
 * Baked-in Google Drive setup.
 *
 * The course folder is the same for everyone, so nobody should have to paste a
 * client ID or a folder ID. A desktop-app client ID is not a secret either —
 * Google documents installed apps as unable to keep one confidential, which is
 * exactly why the sign-in flow uses PKCE. Shipping it in the binary is what
 * gcloud, rclone and gh all do.
 *
 * The client *secret* is different, not because it is confidential (it is not,
 * for an installed app) but because this repository is public: committing a
 * `GOCSPX-…` string trips GitHub secret scanning, which tells Google, which can
 * disable the credential and break every install. So it is injected at build
 * time instead — see GOOGLE_CLIENT_SECRET in electron.vite.config.ts.
 */

/** Replaced at build time by electron-vite `define`. */
declare const __GOOGLE_CLIENT_SECRET__: string

export const GDRIVE = {
  /** OAuth client of type "Desktop app". Public by design. */
  clientId: '975363724118-onhruo5faruvmjdjudthrb77df76uirj.apps.googleusercontent.com',

  /**
   * Build-time injected. `typeof` guard because the identifier only exists once
   * esbuild has substituted it — under vitest it is simply absent.
   */
  clientSecret: typeof __GOOGLE_CLIENT_SECRET__ === 'string' ? __GOOGLE_CLIENT_SECRET__ : '',

  /** The course root. Sub-folders below it are walked lazily, as with a local source. */
  folderId: '1S_bC1BqGhFSuhktVhi8yXlOb03gEpxZf',

  /** Shown in the source picker. */
  sourceName: 'Bootcamp course'
}

/** False when this build has no client ID compiled in — the UI says so plainly. */
export function isDriveConfigured(): boolean {
  return GDRIVE.clientId.trim().length > 0
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
