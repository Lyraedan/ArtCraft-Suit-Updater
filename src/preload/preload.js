'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listApps: () => ipcRenderer.invoke('apps:list'),
  checkUpdater: () => ipcRenderer.invoke('update:check'),
  checkAll: (options) => ipcRenderer.invoke('releases:check', options || {}),
  scanInstalls: () => ipcRenderer.invoke('installs:scan'),
  showContextMenu: (items) => ipcRenderer.invoke('show-context-menu', { items }),
  download: (options) => ipcRenderer.invoke('download', options),
  install: (options) => ipcRenderer.invoke('install', options),
  pickDir: (appIdOrOptions) =>
    ipcRenderer.invoke(
      'pick-dir',
      typeof appIdOrOptions === 'string' ? { appId: appIdOrOptions } : appIdOrOptions || {}
    ),
  checkDir: (dir) => ipcRenderer.invoke('check-dir', { dir }),
  openApp: (appId) => ipcRenderer.invoke('open-app', { appId }),
  revealApp: (appId) => ipcRenderer.invoke('reveal-app', { appId }),
  uninstall: (appId) => ipcRenderer.invoke('uninstall', { appId }),
  getState: () => ipcRenderer.invoke('state:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  releaseNotes: (appId) => ipcRenderer.invoke('release-notes', { appId }),
  cancel: (appId) => ipcRenderer.invoke('download:cancel', { appId }),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', { url }),
  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('download:progress', listener);
    return () => ipcRenderer.removeListener('download:progress', listener);
  }
});
