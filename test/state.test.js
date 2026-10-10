'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const { createStore, DEFAULT_SETTINGS } = require('../src/main/state');

test('settings start at defaults and persist changes', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'artcraft-state-'));
  const store = createStore(dir);

  assert.deepEqual(await store.getSettings(), DEFAULT_SETTINGS);

  const saved = await store.setSettings({ theme: 'light' });
  assert.equal(saved.theme, 'light');
  assert.equal(saved.checkOnStart, true);

  const reloaded = createStore(dir);
  assert.equal((await reloaded.getSettings()).theme, 'light');

  await fsp.rm(dir, { recursive: true, force: true });
});

test('app records and settings share one state file', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'artcraft-state-'));
  const store = createStore(dir);
  await store.set('photocraft', { version: '0.5.0' });
  await store.setSettings({ autoScan: false });

  const fresh = createStore(dir);
  assert.equal((await fresh.get('photocraft')).version, '0.5.0');
  assert.equal((await fresh.getSettings()).autoScan, false);

  await fsp.rm(dir, { recursive: true, force: true });
});
