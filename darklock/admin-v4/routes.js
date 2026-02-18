/**
 * Darklock Admin v4 — API Routes
 * Clean, modular Express router. All business logic in queries.js.
 *
 * Mounted at: /api/v4/admin
 *
 * Tab mapping:
 *   GET  /overview                → Overview tab
 *   *    /announcements           → Announcements tab
 *   *    /accounts                → Accounts tab
 *   *    /roles                   → Roles & Access tab
 *   *    /app-updates             → App Updates tab
 *   *    /bug-reports             → Bug Reports tab
 *   GET  /audit-logs              → System Logs tab
 *   *    /security                → Security Settings tab
 *   *    /settings                → Platform Settings tab
 *   GET  /app/latest-update       → Public polling endpoint (no auth)
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcrypt');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const router  = express.Router();

const Q  = require('./db/queries');
const MW = require('./middleware');
const db = require('../utils/database');

// ── File upload config for update packages ──────────────────────────────────────
const UPDATES_DIR = path.join(__dirname, '../downloads/updates');
if (!fs.existsSync(UPDATES_DIR)) fs.mkdirSync(UPDATES_DIR, { recursive: true });

const updateStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const version = req.body.version || 'unknown';
    const versionDir = path.join(UPDATES_DIR, version);
    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });
    cb(null, versionDir);
  },
  filename: (req, file, cb) => {
    // Keep original filename but sanitize
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  },
});
const uploadUpdate = multer({
  storage: updateStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.exe', '.msi', '.deb', '.AppImage', '.dmg', '.tar.gz', '.zip', '.sig'];
    const ext = path.extname(file.originalname).toLowerCase();
    // Also allow .tar.gz which has .gz ext
    if (allowed.some(a => file.originalname.toLowerCase().endsWith(a))) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed. Allowed: ${allowed.join(', ')}`));
  },
});

// ── Apply auth + rate limit to all routes ───────────────────────────────────────
router.use(MW.apiLimiter);

// ── Public endpoint (no auth) — app update polling ──────────────────────────────
router.get('/app/latest-update', async (req, res) => {
  try {
    const channel = req.query.channel === 'beta' ? 'beta' : 'stable';
    const update = await Q.getLatestAppUpdate(channel);
    if (!update) return res.json({ available: false });
    res.json({
      available:    true,
      version:      update.version,
      title:        update.title,
      changelog:    update.changelog,
      force:        !!update.force_update,
      downloadUrl:  update.download_url,
      minVersion:   update.min_version,
      channel:      update.channel || 'stable',
      publishedAt:  update.published_at,
    });
  } catch (err) {
    console.error('[Admin v4] Latest update error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// NOTE: Bug report submission has been moved to server.js as a public endpoint
// to avoid auth middleware interference. See darklock/server.js line ~1104

// ── Public endpoint (no auth) — theme CSS for bot dashboard & website ───────
router.get('/theme/css', async (req, res) => {
  try {
    const themeManager = require('../utils/theme-manager');
    const activeTheme = await themeManager.getActiveTheme();
    const colors = activeTheme.theme.colors;

    const css = `:root {\n${Object.entries(colors).map(([key, value]) => `    ${key}: ${value};`).join('\n')}\n}\n\n/* Theme applies to bot dashboard and site only, not admin panel */`;

    res.setHeader('Content-Type', 'text/css');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(css);
  } catch (err) {
    console.error('[Admin v4] Theme CSS error:', err);
    res.status(500).send('/* Error loading theme */');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ALL ROUTES BELOW REQUIRE ADMIN AUTH
// ═══════════════════════════════════════════════════════════════════════════════
router.use(MW.requireAuth);

// ── Shell data (sidebar, admin info, permissions) ───────────────────────────────
router.get('/shell', async (req, res) => {
  try {
    const { ROLE_HIERARCHY } = require('./db/schema');
    const level = req.admin.level;

    const tabs = [
      { id: 'overview',       label: 'Overview',              icon: 'layout-dashboard', minLevel: 0 },
      { id: 'announcements',  label: 'Announcements',         icon: 'megaphone',        minLevel: 50 },
      { id: 'accounts',       label: 'Accounts',              icon: 'users',            minLevel: 50 },
      { id: 'roles',          label: 'Role & Access',         icon: 'shield-check',     minLevel: 90 },
      { id: 'app-updates',    label: 'App Updates',           icon: 'download-cloud',   minLevel: 50 },
      { id: 'bug-reports',    label: 'Bug Reports',           icon: 'bug',              minLevel: 30 },
      { id: 'system-logs',    label: 'System Logs',           icon: 'file-text',        minLevel: 30 },
      { id: 'security',       label: 'Security Settings',     icon: 'lock',             minLevel: 70 },
      { id: 'themes',          label: 'Themes',                icon: 'palette',          minLevel: 50 },
      { id: 'maintenance',     label: 'Maintenance',           icon: 'tool',             minLevel: 70 },
      { id: 'settings',       label: 'Platform Settings',     icon: 'settings',         minLevel: 50 },
    ].filter(t => level >= t.minLevel);

    res.json({
      success: true,
      admin: { id: req.admin.id, email: req.admin.email, name: req.admin.name, role: req.admin.role, level },
      tabs,
    });
  } catch (err) {
    console.error('[Admin v4] Shell error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  1) OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/overview', MW.helperOrAbove, async (req, res) => {
  try {
    const stats = await Q.getOverviewStats();
    const sessions = await Q.getActiveSessions();
    
    // Get actual maintenance state from maintenance_state table
    const maintenanceState = await db.get(`SELECT * FROM maintenance_state WHERE scope = ?`, ['darklock_site']);
    
    res.json({
      success: true,
      ...stats,
      activeSessions: sessions?.count || 0,
      maintenanceMode: maintenanceState?.enabled === 1,
    });
  } catch (err) {
    console.error('[Admin v4] Overview error:', err);
    res.status(500).json({ success: false, error: 'Failed to load overview' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  2) ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/announcements', MW.modOrAbove, MW.auditLog('announcements'), async (req, res) => {
  try {
    const data = await Q.getAnnouncements({ limit: Number(req.query.limit) || 50, offset: Number(req.query.offset) || 0 });
    res.json({ success: true, announcements: data });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load announcements' });
  }
});

router.post('/announcements', MW.modOrAbove, MW.auditLog('announcements'), async (req, res) => {
  try {
    const { title, content, version, visibility, pinned } = req.body;
    if (!title || !content) return res.status(400).json({ success: false, error: 'Title and content are required' });

    const autoVersion = version || await Q.getNextAnnouncementVersion();

    // Check duplicate version
    const existing = await Q.getAnnouncements();
    if (existing.some(a => a.version === autoVersion)) {
      return res.status(400).json({ success: false, error: 'Version already exists' });
    }

    const id = crypto.randomBytes(16).toString('hex');
    const announcement = await Q.createAnnouncement({
      id, title, content,
      version: autoVersion,
      visibility: visibility || 'public',
      pinned: !!pinned,
      author_id: req.admin.id,
      author_email: req.admin.email,
    });

    // Also push to the updates table so it appears on /platform/update
    try {
      const db = require('../utils/database');
      await db.run(`
        INSERT OR IGNORE INTO updates (id, title, version, type, content, created_by)
        VALUES (?, ?, ?, 'minor', ?, ?)
      `, [id, title, autoVersion, content, req.admin.id]);
    } catch (e) { /* non-critical */ }

    res.json({ success: true, announcement });
  } catch (err) {
    console.error('[Admin v4] Create announcement error:', err);
    res.status(500).json({ success: false, error: 'Failed to create announcement' });
  }
});

router.put('/announcements/:id', MW.modOrAbove, MW.auditLog('announcements'), async (req, res) => {
  try {
    const existing = await Q.getAnnouncementById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });

    const updated = await Q.updateAnnouncement(req.params.id, req.body);
    res.json({ success: true, announcement: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update announcement' });
  }
});

router.delete('/announcements/:id', MW.adminOrAbove, MW.auditLog('announcements'), async (req, res) => {
  try {
    await Q.deleteAnnouncement(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete announcement' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  3) ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/accounts', MW.modOrAbove, MW.auditLog('accounts'), async (req, res) => {
  try {
    const { search, filter, limit, offset } = req.query;
    const data = await Q.getAccounts({ search, filter, limit: Number(limit) || 50, offset: Number(offset) || 0 });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load accounts' });
  }
});

router.get('/accounts/:id', MW.modOrAbove, async (req, res) => {
  try {
    const account = await Q.getAccountById(req.params.id);
    if (!account) return res.status(404).json({ success: false, error: 'Account not found' });
    const sessions = await Q.getAccountSessions(req.params.id);
    const devices  = await Q.getAccountDevices(req.params.id);
    res.json({ success: true, account, sessions, devices });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load account details' });
  }
});

router.post('/accounts/:id/grant-premium', MW.adminOrAbove, MW.sensitiveActionLimiter, MW.auditLog('accounts'), async (req, res) => {
  try {
    await Q.updateAccountRole(req.params.id, 'premium');
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'grant_premium', category: 'accounts', target_type: 'user', target_id: req.params.id, ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: 'Premium granted' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to grant premium' });
  }
});

router.post('/accounts/:id/remove-premium', MW.adminOrAbove, MW.sensitiveActionLimiter, MW.auditLog('accounts'), async (req, res) => {
  try {
    await Q.updateAccountRole(req.params.id, 'user');
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'remove_premium', category: 'accounts', target_type: 'user', target_id: req.params.id, ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: 'Premium removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to remove premium' });
  }
});

router.post('/accounts/:id/ban', MW.adminOrAbove, MW.sensitiveActionLimiter, MW.requireConfirmation, MW.auditLog('accounts'), async (req, res) => {
  try {
    await Q.banAccount(req.params.id);
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'ban_account', category: 'accounts', target_type: 'user', target_id: req.params.id, ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: 'Account banned' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to ban account' });
  }
});

router.post('/accounts/:id/unban', MW.adminOrAbove, MW.sensitiveActionLimiter, MW.auditLog('accounts'), async (req, res) => {
  try {
    await Q.unbanAccount(req.params.id);
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'unban_account', category: 'accounts', target_type: 'user', target_id: req.params.id, ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: 'Account unbanned' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to unban account' });
  }
});

router.post('/accounts/:id/reset-password', MW.ownerOrCoowner, MW.sensitiveActionLimiter, MW.requireConfirmation, MW.auditLog('accounts'), async (req, res) => {
  try {
    const tempPassword = crypto.randomBytes(12).toString('base64url');
    const hash = await bcrypt.hash(tempPassword, 12);
    await Q.resetAccountPassword(req.params.id, hash);
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'reset_password', category: 'accounts', target_type: 'user', target_id: req.params.id, ip_address: MW.getClientIP(req) });
    res.json({ success: true, temporaryPassword: tempPassword, message: 'Password reset. Share this temporary password securely.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

router.delete('/accounts/:id', MW.ownerOrCoowner, MW.sensitiveActionLimiter, MW.requireConfirmation, MW.auditLog('accounts'), async (req, res) => {
  try {
    await Q.deleteAccount(req.params.id);
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'delete_account', category: 'accounts', target_type: 'user', target_id: req.params.id, ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete account' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  4) ROLES & ACCESS MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/roles/admins', MW.ownerOrCoowner, async (req, res) => {
  try {
    const admins = await Q.getAdminUsers();
    res.json({ success: true, admins });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load admins' });
  }
});

router.get('/roles/definitions', MW.ownerOrCoowner, async (req, res) => {
  try {
    const roles = await Q.getRoles();
    const permsMap = {};
    for (const role of roles) {
      permsMap[role.id] = await Q.getRolePermissions(role.id);
    }
    res.json({ success: true, roles, permissions: permsMap });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load roles' });
  }
});

router.post('/roles/admins', MW.ownerOrCoowner, MW.sensitiveActionLimiter, MW.auditLog('roles'), async (req, res) => {
  try {
    const { email, password, role, display_name } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });
    if (password.length < 12) return res.status(400).json({ success: false, error: 'Password must be at least 12 characters' });

    const validRoles = ['helper', 'mod', 'admin', 'coowner'];
    if (req.admin.role !== 'owner' && role === 'coowner') {
      return res.status(403).json({ success: false, error: 'Only owner can create co-owner accounts' });
    }
    if (!validRoles.includes(role)) return res.status(400).json({ success: false, error: 'Invalid role' });

    const hash = await bcrypt.hash(password, 12);
    const id = crypto.randomBytes(16).toString('hex');

    const db = require('../utils/database');
    await db.run(`
      INSERT INTO admins (id, email, password_hash, role, display_name, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `, [id, email, hash, role, display_name || email.split('@')[0]]);

    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'create_admin', category: 'roles', target_type: 'admin', target_id: id, new_value: { email, role }, ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: 'Admin account created', adminId: id });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(400).json({ success: false, error: 'Email already exists' });
    console.error('[Admin v4] Create admin error:', err);
    res.status(500).json({ success: false, error: 'Failed to create admin' });
  }
});

router.put('/roles/admins/:id', MW.ownerOrCoowner, MW.sensitiveActionLimiter, MW.auditLog('roles'), async (req, res) => {
  try {
    const { role } = req.body;
    const target = await Q.getAdminById(req.params.id);
    if (!target) return res.status(404).json({ success: false, error: 'Admin not found' });

    // Protect owner from demotion by non-owner
    if (target.role === 'owner' && req.admin.role !== 'owner') {
      return res.status(403).json({ success: false, error: 'Cannot modify owner account' });
    }

    const validRoles = ['helper', 'mod', 'admin', 'coowner', 'owner'];
    if (!validRoles.includes(role)) return res.status(400).json({ success: false, error: 'Invalid role' });
    if (role === 'owner' && req.admin.role !== 'owner') return res.status(403).json({ success: false, error: 'Only owner can assign owner role' });

    await Q.updateAdminRole(req.params.id, role);
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'change_role', category: 'roles', target_type: 'admin', target_id: req.params.id, old_value: { role: target.role }, new_value: { role }, ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: `Role updated to ${role}` });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update role' });
  }
});

router.delete('/roles/admins/:id', MW.ownerOnly, MW.sensitiveActionLimiter, MW.requireConfirmation, MW.auditLog('roles'), async (req, res) => {
  try {
    const target = await Q.getAdminById(req.params.id);
    if (!target) return res.status(404).json({ success: false, error: 'Admin not found' });
    if (target.role === 'owner') return res.status(403).json({ success: false, error: 'Cannot delete owner account' });
    if (target.id === req.admin.id) return res.status(400).json({ success: false, error: 'Cannot delete your own account' });

    await Q.deleteAdmin(req.params.id);
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'delete_admin', category: 'roles', target_type: 'admin', target_id: req.params.id, old_value: { email: target.email, role: target.role }, ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: 'Admin deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete admin' });
  }
});

router.put('/roles/permissions/:roleId', MW.ownerOnly, MW.sensitiveActionLimiter, MW.auditLog('roles'), async (req, res) => {
  try {
    const { permissions } = req.body;
    if (!permissions || typeof permissions !== 'object') return res.status(400).json({ success: false, error: 'permissions object required' });

    for (const [perm, granted] of Object.entries(permissions)) {
      await Q.setRolePermission(req.params.roleId, perm, granted);
    }
    res.json({ success: true, message: 'Permissions updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update permissions' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  5) APP UPDATES
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/app-updates', MW.modOrAbove, async (req, res) => {
  try {
    const data = await Q.getAppUpdates({ limit: Number(req.query.limit) || 50, offset: Number(req.query.offset) || 0 });
    // Enrich with file info
    const enriched = data.map(u => {
      const versionDir = path.join(UPDATES_DIR, u.version);
      let files = [];
      if (fs.existsSync(versionDir)) {
        files = fs.readdirSync(versionDir).map(f => {
          const stat = fs.statSync(path.join(versionDir, f));
          return { name: f, size: stat.size, uploaded: stat.mtime.toISOString() };
        });
      }
      return { ...u, files };
    });
    res.json({ success: true, updates: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load updates' });
  }
});

// Upload files for an update version
router.post('/app-updates/upload', MW.adminOrAbove, (req, res, next) => {
  uploadUpdate.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    const version = req.body.version;
    if (!version) return res.status(400).json({ success: false, error: 'Version is required' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, error: 'No files uploaded' });

    const uploaded = req.files.map(f => ({
      name: f.filename,
      size: f.size,
      path: f.path,
    }));

    // Auto-generate download_url for the update record if it exists
    const existing = await db.get(`SELECT id FROM app_updates WHERE version = ?`, [version]);
    if (existing) {
      // Set download_url to our hosted files endpoint
      const baseUrl = req.protocol + '://' + req.get('host');
      await db.run(`UPDATE app_updates SET download_url = ? WHERE version = ?`,
        [`${baseUrl}/platform/api/updates/download/${version}`, version]);
    }

    await Q.logAudit({
      admin_id: req.admin.id, admin_email: req.admin.email,
      action: 'upload_update_files', category: 'app_updates',
      target_type: 'update_files', target_id: version,
      new_value: { files: uploaded.map(f => f.name) },
      ip_address: MW.getClientIP(req),
    });

    res.json({ success: true, files: uploaded });
  } catch (err) {
    console.error('[Admin v4] Upload error:', err);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// List files for a specific version
router.get('/app-updates/files/:version', MW.modOrAbove, async (req, res) => {
  try {
    const versionDir = path.join(UPDATES_DIR, req.params.version);
    if (!fs.existsSync(versionDir)) return res.json({ success: true, files: [] });
    const files = fs.readdirSync(versionDir).map(f => {
      const stat = fs.statSync(path.join(versionDir, f));
      return { name: f, size: stat.size, uploaded: stat.mtime.toISOString() };
    });
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to list files' });
  }
});

// Delete a specific update file
router.delete('/app-updates/files/:version/:filename', MW.adminOrAbove, async (req, res) => {
  try {
    const filePath = path.join(UPDATES_DIR, req.params.version, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File not found' });
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete file' });
  }
});

router.post('/app-updates', MW.adminOrAbove, MW.auditLog('app_updates'), async (req, res) => {
  try {
    const { version, title, changelog, download_url, force_update, min_version, channel, platforms } = req.body;
    if (!version || !title) return res.status(400).json({ success: false, error: 'Version and title are required' });

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      return res.status(400).json({ success: false, error: 'Version must be semantic (e.g., 2.1.0)' });
    }

    // Auto-detect download URL from uploaded files if not provided
    let finalDownloadUrl = download_url;
    if (!finalDownloadUrl) {
      const versionDir = path.join(UPDATES_DIR, version);
      if (fs.existsSync(versionDir) && fs.readdirSync(versionDir).length > 0) {
        const baseUrl = req.protocol + '://' + req.get('host');
        finalDownloadUrl = `${baseUrl}/platform/api/updates/download/${version}`;
      }
    }

    const id = crypto.randomBytes(16).toString('hex');
    const update = await Q.createAppUpdate({
      id, version, title, changelog,
      download_url: finalDownloadUrl, force_update: !!force_update, min_version,
      channel: channel === 'beta' ? 'beta' : 'stable',
      published_by: req.admin.email,
    });

    // Store platform-specific info if provided
    if (platforms) {
      try {
        await db.run(`UPDATE app_updates SET changelog = json_set(COALESCE(changelog,'{}'), '$.platforms', ?) WHERE id = ?`,
          [JSON.stringify(platforms), id]);
      } catch (e) { /* non-critical */ }
    }

    // Update current_app_version in config
    await Q.setConfig('current_app_version', version, req.admin.email);

    // Also push to updates table for /platform/update page
    try {
      const db = require('../utils/database');
      await db.run(`
        INSERT OR IGNORE INTO updates (id, title, version, type, content, created_by)
        VALUES (?, ?, ?, 'major', ?, ?)
      `, [id, title, version, changelog || '', req.admin.id]);
    } catch (e) { /* non-critical */ }

    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'push_app_update', category: 'app_updates', target_type: 'update', target_id: id, new_value: { version, title }, ip_address: MW.getClientIP(req) });
    res.json({ success: true, update });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(400).json({ success: false, error: 'Version already exists' });
    console.error('[Admin v4] Create update error:', err);
    res.status(500).json({ success: false, error: 'Failed to create update' });
  }
});

router.delete('/app-updates/:id', MW.ownerOrCoowner, MW.sensitiveActionLimiter, MW.requireConfirmation, MW.auditLog('app_updates'), async (req, res) => {
  try {
    // Get version to clean up files
    const update = await Q.getAppUpdateById(req.params.id);
    if (update) {
      const versionDir = path.join(UPDATES_DIR, update.version);
      if (fs.existsSync(versionDir)) {
        fs.rmSync(versionDir, { recursive: true, force: true });
      }
    }
    await Q.deleteAppUpdate(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete update' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  6) BUG REPORTS
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/bug-reports', MW.helperOrAbove, async (req, res) => {
  try {
    const { source, status, severity, limit, offset } = req.query;
    const data = await Q.getBugReports({ source, status, severity, limit: Number(limit) || 50, offset: Number(offset) || 0 });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load bug reports' });
  }
});

router.get('/bug-reports/:id', MW.helperOrAbove, async (req, res) => {
  try {
    const report = await Q.getBugReportById(req.params.id);
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load report' });
  }
});

router.put('/bug-reports/:id', MW.modOrAbove, MW.auditLog('bug_reports'), async (req, res) => {
  try {
    const { status, internal_notes, assigned_to, severity } = req.body;
    const updated = await Q.updateBugReport(req.params.id, { status, internal_notes, assigned_to, severity });
    if (!updated) return res.status(404).json({ success: false, error: 'Report not found' });
    res.json({ success: true, report: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update report' });
  }
});

router.delete('/bug-reports/:id', MW.adminOrAbove, MW.sensitiveActionLimiter, MW.auditLog('bug_reports'), async (req, res) => {
  try {
    await Q.deleteBugReport(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete report' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  7) SYSTEM LOGS (AUDIT TRAIL)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/audit-logs', MW.helperOrAbove, async (req, res) => {
  try {
    const { category, search, limit, offset } = req.query;
    const logs = await Q.getAuditLogs({ category, search, limit: Number(limit) || 100, offset: Number(offset) || 0 });
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load logs' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  8) SECURITY SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/security', MW.adminOrAbove, async (req, res) => {
  try {
    const config = await Q.getConfig();
    const sessions = await Q.getActiveSessions();
    
    // Get actual maintenance state from maintenance_state table
    const maintenanceState = await db.get(`SELECT * FROM maintenance_state WHERE scope = ?`, ['darklock_site']);
    
    res.json({
      success: true,
      maintenanceMode:     maintenanceState?.enabled === 1,
      maintenanceMessage:  maintenanceState?.message || '',
      registrationEnabled: config.registration_enabled?.value !== 'false',
      emailVerification:   config.email_verification?.value === 'true',
      activeSessions:      sessions?.count || 0,
    });
  } catch (err) {
    console.error('[Admin v4] Security get error:', err);
    res.status(500).json({ success: false, error: 'Failed to load security settings' });
  }
});

router.post('/security/maintenance', MW.adminOrAbove, MW.auditLog('security'), async (req, res) => {
  try {
    const { enabled, message } = req.body;
    const now = new Date().toISOString();
    
    // Update the actual maintenance_state table for darklock_site scope
    const scope = 'darklock_site';
    const existing = await db.get(`SELECT id FROM maintenance_state WHERE scope = ?`, [scope]);
    
    if (!existing) {
      const id = crypto.randomUUID();
      await db.run(`INSERT INTO maintenance_state (id, scope, enabled, admin_bypass, title, message) VALUES (?, ?, ?, 1, ?, ?)`, 
        [id, scope, enabled ? 1 : 0, 'Scheduled Maintenance', message || 'We\'ll be back shortly']);
    } else {
      await db.run(`UPDATE maintenance_state SET enabled = ?, message = COALESCE(?, message), updated_by = ?, updated_at = ? WHERE scope = ?`,
        [enabled ? 1 : 0, message || null, req.admin.id, now, scope]);
    }
    
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: enabled ? 'enable_maintenance' : 'disable_maintenance', category: 'security', ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: enabled ? 'Maintenance mode enabled' : 'Maintenance mode disabled' });
  } catch (err) {
    console.error('[Admin v4] Security maintenance error:', err);
    res.status(500).json({ success: false, error: 'Failed to update maintenance' });
  }
});

router.post('/security/force-logout', MW.ownerOrCoowner, MW.sensitiveActionLimiter, MW.requireConfirmation, MW.auditLog('security'), async (req, res) => {
  try {
    await Q.forceLogoutAllUsers();
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'force_logout_all', category: 'security', ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: 'All user sessions terminated' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to force logout' });
  }
});

router.post('/security/toggle-registration', MW.ownerOrCoowner, MW.auditLog('security'), async (req, res) => {
  try {
    const { enabled } = req.body;
    await Q.setConfig('registration_enabled', String(!!enabled), req.admin.email);
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: enabled ? 'enable_registration' : 'disable_registration', category: 'security', ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: enabled ? 'Registration enabled' : 'Registration disabled' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to toggle registration' });
  }
});

router.post('/security/toggle-email-verification', MW.ownerOrCoowner, MW.auditLog('security'), async (req, res) => {
  try {
    const { enabled } = req.body;
    await Q.setConfig('email_verification', String(!!enabled), req.admin.email);
    res.json({ success: true, message: enabled ? 'Email verification enabled' : 'Email verification disabled' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to toggle verification' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  9) PLATFORM SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/settings', MW.modOrAbove, async (req, res) => {
  try {
    const config = await Q.getConfig();
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load settings' });
  }
});

router.put('/settings/:key', MW.adminOrAbove, MW.auditLog('settings'), async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ success: false, error: 'value is required' });
    await Q.setConfig(req.params.key, value, req.admin.email);
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'update_setting', category: 'settings', target_type: 'config', target_id: req.params.key, new_value: { value }, ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: `Setting ${req.params.key} updated` });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update setting' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  10) THEMES
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/themes', MW.modOrAbove, async (req, res) => {
  try {
    const themeManager = require('../utils/theme-manager');
    const themes = themeManager.getAllThemes();
    const active = await themeManager.getActiveTheme();
    const holidayRanges = themeManager.getHolidayRanges();
    res.json({
      success: true,
      themes,
      activeTheme: active.name,
      autoHoliday: active.autoHoliday,
      currentHoliday: active.currentHoliday || null,
      holidayRanges
    });
  } catch (err) {
    console.error('[Admin v4] Themes error:', err);
    res.status(500).json({ success: false, error: 'Failed to load themes' });
  }
});

router.post('/themes/set', MW.adminOrAbove, MW.auditLog('themes'), async (req, res) => {
  try {
    const { theme } = req.body;
    if (!theme) return res.status(400).json({ success: false, error: 'Theme name is required' });
    const themeManager = require('../utils/theme-manager');
    await themeManager.setTheme(theme);
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: 'change_theme', category: 'themes', target_type: 'theme', target_id: theme, ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: `Theme changed to ${theme}` });
  } catch (err) {
    console.error('[Admin v4] Set theme error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to set theme' });
  }
});

router.post('/themes/auto-holiday', MW.adminOrAbove, MW.auditLog('themes'), async (req, res) => {
  try {
    const { enabled } = req.body;
    const themeManager = require('../utils/theme-manager');
    await themeManager.setAutoHolidayThemes(!!enabled);
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: enabled ? 'enable_auto_theme' : 'disable_auto_theme', category: 'themes', ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: enabled ? 'Auto holiday themes enabled' : 'Auto holiday themes disabled' });
  } catch (err) {
    console.error('[Admin v4] Auto holiday error:', err);
    res.status(500).json({ success: false, error: 'Failed to update auto holiday setting' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  11) MAINTENANCE
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/maintenance', MW.modOrAbove, async (req, res) => {
  try {
    const db = require('../utils/database');
    const states = await db.all(`SELECT * FROM maintenance_state ORDER BY scope`).catch(() => []);
    // Ensure we have all 3 scopes
    const scopes = ['darklock_site', 'bot_dashboard', 'discord_bot'];
    const result = {};
    for (const scope of scopes) {
      const state = states.find(s => s.scope === scope);
      result[scope] = state || { scope, enabled: 0, title: 'Scheduled Maintenance', subtitle: "We'll be back shortly", message: '', scheduled_start: null, scheduled_end: null, admin_bypass: 1, apply_localhost: 0, bypass_ips: '[]', discord_announce: 0, status_updates: '[]' };
    }
    res.json({ success: true, scopes: result });
  } catch (err) {
    console.error('[Admin v4] Maintenance get error:', err);
    res.status(500).json({ success: false, error: 'Failed to load maintenance state' });
  }
});

router.post('/maintenance/update', MW.adminOrAbove, MW.auditLog('maintenance'), async (req, res) => {
  try {
    console.log('[Admin v4] Maintenance update called with body:', JSON.stringify(req.body));
    const db = require('../utils/database');
    const { scope, enabled, title, subtitle, message, scheduledEnd, adminBypass, applyLocalhost, bypassIps } = req.body;
    console.log('[Admin v4] Parsed values - scope:', scope, '| enabled:', enabled);
    if (!scope) return res.status(400).json({ success: false, error: 'Scope is required' });

    const validScopes = ['darklock_site', 'bot_dashboard', 'discord_bot'];
    if (!validScopes.includes(scope)) return res.status(400).json({ success: false, error: 'Invalid scope' });

    const now = new Date().toISOString();

    // Ensure scope row exists
    const existing = await db.get(`SELECT id FROM maintenance_state WHERE scope = ?`, [scope]);
    console.log('[Admin v4] Existing maintenance row:', existing ? 'found' : 'not found');
    if (!existing) {
      const id = require('crypto').randomUUID();
      console.log('[Admin v4] Creating new maintenance row for scope:', scope);
      await db.run(`INSERT INTO maintenance_state (id, scope, enabled, admin_bypass) VALUES (?, ?, 0, 1)`, [id, scope]);
    }

    console.log('[Admin v4] Updating maintenance_state - enabled:', enabled, '→', enabled !== undefined ? (enabled ? 1 : 0) : null);
    await db.run(`
      UPDATE maintenance_state SET
        enabled = COALESCE(?, enabled),
        title = COALESCE(?, title),
        subtitle = COALESCE(?, subtitle),
        message = COALESCE(?, message),
        scheduled_end = COALESCE(?, scheduled_end),
        admin_bypass = COALESCE(?, admin_bypass),
        apply_localhost = COALESCE(?, apply_localhost),
        bypass_ips = COALESCE(?, bypass_ips),
        updated_by = ?,
        updated_at = ?
      WHERE scope = ?
    `, [
      enabled !== undefined ? (enabled ? 1 : 0) : null,
      title || null,
      subtitle || null,
      message || null,
      scheduledEnd || null,
      adminBypass !== undefined ? (adminBypass ? 1 : 0) : null,
      applyLocalhost !== undefined ? (applyLocalhost ? 1 : 0) : null,
      bypassIps ? JSON.stringify(bypassIps) : null,
      req.admin.id,
      now,
      scope
    ]);

    console.log('[Admin v4] Database UPDATE completed successfully');
    const action = enabled === true ? 'enable_maintenance' : enabled === false ? 'disable_maintenance' : 'update_maintenance';
    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action, category: 'maintenance', target_type: 'scope', target_id: scope, ip_address: MW.getClientIP(req) });

    console.log('[Admin v4] Maintenance update success - sending response');
    res.json({ success: true, message: `Maintenance ${scope} updated` });
  } catch (err) {
    console.error('[Admin v4] Maintenance update error:', err);
    res.status(500).json({ success: false, error: 'Failed to update maintenance' });
  }
});

router.post('/maintenance/toggle-all', MW.adminOrAbove, MW.auditLog('maintenance'), async (req, res) => {
  try {
    const db = require('../utils/database');
    const { enabled, title, message } = req.body;
    const now = new Date().toISOString();

    for (const scope of ['darklock_site', 'bot_dashboard']) {
      const existing = await db.get(`SELECT id FROM maintenance_state WHERE scope = ?`, [scope]);
      if (!existing) {
        const id = require('crypto').randomUUID();
        await db.run(`INSERT INTO maintenance_state (id, scope, enabled, admin_bypass) VALUES (?, ?, 0, 1)`, [id, scope]);
      }
      await db.run(`UPDATE maintenance_state SET enabled = ?, title = COALESCE(?, title), message = COALESCE(?, message), updated_by = ?, updated_at = ? WHERE scope = ?`,
        [enabled ? 1 : 0, title || null, message || null, req.admin.id, now, scope]);
    }

    await Q.logAudit({ admin_id: req.admin.id, admin_email: req.admin.email, action: enabled ? 'enable_maintenance_all' : 'disable_maintenance_all', category: 'maintenance', ip_address: MW.getClientIP(req) });
    res.json({ success: true, message: enabled ? 'All maintenance enabled' : 'All maintenance disabled' });
  } catch (err) {
    console.error('[Admin v4] Toggle all error:', err);
    res.status(500).json({ success: false, error: 'Failed to toggle maintenance' });
  }
});

module.exports = router;
