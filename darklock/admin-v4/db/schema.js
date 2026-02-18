/**
 * Darklock Admin v4 — Database Schema
 * Consolidated schema for the redesigned admin dashboard.
 *
 * Tables managed here:
 *   admin_roles           – RBAC role definitions
 *   admin_permissions     – granular permission flags per role
 *   admin_audit_trail     – unified admin action log
 *   platform_announcements – announcements / release notes
 *   app_updates           – pushed app update records
 *   bug_reports_v2        – bug reports from site + desktop app
 *   platform_config       – key/value platform settings
 *
 * Existing tables we READ (not modify):
 *   admins, users, sessions, updates, admin_audit_logs
 */

'use strict';

const db = require('../../utils/database');

// ── Role hierarchy ──────────────────────────────────────────────────────────────
const ROLE_HIERARCHY = {
  owner:   100,
  coowner:  90,
  admin:    70,
  mod:      50,
  helper:   30,
};

// ── Default permissions per role ────────────────────────────────────────────────
const DEFAULT_PERMISSIONS = {
  owner:   { '*': true },
  coowner: {
    overview: true, announcements: true, accounts: true,
    'accounts.delete': true, 'accounts.ban': true, 'accounts.premium': true,
    roles: true, 'roles.create': true, 'roles.edit': true, 'roles.remove': true,
    app_updates: true, bug_reports: true, 'bug_reports.manage': true,
    system_logs: true, security: true, settings: true,
  },
  admin: {
    overview: true, announcements: true, accounts: true,
    'accounts.ban': true, 'accounts.premium': true,
    app_updates: true, bug_reports: true, 'bug_reports.manage': true,
    system_logs: true,
  },
  mod: {
    overview: true, accounts: true,
    bug_reports: true,
    system_logs: true,
  },
  helper: {
    overview: true,
    bug_reports: true,
  },
};

// ── Schema initializer ──────────────────────────────────────────────────────────
async function initializeV4Schema() {
  // admin_roles — canonical role definitions
  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_roles (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      level       INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // admin_permissions — per-role permission flags
  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_permissions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id     TEXT NOT NULL REFERENCES admin_roles(id),
      permission  TEXT NOT NULL,
      granted     INTEGER NOT NULL DEFAULT 1,
      UNIQUE(role_id, permission)
    )
  `);

  // admin_audit_trail — unified action log
  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_audit_trail (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id    TEXT NOT NULL,
      admin_email TEXT,
      action      TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'general',
      target_type TEXT,
      target_id   TEXT,
      old_value   TEXT,
      new_value   TEXT,
      ip_address  TEXT,
      user_agent  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_v4_audit_admin    ON admin_audit_trail(admin_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_v4_audit_category ON admin_audit_trail(category)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_v4_audit_created  ON admin_audit_trail(created_at)`);

  // platform_announcements
  await db.run(`
    CREATE TABLE IF NOT EXISTS platform_announcements (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      version     TEXT,
      visibility  TEXT NOT NULL DEFAULT 'public',
      pinned      INTEGER NOT NULL DEFAULT 0,
      author_id   TEXT,
      author_email TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // app_updates — pushed update records for Darklock Guard
  await db.run(`
    CREATE TABLE IF NOT EXISTS app_updates (
      id              TEXT PRIMARY KEY,
      version         TEXT NOT NULL UNIQUE,
      title           TEXT NOT NULL,
      changelog       TEXT,
      download_url    TEXT,
      force_update    INTEGER NOT NULL DEFAULT 0,
      min_version     TEXT,
      channel         TEXT NOT NULL DEFAULT 'stable',
      published_by    TEXT,
      published_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Migrate existing app_updates table to add channel column if missing
  await db.run(`ALTER TABLE app_updates ADD COLUMN channel TEXT NOT NULL DEFAULT 'stable'`).catch(() => {});

  // bug_reports_v2 — aggregated from site + desktop app
  await db.run(`
    CREATE TABLE IF NOT EXISTS bug_reports_v2 (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source      TEXT NOT NULL DEFAULT 'site',
      reporter    TEXT,
      email       TEXT,
      title       TEXT NOT NULL,
      description TEXT NOT NULL,
      severity    TEXT NOT NULL DEFAULT 'medium',
      status      TEXT NOT NULL DEFAULT 'open',
      app_version TEXT,
      environment TEXT,
      logs        TEXT,
      internal_notes TEXT,
      assigned_to TEXT,
      user_agent  TEXT,
      ip_address  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_v4_bugs_status  ON bug_reports_v2(status)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_v4_bugs_source  ON bug_reports_v2(source)`);

  // platform_config — key/value settings
  await db.run(`
    CREATE TABLE IF NOT EXISTS platform_config (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      type        TEXT NOT NULL DEFAULT 'string',
      description TEXT,
      updated_by  TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ── Seed roles ──────────────────────────────────────────────────────────────
  for (const [name, level] of Object.entries(ROLE_HIERARCHY)) {
    await db.run(`
      INSERT OR IGNORE INTO admin_roles (id, name, level, description)
      VALUES (?, ?, ?, ?)
    `, [name, name, level, `${name} role`]);
  }

  // ── Seed permissions ────────────────────────────────────────────────────────
  for (const [role, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
    for (const [perm, granted] of Object.entries(perms)) {
      await db.run(`
        INSERT OR IGNORE INTO admin_permissions (role_id, permission, granted)
        VALUES (?, ?, ?)
      `, [role, perm, granted ? 1 : 0]);
    }
  }

  // ── Seed default config ─────────────────────────────────────────────────────
  const defaults = [
    ['platform_name',          'Darklock',                     'string', 'Platform display name'],
    ['contact_email',          'support@darklock.net',         'string', 'Contact email address'],
    ['registration_enabled',   'true',                         'boolean', 'Allow new user signups'],
    ['email_verification',     'false',                        'boolean', 'Require email verification'],
    ['maintenance_mode',       'false',                        'boolean', 'Global maintenance mode'],
    ['maintenance_message',    'We\'ll be back shortly.',      'string', 'Maintenance page message'],
    ['free_tier_file_limit',   '10',                           'number', 'Max protected files for free users'],
    ['premium_tier_file_limit','unlimited',                     'string', 'Max protected files for premium'],
    ['current_app_version',    '2.0.0',                        'string', 'Latest published app version'],
  ];
  for (const [key, value, type, desc] of defaults) {
    await db.run(`
      INSERT OR IGNORE INTO platform_config (key, value, type, description)
      VALUES (?, ?, ?, ?)
    `, [key, value, type, desc]);
  }

  console.log('[Admin v4] Schema initialized successfully');
}

module.exports = {
  initializeV4Schema,
  ROLE_HIERARCHY,
  DEFAULT_PERMISSIONS,
};
