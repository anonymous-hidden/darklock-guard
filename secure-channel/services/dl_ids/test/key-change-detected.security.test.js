import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = path.resolve(__dirname, '..');

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('failed_to_get_port'));
        return;
      }
      const { port } = addr;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(port, child, timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`ids_exited_early_${child.exitCode}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(100);
  }
  throw new Error('ids_health_timeout');
}

async function startIds() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dl-ids-key-change-test-'));
  const port = await getFreePort();
  const secret = 'ids-test-secret-0123456789abcdef0123456789';
  const dbPath = path.join(tempDir, 'ids.db');

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      IDS_PORT: String(port),
      IDS_DB_PATH: dbPath,
      IDS_JWT_SECRET: secret,
      JWT_SECRET: secret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForHealth(port, child);
  return { child, port, tempDir, dbPath };
}

async function stopIds(ctx) {
  if (!ctx) return;
  const { child, tempDir } = ctx;

  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(2500),
    ]);
  }
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(2500),
    ]);
  }

  rmSync(tempDir, { recursive: true, force: true });
}

async function requestJson(port, method, endpoint, body = null) {
  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === null ? undefined : JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // ignore parse failures
  }

  return { status: res.status, payload };
}

async function registerV1User(port, userId) {
  const res = await requestJson(port, 'POST', '/v1/auth/register', {
    userId,
    email: `${userId}@security.test`,
    displayName: userId,
    password: `password-${userId}-1234`,
  });
  if (res.status !== 201) {
    throw new Error(`register_failed_${res.status}`);
  }
}

function setStoredIdentityKey(dbPath, userId, identityPubkey) {
  const db = new Database(dbPath);
  try {
    db.prepare('UPDATE users SET identity_pubkey = ? WHERE id = ?').run(identityPubkey, userId);
  } finally {
    db.close();
  }
}

test('v1 login returns key_change_detected false when last-known identity key matches', { timeout: 30000 }, async () => {
  const ctx = await startIds();
  try {
    await registerV1User(ctx.port, 'alice');
    setStoredIdentityKey(ctx.dbPath, 'alice', 'identity-key-current');

    const login = await requestJson(ctx.port, 'POST', '/v1/auth/login', {
      userId: 'alice',
      password: 'password-alice-1234',
      last_known_identity_pubkey: 'identity-key-current',
    });

    if (login.status !== 200) {
      throw new Error(`expected_200_got_${login.status}`);
    }
    if (login.payload?.key_change_detected !== false) {
      throw new Error(`expected_key_change_detected_false_got_${String(login.payload?.key_change_detected)}`);
    }
    if (login.payload?.keyChangeDetected !== false) {
      throw new Error(`expected_keyChangeDetected_false_got_${String(login.payload?.keyChangeDetected)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('v1 login returns key_change_detected true when stored identity key changed', { timeout: 30000 }, async () => {
  const ctx = await startIds();
  try {
    await registerV1User(ctx.port, 'alice');
    setStoredIdentityKey(ctx.dbPath, 'alice', 'identity-key-new');

    const login = await requestJson(ctx.port, 'POST', '/v1/auth/login', {
      userId: 'alice',
      password: 'password-alice-1234',
      last_known_identity_pubkey: 'identity-key-old',
    });

    if (login.status !== 200) {
      throw new Error(`expected_200_got_${login.status}`);
    }
    if (login.payload?.key_change_detected !== true) {
      throw new Error(`expected_key_change_detected_true_got_${String(login.payload?.key_change_detected)}`);
    }
    if (login.payload?.keyChangeDetected !== true) {
      throw new Error(`expected_keyChangeDetected_true_got_${String(login.payload?.keyChangeDetected)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('v1 login remains backward-compatible when last_known_identity_pubkey is absent', { timeout: 30000 }, async () => {
  const ctx = await startIds();
  try {
    await registerV1User(ctx.port, 'alice');
    setStoredIdentityKey(ctx.dbPath, 'alice', 'identity-key-current');

    const login = await requestJson(ctx.port, 'POST', '/v1/auth/login', {
      userId: 'alice',
      password: 'password-alice-1234',
    });

    if (login.status !== 200) {
      throw new Error(`expected_200_got_${login.status}`);
    }
    if (login.payload?.key_change_detected !== false) {
      throw new Error(`expected_backcompat_false_got_${String(login.payload?.key_change_detected)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});
