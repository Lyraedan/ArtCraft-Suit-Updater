'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const { APPS, getApp } = require('./apps.config');
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
const { installPortable, openInstaller, findLaunchTarget } = require('./installer');
const { createStore } = require('./state');

let store = null;
let mainWindow = null;

// appId -> { release, sumsUrl } from the last check.
const releaseCache = new Map();

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
    title: 'ArtCraft Suite Updater',
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

async function checkApp(appConfig, os, arch) {
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
  const installed = await store.get(appConfig.id);
  // For portable installs we know the real installed version. For system
  // installers (msi/dmg/deb/...) we can only record the last thing we handed
  // to the OS installer, so track it separately and label it as such.
  const managedByInstaller = Boolean(installed && !installed.version && installed.lastDownloadedVersion);
  const recordedVersion = installed ? installed.version || installed.lastDownloadedVersion || null : null;

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
    installedVersion: recordedVersion,
    managedByInstaller,
    installedFormat: installed ? installed.format || null : null,
    canOpen: Boolean(installed && !managedByInstaller && (installed.launchPath || installed.installDir || installed.appPath)),
    installDir: installed ? installed.installDir || null : null,
    baseDir: installed ? installed.baseDir || null : null,
    installedAssetName: installed ? installed.assetName || null : null,
    status: computeStatus(recordedVersion, latestVersion)
  };
}

function registerIpc() {
  ipcMain.handle('apps:list', async () => ({
    apps: APPS,
    platform: detectPlatform(),
    osLabels: OS_LABELS
  }));

  ipcMain.handle('releases:check', async (_event, { os } = {}) => {
    const detected = detectPlatform();
    const targetOs = os || detected.os;
    const targetArch = targetOs === detected.os ? detected.arch : os === 'macos' ? 'universal' : targetOs === 'windows' ? 'x64' : 'x86_64';

    const results = await Promise.all(
      APPS.map(async (appConfig) => {
        try {
          return await checkApp(appConfig, targetOs, targetArch);
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

  ipcMain.handle('download', async (_event, { appId, assetName } = {}) => {
    const appConfig = getApp(appId);
    if (!appConfig) throw new Error('Unknown app.');

    const cached = releaseCache.get(appId);
    if (!cached) throw new Error('Check for updates before downloading.');

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
    const info = await store.get(appId);
    if (!info) throw new Error('This app is not installed yet.');

    let target = info.launchPath;
    if (!target && info.installDir) {
      target = await findLaunchTarget(info.installDir, { appId });
      if (target) await store.set(appId, { launchPath: target });
    }
    if (!target && info.appPath && info.format === 'AppImage') target = info.appPath;
    if (!target) throw new Error('Could not locate the installed application to open.');

    const message = await shell.openPath(target);
    if (message) throw new Error(message);
    return { opened: true, target };
  });

  ipcMain.handle('reveal-app', async (_event, { appId } = {}) => {
    const info = await store.get(appId);
    if (!info) throw new Error('This app is not installed yet.');
    const target = info.launchPath || info.installDir || info.appPath;
    if (!target) throw new Error('Nothing to show for this app.');
    shell.showItemInFolder(target);
    return { revealed: true };
  });

  ipcMain.handle('pick-dir', async (_event, { appId } = {}) => {
    const appConfig = getApp(appId);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: appConfig
        ? `Choose a folder to install ${appConfig.name} into (a "${appConfig.name}" subfolder is created)`
        : 'Choose an install folder',
      buttonLabel: 'Select folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('state:get', async () => store.getAll());

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
