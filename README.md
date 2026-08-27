<div align="center">

<img src="build/icon.png" width="128" alt="Bootcamp Player icon">

# Bootcamp Player

**A course player that remembers where you stopped — and plays the files a browser refuses.**

Point it at a folder on your SSD or at a Google Drive folder. It builds the
playlist, tracks what you have watched, and converts exotic codecs once instead
of failing on them.

macOS · Windows · Linux — Electron 44 · React 19 · TypeScript

</div>

---

## Contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Quick start](#quick-start)
- [Data sources](#data-sources)
  - [Local folder](#local-folder)
  - [Google Drive](#google-drive)
    - [The client secret](#the-client-secret)
    - [Who can sign in](#who-can-sign-in)
- [Keyboard](#keyboard)
- [How it works](#how-it-works)
  - [Playback pipeline](#playback-pipeline)
  - [Why a local HTTP server](#why-a-local-http-server)
  - [Project layout](#project-layout)
- [Tests](#tests)
- [Installing](#installing)
  - [macOS](#macos)
  - [If macOS will not open the app](#if-macos-will-not-open-the-app)
  - [Windows](#windows)
  - [Linux](#linux)
- [Packaging](#packaging)
  - [Signing](#signing)
  - [Icon](#icon)
- [Releasing](#releasing)
  - [Commit convention](#commit-convention)
  - [Cutting a release](#cutting-a-release)
  - [CI and runners](#ci-and-runners)
- [Known limits](#known-limits)

---

## Why this exists

Successor to `BootcampPlayer_JavaFX_Full`. Same idea, the gaps closed:

| | JavaFX version | This one |
| --- | --- | --- |
| Storage | one local folder, picked every launch | any number of local **and** Google Drive sources, saved |
| Playlist | whole tree scanned eagerly | lazy per folder — a 2000-lesson Drive tree opens instantly |
| Formats | whatever JavaFX Media supported | anything ffmpeg reads, converted once and cached |
| Progress | none | resume position, watched marks, `done/total` per folder |
| Subtitles | none | `.srt`/`.vtt` sidecars, auto-detected, converted to WebVTT |
| Ordering | `10 Lesson` before `2 Lesson` | natural sort, folders first |
| Tests | none | 180 unit + integration, 16 end-to-end |
| Releases | build by hand | conventional commits → version → tag → GitHub Release |

## Features

**Sources** — mix local folders and Drive folders, switch from the sidebar.
Folders load on expand, never up front.

**Plays anything** — web-native files stream untouched. An mkv holding h264/aac
is remuxed with `-c copy` in seconds. H.265, AC3 and friends are re-encoded once
and cached forever. Seeking works in every case.

**Never lose your place** — per-lesson position, a progress bar in the playlist,
a checkmark when finished, folder-level completion counts, autoplay into the next
lesson (and into the next folder when one runs out).

**Subtitles** — sidecars found automatically and converted on the fly.
`lesson.tr.srt` shows up in the picker as *tr*.

**Transport** — scrub bar with buffered range and bookmark marks, 0.25×–4× speed,
±10s, prev/next, fit/fill, fullscreen, Picture-in-Picture, and a pinned
always-on-top mini player.

**Bookmarks with notes** — timestamped, click to jump back.

**Plus** — search across loaded lessons, dark / light / system theme, full
keyboard control.

## Quick start

```bash
npm install
node -e "require('electron')"   # only if npm deferred the install script
npm run dev
```

Then **⚙ Settings → Data sources → Browse…**, pick a course folder, **Add local
source**.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev build with hot reload |
| `npm run build` | Compile main, preload and renderer into `out/` |
| `npm start` | Preview the production build |
| `npm run typecheck` | App + tests, then `scripts/` under its stricter config |
| `npm test` | Unit + integration (~1s) |
| `npm run test:e2e` | Build, then drive the real app with Playwright |
| `npm run pack:mac` / `:win` / `:linux` | Installers into `release/` |
| `npm run commit` | Guided conventional commit |
| `npm run release` | Bump version, changelog, commit, tag |

## Data sources

### Local folder

Any readable directory: internal disk, external SSD, NAS mount, or a Drive
folder already mounted by rclone / Google Drive Desktop. Media files are matched
by extension; hidden files, subtitle sidecars and everything else stay out of the
playlist.

The stream server refuses any path outside the configured root, so a source
cannot be used to read the rest of your disk.

### Google Drive

Students never see a credentials form. The course folder is the same for
everyone, so the client ID and folder ID are compiled into the build and a
student only clicks **Sign in with Google**.

`src/main/config.ts` holds the client ID, the course folder and an optional
roster. Edit it and rebuild:

```ts
export const GDRIVE = {
  clientId: '…apps.googleusercontent.com',
  folderId: '1S_bC1BqGhFSuhktVhi8yXlOb03gEpxZf',   // a full Drive URL works too
  sourceName: 'Bootcamp course',
  allowedEmails: []                                // see "Who can sign in"
}
```

A desktop-app client ID is **not** a secret. Google documents installed apps as
unable to keep one confidential, which is exactly why this flow uses PKCE —
`gcloud`, `rclone` and `gh` all ship theirs the same way. `folderId` accepts
either a bare id or a pasted `drive.google.com/drive/u/1/folders/<id>?usp=…` URL;
sub-folders under it are walked lazily, exactly like a local source.

To create the client: [Google Cloud Console](https://console.cloud.google.com/) →
new project → enable the **Google Drive API** → **Credentials → Create
credentials → OAuth client ID → Desktop app**.

#### The client secret

The secret is **not** in this file, because this repository is public: a
committed `GOCSPX-…` string trips GitHub secret scanning, which notifies Google,
which can disable the credential and break every install. It is injected at
build time instead.

Locally, put it in a gitignored `.env`:

```bash
echo 'GOOGLE_CLIENT_SECRET=GOCSPX-…' > .env
npm run pack:mac
```

In CI, add `GOOGLE_CLIENT_SECRET` under **Settings → Secrets and variables →
Actions**; `release.yml` passes it to the packaging step. A build without it
prints `[build] GOOGLE_CLIENT_SECRET is not set` and produces an app whose Drive
sign-in will fail — the rest of the app, including local folders, still works.

#### Who can sign in

The scope is `drive.readonly`, which Google classifies as a **restricted** scope.
That decides what your consent screen can be, and it is also the access gate:

| Consent screen | Who gets in | Cost |
| --- | --- | --- |
| **Internal** (needs a Google Workspace domain) | anyone in your organisation | nothing — no verification, tokens do not expire |
| **External → Testing** | only accounts you add as *test users*, up to 100 | nothing, but refresh tokens die after **7 days**, so students re-login weekly |
| **External → Production** | anyone | restricted-scope verification **plus an annual CASA security assessment** |

For a closed cohort, *Internal* is the clean answer and the test-user list is the
practical one. Either way the real access control is **Drive's own sharing** —
share the course folder with exactly those accounts and Google turns everyone
else away before the app ever sees a token.

`allowedEmails` in the config is a convenience on top: someone outside the list
gets a clear "not on the course roster" message instead of an empty playlist. It
is **not** security — the list ships inside the app and a desktop app can be
patched.

#### What the app does with the grant

Read-only, nothing else. Sign-in opens Google's consent screen in your real
browser via PKCE with a loopback redirect, so the app never sees your password.
The refresh token is encrypted with Electron `safeStorage` (OS keychain); where
no keychain exists it stays in memory for that session and never reaches disk.

After sign-in the course folder appears in the source list on its own. Its source
id is fixed, so signing out and back in keeps every watched mark and bookmark.

## Keyboard

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `Space` / `K` | Play / pause | `M` | Mute |
| `J` / `L` | Back / forward 10s | `F` | Fullscreen |
| `←` / `→` | Back / forward 5s | `I` | Picture-in-Picture |
| `↑` / `↓` | Volume up / down | `N` / `P` | Next / previous lesson |
| `0`–`9` | Jump to 0–90% | `<` / `>` | Slower / faster |

All shortcuts are ignored while a text field has focus, so typing a bookmark note
never triggers the transport.

## How it works

### Playback pipeline

`ffprobe` inspects the file, then the cheapest viable path wins:

| Mode | When | Cost |
| --- | --- | --- |
| **direct** | web-native container *and* codecs (mp4/h264/aac, webm/vp9/opus, mp3…) | none — original bytes stream straight through |
| **remux** | web-native codecs in a foreign container (mkv, mov, avi with h264) | seconds — `-c copy` into mp4 |
| **transcode** | a codec Chromium cannot decode (H.265, AC3, mpeg4…) | slow, once — only the offending stream is re-encoded |

Remuxed and transcoded output lands in a content-addressed cache
(`userData/transcode-cache`) keyed on source, size and mtime, so an edited file
reconverts and an unchanged one never does. Concurrent requests for the same file
collapse into a single ffmpeg process.

> **Design note.** Transcode-to-cache rather than live HLS segmenting. That costs
> an upfront wait on exotic files, and buys correct seeking plus one playback code
> path instead of two. Swap in a segmenter only if instant start on H.265 ever
> becomes a real complaint.

### Why a local HTTP server

Everything the `<video>` element loads comes from a `127.0.0.1` origin in the main
process. Two reasons:

- Drive downloads need an `Authorization` header, and `<video src>` cannot send one.
- Range requests, and therefore seeking, then work identically for both backends.

It binds to loopback only, requires a per-run random token on every request, and
the local provider independently rejects paths outside its source root.

### Project layout

```text
src/shared/     types + pure logic shared by all three processes
src/main/       lifecycle, IPC, stores
  providers/    StorageProvider — local FS and Google Drive behind one interface
  media/        ffprobe/ffmpeg wrappers, transcode cache
  auth/         Drive OAuth (PKCE + loopback)
  server.ts     the 127.0.0.1 origin the <video> element loads from
src/preload/    the only renderer↔main bridge (contextBridge, sandboxed)
src/renderer/   React UI, zustand store, pure tree helpers
scripts/        release tooling (.mts, run directly by node) + CI shell scripts
```

Two TypeScript projects, because the code runs two different ways. The root
`tsconfig.json` covers everything Vite compiles; `scripts/tsconfig.json` covers
the `.mts` release tooling that **node executes directly** by stripping types, so
it additionally forbids non-erasable syntax (`enum`, `namespace`, constructor
parameter properties) and requires explicit `import type`. The app code uses
parameter properties freely — esbuild compiles those properly, node could not.

## Tests

```bash
npm test               # unit + integration
npm run test:e2e       # builds, then drives the real app
```

| Layer | Covers |
| --- | --- |
| **Unit** (`tests/unit`) | Pure logic, no I/O: codec decisions and ffmpeg argument building, SRT→VTT, time formatting, natural sort, playlist flattening and next-lesson resolution, `JsonStore`, HTTP Range parsing. |
| **Integration** (`tests/integration`) | Real main-process modules: local provider against a generated course tree (root-escape rejection included), the stream server over HTTP (token gate, 206/416, VTT conversion), `MediaPreparer` genuinely remuxing an mkv with ffmpeg, the Drive provider against a fake `fetch` (pagination, 401 retry), the full OAuth PKCE loopback flow, and every IPC channel wired to real stores. |
| **E2E** (`tests/e2e`) | Playwright launches the built app: add a source, play through the stream server, autoplay next, watched checkmarks, mkv remux, bookmarks, resume after restart, search, theme, source removal. |

Test media is generated once with ffmpeg into `tests/.fixtures/` (gitignored).

## Installing

**The builds carry no Developer ID or Authenticode certificate.** macOS bundles
are ad-hoc signed so they are internally valid and will launch, but neither OS
can verify *who* published them — so each one needs one extra step the first time.
Nothing below weakens system-wide security: each command clears the flag on this
one file.

Grab the installers from the repository's **Releases** page, or build them
yourself — a local `npm run pack:*` writes into `release/`. List them if you are
unsure of a name:

```bash
ls release/
```

### macOS

The `.dmg` arrives quarantined because it was downloaded, and Gatekeeper blocks
quarantined apps that are not notarised. Copy it out, then clear the flag:

```bash
# Mount, copy to /Applications, unmount
VOL=$(hdiutil attach release/BootcampPlayer-1.0.0-arm64.dmg -nobrowse | grep -o '/Volumes/.*')
cp -R "$VOL/Bootcamp Player.app" /Applications/
hdiutil detach "$VOL"

# Clear the download quarantine — without this you get
# "can't be opened because Apple cannot check it for malicious software"
xattr -dr com.apple.quarantine "/Applications/Bootcamp Player.app"

open "/Applications/Bootcamp Player.app"
```

Confirm the bundle is intact at any point:

```bash
codesign --verify --deep --strict "/Applications/Bootcamp Player.app" && echo "signature ok"
```

`spctl -a` will still report *rejected* — that checks notarisation, which an
ad-hoc signature cannot satisfy. It is not a sign of a broken build.

The prebuilt dmg is **Apple Silicon only** — see [Known limits](#known-limits).

### If macOS will not open the app

Start by asking macOS what is actually wrong instead of reading the modal — run
the binary inside the bundle and it prints the real error:

```bash
"/Applications/Bootcamp Player.app/Contents/MacOS/Bootcamp Player"
```

| Symptom | Cause | Fix |
| --- | --- | --- |
| “cannot be opened because Apple cannot check it for malicious software” | Download quarantine still set | `xattr -dr com.apple.quarantine` |
| “is damaged and can’t be opened. You should move it to the Trash” | Signature invalidated, or the dmg was truncated | Re-sign ad-hoc (below) |
| Icon bounces once, then nothing | Runtime crash | Run the binary directly, read the error |
| “bad CPU type in executable” | arm64 build on an Intel Mac | No prebuilt Intel dmg — build on an Intel host |

The one-shot repair — clears every download flag and gives the bundle a fresh,
valid ad-hoc signature:

```bash
APP="/Applications/Bootcamp Player.app"

xattr -cr "$APP"                                    # drop quarantine + provenance
codesign --force --deep --sign - "$APP"             # re-sign ad-hoc
codesign --verify --deep --strict "$APP" && echo "signature ok"
open "$APP"
```

`codesign` ships with the Xcode command line tools; if it is missing, run
`xcode-select --install` first.

To see the state rather than change it:

```bash
xattr -l "$APP"                    # is com.apple.quarantine still there?
codesign -dv "$APP"                # expect Signature=adhoc, Identifier=com.caslanqa.bootcampplayer
spctl -a -vvv "$APP"               # "rejected" is expected — the build is not notarised
uname -m                           # must say arm64; the prebuilt dmg is Apple Silicon only
ls -t ~/Library/Logs/DiagnosticReports | head -5    # most recent crash reports
```

On macOS 15 and later, right-click → **Open** no longer bypasses Gatekeeper for
an app that is not notarised. Either use the `xattr` command above, or launch it
once, let it be blocked, then approve it in **System Settings → Privacy &
Security → Open Anyway**.

If the app launches but misbehaves, reset its profile — settings, watch progress,
bookmarks and the transcode cache all live in one directory:

```bash
rm -rf "$HOME/Library/Application Support/bootcamp_player_electron"
```

### Windows

Run in **PowerShell** from the folder holding the installer:

```powershell
# Confirm what you have: NotSigned is expected
Get-AuthenticodeSignature .\BootcampPlayer-Setup-1.0.0-x64.exe | Format-List Status

# Remove the "downloaded from the internet" mark, then install
Unblock-File .\BootcampPlayer-Setup-1.0.0-x64.exe
.\BootcampPlayer-Setup-1.0.0-x64.exe
```

SmartScreen may still show *Windows protected your PC* — **More info → Run
anyway**. `Unblock-File` removes the zone marker; the reputation warning is a
separate check that only a purchased certificate clears.

Unattended install, and the portable build which needs no installer at all:

```powershell
.\BootcampPlayer-Setup-1.0.0-x64.exe /S          # silent, current user
.\BootcampPlayer-1.0.0-x64.exe                   # portable, just runs
```

### Linux

AppImage — mark it executable and run it, no install step:

```bash
chmod +x release/BootcampPlayer-*.AppImage
./release/BootcampPlayer-*.AppImage
```

Debian / Ubuntu package:

```bash
sudo apt install ./release/BootcampPlayer-*.deb
bootcamp-player
```

On Ubuntu 24.04+ the AppImage can die with a `chrome-sandbox` / user-namespace
error, because AppArmor restricts unprivileged namespaces for unconfined
binaries. Either install the `.deb` (which ships a proper SUID sandbox helper), or
allow namespaces for that one file:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0   # until reboot
```

Prefer that over `--no-sandbox`, which turns the renderer sandbox off entirely.

## Packaging

```bash
npm run pack:mac      # dmg + zip (arm64)
npm run pack:win      # NSIS installer + portable exe
npm run pack:linux    # AppImage + deb
npm run pack:dir      # unpacked, for a quick look
```

> **Build each platform on that platform.** `@ffmpeg-installer` and
> `@ffprobe-installer` only install the host's binary, so cross-building ships an
> app with no ffmpeg. [`release.yml`](#ci-and-runners) runs a three-OS matrix that
> gets this right — see [Releasing](#releasing).

Artifact names are `BootcampPlayer-${version}-${arch}.${ext}`, with the NSIS
installer as `BootcampPlayer-Setup-${version}-${arch}.exe`.

### Signing

Builds are unsigned: `mac.identity: null` in `electron-builder.yml`,
`CSC_IDENTITY_AUTO_DISCOVERY: false` in CI. Add a Developer ID and an
Authenticode certificate in those two places to make [Installing](#installing) a
plain double-click.

Until then, `build/after-pack.js` re-signs macOS bundles ad-hoc. This is not
cosmetic: skipping signing leaves the bundle carrying the ad-hoc signature the
Electron binary shipped with, which electron-builder's own edits invalidate.
`codesign --verify` fails on that and macOS reports the app as *damaged* — a state
no Gatekeeper override can clear. The hook replaces it with a valid ad-hoc
signature under the real bundle identifier, so the app launches once the user
clears the download quarantine.

### Icon

`build/icon.png` (1024×1024, transparent) is the single source; electron-builder
derives `.icns` and `.ico` from it. `src/renderer/public/icon.png` is a 256px copy
used for the Linux window and taskbar icon. To swap the artwork:

```bash
python3 build/make-icon.py path/to/new-artwork.png build/icon.png
```

That script flood-fills the white surround to transparency. Skip it and the icon
shows up as a white tile in the Dock and taskbar.

## Releasing

Version numbers come from the commit log, and a pushed tag is what publishes.

```bash
npm run release:dry      # what would the next version be, and why
npm run release          # bump + CHANGELOG + commit + tag, nothing pushed
git push --follow-tags origin main
```

The tag push runs `.github/workflows/release.yml`, which packages all three
platforms and attaches the installers to a **GitHub Release** named after the tag.
Release notes are the matching `CHANGELOG.md` section. Build artifacts are also
kept for 3 days on the run page, as a fallback while a release is being debugged.

### Commit convention

[Conventional Commits](https://www.conventionalcommits.org/), enforced by
commitlint in a `commit-msg` hook *and* on pull requests, since a hook can be
skipped with `--no-verify`.

```text
feat(player): add a pinned mini player
fix(media): pass -f mp4 so ffmpeg can write to a .part file
feat(ipc)!: rename the progress channel      ← breaking
```

| | |
| --- | --- |
| **Types** | `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert` `ai` |
| **Scopes** (optional) | `player` `playlist` `providers` `drive` `media` `server` `ipc` `ui` `settings` `build` `ci` `deps` `tests` `docs` `release` |

`npm run commit` walks you through it interactively. Git hooks, installed by
husky on `npm install`:

| Hook | Runs |
| --- | --- |
| `commit-msg` | commitlint |
| `pre-commit` | `npm run typecheck` (~2s) |
| `pre-push` | `npm test` |

### Cutting a release

`npm run release` reads every commit since the last tag and picks the bump
itself:

| Commit contains | Bump |
| --- | --- |
| `!` after the type, or a `BREAKING CHANGE:` footer | **major** |
| any `feat` | **minor** |
| any `fix` or `perf` | **patch** |
| only `docs`, `chore`, `style`, `test`… | **none** — it stops and says so |

Then it writes the new version into `package.json`, prepends a grouped section to
`CHANGELOG.md`, commits it as `chore(release): vX.Y.Z`, and creates the annotated
tag. Override the level with `--major` / `--minor` / `--patch`; inspect first with
`--dry-run`. It refuses to run on a dirty working tree, and it never pushes.

Because electron-builder reads the version from `package.json`, the installer
filenames carry it automatically.

### CI and runners

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | push to `main`, PRs | commitlint (PRs), typecheck, unit + integration, e2e under xvfb |
| `release.yml` | `v*` tag, or manual dispatch | package per platform → artifacts → GitHub Release (tag only) |

All three jobs run on GitHub-hosted runners: `macos-latest`, `windows-latest`,
`ubuntu-latest`.

Each platform packages itself, because `@ffmpeg-installer` only fetches the
*host's* binary — a cross-built app would ship with no ffmpeg and fall back to
whatever is on the user's PATH. The same rule applies to CPU architecture, and
`macos-latest` is arm64, which is why the mac target is arm64-only.

Note that GitHub bills macOS minutes at 10× on private repositories. A
self-hosted Mac would avoid that, but a runner registration belongs to exactly one
repo, org or enterprise — an existing runner registered elsewhere cannot serve
this repo, it needs its own installation.

## Known limits

- Transcoding an H.265 lesson blocks that lesson until it finishes; progress is
  shown while it runs. Remuxes are near-instant.
- Next / previous walk the lessons currently visible in the sidebar. Finishing a
  folder auto-opens the next one.
- Search covers loaded folders only — expand a folder to include it.
- Drive access is read-only, and Google Docs-native files are not media, so they
  are filtered out of playlists.
- With an *External → Testing* consent screen, Google expires Drive refresh
  tokens after 7 days, so students have to sign in again weekly. An *Internal*
  consent screen on a Workspace domain has no such limit.
- The prebuilt macOS installer is Apple Silicon only. Intel Macs need a build
  produced on an Intel host, so that the bundled ffmpeg matches the architecture.
