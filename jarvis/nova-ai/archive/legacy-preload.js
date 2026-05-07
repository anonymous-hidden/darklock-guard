/**
 * JARVIS-Lite — Electron Preload Script
 * =======================================
 * Exposes a safe bridge between the renderer and Node.js.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  platform: process.platform,
  isElectron: true,
});
