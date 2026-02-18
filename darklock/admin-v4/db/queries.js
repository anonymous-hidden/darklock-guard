/**
 * Darklock Admin v4 — Database Query Layer
 * All DB access goes through here. Frontend never touches SQL.
 */

'use strict';

const db = require('../../utils/database');

// ═══════════════════════════════════════════════════════════════════════════════
//  OVERVIEW / STATS
// ═══════════════════════════════════════════════════════════════════════════════
async function getOverviewStats() {
  const [
    totalUsers,
    premiumUsers,
    activeUsers,
    totalBugReports,
    openBugReports,
    latestAnnouncement,
    appVersion,
  ] = await Promise.all([
    db.get(`SELECT COUNT(*) as count FROM users`),
    db.get(`SELECT COUNT(*) as count FROM users WHERE role = 'premium' OR role = 'vip'`),
    db.get(`SELECT COUNT(*) as count FROM users WHERE last_login >= datetime('now', '-7 days')`),
    db.get(`SELECT COUNT(*) as count FROM bug_reports_v2`),
    db.get(`SELECT COUNT(*) as count FROM bug_reports_v2 WHERE status = 'open'`),
    db.get(`SELECT * FROM platform_announcements ORDER BY created_at DESC LIMIT 1`),
    db.get(`SELECT value FROM platform_config WHERE key = 'current_app_version'`),
  ]);

  return {
    totalUsers:        totalUsers?.count || 0,
    premiumUsers:      premiumUsers?.count || 0,
    activeUsers:       activeUsers?.count || 0,
    totalBugReports:   totalBugReports?.count || 0,
    openBugReports:    openBugReports?.count || 0,
    latestAnnouncement: latestAnnouncement || null,
    currentAppVersion: appVersion?.value || '0.0.0',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════════════════
async function getAnnouncements({ limit = 50, offset = 0 } = {}) {
  return db.all(`
    SELECT * FROM platform_announcements
    ORDER BY pinned DESC, created_at DESC
    LIMIT ? OFFSET ?
  `, [limit, offset]);
}

async function getAnnouncementById(id) {
  return db.get(`SELECT * FROM platform_announcements WHERE id = ?`, [id]);
}

async function createAnnouncement({ id, title, content, version, visibility, pinned, author_id, author_email }) {
  await db.run(`
    INSERT INTO platform_announcements (id, title, content, version, visibility, pinned, author_id, author_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, title, content, version || null, visibility || 'public', pinned ? 1 : 0, author_id, author_email]);
  return getAnnouncementById(id);
}

async function updateAnnouncement(id, { title, content, version, visibility, pinned }) {
  await db.run(`
    UPDATE platform_announcements
    SET title = COALESCE(?, title),
        content = COALESCE(?, content),
        version = COALESCE(?, version),
        visibility = COALESCE(?, visibility),
        pinned = COALESCE(?, pinned),
        updated_at = datetime('now')
    WHERE id = ?
  `, [title, content, version, visibility, pinned !== undefined ? (pinned ? 1 : 0) : undefined, id]);
  return getAnnouncementById(id);
}

async function deleteAnnouncement(id) {
  return db.run(`DELETE FROM platform_announcements WHERE id = ?`, [id]);
}

async function getNextAnnouncementVersion() {
  const latest = await db.get(`
    SELECT version FROM platform_announcements
    WHERE version IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `);
  if (!latest?.version) return '1.0.0';
  const parts = latest.version.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACCOUNTS (users table)
// ═══════════════════════════════════════════════════════════════════════════════
async function getAccounts({ search, filter, limit = 50, offset = 0 } = {}) {
  let where = [];
  let params = [];

  if (search) {
    where.push(`(username LIKE ? OR email LIKE ? OR display_name LIKE ?)`);
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  if (filter === 'premium')  { where.push(`(role = 'premium' OR role = 'vip')`); }
  if (filter === 'free')     { where.push(`role = 'user'`); }
  if (filter === 'admin')    { where.push(`role IN ('admin','owner')`); }
  if (filter === 'banned')   { where.push(`active = 0`); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const [rows, countRow] = await Promise.all([
    db.all(`
      SELECT id, username, email, display_name, role, avatar, active, created_at, last_login
      FROM users ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]),
    db.get(`SELECT COUNT(*) as total FROM users ${whereClause}`, params),
  ]);

  return { accounts: rows || [], total: countRow?.total || 0 };
}

async function getAccountById(userId) {
  return db.get(`
    SELECT id, username, email, display_name, role, avatar, active, created_at, last_login, settings
    FROM users WHERE id = ?
  `, [userId]);
}

async function updateAccountRole(userId, role) {
  return db.run(`UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`, [role, userId]);
}

async function banAccount(userId) {
  return db.run(`UPDATE users SET active = 0, updated_at = datetime('now') WHERE id = ?`, [userId]);
}

async function unbanAccount(userId) {
  return db.run(`UPDATE users SET active = 1, updated_at = datetime('now') WHERE id = ?`, [userId]);
}

async function deleteAccount(userId) {
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
  return db.run(`DELETE FROM users WHERE id = ?`, [userId]);
}

async function resetAccountPassword(userId, hashedPassword) {
  return db.run(`UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?`, [hashedPassword, userId]);
}

async function getAccountSessions(userId) {
  return db.all(`SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC`, [userId]);
}

async function getAccountDevices(userId) {
  // Check device-status.json or a devices table if available
  try {
    const fs = require('fs').promises;
    const path = require('path');
    const dataDir = process.env.DATA_PATH || require('path').join(__dirname, '../../data');
    const data = JSON.parse(await fs.readFile(path.join(dataDir, 'device-status.json'), 'utf-8'));
    return (data.devices || []).filter(d => d.userId === userId);
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROLES & ACCESS
// ═══════════════════════════════════════════════════════════════════════════════
async function getAdminUsers() {
  return db.all(`SELECT id, email, username, role, display_name, active, last_login, created_at FROM admins ORDER BY role ASC, email ASC`);
}

async function getAdminById(adminId) {
  return db.get(`SELECT id, email, username, role, display_name, active, last_login, created_at FROM admins WHERE id = ?`, [adminId]);
}

async function getRoles() {
  return db.all(`SELECT * FROM admin_roles ORDER BY level DESC`);
}

async function getRolePermissions(roleId) {
  return db.all(`SELECT * FROM admin_permissions WHERE role_id = ?`, [roleId]);
}

async function setRolePermission(roleId, permission, granted) {
  return db.run(`
    INSERT INTO admin_permissions (role_id, permission, granted) VALUES (?, ?, ?)
    ON CONFLICT(role_id, permission) DO UPDATE SET granted = excluded.granted
  `, [roleId, permission, granted ? 1 : 0]);
}

async function updateAdminRole(adminId, newRole) {
  return db.run(`UPDATE admins SET role = ?, updated_at = datetime('now') WHERE id = ?`, [newRole, adminId]);
}

async function deleteAdmin(adminId) {
  return db.run(`DELETE FROM admins WHERE id = ?`, [adminId]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  APP UPDATES
// ═══════════════════════════════════════════════════════════════════════════════
async function getAppUpdates({ limit = 50, offset = 0, channel } = {}) {
  if (channel && channel !== 'all') {
    return db.all(`SELECT * FROM app_updates WHERE channel = ? ORDER BY published_at DESC LIMIT ? OFFSET ?`, [channel, limit, offset]);
  }
  return db.all(`SELECT * FROM app_updates ORDER BY published_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
}

async function getAppUpdateById(id) {
  return db.get(`SELECT * FROM app_updates WHERE id = ?`, [id]);
}

async function getLatestAppUpdate(channel = 'stable') {
  if (channel === 'beta') {
    // beta gets the absolute latest regardless of channel
    return db.get(`SELECT * FROM app_updates ORDER BY published_at DESC LIMIT 1`);
  }
  // stable: prefer stable-channel entry, fallback to any latest
  const stable = await db.get(`SELECT * FROM app_updates WHERE channel = 'stable' ORDER BY published_at DESC LIMIT 1`);
  return stable || db.get(`SELECT * FROM app_updates ORDER BY published_at DESC LIMIT 1`);
}

async function createAppUpdate({ id, version, title, changelog, download_url, force_update, min_version, channel, published_by }) {
  const ch = (channel === 'beta') ? 'beta' : 'stable';
  await db.run(`
    INSERT INTO app_updates (id, version, title, changelog, download_url, force_update, min_version, channel, published_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, version, title, changelog, download_url || null, force_update ? 1 : 0, min_version || null, ch, published_by]);
  return getAppUpdateById(id);
}

async function deleteAppUpdate(id) {
  return db.run(`DELETE FROM app_updates WHERE id = ?`, [id]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BUG REPORTS
// ═══════════════════════════════════════════════════════════════════════════════
async function getBugReports({ source, status, severity, limit = 50, offset = 0 } = {}) {
  let where = [];
  let params = [];

  if (source)   { where.push(`source = ?`);   params.push(source); }
  if (status)   { where.push(`status = ?`);   params.push(status); }
  if (severity) { where.push(`severity = ?`); params.push(severity); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const [rows, countRow] = await Promise.all([
    db.all(`SELECT * FROM bug_reports_v2 ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]),
    db.get(`SELECT COUNT(*) as total FROM bug_reports_v2 ${whereClause}`, params),
  ]);

  return { reports: rows || [], total: countRow?.total || 0 };
}

async function getBugReportById(id) {
  return db.get(`SELECT * FROM bug_reports_v2 WHERE id = ?`, [id]);
}

async function createBugReport(data) {
  const { source, reporter, email, title, description, severity, app_version, environment, logs, user_agent, ip_address } = data;
  const result = await db.run(`
    INSERT INTO bug_reports_v2 (source, reporter, email, title, description, severity, app_version, environment, logs, user_agent, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [source || 'site', reporter, email, title, description, severity || 'medium', app_version, environment, logs, user_agent, ip_address]);
  return getBugReportById(result.lastID);
}

async function updateBugReport(id, { status, internal_notes, assigned_to, severity }) {
  await db.run(`
    UPDATE bug_reports_v2
    SET status = COALESCE(?, status),
        internal_notes = COALESCE(?, internal_notes),
        assigned_to = COALESCE(?, assigned_to),
        severity = COALESCE(?, severity),
        updated_at = datetime('now')
    WHERE id = ?
  `, [status, internal_notes, assigned_to, severity, id]);
  return getBugReportById(id);
}

async function deleteBugReport(id) {
  return db.run(`DELETE FROM bug_reports_v2 WHERE id = ?`, [id]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUDIT TRAIL
// ═══════════════════════════════════════════════════════════════════════════════
async function logAudit({ admin_id, admin_email, action, category, target_type, target_id, old_value, new_value, ip_address, user_agent }) {
  return db.run(`
    INSERT INTO admin_audit_trail (admin_id, admin_email, action, category, target_type, target_id, old_value, new_value, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [admin_id, admin_email, action, category || 'general', target_type, target_id,
      old_value ? JSON.stringify(old_value) : null,
      new_value ? JSON.stringify(new_value) : null,
      ip_address, user_agent]);
}

async function getAuditLogs({ category, search, limit = 100, offset = 0 } = {}) {
  let where = [];
  let params = [];

  if (category) { where.push(`category = ?`); params.push(category); }
  if (search)   { where.push(`(action LIKE ? OR admin_email LIKE ? OR target_id LIKE ?)`); const q = `%${search}%`; params.push(q, q, q); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  return db.all(`
    SELECT * FROM admin_audit_trail ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PLATFORM CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
async function getConfig() {
  const rows = await db.all(`SELECT * FROM platform_config ORDER BY key`);
  const config = {};
  for (const r of rows) { config[r.key] = r; }
  return config;
}

async function setConfig(key, value, updatedBy) {
  return db.run(`
    UPDATE platform_config SET value = ?, updated_by = ?, updated_at = datetime('now') WHERE key = ?
  `, [String(value), updatedBy, key]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECURITY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
async function forceLogoutAllUsers() {
  return db.run(`DELETE FROM sessions`);
}

async function getActiveSessions() {
  return db.get(`SELECT COUNT(*) as count FROM sessions WHERE (revoked_at IS NULL AND expires_at > datetime('now'))`);
}

module.exports = {
  // overview
  getOverviewStats,
  // announcements
  getAnnouncements, getAnnouncementById, createAnnouncement, updateAnnouncement, deleteAnnouncement, getNextAnnouncementVersion,
  // accounts
  getAccounts, getAccountById, updateAccountRole, banAccount, unbanAccount, deleteAccount, resetAccountPassword, getAccountSessions, getAccountDevices,
  // roles
  getAdminUsers, getAdminById, getRoles, getRolePermissions, setRolePermission, updateAdminRole, deleteAdmin,
  // app updates
  getAppUpdates, getAppUpdateById, getLatestAppUpdate, createAppUpdate, deleteAppUpdate,
  // bug reports
  getBugReports, getBugReportById, createBugReport, updateBugReport, deleteBugReport,
  // audit
  logAudit, getAuditLogs,
  // config
  getConfig, setConfig,
  // security
  forceLogoutAllUsers, getActiveSessions,
};
