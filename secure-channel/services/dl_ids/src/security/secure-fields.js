import {
  createSecureStorage,
  loadServerMasterKey,
} from '@darklock/ridgeline-secure-storage';

const PROFILE_FIELDS = Object.freeze({
  display_name: 'profile',
  profile_bio: 'profile',
  pronouns: 'profile',
  custom_status: 'profile',
  profile_color: 'profile',
  avatar: 'media',
  banner: 'media',
});

const AUTH_FIELDS = Object.freeze({
  email: 'authentication',
  totp_secret: 'authentication',
  twofa_pending_secret: 'authentication',
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function normalizedEnvironment(value) {
  const candidate = String(value || 'development').trim().toLowerCase();
  return ['development', 'test', 'staging', 'production'].includes(candidate)
    ? candidate
    : 'production';
}

function aad(environment, domain, userId, collection, recordId, fieldName) {
  return {
    application: 'ridgeline',
    environment,
    service: 'ids',
    encryptionDomain: domain,
    userId: String(userId),
    collection,
    recordId: String(recordId),
    fieldName,
    schemaVersion: 1,
  };
}

export function isPrivateBetaSecureStorageRequired(env = process.env) {
  return env.NODE_ENV === 'production'
    || String(env.RIDGELINE_SECURE_STORAGE_MODE || '').toLowerCase() === 'private-beta';
}

export async function createIdsSecureFields(env = process.env) {
  const required = isPrivateBetaSecureStorageRequired(env);
  if (!required) {
    return Object.freeze({
      configured: false,
      mode: 'not-configured',
      environment: normalizedEnvironment(env.RIDGELINE_ENVIRONMENT || env.NODE_ENV),
      assertEncryptedDatabase() {},
      verifyDatabaseKeyCheck() {},
      initializeDatabaseKeyCheck() {},
      encode(_domain, _userId, _collection, _recordId, _fieldName, value) { return value ?? null; },
      decode(_domain, _userId, _collection, _recordId, _fieldName, value) { return value ?? null; },
      encodeJson(_domain, _userId, _collection, _recordId, _fieldName, value) { return JSON.stringify(value); },
      decodeJson(_domain, _userId, _collection, _recordId, _fieldName, value) { return JSON.parse(value); },
      encodeUserField(_userId, _fieldName, value) { return value ?? null; },
      decodeUserField(_userId, _fieldName, value) { return value ?? null; },
      emailIndex() { fail('RIDGELINE_SECURE_STORAGE_NOT_CONFIGURED'); },
      blindIndex(value) { return String(value); },
      isEncryptedRecord() { return false; },
      createSecretStreamEncryptor() { fail('RIDGELINE_SECURE_STORAGE_NOT_CONFIGURED'); },
      createSecretStreamDecryptor() { fail('RIDGELINE_SECURE_STORAGE_NOT_CONFIGURED'); },
      destroy() {},
    });
  }

  const environment = normalizedEnvironment(env.RIDGELINE_ENVIRONMENT || env.NODE_ENV);
  const masterKey = loadServerMasterKey({
    keyPath: env.RIDGELINE_MASTER_KEY_FILE || '/etc/ridgeline/keys/server-master-key',
    environment,
    expectedOwnerUid: env.RIDGELINE_MASTER_KEY_OWNER_UID,
    deniedFingerprints: env.RIDGELINE_DEVELOPMENT_KEY_FINGERPRINTS,
  });
  const storage = await createSecureStorage({
    masterKey,
    environment,
    service: 'ids',
    maxPlaintextBytes: 20 * 1024 * 1024,
  });

  function encode(domain, userId, collection, recordId, fieldName, value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') fail('RIDGELINE_SECURE_FIELD_TYPE_INVALID');
    return storage.encryptText(domain, value, aad(environment, domain, userId, collection, recordId, fieldName));
  }

  function decode(domain, userId, collection, recordId, fieldName, value) {
    if (value === null || value === undefined || value === '') return null;
    if (!storage.isEncryptedRecord(value)) fail('RIDGELINE_PLAINTEXT_SENSITIVE_RECORD_REJECTED');
    return storage.decryptText(domain, value, aad(environment, domain, userId, collection, recordId, fieldName));
  }

  function assertEncryptedDatabase(db) {
    const failures = [];
    const users = db.prepare(`
      SELECT id, email, email_blind_index, display_name, profile_bio, pronouns,
             custom_status, profile_color, avatar, banner, totp_secret, twofa_pending_secret
      FROM users
    `).all();
    for (const row of users) {
      for (const fieldName of Object.keys(AUTH_FIELDS)) {
        if (row[fieldName] && !storage.isEncryptedRecord(row[fieldName])) failures.push(`users.${fieldName}`);
      }
      for (const fieldName of Object.keys(PROFILE_FIELDS)) {
        if (row[fieldName] && !storage.isEncryptedRecord(row[fieldName])) failures.push(`users.${fieldName}`);
      }
      if (row.email && !row.email_blind_index) failures.push('users.email_blind_index');
    }

    for (const row of db.prepare('SELECT user_id, key, value_json FROM user_sync_kv').all()) {
      if (row.value_json && !storage.isEncryptedRecord(row.value_json)) failures.push('user_sync_kv.value_json');
    }
    for (const row of db.prepare("SELECT id, user_id, device_info FROM refresh_tokens WHERE device_info IS NOT NULL AND device_info != ''").all()) {
      if (!storage.isEncryptedRecord(row.device_info)) failures.push('refresh_tokens.device_info');
    }
    for (const row of db.prepare('SELECT id, device_label, location_label, ip_hint FROM login_activity').all()) {
      for (const fieldName of ['device_label', 'location_label', 'ip_hint']) {
        if (row[fieldName] && !storage.isEncryptedRecord(row[fieldName])) failures.push(`login_activity.${fieldName}`);
      }
    }
    for (const row of db.prepare("SELECT id, metadata_json FROM account_security_actions WHERE metadata_json IS NOT NULL AND metadata_json != ''").all()) {
      if (!storage.isEncryptedRecord(row.metadata_json)) failures.push('account_security_actions.metadata_json');
    }

    if (failures.length > 0) {
      const unique = [...new Set(failures)].sort().join(',');
      fail(`RIDGELINE_SECURE_STORAGE_MIGRATION_REQUIRED:${unique}`);
    }
  }

  const keyCheckAad = aad(
    environment,
    'audit',
    'ridgeline-server',
    'secure_storage_key_check',
    'database-key-v1',
    'validation_value',
  );
  const keyCheckPlaintext = 'ridgeline-database-key-check-v1';

  function initializeDatabaseKeyCheck(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS secure_storage_key_check (
        id TEXT PRIMARY KEY,
        validation_value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const existing = db.prepare('SELECT validation_value FROM secure_storage_key_check WHERE id = ?').get('database-key-v1');
    if (existing) {
      const decrypted = storage.decryptText('audit', existing.validation_value, keyCheckAad);
      if (decrypted !== keyCheckPlaintext) fail('RIDGELINE_DATABASE_KEY_CHECK_INVALID');
      return;
    }
    const encrypted = storage.encryptText('audit', keyCheckPlaintext, keyCheckAad);
    db.prepare('INSERT INTO secure_storage_key_check (id, validation_value) VALUES (?, ?)')
      .run('database-key-v1', encrypted);
  }

  function verifyDatabaseKeyCheck(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS secure_storage_key_check (
        id TEXT PRIMARY KEY,
        validation_value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const existing = db.prepare('SELECT validation_value FROM secure_storage_key_check WHERE id = ?').get('database-key-v1');
    if (!existing) {
      const hasExistingData = db.prepare(`
        SELECT EXISTS(SELECT 1 FROM users LIMIT 1)
          OR EXISTS(SELECT 1 FROM user_sync_kv LIMIT 1)
          OR EXISTS(SELECT 1 FROM refresh_tokens LIMIT 1) AS present
      `).get().present === 1;
      if (hasExistingData) fail('RIDGELINE_SECURE_STORAGE_MIGRATION_REQUIRED:secure_storage_key_check');
      initializeDatabaseKeyCheck(db);
      return;
    }
    const decrypted = storage.decryptText('audit', existing.validation_value, keyCheckAad);
    if (decrypted !== keyCheckPlaintext) fail('RIDGELINE_DATABASE_KEY_CHECK_INVALID');
  }

  return Object.freeze({
    configured: true,
    mode: 'private-beta',
    environment,
    keyFingerprint: storage.keyFingerprint,
    encode,
    decode,
    encodeJson(domain, userId, collection, recordId, fieldName, value) {
      return encode(domain, userId, collection, recordId, fieldName, JSON.stringify(value));
    },
    decodeJson(domain, userId, collection, recordId, fieldName, value) {
      return JSON.parse(decode(domain, userId, collection, recordId, fieldName, value));
    },
    encodeUserField(userId, fieldName, value) {
      const domain = PROFILE_FIELDS[fieldName] || AUTH_FIELDS[fieldName];
      if (!domain) fail('RIDGELINE_USER_FIELD_NOT_ALLOWLISTED');
      return encode(domain, userId, 'users', userId, fieldName, value);
    },
    decodeUserField(userId, fieldName, value) {
      const domain = PROFILE_FIELDS[fieldName] || AUTH_FIELDS[fieldName];
      if (!domain) fail('RIDGELINE_USER_FIELD_NOT_ALLOWLISTED');
      return decode(domain, userId, 'users', userId, fieldName, value);
    },
    emailIndex(value) {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) fail('RIDGELINE_EMAIL_INDEX_VALUE_INVALID');
      return storage.blindIndex(normalized, 'users.email');
    },
    blindIndex(value, context) {
      return storage.blindIndex(String(value), String(context));
    },
    isEncryptedRecord(value) { return storage.isEncryptedRecord(value); },
    createSecretStreamEncryptor(domain, streamAad) {
      return storage.createSecretStreamEncryptor(domain, streamAad);
    },
    createSecretStreamDecryptor(domain, header, streamAad) {
      return storage.createSecretStreamDecryptor(domain, header, streamAad);
    },
    assertEncryptedDatabase,
    initializeDatabaseKeyCheck,
    verifyDatabaseKeyCheck,
    destroy() { storage.destroy(); },
  });
}

export const SECURE_USER_FIELDS = Object.freeze({ ...AUTH_FIELDS, ...PROFILE_FIELDS });
