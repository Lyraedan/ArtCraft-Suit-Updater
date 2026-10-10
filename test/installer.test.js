'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const { pickLaunchTarget, checkDirectory } = require('../src/main/installer');

function file(name, extra = {}) {
  return { path: `/tmp/${name}`, name, size: extra.size || 1000, mode: extra.mode || 0o666, inBin: Boolean(extra.inBin) };
}

test('picks the GUI exe over the CLI companion on Windows', () => {
  const entries = [
    file('soundcraft-cli.exe', { size: 7626776 }),
    file('soundcraft.exe', { size: 26162200 })
  ];
  assert.equal(pickLaunchTarget(entries, 'soundcraft', 'win32'), '/tmp/soundcraft.exe');
});

test('picks the GUI binary from bin/ over the CLI on Linux', () => {
  const entries = [
    file('soundcraft-cli', { mode: 0o755, inBin: true }),
    file('soundcraft', { mode: 0o755, inBin: true })
  ];
  assert.equal(pickLaunchTarget(entries, 'soundcraft', 'linux'), '/tmp/soundcraft');
});

test('returns the macOS app bundle', () => {
  const entries = [{ path: '/tmp/PhotoCraft.app', bundle: true }];
  assert.equal(pickLaunchTarget(entries, 'photocraft', 'darwin'), '/tmp/PhotoCraft.app');
});

test('returns null when only the CLI binary is present', () => {
  assert.equal(pickLaunchTarget([file('soundcraft-cli.exe')], 'soundcraft', 'win32'), null);
});

test('ignores non-executable files on Linux', () => {
  const entries = [file('README.md', { mode: 0o644, inBin: false })];
  assert.equal(pickLaunchTarget(entries, 'soundcraft', 'linux'), null);
});

test('checkDirectory accepts an existing folder', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'artcraft-dir-'));
  const result = await checkDirectory(dir);
  assert.equal(result.valid, true);
  assert.equal(result.exists, true);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('checkDirectory rejects a file', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'artcraft-dir-'));
  const file = path.join(dir, 'a.txt');
  await fsp.writeFile(file, 'x');
  const result = await checkDirectory(file);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'not-directory');
  await fsp.rm(dir, { recursive: true, force: true });
});

test('checkDirectory accepts a missing path but does not create it', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'artcraft-dir-'));
  const missing = path.join(dir, 'new', 'sub');
  const result = await checkDirectory(missing);
  assert.equal(result.valid, true);
  assert.equal(result.exists, false);
  await assert.rejects(fsp.access(missing));
  await fsp.rm(dir, { recursive: true, force: true });
});

test('checkDirectory rejects an empty path', async () => {
  assert.equal((await checkDirectory('')).reason, 'empty');
  assert.equal((await checkDirectory('   ')).valid, false);
});

test('checkDirectory rejects a relative path', async () => {
  const result = await checkDirectory('Hello World');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'not-absolute');
});

test('checkDirectory expands a leading tilde to the home directory', async () => {
  const result = await checkDirectory('~');
  assert.equal(result.valid, true);
  assert.equal(result.exists, true);
});
