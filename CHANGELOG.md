# Changelog

<!-- markdownlint-disable MD013 -->

All notable changes, generated from [Conventional Commits](https://www.conventionalcommits.org/)
by `npm run release`. Do not edit released sections by hand — one bullet per
commit, so lines run long on purpose.

## [1.2.0](https://github.com/caslanqa/bootcamp_player_electron/compare/v1.1.0...v1.2.0) — 2026-08-27

### Features

- **ui:** check GitHub Releases and install the update ([cd439ef](https://github.com/caslanqa/bootcamp_player_electron/commit/cd439ef496a916d3e48b0892f96ece85732a36b5))

### Fixes

- **build:** inject both Google credentials, unbreak the e2e run ([ef058ab](https://github.com/caslanqa/bootcamp_player_electron/commit/ef058abe2f97223c25b97b22a67f927ef23af2f4))
- **drive:** explain a missing or rejected Google credential ([ef2710c](https://github.com/caslanqa/bootcamp_player_electron/commit/ef2710c35721e572161de85790617436e547dc76))

## 1.1.0 — 2026-08-27

### ⚠ Breaking changes

- **BREAKING** **ui:** open on a Google sign-in gate, add an owner-only access panel ([d67d0da](https://github.com/caslanqa/bootcamp_player_electron/commit/d67d0dae8c0648e7ce782097215470a6985cfc9a))
- **BREAKING** **drive:** ship the client id and course folder, drop the credentials form ([48f01b4](https://github.com/caslanqa/bootcamp_player_electron/commit/48f01b47ebb2356fc979a4bea62a2c9be8c8a862))

### Features

- **release:** add versioned release pipeline with GitHub Releases ([cee2e39](https://github.com/caslanqa/bootcamp_player_electron/commit/cee2e3953e14fc14ad43e6c94b500b8875f83647))

### Fixes

- **ci:** release job edited to github release ([71711f8](https://github.com/caslanqa/bootcamp_player_electron/commit/71711f89b89db6409c5b4c6f24c105e1ea6c4e22))
- **ci:** stop electron-builder from auto-publishing ([202f34b](https://github.com/caslanqa/bootcamp_player_electron/commit/202f34b36b0c64d4d4966cad9377aa4ee3e2a970))

### CI

- build macOS on a hosted runner, drop the x64 mac target ([6ed3a32](https://github.com/caslanqa/bootcamp_player_electron/commit/6ed3a327f328c8739693dc9a8f43924083ad4fd4))

## 1.0.0 — 2026-08-27

First release.

### Features

- **playlist:** local and Google Drive data sources behind one provider interface, loaded lazily per folder
- **media:** direct / remux / transcode pipeline with a content-addressed cache, so anything ffmpeg reads is playable and seekable
- **player:** resume position, watched marks, folder completion counts, autoplay into the next lesson
- **player:** subtitle sidecars (`.srt`/`.vtt`) auto-detected and converted to WebVTT
- **player:** speed 0.25×–4×, Picture-in-Picture, pinned mini player, fullscreen, fit/fill
- **player:** timestamped bookmarks with notes
- **ui:** search across loaded lessons, dark / light / system theme, full keyboard control
- **build:** signed-adhoc macOS bundles, NSIS + portable Windows builds, AppImage + deb for Linux
