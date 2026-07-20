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

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
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

async function requestJson(port, method, endpoint, body, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // ignore parse failures in assertions
  }

  return { status: res.status, payload };
}

async function registerUser(port, seed, identityKey) {
  const safeSeed = String(seed || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 16) || 'seed';
  const userId = `spk-${safeSeed}`;
  const password = 'correct-horse-battery-staple';

  const reg = await requestJson(port, 'POST', '/v1/auth/register', {
    userId,
    email: `${userId}@security.test`,
    displayName: userId,
    password,
  });

  if (reg.status !== 201) {
    throw new Error(`register_failed_${reg.status}`);
  }

  const login = await requestJson(port, 'POST', '/v1/auth/login', {
    userId,
    password,
  });
  if (login.status !== 200 || !login.payload?.token) {
    throw new Error(`login_failed_${login.status}`);
  }

  const keyBootstrap = await requestJson(port, 'POST', '/v1/keys/register', {
    userId,
    identityKey,
    signedPreKey: {
      keyId: 1,
      publicKey: `spk-bootstrap-${seed}`,
      signature: `spk-signature-${seed}`,
      createdAt: Date.now(),
    },
    oneTimePreKeys: [
      { keyId: 1, publicKey: `opk-bootstrap-${seed}` },
    ],
  }, login.payload.token);
  if (keyBootstrap.status !== 200) {
    throw new Error(`key_bootstrap_failed_${keyBootstrap.status}`);
  }

  return {
    userId,
    token: login.payload.token,
  };
}

async function enrollDevice(port, token, deviceId, spkPub, spkSig) {
  const enrolled = await requestJson(port, 'POST', '/devices/enroll', {
    device_id: deviceId,
    device_name: 'Test Device',
    platform: 'test',
    device_pubkey: `device-pub-${deviceId}`,
    device_cert: `device-cert-${deviceId}`,
    dh_pubkey: `dh-pub-${deviceId}`,
    spk_pubkey: spkPub,
    spk_sig: spkSig,
    one_time_prekeys: [`opk-${deviceId}-1`, `opk-${deviceId}-2`],
  }, token);

  if (enrolled.status !== 201) {
    throw new Error(`enroll_failed_${enrolled.status}`);
  }
}

test('PUT /keys/spk rejects identity_pubkey and cannot rotate identity key', { timeout: 40000 }, async () => {
  const ctx = await startIds();
  try {
    const seed = uniqueSuffix();
    const initialIdentity = `ik-initial-${seed}`;
    const attemptedIdentity = `ik-rotated-${seed}`;
    const originalSpkPub = `spk-original-pub-${seed}`;
    const originalSpkSig = `spk-original-sig-${seed}`;

    const { userId, token } = await registerUser(ctx.port, seed, initialIdentity);
    await enrollDevice(ctx.port, token, `device-${seed}`, originalSpkPub, originalSpkSig);

    const spkRefresh = await requestJson(ctx.port, 'PUT', '/keys/spk', {
      spk_pubkey: `spk-new-pub-${seed}`,
      spk_sig: `spk-new-sig-${seed}`,
      identity_pubkey: attemptedIdentity,
    }, token);

    if (spkRefresh.status !== 400) {
      throw new Error(`expected_400_got_${spkRefresh.status}`);
    }
    if (spkRefresh.payload?.code !== 'bad_request') {
      throw new Error(`expected_bad_request_code_got_${String(spkRefresh.payload?.code)}`);
    }

    const keys = await requestJson(ctx.port, 'GET', `/users/${userId}/keys`, undefined, token);
    if (keys.status !== 200) {
      throw new Error(`expected_200_keys_got_${keys.status}`);
    }
    if (keys.payload?.identity_pubkey !== initialIdentity) {
      throw new Error('identity_pubkey_was_modified');
    }
    if (keys.payload?.prekey_bundle?.spk_pub !== originalSpkPub) {
      throw new Error('spk_pub_changed_despite_rejection');
    }
    if (keys.payload?.prekey_bundle?.spk_sig !== originalSpkSig) {
      throw new Error('spk_sig_changed_despite_rejection');
    }
  } finally {
    await stopIds(ctx);
  }
});

test('PUT /keys/spk updates signed pre-key fields when identity_pubkey is absent', { timeout: 40000 }, async () => {
  const ctx = await startIds();
  try {
    const seed = uniqueSuffix();
    const initialIdentity = `ik-initial-${seed}`;
    const originalSpkPub = `spk-original-pub-${seed}`;
    const originalSpkSig = `spk-original-sig-${seed}`;
    const nextSpkPub = `spk-next-pub-${seed}`;
    const nextSpkSig = `spk-next-sig-${seed}`;

    const { userId, token } = await registerUser(ctx.port, seed, initialIdentity);
    await enrollDevice(ctx.port, token, `device-${seed}`, originalSpkPub, originalSpkSig);

    const spkRefresh = await requestJson(ctx.port, 'PUT', '/keys/spk', {
      spk_pubkey: nextSpkPub,
      spk_sig: nextSpkSig,
      one_time_prekeys: [`opk-next-${seed}-1`],
    }, token);

    if (spkRefresh.status !== 200) {
      throw new Error(`expected_200_got_${spkRefresh.status}`);
    }

    const keys = await requestJson(ctx.port, 'GET', `/users/${userId}/keys`, undefined, token);
    if (keys.status !== 200) {
      throw new Error(`expected_200_keys_got_${keys.status}`);
    }
    if (keys.payload?.identity_pubkey !== initialIdentity) {
      throw new Error('identity_pubkey_changed_on_spk_refresh');
    }
    if (keys.payload?.prekey_bundle?.spk_pub !== nextSpkPub) {
      throw new Error('spk_pub_not_updated');
    }
    if (keys.payload?.prekey_bundle?.spk_sig !== nextSpkSig) {
      throw new Error('spk_sig_not_updated');
    }
  } finally {
    await stopIds(ctx);
  }
});
