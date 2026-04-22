const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // env + mic
  getEnv: (key) => ipcRenderer.invoke('get-env', key),
  getMicPermission: () => ipcRenderer.invoke('get-mic-permission'),
  requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),

  // profile IO
  profileList: () => ipcRenderer.invoke('profile:list'),
  profileRead: (name) => ipcRenderer.invoke('profile:read', name),

  // embeddings (OpenAI)
  embeddingsCompute: (texts) => ipcRenderer.invoke('embeddings:compute', texts),

  // RAG cache
  ragLoad: (profileName) => ipcRenderer.invoke('rag:load', profileName),
  ragSave: (profileName, payload) => ipcRenderer.invoke('rag:save', profileName, payload),

  // main-process events
  onProfileCycle: (cb) => ipcRenderer.on('profile:cycle', cb),
});
