import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initDatabase } from '../src/db.js';

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
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('ids_health_timeout');
}

async function request(port, method, endpoint, body, token) {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test('private-beta IDS routes store auth, profile, TOTP enrollment, and sync values as ciphertext', { timeout: 20000 }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ridgeline-secure-routes-'));
  const keyPath = path.join(root, 'server-master-key');
  const databasePath = path.join(root, 'ids.db');
  const port = await freePort();
  const jwtSecret = randomBytes(32).toString('hex');
  const userId = `secure-${randomUUID().slice(0, 12)}`;
  const password = `Password-${randomUUID()}`;
  const bio = `bio-${randomUUID()}`;
  const status = `status-${randomUUID()}`;
  const setting = `setting-${randomUUID()}`;
  const email = `${userId}@example.test`;
  const displayName = `Display ${userId}`;
  writeFileSync(keyPath, randomBytes(32));
  if (process.platform !== 'win32') chmodSync(keyPath, 0o600);

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      RIDGELINE_ENVIRONMENT: 'test',
      RIDGELINE_SECURE_STORAGE_MODE: 'private-beta',
      RIDGELINE_MASTER_KEY_FILE: keyPath,
      IDS_PORT: String(port),
      IDS_DB_PATH: databasePath,
      IDS_JWT_SECRET: jwtSecret,
      JWT_SECRET: jwtSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logChunks = [];
  child.stdout.on('data', (chunk) => logChunks.push(String(chunk)));
  child.stderr.on('data', (chunk) => logChunks.push(String(chunk)));

  try {
    await waitForHealth(port, child);
    const capabilities = await request(port, 'GET', '/v1/security/capabilities');
    assert.equal(capabilities.body.encryptedSyncSupported, true);
    assert.equal(capabilities.body.totpEnvelopeEncryptionSupported, true);
    assert.equal(capabilities.body.serverDataEncryptedAtRestSupported, false);
    const registration = await request(port, 'POST', '/v1/auth/register', {
      userId,
      email,
      password,
      displayName,
    });
    assert.equal(registration.status, 201);

    const login = await request(port, 'POST', '/v1/auth/login', { email, password });
    assert.equal(login.status, 200);
    const token = login.body.access_token;
    assert.equal(typeof token, 'string');

    const profileWrite = await request(port, 'PUT', '/users/me/profile', {
      profile_bio: bio,
      pronouns: 'they/them',
      custom_status: status,
      profile_color: '#16a34a',
      avatar: null,
      banner: null,
    }, token);
    assert.equal(profileWrite.status, 200);
    const profileRead = await request(port, 'GET', `/users/${userId}/profile`, undefined, token);
    assert.equal(profileRead.body.profile_bio, bio);
    assert.equal(profileRead.body.custom_status, status);

    const syncWrite = await request(port, 'PUT', `/v1/sync/${userId}`, {
      key: 'privacy-setting',
      value: { sentinel: setting },
    }, token);
    assert.equal(syncWrite.status, 200);
    const syncRead = await request(port, 'GET', `/v1/sync/${userId}`, undefined, token);
    assert.equal(syncRead.body.data['privacy-setting'].value.sentinel, setting);

    const twoFactor = await request(port, 'POST', '/v1/auth/2fa/setup', {}, token);
    assert.equal(twoFactor.status, 200);
    assert.equal(typeof twoFactor.body.secret, 'string');

    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    const databaseFiles = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
      .filter((file) => {
        try { readFileSync(file); return true; } catch { return false; }
      })
      .map((file) => ({ file, bytes: readFileSync(file) }));
    for (const sentinel of [email, password, displayName, bio, 'they/them', status, setting, twoFactor.body.secret]) {
      for (const { file, bytes } of databaseFiles) {
        assert.equal(bytes.includes(Buffer.from(sentinel, 'utf8')), false, `${sentinel} leaked in ${file}`);
      }
      assert.equal(logChunks.join('').includes(sentinel), false, `${sentinel} leaked in IDS logs`);
    }
    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      assert.match(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId).password_hash, /^\$argon2id\$/);
    } finally {
      db.close();
    }
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
});

test('private-beta IDS startup rejects an unmigrated plaintext database', { timeout: 10000 }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ridgeline-plaintext-startup-'));
  const keyPath = path.join(root, 'server-master-key');
  const databasePath = path.join(root, 'ids.db');
  const port = await freePort();
  writeFileSync(keyPath, randomBytes(32));
  if (process.platform !== 'win32') chmodSync(keyPath, 0o600);
  const db = initDatabase(databasePath);
  try {
    db.prepare('INSERT INTO users (id, username, email, password_hash, identity_pubkey) VALUES (?, ?, ?, ?, ?)')
      .run('plaintext-user', 'plaintext-user', 'plaintext@example.test', '$2b$12$not-real', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  } finally {
    db.close();
  }
  if (process.platform !== 'win32') chmodSync(databasePath, 0o600);

  const stderr = [];
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      RIDGELINE_ENVIRONMENT: 'test',
      RIDGELINE_SECURE_STORAGE_MODE: 'private-beta',
      RIDGELINE_MASTER_KEY_FILE: keyPath,
      IDS_PORT: String(port),
      IDS_DB_PATH: databasePath,
      IDS_JWT_SECRET: randomBytes(32).toString('hex'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  try {
    const exitCode = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(exitCode, 1);
    assert.match(stderr.join(''), /RIDGELINE_SECURE_STORAGE_MIGRATION_REQUIRED/);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
});
