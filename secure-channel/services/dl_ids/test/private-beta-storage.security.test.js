import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
  openSync,
  closeSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initDatabase } from '../src/db.js';
import { createIdsSecureFields } from '../src/security/secure-fields.js';
import { migratePrivateBetaDatabase } from '../src/security/migrate-private-beta.js';
import {
  createEncryptedBackup,
  restoreEncryptedBackup,
  verifyEncryptedBackup,
} from '../src/security/backup-archive.js';

function secureEnvironment(keyPath) {
  return {
    NODE_ENV: 'test',
    RIDGELINE_ENVIRONMENT: 'test',
    RIDGELINE_SECURE_STORAGE_MODE: 'private-beta',
    RIDGELINE_MASTER_KEY_FILE: keyPath,
  };
}

function assertSentinelsAbsent(paths, sentinels) {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    for (const sentinel of sentinels) {
      assert.equal(bytes.includes(Buffer.from(sentinel, 'utf8')), false, `${sentinel} leaked in ${path}`);
    }
  }
}

test('private-beta migration, encrypted backup, restore, and sentinel scan fail closed', { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ridgeline-private-beta-'));
  const keyPath = join(root, 'server-master-key');
  const wrongKeyPath = join(root, 'wrong-master-key');
  const databasePath = join(root, 'ids.db');
  const backupDirectory = join(root, 'backups');
  const restoredPath = join(root, 'restored', 'ids.db');
  const userId = `sentinel-${randomUUID()}`;
  const sentinels = {
    email: `email-${randomUUID()}@example.test`,
    displayName: `display-${randomUUID()}`,
    bio: `bio-${randomUUID()}`,
    status: `status-${randomUUID()}`,
    pronouns: `pronouns-${randomUUID()}`,
    avatar: `data:image/png;base64,${Buffer.from(`image-${randomUUID()}`).toString('base64')}`,
    sync: `setting-${randomUUID()}`,
    totp: `TOTP${randomUUID().replaceAll('-', '').toUpperCase()}`,
    device: `device-${randomUUID()}`,
  };
  const sentinelValues = Object.values(sentinels);
  writeFileSync(keyPath, randomBytes(32));
  writeFileSync(wrongKeyPath, randomBytes(32));
  if (process.platform !== 'win32') {
    chmodSync(keyPath, 0o600);
    chmodSync(wrongKeyPath, 0o600);
  }

  const db = initDatabase(databasePath);
  if (process.platform !== 'win32') chmodSync(databasePath, 0o600);
  try {
    db.prepare(`
      INSERT INTO users (
        id, username, email, password_hash, identity_pubkey, display_name,
        profile_bio, pronouns, custom_status, avatar, totp_secret
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      userId,
      sentinels.email,
      '$2b$12$synthetic-not-a-real-password-hash',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      sentinels.displayName,
      sentinels.bio,
      sentinels.pronouns,
      sentinels.status,
      sentinels.avatar,
      sentinels.totp,
    );
    db.prepare('INSERT INTO user_sync_kv (user_id, key, value_json) VALUES (?, ?, ?)')
      .run(userId, 'private-setting', JSON.stringify({ value: sentinels.sync }));
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, device_info, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run('session-1', userId, 'sha256:session-token', JSON.stringify({ label: sentinels.device }), '2999-01-01T00:00:00.000Z');
    db.prepare(`
      INSERT INTO login_activity (id, user_id, fingerprint_hash, device_label, location_label, ip_hint)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('login-1', userId, 'legacy-fingerprint', sentinels.device, 'private-location', '192.0.*.*');

    const secureFields = await createIdsSecureFields(secureEnvironment(keyPath));
    try {
      assert.throws(() => secureFields.assertEncryptedDatabase(db), /MIGRATION_REQUIRED/);
      const before = await createEncryptedBackup({
        databasePath,
        backupDirectory,
        secureFields,
        retain: 4,
      });
      assertSentinelsAbsent([before.archivePath], sentinelValues);
      assert.deepEqual(await verifyEncryptedBackup({ archivePath: before.archivePath, secureFields }).then((r) => r.ok), true);

      const counts = migratePrivateBetaDatabase(db, secureFields);
      assert.equal(counts.users, 1);
      secureFields.assertEncryptedDatabase(db);
      const migratedFingerprint = db.prepare('SELECT fingerprint_hash FROM login_activity WHERE id = ?').get('login-1').fingerprint_hash;
      assert.deepEqual(migratePrivateBetaDatabase(db, secureFields), {
        users: 0,
        syncValues: 0,
        sessions: 0,
        loginActivity: 0,
        securityActions: 0,
      });
      assert.equal(
        db.prepare('SELECT fingerprint_hash FROM login_activity WHERE id = ?').get('login-1').fingerprint_hash,
        migratedFingerprint,
      );
      const wrongDatabaseFields = await createIdsSecureFields(secureEnvironment(wrongKeyPath));
      try {
        assert.throws(
          () => wrongDatabaseFields.verifyDatabaseKeyCheck(db),
          /RIDGELINE_(ENVELOPE_AUTHENTICATION_FAILED|DATABASE_KEY_CHECK_INVALID)/,
        );
      } finally {
        wrongDatabaseFields.destroy();
      }

      const encryptedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      assert.equal(secureFields.decodeUserField(userId, 'email', encryptedUser.email), sentinels.email);
      assert.equal(secureFields.decodeUserField(userId, 'profile_bio', encryptedUser.profile_bio), sentinels.bio);
      assert.equal(secureFields.decodeUserField(userId, 'totp_secret', encryptedUser.totp_secret), sentinels.totp);
      assertSentinelsAbsent([databasePath, `${databasePath}-wal`, `${databasePath}-shm`], sentinelValues);

      const after = await createEncryptedBackup({
        databasePath,
        backupDirectory,
        secureFields,
        retain: 4,
      });
      assertSentinelsAbsent([after.archivePath], sentinelValues);
      await restoreEncryptedBackup({ archivePath: after.archivePath, destinationPath: restoredPath, secureFields });
      assertSentinelsAbsent([restoredPath, `${restoredPath}-wal`, `${restoredPath}-shm`], sentinelValues);

      const tamperedPath = join(backupDirectory, 'tampered.rlbackup');
      copyFileSync(after.archivePath, tamperedPath);
      const tamperedFd = openSync(tamperedPath, 'r+');
      try {
        const size = readFileSync(tamperedPath).length;
        writeSync(tamperedFd, Buffer.from([0xff]), 0, 1, size - 8);
      } finally {
        closeSync(tamperedFd);
      }
      await assert.rejects(
        () => verifyEncryptedBackup({ archivePath: tamperedPath, secureFields }),
        /RIDGELINE_(SECRETSTREAM_AUTHENTICATION_FAILED|BACKUP_)/,
      );

      const wrongFields = await createIdsSecureFields(secureEnvironment(wrongKeyPath));
      try {
        await assert.rejects(
          () => verifyEncryptedBackup({ archivePath: after.archivePath, secureFields: wrongFields }),
          /RIDGELINE_SECRETSTREAM_AUTHENTICATION_FAILED/,
        );
      } finally {
        wrongFields.destroy();
      }
    } finally {
      secureFields.destroy();
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
