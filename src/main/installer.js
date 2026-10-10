'use strict';

const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { constants } = require('fs');
const { spawn } = require('child_process');

let extractZip = null;
let tar = null;
let shell = null;
try {
  extractZip = require('extract-zip');
} catch {
  extractZip = null;
}
try {
  tar = require('tar');
} catch {
  tar = null;
}
try {
  ({ shell } = require('electron'));
} catch {
  shell = null;
}

function randomSuffix() {
  return crypto.randomBytes(4).toString('hex');
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function extractArchive(archivePath, ext, targetDir) {
  if (ext === 'zip') {
    if (!extractZip) throw new Error('The extract-zip module is not installed.');
    await extractZip(archivePath, { dir: path.resolve(targetDir) });
    return;
  }
  if (ext === 'tar.gz') {
    if (!tar) throw new Error('The tar module is not installed.');
    await tar.x({ file: archivePath, cwd: targetDir });
    return;
  }
  throw new Error(`Unsupported archive type: ${ext}`);
}

// Recursively collects files and macOS .app bundles for launch detection.
async function collectEntries(dir, depth, out) {
  if (depth > 4) return;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase().endsWith('.app')) {
        out.push({ path: full, bundle: true });
        continue;
      }
      await collectEntries(full, depth + 1, out);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      const stat = await fsp.stat(full).catch(() => null);
      out.push({
        path: full,
        name: entry.name,
        size: stat ? stat.size : 0,
        mode: stat ? stat.mode : 0,
        inBin: /(^|[\\/])bin[\\/]/i.test(full)
      });
    }
  }
}

// Chooses the GUI executable inside an extracted portable install, avoiding
// the `*-cli` companion binaries that ship alongside it. On macOS it returns
// the app bundle. Returns null when nothing suitable is found.
function pickLaunchTarget(entries, appId, platform = process.platform) {
  if (platform === 'darwin') {
    const bundle = entries.find((entry) => entry.bundle);
    if (bundle) return bundle.path;
  }

  const scored = entries
    .filter((entry) => !entry.bundle)
    .map((entry) => {
      const name = entry.name.toLowerCase();
      const stem = name.replace(/\.[^.]+$/, '');
      let score = 0;

      if (stem === appId) score += 100;
      if (stem === `${appId}-cli` || /cli/.test(name)) score -= 1000;
      if (name.startsWith(appId)) score += 30;
      if (entry.inBin) score += 10;

      if (platform === 'win32') {
        if (!name.endsWith('.exe')) score -= 200;
      } else if (entry.mode & 0o111) {
        score += 20;
      } else {
        score -= 50;
      }

      score += Math.min((entry.size || 0) / 1e9, 1);
      return { ...entry, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0) return null;
  return best.path;
}

async function findLaunchTarget(installPath, { appId, platform } = {}) {
  const stat = await fsp.stat(installPath).catch(() => null);
  if (!stat) return null;
  if (stat.isFile()) return installPath; // e.g. an AppImage

  const entries = [];
  await collectEntries(installPath, 0, entries);
  return pickLaunchTarget(entries, appId, platform);
}

// Auto-installs portable artifacts (.zip / .tar.gz / .AppImage) into targetDir.
// Existing contents are swapped out atomically so updates replace cleanly.
async function installPortable({ archivePath, ext, targetDir, appId }) {
  if (!targetDir) throw new Error('No install folder was provided.');
  await fsp.mkdir(targetDir, { recursive: true });

  if (ext === 'AppImage') {
    const dest = path.join(targetDir, path.basename(archivePath));
    await fsp.copyFile(archivePath, dest);
    await fsp.chmod(dest, 0o755);
    return { appPath: dest, targetDir, launchPath: dest };
  }

  const staging = `${targetDir}.new-${randomSuffix()}`;
  const backup = `${targetDir}.old-${randomSuffix()}`;
  await fsp.mkdir(staging, { recursive: true });
  try {
    await extractArchive(archivePath, ext, staging);
    if (await exists(targetDir)) await fsp.rename(targetDir, backup);
    await fsp.rename(staging, targetDir);
    await fsp.rm(backup, { recursive: true, force: true }).catch(() => {});
    const launchPath = await findLaunchTarget(targetDir, { appId });
    return { appPath: targetDir, targetDir, launchPath };
  } catch (err) {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

// For system installers we hand the file to the OS default handler.
async function openInstaller(archivePath) {
  if (!shell) throw new Error('Unable to launch the installer: Electron shell is unavailable.');
  const message = await shell.openPath(archivePath);
  if (message) throw new Error(message);
  return { opened: true };
}

// Flatpak apps are launched through the flatpak CLI rather than shell.openPath.
async function openFlatpak(appId) {
  await new Promise((resolve, reject) => {
    const child = spawn('flatpak', ['run', appId], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  return { opened: true };
}

// Validates a folder the user chose or typed for portable installs. The path
// must be absolute (a leading ~ is expanded); a path that does not exist yet is
// allowed (the installer creates it) as long as its nearest existing parent is
// a writable directory.
async function checkDirectory(dir) {
  let value = String(dir || '').trim();
  if (!value) return { valid: false, reason: 'empty' };
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    value = path.join(os.homedir(), value.slice(1));
  }
  if (!path.isAbsolute(value)) return { valid: false, reason: 'not-absolute' };

  const target = path.resolve(value);
  let stat = null;
  try {
    stat = await fsp.stat(target);
  } catch (err) {
    if (err.code !== 'ENOENT') return { valid: false, reason: 'unreadable' };
  }

  if (stat) {
    if (!stat.isDirectory()) return { valid: false, reason: 'not-directory' };
    try {
      await fsp.access(target, constants.W_OK);
      return { valid: true, exists: true };
    } catch {
      return { valid: false, reason: 'not-writable' };
    }
  }

  // Doesn't exist yet: walk up to the nearest existing ancestor.
  let ancestor = path.dirname(target);
  while (ancestor && ancestor !== path.dirname(ancestor)) {
    try {
      const ancestorStat = await fsp.stat(ancestor);
      if (!ancestorStat.isDirectory()) return { valid: false, reason: 'not-directory' };
      try {
        await fsp.access(ancestor, constants.W_OK);
        return { valid: true, exists: false };
      } catch {
        return { valid: false, reason: 'not-writable' };
      }
    } catch {
      ancestor = path.dirname(ancestor);
    }
  }
  return { valid: false, reason: 'unreadable' };
}

module.exports = {
  installPortable,
  openInstaller,
  openFlatpak,
  extractArchive,
  findLaunchTarget,
  pickLaunchTarget,
  checkDirectory
};
