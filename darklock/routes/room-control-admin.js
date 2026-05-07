'use strict';

/**
 * Room Control Admin
 * ===================
 * Mounted at /admin/room-control  (protected by requireAdminAuth from admin-auth.js)
 *
 * GET  /admin/room-control              -> admin UI (list + create)
 * POST /admin/room-control/create       -> create new password (JSON response)
 * POST /admin/room-control/revoke       -> revoke a password { id }
 * POST /admin/room-control/rotate-slug  -> rotate the hidden URL slug
 * GET  /admin/room-control/logs         -> recent action log (JSON)
 */

const express = require('express');
const store = require('../utils/room-control-store');

const router = express.Router();

const HOST = process.env.DARKLOCK_PUBLIC_HOST || 'darklock.net';

function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// ─── Admin page HTML ─────────────────────────────────────────────────────────

function adminPage(passwords, slug, flash) {
    const statusBadge = (s) => {
        const map = { active: '#22c55e', claimed: '#3b82f6', revoked: '#6b7280' };
        return `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:.05em;background:${map[s] || '#444'}22;color:${map[s] || '#aaa'};border:1px solid ${map[s] || '#444'}44">${s.toUpperCase()}</span>`;
    };

    const permLabel = { buzzer_active: '🔔 Active Buzzer', buzzer_songs: '🎵 Songs', lights: '💡 Lights' };

    const rows = passwords.map(p => {
        const perms = (p.permissions || '').split(',').filter(Boolean);
        const permBadges = perms.map(k =>
            `<span style="padding:2px 7px;border-radius:10px;font-size:10px;background:#1a2540;color:#60a5fa;border:1px solid #2a3a60">${escHtml(permLabel[k] || k)}</span>`
        ).join(' ');
        const claimedBy = p.claimed_ip
            ? `<span style="color:#9ca3af;font-size:11px">🔒 ${escHtml(p.claimed_ip)}${p.claimed_username ? ' · ' + escHtml(p.claimed_username) : ''}</span>`
            : '<span style="color:#4b5563;font-size:11px">unclaimed</span>';
        const created = new Date(p.created_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
        const revokeBtn = p.status !== 'revoked'
            ? `<button onclick="revoke(${p.id})" style="padding:4px 10px;border-radius:6px;border:1px solid #7f1d1d;background:#3a0f15;color:#fca5a5;font-size:11px;cursor:pointer">Revoke</button>`
            : '';
        return `
        <tr>
          <td style="color:#9ca3af;font-size:12px">#${p.id}</td>
          <td>
            ${p.label ? `<span style="color:#e5e7eb;font-weight:500">${escHtml(p.label)}</span><br>` : ''}
            <span style="font-family:monospace;font-size:11px;color:#6b7280">${escHtml(p.preview)}</span>
          </td>
          <td>${statusBadge(p.status)}</td>
          <td>${permBadges || '<span style="color:#4b5563;font-size:11px">none</span>'}</td>
          <td>${claimedBy}</td>
          <td style="color:#6b7280;font-size:11px">${created}</td>
          <td>${revokeBtn}</td>
        </tr>`;
    }).join('');

    const flashHtml = flash
        ? `<div id="flash" style="position:fixed;bottom:24px;right:24px;padding:14px 20px;border-radius:12px;background:${flash.type === 'err' ? '#3a0f15' : '#0f2a1a'};border:1px solid ${flash.type === 'err' ? '#7f1d1d' : '#166534'};color:${flash.type === 'err' ? '#fca5a5' : '#86efac'};font-size:13px;z-index:100;max-width:420px">${escHtml(flash.msg)}</div>`
        : '';

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Room Control Admin</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#060709;color:#e5e7eb;min-height:100vh;padding:32px 24px}
h1{font-size:22px;font-weight:700;margin:0 0 4px;letter-spacing:-.02em}
.sub{color:#6b7280;font-size:13px;margin:0 0 32px}
.section{background:linear-gradient(160deg,#0d0f16,#0a0b10);border:1px solid #1f2330;border-radius:16px;padding:24px;margin-bottom:24px}
.section-title{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin:0 0 16px;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:#6b7280;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:6px 10px;border-bottom:1px solid #1f2330}
td{padding:10px;border-bottom:1px solid #111318;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.015)}
label{display:block;font-size:12px;color:#9ca3af;margin-bottom:5px;font-weight:500}
input[type=text]{background:#0a0b10;border:1px solid #2a2e3a;border-radius:8px;color:#fff;padding:9px 12px;font-size:13px;width:100%;outline:none}
input[type=text]:focus{border-color:#3b82f6}
.perm-grid{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
.perm-item{display:flex;align-items:center;gap:6px;background:#0d1018;border:1px solid #2a2e3a;border-radius:8px;padding:8px 12px;cursor:pointer;user-select:none;font-size:13px;transition:border-color .15s}
.perm-item:hover{border-color:#3b82f6}
.perm-item input{width:14px;height:14px;accent-color:#3b82f6;cursor:pointer}
.btn-primary{padding:10px 20px;border-radius:10px;border:0;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit;transition:filter .15s}
.btn-primary:hover{filter:brightness(1.1)}
.btn-danger{padding:8px 16px;border-radius:8px;border:1px solid #7f1d1d;background:#1a0808;color:#fca5a5;font-size:12px;cursor:pointer;font-family:inherit;transition:background .15s}
.btn-danger:hover{background:#3a0f15}
.url-box{background:#0a0b10;border:1px solid #2a2e3a;border-radius:10px;padding:14px 16px;font-family:monospace;font-size:12px;word-break:break-all;color:#93c5fd;position:relative}
.copy-btn{position:absolute;top:8px;right:8px;padding:4px 10px;border-radius:6px;border:1px solid #2a2e3a;background:#161821;color:#9ca3af;font-size:11px;cursor:pointer;font-family:inherit}
.copy-btn.copied{border-color:#22c55e;color:#22c55e}
.pw-reveal{background:#050608;border:1px solid #2a2e3a;border-radius:10px;padding:14px 16px;font-family:monospace;font-size:11px;word-break:break-all;color:#d1d5db;position:relative;max-height:120px;overflow-y:auto;line-height:1.6}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:200;opacity:0;pointer-events:none;transition:opacity .2s}
.modal-overlay.open{opacity:1;pointer-events:all}
.modal{background:#0d0f16;border:1px solid #1f2330;border-radius:18px;padding:28px;max-width:560px;width:calc(100% - 40px);transform:translateY(16px);transition:transform .2s}
.modal-overlay.open .modal{transform:translateY(0)}
.modal h2{margin:0 0 4px;font-size:18px}
.modal .sub{margin-bottom:20px}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.warn-banner{background:#1a0e00;border:1px solid #7c3100;color:#fdba74;border-radius:10px;padding:10px 14px;font-size:12px;margin-bottom:12px}
#slug-url{font-family:monospace;font-size:13px;color:#60a5fa;word-break:break-all}
</style>
</head>
<body>
<a href="/admin" style="display:inline-flex;align-items:center;gap:6px;color:#6b7280;font-size:12px;text-decoration:none;margin-bottom:24px">← Admin</a>

<h1>Room Control Admin</h1>
<p class="sub">Manage access passwords and permissions for the hidden room control panel.</p>

<!-- Current URL -->
<div class="section">
  <p class="section-title">Hidden URL</p>
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="flex:1;min-width:0">
      <div class="url-box" id="slug-url-box">
        https://${escHtml(HOST)}/r/<span id="slug-val">${escHtml(slug)}</span>
        <button class="copy-btn" onclick="copyText('https://${escHtml(HOST)}/r/${escHtml(slug)}', this)">Copy</button>
      </div>
    </div>
    <button class="btn-danger" onclick="rotateSlug()">🔄 Rotate URL</button>
  </div>
  <p style="color:#6b7280;font-size:11px;margin:8px 0 0">Rotating the URL <strong>invalidates all existing bookmarks</strong> but keeps passwords valid.</p>
</div>

<!-- Create new password -->
<div class="section">
  <p class="section-title">Create Access Password</p>
  <div style="display:grid;grid-template-columns:1fr 200px;gap:12px;margin-bottom:14px;align-items:end">
    <div>
      <label>Label (optional)</label>
      <input type="text" id="new-label" placeholder="e.g. for Alex, Bedroom TV remote…" maxlength="64">
    </div>
    <div>
      <label>Password Length</label>
      <input type="text" id="new-length" value="250" maxlength="4" style="width:100%">
    </div>
  </div>
  <label style="margin-bottom:8px">Permissions — what this person can control</label>
  <div class="perm-grid">
    <label class="perm-item"><input type="checkbox" name="perm" value="buzzer_active" checked> 🔔 Active Buzzer</label>
    <label class="perm-item"><input type="checkbox" name="perm" value="buzzer_songs" checked> 🎵 Songs</label>
    <label class="perm-item"><input type="checkbox" name="perm" value="lights" checked> 💡 Lights</label>
  </div>
  <br>
  <button class="btn-primary" onclick="createPassword()">✚ Generate Password &amp; URL</button>
</div>

<!-- Password list -->
<div class="section">
  <p class="section-title">Passwords (${passwords.length})</p>
  ${passwords.length === 0 ? '<p style="color:#4b5563;font-size:13px">No passwords yet. Create one above.</p>' : `
  <div style="overflow-x:auto">
  <table>
    <thead><tr>
      <th>ID</th><th>Label / Preview</th><th>Status</th><th>Permissions</th><th>Claimed By</th><th>Created</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>`}
</div>

<!-- Recent logs -->
<div class="section">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <p class="section-title" style="margin:0">Recent Activity</p>
    <button onclick="loadLogs()" style="background:none;border:1px solid #2a2e3a;border-radius:6px;color:#9ca3af;font-size:11px;padding:4px 10px;cursor:pointer">Refresh</button>
  </div>
  <div id="logs-container" style="font-size:12px;color:#6b7280">Loading…</div>
</div>

<!-- Result modal -->
<div class="modal-overlay" id="result-modal">
  <div class="modal">
    <h2>✅ Password Created</h2>
    <p class="sub">Copy the password now — it will <strong>never</strong> be shown again.</p>
    <div class="warn-banner">⚠️ This password is displayed <strong>once only</strong>. Store it securely before closing.</div>
    <label style="margin-bottom:6px">Panel URL</label>
    <div class="url-box" id="result-url" style="margin-bottom:12px">
      <button class="copy-btn" id="copy-url-btn" onclick="copyText(document.getElementById('result-url-text').textContent, this)">Copy</button>
      <span id="result-url-text"></span>
    </div>
    <label style="margin-bottom:6px">Password (copy now)</label>
    <div class="pw-reveal" id="result-pw">
      <button class="copy-btn" id="copy-pw-btn" onclick="copyText(document.getElementById('result-pw-text').textContent, this)">Copy</button>
      <span id="result-pw-text"></span>
    </div>
    <div style="margin-top:14px;font-size:12px;color:#6b7280" id="result-meta"></div>
    <button class="btn-primary" onclick="closeModal()" style="margin-top:20px;width:100%">Done — I have copied it</button>
  </div>
</div>

${flashHtml}

<script>
const HOST = ${JSON.stringify(HOST)};

async function createPassword() {
  const label = document.getElementById('new-label').value.trim();
  const length = parseInt(document.getElementById('new-length').value, 10) || 250;
  const perms = [...document.querySelectorAll('input[name=perm]:checked')].map(c => c.value);
  if (!perms.length) { alert('Select at least one permission.'); return; }

  const res = await fetch('/admin/room-control/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: label || null, length, permissions: perms }),
  });
  const data = await res.json();

  if (!res.ok || !data.ok) { alert('Error: ' + (data.error || res.statusText)); return; }

  const url = data.url;
  document.getElementById('result-url-text').textContent = url;
  document.getElementById('result-pw-text').textContent = data.plain;
  const labels = { buzzer_active: '🔔 Active Buzzer', buzzer_songs: '🎵 Songs', lights: '💡 Lights' };
  const permStr = (data.permissions || '').split(',').map(p => labels[p] || p).join('  ·  ');
  document.getElementById('result-meta').innerHTML =
    '<strong>Label:</strong> ' + (data.label || '—') + '&ensp;|&ensp;' +
    '<strong>ID:</strong> #' + data.id + '&ensp;|&ensp;' +
    '<strong>Permissions:</strong> ' + permStr;
  document.getElementById('result-modal').classList.add('open');
  // Reset copy buttons
  document.getElementById('copy-url-btn').textContent = 'Copy';
  document.getElementById('copy-url-btn').classList.remove('copied');
  document.getElementById('copy-pw-btn').textContent = 'Copy';
  document.getElementById('copy-pw-btn').classList.remove('copied');
  // Reload page in background so new row appears when modal closes
  window.pendingReload = true;
}

function closeModal() {
  document.getElementById('result-modal').classList.remove('open');
  if (window.pendingReload) location.reload();
}
document.getElementById('result-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

async function revoke(id) {
  if (!confirm('Revoke password #' + id + '? All sessions using it will be invalidated.')) return;
  const res = await fetch('/admin/room-control/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (data.ok) location.reload();
  else alert('Error: ' + (data.error || 'unknown'));
}

async function rotateSlug() {
  if (!confirm('Rotate the URL slug? All existing links and bookmarks will stop working.')) return;
  const res = await fetch('/admin/room-control/rotate-slug', { method: 'POST' });
  const data = await res.json();
  if (data.ok) {
    alert('New slug: ' + data.slug + '\\n\\nAll users will need the new link.');
    location.reload();
  } else {
    alert('Error: ' + (data.error || 'unknown'));
  }
}

async function loadLogs() {
  const res = await fetch('/admin/room-control/logs');
  const data = await res.json();
  const box = document.getElementById('logs-container');
  if (!data.ok || !data.logs.length) {
    box.textContent = 'No activity yet.';
    return;
  }
  const actionLabel = a => a.replace(/\./g, ' › ');
  box.innerHTML = data.logs.map(l => {
    const ts = new Date(l.created_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const ok = l.success ? '✅' : '❌';
    const user = l.username || l.ip;
    return \`<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #111318;align-items:baseline">
      <span style="color:#4b5563;flex:0 0 140px">\${ts}</span>
      <span style="flex:0 0 18px">\${ok}</span>
      <span style="color:#9ca3af;flex:0 0 100px">\${escHtml(user)}</span>
      <span style="color:#d1d5db">\${actionLabel(l.action)}</span>
    </div>\`;
  }).join('');
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}

loadLogs();
</script>
</body></html>`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /admin/room-control
router.get('/', async (req, res) => {
    try {
        const [passwords, slug] = await Promise.all([
            store.listActivePasswords(),
            store.getSlug(),
        ]);
        res.send(adminPage(passwords, slug, null));
    } catch (err) {
        console.error('[RoomCtrlAdmin] GET /', err);
        res.status(500).send('Internal error');
    }
});

// POST /admin/room-control/create
router.post('/create', express.json({ limit: '8kb' }), async (req, res) => {
    try {
        const { label, length, permissions } = req.body || {};
        const result = await store.createPassword({
            label: label ? String(label).slice(0, 64) : null,
            length: Math.max(32, Math.min(500, parseInt(length, 10) || 250)),
            permissions,
        });
        const slug = await store.getSlug();
        const url = `https://${HOST}/r/${slug}`;
        res.json({ ok: true, ...result, url });
    } catch (err) {
        console.error('[RoomCtrlAdmin] POST /create', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /admin/room-control/revoke
router.post('/revoke', express.json({ limit: '2kb' }), async (req, res) => {
    try {
        const id = parseInt(req.body?.id, 10);
        if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
        await store.revokePassword(id);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /admin/room-control/rotate-slug
router.post('/rotate-slug', async (req, res) => {
    try {
        const slug = await store.rotateSlug();
        res.json({ ok: true, slug });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /admin/room-control/logs
router.get('/logs', async (req, res) => {
    try {
        const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
        const logs = await store.recentLogs(limit);
        res.json({ ok: true, logs });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
