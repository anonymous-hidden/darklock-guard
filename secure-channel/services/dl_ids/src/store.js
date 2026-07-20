/* ──────────────────────────────────────────────────────────
 *  IDS Store — SQLite storage for pre-key bundles + auth
 *  Legacy, currently unused store implementation. It contains account and
 *  routing records and must not be described as zero knowledge.
 *  Auth: passwords hashed with scrypt (per-user salt).
 *  Values are not uniformly encrypted at rest; production uses db.js.
 * ────────────────────────────────────────────────────────── */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// scrypt parameters — OWASP 2024+ recommended
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 2 ** 16;   // N=65536 (DARK-015: increased from 2^15)
const SCRYPT_BLOCK = 8;        // r
const SCRYPT_PARALLEL = 1;     // p
const SALT_BYTES = 32;
const SESSION_BYTES = 32;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// maxmem must be >= 128 * N * r bytes = 128 * 65536 * 8 = 67MB; use 128MB headroom
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const TOTP_STEP = 30; // seconds
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // allow ±1 step

// DARK-016: Track used TOTP codes to prevent replay within window
const usedTotpCodes = new Map(); // userId -> Set<string>
const TOTP_CODE_EXPIRY_MS = 3 * TOTP_STEP * 1000; // 90 seconds

/** Hash a password with a fresh random salt.
 *  Format: "N:salt_hex:derived_hex" — N is stored so future param changes stay backward compatible.
 */
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_BYTES);
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_COST, r: SCRYPT_BLOCK, p: SCRYPT_PARALLEL, maxmem: SCRYPT_MAXMEM,
    }, (err, derived) => {
      if (err) return reject(err);
      // Store as:  N:salt_hex:derived_hex
      resolve(`${SCRYPT_COST}:${salt.toString('hex')}:${derived.toString('hex')}`);
    });
  });
}

/** Verify a password against a stored hash.
 *  Supports legacy 2-part hashes (salt:derived, N=32768) and new 3-part (N:salt:derived).
 *  Returns { valid, needsRehash } so caller can upgrade legacy hashes transparently.
 */
function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const parts = stored.split(':');
    let N, saltHex, hashHex, needsRehash;
    if (parts.length === 2) {
      // Legacy hash — was created with N=32768 before DARK-015
      N = 2 ** 15;
      [saltHex, hashHex] = parts;
      needsRehash = true;
    } else {
      N = parseInt(parts[0], 10);
      saltHex = parts[1];
      hashHex = parts[2];
      needsRehash = (N !== SCRYPT_COST);
    }
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    // maxmem must accommodate whichever N we're using
    const maxmem = Math.max(SCRYPT_MAXMEM, 128 * N * SCRYPT_BLOCK + 1024 * 1024);
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, {
      N, r: SCRYPT_BLOCK, p: SCRYPT_PARALLEL, maxmem,
    }, (err, derived) => {
      if (err) return reject(err);
      const valid = derived.length === expected.length &&
        crypto.timingSafeEqual(derived, expected);
      resolve({ valid, needsRehash: valid && needsRehash });
    });
  });
}

/** Generate a cryptographically random session token */
function generateSessionToken() {
  return crypto.randomBytes(SESSION_BYTES).toString('hex');
}

/* ── TOTP helpers (RFC 6238) ─────────────────────────────── */

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    result += BASE32_CHARS[parseInt(chunk, 2)];
  }
  return result;
}

function base32Decode(str) {
  let bits = '';
  for (const c of str.toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(c);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function computeTotp(secretBase32, timeStep) {
  const secretBuf = base32Decode(secretBase32);
  const timeBuf = Buffer.alloc(8);
  timeBuf.writeUInt32BE(Math.floor(timeStep / 0x100000000), 0);
  timeBuf.writeUInt32BE(timeStep & 0xffffffff, 4);
  const hmac = crypto.createHmac('sha1', secretBuf).update(timeBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % (10 ** TOTP_DIGITS);
  return code.toString().padStart(TOTP_DIGITS, '0');
}

function verifyTotp(secretBase32, token, userId) {
  const now = Math.floor(Date.now() / 1000 / TOTP_STEP);
  for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
    if (computeTotp(secretBase32, now + i) === token) {
      // DARK-016: Prevent TOTP code replay within the time window
      if (userId) {
        const codeKey = `${token}:${now + i}`;
        if (!usedTotpCodes.has(userId)) usedTotpCodes.set(userId, new Set());
        const used = usedTotpCodes.get(userId);
        if (used.has(codeKey)) return false; // Code already used
        used.add(codeKey);
        // Clean up old codes after expiry
        setTimeout(() => { used.delete(codeKey); if (used.size === 0) usedTotpCodes.delete(userId); }, TOTP_CODE_EXPIRY_MS);
      }
      return true;
    }
  }
  return false;
}

function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  return codes;
}

export function createStore(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, '..', 'data', 'ids.db');

  // Ensure data directory exists (sync — must happen before DB open)
  const dir = path.dirname(resolvedPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = ON');
  // Checkpoint to main DB every 64 WAL pages (~256 KB) instead of the default 1000.
  // Prevents large uncheckpointed WAL files that can lose committed data on crash.
  db.pragma('wal_autocheckpoint = 64');
  // Force a full WAL checkpoint on startup to ensure any un-checkpointed committed
  // data from the previous run is flushed to the main DB file before we proceed.
  db.pragma('wal_checkpoint(TRUNCATE)');

  // ── Schema ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      identity_key TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS signed_prekeys (
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      key_id INTEGER NOT NULL,
      public_key TEXT NOT NULL,
      signature TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key_id)
    );

    CREATE TABLE IF NOT EXISTS one_time_prekeys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      key_id INTEGER NOT NULL,
      public_key TEXT NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, key_id)
    );

    CREATE INDEX IF NOT EXISTS idx_otpk_user ON one_time_prekeys(user_id, consumed);

    -- Auth: user credentials (password hash — NEVER cleartext)
    CREATE TABLE IF NOT EXISTS auth_users (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Auth: sessions (time-limited tokens)
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      expires_at INTEGER NOT NULL,
      device_info TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    -- Account lockout: track failed login attempts (HIGH-4)
    CREATE TABLE IF NOT EXISTS login_attempts (
      user_id TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Friend requests
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
      to_user TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(from_user, to_user)
    );

    CREATE INDEX IF NOT EXISTS idx_fr_to ON friend_requests(to_user, status);
    CREATE INDEX IF NOT EXISTS idx_fr_from ON friend_requests(from_user, status);
  `);

  // ── 2FA schema migration (add columns if missing) ───────
  try {
    db.exec(`ALTER TABLE auth_users ADD COLUMN totp_secret TEXT DEFAULT NULL`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE auth_users ADD COLUMN totp_enabled INTEGER DEFAULT 0`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE auth_users ADD COLUMN backup_codes TEXT DEFAULT NULL`);
  } catch { /* column already exists */ }
  // device_info migration
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN device_info TEXT`);
  } catch { /* column already exists */ }
  // Pending 2FA tokens — short-lived, replaced by real session after code entry
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_2fa (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      expires_at INTEGER NOT NULL
    );
  `);

  // ── Cross-device sync: user data key-value store ────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_data (
      user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
      data_key TEXT NOT NULL,
      data_value TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (user_id, data_key)
    );
  `);

  // ── Prepared statements ─────────────────────────────────
  const stmts = {
    upsertUser: db.prepare(`
      INSERT INTO users (user_id, identity_key) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET identity_key = excluded.identity_key
    `),
    upsertSPK: db.prepare(`
      INSERT INTO signed_prekeys (user_id, key_id, public_key, signature, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, key_id) DO UPDATE SET
        public_key = excluded.public_key,
        signature = excluded.signature,
        created_at = excluded.created_at
    `),
    insertOTPK: db.prepare(`
      INSERT OR IGNORE INTO one_time_prekeys (user_id, key_id, public_key) VALUES (?, ?, ?)
    `),
    getUser: db.prepare(`SELECT * FROM users WHERE user_id = ?`),
    getLatestSPK: db.prepare(`
      SELECT * FROM signed_prekeys WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
    `),
    consumeOTPK: db.prepare(`
      UPDATE one_time_prekeys SET consumed = 1
      WHERE id = (
        SELECT id FROM one_time_prekeys
        WHERE user_id = ? AND consumed = 0
        ORDER BY key_id ASC LIMIT 1
      )
      RETURNING *
    `),
    countOTPK: db.prepare(`
      SELECT COUNT(*) as count FROM one_time_prekeys WHERE user_id = ? AND consumed = 0
    `),
    deleteUser: db.prepare(`DELETE FROM users WHERE user_id = ?`),
    deleteSPKs: db.prepare(`DELETE FROM signed_prekeys WHERE user_id = ?`),
    deleteOTPKs: db.prepare(`DELETE FROM one_time_prekeys WHERE user_id = ?`),

    // ── Auth statements ─────────────────────────────────
    insertAuthUser: db.prepare(`
      INSERT INTO auth_users (user_id, display_name, password_hash) VALUES (?, ?, ?)
    `),
    getAuthUser: db.prepare(`SELECT * FROM auth_users WHERE user_id = ?`),
    deleteAuthUser: db.prepare(`DELETE FROM auth_users WHERE user_id = ?`),
    updatePasswordHash: db.prepare(`UPDATE auth_users SET password_hash = ? WHERE user_id = ?`),
    insertSession: db.prepare(`
      INSERT INTO sessions (token, user_id, expires_at, device_info) VALUES (?, ?, ?, ?)
    `),
    getSession: db.prepare(`
      SELECT * FROM sessions WHERE token = ? AND expires_at > ?
    `),
    getUserSessions: db.prepare(`
      SELECT token, created_at, expires_at, device_info FROM sessions WHERE user_id = ? AND expires_at > ?
    `),
    deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
    deleteExpiredSessions: db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`),
    deleteUserSessions: db.prepare(`DELETE FROM sessions WHERE user_id = ?`),
    searchAuthUsers: db.prepare(`
      SELECT user_id, display_name FROM auth_users
      WHERE user_id LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\'
      LIMIT 20
    `),

    // ── Account lockout statements (HIGH-4) ─────────
    getLoginAttempts: db.prepare(`SELECT * FROM login_attempts WHERE user_id = ?`),
    upsertLoginAttempt: db.prepare(`
      INSERT INTO login_attempts (user_id, attempts, locked_until, updated_at)
      VALUES (?, 1, 0, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        attempts = login_attempts.attempts + 1,
        locked_until = CASE WHEN login_attempts.attempts + 1 >= 10
          THEN ? ELSE login_attempts.locked_until END,
        updated_at = ?
    `),
    clearLoginAttempts: db.prepare(`DELETE FROM login_attempts WHERE user_id = ?`),

    // ── Friend request statements ───────────────────
    insertFriendRequest: db.prepare(`
      INSERT OR IGNORE INTO friend_requests (from_user, to_user) VALUES (?, ?)
    `),
    getFriendRequest: db.prepare(`
      SELECT * FROM friend_requests WHERE from_user = ? AND to_user = ?
    `),
    getFriendRequestById: db.prepare(`
      SELECT * FROM friend_requests WHERE id = ?
    `),
    getIncomingRequests: db.prepare(`
      SELECT fr.id, fr.from_user, fr.created_at, au.display_name
      FROM friend_requests fr
      JOIN auth_users au ON au.user_id = fr.from_user
      WHERE fr.to_user = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `),
    getOutgoingRequests: db.prepare(`
      SELECT fr.id, fr.to_user, fr.status, fr.created_at, au.display_name
      FROM friend_requests fr
      JOIN auth_users au ON au.user_id = fr.to_user
      WHERE fr.from_user = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `),
    acceptFriendRequest: db.prepare(`
      UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ? AND to_user = ? AND status = 'pending'
    `),
    rejectFriendRequest: db.prepare(`
      UPDATE friend_requests SET status = 'rejected', updated_at = ? WHERE id = ? AND to_user = ? AND status = 'pending'
    `),
    getFriends: db.prepare(`
      SELECT au.user_id, au.display_name FROM auth_users au
      WHERE au.user_id IN (
        SELECT from_user FROM friend_requests WHERE to_user = ? AND status = 'accepted'
        UNION
        SELECT to_user FROM friend_requests WHERE from_user = ? AND status = 'accepted'
      )
    `),
    areFriends: db.prepare(`
      SELECT 1 FROM friend_requests
      WHERE status = 'accepted'
        AND ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?))
      LIMIT 1
    `),

    // ── 2FA statements ──────────────────────────
    setTotpSecret: db.prepare(`
      UPDATE auth_users SET totp_secret = ?, backup_codes = ? WHERE user_id = ?
    `),
    enableTotp: db.prepare(`
      UPDATE auth_users SET totp_enabled = 1 WHERE user_id = ?
    `),
    disableTotp: db.prepare(`
      UPDATE auth_users SET totp_enabled = 0, totp_secret = NULL, backup_codes = NULL WHERE user_id = ?
    `),
    insertPending2fa: db.prepare(`
      INSERT INTO pending_2fa (token, user_id, expires_at) VALUES (?, ?, ?)
    `),
    getPending2fa: db.prepare(`
      SELECT * FROM pending_2fa WHERE token = ? AND expires_at > ?
    `),
    deletePending2fa: db.prepare(`
      DELETE FROM pending_2fa WHERE token = ?
    `),
    deleteExpiredPending2fa: db.prepare(`
      DELETE FROM pending_2fa WHERE expires_at <= ?
    `),

    // ── User data (cross-device sync) statements ────
    getAllUserData: db.prepare(`
      SELECT data_key, data_value, updated_at FROM user_data WHERE user_id = ?
    `),
    getUserDataByKey: db.prepare(`
      SELECT data_value, updated_at FROM user_data WHERE user_id = ? AND data_key = ?
    `),
    upsertUserData: db.prepare(`
      INSERT INTO user_data (user_id, data_key, data_value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, data_key) DO UPDATE SET
        data_value = excluded.data_value,
        updated_at = excluded.updated_at
    `),
    deleteUserData: db.prepare(`
      DELETE FROM user_data WHERE user_id = ? AND data_key = ?
    `),
  };

  // Purge expired sessions on startup
  stmts.deleteExpiredSessions.run(Date.now());

  // Migration: add device_info column to sessions if missing
  try {
    db.prepare(`SELECT device_info FROM sessions LIMIT 1`).get();
  } catch {
    db.prepare(`ALTER TABLE sessions ADD COLUMN device_info TEXT`).run();
  }

  // Periodic VACUUM to reclaim space and remove forensic traces (MED-4)
  setInterval(() => {
    try {
      stmts.deleteExpiredSessions.run(Date.now());
      db.exec('VACUUM');
    } catch { /* silent */ }
  }, 6 * 60 * 60 * 1000); // every 6 hours

  return {
    registerUser(userId, identityKey, signedPreKey, oneTimePreKeys) {
      const tx = db.transaction(() => {
        stmts.upsertUser.run(userId, identityKey);
        // Clear stale SPKs/OTPKs so getLatestSPK always returns the bundle
        // consistently paired with the current identity key. Without this,
        // a re-registration with a new identity key leaves old SPK rows whose
        // signatures were made with the previous identity key, causing X3DH
        // signature verification to fail on the sender side.
        stmts.deleteSPKs.run(userId);
        stmts.deleteOTPKs.run(userId);
        stmts.upsertSPK.run(
          userId,
          signedPreKey.keyId,
          signedPreKey.publicKey,
          signedPreKey.signature,
          signedPreKey.createdAt || Date.now(),
        );
        for (const opk of oneTimePreKeys) {
          stmts.insertOTPK.run(userId, opk.keyId, opk.publicKey);
        }
      });
      tx();
    },

    getPreKeyBundle(userId) {
      const user = stmts.getUser.get(userId);
      if (!user) return null;

      const spk = stmts.getLatestSPK.get(userId);
      if (!spk) return null;

      // Consume one OTP key (single-use)
      const otpk = stmts.consumeOTPK.get(userId);

      const bundle = {
        identityKey: user.identity_key,
        signedPreKey: {
          keyId: spk.key_id,
          publicKey: spk.public_key,
          signature: spk.signature,
          createdAt: spk.created_at,
        },
        oneTimePreKeys: [],
      };

      if (otpk) {
        bundle.oneTimePreKeys.push({
          keyId: otpk.key_id,
          publicKey: otpk.public_key,
        });
      }

      return bundle;
    },

    addOneTimePreKeys(userId, keys) {
      const tx = db.transaction(() => {
        for (const opk of keys) {
          stmts.insertOTPK.run(userId, opk.keyId, opk.publicKey);
        }
      });
      tx();
    },

    getOneTimeKeyCount(userId) {
      const row = stmts.countOTPK.get(userId);
      return row ? row.count : 0;
    },

    updateSignedPreKey(userId, signedPreKey) {
      stmts.upsertSPK.run(
        userId,
        signedPreKey.keyId,
        signedPreKey.publicKey,
        signedPreKey.signature,
        signedPreKey.createdAt || Date.now(),
      );
    },

    removeUser(userId) {
      stmts.deleteUser.run(userId);
    },

    // ── Auth methods ────────────────────────────────────

    /** Register a new auth user. Password is scrypt-hashed, NEVER stored in cleartext. */
    async createAuthUser(userId, displayName, password) {
      // Check if already exists
      const existing = stmts.getAuthUser.get(userId);
      if (existing) throw new Error('user_exists');

      const hash = await hashPassword(password);
      stmts.insertAuthUser.run(userId, displayName, hash);
    },

    /** Verify credentials. Returns { userId, displayName, token } or { requires2fa, pendingToken } or null. */
    async authenticateUser(userId, password, deviceInfo) {
      const user = stmts.getAuthUser.get(userId);
      if (!user) return null;

      const { valid, needsRehash } = await verifyPassword(password, user.password_hash);
      if (!valid) return null;

      // Transparently upgrade legacy scrypt hashes (N=32768 → N=65536)
      if (needsRehash) {
        try {
          const newHash = await hashPassword(password);
          stmts.updatePasswordHash.run(newHash, userId);
        } catch { /* non-fatal — user can still log in */ }
      }

      // If 2FA is enabled, return a pending token instead of a full session
      if (user.totp_enabled) {
        const pendingToken = generateSessionToken();
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes to enter code
        stmts.insertPending2fa.run(pendingToken, userId, expiresAt);
        return {
          requires2fa: true,
          pendingToken,
          userId: user.user_id,
          displayName: user.display_name,
        };
      }

      // Create session
      const token = generateSessionToken();
      const expiresAt = Date.now() + SESSION_TTL_MS;
      stmts.insertSession.run(token, userId, expiresAt, deviceInfo || null);

      return {
        userId: user.user_id,
        displayName: user.display_name,
        token,
        expiresAt,
      };
    },

    /** Validate a session token. Returns user info or null. */
    validateSession(token) {
      const session = stmts.getSession.get(token, Date.now());
      if (!session) return null;
      const user = stmts.getAuthUser.get(session.user_id);
      if (!user) return null;
      return { userId: user.user_id, displayName: user.display_name };
    },

    /** Revoke a session (logout). */
    revokeSession(token) {
      stmts.deleteSession.run(token);
    },

    /** List active sessions for a user (for device management). */
    getUserSessions(userId) {
      return stmts.getUserSessions.all(userId, Date.now());
    },

    /** Revoke a specific session by token (for remote logout). */
    revokeSessionByToken(token) {
      stmts.deleteSession.run(token);
    },

    /** Check if an auth user exists (for login validation). */
    authUserExists(userId) {
      return !!stmts.getAuthUser.get(userId);
    },

    /** Search users by username or display name prefix. */
    searchUsers(query) {
      // Escape LIKE wildcards (LOW-5)
      const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const like = `%${escaped}%`;
      return stmts.searchAuthUsers.all(like, like).map(row => ({
        userId: row.user_id,
        displayName: row.display_name,
      }));
    },

    // ── Account lockout methods (HIGH-4) ────────────

    /** Check if account is locked due to too many failed attempts. */
    isAccountLocked(userId) {
      const row = stmts.getLoginAttempts.get(userId);
      if (!row) return false;
      if (row.locked_until > Date.now()) return true;
      // Lock expired — clear it
      if (row.locked_until > 0) stmts.clearLoginAttempts.run(userId);
      return false;
    },

    /** Record a failed login attempt. Lock after 10 failures for 15 minutes. */
    recordFailedLogin(userId) {
      const lockUntil = Date.now() + 15 * 60 * 1000; // 15 min lockout
      stmts.upsertLoginAttempt.run(userId, Date.now(), lockUntil, Date.now());
    },

    /** Clear failed login attempts on successful login. */
    clearFailedLogins(userId) {
      stmts.clearLoginAttempts.run(userId);
    },

    // ── Friend request methods ──────────────────────

    sendFriendRequest(fromUser, toUser) {
      // Check reverse request exists and is pending → auto-accept
      const reverse = stmts.getFriendRequest.get(toUser, fromUser);
      if (reverse && reverse.status === 'accepted') return { status: 'already_friends' };
      if (reverse && reverse.status === 'pending') {
        stmts.acceptFriendRequest.run(Date.now(), reverse.id, fromUser);
        return { status: 'accepted', requestId: reverse.id };
      }
      // Check if already sent
      const existing = stmts.getFriendRequest.get(fromUser, toUser);
      if (existing && existing.status === 'pending') return { status: 'already_sent' };
      if (existing && existing.status === 'accepted') return { status: 'already_friends' };
      stmts.insertFriendRequest.run(fromUser, toUser);
      const row = stmts.getFriendRequest.get(fromUser, toUser);
      return { status: 'sent', requestId: row.id };
    },

    getIncomingRequests(userId) {
      return stmts.getIncomingRequests.all(userId).map(r => ({
        id: r.id, fromUser: r.from_user, displayName: r.display_name, createdAt: r.created_at,
      }));
    },

    getOutgoingRequests(userId) {
      return stmts.getOutgoingRequests.all(userId).map(r => ({
        id: r.id, toUser: r.to_user, displayName: r.display_name, status: r.status, createdAt: r.created_at,
      }));
    },

    acceptFriendRequest(requestId, userId) {
      const info = stmts.acceptFriendRequest.run(Date.now(), requestId, userId);
      if (info.changes === 0) return null;
      const req = stmts.getFriendRequestById.get(requestId);
      return req ? { fromUser: req.from_user, toUser: req.to_user } : null;
    },

    rejectFriendRequest(requestId, userId) {
      const info = stmts.rejectFriendRequest.run(Date.now(), requestId, userId);
      return info.changes > 0;
    },

    getFriends(userId) {
      return stmts.getFriends.all(userId, userId).map(r => ({
        userId: r.user_id, displayName: r.display_name,
      }));
    },

    areFriends(a, b) {
      return !!stmts.areFriends.get(a, b, b, a);
    },

    // ── 2FA methods ─────────────────────────────────────

    /** Generate a new TOTP secret for setup (not yet enabled). */
    setup2fa(userId) {
      const user = stmts.getAuthUser.get(userId);
      if (!user) return null;
      const secret = generateTotpSecret();
      const backupCodes = generateBackupCodes();
      stmts.setTotpSecret.run(secret, JSON.stringify(backupCodes), userId);
      const otpauthUri = `otpauth://totp/Darklock:${encodeURIComponent(userId)}?secret=${secret}&issuer=Darklock&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP}`;
      return { secret, otpauthUri, backupCodes };
    },

    /** Confirm 2FA setup by verifying a code. */
    confirm2fa(userId, code) {
      const user = stmts.getAuthUser.get(userId);
      if (!user || !user.totp_secret) return false;
      if (!verifyTotp(user.totp_secret, code, userId)) return false;
      stmts.enableTotp.run(userId);
      return true;
    },

    /** Disable 2FA for a user. */
    disable2fa(userId) {
      stmts.disableTotp.run(userId);
    },

    /** Check if 2FA is enabled. */
    is2faEnabled(userId) {
      const user = stmts.getAuthUser.get(userId);
      return !!user?.totp_enabled;
    },

    /** Verify TOTP code against a pending 2FA token. Returns session or null. */
    verify2fa(pendingToken, code, deviceInfo) {
      stmts.deleteExpiredPending2fa.run(Date.now());
      const pending = stmts.getPending2fa.get(pendingToken, Date.now());
      if (!pending) return null;

      const user = stmts.getAuthUser.get(pending.user_id);
      if (!user || !user.totp_secret) return null;

      // Try TOTP code first
      let valid = verifyTotp(user.totp_secret, code, pending.user_id);

      // Try backup codes if TOTP fails
      if (!valid && user.backup_codes) {
        try {
          const codes = JSON.parse(user.backup_codes);
          const upper = code.toUpperCase();
          const idx = codes.indexOf(upper);
          if (idx !== -1) {
            valid = true;
            codes.splice(idx, 1);
            stmts.setTotpSecret.run(user.totp_secret, JSON.stringify(codes), pending.user_id);
          }
        } catch { /* malformed backup codes */ }
      }

      if (!valid) return null;

      // Consume pending token
      stmts.deletePending2fa.run(pendingToken);

      // Create real session
      const token = generateSessionToken();
      const expiresAt = Date.now() + SESSION_TTL_MS;
      stmts.insertSession.run(token, pending.user_id, expiresAt, deviceInfo || null);

      return {
        userId: user.user_id,
        displayName: user.display_name,
        token,
        expiresAt,
      };
    },

    // ── Cross-device sync methods ───────────────────────

    /** Get all synced data for a user. Returns { key: { value, updatedAt } } */
    getAllUserData(userId) {
      const rows = stmts.getAllUserData.all(userId);
      const result = {};
      for (const row of rows) {
        result[row.data_key] = {
          value: JSON.parse(row.data_value),
          updatedAt: row.updated_at,
        };
      }
      return result;
    },

    /** Get a single data key for a user. Returns { value, updatedAt } or null. */
    getUserDataByKey(userId, key) {
      const row = stmts.getUserDataByKey.get(userId, key);
      if (!row) return null;
      return { value: JSON.parse(row.data_value), updatedAt: row.updated_at };
    },

    /** Set a data key for a user. Value is any JSON-serializable object. */
    setUserData(userId, key, value) {
      const json = JSON.stringify(value);
      // Limit value size to 512KB to prevent abuse
      if (json.length > 5 * 1024 * 1024) throw new Error('data_too_large');
      stmts.upsertUserData.run(userId, key, json, Date.now());
    },

    /** Bulk set multiple data keys in a single transaction. */
    setUserDataBulk(userId, entries) {
      const tx = db.transaction(() => {
        for (const [key, value] of Object.entries(entries)) {
          const json = JSON.stringify(value);
          if (json.length > 5 * 1024 * 1024) continue; // skip oversized entries
          stmts.upsertUserData.run(userId, key, json, Date.now());
        }
      });
      tx();
    },

    close() {
      db.close();
    },
  };
}
