'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildIdentifiers,
  normalizeVersion,
  parsePacmanList,
  parseDpkgList,
  parseRpmList,
  parseFlatpakList,
  parseFlatpakInfo,
  matchPackage,
  parseWindowsQuery,
  matchUninstallEntries,
  detectLinux
} = require('../src/main/system-installs');

const photocraft = {
  id: 'photocraft',
  name: 'PhotoCraft',
  ids: {
    bundle: 'ai.storyteller.photocraft',
    package: 'photocraft',
    executable: 'photocraft',
    appName: 'PhotoCraft'
  }
};

test('buildIdentifiers derives reverse-DNS ids and package names', () => {
  const ids = buildIdentifiers({ id: 'lightcraft', name: 'LightCraft' });
  assert.equal(ids.bundle, 'ai.storyteller.lightcraft');
  assert.equal(ids.package, 'lightcraft');
  assert.equal(ids.executable, 'lightcraft');
  assert.equal(ids.appName, 'LightCraft');
  assert.equal(ids.publisher, 'Learning Machines LLC');
  assert.deepEqual(ids.aliases, []);
});

test('normalizeVersion strips pacman, rpm and deb suffixes', () => {
  assert.equal(normalizeVersion('0.5.0-1'), '0.5.0');
  assert.equal(normalizeVersion('0.2.0~rc.1'), '0.2.0');
  assert.equal(normalizeVersion('v0.4.0'), '0.4.0');
  assert.equal(normalizeVersion(null), null);
});

test('pacman list parses and matches the package name', () => {
  const map = parsePacmanList('photocraft 0.5.0-1\nvectorcraft 0.7.0-1\n');
  assert.equal(map.photocraft, '0.5.0-1');
  assert.equal(matchPackage(map, ['photocraft']).version, '0.5.0-1');
});

test('dpkg and rpm lists share the pair format', () => {
  assert.equal(parseDpkgList('photocraft\t0.5.0\n').photocraft, '0.5.0');
  assert.equal(parseRpmList('photocraft 0.4.0-1\n').photocraft, '0.4.0-1');
});

test('flatpak list matches the reverse-DNS bundle id', () => {
  const map = parseFlatpakList('ai.storyteller.photocraft\t0.5.0\n');
  assert.equal(matchPackage(map, ['ai.storyteller.photocraft']).version, '0.5.0');
});

test('flatpak list keeps bundles that report no version', () => {
  const map = parseFlatpakList('com.hypixel.HytaleLauncher\t\nai.storyteller.photocraft\n');
  assert.equal(map['com.hypixel.hytalelauncher'], '');
  assert.equal(matchPackage(map, ['ai.storyteller.photocraft']).version, '');
});

test('parseFlatpakInfo reads the Version field', () => {
  const text = '        Ref: app/ai.storyteller.photocraft/x86_64/stable\n     Version: 0.5.0\n';
  assert.equal(parseFlatpakInfo(text), '0.5.0');
  assert.equal(parseFlatpakInfo('no version here'), null);
});

test('matchPackage follows aliases for historical names', () => {
  const map = parsePacmanList('printcraft 0.2.1-1\n');
  assert.equal(matchPackage(map, ['pdfcraft', 'printcraft']).version, '0.2.1-1');
});

test('parseWindowsQuery handles the wrapped and single-object forms', () => {
  const wrapped = parseWindowsQuery(
    JSON.stringify({
      uninstall: [{ DisplayName: 'PhotoCraft', DisplayVersion: '0.5.0' }],
      installDirs: { PhotoCraft: 'C:\\Program Files\\PhotoCraft' }
    })
  );
  assert.equal(wrapped.entries.length, 1);
  assert.equal(wrapped.installDirs.PhotoCraft, 'C:\\Program Files\\PhotoCraft');

  const single = parseWindowsQuery(
    JSON.stringify({ DisplayName: 'PhotoCraft', DisplayVersion: '0.5.0' })
  );
  assert.equal(single.entries.length, 1);
});

test('matchUninstallEntries finds the app and its version', () => {
  const info = matchUninstallEntries(
    [{ DisplayName: 'PhotoCraft', DisplayVersion: '0.5.0', InstallLocation: 'C:\\Program Files\\PhotoCraft' }],
    photocraft
  );
  assert.equal(info.installed, true);
  assert.equal(info.version, '0.5.0');
  assert.equal(info.source, 'msi');
  assert.equal(info.location, 'C:\\Program Files\\PhotoCraft');
});

test('matchUninstallEntries ignores the CLI entry and other apps', () => {
  const info = matchUninstallEntries(
    [
      { DisplayName: 'PhotoCraft CLI', DisplayVersion: '0.5.0' },
      { DisplayName: 'Other', DisplayVersion: '1.0.0' }
    ],
    photocraft
  );
  assert.equal(info, null);
});

test('detectLinux batches package managers and skips missing ones', async () => {
  const calls = [];
  const runner = async (file) => {
    calls.push(file);
    if (file === 'pacman') return 'photocraft 0.5.0-1\n';
    const err = new Error(`${file} not found`);
    err.code = 'ENOENT';
    throw err;
  };
  const fsImpl = { existsSync: () => true };
  const detection = await detectLinux([photocraft], { runner, fsImpl });
  assert.equal(detection.scanned, true);
  assert.equal(detection.installs.photocraft.source, 'pacman');
  assert.equal(detection.installs.photocraft.version, '0.5.0');
  assert.equal(detection.installs.photocraft.launchTarget, '/usr/bin/photocraft');
  assert.ok(calls.includes('dpkg-query'));
  assert.ok(calls.includes('rpm'));
  assert.ok(calls.includes('flatpak'));
});

test('detectLinux fills a missing flatpak version from flatpak info', async () => {
  const runner = async (file, args) => {
    if (file === 'flatpak' && args[0] === 'list') {
      return 'ai.storyteller.photocraft\t\n';
    }
    if (file === 'flatpak' && args[0] === 'info') {
      return '     Version: 0.5.0\n';
    }
    const err = new Error(`${file} not found`);
    err.code = 'ENOENT';
    throw err;
  };
  const detection = await detectLinux([photocraft], { runner, fsImpl: { existsSync: () => false } });
  assert.equal(detection.installs.photocraft.source, 'flatpak');
  assert.equal(detection.installs.photocraft.version, '0.5.0');
  assert.equal(detection.installs.photocraft.flatpakApp, 'ai.storyteller.photocraft');
});

test('detectLinux reports scanned=false when no manager responds', async () => {
  const runner = async () => {
    const err = new Error('not found');
    err.code = 'ENOENT';
    throw err;
  };
  const detection = await detectLinux([photocraft], { runner });
  assert.equal(detection.scanned, false);
  assert.deepEqual(detection.installs, {});
});
