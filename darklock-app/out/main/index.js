"use strict";
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require("electron");
const path = require("path");
const Store = require("electron-store");
app.disableHardwareAcceleration();
const store = new Store({
  encryptionKey: "darklock-local-store-key",
  name: "darklock-secure"
});
let mainWindow = null;
let tray = null;
let inactivityTimer = null;
const LOCK_TIMEOUT = 5 * 60 * 1e3;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#1e1f22",
    icon: path.join(__dirname, "../../assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      devTools: !app.isPackaged ? true : false
    }
  });
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://") && !url.startsWith("http://localhost")) {
      event.preventDefault();
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  resetInactivityTimer();
  mainWindow.on("focus", resetInactivityTimer);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    if (mainWindow) {
      mainWindow.webContents.send("lock-app");
    }
  }, LOCK_TIMEOUT);
}
function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("DarkLock");
  const contextMenu = Menu.buildFromTemplate([
    { label: "Show DarkLock", click: () => mainWindow?.show() },
    { label: "Lock", click: () => mainWindow?.webContents.send("lock-app") },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("click", () => mainWindow?.show());
}
ipcMain.handle("store:get", (_event, key) => store.get(key));
ipcMain.handle("store:set", (_event, key, value) => store.set(key, value));
ipcMain.handle("store:delete", (_event, key) => store.delete(key));
ipcMain.handle("store:clear", () => store.clear());
ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on("window:close", () => mainWindow?.close());
ipcMain.on("window:activity", () => resetInactivityTimer());
app.whenReady().then(() => {
  createWindow();
  createTray();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
