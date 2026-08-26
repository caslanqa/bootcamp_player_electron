# Changelog

<!-- markdownlint-disable MD013 -->

All notable changes, generated from [Conventional Commits](https://www.conventionalcommits.org/)
by `npm run release`. Do not edit released sections by hand — one bullet per
commit, so lines run long on purpose.

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
