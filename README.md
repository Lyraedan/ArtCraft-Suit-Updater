# ArtCraft Suite Updater

A portable desktop downloader and updater for the [ArtCraft Crafting Apps](https://getartcraft.com/apps) published by the [`storytold`](https://github.com/storytold) GitHub organisation.

It lists every Crafting App, shows which are installed and which have updates, and downloads/installs the correct build for your operating system and CPU.

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/4947f114-b352-4369-bb07-43008339f06a" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/e9849763-dca6-4c69-a23c-d561fa1a67dd" />

## Apps managed

PhotoCraft, VectorCraft, FilmCraft, LightCraft, PdfCraft, EffectCraft, DesignCraft, WordCraft, CADCraft, SoundCraft, GridCraft and DeckCraft.

## Features

- **All 12 apps in one window** with per-app status (`Up to date`, `Update vX → vY`, `Not installed`).
- **Platform dropdown** (Windows / macOS / Linux) mirroring the layout of the official site, with the recommended download first and every other format listed below.
- **Auto-checks for updates on launch** and on demand, and quietly re-scans local installs every few seconds so apps installed or removed outside the updater are picked up without a manual refresh.
- **SHA-256 verification** of every download against the release's `SHA256SUMS.txt`.
- **Portable installs** (`.zip`, `.tar.gz`, `.AppImage`) install automatically into `<chosen folder>/<App Name>/`
- **System installers** (`.msi`, `.dmg`, `.deb`, `.rpm`, `.flatpak`) are downloaded, verified, then opened with your OS installer.
- **Detects system installs** already on your machine (Windows registry, macOS `.app` bundles, and Linux package managers including `pacman`/AUR, `dpkg`, `rpm` and Flatpak) and reports their real installed version.
- **Uninstall** both kinds of install: portable installs are deleted from disk, system installs are removed through the OS uninstaller or package manager (with an administrator prompt where needed).
- **Right-click context menu** on any app in the list for quick actions: Check for update, Install, Open, Show in folder, Reinstall, Uninstall and View changelog.
- **Settings panel** (gear icon): check for updates on start, Dark/Light theme (dark by default), automatic install scanning, uninstall confirmation, and a global portable install folder (you're asked for one the first time if it's unset).
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
6. System installs are detected from the host OS on every check: the Windows uninstall registry, macOS `.app` bundles in `/Applications`, and the Linux package databases (`pacman`, `dpkg`, `rpm`) plus Flatpak. Detected installs show their real version, status and can be opened. On Arch and other AUR installs the package manager owns updates, so the updater detects and opens the app but does not reinstall it.

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

- The updater can only detect system installs on the machine it runs on; the platform dropdown only changes which downloads are shown.
- When a system install can't be detected (for example a `.dmg` the user hasn't dragged to `/Applications`, or an unusual install location), the updater falls back to the last version it handed to the OS installer and labels it "Installer handed off".
- Flatpak apps are opened through `flatpak run`; Arch/AUR (`pacman`) installs are detected and opened but updates stay with the package manager.
- Uninstalling a system install runs the OS uninstaller (`msiexec` on Windows), moves the `.app` to the Trash on macOS, or invokes the package manager (`apt`/`dpkg`, `dnf`/`zypper`/`rpm`, `pacman`, `flatpak`) on Linux. Linux and per-machine Windows uninstalls need administrator permission, so a system prompt appears.
- .github/workflows/release.yml and package.json are used to create the builds for Releases

## Contributing
Contributions are welcome, fork the project, do what you want to do and open a PR.

## AI Notice
AI was used to assist in the creation of this application.

## License

MIT
