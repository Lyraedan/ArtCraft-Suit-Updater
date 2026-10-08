'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAsset,
  resolveAssets,
  parseSums,
  versionFromTag,
  compareVersions,
  humanSize
} = require('../src/main/resolver');

test('parseAsset recognises the Windows installer', () => {
  const asset = parseAsset('photocraft-0.5.0-windows-x64.msi');
  assert.equal(asset.os, 'windows');
  assert.equal(asset.arch, 'x64');
  assert.equal(asset.ext, 'msi');
  assert.equal(asset.kind, 'installer');
});

test('parseAsset recognises the Windows portable zip', () => {
  const asset = parseAsset('photocraft-0.5.0-windows-arm64-portable.zip');
  assert.equal(asset.arch, 'arm64');
  assert.equal(asset.portable, true);
  assert.equal(asset.kind, 'portable');
});

test('parseAsset handles the historical printcraft prefix drift', () => {
  const asset = parseAsset('printcraft-0.2.1-windows-x64.msi');
  assert.equal(asset.os, 'windows');
  assert.equal(asset.kind, 'installer');
});

test('parseAsset recognises macOS and Linux artifacts', () => {
  assert.equal(parseAsset('lightcraft-0.4.0-macos-universal.dmg').arch, 'universal');
  assert.equal(parseAsset('photocraft-0.5.0-linux-x86_64.AppImage').kind, 'portable');
  assert.equal(parseAsset('photocraft-0.5.0-linux-aarch64.tar.gz').kind, 'portable');
  assert.equal(parseAsset('photocraft-0.5.0-linux-x86_64.flatpak').kind, 'installer');
});

test('parseAsset ignores non-platform and invalid names', () => {
  assert.equal(parseAsset('photocraft-web-0.5.0.zip'), null);
  assert.equal(parseAsset('SHA256SUMS.txt'), null);
  assert.equal(parseAsset('photocraft-windows-x64.zip'), null);
  assert.equal(parseAsset(''), null);
});

test('resolveAssets orders the detected arch and primary format first', () => {
  const assets = [
    { name: 'photocraft-0.5.0-windows-x86.msi', browser_download_url: 'a', size: 1 },
    { name: 'photocraft-0.5.0-windows-x64-portable.zip', browser_download_url: 'b', size: 2 },
    { name: 'photocraft-0.5.0-windows-x64.msi', browser_download_url: 'c', size: 3 },
    { name: 'photocraft-0.5.0-linux-x86_64.AppImage', browser_download_url: 'd', size: 4 }
  ];
  const list = resolveAssets(assets, 'windows', 'x64');
  assert.equal(list.length, 3);
  assert.equal(list[0].name, 'photocraft-0.5.0-windows-x64.msi');
  assert.equal(list[0].label, 'Installer (64-bit)');
});

test('resolveAssets filters to one OS', () => {
  const assets = [
    { name: 'photocraft-0.5.0-macos-universal.dmg', browser_download_url: 'a', size: 1 },
    { name: 'photocraft-0.5.0-windows-x64.msi', browser_download_url: 'b', size: 2 }
  ];
  const list = resolveAssets(assets, 'macos', 'universal');
  assert.equal(list.length, 1);
  assert.equal(list[0].ext, 'dmg');
});

test('parseSums reads checksum files', () => {
  const text = [
    'a'.repeat(64) + '  photocraft-0.5.0-windows-x64.msi',
    'B'.repeat(64) + ' *photocraft-0.5.0-macos-universal.dmg',
    'not a line'
  ].join('\n');
  const sums = parseSums(text);
  assert.equal(sums['photocraft-0.5.0-windows-x64.msi'], 'a'.repeat(64));
  assert.equal(sums['photocraft-0.5.0-macos-universal.dmg'], 'b'.repeat(64));
  assert.equal(Object.keys(sums).length, 2);
});

test('version helpers', () => {
  assert.equal(versionFromTag('v0.5.0'), '0.5.0');
  assert.equal(compareVersions('0.4.0', '0.5.0'), -1);
  assert.equal(compareVersions('0.5.0', '0.5.0'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
});

test('humanSize formats bytes', () => {
  assert.equal(humanSize(0), '');
  assert.equal(humanSize(1024), '1.0 KB');
  assert.equal(humanSize(1536), '1.5 KB');
  assert.equal(humanSize(52.41 * 1024 * 1024), '52 MB');
});
