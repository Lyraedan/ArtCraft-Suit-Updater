'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

// Uninstalls apps the updater manages, in two flavours:
//   portable  the updater installed the files itself, so it removes them
//   system    the OS owns the install, so the matching uninstaller/package
//             manager is invoked (with elevation when needed)
// Command building is pure so it can be unit tested; execution is injected.

// --- portable installs ---------------------------------------------------

// Guards against ever removing something dangerous (a drive root, the user's
// home, or the shared parent folder rather than the app's own subfolder).
function assertSafeInstallDir(installDir, baseDir) {
  if (!installDir) throw new Error('No install folder is recorded for this app.');
  const resolved = path.resolve(installDir);
  if (resolved === path.parse(resolved).root) {
    throw new Error('Refusing to remove a filesystem root.');
  }
  if (process.env.HOME && resolved === path.resolve(process.env.HOME)) {
    throw new Error('Refusing to remove the home directory.');
  }
  if (baseDir && resolved === path.resolve(baseDir)) {
    throw new Error('Refusing to remove the shared install folder.');
  }
}

async function uninstallPortable({ appId, installDir, appPath, baseDir, format, downloadsDir } = {}) {
  const removed = [];

  if (format === 'AppImage' || (appPath && appPath.toLowerCase().endsWith('.appimage'))) {
    const target = appPath || installDir;
    if (target) {
      await fsp.rm(target, { force: true });
      removed.push(target);
    }
  } else if (installDir) {
    assertSafeInstallDir(installDir, baseDir);
    await fsp.rm(installDir, { recursive: true, force: true });
    removed.push(installDir);
  } else if (appPath) {
    await fsp.rm(appPath, { recursive: true, force: true });
    removed.push(appPath);
  } else {
    throw new Error('No install location is recorded for this app.');
  }

  if (downloadsDir && appId) {
    await fsp.rm(path.join(downloadsDir, appId), { recursive: true, force: true }).catch(() => {});
  }

  return { removed };
}

// --- system installs -----------------------------------------------------

function needsElevation() {
  if (typeof process.getuid !== 'function') return true;
  return process.getuid() !== 0;
}

function withElevation(elevate, file, args) {
  return elevate ? [{ file: 'pkexec', args: [file, ...args] }] : [{ file, args }];
}

function buildLinuxCommands(info, { elevate = needsElevation() } = {}) {
  const commands = [];

  if (info.source === 'flatpak' && info.flatpakApp) {
    // A user install needs no privilege; fall back to an elevated system uninstall.
    commands.push({ file: 'flatpak', args: ['uninstall', '-y', '--user', info.flatpakApp] });
    commands.push(...withElevation(elevate, 'flatpak', ['uninstall', '-y', info.flatpakApp]));
    return commands;
  }

  const pkg = info.packageName;
  if (!pkg) return commands;

  if (info.source === 'pacman') {
    commands.push(...withElevation(elevate, 'pacman', ['-R', '--noconfirm', pkg]));
  } else if (info.source === 'dpkg') {
    commands.push(...withElevation(elevate, 'apt-get', ['remove', '-y', pkg]));
    commands.push(...withElevation(elevate, 'dpkg', ['-r', pkg]));
  } else if (info.source === 'rpm') {
    commands.push(...withElevation(elevate, 'dnf', ['remove', '-y', pkg]));
    commands.push(...withElevation(elevate, 'zypper', ['--non-interactive', 'remove', pkg]));
    commands.push(...withElevation(elevate, 'rpm', ['-e', pkg]));
  }

  return commands;
}

function buildWindowsCommands(info) {
  const commands = [];
  if (info.productCode) commands.push({ file: 'msiexec.exe', args: ['/x', info.productCode] });
  if (info.uninstallString) commands.push({ file: 'cmd.exe', args: ['/c', info.uninstallString] });
  return commands;
}

function buildSystemCommands(info, platform = process.platform, options = {}) {
  if (platform === 'linux') return buildLinuxCommands(info, options);
  if (platform === 'win32') return buildWindowsCommands(info);
  return [];
}

function describeCommand(command) {
  return `${command.file} ${command.args.join(' ')}`;
}

function defaultRun(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') {
        reject(err);
        return;
      }
      resolve({ code: err ? err.code || 1 : 0, stdout, stderr });
    });
  });
}

// Tries each candidate command in turn and stops at the first success. A
// missing tool or a non-zero exit falls through to the next candidate.
async function uninstallSystem(info, { platform = process.platform, run = defaultRun, elevate = needsElevation() } = {}) {
  const commands = buildSystemCommands(info, platform, { elevate });
  if (commands.length === 0) {
    throw new Error('No uninstall method is available for this install.');
  }

  let lastError = null;
  for (const command of commands) {
    try {
      const result = await run(command.file, command.args);
      if (!result || result.code === 0) {
        return { removed: true, command: describeCommand(command) };
      }
      lastError = new Error(`${command.file} exited with code ${result.code}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Uninstall failed.');
}

module.exports = {
  assertSafeInstallDir,
  uninstallPortable,
  needsElevation,
  withElevation,
  buildLinuxCommands,
  buildWindowsCommands,
  buildSystemCommands,
  uninstallSystem
};
