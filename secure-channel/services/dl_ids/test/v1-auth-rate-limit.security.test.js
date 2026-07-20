import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

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
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dl-ids-test-'));
  const port = await getFreePort();
  const secret = 'ids-test-secret-0123456789abcdef0123456789';

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      IDS_PORT: String(port),
      IDS_DB_PATH: path.join(tempDir, 'ids.db'),
      IDS_JWT_SECRET: secret,
      JWT_SECRET: secret,
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

async function postJson(port, endpoint, body) {
  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // ignore parse failures in assertions
  }
  return { status: res.status, payload };
}

async function getJson(port, endpoint, token = null) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: 'GET',
    headers,
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // ignore parse failures in assertions
  }

  return { status: res.status, payload };
}

test('/v1/auth/register is rate-limited and returns 429', { timeout: 35000 }, async () => {
  const ctx = await startIds();
  try {
    let last;
    for (let i = 0; i < 31; i++) {
      last = await postJson(ctx.port, '/v1/auth/register', {
        userId: '!',
        displayName: 'x',
        password: 'short',
      });
    }

    if (last.status !== 429) {
      throw new Error(`expected_429_got_${last.status}`);
    }
    if (last.payload?.code !== 'rate_limited') {
      throw new Error(`expected_rate_limited_code_got_${String(last.payload?.code)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('/v1/auth/refresh rotates tokens and revokes sessions on reuse', { timeout: 35000 }, async () => {
  const ctx = await startIds();
  try {
    const userId = 'refresh-reuse-user';
    const password = 'strong-password-9012';
    const register = await postJson(ctx.port, '/v1/auth/register', {
      userId,
      email: `${userId}@security.test`,
      displayName: userId,
      password,
    });
    if (register.status !== 201) throw new Error(`register_failed_${register.status}`);

    const login = await postJson(ctx.port, '/v1/auth/login', { userId, password });
    const firstRefresh = login.payload?.refresh_token;
    if (login.status !== 200 || !firstRefresh) throw new Error(`login_failed_${login.status}`);

    const rotated = await postJson(ctx.port, '/v1/auth/refresh', { refresh_token: firstRefresh });
    const secondRefresh = rotated.payload?.refresh_token;
    if (rotated.status !== 200 || !secondRefresh) throw new Error(`refresh_rotation_failed_${rotated.status}`);

    const replay = await postJson(ctx.port, '/v1/auth/refresh', { refresh_token: firstRefresh });
    if (replay.status !== 401 || replay.payload?.error !== 'refresh_token_reuse_detected') {
      throw new Error(`expected_refresh_reuse_detection_got_${replay.status}`);
    }

    const revokedFamily = await postJson(ctx.port, '/v1/auth/refresh', { refresh_token: secondRefresh });
    if (revokedFamily.status !== 401) {
      throw new Error(`expected_rotated_family_revoked_got_${revokedFamily.status}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('/v1/auth/login has per-userId throttling and returns 429 for repeated attempts', { timeout: 35000 }, async () => {
  const ctx = await startIds();
  try {
    let lastAlice;
    for (let i = 0; i < 11; i++) {
      lastAlice = await postJson(ctx.port, '/v1/auth/login', {
        userId: 'alice',
        password: 'wrong-password',
      });
    }

    if (lastAlice.status !== 429) {
      throw new Error(`expected_429_for_alice_got_${lastAlice.status}`);
    }

    // A different userId should not be blocked by alice's per-account limiter.
    const bob = await postJson(ctx.port, '/v1/auth/login', {
      userId: 'bob',
      password: 'wrong-password',
    });

    if (bob.status === 429) {
      throw new Error('unexpected_429_for_bob');
    }
  } finally {
    await stopIds(ctx);
  }
});

test('/v1/auth/2fa/verify is rate-limited and returns 429', { timeout: 35000 }, async () => {
  const ctx = await startIds();
  try {
    let last;
    for (let i = 0; i < 31; i++) {
      last = await postJson(ctx.port, '/v1/auth/2fa/verify', {
        userId: 'alice',
        code: '000000',
      });
    }

    if (last.status !== 429) {
      throw new Error(`expected_429_got_${last.status}`);
    }
    if (last.payload?.code !== 'rate_limited') {
      throw new Error(`expected_rate_limited_code_got_${String(last.payload?.code)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('/v1/auth/exists requires auth while /v1/auth/availability remains public', { timeout: 35000 }, async () => {
  const ctx = await startIds();
  try {
    const userId = 'exists-user';
    const password = 'strong-password-1234';

    const register = await postJson(ctx.port, '/v1/auth/register', {
      userId,
      email: `${userId}@security.test`,
      displayName: userId,
      password,
    });
    if (register.status !== 201) {
      throw new Error(`register_failed_${register.status}`);
    }

    const login = await postJson(ctx.port, '/v1/auth/login', {
      userId,
      password,
    });
    if (login.status !== 200 || !login.payload?.token) {
      throw new Error(`login_failed_${login.status}`);
    }

    const unauthExists = await getJson(ctx.port, `/v1/auth/exists/${encodeURIComponent(userId)}`);
    if (unauthExists.status !== 401) {
      throw new Error(`expected_401_for_exists_without_auth_got_${unauthExists.status}`);
    }

    const authExists = await getJson(
      ctx.port,
      `/v1/auth/exists/${encodeURIComponent(userId)}`,
      login.payload.token,
    );
    if (authExists.status !== 200 || authExists.payload?.exists !== true) {
      throw new Error(`expected_exists_true_got_status_${authExists.status}`);
    }

    const availability = await getJson(
      ctx.port,
      `/v1/auth/availability/${encodeURIComponent(userId)}`,
    );
    if (availability.status !== 200 || availability.payload?.available !== false) {
      throw new Error(`expected_available_false_got_status_${availability.status}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('/v1/auth/exists and /v1/auth/availability are rate-limited with 429', { timeout: 45000 }, async () => {
  const ctx = await startIds();
  try {
    const userId = 'rate-limit-user';
    const password = 'strong-password-5678';

    const register = await postJson(ctx.port, '/v1/auth/register', {
      userId,
      email: `${userId}@security.test`,
      displayName: userId,
      password,
    });
    if (register.status !== 201) {
      throw new Error(`register_failed_${register.status}`);
    }

    const login = await postJson(ctx.port, '/v1/auth/login', {
      userId,
      password,
    });
    if (login.status !== 200 || !login.payload?.token) {
      throw new Error(`login_failed_${login.status}`);
    }

    let lastExists;
    for (let i = 0; i < 31; i += 1) {
      lastExists = await getJson(
        ctx.port,
        `/v1/auth/exists/${encodeURIComponent(userId)}`,
        login.payload.token,
      );
    }
    if (lastExists.status !== 429) {
      throw new Error(`expected_exists_429_got_${lastExists.status}`);
    }

    let lastAvailability;
    for (let i = 0; i < 31; i += 1) {
      lastAvailability = await getJson(
        ctx.port,
        `/v1/auth/availability/${encodeURIComponent(`new-user-${i}`)}`,
      );
    }
    if (lastAvailability.status !== 429) {
      throw new Error(`expected_availability_429_got_${lastAvailability.status}`);
    }
  } finally {
    await stopIds(ctx);
  }
});
