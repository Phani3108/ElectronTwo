const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getEnv: (key) => ipcRenderer.invoke('get-env', key),
  getMicPermission: () => ipcRenderer.invoke('get-mic-permission'),
  requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),
});
