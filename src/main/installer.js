'use strict';

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

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

// Auto-installs portable artifacts (.zip / .tar.gz / .AppImage) into targetDir.
// Existing contents are swapped out atomically so updates replace cleanly.
async function installPortable({ archivePath, ext, targetDir }) {
  if (!targetDir) throw new Error('No install folder was provided.');
  await fsp.mkdir(targetDir, { recursive: true });

  if (ext === 'AppImage') {
    const dest = path.join(targetDir, path.basename(archivePath));
    await fsp.copyFile(archivePath, dest);
    await fsp.chmod(dest, 0o755);
    return { appPath: dest, targetDir };
  }

  const staging = `${targetDir}.new-${randomSuffix()}`;
  const backup = `${targetDir}.old-${randomSuffix()}`;
  await fsp.mkdir(staging, { recursive: true });
  try {
    await extractArchive(archivePath, ext, staging);
    if (await exists(targetDir)) await fsp.rename(targetDir, backup);
    await fsp.rename(staging, targetDir);
    await fsp.rm(backup, { recursive: true, force: true }).catch(() => {});
    return { appPath: targetDir, targetDir };
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

module.exports = { installPortable, openInstaller, extractArchive };
