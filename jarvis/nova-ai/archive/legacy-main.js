/**
 * Nova — Electron Main Process
 * ==============================
 * Launches the desktop window.
 */

import { app, BrowserWindow, shell, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'Nova',
    backgroundColor: '#0a0a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    // Frameless on macOS, normal elsewhere
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
  });

  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // External links open in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // Grant microphone (and camera) permission automatically — no OS prompt needed
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture'].includes(permission);
    callback(allowed);
  });

  // Also override the permission check handler so already-cached denials don't block us
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ['media', 'microphone', 'audioCapture'].includes(permission);
  });

  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
