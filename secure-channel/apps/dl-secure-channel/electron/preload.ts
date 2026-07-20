/* ──────────────────────────────────────────────────────────
 *  Preload — secure context bridge
 *  Exposes ONLY the minimal API surface to the renderer.
 *  NOTE: Must use require() — preload runs in CJS sandbox.
 * ────────────────────────────────────────────────────────── */

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // App
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  showNotification: (title: string, body: string) => ipcRenderer.invoke('app:showNotification', title, body),
  platform: process.platform,

  // Vault — encrypted key storage in userData/vault/
  vaultWrite: (filename: string, data: string) => ipcRenderer.invoke('vault:write', filename, data),
  vaultRead: (filename: string) => ipcRenderer.invoke('vault:read', filename),
  vaultExists: (filename: string) => ipcRenderer.invoke('vault:exists', filename),
  vaultDelete: (filename: string) => ipcRenderer.invoke('vault:delete', filename),

  // OAuth
  discordSignIn: () => ipcRenderer.invoke('auth:discordSignIn'),
  googleSignIn: () => ipcRenderer.invoke('auth:googleSignIn'),

  // Spotify integration - the renderer only receives sanitized status/activity data.
  spotifyConnect: () => ipcRenderer.invoke('spotify:connect'),
  spotifyConnectionState: () => ipcRenderer.invoke('spotify:connectionState'),
  spotifyReopenAuthorization: () => ipcRenderer.invoke('spotify:reopenAuthorization'),
  spotifyCancelConnection: () => ipcRenderer.invoke('spotify:cancelConnection'),
  spotifyStatus: () => ipcRenderer.invoke('spotify:status'),
  spotifySetSharing: (enabled: boolean) => ipcRenderer.invoke('spotify:setSharing', enabled),
  spotifyCurrentActivity: () => ipcRenderer.invoke('spotify:currentActivity'),
  spotifyDisconnect: () => ipcRenderer.invoke('spotify:disconnect'),
  spotifyOpenTrack: (url: string) => ipcRenderer.invoke('spotify:openTrack', url),

  // Security
  setContentProtection: (enabled: boolean) => ipcRenderer.invoke('security:setContentProtection', enabled),
  setSkipTaskbar: (skip: boolean) => ipcRenderer.invoke('security:setSkipTaskbar', skip),
  setSpellCheckerEnabled: (enabled: boolean) => ipcRenderer.invoke('security:setSpellCheckerEnabled', enabled),
  setIncognitoKeyboard: (enabled: boolean) => ipcRenderer.invoke('security:setIncognitoKeyboard', enabled),
  clipboardClear: (seconds: number) => ipcRenderer.invoke('security:clipboardClear', seconds),
  clipboardClearNow: () => ipcRenderer.invoke('security:clipboardClearNow'),

  // Lock signal from main process (screen sleep / OS lock)
  onLockSignal: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('security:lock', handler);
    return () => { ipcRenderer.removeListener('security:lock', handler); };
  },

  // Window blur/focus for screenshot protection overlay
  onWindowBlur: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('security:windowBlur', handler);
    return () => { ipcRenderer.removeListener('security:windowBlur', handler); };
  },
  onWindowFocus: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('security:windowFocus', handler);
    return () => { ipcRenderer.removeListener('security:windowFocus', handler); };
  },

  // Content-protection change notification
  onContentProtectionChanged: (callback: (enabled: boolean) => void) => {
    const handler = (_e: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('security:contentProtectionChanged', handler);
    return () => { ipcRenderer.removeListener('security:contentProtectionChanged', handler); };
  },

  // Updates are controlled by the trusted main-process updater service.
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  updaterGetState: () => ipcRenderer.invoke('updater:getState'),
  updaterGetHistory: () => ipcRenderer.invoke('updater:getHistory'),
  updaterGetPendingMajorNotes: () => ipcRenderer.invoke('updater:getPendingMajorNotes'),
  updaterRestartAndInstall: () => ipcRenderer.invoke('updater:restartAndInstall'),
  updaterDefer: () => ipcRenderer.invoke('updater:defer'),
  updaterMarkMajorNotesSeen: (version: string) => ipcRenderer.invoke('updater:markMajorNotesSeen', version),
  updaterRecordNotesOpened: (version: string) => ipcRenderer.invoke('updater:recordNotesOpened', version),
  updaterSetRestartSafety: (value: { activeCall: boolean; activeTransfer: boolean; unsavedDraft: boolean }) => (
    ipcRenderer.invoke('updater:setRestartSafety', value)
  ),
  onUpdaterState: (callback: (state: unknown) => void) => {
    const handler = (_e: unknown, state: unknown) => callback(state);
    ipcRenderer.on('updater:state', handler);
    return () => { ipcRenderer.removeListener('updater:state', handler); };
  },

  // Frameless window controls
  winMinimize:    () => ipcRenderer.send('win:minimize'),
  winMaximize:    () => ipcRenderer.send('win:maximize'),
  winToggleFullscreen: () => ipcRenderer.send('win:toggleFullscreen'),
  winIsFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),
  winClose:       () => ipcRenderer.send('win:close'),
  winTitlebarMenu: () => ipcRenderer.send('win:titlebarMenu'),
  onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
    const handler = (_e: any, isFullscreen: boolean) => callback(isFullscreen);
    ipcRenderer.on('win:fullscreenChanged', handler);
    return () => { ipcRenderer.removeListener('win:fullscreenChanged', handler); };
  },
});
