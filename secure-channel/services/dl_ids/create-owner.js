#!/usr/bin/env node
/**
 * create-owner.js — Promote a Darklock Secure Channel account to "owner".
 *
 * Usage:
 *   node create-owner.js                       # promote username "owner" (creates if missing)
 *   node create-owner.js <username>            # promote existing account by username
 *   node create-owner.js <username> <password> # create account + set owner (if not exists)
 *
 * The IDS service does NOT need to be running — this writes directly to the SQLite DB.
 *
 * Run from the dl_ids folder:
 *   cd "/home/cayden/discord bot/discord bot/secure-channel/services/dl_ids"
 *   node create-owner.js
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const DB_PATH = resolve(__dirname, 'data/ids.db');

const DEFAULT_USERNAME = 'owner';
const DEFAULT_PASSWORD = 'DarkLockOwner2026!';  // Change this after first login

const targetUsername = process.argv[2] ?? DEFAULT_USERNAME;
const suppliedPassword = process.argv[3] ?? DEFAULT_PASSWORD;

// ── Open DB ───────────────────────────────────────────────────────────────────

console.log(`\n🔐 Darklock Secure Channel — Owner Account Setup`);
console.log(`   DB path : ${DB_PATH}`);
console.log(`   Username: ${targetUsername}\n`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Ensure system_role column exists (safe — added by IDS on boot normally) ──

try {
  db.exec(`ALTER TABLE users ADD COLUMN system_role TEXT`);
  console.log('✅ Added system_role column to users table');
} catch {
  // Column already exists — fine
}

// ── Check if user exists ──────────────────────────────────────────────────────

let user = db.prepare('SELECT id, username, system_role FROM users WHERE username = ?').get(targetUsername);

if (!user) {
  console.log(`ℹ  User "${targetUsername}" not found — creating account...`);

  const userId      = uuidv4();
  const email       = `${targetUsername}@darklock.local`;
  const passwordHash = await bcrypt.hash(suppliedPassword, 12);

  // Generate a placeholder identity keypair (Ed25519 via Node crypto).
  // The user will need to register/re-key from the Tauri app to set their
  // real device key.  This placeholder lets the row exist with valid format.
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const identityPubKey = publicKey.export({ type: 'spki', format: 'der' });
  const identityPubKeyB64 = identityPubKey.toString('base64');

  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, identity_pubkey, system_role)
     VALUES (?, ?, ?, ?, ?, 'owner')`
  ).run(userId, targetUsername, email, passwordHash, identityPubKeyB64);

  console.log(`✅ Created owner account:`);
  console.log(`   User ID : ${userId}`);
  console.log(`   Username: ${targetUsername}`);
  console.log(`   Email   : ${email}`);
  console.log(`   Password: ${suppliedPassword}`);
  console.log(`\n   ⚠️  Register this username in the Tauri app to enroll your device key.`);
  console.log(`   The placeholder key will be overwritten on first device enrolment.\n`);

} else if (user.system_role === 'owner') {
  console.log(`✅ Account "${targetUsername}" is already marked as owner. Nothing to do.\n`);
  process.exit(0);

} else {
  // Existing account — promote it AND reset password
  const newHash = await bcrypt.hash(suppliedPassword, 12);
  db.prepare(`UPDATE users SET password_hash = ?, system_role = 'owner', updated_at = datetime('now') WHERE username = ?`)
    .run(newHash, targetUsername);

  console.log(`✅ Promoted "${targetUsername}" to owner and reset password.`);
  console.log(`   User ID : ${user.id}`);
  console.log(`   Password: ${suppliedPassword}\n`);
}

// ── Verify ────────────────────────────────────────────────────────────────────

const check = db.prepare('SELECT id, username, system_role FROM users WHERE username = ?').get(targetUsername);
console.log(`✔  Final state: username="${check.username}"  system_role="${check.system_role}"`);
console.log(`\nDone! Restart IDS (node src/server.js) for changes to take effect.\n`);

db.close();
