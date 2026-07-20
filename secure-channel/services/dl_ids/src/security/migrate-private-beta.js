#!/usr/bin/env node
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createIdsSecureFields, SECURE_USER_FIELDS } from './secure-fields.js';
import { verifyEncryptedBackup } from './backup-archive.js';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function migrateValue(secureFields, domain, userId, collection, recordId, fieldName, value) {
  if (value === null || value === undefined || value === '') return value;
  if (secureFields.isEncryptedRecord(value)) return value;
  return secureFields.encode(domain, userId, collection, recordId, fieldName, String(value));
}

export function migratePrivateBetaDatabase(db, secureFields) {
  if (!secureFields?.configured) fail('RIDGELINE_SECURE_STORAGE_NOT_CONFIGURED');
  db.pragma('secure_delete = ON');
  const counts = {
    users: 0,
    syncValues: 0,
    sessions: 0,
    loginActivity: 0,
    securityActions: 0,
  };

  try {
    db.exec('ALTER TABLE users ADD COLUMN email_blind_index TEXT');
  } catch {
    // Column already exists.
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_blind_index
      ON users(email_blind_index) WHERE email_blind_index IS NOT NULL;
    CREATE TABLE IF NOT EXISTS secure_storage_migrations (
      id TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const migrationId = 'private-beta-server-fields-v1';
  if (db.prepare('SELECT 1 FROM secure_storage_migrations WHERE id = ?').get(migrationId)) {
    secureFields.assertEncryptedDatabase(db);
    return counts;
  }

  const migrate = db.transaction(() => {
    const users = db.prepare(`
      SELECT id, email, email_blind_index, display_name, profile_bio, pronouns,
             custom_status, profile_color, avatar, banner, totp_secret, twofa_pending_secret
      FROM users
    `).all();
    const updateUser = db.prepare(`
      UPDATE users
      SET email = ?, email_blind_index = ?, display_name = ?, profile_bio = ?, pronouns = ?,
          custom_status = ?, profile_color = ?, avatar = ?, banner = ?, totp_secret = ?,
          twofa_pending_secret = ?
      WHERE id = ?
    `);
    for (const row of users) {
      const originalEmail = secureFields.isEncryptedRecord(row.email)
        ? secureFields.decodeUserField(row.id, 'email', row.email)
        : row.email;
      const encrypted = {};
      for (const [fieldName, domain] of Object.entries(SECURE_USER_FIELDS)) {
        encrypted[fieldName] = migrateValue(
          secureFields,
          domain,
          row.id,
          'users',
          row.id,
          fieldName,
          row[fieldName],
        );
      }
      updateUser.run(
        encrypted.email,
        secureFields.emailIndex(originalEmail),
        encrypted.display_name,
        encrypted.profile_bio,
        encrypted.pronouns,
        encrypted.custom_status,
        encrypted.profile_color,
        encrypted.avatar,
        encrypted.banner,
        encrypted.totp_secret,
        encrypted.twofa_pending_secret,
        row.id,
      );
      counts.users += 1;
    }

    const syncRows = db.prepare('SELECT user_id, key, value_json FROM user_sync_kv').all();
    const updateSync = db.prepare('UPDATE user_sync_kv SET value_json = ? WHERE user_id = ? AND key = ?');
    for (const row of syncRows) {
      const value = migrateValue(secureFields, 'sync', row.user_id, 'user_sync_kv', row.key, 'value_json', row.value_json);
      if (value !== row.value_json) {
        updateSync.run(value, row.user_id, row.key);
        counts.syncValues += 1;
      }
    }

    const sessions = db.prepare("SELECT id, user_id, device_info FROM refresh_tokens WHERE device_info IS NOT NULL AND device_info != ''").all();
    const updateSession = db.prepare('UPDATE refresh_tokens SET device_info = ? WHERE id = ?');
    for (const row of sessions) {
      const value = migrateValue(
        secureFields, 'authentication', row.user_id, 'refresh_tokens', row.id, 'device_info', row.device_info,
      );
      if (value !== row.device_info) {
        updateSession.run(value, row.id);
        counts.sessions += 1;
      }
    }

    const activities = db.prepare(`
      SELECT id, user_id, fingerprint_hash, device_label, location_label, ip_hint
      FROM login_activity
    `).all();
    const updateActivity = db.prepare(`
      UPDATE login_activity
      SET fingerprint_hash = ?, device_label = ?, location_label = ?, ip_hint = ?
      WHERE id = ?
    `);
    for (const row of activities) {
      const needsEncryption = ['device_label', 'location_label', 'ip_hint']
        .some((fieldName) => row[fieldName] && !secureFields.isEncryptedRecord(row[fieldName]));
      const fingerprintHash = needsEncryption
        ? secureFields.blindIndex(row.fingerprint_hash, 'login_activity.fingerprint')
        : row.fingerprint_hash;
      updateActivity.run(
        fingerprintHash,
        migrateValue(secureFields, 'authentication', row.user_id, 'login_activity', row.id, 'device_label', row.device_label),
        migrateValue(secureFields, 'authentication', row.user_id, 'login_activity', row.id, 'location_label', row.location_label),
        migrateValue(secureFields, 'authentication', row.user_id, 'login_activity', row.id, 'ip_hint', row.ip_hint),
        row.id,
      );
      counts.loginActivity += 1;
    }

    const actions = db.prepare("SELECT id, user_id, metadata_json FROM account_security_actions WHERE metadata_json IS NOT NULL AND metadata_json != ''").all();
    const updateAction = db.prepare('UPDATE account_security_actions SET metadata_json = ? WHERE id = ?');
    for (const row of actions) {
      const value = migrateValue(
        secureFields, 'audit', row.user_id, 'account_security_actions', row.id, 'metadata_json', row.metadata_json,
      );
      if (value !== row.metadata_json) {
        updateAction.run(value, row.id);
        counts.securityActions += 1;
      }
    }
  });

  migrate();
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  db.pragma('wal_checkpoint(TRUNCATE)');
  secureFields.assertEncryptedDatabase(db);
  secureFields.initializeDatabaseKeyCheck(db);
  db.prepare('INSERT INTO secure_storage_migrations (id) VALUES (?)').run(migrationId);
  return counts;
}

function argumentAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const databasePath = argumentAfter('--database');
  const verifiedBackup = argumentAfter('--verified-backup');
  const confirmed = process.argv.includes('--confirm-private-beta-migration');
  const synthetic = process.argv.includes('--synthetic') && process.env.NODE_ENV === 'test';
  if (!databasePath || !confirmed) fail('RIDGELINE_MIGRATION_EXPLICIT_CONFIRMATION_REQUIRED');
  if (!existsSync(databasePath)) fail('RIDGELINE_MIGRATION_DATABASE_NOT_FOUND');

  const secureFields = await createIdsSecureFields({
    ...process.env,
    RIDGELINE_SECURE_STORAGE_MODE: 'private-beta',
  });
  try {
    if (!synthetic) {
      if (!verifiedBackup || !existsSync(verifiedBackup)) fail('RIDGELINE_MIGRATION_VERIFIED_BACKUP_REQUIRED');
      await verifyEncryptedBackup({ archivePath: verifiedBackup, secureFields });
    }

    const db = new Database(resolve(databasePath), { fileMustExist: true });
    try {
      db.pragma('foreign_keys = ON');
      const counts = migratePrivateBetaDatabase(db, secureFields);
      process.stdout.write(`Ridgeline private-beta migration complete: ${JSON.stringify(counts)}\n`);
    } finally {
      db.close();
    }
  } finally {
    secureFields.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.code || 'RIDGELINE_MIGRATION_FAILED'}\n`);
    process.exitCode = 1;
  });
}
