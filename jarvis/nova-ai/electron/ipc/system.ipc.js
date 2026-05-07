/**
 * System IPC — basic system info for the StatusBar / Terminal panel.
 * The Terminal panel is read-only: it surfaces an emit channel that the
 * AI Code Assistant can use to log build/lint output back to the UI.
 */

import os from 'os';
import process from 'process';

export function registerSystemIpc(ipcMain) {
  ipcMain.handle('system:info', async () => {
    return {
      ok: true,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      memTotalGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
      memFreeGB: +(os.freemem() / 1024 ** 3).toFixed(1),
      hostname: os.hostname(),
      release: os.release(),
      uptimeMin: Math.round(os.uptime() / 60),
      node: process.versions.node,
      electron: process.versions.electron || '',
      chrome: process.versions.chrome || '',
    };
  });
}
