'use strict';

const fsp = require('fs/promises');
const path = require('path');

// Tiny JSON-backed store for installed versions, chosen folders, etc.
// Kept independent of Electron so it can be unit tested with a temp dir.
function createStore(baseDir) {
  const file = path.join(baseDir, 'state.json');
  let data = { apps: {} };
  let loaded = false;
  let writeQueue = Promise.resolve();

  async function load() {
    if (loaded) return data;
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      data = parsed && typeof parsed === 'object' ? parsed : { apps: {} };
      if (!data.apps) data.apps = {};
    } catch {
      data = { apps: {} };
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

  return { load, save, get, set, getAll, file };
}

module.exports = { createStore };
