import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import { initDatabase } from '../src/db.js';
import { createIdsSecureFields } from '../src/security/secure-fields.js';

const SERVICE_DIR = path.resolve(import.meta.dirname, '..');

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port, child) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`ids_exited_${child.exitCode}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('ids_health_timeout');
}

async function login(port, email, password) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return response.status;
}

function passwordHash(databasePath, userId) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId).password_hash;
  } finally {
    db.close();
  }
}

test('successful bcrypt login upgrades atomically to Argon2id and wrong passwords do not migrate', { timeout: 15000 }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ridgeline-password-migration-'));
  const keyPath = path.join(root, 'server-master-key');
  const databasePath = path.join(root, 'ids.db');
  const userId = `bcrypt-${randomUUID().slice(0, 12)}`;
  const email = `${userId}@example.test`;
  const password = `Password-${randomUUID()}`;
  const bcryptHash = await bcrypt.hash(password, 4);
  const port = await freePort();
  const jwtSecret = randomBytes(32).toString('hex');
  writeFileSync(keyPath, randomBytes(32));
  if (process.platform !== 'win32') chmodSync(keyPath, 0o600);

  const secureEnv = {
    NODE_ENV: 'test',
    RIDGELINE_ENVIRONMENT: 'test',
    RIDGELINE_SECURE_STORAGE_MODE: 'private-beta',
    RIDGELINE_MASTER_KEY_FILE: keyPath,
  };
  const fields = await createIdsSecureFields(secureEnv);
  const seedDb = initDatabase(databasePath);
  if (process.platform !== 'win32') chmodSync(databasePath, 0o600);
  try {
    seedDb.prepare(`
      INSERT INTO users (id, username, email, email_blind_index, password_hash, identity_pubkey, display_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      userId,
      fields.encodeUserField(userId, 'email', email),
      fields.emailIndex(email),
      bcryptHash,
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      fields.encodeUserField(userId, 'display_name', 'Bcrypt Test'),
    );
    fields.initializeDatabaseKeyCheck(seedDb);
  } finally {
    seedDb.close();
    fields.destroy();
  }

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      ...secureEnv,
      IDS_PORT: String(port),
      IDS_DB_PATH: databasePath,
      IDS_JWT_SECRET: jwtSecret,
      JWT_SECRET: jwtSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForHealth(port, child);
    assert.equal(await login(port, email, 'definitely-wrong'), 401);
    assert.equal(passwordHash(databasePath, userId), bcryptHash);
    assert.equal(await login(port, email, password), 200);
    assert.match(passwordHash(databasePath, userId), /^\$argon2id\$/);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolve) => child.exitCode === null ? child.once('exit', resolve) : resolve());
    rmSync(root, { recursive: true, force: true });
  }
});
