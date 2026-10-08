'use strict';

const OS_NAMES = { win32: 'windows', darwin: 'macos', linux: 'linux' };
const OS_LABELS = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

// Preferred artifact extension for the "primary" download button per OS.
const PRIMARY_EXT = { windows: 'msi', macos: 'dmg', linux: 'AppImage' };

function detectOs(platform) {
  return OS_NAMES[platform] || 'linux';
}

function archToken(os, arch) {
  if (os === 'macos') return 'universal';
  if (os === 'windows') {
    if (arch === 'arm64') return 'arm64';
    if (arch === 'ia32' || arch === 'x86') return 'x86';
    return 'x64';
  }
  // linux (and anything else)
  if (arch === 'arm64') return 'aarch64';
  return 'x86_64';
}

function detectPlatform(platform = process.platform, arch = process.arch) {
  const os = detectOs(platform);
  return { os, arch: archToken(os, arch), rawArch: arch };
}

module.exports = {
  OS_NAMES,
  OS_LABELS,
  PRIMARY_EXT,
  detectOs,
  archToken,
  detectPlatform
};
