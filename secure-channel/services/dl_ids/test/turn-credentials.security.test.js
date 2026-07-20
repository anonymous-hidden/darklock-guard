import test from 'node:test';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = path.resolve(__dirname, '..');

const TURN_SHARED_SECRET = 'turn-shared-secret-0123456789abcdef';
const TURN_URLS = [
  'turn:turn.darklock.local:3478?transport=udp',
  'turns:turn.darklock.local:5349?transport=tcp',
];

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

async function startIds(extraEnv = {}) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dl-ids-turn-creds-test-'));
  const port = await getFreePort();
  const jwtSecret = 'ids-test-secret-0123456789abcdef0123456789';
  const dbPath = path.join(tempDir, 'ids.db');

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      IDS_PORT: String(port),
      IDS_DB_PATH: dbPath,
      IDS_JWT_SECRET: jwtSecret,
      JWT_SECRET: jwtSecret,
      IDS_TURN_SHARED_SECRET: TURN_SHARED_SECRET,
      IDS_TURN_URIS: TURN_URLS.join(','),
      IDS_TURN_CREDENTIAL_TTL_SECONDS: '30',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForHealth(port, child);
  return { child, port, tempDir };
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

async function requestJson(port, method, endpoint, body = null, token = null) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // ignored
  }

  return { status: res.status, payload };
}

async function registerAndLogin(port, userId) {
  const registerRes = await requestJson(port, 'POST', '/v1/auth/register', {
    userId,
    email: `${userId}@security.test`,
    displayName: userId,
    password: `password-${userId}-1234`,
  });
  if (registerRes.status !== 201) {
    throw new Error(`register_failed_${userId}_${registerRes.status}`);
  }

  const loginRes = await requestJson(port, 'POST', '/v1/auth/login', {
    userId,
    password: `password-${userId}-1234`,
  });
  if (loginRes.status !== 200 || !loginRes.payload?.token) {
    throw new Error(`login_failed_${userId}_${loginRes.status}`);
  }
  return loginRes.payload.token;
}

test('turn credentials follow coturn REST HMAC shape', { timeout: 25000 }, async () => {
  const ctx = await startIds();
  try {
    const token = await registerAndLogin(ctx.port, 'alice');

    const credRes = await requestJson(ctx.port, 'GET', '/v1/turn/credentials', null, token);
    if (credRes.status !== 200) {
      throw new Error(`expected_200_got_${credRes.status}`);
    }

    const username = String(credRes.payload?.username ?? '');
    const credential = String(credRes.payload?.credential ?? '');
    const urls = Array.isArray(credRes.payload?.urls) ? credRes.payload.urls : [];

    if (!/^\d+:alice$/.test(username)) {
      throw new Error(`unexpected_username_${username}`);
    }
    if (!credential) {
      throw new Error('missing_credential');
    }
    if (urls.length !== TURN_URLS.length || urls.some((value, idx) => value !== TURN_URLS[idx])) {
      throw new Error('unexpected_turn_urls');
    }

    const expected = createHmac('sha1', TURN_SHARED_SECRET)
      .update(username)
      .digest('base64');
    if (credential !== expected) {
      throw new Error('credential_hmac_mismatch');
    }
  } finally {
    await stopIds(ctx);
  }
});

test('turn credentials are short-lived and expiration is embedded', { timeout: 25000 }, async () => {
  const ctx = await startIds();
  try {
    const token = await registerAndLogin(ctx.port, 'alice');

    const credRes = await requestJson(ctx.port, 'GET', '/v1/turn/credentials', null, token);
    if (credRes.status !== 200) {
      throw new Error(`expected_200_got_${credRes.status}`);
    }

    const username = String(credRes.payload?.username ?? '');
    const expiresAt = Number(credRes.payload?.expires_at);
    const expiresIn = Number(credRes.payload?.expires_in_seconds);

    const expiryPrefix = Number.parseInt(username.split(':')[0] ?? '', 10);
    const now = Math.floor(Date.now() / 1000);

    if (!Number.isFinite(expiresAt) || !Number.isFinite(expiryPrefix)) {
      throw new Error('missing_expiration_fields');
    }
    if (expiryPrefix !== expiresAt) {
      throw new Error('username_expiry_mismatch');
    }
    if (expiresIn !== 30) {
      throw new Error(`expected_ttl_30_got_${String(expiresIn)}`);
    }

    const ttlWindow = expiresAt - now;
    if (ttlWindow < 25 || ttlWindow > 31) {
      throw new Error(`unexpected_ttl_window_${ttlWindow}`);
    }
  } finally {
    await stopIds(ctx);
  }
});
