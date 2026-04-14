const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAll: () => ipcRenderer.invoke('events:get-all'),
  getRange: (start, end) => ipcRenderer.invoke('events:get-range', start, end),
  save: (event) => ipcRenderer.invoke('events:save', event),
  delete: (id) => ipcRenderer.invoke('events:delete', id),
  bulkSave: (events) => ipcRenderer.invoke('events:bulk-save', events),
});
