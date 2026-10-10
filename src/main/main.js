'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');

const { APPS, CATEGORIES, getApp } = require('./apps.config');
const { detectPlatform, OS_LABELS } = require('./platform');
const { getLatestRelease, fetchText, getLatestReleaseNotes } = require('./github');
const {
  resolveAssets,
  parseSums,
  parseAsset,
  versionFromTag,
  compareVersions,
  humanSize
} = require('./resolver');
const { downloadFile, cancelDownload } = require('./downloader');
const { installPortable, openInstaller, openFlatpak, findLaunchTarget, checkDirectory } = require('./installer');
const { createStore } = require('./state');
const { detectSystemInstalls, detectSystemInstall } = require('./system-installs');
const { uninstallPortable, uninstallSystem } = require('./uninstaller');

let store = null;
let mainWindow = null;

// appId -> { release, sumsUrl } from the last check.
const releaseCache = new Map();

// The updater's own repository, used to check for launcher updates.
const UPDATER_REPO = 'Lyraedan/ArtCraft-Suit-Updater';

const downloadsDir = () => path.join(app.getPath('userData'), 'downloads');

function computeStatus(installedVersion, latestVersion) {
  if (!installedVersion) return 'not-installed';
  if (latestVersion && compareVersions(installedVersion, latestVersion) < 0) return 'outdated';
  return 'current';
}

function sendProgress(appId, received, total, phase) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download:progress', { appId, received, total, phase });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#111318',
    title: `ArtCraft Suite Updater v${app.getVersion()}`,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// Works out what (if anything) is installed for one app from our state file and
// the OS detection result. Shared by the full update check and the light
// periodic scan, so both report the same thing.
async function resolveInstalledState(appConfig, systemInfo, detectionScanned, latestVersion) {
  const installed = await store.get(appConfig.id);

  // Portable installs carry the real installed version in our state file.
  // System installs (msi/dmg/deb/rpm/flatpak/pacman) are detected from the OS.
  // Only when detection could not run do we fall back to the last version we
  // handed to the OS installer, labelled as "handed off" rather than installed.
  const portableVersion = installed && installed.version ? installed.version : null;
  let installedVersion = null;
  let managedByInstaller = false;
  let systemInstall = false;
  let systemSource = null;
  let flatpakApp = null;
  let launchPath = installed ? installed.launchPath || null : null;
  let installDir = installed ? installed.installDir || null : null;
  let installedFormat = installed ? installed.format || null : null;
  let canOpen = false;

  if (portableVersion) {
    installedVersion = portableVersion;
    canOpen = Boolean(launchPath || installDir || (installed && installed.appPath));
  } else if (systemInfo && systemInfo.installed) {
    systemInstall = true;
    systemSource = systemInfo.source;
    installedVersion = systemInfo.version || null;
    installedFormat = systemInfo.source;
    installDir = systemInfo.location || installDir;
    launchPath = systemInfo.launchTarget || null;
    flatpakApp = systemInfo.flatpakApp || null;
    canOpen = Boolean(launchPath || flatpakApp);
  } else if (installed && installed.lastDownloadedVersion && !detectionScanned) {
    managedByInstaller = true;
    installedVersion = installed.lastDownloadedVersion;
  }

  const canReveal = Boolean(installDir || launchPath || (installed && installed.appPath));
  const status = systemInstall && !installedVersion ? 'installed' : computeStatus(installedVersion, latestVersion);

  return {
    installedVersion,
    managedByInstaller,
    systemInstall,
    systemSource,
    flatpakApp,
    installedFormat,
    canOpen,
    canReveal,
    installDir,
    baseDir: installed ? installed.baseDir || null : null,
    installedAssetName: installed ? installed.assetName || null : null,
    status
  };
}

async function checkApp(appConfig, os, arch, systemInfo, detectionScanned = false) {
  const release = await getLatestRelease(appConfig.repo);
  const assets = (release.assets || []).map((asset) => ({
    name: asset.name,
    browser_download_url: asset.browser_download_url,
    size: asset.size
  }));

  const resolved = resolveAssets(assets, os, arch).map((item) => ({
    ...item,
    sizeLabel: humanSize(item.size)
  }));

  const sumsAsset = (release.assets || []).find((asset) => asset.name === 'SHA256SUMS.txt');
  const sumsUrl = sumsAsset ? sumsAsset.browser_download_url : null;
  releaseCache.set(appConfig.id, { release, sumsUrl });

  const latestVersion = versionFromTag(release.tag_name);
  const installedState = await resolveInstalledState(appConfig, systemInfo, detectionScanned, latestVersion);

  return {
    id: appConfig.id,
    tag: release.tag_name,
    title: release.name || appConfig.name,
    latestVersion,
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    notes: release.body || '',
    assets: resolved,
    sumsUrl,
    ...installedState
  };
}

function registerIpc() {
  ipcMain.handle('apps:list', async () => ({
    apps: APPS,
    categories: CATEGORIES,
    platform: detectPlatform(),
    osLabels: OS_LABELS,
    version: app.getVersion()
  }));

  // Checks the updater's own version against its latest GitHub release. The app
  // can't update itself; when a newer version exists the UI links to the
  // releases page so the user can download it.
  ipcMain.handle('update:check', async () => {
    const currentVersion = app.getVersion();
    const releasesUrl = `https://github.com/${UPDATER_REPO}/releases`;
    try {
      const release = await getLatestRelease(UPDATER_REPO);
      const latestVersion = versionFromTag(release.tag_name);
      const updateAvailable =
        Boolean(latestVersion) && compareVersions(currentVersion, latestVersion) < 0;
      return { currentVersion, latestVersion, updateAvailable, releasesUrl };
    } catch (err) {
      return { currentVersion, error: err.message, releasesUrl };
    }
  });

  ipcMain.handle('releases:check', async (_event, { os, appId } = {}) => {
    const detected = detectPlatform();
    const targetOs = os || detected.os;
    const targetArch = targetOs === detected.os ? detected.arch : os === 'macos' ? 'universal' : targetOs === 'windows' ? 'x64' : 'x86_64';
    const targets = appId ? APPS.filter((item) => item.id === appId) : APPS;

    // Detect system installs once for the host OS; detection is local to this
    // machine even when the user is browsing another platform's downloads.
    let systemInstalls = {};
    let detectionScanned = false;
    try {
      const detection = await detectSystemInstalls(targets, { platform: process.platform });
      systemInstalls = detection.installs;
      detectionScanned = detection.scanned;
    } catch {
      systemInstalls = {};
      detectionScanned = false;
    }

    const results = await Promise.all(
      targets.map(async (appConfig) => {
        try {
          return await checkApp(appConfig, targetOs, targetArch, systemInstalls[appConfig.id], detectionScanned);
        } catch (err) {
          return {
            id: appConfig.id,
            error: err.message,
            errorCode: err.code || 'error',
            status: 'error'
          };
        }
      })
    );

    return { os: targetOs, arch: targetArch, checkedAt: new Date().toISOString(), apps: results };
  });

  // Light periodic scan: re-detects local (system and portable) installs without
  // touching the network, so an app installed or removed outside the updater is
  // picked up. Versions still come from the last release check in releaseCache.
  ipcMain.handle('installs:scan', async () => {
    let detection = { installs: {}, scanned: false };
    try {
      detection = await detectSystemInstalls(APPS, { platform: process.platform });
    } catch {
      detection = { installs: {}, scanned: false };
    }

    const apps = await Promise.all(
      APPS.map(async (appConfig) => {
        const cached = releaseCache.get(appConfig.id);
        const latestVersion = cached ? versionFromTag(cached.release.tag_name) : null;
        const state = await resolveInstalledState(
          appConfig,
          detection.installs[appConfig.id],
          detection.scanned,
          latestVersion
        );
        return { id: appConfig.id, ...state };
      })
    );

    return { scanned: detection.scanned, apps };
  });

  // Pops a native context menu from a list of renderer-supplied items and
  // resolves with the chosen item id (or null when dismissed).
  ipcMain.handle('show-context-menu', async (event, { items } = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const list = Array.isArray(items) ? items : [];

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const template = list.map((item) => {
        if (item && item.type === 'separator') return { type: 'separator' };
        return {
          label: String((item && item.label) || ''),
          enabled: !item || item.enabled !== false,
          click: () => finish(item.id)
        };
      });

      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window, callback: () => finish(null) });
    });
  });

  ipcMain.handle('download', async (_event, { appId, assetName } = {}) => {
    const appConfig = getApp(appId);
    if (!appConfig) throw new Error('Unknown app.');

    // The last check usually has the release cached, but the cache is cleared
    // when an app is uninstalled and is empty if the app was never checked in
    // this session. Fall back to resolving the latest release on demand rather
    // than refusing to download.
    let cached = releaseCache.get(appId);
    if (!cached) {
      const release = await getLatestRelease(appConfig.repo);
      const sumsAsset = (release.assets || []).find((item) => item.name === 'SHA256SUMS.txt');
      cached = { release, sumsUrl: sumsAsset ? sumsAsset.browser_download_url : null };
      releaseCache.set(appId, cached);
    }

    const asset = (cached.release.assets || []).find((item) => item.name === assetName);
    if (!asset) throw new Error(`Asset not found in the latest release: ${assetName}`);

    const parsed = parseAsset(asset.name);
    if (!parsed) throw new Error(`Unrecognised asset name: ${asset.name}`);

    let expectedSha256 = null;
    if (cached.sumsUrl) {
      try {
        const sums = parseSums(await fetchText(cached.sumsUrl));
        expectedSha256 = sums[asset.name] || null;
      } catch {
        expectedSha256 = null; // verification is best-effort
      }
    }

    const dest = path.join(downloadsDir(), appId, asset.name);
    const result = await downloadFile(asset.browser_download_url, dest, {
      id: appId,
      expectedSha256,
      onProgress: (progress) => sendProgress(appId, progress.received, progress.total, 'downloading')
    });

    return {
      archivePath: result.path,
      sha256: result.sha256,
      size: result.size,
      verified: Boolean(expectedSha256),
      ext: parsed.ext,
      kind: parsed.kind,
      tag: cached.release.tag_name,
      version: versionFromTag(cached.release.tag_name)
    };
  });

  ipcMain.handle('install', async (_event, { appId, archivePath, ext, kind, targetDir, version, tag } = {}) => {
    const appConfig = getApp(appId);
    if (!appConfig) throw new Error('Unknown app.');

    if (kind === 'portable') {
      if (!targetDir) throw new Error('Choose an install folder first.');
      // The folder the user picks is a shared parent; each app gets its own
      // subfolder so several apps can live side by side.
      const baseDir = targetDir;
      const appDir = path.join(baseDir, appConfig.name);
      sendProgress(appId, 0, 0, 'installing');
      const result = await installPortable({ archivePath, ext, targetDir: appDir, appId });
      await store.set(appId, {
        version,
        tag,
        format: ext,
        kind: 'portable',
        assetName: path.basename(archivePath),
        baseDir,
        installDir: result.targetDir,
        appPath: result.appPath,
        launchPath: result.launchPath || null,
        installedAt: new Date().toISOString()
      });
      sendProgress(appId, 0, 0, 'done');
      return { mode: 'portable', installed: true, ...result };
    }

    const result = await openInstaller(archivePath);
    await store.set(appId, {
      lastDownloadedVersion: version,
      tag,
      format: ext,
      kind: 'installer',
      assetName: path.basename(archivePath),
      lastDownloadedAt: new Date().toISOString()
    });
    sendProgress(appId, 0, 0, 'opened');
    return { mode: 'installer', installed: false, ...result };
  });

  ipcMain.handle('open-app', async (_event, { appId } = {}) => {
    const appConfig = getApp(appId);
    if (!appConfig) throw new Error('Unknown app.');

    const info = await store.get(appId);
    let target = info ? info.launchPath : null;
    if (!target && info && info.installDir) {
      target = await findLaunchTarget(info.installDir, { appId });
      if (target) await store.set(appId, { launchPath: target });
    }
    if (!target && info && info.appPath && info.format === 'AppImage') target = info.appPath;

    if (!target) {
      const detected = await detectSystemInstall(appConfig, { platform: process.platform });
      if (detected && detected.flatpakApp) {
        await openFlatpak(detected.flatpakApp);
        return { opened: true, target: `flatpak:${detected.flatpakApp}` };
      }
      if (detected && detected.launchTarget) target = detected.launchTarget;
    }

    if (!target) throw new Error('Could not locate the installed application to open.');

    const message = await shell.openPath(target);
    if (message) throw new Error(message);
    return { opened: true, target };
  });

  ipcMain.handle('reveal-app', async (_event, { appId } = {}) => {
    const appConfig = getApp(appId);
    const info = await store.get(appId);
    let target = info ? info.launchPath || info.installDir || info.appPath : null;

    if (!target && appConfig) {
      const detected = await detectSystemInstall(appConfig, { platform: process.platform });
      target = detected ? detected.launchTarget || detected.location : null;
    }

    if (!target) throw new Error('Nothing to show for this app.');
    shell.showItemInFolder(target);
    return { revealed: true };
  });

  ipcMain.handle('uninstall', async (_event, { appId } = {}) => {
    const appConfig = getApp(appId);
    if (!appConfig) throw new Error('Unknown app.');

    const info = await store.get(appId);
    const portable = Boolean(info && info.version);
    const detected = portable
      ? null
      : await detectSystemInstall(appConfig, { platform: process.platform });

    if (!portable && !(detected && detected.installed)) {
      throw new Error('No install was found to uninstall. It may have been removed already.');
    }

    const settings = await store.getSettings();
    if (settings.confirmUninstall) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Uninstall', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Uninstall ${appConfig.name}?`,
        detail: portable
          ? 'This permanently deletes the portable install and its files.'
          : 'This runs your system uninstaller or package manager. You may be asked for administrator permission.'
      });
      if (response !== 0) return { uninstalled: false, cancelled: true };
    }

    if (portable) {
      await uninstallPortable({
        appId,
        installDir: info.installDir,
        appPath: info.appPath,
        baseDir: info.baseDir,
        format: info.format,
        downloadsDir: downloadsDir()
      });
      await store.remove(appId);
      releaseCache.delete(appId);
      return { uninstalled: true, mode: 'portable' };
    }

    if (process.platform === 'darwin') {
      const target = detected.location || detected.launchTarget;
      if (!target) throw new Error('Could not locate the application to uninstall.');
      await shell.trashItem(target);
      await store.remove(appId);
      releaseCache.delete(appId);
      return { uninstalled: true, mode: 'system', source: detected.source };
    }

    await uninstallSystem(detected, { platform: process.platform });
    await store.remove(appId);
    releaseCache.delete(appId);
    return { uninstalled: true, mode: 'system', source: detected.source };
  });

  ipcMain.handle('pick-dir', async (_event, { appId, title } = {}) => {
    const appConfig = getApp(appId);
    const dialogTitle =
      title ||
      (appConfig
        ? `Choose a folder to install ${appConfig.name} into (a "${appConfig.name}" subfolder is created)`
        : 'Choose an install folder');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: dialogTitle,
      buttonLabel: 'Select folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  // Validates a portable install folder. Does not create anything: a path that
  // doesn't exist yet is fine and is created later, on install.
  ipcMain.handle('check-dir', async (_event, { dir } = {}) => checkDirectory(dir));

  ipcMain.handle('state:get', async () => store.getAll());

  ipcMain.handle('settings:get', async () => store.getSettings());

  ipcMain.handle('settings:set', async (_event, patch) => store.setSettings(patch));

  ipcMain.handle('release-notes', async (_event, { appId } = {}) => {
    const appConfig = getApp(appId);
    if (!appConfig) throw new Error('Unknown app.');
    return getLatestReleaseNotes(appConfig.repo);
  });

  ipcMain.handle('download:cancel', async (_event, { appId } = {}) => cancelDownload(appId));

  ipcMain.handle('shell:open-external', async (_event, { url } = {}) => {
    if (url && /^https?:\/\//.test(url)) await shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'));
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
