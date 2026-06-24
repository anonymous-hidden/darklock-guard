#!/usr/bin/env node
/**
 * launch-widgets.mjs — Standalone Nova widget launcher.
 *
 *   node scripts/launch-widgets.mjs <id> [<id>...]
 *
 * Opens one or more built-in Nova widgets as their own desktop windows
 * with NO main app shell. Boots Vite in dev mode (so React + IPC work)
 * and launches Electron in widget-only mode via the NOVA_WIDGETS env var.
 *
 * Used by the `nova-widget` CLI so the terminal AI can pop a widget on
 * demand without opening the whole Nova app.
 *
 * Available widget ids:
 *   nova-call, nova-chat, clock, calculator, notes, todo, sysmon,
 *   spotify, weather, calendar, map, news, room-control, widget-theme
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const KNOWN = new Set([
  'nova-call','nova-chat','clock','calculator','notes','todo','sysmon',
  'spotify','weather','calendar','map','news','room-control','widget-theme',
]);

const args = process.argv.slice(2).flatMap((a) => a.split(/[,\s]+/)).filter(Boolean);
if (args.length === 0) {
  console.error('Usage: nova-widget <id> [<id>...]');
  console.error('Widgets: ' + [...KNOWN].join(', '));
  process.exit(2);
}
const unknown = args.filter((a) => !KNOWN.has(a));
if (unknown.length) {
  console.error('Unknown widget(s): ' + unknown.join(', '));
  console.error('Available: ' + [...KNOWN].join(', '));
  process.exit(2);
}

const VITE_PORT = 5173;
const VITE_URL = `http://localhost:${VITE_PORT}`;

function isPortOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => { s.end(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(400, () => { s.destroy(); resolve(false); });
  });
}

async function waitForVite(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(VITE_PORT)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function spawnVite() {
  const vite = spawn('npx', ['vite', '--port', String(VITE_PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  vite.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
  vite.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  return vite;
}

function spawnElectron(ids) {
  const electronBin = path.join(ROOT, 'node_modules', '.bin', 'electron');
  const bin = fs.existsSync(electronBin) ? electronBin : 'electron';
  const widgetUserData = path.join(os.homedir(), '.config', 'nova-ai-widgets');
  try { fs.mkdirSync(widgetUserData, { recursive: true }); } catch {}
  const proc = spawn(bin, ['.'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NOVA_WIDGETS: ids.join(','),
      NOVA_USER_DATA_DIR: widgetUserData,
    },
  });
  return proc;
}

(async () => {
  let vite = null;
  if (!(await isPortOpen(VITE_PORT))) {
    vite = spawnVite();
    const ok = await waitForVite();
    if (!ok) {
      console.error('Vite failed to start on ' + VITE_URL);
      try { vite?.kill('SIGTERM'); } catch {}
      process.exit(1);
    }
  }

  const electron = spawnElectron(args);
  const cleanup = () => {
    try { electron?.kill('SIGTERM'); } catch {}
    try { vite?.kill('SIGTERM'); } catch {}
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  electron.on('exit', (code) => {
    try { vite?.kill('SIGTERM'); } catch {}
    process.exit(code ?? 0);
  });
})();
