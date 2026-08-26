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
- [Keyboard](#keyboard)
- [How it works](#how-it-works)
  - [Playback pipeline](#playback-pipeline)
  - [Why a local HTTP server](#why-a-local-http-server)
  - [Project layout](#project-layout)
- [Tests](#tests)
- [Packaging](#packaging)
  - [Icon](#icon)
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
| Tests | none | 132 unit + integration, 16 end-to-end |

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
| `npm run typecheck` | `tsc --noEmit` across all three processes |
| `npm test` | Unit + integration (~1s) |
| `npm run test:e2e` | Build, then drive the real app with Playwright |
| `npm run pack:mac` / `:win` / `:linux` | Installers into `release/` |

## Data sources

### Local folder

Any readable directory: internal disk, external SSD, NAS mount, or a Drive
folder already mounted by rclone / Google Drive Desktop. Media files are matched
by extension; hidden files, subtitle sidecars and everything else stay out of the
playlist.

The stream server refuses any path outside the configured root, so a source
cannot be used to read the rest of your disk.

### Google Drive

Drive needs **your own** OAuth client — a shipped client ID would be a shared
secret and would rate-limit every user together.

1. [Google Cloud Console](https://console.cloud.google.com/) → new project →
   enable the **Google Drive API**.
2. **Credentials → Create credentials → OAuth client ID → Desktop app**.
3. Paste the client ID (and secret, if one is issued) into **Settings → Google
   Drive**, hit **Save credentials**, then **Sign in with Google**.
4. Add a source with the folder ID from its Drive URL
   (`drive.google.com/drive/folders/<id>`), or leave `root` for My Drive.

Scope requested: `drive.readonly` — read-only, nothing else. The refresh token is
encrypted with Electron `safeStorage` (OS keychain). Where no keychain exists, it
is kept in memory for that session only and never written to disk. Sign-in runs
in your real browser via PKCE + loopback redirect; the app never sees your
password.

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
```

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

## Packaging

```bash
npm run pack:mac      # dmg + zip (arm64, x64)
npm run pack:win      # NSIS installer + portable exe
npm run pack:linux    # AppImage + deb
npm run pack:dir      # unpacked, for a quick look
```

> **Build each platform on that platform.** `@ffmpeg-installer` and
> `@ffprobe-installer` only install the host's binary, so cross-building ships an
> app with no ffmpeg. `.github/workflows/build.yml` runs a three-OS matrix that
> gets this right and uploads the installers as artifacts.

Builds are unsigned — `mac.identity: null` in `electron-builder.yml`,
`CSC_IDENTITY_AUTO_DISCOVERY: false` in CI. Add certificates in those two places
when you have them.

### Icon

`build/icon.png` (1024×1024, transparent) is the single source; electron-builder
derives `.icns` and `.ico` from it. `src/renderer/public/icon.png` is a 256px copy
used for the Linux window and taskbar icon. To swap the artwork:

```bash
python3 build/make-icon.py path/to/new-artwork.png build/icon.png
```

That script flood-fills the white surround to transparency. Skip it and the icon
shows up as a white tile in the Dock and taskbar.

## Known limits

- Transcoding an H.265 lesson blocks that lesson until it finishes; progress is
  shown while it runs. Remuxes are near-instant.
- Next / previous walk the lessons currently visible in the sidebar. Finishing a
  folder auto-opens the next one.
- Search covers loaded folders only — expand a folder to include it.
- Drive access is read-only, and Google Docs-native files are not media, so they
  are filtered out of playlists.
