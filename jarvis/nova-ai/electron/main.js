/**
 * Nova AI — Electron Main Process
 * Entry point. Creates the main window, wires IPC handlers, and exposes
 * a popout-window factory for the Widget Studio.
 */

import { app, BrowserWindow, shell, session, ipcMain, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import net from 'net';
import { registerAiIpc } from './ipc/ai.ipc.js';
import { registerWidgetsIpc } from './ipc/widgets.ipc.js';
import { registerFilesIpc } from './ipc/files.ipc.js';
import { registerSystemIpc } from './ipc/system.ipc.js';
import { registerControlIpc } from './ipc/control.ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

/** @type {Map<string, BrowserWindow>} */
const popoutWindows = new Map();
/** @type {BrowserWindow|null} */
let mainWindow = null;
const getMainWindow = () => mainWindow;

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    title: 'Nova AI',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
  });

  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

/**
 * Open a widget in its own popout window.
 *
 * Two modes:
 *   1. `builtinId` set  — load the same Vite/dist app with `?builtin=<id>`,
 *      WITH the preload script + IPC, so the widget is fully live.
 *   2. `html` set       — legacy path: render arbitrary AI-built HTML in a
 *      sandboxed window using a data: URL.
 */
function createPopoutWindow({ id, name, html, builtinId, width, height, query }) {
  if (popoutWindows.has(id)) {
    const existing = popoutWindows.get(id);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return id;
    }
    popoutWindows.delete(id);
  }

  const live = !!builtinId;
  const win = new BrowserWindow({
    width:  Math.max(280, Math.min(1800, Number(width)  || (live ? 460 : 480))),
    height: Math.max(220, Math.min(1400, Number(height) || (live ? 540 : 360))),
    title: `Nova · ${name || 'Widget'}`,
    backgroundColor: '#0a0a0f',
    frame: false,
    parent: live ? mainWindow || undefined : undefined,
    webPreferences: live
      ? {
          preload: path.join(__dirname, 'preload.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
        }
      : {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
  });

  if (live) {
    const extraQs = query && typeof query === 'object'
      ? Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
      : '';
    if (isDev) {
      const url = `${DEV_URL}/?builtin=${encodeURIComponent(builtinId)}${extraQs ? '&' + extraQs : ''}`;
      win.loadURL(url);
    } else {
      win.loadFile(path.join(ROOT, 'dist', 'index.html'), {
        search: `builtin=${encodeURIComponent(builtinId)}${extraQs ? '&' + extraQs : ''}`,
      });
    }
  } else {
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html || '<!doctype html><body style="background:#0a0a0f;color:#e6e6f0;font-family:sans-serif;padding:24px">No content.</body>');
    win.loadURL(dataUrl);
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Native right-click context menu for every popout window
  win.webContents.on('context-menu', () => {
    const pinned = win.isAlwaysOnTop();
    Menu.buildFromTemplate([
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: pinned,
        click: () => {
          const next = !win.isAlwaysOnTop();
          win.setAlwaysOnTop(next, 'floating');
          win.webContents.send('win:alwaysOnTop:changed', next);
        },
      },
      { type: 'separator' },
      { label: 'Minimize', click: () => win.minimize() },
      { label: 'Close',    click: () => win.close()    },
    ]).popup({ window: win });
  });

  win.on('closed', () => popoutWindows.delete(id));
  popoutWindows.set(id, win);
  return id;
}

// Window controls from renderer
ipcMain.handle('win:alwaysOnTop:toggle', (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win) return false;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next, 'floating');
  win.webContents.send('win:alwaysOnTop:changed', next);
  return next;
});
ipcMain.handle('win:alwaysOnTop:get', (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  return win ? win.isAlwaysOnTop() : false;
});
ipcMain.on('win:minimize', (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (win) win.minimize();
});

// ── Cross-widget pub/sub bus ────────────────────────────────────────────
// Any window can publish; main rebroadcasts to every renderer process.
// preload exposes window.nova.bus.publish/subscribe.
function broadcastBus(channel, payload, exceptWebContentsId = null) {
  const event = { channel, payload, ts: Date.now() };
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    if (exceptWebContentsId && w.webContents.id === exceptWebContentsId) continue;
    try { w.webContents.send('nova:bus:event', event); } catch {}
  }
}
ipcMain.on('nova:bus:publish', (evt, { channel, payload }) => {
  if (!channel) return;
  broadcastBus(channel, payload, evt.sender.id);
  // Also echo back to sender so single-window setups work
  try { evt.sender.send('nova:bus:event', { channel, payload, ts: Date.now() }); } catch {}
});

ipcMain.handle('widget:popout', (_evt, payload) => createPopoutWindow(payload || {}));
ipcMain.handle('widget:popout:close', (_evt, id) => {
  const w = popoutWindows.get(id);
  if (w && !w.isDestroyed()) w.close();
  return true;
});

// ── Auto-start the Terminal AI bridge server ────────────────────────────────
// Runs ai-terminal-server.py on port 8951 so the Nova chat widget can use
// the full terminal AI brain (same tools as ai-terminal.py). Uses 8951 instead
// of 8950 to avoid conflicting with ai-terminal.py's browser-bridge WebSocket.
let _termServer = null;

function isPortBound(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => { s.end(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(400, () => { s.destroy(); resolve(false); });
  });
}

async function spawnTermServer() {
  // If another Electron instance already started the server, skip spawning.
  if (await isPortBound(8951)) return;

  const botDir = path.join(ROOT, '..', '..');
  const venv = path.join(botDir, '.venv', 'bin', 'python3');
  const script = path.join(botDir, 'ai-terminal-server.py');
  const py = existsSync(venv) ? venv : 'python3';
  const child = spawn(py, [script, '8951'], {
    cwd: botDir,
    stdio: 'ignore',
    detached: false,
  });
  child.on('error', () => {});
  child.on('exit', () => {
    _termServer = null;
    // Only restart if the port is not already claimed by another process.
    setTimeout(async () => {
      if (!(await isPortBound(8951))) spawnTermServer();
    }, 3000);
  });
  _termServer = child;
}

app.on('before-quit', () => {
  if (_termServer) { try { _termServer.kill(); } catch {} }
});

app.whenReady().then(() => {
  spawnTermServer();

  // Renderer-side fetch to Ollama needs no special perms, but media might.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'microphone', 'audioCapture'].includes(permission));
  });

  registerAiIpc(ipcMain);
  registerWidgetsIpc(ipcMain, { rootDir: ROOT });
  registerFilesIpc(ipcMain, { rootDir: ROOT });
  registerSystemIpc(ipcMain);
  registerControlIpc(ipcMain, {
    rootDir: ROOT,
    getMainWindow,
    openWidget: (builtinId, opts = {}) => createPopoutWindow({
      id: opts.id || `tool:${builtinId}:${Date.now()}`,
      name: opts.name || builtinId,
      builtinId,
      width:  opts.width,
      height: opts.height,
    }),
  });

  // ── Widget-only mode ────────────────────────────────────────────────
  // If NOVA_WIDGETS is set (comma/space separated ids), skip the main
  // app shell entirely and just launch standalone widget windows.
  // Used by the `nova-widget` CLI so the terminal AI can pop a widget
  // without ever opening the full Nova app.
  const widgetEnv = (process.env.NOVA_WIDGETS || '').trim();
  if (widgetEnv) {
    const ids = widgetEnv.split(/[\s,]+/).filter(Boolean);
    let offset = 0;
    for (const wid of ids) {
      createPopoutWindow({
        id: `cli:${wid}:${Date.now()}:${offset}`,
        name: wid,
        builtinId: wid,
      });
      offset += 1;
    }
    return; // do NOT create main window
  }

  mainWindow = createMainWindow();
  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => { mainWindow = null; });
  }
});
