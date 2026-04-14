const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { store, getAllEvents, saveEvent, deleteEvent, getEventsByRange } = require('./store');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Nova Calendar',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Hide default menu
  Menu.setApplicationMenu(null);

  // Dev or prod — try 5173 first, fall back to 5174
  const isDev = process.env.NODE_ENV !== 'production' || !app.isPackaged;
  if (isDev) {
    const devPort = process.env.VITE_PORT || 5175;
    mainWindow.loadURL(`http://localhost:${devPort}`).catch(() => {
      mainWindow.loadURL('http://localhost:5173');
    });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC Handlers ──

ipcMain.handle('events:get-all', () => {
  return getAllEvents();
});

ipcMain.handle('events:get-range', (_e, start, end) => {
  return getEventsByRange(start, end);
});

ipcMain.handle('events:save', (_e, event) => {
  return saveEvent(event);
});

ipcMain.handle('events:delete', (_e, id) => {
  return deleteEvent(id);
});

ipcMain.handle('events:bulk-save', (_e, events) => {
  const results = [];
  for (const event of events) {
    results.push(saveEvent(event));
  }
  return results;
});
