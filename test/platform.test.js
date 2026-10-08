'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectPlatform, detectOs, archToken } = require('../src/main/platform');

test('detectPlatform maps Windows architectures', () => {
  assert.deepEqual(detectPlatform('win32', 'x64'), { os: 'windows', arch: 'x64', rawArch: 'x64' });
  assert.deepEqual(detectPlatform('win32', 'arm64'), { os: 'windows', arch: 'arm64', rawArch: 'arm64' });
  assert.equal(detectPlatform('win32', 'ia32').arch, 'x86');
});

test('detectPlatform maps macOS to universal', () => {
  assert.equal(detectPlatform('darwin', 'arm64').os, 'macos');
  assert.equal(detectPlatform('darwin', 'x64').arch, 'universal');
});

test('detectPlatform maps Linux architectures', () => {
  assert.equal(detectPlatform('linux', 'x64').arch, 'x86_64');
  assert.equal(detectPlatform('linux', 'arm64').arch, 'aarch64');
});

test('detectOs and archToken helpers', () => {
  assert.equal(detectOs('darwin'), 'macos');
  assert.equal(detectOs('win32'), 'windows');
  assert.equal(detectOs('linux'), 'linux');
  assert.equal(archToken('linux', 'arm64'), 'aarch64');
});
