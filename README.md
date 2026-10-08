# ArtCraft Suite Updater

A portable desktop downloader and updater for the [ArtCraft Crafting Apps](https://getartcraft.com/apps) published by the [`storytold`](https://github.com/storytold) GitHub organisation.

It lists every Crafting App, shows which are installed and which have updates, and downloads/installs the correct build for your operating system and CPU.

<img width="1919" height="1005" alt="image" src="https://github.com/user-attachments/assets/3d3c9456-5ee3-454d-8fc6-ad7bcc99c3e4" />
<img width="1917" height="1008" alt="image" src="https://github.com/user-attachments/assets/aea83f78-04a2-4185-af5f-49f951173b51" />

## Apps managed

PhotoCraft, VectorCraft, FilmCraft, LightCraft, PdfCraft, EffectCraft, DesignCraft, WordCraft, CADCraft, SoundCraft, GridCraft and DeckCraft.

## Features

- **All 12 apps in one window** with per-app status (`Up to date`, `Update vX → vY`, `Not installed`).
- **Platform dropdown** (Windows / macOS / Linux) mirroring the layout of the official site, with the recommended download first and every other format listed below.
- **Auto-checks for updates on launch** and on demand.
- **SHA-256 verification** of every download against the release's `SHA256SUMS.txt`.
- **Portable installs** (`.zip`, `.tar.gz`, `.AppImage`) install automatically into `<chosen folder>/<App Name>/`
- **System installers** (`.msi`, `.dmg`, `.deb`, `.rpm`, `.flatpak`) are downloaded, verified, then opened with your OS installer.
- **Open / Reinstall / Show in folder** for installed portable apps, launching the real GUI binary (never the bundled CLI).
- **In-app changelog** — view the latest release notes for any app without leaving the tool.
- Fully offline UI: all icons are bundled.

## Requirements

- [Node.js](https://nodejs.org) 20 or newer (24 LTS recommended) and npm.

## Getting started

```bash
npm install
npm start
```

## Building

Builds must be produced on the target OS (Electron cannot reliably cross-compile the native pieces):

```bash
npm run build:win     # Windows: portable .exe + NSIS installer
npm run build:mac     # macOS: .dmg + .zip
npm run build:linux   # Linux: AppImage + .deb
```

Artifacts are written to `build/` (git-ignored).

### Release portables

To produce clean, release-ready portables in `build/github/<os>`:

```bash
npm run dist:win     # build/github/windows  -> portable .zip
npm run dist:mac     # build/github/mac      -> .app zip
npm run dist:linux   # build/github/linux    -> tar.gz + AppImage
```

Each command must run on its own operating system — the macOS `.zip` and the Linux `.AppImage` cannot be built on Windows (the AppImage step needs Linux symlinks/tooling). The bundled GitHub Actions workflow (`.github/workflows/release.yml`) builds all three on native runners and attaches them to a GitHub Release when you push a `v*` tag:

```bash
git tag v0.1.8
git push origin v0.1.8
```

## Testing and linting

```bash
npm test    # node:test unit tests
npm run lint
```

## How it works

1. For each app, the latest tag is read from `https://github.com/{repo}/releases/latest` (a redirect) and the asset list from `https://github.com/{repo}/releases/expanded_assets/{tag}`.
2. The right artifact for your OS/CPU is selected by matching the asset name suffix (e.g. `-windows-x64.msi`), so historical naming differences are handled.
3. Downloads are streamed with progress and hashed; the SHA-256 is checked against `SHA256SUMS.txt` before anything is installed.
4. Portable archives are extracted and atomically swapped into place. System installers are handed to the OS default handler.
5. Installed versions, install folders and launch targets are recorded in a small JSON state file in the app's user-data directory.

## Project structure

```
src/
  main/       Electron main process
    apps.config.js   The 12 apps (repo, name, icon)
    github.js        Release/tag/asset/notes lookup (no API rate limit)
    resolver.js      Asset matching, SHA256SUMS parsing, semver
    downloader.js    Streaming download + hashing + progress/cancel
    installer.js     Portable install + launch-target detection
    state.js         Installed-version state store
    main.js          Window + IPC
  preload/    contextBridge API
  renderer/   UI (index.html, styles.css, renderer.js)
assets/
  icon.png / icon.ico   Brand icon
  icons/                Bundled app icons
test/         Unit tests
```

## Configuration

To add or change an app, edit `src/main/apps.config.js`:

```js
{ id: 'photocraft', name: 'PhotoCraft', repo: 'storytold/photocraft', blurb: 'Image editor', icon: '../../assets/icons/photocraft.webp' }
```

## Notes

- System installers are installed by your OS; the updater only records the last version it handed off, so it cannot read the exact installed version for those.

## License

MIT
