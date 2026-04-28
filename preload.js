const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // env + mic
  getEnv: (key) => ipcRenderer.invoke('get-env', key),
  getMicPermission: () => ipcRenderer.invoke('get-mic-permission'),
  requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),

  // config (API keys + prefs)
  configGetAll: () => ipcRenderer.invoke('config:get-all'),
  configSet: (key, value) => ipcRenderer.invoke('config:set', key, value),

  // health pre-flight
  probeServices: () => ipcRenderer.invoke('services:probe'),

  // Test one provider's credentials. `overrides` lets settings UI test what
  // the user just typed before saving.
  keyTest: (provider, overrides) => ipcRenderer.invoke('key:test', provider, overrides),

  // app lifecycle
  quit: () => ipcRenderer.invoke('app:quit'),

  // paths + shell
  profilesRoot: () => ipcRenderer.invoke('profiles:root'),
  openPath: (target) => ipcRenderer.invoke('open-path', target),

  // profile IO
  profileList: () => ipcRenderer.invoke('profile:list'),
  profileRead: (name) => ipcRenderer.invoke('profile:read', name),
  profileExport: (name) => ipcRenderer.invoke('profile:export', name),
  profileImport: () => ipcRenderer.invoke('profile:import'),

  // embeddings
  embeddingsCompute: (texts) => ipcRenderer.invoke('embeddings:compute', texts),

  // RAG cache
  ragLoad: (profileName) => ipcRenderer.invoke('rag:load', profileName),
  ragSave: (profileName, payload) => ipcRenderer.invoke('rag:save', profileName, payload),

  // session persistence
  sessionSave: (sessionId, payload) => ipcRenderer.invoke('session:save', sessionId, payload),
  sessionLoadLatest: () => ipcRenderer.invoke('session:load-latest'),
  sessionList: () => ipcRenderer.invoke('session:list'),
  sessionRead: (file) => ipcRenderer.invoke('session:read', file),
  sessionImport: () => ipcRenderer.invoke('session:import'),

  // main-process events
  onProfileCycle: (cb) => ipcRenderer.on('profile:cycle', cb),
});
