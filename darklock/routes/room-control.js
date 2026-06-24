/**
 * Room Control - Express routes
 * ==============================
 * Mounted at "/r" by darklock/server.js. Hidden from sitemaps + nav.
 *
 * Flow:
 *   GET  /r/:slug                -> password form (or redirect to /panel if session valid)
 *   POST /r/:slug/auth           -> verify password, bind to IP, set session cookie
 *   GET  /r/:slug/setup          -> username form
 *   POST /r/:slug/setup          -> set username on the session
 *   GET  /r/:slug/panel          -> control panel UI
 *   POST /r/:slug/api/...        -> hardware actions (proxied to localhost bridge)
 *   POST /r/:slug/logout         -> clear session
 */

'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const http = require('http');

const store = require('../utils/room-control-store');

const COOKIE_NAME = 'darklock_room_session';

// Bridge config (localhost-only API on the Pi5)
const BRIDGE_HOST = process.env.ROOM_BRIDGE_HOST || '127.0.0.1';
const BRIDGE_PORT = parseInt(process.env.ROOM_BRIDGE_PORT || '3099', 10);

function bridgeToken() {
    if (process.env.ROOM_BRIDGE_TOKEN) return process.env.ROOM_BRIDGE_TOKEN;
    const tokenFile = path.join(__dirname, '..', '..', 'data', 'room-bridge-token.txt');
    try { return fs.readFileSync(tokenFile, 'utf8').trim(); } catch { return ''; }
}

function getClientIP(req) {
    return (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
        || req.headers['x-real-ip']
        || req.ip
        || req.connection?.remoteAddress
        || 'unknown';
}

function bridgeFetch(method, urlPath, body) {
    return new Promise((resolve, reject) => {
        const data = body ? Buffer.from(JSON.stringify(body)) : null;
        const req = http.request({
            host: BRIDGE_HOST,
            port: BRIDGE_PORT,
            method,
            path: urlPath,
            headers: {
                Authorization: 'Bearer ' + bridgeToken(),
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': data.length } : {}),
            },
            timeout: 5000,
        }, (res) => {
            let chunks = '';
            res.on('data', (c) => { chunks += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(chunks || '{}') }); }
                catch { resolve({ status: res.statusCode, body: { ok: false, raw: chunks } }); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('bridge_timeout')); });
        if (data) req.write(data);
        req.end();
    });
}

// ---- Rate limiters ---------------------------------------------------------
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIP(req),
    handler: (req, res) => res.status(429).send(renderError('Too many attempts. Wait 15 minutes.')),
});

const actionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,                     // 60 actions/min/IP - generous enough for fiddling with sliders
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIP(req),
    handler: (req, res) => res.status(429).json({ ok: false, error: 'rate_limit' }),
});

// ---- Slug guard ------------------------------------------------------------
async function guardSlug(req, res, next) {
    const slug = await store.getSlug();
    if (!slug || req.params.slug !== slug) {
        // Pretend we don't exist
        return res.status(404).type('text/plain').send('Not Found');
    }
    req.roomSlug = slug;
    next();
}

// ---- Session middleware (after slug guard) ---------------------------------
async function loadSession(req, res, next) {
    const sid = req.signedCookies?.[COOKIE_NAME] || req.cookies?.[COOKIE_NAME];
    if (!sid) return next();
    const sess = await store.getSession(sid);
    if (!sess) {
        res.clearCookie(COOKIE_NAME);
        return next();
    }
    if (sess.ip !== getClientIP(req)) {
        // Session is bound to its original IP. Different IP = reject.
        await store.revokeSession(sid);
        res.clearCookie(COOKIE_NAME);
        return next();
    }
    req.roomSession = sess;
    store.touchSession(sid).catch(() => {});
    next();
}

function requireSession(req, res, next) {
    if (!req.roomSession) return res.redirect(`/r/${req.roomSlug}`);
    next();
}

function requireUsername(req, res, next) {
    if (!req.roomSession) return res.redirect(`/r/${req.roomSlug}`);
    if (!req.roomSession.username) return res.redirect(`/r/${req.roomSlug}/setup`);
    next();
}

// ---- HTML helpers ----------------------------------------------------------
function basePage({ title, body, slug }) {
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head><body data-slug="${escapeHtml(slug || '')}">
${body}
</body></html>`;
}

function renderError(msg) {
    return basePage({
        title: 'Access denied',
        body: `<main class="card"><h1>Access denied</h1><p>${escapeHtml(msg)}</p></main>`,
    });
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

const PAGE_CSS = `
*{box-sizing:border-box}
body{margin:0;font-family:'SF Pro Display',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#06070b;color:#e5e7eb;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px}
a{color:inherit}
.card{background:linear-gradient(160deg,#0f1117,#0a0b10);border:1px solid #23262f;border-radius:16px;padding:28px;max-width:520px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5)}
h1{margin:0 0 12px;font-size:22px;font-weight:600;letter-spacing:-.01em}
p.sub{color:#8b91a3;margin:0 0 20px;font-size:14px;line-height:1.5}
label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8b91a3;margin-bottom:6px}
input[type=text],input[type=password],textarea{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #2a2e3a;background:#0a0b10;color:#fff;font-family:inherit;font-size:14px;outline:none;transition:border-color .15s}
input:focus,textarea:focus{border-color:#5b8def}
textarea{resize:vertical;min-height:120px;font-family:ui-monospace,Menlo,monospace;font-size:12px}
button.primary{margin-top:16px;width:100%;padding:12px;border-radius:10px;border:0;background:linear-gradient(135deg,#5b8def,#7c4dff);color:#fff;font-weight:600;cursor:pointer;font-size:14px}
button.primary:hover{filter:brightness(1.1)}
button.primary:disabled{opacity:.5;cursor:not-allowed}
.err{background:#3a0f15;border:1px solid #7a1d27;color:#ffb4be;padding:10px 12px;border-radius:10px;font-size:13px;margin-bottom:14px}
.ok{background:#0f3a1a;border:1px solid #1d7a3a;color:#b4ffc6;padding:10px 12px;border-radius:10px;font-size:13px;margin-bottom:14px}

/* panel */
.panel-shell{max-width:1100px;width:100%}
.panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px}
.panel-head h1{font-size:24px}
.panel-head .meta{font-size:12px;color:#8b91a3}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}
.tile{background:linear-gradient(160deg,#0f1117,#0a0b10);border:1px solid #23262f;border-radius:16px;padding:22px}
.tile h2{margin:0 0 14px;font-size:14px;text-transform:uppercase;letter-spacing:.1em;color:#9aa1b6}
.btn-row{display:flex;flex-wrap:wrap;gap:8px}
.btn{padding:10px 14px;border-radius:10px;border:1px solid #2a2e3a;background:#161821;color:#fff;cursor:pointer;font-size:13px;transition:all .15s;font-family:inherit}
.btn:hover{border-color:#5b8def;background:#1c1f2a}
.btn.danger{background:#3a0f15;border-color:#7a1d27}
.btn.danger:hover{background:#5a1820}
.btn.warn{background:#3a280f;border-color:#7a541d}
.row{display:flex;gap:8px;align-items:center;margin-bottom:10px}
.row label{margin-bottom:0;flex:0 0 auto}
input[type=range]{flex:1;accent-color:#5b8def}
input[type=color]{width:48px;height:38px;border-radius:8px;border:1px solid #2a2e3a;background:transparent}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(40px,1fr));gap:6px;margin-top:8px}
.swatch{aspect-ratio:1;border-radius:8px;border:1px solid rgba(255,255,255,.08);cursor:pointer;transition:transform .1s}
.swatch:hover{transform:scale(1.1)}
.scenes{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}
.scene{padding:14px 8px;border-radius:10px;border:1px solid #2a2e3a;background:#161821;cursor:pointer;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:.06em;transition:all .15s}
.scene:hover{border-color:#5b8def}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#161821;border:1px solid #2a2e3a;border-radius:10px;padding:10px 18px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:1000}
.toast.show{opacity:1}
.toast.err{border-color:#7a1d27;background:#3a0f15}
.devices{font-size:12px;color:#8b91a3;margin-top:8px}
small.muted{color:#5b6275;font-size:11px}
`;

// ---- Pages -----------------------------------------------------------------
function passwordPage(slug, errMsg) {
    const errBlock = errMsg ? `<div class="err">${escapeHtml(errMsg)}</div>` : '';
    return basePage({ title: 'Access', slug, body: `
<main class="card">
  <h1>Restricted access</h1>
  <p class="sub">Enter the access password you were given. The password is locked to your IP after first use.</p>
  ${errBlock}
  <form method="POST" action="/r/${escapeHtml(slug)}/auth" autocomplete="off">
    <label>Access password</label>
    <textarea name="password" required spellcheck="false" autocomplete="off"></textarea>
    <button class="primary" type="submit">Unlock</button>
  </form>
  <small class="muted">All access attempts are logged with your IP address.</small>
</main>
`});
}

function usernamePage(slug, errMsg) {
    const errBlock = errMsg ? `<div class="err">${escapeHtml(errMsg)}</div>` : '';
    return basePage({ title: 'Identify yourself', slug, body: `
<main class="card">
  <h1>One last step</h1>
  <p class="sub">Pick a display name. Every action you take in the panel will be logged under this name.</p>
  ${errBlock}
  <form method="POST" action="/r/${escapeHtml(slug)}/setup" autocomplete="off">
    <label>Username</label>
    <input type="text" name="username" required maxlength="32" pattern="[A-Za-z0-9_\\- ]{2,32}" autocomplete="off">
    <button class="primary" type="submit">Continue</button>
  </form>
</main>
`});
}

function panelPage(slug, session) {
    const songButtons = ['alert','doorbell','jingle','rise','fall','birthday','march','tetris','siren','shave']
        .map(s => `<button class="btn" data-song="${s}">${s}</button>`).join('');
    const swatches = [
        '#ff0000','#ff7700','#ffd000','#00ff00','#00ffd0',
        '#0080ff','#5b8def','#a000ff','#ff00d0','#ffffff',
    ].map(c => `<div class="swatch" style="background:${c}" data-color="${c}"></div>`).join('');
    const scenes = ['chill','focus','movie','sunset','forest','party','sleep','cyber','blood','ocean']
        .map(s => `<button class="scene" data-scene="${s}">${s}</button>`).join('');

    return basePage({ title: 'Room Control', slug, body: `
<div class="panel-shell">
  <div class="panel-head">
    <div>
      <h1>Room control panel</h1>
      <div class="meta">Signed in as <strong id="me">${escapeHtml(session.username)}</strong> · IP ${escapeHtml(session.ip)}</div>
    </div>
    <form method="POST" action="/r/${escapeHtml(slug)}/logout" style="margin:0">
      <button class="btn danger" type="submit">Sign out</button>
    </form>
  </div>

  <div class="grid">

    <section class="tile">
      <h2>Active buzzer (annoying)</h2>
      <p class="sub" style="margin:0 0 12px">Loud digital buzzer. Capped at 3 seconds.</p>
      <div class="row">
        <label>Duration</label>
        <input type="range" id="beepMs" min="100" max="3000" step="100" value="1000">
        <span id="beepMsLabel" style="width:60px;text-align:right">1000ms</span>
      </div>
      <div class="btn-row">
        <button class="btn warn" id="beepGo">Sound it</button>
        <button class="btn" id="beepStop">Stop</button>
      </div>
    </section>

    <section class="tile">
      <h2>Songs (passive buzzers)</h2>
      <div class="btn-row" id="songRow">${songButtons}</div>
      <div style="margin-top:10px"><button class="btn" id="songStop">Stop song</button></div>
    </section>

    <section class="tile" style="grid-column:1 / -1">
      <h2>Govee lights</h2>
      <div class="btn-row" style="margin-bottom:14px">
        <button class="btn" data-light-power="1">All on</button>
        <button class="btn" data-light-power="0">All off</button>
        <button class="btn" id="refreshLights">Rescan</button>
      </div>
      <div class="row">
        <label>Color</label>
        <input type="color" id="colorPicker" value="#5b8def">
        <button class="btn" id="applyColor">Apply</button>
      </div>
      <div class="swatches">${swatches}</div>
      <div class="row" style="margin-top:14px">
        <label>Brightness</label>
        <input type="range" id="brightness" min="1" max="100" value="80">
        <span id="brightnessLabel" style="width:40px;text-align:right">80</span>
      </div>
      <h2 style="margin-top:18px">Moods</h2>
      <div class="scenes">${scenes}</div>
      <div class="devices" id="devices">Loading devices…</div>
    </section>

  </div>
</div>
<div class="toast" id="toast"></div>
<script>${PANEL_JS.replace('__SLUG__', slug)}</script>
`});
}

const PANEL_JS = `
(function(){
  const SLUG = "__SLUG__";
  const base = "/r/" + SLUG;
  const toast = document.getElementById('toast');
  function showToast(msg, isErr){
    toast.textContent = msg;
    toast.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.className = 'toast'; }, 2200);
  }
  async function api(p, body){
    try {
      const r = await fetch(base + p, {
        method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body || {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) {
        showToast((j && j.error) || ('error ' + r.status), true);
        return null;
      }
      return j;
    } catch(e) { showToast('network error', true); return null; }
  }

  const beepMs = document.getElementById('beepMs');
  const beepMsLabel = document.getElementById('beepMsLabel');
  beepMs.addEventListener('input', () => beepMsLabel.textContent = beepMs.value + 'ms');
  document.getElementById('beepGo').onclick = async () => {
    const j = await api('/api/buzzer/active', { ms: parseInt(beepMs.value,10) });
    if (j) showToast('Buzzed for ' + j.ms + 'ms');
  };
  document.getElementById('beepStop').onclick = () => api('/api/buzzer/active/stop').then(j => j && showToast('Stopped'));

  document.getElementById('songRow').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-song]'); if (!b) return;
    const j = await api('/api/buzzer/song', { name: b.dataset.song });
    if (j) showToast('Playing: ' + j.song);
  });
  document.getElementById('songStop').onclick = () => api('/api/buzzer/song/stop').then(j => j && showToast('Stopped'));

  // Lights
  function hexToRgb(h){ h = h.replace('#',''); return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) }; }
  const cp = document.getElementById('colorPicker');
  document.getElementById('applyColor').onclick = async () => {
    const c = hexToRgb(cp.value);
    const j = await api('/api/lights/color', c);
    if (j) showToast('Color set');
  };
  document.querySelectorAll('.swatch').forEach(s => {
    s.addEventListener('click', async () => {
      cp.value = s.dataset.color;
      const c = hexToRgb(s.dataset.color);
      const j = await api('/api/lights/color', c);
      if (j) showToast('Color set');
    });
  });
  document.querySelectorAll('[data-light-power]').forEach(b => {
    b.addEventListener('click', async () => {
      const j = await api('/api/lights/power', { on: b.dataset.lightPower === '1' });
      if (j) showToast(b.dataset.lightPower === '1' ? 'Lights on' : 'Lights off');
    });
  });
  const br = document.getElementById('brightness');
  const brLabel = document.getElementById('brightnessLabel');
  let brTimer;
  br.addEventListener('input', () => {
    brLabel.textContent = br.value;
    clearTimeout(brTimer);
    brTimer = setTimeout(() => api('/api/lights/brightness', { value: parseInt(br.value,10) }), 200);
  });
  document.querySelectorAll('.scene').forEach(s => {
    s.addEventListener('click', async () => {
      const j = await api('/api/lights/scene', { scene: s.dataset.scene });
      if (j) showToast('Mood: ' + s.dataset.scene);
    });
  });

  async function refreshDevices(){
    try{
      const r = await fetch(base + '/api/lights', { credentials:'same-origin' });
      const j = await r.json();
      const el = document.getElementById('devices');
      if (!j.devices || !j.devices.length) {
        el.textContent = 'No Govee devices discovered. Make sure LAN Control is enabled in the Govee Home app.';
      } else {
        el.innerHTML = j.devices.map(d =>
          '<div>· ' + d.model + ' @ ' + d.ip + (d.on ? ' (on)' : ' (off)') + '</div>'
        ).join('');
      }
    } catch(e){}
  }
  document.getElementById('refreshLights').onclick = async () => {
    showToast('Rescanning…');
    await api('/api/lights/refresh');
    setTimeout(refreshDevices, 500);
  };
  refreshDevices();
  setInterval(refreshDevices, 30000);
})();
`;

// ---- Router ----------------------------------------------------------------
function buildRouter() {
    const router = express.Router({ mergeParams: true });

    // Robots: deny indexing aggressively at this prefix
    router.use((req, res, next) => {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Referrer-Policy', 'no-referrer');
        next();
    });

    router.use('/:slug', guardSlug, loadSession);

    // Password page
    router.get('/:slug', (req, res) => {
        if (req.roomSession) {
            if (!req.roomSession.username) return res.redirect(`/r/${req.roomSlug}/setup`);
            return res.redirect(`/r/${req.roomSlug}/panel`);
        }
        res.send(passwordPage(req.roomSlug));
    });

    // Auth
    router.post('/:slug/auth',
        express.urlencoded({ extended: false, limit: '8kb' }),
        authLimiter,
        async (req, res) => {
            const ip = getClientIP(req);
            const ua = req.headers['user-agent'] || '';
            const password = (req.body && req.body.password ? String(req.body.password) : '').trim();
            const pw = await store.consumePassword(password, ip);
            if (!pw) {
                await store.logAction({
                    ip, username: null, action: 'auth.fail',
                    params: { length: password.length }, success: false, userAgent: ua,
                });
                return res.status(401).send(passwordPage(req.roomSlug, 'Invalid password, or that password is locked to a different IP.'));
            }
            const sess = await store.createSession({ passwordId: pw.id, ip, userAgent: ua });
            res.cookie(COOKIE_NAME, sess.id, {
                httpOnly: true,
                sameSite: 'strict',
                secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
                maxAge: sess.expires.getTime() - Date.now(),
                path: '/r',
            });
            await store.logAction({
                sessionId: sess.id, ip, username: null, action: 'auth.success',
                params: { passwordId: pw.id }, success: true, userAgent: ua,
            });
            res.redirect(`/r/${req.roomSlug}/setup`);
        }
    );

    // Username
    router.get('/:slug/setup', requireSession, (req, res) => {
        if (req.roomSession.username) return res.redirect(`/r/${req.roomSlug}/panel`);
        res.send(usernamePage(req.roomSlug));
    });
    router.post('/:slug/setup',
        express.urlencoded({ extended: false, limit: '4kb' }),
        requireSession,
        async (req, res) => {
            const raw = (req.body && req.body.username ? String(req.body.username) : '').trim();
            if (!/^[A-Za-z0-9_\- ]{2,32}$/.test(raw)) {
                return res.status(400).send(usernamePage(req.roomSlug, 'Username must be 2-32 chars (letters, digits, space, _, -).'));
            }
            await store.setSessionUsername(req.roomSession.id, raw);
            await store.logAction({
                sessionId: req.roomSession.id, ip: req.roomSession.ip, username: raw,
                action: 'session.setUsername', success: true, userAgent: req.headers['user-agent'],
            });
            res.redirect(`/r/${req.roomSlug}/panel`);
        }
    );

    // Panel
    router.get('/:slug/panel', requireUsername, (req, res) => {
        res.send(panelPage(req.roomSlug, req.roomSession));
    });

    // Logout
    router.post('/:slug/logout', requireSession, async (req, res) => {
        await store.revokeSession(req.roomSession.id);
        await store.logAction({
            sessionId: req.roomSession.id, ip: req.roomSession.ip, username: req.roomSession.username,
            action: 'auth.logout', success: true, userAgent: req.headers['user-agent'],
        });
        res.clearCookie(COOKIE_NAME, { path: '/r' });
        res.redirect(`/r/${req.roomSlug}`);
    });

    // ---- API actions (require authenticated + named session) -------------
    const api = express.Router({ mergeParams: true });
    api.use(requireUsername);
    api.use(actionLimiter);
    api.use(express.json({ limit: '4kb' }));

    function actionHandler(action, bridgeMethod, bridgePath, mapBody) {
        const ACTION_TO_PERM = {
            'buzzer.active':      'buzzer_active',
            'buzzer.active.stop': 'buzzer_active',
            'buzzer.song':        'buzzer_songs',
            'buzzer.song.stop':   'buzzer_songs',
            'lights.power':       'lights',
            'lights.color':       'lights',
            'lights.brightness':  'lights',
            'lights.scene':       'lights',
            'lights.refresh':     'lights',
        };
        return async (req, res) => {
            const sess = req.roomSession;
            // Permission check
            const requiredPerm = ACTION_TO_PERM[action];
            if (requiredPerm) {
                const pwRow = await store.getPasswordById(sess.password_id);
                const perms = (pwRow && pwRow.permissions) ? pwRow.permissions.split(',') : [];
                if (!perms.includes(requiredPerm)) {
                    return res.status(403).json({ ok: false, error: 'permission_denied' });
                }
            }
            const body = mapBody ? mapBody(req.body || {}) : (req.body || {});
            let bridgeRes, errMsg;
            try {
                bridgeRes = await bridgeFetch(bridgeMethod, bridgePath, body);
            } catch (e) {
                errMsg = e.message;
            }
            const success = !!(bridgeRes && bridgeRes.status >= 200 && bridgeRes.status < 300 && bridgeRes.body && bridgeRes.body.ok !== false);
            await store.logAction({
                sessionId: sess.id, ip: sess.ip, username: sess.username,
                action, params: body, result: bridgeRes ? bridgeRes.body : { error: errMsg },
                success, userAgent: req.headers['user-agent'],
            });
            if (errMsg) return res.status(502).json({ ok: false, error: 'bridge_unreachable' });
            res.status(bridgeRes.status).json(bridgeRes.body);
        };
    }

    api.post('/buzzer/active',       actionHandler('buzzer.active',       'POST', '/buzzer/active',       (b) => ({ ms: parseInt(b.ms, 10) || 500 })));
    api.post('/buzzer/active/stop',  actionHandler('buzzer.active.stop',  'POST', '/buzzer/active/stop'));
    api.post('/buzzer/song',         actionHandler('buzzer.song',         'POST', '/buzzer/song',         (b) => ({ name: String(b.name || '').toLowerCase() })));
    api.post('/buzzer/song/stop',    actionHandler('buzzer.song.stop',    'POST', '/buzzer/song/stop'));
    api.post('/lights/power',        actionHandler('lights.power',        'POST', '/lights/power',        (b) => ({ on: !!b.on, device: b.device || null })));
    api.post('/lights/color',        actionHandler('lights.color',        'POST', '/lights/color',        (b) => ({ r: +b.r, g: +b.g, b: +b.b, device: b.device || null })));
    api.post('/lights/brightness',   actionHandler('lights.brightness',   'POST', '/lights/brightness',   (b) => ({ value: parseInt(b.value, 10), device: b.device || null })));
    api.post('/lights/scene',        actionHandler('lights.scene',        'POST', '/lights/scene',        (b) => ({ scene: String(b.scene || ''), device: b.device || null })));
    api.post('/lights/refresh',      actionHandler('lights.refresh',      'POST', '/lights/refresh'));

    // GETs (read-only, also logged but not rate-counted as harshly)
    api.get('/lights', async (req, res) => {
        try {
            const r = await bridgeFetch('GET', '/lights');
            res.status(r.status).json(r.body);
        } catch { res.status(502).json({ ok: false, error: 'bridge_unreachable' }); }
    });

    router.use('/:slug/api', api);

    return router;
}

module.exports = { buildRouter, COOKIE_NAME };
