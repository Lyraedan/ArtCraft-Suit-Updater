'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pickLaunchTarget } = require('../src/main/installer');

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
