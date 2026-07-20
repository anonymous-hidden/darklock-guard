/* ──────────────────────────────────────────────────────────
 *  Electron main process — Darklock Secure Channel
 *  Hardened: no node integration in renderer, strict CSP,
 *  context isolation, encrypted IPC only.
 * ────────────────────────────────────────────────────────── */

import { app, BrowserWindow, ipcMain, session, powerMonitor, clipboard, shell, Notification as ElectronNotification, Menu, MenuItem, nativeImage, globalShortcut } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import fs from 'fs';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import {
  createOAuthAttempt,
  buildPkceTokenBody,
  validateOAuthRedirect,
} from './oauthSecurity.js';
import { buildContentSecurityPolicy } from './cspPolicy.js';
import {
  MAX_VAULT_FILE_BYTES,
  isApprovedExternalUrl,
  isTrustedIpcSender,
  isTrustedRendererUrl,
  isValidVaultFilename,
  validateIpcArguments,
} from './desktopSecurity.js';
import { RidgelineUpdaterService } from './updaterService.js';
import { collectPhase1TamperViolations } from './tamper.js';
import { installSpkiPinning, loadSpkiPinningConfig } from './spkiPinning.js';
import {
  cancelSpotifyConnection,
  connectSpotify,
  disconnectSpotify,
  getSpotifyConnectionState,
  getSpotifyCurrentActivity,
  getSpotifyStatus,
  openSpotifyTrack,
  reopenSpotifyAuthorization,
  setSpotifySharing,
} from './spotifyIntegration.js';

// ── OAuth helpers ─────────────────────────────────────────

/** Perform a simple HTTPS POST and return parsed JSON */
function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, (res) => {
      let raw = '';
      res.on('data', (d: Buffer) => { raw += d.toString(); });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('oauth_non_json_response')); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Generic OAuth2 popup — opens provider login, intercepts redirect, resolves with code */
function openOAuthWindow(
  authUrl: string,
  redirectUri: string,
  expectedState: string,
  title = 'Sign in',
): Promise<string> {
  return new Promise((resolve, reject) => {
    const iconPath = path.join(__dirname, '../public/icon.png');
    const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;
    const win = new BrowserWindow({
      width: 520, height: 700, title,
      icon,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
        devTools: isDev,
      },
      autoHideMenuBar: true,
      parent: mainWindow ?? undefined,
      modal: false,
    });
    let settled = false;

    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      handler();
    };

    // Intercept navigation and validate exact redirect + state.
    const check = (url: string) => {
      try {
        const result = validateOAuthRedirect(url, redirectUri, expectedState);
        if (!result.matched) return false;
        finish(() => resolve(result.code));
        win.close();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Any validation failure on callback candidate is terminal.
        if (msg === 'redirect_mismatch' || msg === 'missing_state' || msg === 'invalid_state' || msg === 'no_code' || msg) {
          finish(() => reject(new Error(msg)));
          win.close();
          return true;
        }
        return false;
      }
    };

    win.webContents.on('will-navigate', (_e, url) => { check(url); });
    win.webContents.on('will-redirect', (_e, url) => { check(url); });
    win.webContents.on('did-navigate', (_e, url) => { check(url); });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // MED-8: Prevent OAuth popup from navigating to unexpected origins
    win.webContents.on('will-navigate', (e, url) => {
      try {
        const parsed = new URL(url);
        const allowed = [
          'accounts.google.com', 'discord.com', '127.0.0.1',
          'oauth2.googleapis.com', 'www.googleapis.com',
        ];
        if (!allowed.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
          e.preventDefault();
        }
      } catch { e.preventDefault(); }
    });
    win.on('closed', () => {
      if (!settled) reject(new Error('cancelled'));
    });

    win.loadURL(authUrl);
  });
}

// Discord OAuth constants — values injected at build time via VITE_ env vars
// The main process cannot read VITE_ vars directly, so we pass them from env at startup.
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '';
const DISCORD_REDIRECT = 'https://127.0.0.1/dl-oauth/discord';

// Google OAuth constants
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_REDIRECT = 'https://127.0.0.1/dl-oauth/google';
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

interface GoogleIdTokenPayload extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

async function verifyGoogleIdToken(idToken: unknown): Promise<GoogleIdTokenPayload> {
  if (typeof idToken !== 'string' || idToken.length === 0) {
    throw new Error('missing_id_token');
  }

  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: GOOGLE_CLIENT_ID,
    clockTolerance: 60,
  });

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('invalid_subject');
  }
  if (typeof payload.iat === 'number' && payload.iat > nowEpochSeconds + 60) {
    throw new Error('token_from_future');
  }

  return payload as GoogleIdTokenPayload;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev') && process.env.NODE_ENV !== 'production';
const preloadEntryPath = path.join(__dirname, 'preload.js');

const tamperViolations = collectPhase1TamperViolations({
  isDev,
  argv: process.argv,
  env: process.env,
  preloadPath: preloadEntryPath,
  expectedPreloadSha256: process.env.DL_PRELOAD_SHA256,
});

if (tamperViolations.length > 0) {
  const details = tamperViolations.join(', ');
  console.error('[SECURITY_TAMPER_CHECK_FAILED]');
  if (!isDev) {
    process.exit(1);
  }
}

const spkiPinningConfig = loadSpkiPinningConfig(process.env, isDev);

let mainWindow: BrowserWindow | null = null;
let updaterService: RidgelineUpdaterService | null = null;

function assertTrustedIpcSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  if (!isTrustedIpcSender(event.sender.id, mainWindow?.webContents.id ?? null, senderUrl, isDev)) {
    throw new Error('untrusted_ipc_sender');
  }
}

type SecureInvokeListener = (event: IpcMainInvokeEvent, ...args: any[]) => any;
function secureHandle(channel: string, listener: SecureInvokeListener): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    if (!validateIpcArguments(channel, args)) throw new Error('invalid_ipc_arguments');
    return listener(event, ...args);
  });
}

type SecureEventListener = (event: IpcMainEvent, ...args: any[]) => void;
function secureOn(channel: string, listener: SecureEventListener): void {
  ipcMain.on(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    if (!validateIpcArguments(channel, args)) throw new Error('invalid_ipc_arguments');
    listener(event, ...args);
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
let clipboardTimer: ReturnType<typeof setTimeout> | null = null;
let fullscreenFallbackActive = false;
let fullscreenProbeTimer: ReturnType<typeof setTimeout> | null = null;

function clearFullscreenProbeTimer() {
  if (!fullscreenProbeTimer) return;
  clearTimeout(fullscreenProbeTimer);
  fullscreenProbeTimer = null;
}

function isMainWindowFullscreenActive() {
  return !!mainWindow && (mainWindow.isFullScreen() || fullscreenFallbackActive);
}

function broadcastFullscreenState() {
  if (!mainWindow) return;
  mainWindow.webContents.send('win:fullscreenChanged', isMainWindowFullscreenActive());
}

function toggleMainWindowFullscreen() {
  if (!mainWindow) return;
  clearFullscreenProbeTimer();

  // Exit fullscreen-like mode first (native fullscreen or maximize fallback).
  if (isMainWindowFullscreenActive()) {
    fullscreenFallbackActive = false;
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    }
    broadcastFullscreenState();
    return;
  }

  // Try native fullscreen first.
  fullscreenFallbackActive = false;
  mainWindow.setFullScreen(true);

  // Some Linux WMs with frameless windows refuse native fullscreen.
  // Fall back to maximized mode so users still get full-screen coverage.
  fullscreenProbeTimer = setTimeout(() => {
    fullscreenProbeTimer = null;
    if (!mainWindow) return;
    if (!mainWindow.isFullScreen()) {
      fullscreenFallbackActive = true;
      if (!mainWindow.isMaximized()) {
        mainWindow.maximize();
      }
    }
    broadcastFullscreenState();
  }, 150);
}

function createWindow() {
  // Build the icon path — __dirname resolves to electron-dist/ at runtime
  const iconPath = path.join(__dirname, '../public/icon.png');
  const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'RIDGELINE',
    backgroundColor: '#0a0a0f',
    frame: false,
    fullscreenable: true,
    maximizable: true,
    resizable: true,
    icon: appIcon,
    webPreferences: {
      preload: preloadEntryPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      devTools: isDev,
      spellcheck: true,
    },
    show: false,
  });

  // Open external links in default browser — sanitize URLs (MED-3)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (isApprovedExternalUrl(url)) {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      // Invalid URL — deny silently
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url, isDev)) return;
    event.preventDefault();
    if (isApprovedExternalUrl(url)) void shell.openExternal(url);
  });

  // Content Security Policy — enforced in BOTH dev and production (HIGH-5)
  // 'wasm-unsafe-eval' required for libsodium (WebAssembly crypto)
  // Only inject CSP for HTTP(S) — file:// has opaque origin where 'self' doesn't work

  // Keyboard fullscreen support for frameless windows.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const isF11 = input.key === 'F11';
    const isMacFullscreenShortcut = process.platform === 'darwin'
      && !!input.control
      && !!input.meta
      && input.key.toLowerCase() === 'f';

    if (isF11 || isMacFullscreenShortcut) {
      event.preventDefault();
      toggleMainWindowFullscreen();
    }
  });

  // Enable spell checker with English
  session.defaultSession.setSpellCheckerEnabled(true);
  session.defaultSession.setSpellCheckerLanguages(['en-US']);

  // Right-click context menu with spell check suggestions
  mainWindow.webContents.on('context-menu', (_event, params) => {
    // Titlebar area (top 32px) → show window controls menu
    if (params.y <= 32) {
      const isOnTop = mainWindow?.isAlwaysOnTop() ?? false;
      Menu.buildFromTemplate([
        { label: 'Minimize', click: () => mainWindow?.minimize() },
        {
          label: mainWindow?.isMaximized() ? 'Restore' : 'Maximize',
          click: () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); },
        },
        {
          label: isMainWindowFullscreenActive() ? 'Exit Full Screen' : 'Enter Full Screen',
          click: () => toggleMainWindowFullscreen(),
        },
        { type: 'separator' },
        {
          label: isOnTop ? '✓ Always on Top' : 'Always on Top',
          click: () => mainWindow?.setAlwaysOnTop(!isOnTop),
        },
        { type: 'separator' },
        { label: 'Close', click: () => mainWindow?.close() },
      ]).popup({ window: mainWindow ?? undefined });
      return;
    }

    const menu = new Menu();

    // Add spelling suggestions for misspelled words
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menu.append(new MenuItem({
          label: suggestion,
          click: () => mainWindow?.webContents.replaceMisspelling(suggestion),
        }));
      }
      if (params.dictionarySuggestions.length > 0) {
        menu.append(new MenuItem({ type: 'separator' }));
      }
      menu.append(new MenuItem({
        label: 'Add to Dictionary',
        click: () => mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Standard edit operations
    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'cut', enabled: params.editFlags.canCut }));
      menu.append(new MenuItem({ role: 'copy', enabled: params.editFlags.canCopy }));
      menu.append(new MenuItem({ role: 'paste', enabled: params.editFlags.canPaste }));
      menu.append(new MenuItem({ role: 'selectAll', enabled: params.editFlags.canSelectAll }));
    } else if (params.selectionText) {
      menu.append(new MenuItem({ role: 'copy' }));
    }

    if (menu.items.length > 0) {
      menu.popup();
    }
  });

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, cb) => {
    const csp = buildContentSecurityPolicy(isDev);
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          csp,
        ],
      },
    });
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:1421');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    broadcastFullscreenState();
  });

  mainWindow.on('enter-full-screen', () => {
    fullscreenFallbackActive = false;
    broadcastFullscreenState();
  });
  mainWindow.on('leave-full-screen', broadcastFullscreenState);
  mainWindow.on('maximize', () => {
    if (fullscreenFallbackActive) broadcastFullscreenState();
  });
  mainWindow.on('unmaximize', () => {
    if (!fullscreenFallbackActive) return;
    fullscreenFallbackActive = false;
    broadcastFullscreenState();
  });

  mainWindow.on('closed', () => {
    clearFullscreenProbeTimer();
    fullscreenFallbackActive = false;
    mainWindow = null;
  });
}

// ── IPC handlers ──────────────────────────────────────────
// All sensitive operations happen in main process, never in renderer

// Window controls (used by custom frameless titlebar)
secureOn('win:minimize', () => mainWindow?.minimize());
secureOn('win:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
secureOn('win:toggleFullscreen', () => toggleMainWindowFullscreen());
secureOn('win:close', () => mainWindow?.close());
secureHandle('win:isFullscreen', () => isMainWindowFullscreenActive());

// Titlebar right-click — native context menu
secureOn('win:titlebarMenu', () => {
  if (!mainWindow) return;
  const isOnTop = mainWindow.isAlwaysOnTop();
  const menu = Menu.buildFromTemplate([
    {
      label: 'Minimize',
      click: () => mainWindow?.minimize(),
    },
    {
      label: mainWindow.isMaximized() ? 'Restore' : 'Maximize',
      click: () => {
        if (mainWindow?.isMaximized()) mainWindow.unmaximize();
        else mainWindow?.maximize();
      },
    },
    {
      label: isMainWindowFullscreenActive() ? 'Exit Full Screen' : 'Enter Full Screen',
      click: () => toggleMainWindowFullscreen(),
    },
    { type: 'separator' },
    {
      label: isOnTop ? '✓ Always on Top' : 'Always on Top',
      click: () => mainWindow?.setAlwaysOnTop(!isOnTop),
    },
    { type: 'separator' },
    {
      label: 'Close',
      click: () => mainWindow?.close(),
    },
  ]);
  menu.popup({ window: mainWindow });
});

secureHandle('app:getVersion', () => {
  return app.getVersion();
});

// ── Notification IPC handler (MED-9: sanitize inputs) ────
secureHandle('app:showNotification', (_e, title: string, body: string) => {
  if (ElectronNotification.isSupported()) {
    // MED-9: Sanitize — limit length, strip HTML tags
    const safeTitle = String(title ?? '').replace(/<[^>]*>/g, '').slice(0, 64);
    const safeBody = String(body ?? '').replace(/<[^>]*>/g, '').slice(0, 200);
    const n = new ElectronNotification({ title: safeTitle, body: safeBody, silent: false });
    n.show();
    setTimeout(() => n.close(), 5000);
  }
});

// ── Vault file IPC handlers (encrypted key storage) ───────
const vaultDir = path.join(app.getPath('userData'), 'vault');

secureHandle('vault:write', (_e, filename: string, data: string) => {
  // Sanitize filename — alphanumeric + dots + dashes only
  if (!isValidVaultFilename(filename)) throw new Error('invalid_filename');
  if (Buffer.byteLength(data, 'utf8') > MAX_VAULT_FILE_BYTES) throw new Error('vault_file_too_large');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, filename), data, { encoding: 'utf-8', mode: 0o600 });
});

secureHandle('vault:read', (_e, filename: string) => {
  if (!isValidVaultFilename(filename)) throw new Error('invalid_filename');
  const filePath = path.join(vaultDir, filename);
  if (!fs.existsSync(filePath)) return null;
  if (fs.statSync(filePath).size > MAX_VAULT_FILE_BYTES) throw new Error('vault_file_too_large');
  return fs.readFileSync(filePath, 'utf-8');
});

secureHandle('vault:exists', (_e, filename: string) => {
  if (!isValidVaultFilename(filename)) return false;
  return fs.existsSync(path.join(vaultDir, filename));
});

secureHandle('vault:delete', (_e, filename: string) => {
  if (!isValidVaultFilename(filename)) throw new Error('invalid_filename');
  const filePath = path.join(vaultDir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
});

// ── Security IPC handlers ─────────────────────────────────

let contentProtectionEnabled = false;

// Screenshot / screen-capture protection
secureHandle('security:setContentProtection', (_e, enabled: boolean) => {
  contentProtectionEnabled = enabled;
  mainWindow?.setContentProtection(enabled);
  // On Linux/X11, setContentProtection is unreliable.
  // We supplement with a blur overlay: tell renderer to hide content when window loses focus.
  mainWindow?.webContents.send('security:contentProtectionChanged', enabled);
});

// Hide from taskbar / dock
secureHandle('security:setSkipTaskbar', (_e, skip: boolean) => {
  mainWindow?.setSkipTaskbar(skip);
});

secureHandle('security:setSpellCheckerEnabled', (_e, enabled: boolean) => {
  mainWindow?.webContents.session.setSpellCheckerEnabled(enabled === true);
});

// Incognito keyboard: disable session spell checker + dictation
secureHandle('security:setIncognitoKeyboard', (_e, enabled: boolean) => {
  mainWindow?.webContents.session.setSpellCheckerEnabled(!enabled);
});

// Clipboard auto-clear: renderer tells us to start a timer
secureHandle('security:clipboardClear', (_e, seconds: number) => {
  if (clipboardTimer) clearTimeout(clipboardTimer);
  if (seconds <= 0) return;
  clipboardTimer = setTimeout(() => {
    clipboard.clear();
    clipboardTimer = null;
  }, seconds * 1000);
});

// Clear clipboard immediately
secureHandle('security:clipboardClearNow', () => {
  clipboard.clear();
});

// ── Update IPC handlers ───────────────────────────────────
secureHandle('app:checkForUpdates', async () => {
  return updaterService?.check('manual') ?? null;
});

secureHandle('updater:getState', () => updaterService?.getSnapshot() ?? null);
secureHandle('updater:getHistory', () => updaterService?.getHistory() ?? []);
secureHandle('updater:getPendingMajorNotes', () => updaterService?.getPendingMajorReleaseNotes() ?? null);
secureHandle('updater:restartAndInstall', () => updaterService?.restartAndInstall() ?? null);
secureHandle('updater:defer', () => updaterService?.defer() ?? null);
secureHandle('updater:markMajorNotesSeen', (_event, version: unknown) => {
  updaterService?.markMajorReleaseNotesSeen(version);
});
secureHandle('updater:recordNotesOpened', (_event, version: unknown) => {
  updaterService?.recordReleaseNotesOpened(version);
});
secureHandle('updater:setRestartSafety', (_event, value: unknown) => {
  updaterService?.setRestartSafety(value);
});

// ── Spotify integration ─────────────────────────────────────────────────────
// Tokens stay in the main process and are stored only with Electron safeStorage.
secureHandle('spotify:connect', async () => connectSpotify(mainWindow));
secureHandle('spotify:connectionState', () => getSpotifyConnectionState());
secureHandle('spotify:reopenAuthorization', async () => reopenSpotifyAuthorization());
secureHandle('spotify:cancelConnection', () => {
  cancelSpotifyConnection();
  return getSpotifyConnectionState();
});
secureHandle('spotify:status', () => getSpotifyStatus());
secureHandle('spotify:setSharing', (_event, sharingEnabled: unknown) => {
  if (typeof sharingEnabled !== 'boolean') throw new Error('invalid_spotify_sharing');
  return setSpotifySharing(sharingEnabled);
});
secureHandle('spotify:currentActivity', async () => getSpotifyCurrentActivity());
secureHandle('spotify:disconnect', () => {
  disconnectSpotify();
  return { connected: false, sharingEnabled: false };
});
secureHandle('spotify:openTrack', async (_event, url: unknown) => {
  if (typeof url !== 'string') throw new Error('invalid_spotify_url');
  await openSpotifyTrack(url);
});

// Lock signal from main to renderer (screen sleep, idle, etc.)
function sendLockSignal() {
  mainWindow?.webContents.send('security:lock');
}

// ── Discord OAuth IPC ──────────────────────────────────────
secureHandle('auth:discordSignIn', async () => {
  if (!DISCORD_CLIENT_ID) throw new Error('DISCORD_CLIENT_ID not configured');
  const oauth = createOAuthAttempt();
  const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(DISCORD_CLIENT_ID)}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT)}&response_type=code&scope=identify%20email&prompt=consent&state=${encodeURIComponent(oauth.state)}&code_challenge=${encodeURIComponent(oauth.codeChallenge)}&code_challenge_method=${oauth.codeChallengeMethod}`;
  const code = await openOAuthWindow(authUrl, DISCORD_REDIRECT, oauth.state, 'Sign in with Discord');
  // Exchange code for access token
  const tokenData = await httpsPost(
    'https://discord.com/api/oauth2/token',
    buildPkceTokenBody({
      clientId: DISCORD_CLIENT_ID,
      code,
      redirectUri: DISCORD_REDIRECT,
      codeVerifier: oauth.codeVerifier,
      scope: 'identify email',
    }),
    {},
  );
  if (tokenData.error) throw new Error(tokenData.error_description ?? tokenData.error);
  // Fetch user info
  const user = await new Promise<any>((resolve, reject) => {
    https.get({
      hostname: 'discord.com', path: '/api/users/@me',
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    }, (res) => {
      let raw = '';
      res.on('data', (d: Buffer) => { raw += d.toString(); });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('non-json')); } });
    }).on('error', reject);
  });
  return {
    id: user.id,
    username: user.username,
    globalName: user.global_name ?? user.username,
    email: user.email ?? null,
    avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
    accessToken: tokenData.access_token,
  };
});

// ── Google OAuth IPC ──────────────────────────────────────
secureHandle('auth:googleSignIn', async () => {
  if (!GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID not configured');
  const oauth = createOAuthAttempt();
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT)}&response_type=code&scope=openid%20email%20profile&access_type=offline&prompt=consent&state=${encodeURIComponent(oauth.state)}&code_challenge=${encodeURIComponent(oauth.codeChallenge)}&code_challenge_method=${oauth.codeChallengeMethod}`;
  const code = await openOAuthWindow(authUrl, GOOGLE_REDIRECT, oauth.state, 'Sign in with Google');
  // Exchange code for tokens
  const tokenData = await httpsPost(
    'https://oauth2.googleapis.com/token',
    buildPkceTokenBody({
      clientId: GOOGLE_CLIENT_ID,
      code,
      redirectUri: GOOGLE_REDIRECT,
      codeVerifier: oauth.codeVerifier,
    }),
    {},
  );
  if (tokenData.error) throw new Error(tokenData.error_description ?? tokenData.error);
  const payload = await verifyGoogleIdToken(tokenData.id_token);

  return {
    googleId: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
    accessToken: tokenData.access_token,
  };
});

// ── Update checker ────────────────────────────────────────
// ── App lifecycle ─────────────────────────────────────────
app.whenReady().then(() => {
  const permissionAllowed = (webContents: Electron.WebContents | null, permission: string, details?: any) => {
    const senderUrl = webContents?.getURL() ?? '';
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    return !!mainWindow
      && webContents === mainWindow.webContents
      && isTrustedRendererUrl(senderUrl, isDev)
      && permission === 'media'
      && mediaTypes.every((type: unknown) => type === 'audio' || type === 'video');
  };

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(permissionAllowed(webContents, permission, details));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => (
    permissionAllowed(webContents, permission, details)
  ));

  if (installSpkiPinning(session.defaultSession, spkiPinningConfig)) {
    console.log(`[Security] SPKI pinning enabled for ${spkiPinningConfig.hostPins.size} host(s)`);
  }

  // Fullscreen shortcuts for frameless windows across all screens.
  globalShortcut.register('F11', () => toggleMainWindowFullscreen());
  if (process.platform === 'darwin') {
    globalShortcut.register('Control+Command+F', () => toggleMainWindowFullscreen());
  }
  globalShortcut.register('Alt+Enter', () => toggleMainWindowFullscreen());

  createWindow();
  updaterService = new RidgelineUpdaterService(() => BrowserWindow.getAllWindows());
  updaterService.start();
  mainWindow?.webContents.once('did-finish-load', () => {
    setTimeout(() => { void updaterService?.check('startup'); }, 1500);
  });

  // Forward window blur/focus to renderer for screenshot protection overlay
  mainWindow?.on('blur', () => {
    if (contentProtectionEnabled) {
      mainWindow?.webContents.send('security:windowBlur');
    }
  });
  mainWindow?.on('focus', () => {
    mainWindow?.webContents.send('security:windowFocus');
  });

  // Lock on OS screen lock / sleep
  powerMonitor.on('lock-screen', sendLockSignal);
  powerMonitor.on('suspend', sendLockSignal);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  updaterService?.stop();
  globalShortcut.unregisterAll();
});
