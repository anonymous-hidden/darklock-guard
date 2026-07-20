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

function buildIdsEnv({ port, tempDir, secret, overrides = {} }) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    IDS_PORT: String(port),
    IDS_DB_PATH: path.join(tempDir, 'ids.db'),
    IDS_JWT_SECRET: secret,
    JWT_SECRET: secret,
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete env[key];
      continue;
    }
    env[key] = value;
  }

  return env;
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

async function startIds(overrides = {}) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dl-ids-cors-test-'));
  const port = await getFreePort();
  const secret = 'ids-test-secret-0123456789abcdef0123456789';

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVICE_DIR,
    env: buildIdsEnv({ port, tempDir, secret, overrides }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForHealth(port, child);
  return { child, port, tempDir };
}

async function startIdsExpectFailure(overrides = {}) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dl-ids-cors-fail-'));
  const port = await getFreePort();
  const secret = 'ids-test-secret-0123456789abcdef0123456789';
  const stderrChunks = [];

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVICE_DIR,
    env: buildIdsEnv({ port, tempDir, secret, overrides }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stderr.on('data', (chunk) => {
    stderrChunks.push(String(chunk));
  });

  const exitCode = await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(2500).then(() => null),
  ]);

  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(2000),
    ]);
  }

  rmSync(tempDir, { recursive: true, force: true });
  return { exitCode, stderr: stderrChunks.join('') };
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

test('refuses startup when IDS_ALLOWED_ORIGINS is missing in production', { timeout: 15000 }, async () => {
  const { exitCode, stderr } = await startIdsExpectFailure({
    NODE_ENV: 'production',
    IDS_ALLOWED_ORIGINS: null,
  });

  if (exitCode !== 1) {
    throw new Error(`expected_exit_code_1_got_${String(exitCode)}`);
  }
  if (!stderr.includes('IDS_ALLOWED_ORIGINS is required in production')) {
    throw new Error('missing_required_ids_allowed_origins_error');
  }
});

test('refuses startup when IDS_ALLOWED_ORIGINS contains wildcard in production', { timeout: 15000 }, async () => {
  const { exitCode, stderr } = await startIdsExpectFailure({
    NODE_ENV: 'production',
    IDS_ALLOWED_ORIGINS: '*',
  });

  if (exitCode !== 1) {
    throw new Error(`expected_exit_code_1_got_${String(exitCode)}`);
  }
  if (!stderr.includes('must not contain wildcard (*) in production')) {
    throw new Error('missing_wildcard_rejection_error');
  }
});

test('rejects disallowed Origin requests with 403', { timeout: 20000 }, async () => {
  const ctx = await startIds({ IDS_ALLOWED_ORIGINS: 'https://app.darklock.net' });
  try {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/health`, {
      headers: { origin: 'https://evil.darklock.attacker' },
    });

    if (res.status !== 403) {
      throw new Error(`expected_403_got_${res.status}`);
    }

    const body = await res.json().catch(() => ({}));
    if (body?.code !== 'forbidden') {
      throw new Error(`expected_forbidden_code_got_${String(body?.code)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('allows configured Origin and emits CORS header', { timeout: 20000 }, async () => {
  const allowedOrigin = 'https://app.darklock.net';
  const ctx = await startIds({ IDS_ALLOWED_ORIGINS: allowedOrigin });
  try {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/health`, {
      headers: { origin: allowedOrigin },
    });

    if (res.status !== 200) {
      throw new Error(`expected_200_got_${res.status}`);
    }

    const corsOrigin = res.headers.get('access-control-allow-origin');
    if (corsOrigin !== allowedOrigin) {
      throw new Error(`expected_cors_origin_${allowedOrigin}_got_${String(corsOrigin)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});
