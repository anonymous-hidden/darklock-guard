const { contextBridge, ipcRenderer } = require('electron');

// Secure IPC bridge — only expose specific methods
contextBridge.exposeInMainWorld('darklock', {
  // Encrypted store
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    delete: (key) => ipcRenderer.invoke('store:delete', key),
    clear: () => ipcRenderer.invoke('store:clear')
  },

  // Window controls (frameless window)
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    activity: () => ipcRenderer.send('window:activity')
  },

  // Lock events
  onLock: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('lock-app', handler);
    return () => ipcRenderer.removeListener('lock-app', handler);
  },

  // Platform info
  platform: process.platform
});
