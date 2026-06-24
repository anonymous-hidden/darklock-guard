/**
 * system-control.js — cross-platform system control surface used by
 * the tool registry. Linux is first-class; macOS and Windows have
 * best-effort fallbacks.
 *
 * Every method returns a promise resolving to a normalized result and
 * never throws to the caller; the tool layer wraps these in {ok,...}.
 */
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fsSync from 'fs';
import { promises as fs } from 'fs';
import { app, shell, BrowserWindow, screen, Notification } from 'electron';
import https from 'https';
import http from 'http';

const execP = promisify(exec);
const PLATFORM = process.platform;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function run(cmd, opts = {}) {
  try {
    const { stdout, stderr } = await execP(cmd, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, ...opts });
    return { ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), stdout: '', stderr: String(err?.stderr || '') };
  }
}

async function which(bin) {
  const cmd = PLATFORM === 'win32' ? `where ${bin}` : `command -v ${bin}`;
  const r = await run(cmd);
  return r.ok && r.stdout.trim() ? r.stdout.trim().split('\n')[0] : null;
}

function bytesToGB(n) { return Math.round((n / 1024 / 1024 / 1024) * 100) / 100; }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

/* ------------------------------------------------------------------ */
/*  Apps — open/close                                                  */
/* ------------------------------------------------------------------ */

const APP_ALIASES = {
  // common aliases → linux command, mac app name, windows search
  brave:    { linux: 'brave-browser',     mac: 'Brave Browser',     win: 'brave.exe' },
  chrome:   { linux: 'google-chrome',     mac: 'Google Chrome',     win: 'chrome.exe' },
  chromium: { linux: 'chromium',          mac: 'Chromium',          win: 'chromium.exe' },
  firefox:  { linux: 'firefox',           mac: 'Firefox',           win: 'firefox.exe' },
  spotify:  { linux: 'spotify',           mac: 'Spotify',           win: 'Spotify.exe' },
  vscode:   { linux: 'code',              mac: 'Visual Studio Code', win: 'code' },
  'vs code':{ linux: 'code',              mac: 'Visual Studio Code', win: 'code' },
  code:     { linux: 'code',              mac: 'Visual Studio Code', win: 'code' },
  terminal: { linux: 'gnome-terminal',    mac: 'Terminal',          win: 'wt.exe' },
  files:    { linux: 'nautilus',          mac: 'Finder',            win: 'explorer.exe' },
  discord:  { linux: 'discord',           mac: 'Discord',           win: 'Discord.exe' },
  slack:    { linux: 'slack',             mac: 'Slack',             win: 'slack.exe' },
};

// Per-app fallback launch chains for Linux (snap / flatpak / native installs).
const LINUX_LAUNCH_CHAINS = {
  brave: [
    ['brave-browser', []],
    ['brave', []],
    ['brave-browser-stable', []],
    ['flatpak', ['run', 'com.brave.Browser']],
  ],
  spotify: [
    ['spotify', []],
    ['snap', ['run', 'spotify']],
    ['flatpak', ['run', 'com.spotify.Client']],
    ['xdg-open', ['spotify://']],
  ],
  chrome:  [['google-chrome', []], ['google-chrome-stable', []], ['chromium', []], ['chromium-browser', []]],
  vscode:  [['code', []], ['codium', []], ['flatpak', ['run', 'com.visualstudio.code']]],
  discord: [['discord', []], ['flatpak', ['run', 'com.discordapp.Discord']]],
};

function normalizeAppKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\b(app|application|program)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitDesktopExec(execLine) {
  const cleaned = String(execLine || '')
    .replace(/\s+%[fFuUdDnNickvm]/g, '')
    .trim();
  if (!cleaned) return [];
  const parts = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(cleaned))) parts.push(match[1] ?? match[2] ?? match[3]);
  return parts;
}

function desktopSearchDirs() {
  return [
    path.join(os.homedir(), '.local/share/applications'),
    '/usr/local/share/applications',
    '/usr/share/applications',
    '/var/lib/flatpak/exports/share/applications',
    path.join(os.homedir(), '.local/share/flatpak/exports/share/applications'),
    '/snap/bin',
  ];
}

function findDesktopEntry(query) {
  const q = normalizeAppKey(query);
  const words = q.split(/\s+/).filter(Boolean);
  if (!q) return null;
  let best = null;
  for (const dir of desktopSearchDirs()) {
    if (!fsSync.existsSync(dir)) continue;
    for (const file of fsSync.readdirSync(dir)) {
      if (!file.endsWith('.desktop')) continue;
      const fullPath = path.join(dir, file);
      let raw = '';
      try { raw = fsSync.readFileSync(fullPath, 'utf-8'); } catch { continue; }
      if (/^\s*NoDisplay\s*=\s*true/im.test(raw) || /^\s*Hidden\s*=\s*true/im.test(raw)) continue;
      const name = raw.match(/^\s*Name\s*=\s*(.+)$/im)?.[1]?.trim() || file.replace(/\.desktop$/i, '');
      const execLine = raw.match(/^\s*Exec\s*=\s*(.+)$/im)?.[1]?.trim() || '';
      const id = file.replace(/\.desktop$/i, '');
      const hay = `${name} ${id} ${execLine}`.toLowerCase();
      let score = hay.includes(q) ? 100 : 0;
      score += words.reduce((n, word) => n + (hay.includes(word) ? 12 : 0), 0);
      if (score > (best?.score || 0)) best = { score, name, id, path: fullPath, execLine };
    }
  }
  return best && best.score >= Math.max(12, words.length * 10) ? best : null;
}

function trySpawnChain(chain, extraArgs = []) {
  return new Promise((resolve) => {
    const tryNext = (i) => {
      if (i >= chain.length) { resolve({ ok: false, error: 'no working launcher found' }); return; }
      const [cmd, baseArgs] = chain[i];
      try {
        const child = spawn(cmd, [...baseArgs, ...(Array.isArray(extraArgs) ? extraArgs : [])],
          { detached: true, stdio: 'ignore' });
        child.on('error', () => tryNext(i + 1));
        child.unref();
        // Give it a moment to actually exec — if it errors immediately we'll
        // try the next entry.
        setTimeout(() => resolve({ ok: true, app: cmd }), 350);
      } catch { tryNext(i + 1); }
    };
    tryNext(0);
  });
}

export async function openApp(nameOrPath, args = []) {
  const key = normalizeAppKey(nameOrPath);
  const alias = APP_ALIASES[key];
  if (PLATFORM === 'linux') {
    const chain = LINUX_LAUNCH_CHAINS[key];
    if (chain) return trySpawnChain(chain, args);
    const cmd = alias?.linux || nameOrPath;
    return new Promise((resolve) => {
      try {
        const child = spawn(cmd, Array.isArray(args) ? args : [], { detached: true, stdio: 'ignore' });
        child.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
        child.unref();
        setTimeout(() => resolve({ ok: true, app: cmd }), 250);
      } catch (e) { resolve({ ok: false, error: String(e?.message || e) }); }
    }).then(async (direct) => {
      if (direct.ok) return direct;
      const desktop = findDesktopEntry(key);
      if (!desktop) return direct;
      if (await which('gtk-launch')) {
        const r = await trySpawnChain([['gtk-launch', [desktop.id]]], args);
        if (r.ok) return { ...r, app: desktop.name };
      }
      if (await which('gio')) {
        const r = await trySpawnChain([['gio', ['launch', desktop.path]]], args);
        if (r.ok) return { ...r, app: desktop.name };
      }
      const execParts = splitDesktopExec(desktop.execLine);
      if (!execParts.length) return direct;
      const [desktopCmd, ...desktopArgs] = execParts;
      const r = await trySpawnChain([[desktopCmd, desktopArgs]], args);
      return r.ok ? { ...r, app: desktop.name } : direct;
    });
  }
  if (PLATFORM === 'darwin') {
    const target = alias?.mac || nameOrPath;
    return run(`open -a ${JSON.stringify(target)}`);
  }
  if (PLATFORM === 'win32') {
    const target = alias?.win || nameOrPath;
    return run(`start "" "${target}"`);
  }
  return { ok: false, error: 'unsupported platform' };
}

function appProcessTargets(name) {
  const key = normalizeAppKey(name);
  const alias = APP_ALIASES[key]?.linux;
  const chainTargets = (LINUX_LAUNCH_CHAINS[key] || []).map(([cmd, args]) => args?.[1] || cmd);
  const base = [alias, key, key.replace(/\s+/g, ''), key.replace(/\s+/g, '-')].filter(Boolean);
  return [...new Set([...base, ...chainTargets])];
}

async function closeMatchingWindows(name) {
  if (PLATFORM !== 'linux' || !(await which('wmctrl'))) return { ok: false, closed: 0, reason: 'wmctrl unavailable' };
  const key = normalizeAppKey(name);
  const words = key.split(/\s+/).filter(Boolean);
  const r = await run('wmctrl -lx');
  if (!r.ok) return { ok: false, closed: 0, error: r.error };
  let closed = 0;
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(0x[0-9a-f]+)\s+\S+\s+(\S+)\s+\S+\s+(.+)$/i);
    if (!m) continue;
    const [, wid, cls, title] = m;
    const hay = `${cls} ${title}`.toLowerCase();
    if (words.length && !words.every((w) => hay.includes(w)) && !hay.includes(key)) continue;
    const cr = await run(`wmctrl -ic ${JSON.stringify(wid)}`);
    if (cr.ok) closed += 1;
  }
  return { ok: closed > 0, closed };
}

export async function closeApp(name) {
  const n = normalizeAppKey(name);
  if (PLATFORM === 'linux') {
    const closedWindows = await closeMatchingWindows(n);
    if (closedWindows.ok) return { ok: true, method: 'window-close', closed: closedWindows.closed };
    const targets = appProcessTargets(n);
    for (const target of targets) {
      const r = await run(`pkill -TERM -i -f ${JSON.stringify(target)}`);
      if (r.ok) return { ok: true, method: 'pkill-term', target };
    }
    return { ok: false, error: `no running process matched ${name}`, tried: targets };
  }
  const alias = APP_ALIASES[n];
  if (PLATFORM === 'darwin')  return run(`osascript -e 'quit app ${JSON.stringify(alias?.mac || name)}'`);
  if (PLATFORM === 'win32')   return run(`taskkill /im "${alias?.win || name}" /f`);
  return { ok: false, error: 'unsupported platform' };
}

export async function killApp(name) {
  const n = normalizeAppKey(name);
  if (PLATFORM === 'linux') {
    const targets = appProcessTargets(n);
    for (const target of targets) {
      const r = await run(`pkill -KILL -i -f ${JSON.stringify(target)}`);
      if (r.ok) return { ok: true, method: 'pkill-kill', target };
    }
    return { ok: false, error: `no running process matched ${name}`, tried: targets };
  }
  const alias = APP_ALIASES[n];
  if (PLATFORM === 'darwin') return run(`pkill -9 -if ${JSON.stringify(alias?.mac || name)}`);
  if (PLATFORM === 'win32') return run(`taskkill /im "${alias?.win || name}" /f`);
  return { ok: false, error: 'unsupported platform' };
}

export async function desktopSnapshot({ includeScreenshot = false } = {}) {
  const snapshot = {
    ok: true,
    platform: PLATFORM,
    activeWindow: null,
    windows: [],
    apps: [],
    screenshot: null,
  };

  if (PLATFORM === 'linux') {
    if (await which('xdotool')) {
      const active = await run('xdotool getactivewindow getwindowclassname getwindowname 2>/dev/null');
      const lines = active.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
      if (lines.length) snapshot.activeWindow = { class: lines[0] || '', title: lines.slice(1).join(' ') || '' };
    }
    if (await which('wmctrl')) {
      const r = await run('wmctrl -lx');
      snapshot.windows = r.stdout.split('\n').map((line) => {
        const m = line.match(/^(0x[0-9a-f]+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/i);
        if (!m) return null;
        return { id: m[1], desktop: m[2], class: m[3], host: m[4], title: m[5] };
      }).filter(Boolean).slice(0, 80);
    }
    const ps = await run('ps -eo pid=,comm=,args= --sort=comm');
    if (ps.ok) {
      const seen = new Set();
      snapshot.apps = ps.stdout.split('\n').map((line) => {
        const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
        if (!m) return null;
        const appName = m[2];
        if (seen.has(appName)) return null;
        seen.add(appName);
        return { pid: Number(m[1]), name: appName, command: m[3].slice(0, 240) };
      }).filter(Boolean).slice(0, 120);
    }
  } else if (PLATFORM === 'darwin') {
    const r = await run(`osascript -e 'tell application "System Events" to get name of every process whose background only is false'`);
    snapshot.apps = r.stdout.split(',').map((name) => ({ name: name.trim() })).filter((x) => x.name);
  } else if (PLATFORM === 'win32') {
    const r = await run('powershell -NoProfile -Command "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress"');
    try {
      const rows = JSON.parse(r.stdout || '[]');
      snapshot.windows = (Array.isArray(rows) ? rows : [rows]).map((x) => ({ id: x.Id, class: x.ProcessName, title: x.MainWindowTitle }));
      snapshot.apps = snapshot.windows.map((x) => ({ pid: x.id, name: x.class }));
    } catch {}
  }

  if (includeScreenshot) {
    snapshot.screenshot = await takeScreenshot({});
  }
  return snapshot;
}

async function activeWindowInfo() {
  if (PLATFORM !== 'linux' || !(await which('xdotool'))) return {};
  const active = await run('xdotool getactivewindow getwindowclassname getwindowname 2>/dev/null');
  const lines = active.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
  return lines.length ? { class: lines[0] || '', title: lines.slice(1).join(' ') || '' } : {};
}

function isChatLikeWindow(info) {
  const hay = `${info?.class || ''} ${info?.title || ''}`.toLowerCase();
  return /\b(discord|slack|telegram|signal|whatsapp|messenger|teams|element)\b/.test(hay);
}

export async function desktopFocus({ app: appName = '', title = '' } = {}) {
  if (PLATFORM !== 'linux') return { ok: false, error: 'desktop focus is only implemented on Linux right now' };
  if (!(await which('wmctrl'))) return { ok: false, error: 'wmctrl is required for desktop focus' };
  const target = normalizeAppKey(appName || title);
  if (!target) return { ok: false, error: 'missing app or title' };
  const windows = await desktopSnapshot({ includeScreenshot: false });
  const words = target.split(/\s+/).filter(Boolean);
  const match = (windows.windows || []).find((w) => {
    const hay = `${w.class || ''} ${w.title || ''}`.toLowerCase();
    return hay.includes(target) || words.every((word) => hay.includes(word));
  });
  if (!match) return { ok: false, error: `no visible window matched ${target}` };
  const r = await run(`wmctrl -ia ${JSON.stringify(match.id)}`);
  return r.ok ? { ok: true, window: match } : r;
}

export async function desktopClick({ x, y, button = 1, focus = true } = {}) {
  if (PLATFORM !== 'linux') return { ok: false, error: 'desktop click is only implemented on Linux right now' };
  if (!(await which('xdotool'))) return { ok: false, error: 'xdotool is required for desktop click' };
  const px = Math.round(Number(x));
  const py = Math.round(Number(y));
  const btn = Math.max(1, Math.min(5, Math.round(Number(button) || 1)));
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { ok: false, error: 'x and y coordinates are required' };
  const cmd = focus
    ? `xdotool mousemove ${px} ${py} click ${btn}`
    : `xdotool mousemove --sync ${px} ${py} click ${btn}`;
  const r = await run(cmd);
  return { ...r, x: px, y: py, button: btn };
}

export async function desktopType({ text = '', delayMs = 8, confirmSend = false } = {}) {
  if (PLATFORM !== 'linux') return { ok: false, error: 'desktop typing is only implemented on Linux right now' };
  if (!(await which('xdotool'))) return { ok: false, error: 'xdotool is required for desktop typing' };
  const value = String(text || '');
  if (!value) return { ok: false, error: 'missing text' };
  if (/\n$/.test(value) && isChatLikeWindow(await activeWindowInfo()) && !confirmSend) {
    return { ok: false, error: 'blocked: this looks like sending a chat/social message. Type the draft without Enter, then confirm send explicitly.' };
  }
  const r = await run(`xdotool type --delay ${Math.max(0, Number(delayMs) || 0)} -- ${JSON.stringify(value)}`);
  return { ...r, typedChars: value.length };
}

export async function desktopKey({ key = '', confirmSend = false } = {}) {
  if (PLATFORM !== 'linux') return { ok: false, error: 'desktop hotkeys are only implemented on Linux right now' };
  if (!(await which('xdotool'))) return { ok: false, error: 'xdotool is required for desktop hotkeys' };
  const combo = String(key || '').trim();
  if (!combo) return { ok: false, error: 'missing key' };
  if (/^(return|enter|kp_enter)$/i.test(combo) && isChatLikeWindow(await activeWindowInfo()) && !confirmSend) {
    return { ok: false, error: 'blocked: Enter may send a chat/social message. Ask Cayden to confirm send first.' };
  }
  const r = await run(`xdotool key -- ${JSON.stringify(combo)}`);
  return { ...r, key: combo };
}

export async function desktopScroll({ amount = -5 } = {}) {
  if (PLATFORM !== 'linux') return { ok: false, error: 'desktop scrolling is only implemented on Linux right now' };
  if (!(await which('xdotool'))) return { ok: false, error: 'xdotool is required for desktop scrolling' };
  const n = Math.max(-30, Math.min(30, Math.round(Number(amount) || 0)));
  if (!n) return { ok: false, error: 'amount must be non-zero' };
  const button = n < 0 ? 5 : 4;
  const count = Math.abs(n);
  const r = await run(`xdotool click --repeat ${count} ${button}`);
  return { ...r, amount: n };
}

export async function desktopRead({ includeScreenshot = true, ocr = true } = {}) {
  const shot = includeScreenshot ? await takeScreenshot({}) : null;
  let text = '';
  let ocrResult = null;
  if (ocr && shot?.ok && shot.path && PLATFORM === 'linux' && (await which('tesseract'))) {
    ocrResult = await run(`tesseract ${JSON.stringify(shot.path)} stdout --psm 6`);
    text = (ocrResult.stdout || '').trim().slice(0, 12000);
  }
  const snap = await desktopSnapshot({ includeScreenshot: false });
  return {
    ok: true,
    screenshot: shot,
    ocrAvailable: !!(ocr && PLATFORM === 'linux' && await which('tesseract')),
    text,
    activeWindow: snap.activeWindow,
    windows: snap.windows,
    apps: snap.apps,
    ocrError: ocrResult?.ok === false ? ocrResult.error : null,
  };
}

/* ------------------------------------------------------------------ */
/*  Volume                                                             */
/* ------------------------------------------------------------------ */

export async function getVolume() {
  if (PLATFORM === 'linux') {
    if (await which('pactl')) {
      const r = await run('pactl get-sink-volume @DEFAULT_SINK@');
      const m = r.stdout.match(/(\d+)%/);
      const muted = await run('pactl get-sink-mute @DEFAULT_SINK@');
      return { ok: true, level: m ? Number(m[1]) : null, muted: /yes/i.test(muted.stdout) };
    }
    if (await which('amixer')) {
      const r = await run("amixer get Master | grep -oE '[0-9]+%' | head -1");
      const muted = await run("amixer get Master | grep -oE '\\[(on|off)\\]' | head -1");
      return { ok: true, level: r.stdout ? Number(r.stdout.replace('%','').trim()) : null, muted: /off/.test(muted.stdout) };
    }
  }
  if (PLATFORM === 'darwin') {
    const r = await run("osascript -e 'output volume of (get volume settings)'");
    const m = await run("osascript -e 'output muted of (get volume settings)'");
    return { ok: true, level: Number(r.stdout.trim()) || 0, muted: /true/i.test(m.stdout) };
  }
  return { ok: false, error: 'unsupported platform' };
}

export async function setVolume(level) {
  const lv = clamp(Number(level) || 0, 0, 100);
  if (PLATFORM === 'linux') {
    if (await which('pactl')) return run(`pactl set-sink-volume @DEFAULT_SINK@ ${lv}%`).then((r) => ({ ...r, level: lv }));
    if (await which('amixer')) return run(`amixer set Master ${lv}%`).then((r) => ({ ...r, level: lv }));
  }
  if (PLATFORM === 'darwin') return run(`osascript -e 'set volume output volume ${lv}'`).then((r) => ({ ...r, level: lv }));
  if (PLATFORM === 'win32') {
    // Windows requires nircmd or PowerShell helper. Best-effort PS approach:
    const ps = `(New-Object -ComObject WScript.Shell).SendKeys([char]173)`;  // mute toggle key — just a stub
    return run(`powershell -NoProfile -Command "${ps}"`);
  }
  return { ok: false, error: 'unsupported platform' };
}

export async function setMute(mute) {
  if (PLATFORM === 'linux') {
    if (await which('pactl')) return run(`pactl set-sink-mute @DEFAULT_SINK@ ${mute ? 1 : 0}`);
    if (await which('amixer')) return run(`amixer set Master ${mute ? 'mute' : 'unmute'}`);
  }
  if (PLATFORM === 'darwin') return run(`osascript -e 'set volume ${mute ? 'with' : 'without'} output muted'`);
  return { ok: false, error: 'unsupported platform' };
}

/* ------------------------------------------------------------------ */
/*  Brightness                                                         */
/* ------------------------------------------------------------------ */

export async function getBrightness() {
  if (PLATFORM === 'linux') {
    if (await which('brightnessctl')) {
      const r = await run('brightnessctl -m');
      // format: device,class,current,percent%,max
      const parts = r.stdout.split(',');
      if (parts.length >= 4) return { ok: true, level: Number(parts[3].replace('%','')) };
    }
    // /sys/class/backlight fallback
    try {
      const dirs = await fs.readdir('/sys/class/backlight');
      if (dirs.length) {
        const dev = path.join('/sys/class/backlight', dirs[0]);
        const cur = Number(await fs.readFile(path.join(dev, 'brightness'), 'utf-8'));
        const max = Number(await fs.readFile(path.join(dev, 'max_brightness'), 'utf-8'));
        return { ok: true, level: Math.round((cur / max) * 100) };
      }
    } catch {}
  }
  if (PLATFORM === 'darwin') {
    if (await which('brightness')) {
      const r = await run('brightness -l 2>&1 | grep "brightness" | head -1');
      const m = r.stdout.match(/([\d.]+)$/);
      return { ok: true, level: m ? Math.round(Number(m[1]) * 100) : null };
    }
  }
  return { ok: false, error: 'brightness control not available' };
}

export async function setBrightness(level) {
  const lv = clamp(Number(level) || 0, 1, 100);
  if (PLATFORM === 'linux') {
    if (await which('brightnessctl')) return run(`brightnessctl set ${lv}%`).then((r) => ({ ...r, level: lv }));
  }
  if (PLATFORM === 'darwin') {
    if (await which('brightness')) return run(`brightness ${(lv / 100).toFixed(2)}`).then((r) => ({ ...r, level: lv }));
  }
  return { ok: false, error: 'brightness control not available' };
}

/* ------------------------------------------------------------------ */
/*  Screenshots                                                         */
/* ------------------------------------------------------------------ */

export async function takeScreenshot({ region = null, savePath = null } = {}) {
  const screensDir = path.join(app.getPath('pictures'), 'Jarvis Screenshots');
  await fs.mkdir(screensDir, { recursive: true });
  const out = savePath || path.join(screensDir, `nova-${Date.now()}.png`);

  if (PLATFORM === 'linux') {
    // try grim (wayland), then maim, then scrot
    if (await which('grim')) {
      const cmd = region ? `grim -g "${region.x},${region.y} ${region.w}x${region.h}" ${JSON.stringify(out)}` : `grim ${JSON.stringify(out)}`;
      const r = await run(cmd);
      return { ...r, path: out };
    }
    if (await which('maim'))  { const r = await run(`maim ${JSON.stringify(out)}`);  return { ...r, path: out }; }
    if (await which('scrot')) { const r = await run(`scrot ${JSON.stringify(out)}`); return { ...r, path: out }; }
  }
  if (PLATFORM === 'darwin') {
    const r = await run(`screencapture -x ${JSON.stringify(out)}`);
    return { ...r, path: out };
  }
  if (PLATFORM === 'win32') {
    // Use Electron's built-in capturer as fallback
    return captureViaElectron(out);
  }
  return captureViaElectron(out);
}

async function captureViaElectron(out) {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return { ok: false, error: 'no window' };
    const img = await win.capturePage();
    await fs.writeFile(out, img.toPNG());
    return { ok: true, path: out };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/* ------------------------------------------------------------------ */
/*  Power                                                              */
/* ------------------------------------------------------------------ */

export async function powerAction(action, { delaySec = 0 } = {}) {
  const a = String(action || '').toLowerCase();
  const d = Math.max(0, Math.floor(Number(delaySec) || 0));
  if (PLATFORM === 'linux') {
    if (a === 'shutdown') return run(`shutdown -h +${Math.ceil(d / 60) || 0}`);
    if (a === 'restart')  return run(`shutdown -r +${Math.ceil(d / 60) || 0}`);
    if (a === 'sleep')    return run(d ? `bash -c "sleep ${d} && systemctl suspend"` : 'systemctl suspend');
    if (a === 'logout')   return run('loginctl terminate-user $USER');
  }
  if (PLATFORM === 'darwin') {
    if (a === 'shutdown') return run(`osascript -e 'tell app "System Events" to shut down'`);
    if (a === 'restart')  return run(`osascript -e 'tell app "System Events" to restart'`);
    if (a === 'sleep')    return run('pmset sleepnow');
  }
  if (PLATFORM === 'win32') {
    if (a === 'shutdown') return run(`shutdown /s /t ${d}`);
    if (a === 'restart')  return run(`shutdown /r /t ${d}`);
    if (a === 'sleep')    return run('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
  }
  return { ok: false, error: 'unknown power action' };
}

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

const SHELL_BLOCKLIST = [
  /\brm\s+-rf\s+\/(?!\w)/i,
  /\bdd\s+if=.*of=\/dev\/[sh]da/i,
  /:\(\)\{:\|:&\};:/,                 // forkbomb
  /\bmkfs\./i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\b(doas|pkexec|su)\b/i,
  /\b(passwd|useradd|usermod|groupadd|visudo)\b/i,
  /\b(systemctl|service)\s+(start|stop|restart|enable|disable|mask)\b/i,
  /\b>\s*\/dev\/sd[a-z]/i,
];

const TERMINAL_APPROVAL_PATTERNS = [
  /\brm\b/i,
  /\bmv\b.*\s\/(etc|usr|var|boot|opt)\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bkill(all)?\b/i,
  /\bdocker\b/i,
  /\bsudo\b/i,
  /\b(apt|apt-get|dnf|yum|pacman|zypper|brew)\s+(install|remove|purge|upgrade|dist-upgrade)\b/i,
  /\b(npm|pnpm|yarn)\s+(install|add|remove|update)\b/i,
];

function commandSafety(command) {
  const cmd = String(command || '').trim();
  for (const rx of SHELL_BLOCKLIST) {
    if (rx.test(cmd)) return { allowed: false, approvalRequired: false, reason: `blocked by safety filter: ${rx}` };
  }
  for (const rx of TERMINAL_APPROVAL_PATTERNS) {
    if (rx.test(cmd)) return { allowed: true, approvalRequired: true, reason: `requires physical approval: ${rx}` };
  }
  return { allowed: true, approvalRequired: false, reason: '' };
}

export async function runShell(command, { cwd = null, timeoutMs = 30_000 } = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) return { ok: false, error: 'empty command' };
  const safety = commandSafety(cmd);
  if (!safety.allowed) return { ok: false, error: `command rejected: ${safety.reason}` };
  if (safety.approvalRequired) return { ok: false, error: safety.reason };
  return run(cmd, { cwd: cwd || os.homedir(), timeout: timeoutMs });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

let sharedTerminal = null;

function sharedTerminalPaths() {
  const base = `nova-shared-terminal-${process.getuid?.() || 'user'}`;
  return {
    fifo: path.join(os.tmpdir(), `${base}.fifo`),
    log: path.join(os.tmpdir(), `${base}.log`),
  };
}

function terminalLoopBody(fifo, log) {
  return [
    `rm -f ${shellQuote(fifo)}`,
    `mkfifo ${shellQuote(fifo)}`,
    `touch ${shellQuote(log)}`,
    `echo 'Jarvis shared terminal is ready.'`,
    `echo 'Commands from Jarvis will appear in this same window.'`,
    `while true; do`,
    `  if IFS= read -r __nova_cmd < ${shellQuote(fifo)}; then`,
    `    [ "$__nova_cmd" = "__NOVA_EXIT__" ] && break`,
    `    printf '\\nJarvis $ %s\\n' "$__nova_cmd" | tee -a ${shellQuote(log)}`,
    `    bash -lc "$__nova_cmd" 2>&1 | tee -a ${shellQuote(log)}`,
    `    printf '[exit %s]\\n' "$PIPESTATUS" | tee -a ${shellQuote(log)}`,
    `  fi`,
    `done`,
    `rm -f ${shellQuote(fifo)}`,
    `exec bash`,
  ].join('\n');
}

async function sendToSharedTerminal(command) {
  const paths = sharedTerminalPaths();
  if (!fsSync.existsSync(paths.fifo)) return { ok: false, error: 'shared terminal is not ready' };
  const writer = spawn('bash', ['-lc', `printf '%s\\n' ${shellQuote(command)} > ${shellQuote(paths.fifo)}`], {
    detached: true,
    stdio: 'ignore',
  });
  writer.unref();
  return { ok: true, terminal: sharedTerminal?.terminal || 'shared', reused: true, log: paths.log };
}

async function startSharedTerminal({ cwd = null } = {}) {
  const dir = cwd || os.homedir();
  const paths = sharedTerminalPaths();
  const body = terminalLoopBody(paths.fifo, paths.log);
  const terminals = PLATFORM === 'linux'
    ? [
        ['x-terminal-emulator', ['-e', 'bash', '-lc', body]],
        ['gnome-terminal', ['--', 'bash', '-lc', body]],
        ['konsole', ['-e', 'bash', '-lc', body]],
        ['xfce4-terminal', ['-e', `bash -lc ${shellQuote(body)}`]],
      ]
    : [];

  for (const [bin, args] of terminals) {
    if (!(await which(bin))) continue;
    try {
      const child = spawn(bin, args, { cwd: dir, detached: true, stdio: 'ignore' });
      child.unref();
      sharedTerminal = { terminal: bin, fifo: paths.fifo, log: paths.log, startedAt: Date.now() };
      await sleep(550);
      return { ok: true, terminal: bin, reused: false, log: paths.log };
    } catch {}
  }
  return { ok: false, error: 'no supported terminal emulator found' };
}

export async function openTerminal(command = '', { cwd = null } = {}) {
  const dir = cwd || os.homedir();
  const cmd = String(command || '').trim();
  const safety = commandSafety(cmd);
  if (cmd && !safety.allowed) return { ok: false, error: `command rejected: ${safety.reason}` };

  const approvalPrefix = safety.approvalRequired
    ? `printf 'Jarvis wants to run a protected command:\\n%s\\n\\nType RUN and press Enter to continue: ' ${shellQuote(cmd)}; read ok; [ "$ok" = RUN ] || { echo 'Cancelled.'; exec bash; }; `
    : '';
  const queuedCommand = cmd ? `${approvalPrefix}${cmd}` : '';

  if (PLATFORM === 'linux') {
    if (!sharedTerminal || !fsSync.existsSync(sharedTerminal.fifo)) {
      const started = await startSharedTerminal({ cwd: dir });
      if (!started.ok) return started;
      if (!queuedCommand) return { ...started, approvalRequired: safety.approvalRequired };
    }
    if (queuedCommand) {
      const sent = await sendToSharedTerminal(queuedCommand);
      if (sent.ok) return { ...sent, approvalRequired: safety.approvalRequired };
      sharedTerminal = null;
      const restarted = await startSharedTerminal({ cwd: dir });
      if (!restarted.ok) return restarted;
      return { ...(await sendToSharedTerminal(queuedCommand)), approvalRequired: safety.approvalRequired };
    }
    return { ok: true, terminal: sharedTerminal.terminal, reused: true, log: sharedTerminal.log, approvalRequired: safety.approvalRequired };
  }

  if (PLATFORM === 'darwin') {
    const body = cmd ? `${approvalPrefix}${cmd}; echo; read -p 'Command finished. Press Enter to keep terminal open...' _; exec bash` : 'exec bash';
    const script = cmd
      ? `tell application "Terminal" to do script ${JSON.stringify(`cd ${shellQuote(dir)}; ${body}`)}`
      : `tell application "Terminal" to do script ${JSON.stringify(`cd ${shellQuote(dir)}`)}`;
    return run(`osascript -e ${shellQuote(script)}`);
  }

  return { ok: false, error: 'no supported terminal emulator found' };
}

export async function openTerminalAi(task = '', { rootDir = null } = {}) {
  const botDir = rootDir ? path.resolve(rootDir, '..', '..') : os.homedir();
  const script = path.join(botDir, 'ai-terminal.py');
  if (!fsSync.existsSync(script)) return { ok: false, error: `ai-terminal.py not found at ${script}` };

  const venvPy = path.join(botDir, '.venv', 'bin', 'python3');
  const py = fsSync.existsSync(venvPy) ? venvPy : 'python3';
  let command = `${shellQuote(py)} ${shellQuote(script)}`;
  const text = String(task || '').trim();
  if (text) {
    const promptFile = path.join(os.tmpdir(), `nova-ai-task-${Date.now()}.txt`);
    fsSync.writeFileSync(promptFile, text, 'utf8');
    command += ` --prompt-file ${shellQuote(promptFile)}`;
  }
  return openTerminal(command, { cwd: botDir });
}

/* ------------------------------------------------------------------ */
/*  System stats                                                       */
/* ------------------------------------------------------------------ */

let _lastCpu = null;
function _cpuSample() {
  const cpus = os.cpus();
  const totals = cpus.reduce((acc, c) => {
    for (const k of Object.keys(c.times)) acc[k] = (acc[k] || 0) + c.times[k];
    return acc;
  }, {});
  const idle = totals.idle;
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  return { idle, total };
}

async function _gpuStats() {
  if (PLATFORM !== 'linux') return null;
  if (!(await which('nvidia-smi'))) return null;
  try {
    const q = await run('nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free --format=csv,noheader,nounits | head -1');
    if (!q.ok || !q.stdout.trim()) return null;
    const parts = q.stdout.trim().split(',').map((s) => s.trim());
    if (parts.length < 4) return null;
    const name = parts[0];
    const totalMB = Number(parts[1]);
    const usedMB  = Number(parts[2]);
    const freeMB  = Number(parts[3]);
    if (!Number.isFinite(totalMB) || totalMB <= 0) return null;
    return {
      name,
      totalGB: Math.round((totalMB / 1024) * 100) / 100,
      usedGB: Math.round((usedMB / 1024) * 100) / 100,
      freeGB: Math.round((freeMB / 1024) * 100) / 100,
      pct: Math.max(0, Math.min(100, Math.round((usedMB / totalMB) * 100))),
    };
  } catch {
    return null;
  }
}

export async function systemStats() {
  const sample = _cpuSample();
  let cpuPct = 0;
  if (_lastCpu) {
    const idleDiff = sample.idle - _lastCpu.idle;
    const totalDiff = sample.total - _lastCpu.total;
    cpuPct = totalDiff > 0 ? Math.max(0, Math.min(100, 100 - Math.round((idleDiff / totalDiff) * 100))) : 0;
  }
  _lastCpu = sample;

  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const usedMem  = totalMem - freeMem;

  let disk = null;
  try {
    if (PLATFORM !== 'win32') {
      const r = await run("df -k --output=size,used,avail / | tail -1");
      const parts = r.stdout.trim().split(/\s+/);
      if (parts.length >= 3) {
        const total = Number(parts[0]) * 1024;
        const used  = Number(parts[1]) * 1024;
        const free  = Number(parts[2]) * 1024;
        disk = { totalGB: bytesToGB(total), usedGB: bytesToGB(used), freeGB: bytesToGB(free), pct: Math.round((used / total) * 100) };
      }
    }
  } catch {}

  const load = os.loadavg();
  const gpu = await _gpuStats();
  return {
    ok: true,
    ts: Date.now(),
    platform: PLATFORM,
    arch: os.arch(),
    hostname: os.hostname(),
    uptimeSec: os.uptime(),
    cpu: { count: os.cpus().length, model: os.cpus()[0]?.model, pct: cpuPct, load1: load[0], load5: load[1], load15: load[2] },
    memory: { totalGB: bytesToGB(totalMem), usedGB: bytesToGB(usedMem), freeGB: bytesToGB(freeMem), pct: Math.round((usedMem / totalMem) * 100) },
    gpu,
    disk,
  };
}

/* ------------------------------------------------------------------ */
/*  File search                                                        */
/* ------------------------------------------------------------------ */

export async function findFiles({ query, root = os.homedir(), type = null, maxResults = 200 }) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'empty query' };
  const safeRoot = path.resolve(root || os.homedir());
  // Use platform-appropriate search.
  if (PLATFORM === 'win32') {
    const r = await run(`powershell -NoProfile -Command "Get-ChildItem -Path '${safeRoot}' -Recurse -ErrorAction SilentlyContinue -Filter '*${q}*' | Select-Object -First ${maxResults} | ForEach-Object { $_.FullName }"`);
    return { ok: true, results: r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) };
  }
  // Prefer fd, then find
  let cmd;
  if (await which('fd')) {
    cmd = `fd --hidden --no-ignore-vcs --max-results ${maxResults} ${type === 'dir' ? '-t d' : type === 'file' ? '-t f' : ''} ${JSON.stringify(q)} ${JSON.stringify(safeRoot)}`;
  } else {
    cmd = `find ${JSON.stringify(safeRoot)} -iname ${JSON.stringify('*' + q + '*')} ${type === 'dir' ? '-type d' : type === 'file' ? '-type f' : ''} 2>/dev/null | head -n ${maxResults}`;
  }
  const r = await run(cmd, { timeout: 25_000 });
  return { ok: r.ok, results: r.stdout.split('\n').map((s) => s.trim()).filter(Boolean), error: r.error };
}

/* ------------------------------------------------------------------ */
/*  Downloads — sort by extension                                      */
/* ------------------------------------------------------------------ */

const EXT_BUCKETS = {
  Images:    new Set(['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.heic']),
  Videos:    new Set(['.mp4','.mkv','.mov','.avi','.webm','.flv','.wmv']),
  Audio:     new Set(['.mp3','.wav','.flac','.ogg','.m4a','.aac','.opus']),
  Documents: new Set(['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.odt','.rtf']),
  Text:      new Set(['.txt','.md','.csv','.tsv']),
  Code:      new Set(['.js','.ts','.tsx','.jsx','.py','.go','.rs','.c','.cpp','.h','.java','.rb','.php','.html','.css','.json','.yaml','.yml','.sh']),
  Archives:  new Set(['.zip','.rar','.7z','.tar','.gz','.bz2','.xz']),
  Installers:new Set(['.deb','.rpm','.dmg','.pkg','.exe','.msi','.AppImage']),
};

export async function organizeDownloads({ dir = null } = {}) {
  const downloads = dir || app.getPath('downloads');
  let moved = 0;
  let skipped = 0;
  const summary = {};
  try {
    const entries = await fs.readdir(downloads, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) { skipped++; continue; }
      const ext = path.extname(e.name).toLowerCase();
      let bucket = 'Other';
      for (const [b, set] of Object.entries(EXT_BUCKETS)) {
        if (set.has(ext)) { bucket = b; break; }
      }
      const targetDir = path.join(downloads, bucket);
      await fs.mkdir(targetDir, { recursive: true });
      try {
        await fs.rename(path.join(downloads, e.name), path.join(targetDir, e.name));
        moved++;
        summary[bucket] = (summary[bucket] || 0) + 1;
      } catch { skipped++; }
    }
    return { ok: true, moved, skipped, summary, downloads };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/* ------------------------------------------------------------------ */
/*  Web — search + fetch                                               */
/* ------------------------------------------------------------------ */

function fetchUrl(url, { timeoutMs = 12000 } = {}) {
  return new Promise((resolve) => {
    let aborted = false;
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9', 'Accept-Language': 'en-US,en;q=0.9' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        return resolve(fetchUrl(next, { timeoutMs }));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        ok: true,
        status: res.statusCode,
        headers: res.headers || {},
        body: Buffer.concat(chunks).toString('utf-8'),
        url,
      }));
    });
    req.on('error', (e) => { if (!aborted) resolve({ ok: false, error: String(e?.message || e) }); });
    setTimeout(() => { aborted = true; req.destroy(); resolve({ ok: false, error: 'timeout' }); }, timeoutMs);
  });
}

async function fetchJson(url, opts = {}) {
  const r = await fetchUrl(url, opts);
  if (!r.ok) return r;
  try {
    return { ok: true, status: r.status, url: r.url, body: JSON.parse(r.body || '{}') };
  } catch (e) {
    return { ok: false, status: r.status, error: `invalid json: ${e.message}` };
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function webSearch(query, { limit = 8 } = {}) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const r = await fetchUrl(url);
  if (!r.ok) return r;
  // Parse result anchors (DuckDuckGo HTML version).
  const results = [];
  const rx = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = rx.exec(r.body)) && results.length < limit) {
    let href = m[1];
    // DDG sometimes wraps with /l/?uddg=...
    const u = href.match(/uddg=([^&]+)/);
    if (u) href = decodeURIComponent(u[1]);
    results.push({ title: stripHtml(m[2]), url: href, snippet: stripHtml(m[3]) });
  }
  return { ok: true, results };
}

export async function webFetch(url) {
  const r = await fetchUrl(String(url));
  if (!r.ok) return r;
  const text = stripHtml(r.body).slice(0, 12_000);
  const titleMatch = r.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return { ok: true, status: r.status, url: r.url, title: titleMatch ? stripHtml(titleMatch[1]) : null, text };
}

export async function webFetchRaw(url) {
  const r = await fetchUrl(String(url), { timeoutMs: 15000 });
  if (!r.ok) return r;
  return {
    ok: true,
    status: r.status,
    url: r.url,
    contentType: r.headers?.['content-type'] || '',
    body: r.body,
  };
}

/* ------------------------------------------------------------------ */
/*  Location                                                           */
/* ------------------------------------------------------------------ */

function locationStorePath() {
  return path.join(app.getPath('userData'), 'nova-location.json');
}

function normalizeLocationRecord(raw, source = 'manual') {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat ?? raw.latitude);
  const lon = Number(raw.lon ?? raw.lng ?? raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const city = String(raw.city || '').trim();
  const region = String(raw.region || raw.admin1 || '').trim();
  const country = String(raw.country || '').trim();
  const label = String(raw.label || raw.display_name || [city, region].filter(Boolean).join(', ') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`).trim();
  return {
    source,
    accuracy: raw.accuracy || (source === 'device-geolocation' ? 'device' : 'saved'),
    accuracyMeters: Number.isFinite(Number(raw.accuracyMeters)) ? Number(raw.accuracyMeters) : null,
    lat,
    lon,
    city,
    region,
    country,
    countryCode: String(raw.countryCode || raw.country_code || '').trim(),
    timezone: String(raw.timezone || '').trim(),
    postal: String(raw.postal || '').trim(),
    label,
    display_name: label,
    savedAt: raw.savedAt || new Date().toISOString(),
  };
}

async function readSavedLocation() {
  try {
    const raw = await fs.readFile(locationStorePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return normalizeLocationRecord(parsed?.location || parsed, parsed?.location?.source || parsed?.source || 'saved');
  } catch {
    return null;
  }
}

export async function getSavedLocationOverride() {
  const loc = await readSavedLocation();
  return loc ? { ok: true, location: loc, ...loc } : { ok: false, error: 'no saved location' };
}

export async function setCurrentLocationOverride(payload = {}) {
  let loc = normalizeLocationRecord(payload, payload.source || 'manual');
  const query = String(payload.query || payload.location || payload.place || '').trim();
  if (!loc && query) {
    const result = await mapSearch(query, { limit: 1 });
    const place = result?.places?.[0];
    if (!place) return { ok: false, error: `could not find location: ${query}` };
    loc = normalizeLocationRecord({
      ...place,
      label: place.name || place.display_name || query,
      display_name: place.display_name || place.name || query,
    }, 'manual-place');
  }
  if (!loc) return { ok: false, error: 'missing location coordinates or place name' };
  const record = { ...loc, savedAt: new Date().toISOString() };
  try {
    const file = locationStorePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ location: record }, null, 2));
    return { ok: true, location: record, ...record };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function clearCurrentLocationOverride() {
  try { await fs.unlink(locationStorePath()); } catch {}
  return { ok: true };
}

function normalizeNetworkLocation(body, source) {
  if (!body || typeof body !== 'object') return null;
  if (body.success === false) return null;
  const lat = Number(body.latitude ?? body.lat);
  const lon = Number(body.longitude ?? body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const city = String(body.city || body.town || '').trim();
  const region = String(body.region || body.region_name || body.regionName || '').trim();
  const country = String(body.country_name || body.country || '').trim();
  const countryCode = String(body.country_code || body.countryCode || '').trim();
  const timezone = typeof body.timezone === 'string'
    ? body.timezone
    : String(body.timezone?.id || '').trim();
  const postal = String(body.postal || body.zip || '').trim();
  const label = [city, region].filter(Boolean).join(', ') || country || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  return {
    source,
    accuracy: 'approximate-ip',
    lat,
    lon,
    city,
    region,
    country,
    countryCode,
    timezone,
    postal,
    label,
    display_name: label,
  };
}

export async function getCurrentLocation() {
  const saved = await readSavedLocation();
  if (saved) return { ok: true, ...saved };

  const providers = [
    ['ipapi', 'https://ipapi.co/json/'],
    ['ipwho.is', 'https://ipwho.is/'],
  ];
  const attempts = [];
  for (const [source, url] of providers) {
    const r = await fetchJson(url, { timeoutMs: 9000 });
    if (!r.ok) {
      attempts.push(`${source}: ${r.error || r.status || 'request failed'}`);
      continue;
    }
    const loc = normalizeNetworkLocation(r.body, source);
    if (loc) return { ok: true, ...loc };
    attempts.push(`${source}: unusable response`);
  }
  return { ok: false, error: attempts.join('; ') || 'location lookup failed' };
}

/* ------------------------------------------------------------------ */
/*  Maps                                                               */
/* ------------------------------------------------------------------ */

function normalizePlace(place) {
  if (!place) return null;
  return {
    name: place.name || place.display_name || '',
    display_name: place.display_name || place.name || '',
    lat: Number(place.lat),
    lon: Number(place.lon),
    type: place.type,
    class: place.class,
    place_id: place.place_id,
  };
}

function isCurrentLocationQuery(value) {
  const q = String(value || '').trim().toLowerCase();
  return /^(my location|current location|here|where i am|where i'm at|where im at|near me)$/i.test(q);
}

async function resolveMapEndpoint(value) {
  if (isCurrentLocationQuery(value)) {
    const loc = await getCurrentLocation();
    if (!loc?.ok) return null;
    return {
      name: 'My location',
      display_name: loc.label || 'My location',
      lat: loc.lat,
      lon: loc.lon,
      type: 'current-location',
      class: 'location',
      source: loc.source,
      accuracy: loc.accuracy,
    };
  }
  return (await mapSearch(value, { limit: 1 }))?.places?.[0] || null;
}

export async function mapSearch(query, { limit = 6 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'empty query' };
  const capped = Math.max(1, Math.min(10, Number(limit) || 6));
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=${capped}&q=${encodeURIComponent(q)}`;
  const r = await fetchJson(url, { timeoutMs: 12000 });
  if (!r.ok) return r;
  return { ok: true, places: Array.isArray(r.body) ? r.body.map(normalizePlace).filter(Boolean) : [] };
}

export async function mapDirections(from, to) {
  const start = await resolveMapEndpoint(from);
  const end = await resolveMapEndpoint(to);
  if (!start || !end) return { ok: false, error: 'could not geocode route endpoints' };
  const url = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson&steps=false`;
  const r = await fetchJson(url, { timeoutMs: 15000 });
  if (!r.ok) return r;
  const route = r.body?.routes?.[0];
  if (!route) return { ok: false, error: r.body?.message || 'route not found' };
  const mapsUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${start.lat}%2C${start.lon}%3B${end.lat}%2C${end.lon}`;
  return {
    ok: true,
    route: {
      from: start,
      to: end,
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry,
      url: mapsUrl,
    },
  };
}

export async function weatherCurrent({ location = 'my location' } = {}) {
  const place = await resolveMapEndpoint(location);
  if (!place) return { ok: false, error: 'could not resolve weather location' };
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,precipitation` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
    `&forecast_days=3&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;
  const r = await fetchJson(url, { timeoutMs: 12000 });
  if (!r.ok) return r;
  return {
    ok: true,
    location: place,
    current: r.body?.current || null,
    currentUnits: r.body?.current_units || null,
    daily: r.body?.daily || null,
    timezone: r.body?.timezone || null,
  };
}

/* ------------------------------------------------------------------ */
/*  Room control bridge                                                */
/* ------------------------------------------------------------------ */

let roomBridgeProcess = null;
let roomBridgeStarting = null;

function roomBridgeCandidates() {
  const appPath = app.getAppPath();
  return [
    path.resolve(appPath, '..', '..'),
    path.resolve(appPath, '..', '..', '..'),
    process.cwd(),
  ].map((root) => ({
    root,
    script: path.join(root, 'darklock', 'services', 'room-control-bridge.js'),
    token: path.join(root, 'data', 'room-bridge-token.txt'),
    log: path.join(root, 'logs', 'room-bridge.log'),
  }));
}

async function roomToken() {
  if (process.env.ROOM_BRIDGE_TOKEN) return process.env.ROOM_BRIDGE_TOKEN;
  const candidates = [...new Set(roomBridgeCandidates().map((c) => c.token))];
  for (const tokenPath of candidates) {
    try {
      const token = (await fs.readFile(tokenPath, 'utf8')).trim();
      if (token) return token;
    } catch {}
  }
  return '';
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureRoomBridgeStarted() {
  if (process.env.NOVA_ROOM_BRIDGE_AUTOSTART === '0') return false;
  const host = process.env.ROOM_BRIDGE_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return false;
  if (roomBridgeProcess && !roomBridgeProcess.killed) return true;
  if (roomBridgeStarting) return roomBridgeStarting;

  roomBridgeStarting = (async () => {
    const cfg = roomBridgeCandidates().find((c) => fsSync.existsSync(c.script));
    if (!cfg) return false;

    try { fsSync.mkdirSync(path.dirname(cfg.log), { recursive: true }); } catch {}
    const out = fsSync.openSync(cfg.log, 'a');
    const child = spawn(process.execPath, [cfg.script], {
      cwd: cfg.root,
      detached: true,
      stdio: ['ignore', out, out],
      env: process.env,
    });
    child.unref();
    roomBridgeProcess = child;
    await sleep(1200);
    return true;
  })();

  try {
    return await roomBridgeStarting;
  } finally {
    roomBridgeStarting = null;
  }
}

async function roomControlRequestOnce(urlPath, method = 'GET', body = null) {
  const token = await roomToken();
  if (!token) return { ok: false, error: 'room bridge token not found' };
  const data = body ? Buffer.from(JSON.stringify(body)) : null;
  const port = Number(process.env.ROOM_BRIDGE_PORT || 3099);
  return new Promise((resolve) => {
    const req = http.request({
      host: process.env.ROOM_BRIDGE_HOST || '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': data.length } : {}),
      },
      timeout: 5000,
    }, (res) => {
      let chunks = '';
      res.on('data', (chunk) => { chunks += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(chunks || '{}'); } catch { parsed = { raw: chunks }; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: parsed, error: parsed.error });
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: String(e?.message || e) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'room bridge timeout' }); });
    if (data) req.write(data);
    req.end();
  });
}

export async function roomControlRequest(urlPath, method = 'GET', body = null) {
  let result = await roomControlRequestOnce(urlPath, method, body);
  const err = String(result?.error || '').toLowerCase();
  if (result.ok || (!err.includes('econnrefused') && !err.includes('token not found'))) return result;

  const started = await ensureRoomBridgeStarted();
  if (!started) return result;
  return roomControlRequestOnce(urlPath, method, body);
}

function hexToRgb(hex) {
  const clean = String(hex || '#ffffff').replace('#', '');
  const n = parseInt(clean, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export async function roomControlLights({ action, color, brightness, scene } = {}) {
  const a = String(action || '').toLowerCase();
  if (a === 'on') return roomControlRequest('/lights/power', 'POST', { on: true });
  if (a === 'off') return roomControlRequest('/lights/power', 'POST', { on: false });
  if (a === 'color') return roomControlRequest('/lights/color', 'POST', hexToRgb(color));
  if (a === 'brightness') return roomControlRequest('/lights/brightness', 'POST', { value: brightness });
  if (a === 'scene') return roomControlRequest('/lights/scene', 'POST', { scene });
  return { ok: false, error: 'unknown lights action' };
}

export async function roomControlBuzzer({ action, ms = 500, song = 'alert' } = {}) {
  const a = String(action || '').toLowerCase();
  if (a === 'beep') return roomControlRequest('/buzzer/active', 'POST', { ms });
  if (a === 'song') return roomControlRequest('/buzzer/song', 'POST', { name: song });
  if (a === 'stop') return roomControlRequest('/buzzer/song/stop', 'POST');
  return { ok: false, error: 'unknown buzzer action' };
}

/* ------------------------------------------------------------------ */
/*  Spotify                                                             */
/* ------------------------------------------------------------------ */

export async function spotifyControl(action) {
  // Accept either a string ("play") or an object ({action, value})
  let a = '';
  let value;
  if (typeof action === 'string') a = action.toLowerCase();
  else if (action && typeof action === 'object') {
    a = String(action.action || '').toLowerCase();
    value = action.value;
  }
  if (PLATFORM === 'linux') {
    const player = '--player=spotify';
    if (a === 'play')      return run(`playerctl ${player} play`);
    if (a === 'pause')     return run(`playerctl ${player} pause`);
    if (a === 'toggle')    return run(`playerctl ${player} play-pause`);
    if (a === 'next')      return run(`playerctl ${player} next`);
    if (a === 'previous')  return run(`playerctl ${player} previous`);
    if (a === 'volume') {
      const v = clamp(Number(value) || 0, 0, 100) / 100;
      return run(`playerctl ${player} volume ${v.toFixed(2)}`);
    }
    if (a === 'now-playing') {
      const r = await run(`playerctl ${player} metadata --format '{"artist":"{{artist}}","title":"{{title}}","album":"{{album}}","art":"{{mpris:artUrl}}","status":"{{status}}","length_us":"{{mpris:length}}"}'`);
      try {
        const track = JSON.parse(r.stdout || '{}');

        const lengthUs = Number(track.length_us || 0);
        if (Number.isFinite(lengthUs) && lengthUs > 0) {
          track.lengthSec = Math.round(lengthUs / 1000000);
        }
        delete track.length_us;

        const pos = await run(`playerctl ${player} position`);
        const posVal = Number((pos.stdout || '').trim());
        if (Number.isFinite(posVal) && posVal >= 0) {
          track.positionSec = Math.round(posVal);
        }

        const curVol = await run(`playerctl ${player} volume`);
        const curVolVal = Number((curVol.stdout || '').trim());
        if (Number.isFinite(curVolVal) && curVolVal >= 0) {
          track.volumePct = Math.round(clamp(curVolVal, 0, 1) * 100);
        }

        const lyrics = await run(`playerctl ${player} metadata xesam:asText`);
        if (lyrics.ok && lyrics.stdout.trim() && !/No player|not found/i.test(lyrics.stdout)) {
          track.lyrics = lyrics.stdout.trim();
        }
        return { ok: r.ok, track };
      } catch { return r; }
    }
  }
  if (PLATFORM === 'darwin') {
    const ascript = (cmd) => `osascript -e 'tell application "Spotify" to ${cmd}'`;
    if (a === 'play')     return run(ascript('play'));
    if (a === 'pause')    return run(ascript('pause'));
    if (a === 'toggle')   return run(ascript('playpause'));
    if (a === 'next')     return run(ascript('next track'));
    if (a === 'previous') return run(ascript('previous track'));
    if (a === 'now-playing') {
      const r = await run(`osascript -e 'tell application "Spotify" to artist of current track & "|" & name of current track & "|" & album of current track & "|" & player state'`);
      const [artist, title, album, status] = (r.stdout || '').trim().split('|');
      return { ok: r.ok, track: { artist, title, album, status } };
    }
  }
  return { ok: false, error: 'spotify control unavailable on this platform' };
}

/* ------------------------------------------------------------------ */
/*  Notifications                                                       */
/* ------------------------------------------------------------------ */

export function notify({ title, body, urgency = 'normal' }) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: String(title || 'Jarvis'), body: String(body || ''), urgency }).show();
      return { ok: true };
    }
  } catch {}
  return { ok: false, error: 'notifications not supported' };
}

/* ------------------------------------------------------------------ */
/*  Window control                                                      */
/* ------------------------------------------------------------------ */

export function snapWindow(direction) {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return { ok: false, error: 'no focused window' };
  const display = screen.getDisplayMatching(win.getBounds());
  const wa = display.workArea;
  const half = { w: Math.floor(wa.width / 2), h: Math.floor(wa.height / 2) };
  let bounds = null;
  switch (String(direction).toLowerCase()) {
    case 'left':         bounds = { x: wa.x,                y: wa.y,         width: half.w,    height: wa.height }; break;
    case 'right':        bounds = { x: wa.x + half.w,       y: wa.y,         width: half.w,    height: wa.height }; break;
    case 'top':          bounds = { x: wa.x,                y: wa.y,         width: wa.width,  height: half.h };    break;
    case 'bottom':       bounds = { x: wa.x,                y: wa.y + half.h,width: wa.width,  height: half.h };    break;
    case 'maximize':     win.maximize(); return { ok: true };
    case 'minimize':     win.minimize(); return { ok: true };
    case 'restore':      win.unmaximize(); return { ok: true };
    case 'fullscreen':   win.setFullScreen(!win.isFullScreen()); return { ok: true };
    default: return { ok: false, error: `unknown direction: ${direction}` };
  }
  win.setBounds(bounds);
  return { ok: true, bounds };
}

/* ------------------------------------------------------------------ */
/*  Open path / URL                                                     */
/* ------------------------------------------------------------------ */

export async function openPath(target) {
  const t = String(target || '');
  if (/^https?:\/\//i.test(t)) {
    await shell.openExternal(t);
    return { ok: true, kind: 'url' };
  }
  const err = await shell.openPath(t);
  return err ? { ok: false, error: err } : { ok: true, kind: 'path' };
}
