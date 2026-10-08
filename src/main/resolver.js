'use strict';

const { PRIMARY_EXT } = require('./platform');

// Matches the tail of every release artifact name, e.g.
//   photocraft-0.5.0-windows-x64.msi
//   printcraft-0.2.1-windows-x64-portable.zip   (historical prefix drift)
//   photocraft-0.5.0-macos-universal.dmg
//   photocraft-0.5.0-linux-x86_64.AppImage
const ASSET_RE =
  /-(windows|macos|linux|freebsd)-(x64|x86|arm64|universal|x86_64|aarch64)(-portable)?\.(msi|zip|dmg|AppImage|deb|rpm|tar\.gz|flatpak)$/;

const INSTALLER_EXTS = new Set(['msi', 'dmg', 'deb', 'rpm', 'flatpak']);

const ARCH_LABEL = {
  x64: '64-bit',
  x86: '32-bit',
  arm64: 'ARM64',
  universal: 'Universal',
  x86_64: 'x86_64',
  aarch64: 'ARM64'
};

function parseAsset(name) {
  const match = ASSET_RE.exec(name || '');
  if (!match) return null;
  const os = match[1];
  const arch = match[2];
  const portable = Boolean(match[3]);
  const ext = match[4];
  // A Windows .zip is only valid when it is the explicit portable build.
  if (os === 'windows' && ext === 'zip' && !portable) return null;
  const kind = INSTALLER_EXTS.has(ext) ? 'installer' : 'portable';
  return { name, os, arch, portable, ext, kind };
}

function labelFor(asset) {
  const arch = ARCH_LABEL[asset.arch] || asset.arch;
  switch (asset.ext) {
    case 'msi':
      return `Installer (${arch})`;
    case 'zip':
      return `Portable (${arch})`;
    case 'dmg':
      return `Disk image (${arch})`;
    case 'AppImage':
      return `AppImage (${arch})`;
    case 'deb':
      return `Debian package (${arch})`;
    case 'rpm':
      return `RPM package (${arch})`;
    case 'tar.gz':
      return `Tarball (${arch})`;
    case 'flatpak':
      return `Flatpak (${arch})`;
    default:
      return `${asset.ext} (${arch})`;
  }
}

// Returns the artifacts for one OS, best match for the detected arch first.
// Input items are GitHub release assets: { name, browser_download_url, size }.
function resolveAssets(assets, os, arch) {
  const primaryExt = PRIMARY_EXT[os];
  const list = [];

  for (const asset of assets || []) {
    const parsed = parseAsset(asset.name);
    if (!parsed || parsed.os !== os) continue;
    list.push({
      ...parsed,
      url: asset.browser_download_url,
      size: asset.size,
      label: labelFor(parsed)
    });
  }

  const score = (item) => {
    let value = 0;
    if (item.arch === arch) value += 100;
    if (item.arch === 'universal') value += 20;
    if (item.ext === primaryExt) value += 50;
    if (item.kind === 'installer') value += 5;
    return value;
  };

  return list.sort((a, b) => score(b) - score(a));
}

// Parses a SHA256SUMS.txt body into { filename: hash }.
function parseSums(text) {
  const map = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match) map[match[2]] = match[1].toLowerCase();
  }
  return map;
}

function versionFromTag(tag) {
  if (!tag) return null;
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(tag);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : String(tag).replace(/^v/, '');
}

function parseVersion(value) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value || '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

// Returns -1, 0 or 1.
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

function humanSize(bytes) {
  if (!bytes || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const decimals = index === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[index]}`;
}

module.exports = {
  parseAsset,
  labelFor,
  resolveAssets,
  parseSums,
  versionFromTag,
  parseVersion,
  compareVersions,
  humanSize
};
