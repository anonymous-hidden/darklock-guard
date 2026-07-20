import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = path.resolve(__dirname, '..');
const ED25519_SPKI_HEADER = Buffer.from('302a300506032b6570032100', 'hex');

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

function generateIdentityKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = Buffer.from(spkiDer).subarray(ED25519_SPKI_HEADER.length);
  return {
    publicKey,
    privateKey,
    identityPubkey: rawPub.toString('base64url'),
  };
}

function buildRotationPayload({
  userId,
  oldIdentityPubkey,
  newIdentityPubkey,
  previousKeyVersion,
  newKeyVersion,
  nonce,
}) {
  return [
    userId,
    oldIdentityPubkey,
    newIdentityPubkey,
    String(previousKeyVersion),
    String(newKeyVersion),
    nonce,
  ].join('\n');
}

function signRotationPayload(privateKey, payloadFields) {
  const payload = buildRotationPayload(payloadFields);
  return crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
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
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dl-ids-rotate-test-'));
  const port = await getFreePort();
  const secret = 'ids-rotate-test-secret-0123456789abcdef0123';

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

async function registerUser(port, seed, identityPubkey) {
  const safeSeed = String(seed || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 16) || 'seed';
  const userId = `rotate-${safeSeed}`;
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
    identityKey: identityPubkey,
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

async function enrollDevice(port, token, deviceId) {
  const enrolled = await requestJson(port, 'POST', '/devices/enroll', {
    device_id: deviceId,
    device_name: 'Rotation Test Device',
    platform: 'test',
    device_pubkey: `device-pub-${deviceId}`,
    device_cert: `device-cert-${deviceId}`,
    dh_pubkey: `dh-pub-${deviceId}`,
    spk_pubkey: `spk-pub-${deviceId}`,
    spk_sig: `spk-sig-${deviceId}`,
    one_time_prekeys: [`opk-${deviceId}-1`, `opk-${deviceId}-2`],
  }, token);

  if (enrolled.status !== 201) {
    throw new Error(`enroll_failed_${enrolled.status}`);
  }
}

async function issueRotationChallenge(port, token) {
  return requestJson(port, 'POST', '/keys/identity/rotate/challenge', {}, token);
}

async function rotateIdentityKey(port, token, body) {
  return requestJson(port, 'POST', '/keys/identity/rotate', body, token);
}

test('identity rotation fails when signature is missing', { timeout: 40000 }, async () => {
  const ctx = await startIds();
  try {
    const seed = uniqueSuffix();
    const oldKey = generateIdentityKeyPair();
    const newKey = generateIdentityKeyPair();

    const { userId, token } = await registerUser(ctx.port, seed, oldKey.identityPubkey);
    await enrollDevice(ctx.port, token, `device-${seed}`);

    const challenge = await issueRotationChallenge(ctx.port, token);
    if (challenge.status !== 200) throw new Error(`challenge_failed_${challenge.status}`);

    const rotate = await rotateIdentityKey(ctx.port, token, {
      new_identity_pubkey: newKey.identityPubkey,
      new_key_version: 2,
      nonce: challenge.payload.nonce,
    });

    if (rotate.status !== 400) {
      throw new Error(`expected_400_got_${rotate.status}`);
    }

    const keys = await requestJson(ctx.port, 'GET', `/users/${userId}/keys`, undefined, token);
    if (keys.payload?.identity_pubkey !== oldKey.identityPubkey) throw new Error('identity_key_changed_without_signature');
    if (keys.payload?.key_version !== 1) throw new Error('key_version_changed_without_signature');
  } finally {
    await stopIds(ctx);
  }
});

test('identity rotation fails with invalid signature', { timeout: 40000 }, async () => {
  const ctx = await startIds();
  try {
    const seed = uniqueSuffix();
    const oldKey = generateIdentityKeyPair();
    const newKey = generateIdentityKeyPair();
    const wrongSigner = generateIdentityKeyPair();

    const { userId, token } = await registerUser(ctx.port, seed, oldKey.identityPubkey);
    await enrollDevice(ctx.port, token, `device-${seed}`);

    const challenge = await issueRotationChallenge(ctx.port, token);
    if (challenge.status !== 200) throw new Error(`challenge_failed_${challenge.status}`);

    const signature = signRotationPayload(wrongSigner.privateKey, {
      userId,
      oldIdentityPubkey: oldKey.identityPubkey,
      newIdentityPubkey: newKey.identityPubkey,
      previousKeyVersion: 1,
      newKeyVersion: 2,
      nonce: challenge.payload.nonce,
    });

    const rotate = await rotateIdentityKey(ctx.port, token, {
      new_identity_pubkey: newKey.identityPubkey,
      new_key_version: 2,
      nonce: challenge.payload.nonce,
      signature,
    });

    if (rotate.status !== 400) {
      throw new Error(`expected_400_got_${rotate.status}`);
    }

    const keys = await requestJson(ctx.port, 'GET', `/users/${userId}/keys`, undefined, token);
    if (keys.payload?.identity_pubkey !== oldKey.identityPubkey) throw new Error('identity_key_changed_with_invalid_signature');
    if (keys.payload?.key_version !== 1) throw new Error('key_version_changed_with_invalid_signature');
  } finally {
    await stopIds(ctx);
  }
});

test('identity rotation fails when new_key_version is stale', { timeout: 40000 }, async () => {
  const ctx = await startIds();
  try {
    const seed = uniqueSuffix();
    const oldKey = generateIdentityKeyPair();
    const newKey = generateIdentityKeyPair();

    const { userId, token } = await registerUser(ctx.port, seed, oldKey.identityPubkey);
    await enrollDevice(ctx.port, token, `device-${seed}`);

    const challenge = await issueRotationChallenge(ctx.port, token);
    if (challenge.status !== 200) throw new Error(`challenge_failed_${challenge.status}`);

    const staleVersion = 1;
    const signature = signRotationPayload(oldKey.privateKey, {
      userId,
      oldIdentityPubkey: oldKey.identityPubkey,
      newIdentityPubkey: newKey.identityPubkey,
      previousKeyVersion: 1,
      newKeyVersion: staleVersion,
      nonce: challenge.payload.nonce,
    });

    const rotate = await rotateIdentityKey(ctx.port, token, {
      new_identity_pubkey: newKey.identityPubkey,
      new_key_version: staleVersion,
      nonce: challenge.payload.nonce,
      signature,
    });

    if (rotate.status !== 400) {
      throw new Error(`expected_400_got_${rotate.status}`);
    }

    const keys = await requestJson(ctx.port, 'GET', `/users/${userId}/keys`, undefined, token);
    if (keys.payload?.identity_pubkey !== oldKey.identityPubkey) throw new Error('identity_key_changed_with_stale_version');
    if (keys.payload?.key_version !== 1) throw new Error('key_version_changed_with_stale_version');
  } finally {
    await stopIds(ctx);
  }
});

test('identity rotation succeeds with valid signed proof and fresh challenge', { timeout: 40000 }, async () => {
  const ctx = await startIds();
  try {
    const seed = uniqueSuffix();
    const oldKey = generateIdentityKeyPair();
    const newKey = generateIdentityKeyPair();

    const { userId, token } = await registerUser(ctx.port, seed, oldKey.identityPubkey);
    await enrollDevice(ctx.port, token, `device-${seed}`);

    const challenge = await issueRotationChallenge(ctx.port, token);
    if (challenge.status !== 200) throw new Error(`challenge_failed_${challenge.status}`);

    const signature = signRotationPayload(oldKey.privateKey, {
      userId,
      oldIdentityPubkey: oldKey.identityPubkey,
      newIdentityPubkey: newKey.identityPubkey,
      previousKeyVersion: 1,
      newKeyVersion: 2,
      nonce: challenge.payload.nonce,
    });

    const rotate = await rotateIdentityKey(ctx.port, token, {
      new_identity_pubkey: newKey.identityPubkey,
      new_key_version: 2,
      nonce: challenge.payload.nonce,
      signature,
    });

    if (rotate.status !== 200) {
      throw new Error(`expected_200_got_${rotate.status}`);
    }
    if (rotate.payload?.key_version !== 2) {
      throw new Error(`expected_key_version_2_got_${String(rotate.payload?.key_version)}`);
    }

    const keys = await requestJson(ctx.port, 'GET', `/users/${userId}/keys`, undefined, token);
    if (keys.payload?.identity_pubkey !== newKey.identityPubkey) throw new Error('identity_key_not_rotated');
    if (keys.payload?.key_version !== 2) throw new Error('key_version_not_incremented');
  } finally {
    await stopIds(ctx);
  }
});

test('identity rotation writes a history/audit row', { timeout: 40000 }, async () => {
  const ctx = await startIds();
  try {
    const seed = uniqueSuffix();
    const oldKey = generateIdentityKeyPair();
    const newKey = generateIdentityKeyPair();

    const { userId, token } = await registerUser(ctx.port, seed, oldKey.identityPubkey);
    await enrollDevice(ctx.port, token, `device-${seed}`);

    const challenge = await issueRotationChallenge(ctx.port, token);
    if (challenge.status !== 200) throw new Error(`challenge_failed_${challenge.status}`);

    const signature = signRotationPayload(oldKey.privateKey, {
      userId,
      oldIdentityPubkey: oldKey.identityPubkey,
      newIdentityPubkey: newKey.identityPubkey,
      previousKeyVersion: 1,
      newKeyVersion: 2,
      nonce: challenge.payload.nonce,
    });

    const rotate = await rotateIdentityKey(ctx.port, token, {
      new_identity_pubkey: newKey.identityPubkey,
      new_key_version: 2,
      nonce: challenge.payload.nonce,
      signature,
    });
    if (rotate.status !== 200) throw new Error(`expected_200_got_${rotate.status}`);

    const db = new Database(path.join(ctx.tempDir, 'ids.db'));
    try {
      const row = db.prepare(`
        SELECT old_identity_pubkey, new_identity_pubkey, previous_key_version, new_key_version, nonce
        FROM identity_key_history
        WHERE user_id = ?
        ORDER BY rotated_at DESC
        LIMIT 1
      `).get(userId);

      if (!row) throw new Error('missing_identity_key_history_row');
      if (row.old_identity_pubkey !== oldKey.identityPubkey) throw new Error('history_old_key_mismatch');
      if (row.new_identity_pubkey !== newKey.identityPubkey) throw new Error('history_new_key_mismatch');
      if (row.previous_key_version !== 1) throw new Error(`history_previous_version_mismatch_${row.previous_key_version}`);
      if (row.new_key_version !== 2) throw new Error(`history_new_version_mismatch_${row.new_key_version}`);
      if (row.nonce !== challenge.payload.nonce) throw new Error('history_nonce_mismatch');
    } finally {
      db.close();
    }
  } finally {
    await stopIds(ctx);
  }
});
