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
  chrome:   { linux: 'google-chrome',     mac: 'Google Chrome',     win: 'chrome.exe' },
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
  const key = String(nameOrPath || '').trim().toLowerCase();
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

export async function closeApp(name) {
  const n = String(name || '').toLowerCase();
  const alias = APP_ALIASES[n];
  if (PLATFORM === 'linux')   return run(`pkill -i -f ${JSON.stringify(alias?.linux || name)}`);
  if (PLATFORM === 'darwin')  return run(`osascript -e 'quit app ${JSON.stringify(alias?.mac || name)}'`);
  if (PLATFORM === 'win32')   return run(`taskkill /im "${alias?.win || name}" /f`);
  return { ok: false, error: 'unsupported platform' };
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
  const screensDir = path.join(app.getPath('pictures'), 'Nova Screenshots');
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
  /\b>\s*\/dev\/sd[a-z]/i,
];

export async function runShell(command, { cwd = null, timeoutMs = 30_000 } = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) return { ok: false, error: 'empty command' };
  for (const rx of SHELL_BLOCKLIST) {
    if (rx.test(cmd)) return { ok: false, error: `command rejected by safety filter: ${rx}` };
  }
  return run(cmd, { cwd: cwd || os.homedir(), timeout: timeoutMs });
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
      res.on('end', () => resolve({ ok: true, status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8'), url }));
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
  const start = (await mapSearch(from, { limit: 1 }))?.places?.[0];
  const end = (await mapSearch(to, { limit: 1 }))?.places?.[0];
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

/* ------------------------------------------------------------------ */
/*  Room control bridge                                                */
/* ------------------------------------------------------------------ */

async function roomToken() {
  if (process.env.ROOM_BRIDGE_TOKEN) return process.env.ROOM_BRIDGE_TOKEN;
  const tokenPath = path.resolve(app.getAppPath(), '..', '..', 'data', 'room-bridge-token.txt');
  try { return (await fs.readFile(tokenPath, 'utf8')).trim(); }
  catch { return ''; }
}

export async function roomControlRequest(urlPath, method = 'GET', body = null) {
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
      const r = await run(`playerctl ${player} metadata --format '{"artist":"{{artist}}","title":"{{title}}","album":"{{album}}","art":"{{mpris:artUrl}}","status":"{{status}}"}'`);
      try {
        const track = JSON.parse(r.stdout || '{}');
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
      new Notification({ title: String(title || 'Nova'), body: String(body || ''), urgency }).show();
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
