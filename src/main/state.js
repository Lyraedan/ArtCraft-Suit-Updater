'use strict';

const fsp = require('fs/promises');
const path = require('path');

// User preferences. Kept here so they live in the same JSON file as the
// installed-app records.
const DEFAULT_SETTINGS = {
  checkOnStart: true,
  theme: 'dark',
  autoScan: true,
  confirmUninstall: true,
  portableDir: ''
};

// Tiny JSON-backed store for installed versions, chosen folders, etc.
// Kept independent of Electron so it can be unit tested with a temp dir.
function createStore(baseDir) {
  const file = path.join(baseDir, 'state.json');
  let data = { apps: {}, settings: {} };
  let loaded = false;
  let writeQueue = Promise.resolve();

  async function load() {
    if (loaded) return data;
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      data = parsed && typeof parsed === 'object' ? parsed : { apps: {}, settings: {} };
      if (!data.apps) data.apps = {};
      if (!data.settings || typeof data.settings !== 'object') data.settings = {};
    } catch {
      data = { apps: {}, settings: {} };
    }
    loaded = true;
    return data;
  }

  function save() {
    writeQueue = writeQueue.then(async () => {
      await fsp.mkdir(baseDir, { recursive: true });
      await fsp.writeFile(file, JSON.stringify(data, null, 2));
    });
    return writeQueue;
  }

  async function get(appId) {
    await load();
    return data.apps[appId] || null;
  }

  async function set(appId, info) {
    await load();
    data.apps[appId] = { ...(data.apps[appId] || {}), ...info };
    await save();
    return data.apps[appId];
  }

  async function getAll() {
    await load();
    return data.apps;
  }

  async function remove(appId) {
    await load();
    delete data.apps[appId];
    await save();
  }

  async function getSettings() {
    await load();
    return { ...DEFAULT_SETTINGS, ...data.settings };
  }

  async function setSettings(patch) {
    await load();
    data.settings = { ...data.settings, ...(patch || {}) };
    await save();
    return { ...DEFAULT_SETTINGS, ...data.settings };
  }

  return { load, save, get, set, getAll, remove, getSettings, setSettings, file };
}

module.exports = { createStore, DEFAULT_SETTINGS };
