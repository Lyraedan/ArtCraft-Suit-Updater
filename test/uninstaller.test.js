'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  assertSafeInstallDir,
  uninstallPortable,
  buildLinuxCommands,
  buildWindowsCommands,
  buildSystemCommands,
  uninstallSystem
} = require('../src/main/uninstaller');

test('buildLinuxCommands elevates pacman removal with pkexec', () => {
  const commands = buildLinuxCommands({ source: 'pacman', packageName: 'photocraft' }, { elevate: true });
  assert.deepEqual(commands[0], { file: 'pkexec', args: ['pacman', '-R', '--noconfirm', 'photocraft'] });
});

test('buildLinuxCommands removes dpkg packages and falls back to dpkg -r', () => {
  const commands = buildLinuxCommands({ source: 'dpkg', packageName: 'photocraft' }, { elevate: false });
  assert.deepEqual(commands[0], { file: 'apt-get', args: ['remove', '-y', 'photocraft'] });
  assert.deepEqual(commands[1], { file: 'dpkg', args: ['-r', 'photocraft'] });
});

test('buildLinuxCommands covers dnf, zypper and rpm', () => {
  const commands = buildLinuxCommands({ source: 'rpm', packageName: 'photocraft' }, { elevate: false });
  assert.deepEqual(commands.map((command) => command.file), ['dnf', 'zypper', 'rpm']);
});

test('buildLinuxCommands uninstalls flatpak user installs without elevation', () => {
  const commands = buildLinuxCommands(
    { source: 'flatpak', flatpakApp: 'ai.storyteller.photocraft' },
    { elevate: true }
  );
  assert.deepEqual(commands[0], {
    file: 'flatpak',
    args: ['uninstall', '-y', '--user', 'ai.storyteller.photocraft']
  });
  assert.equal(commands[1].file, 'pkexec');
});

test('buildWindowsCommands prefers the MSI product code', () => {
  const commands = buildWindowsCommands({
    productCode: '{11111111-2222-3333-4444-555555555555}',
    uninstallString: 'MsiExec.exe /X{11111111-2222-3333-4444-555555555555}'
  });
  assert.deepEqual(commands[0], {
    file: 'msiexec.exe',
    args: ['/x', '{11111111-2222-3333-4444-555555555555}']
  });
  assert.equal(commands[1].file, 'cmd.exe');
});

test('buildSystemCommands returns nothing for unsupported platforms', () => {
  assert.deepEqual(buildSystemCommands({ source: 'dmg' }, 'darwin'), []);
});

test('uninstallSystem stops at the first successful command', async () => {
  const tried = [];
  const run = async (file, args) => {
    tried.push([file, ...args]);
    if (file === 'apt-get') return { code: 1 };
    return { code: 0 };
  };
  const result = await uninstallSystem(
    { source: 'dpkg', packageName: 'photocraft' },
    { platform: 'linux', run, elevate: false }
  );
  assert.equal(result.removed, true);
  assert.equal(tried.length, 2);
  assert.equal(tried[1][0], 'dpkg');
});

test('uninstallSystem throws when every command fails', async () => {
  const run = async () => ({ code: 1 });
  await assert.rejects(
    uninstallSystem({ source: 'pacman', packageName: 'x' }, { platform: 'linux', run, elevate: false }),
    /exited with code/
  );
});

test('assertSafeInstallDir refuses dangerous paths', () => {
  assert.throws(() => assertSafeInstallDir('/', '/home/user/Apps'), /root/);
  assert.throws(() => assertSafeInstallDir('/home/user/Apps', '/home/user/Apps'), /shared/);
  assert.doesNotThrow(() => assertSafeInstallDir('/home/user/Apps/PhotoCraft', '/home/user/Apps'));
});

test('uninstallPortable removes the app subfolder and its downloads', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'artcraft-'));
  const baseDir = path.join(root, 'Apps');
  const installDir = path.join(baseDir, 'PhotoCraft');
  const downloadsDir = path.join(root, 'downloads');
  await fsp.mkdir(path.join(installDir, 'bin'), { recursive: true });
  await fsp.writeFile(path.join(installDir, 'bin', 'photocraft'), 'x');
  await fsp.mkdir(path.join(downloadsDir, 'photocraft'), { recursive: true });
  await fsp.writeFile(path.join(downloadsDir, 'photocraft', 'a.zip'), 'x');

  await uninstallPortable({ appId: 'photocraft', installDir, baseDir, format: 'zip', downloadsDir });

  await assert.rejects(fsp.access(installDir));
  await assert.rejects(fsp.access(path.join(downloadsDir, 'photocraft')));
  await fsp.rm(root, { recursive: true, force: true });
});
