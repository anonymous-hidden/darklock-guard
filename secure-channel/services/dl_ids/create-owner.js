#!/usr/bin/env node
/** Promote an existing IDS account, or explicitly create one, as owner. */
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, 'data/ids.db');
const targetUsername = String(process.argv[2] ?? '').trim();
const createMissing = process.argv.includes('--create');
const suppliedPassword = String(process.env.RIDGELINE_OWNER_PASSWORD ?? '');
const suppliedEmail = String(process.env.RIDGELINE_OWNER_EMAIL ?? '').trim().toLowerCase();

function fail(code) {
  console.error(`[IDS_OWNER_SETUP_FAILED] ${code}`);
  process.exit(1);
}

if (!/^[a-z0-9._-]{3,30}$/i.test(targetUsername)) fail('username_required');
if (process.argv.length > 3 && process.argv.some((arg, index) => index > 2 && arg !== '--create')) {
  fail('password_must_use_environment');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

try {
  try {
    db.exec('ALTER TABLE users ADD COLUMN system_role TEXT');
  } catch {
    // Column already exists.
  }

  const user = db.prepare(
    'SELECT id, username, system_role FROM users WHERE username = ? LIMIT 1'
  ).get(targetUsername);

  if (user) {
    if (user.system_role !== 'owner') {
      db.prepare("UPDATE users SET system_role = 'owner', updated_at = datetime('now') WHERE id = ?")
        .run(user.id);
    }
    console.log('[IDS_OWNER_PROMOTED]');
    process.exitCode = 0;
  } else {
    if (!createMissing) fail('account_not_found_use_create');
    if (suppliedPassword.length < 16) fail('RIDGELINE_OWNER_PASSWORD_minimum_16');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(suppliedEmail)) {
      fail('RIDGELINE_OWNER_EMAIL_required');
    }

    const passwordHash = await bcrypt.hash(suppliedPassword, 12);
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const identityPubKey = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, identity_pubkey, system_role)
      VALUES (?, ?, ?, ?, ?, 'owner')
    `).run(uuidv4(), targetUsername, suppliedEmail, passwordHash, identityPubKey);
    console.log('[IDS_OWNER_CREATED]');
  }
} finally {
  db.close();
}
