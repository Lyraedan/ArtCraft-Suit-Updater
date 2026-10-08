'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listApps: () => ipcRenderer.invoke('apps:list'),
  checkAll: (os) => ipcRenderer.invoke('releases:check', { os }),
  download: (options) => ipcRenderer.invoke('download', options),
  install: (options) => ipcRenderer.invoke('install', options),
  pickDir: (appId) => ipcRenderer.invoke('pick-dir', { appId }),
  getState: () => ipcRenderer.invoke('state:get'),
  cancel: (appId) => ipcRenderer.invoke('download:cancel', { appId }),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', { url }),
  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('download:progress', listener);
    return () => ipcRenderer.removeListener('download:progress', listener);
  }
});
