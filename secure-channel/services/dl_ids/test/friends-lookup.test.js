import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`ids_exited_${child.exitCode}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('ids_health_timeout');
}

async function request(port, method, endpoint, { body, token } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function registerAndLogin(port, suffix, displayName) {
  const email = `${suffix}@example.test`;
  const password = `Ridgeline-${randomUUID()}-Password`;
  const registration = await request(port, 'POST', '/v1/auth/register', {
    body: { email, password, displayName },
  });
  assert.equal(registration.status, 201);

  const login = await request(port, 'POST', '/v1/auth/login', { body: { email, password } });
  assert.equal(login.status, 200);
  return { userId: login.body.userId, token: login.body.token };
}

test('authenticated user lookup and friend requests share one canonical contract', { timeout: 20_000 }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ridgeline-friends-'));
  const keyPath = path.join(root, 'server-master-key');
  const databasePath = path.join(root, 'ids.db');
  const port = await freePort();
  const jwtSecret = randomBytes(32).toString('hex');
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

  try {
    await waitForHealth(port, child);
    const requester = await registerAndLogin(port, `requester-${randomUUID().slice(0, 8)}`, 'Requester');
    const recipient = await registerAndLogin(port, `recipient-${randomUUID().slice(0, 8)}`, 'Recipient');

    const unauthenticatedLookup = await request(port, 'GET', '/users/search?q=recipient');
    assert.equal(unauthenticatedLookup.status, 401);

    const lookup = await request(port, 'GET', '/users/search?q=recipient', { token: requester.token });
    assert.equal(lookup.status, 200);
    assert.deepEqual(lookup.body.users, [{
      userId: recipient.userId,
      username: recipient.userId,
      displayName: 'Recipient',
    }]);

    const sent = await request(port, 'POST', '/friends/request', {
      token: requester.token,
      body: { target_user_id: recipient.userId },
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.status, 'sent');
    assert.equal(typeof sent.body.requestId, 'string');

    const incoming = await request(port, 'GET', '/friends/requests', { token: recipient.token });
    assert.equal(incoming.status, 200);
    assert.deepEqual(incoming.body.requests, [{
      id: sent.body.requestId,
      fromUser: requester.userId,
      displayName: 'Requester',
      createdAt: incoming.body.requests[0].createdAt,
    }]);

    const accepted = await request(port, 'POST', `/friends/requests/${encodeURIComponent(sent.body.requestId)}/accept`, {
      token: recipient.token,
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body, {
      status: 'accepted',
      contact: { userId: requester.userId, username: requester.userId, displayName: 'Requester' },
    });

    const requesterFriends = await request(port, 'GET', '/friends', { token: requester.token });
    const recipientFriends = await request(port, 'GET', '/friends', { token: recipient.token });
    assert.deepEqual(requesterFriends.body.friends, [{ userId: recipient.userId, username: recipient.userId, displayName: 'Recipient' }]);
    assert.deepEqual(recipientFriends.body.friends, [{ userId: requester.userId, username: requester.userId, displayName: 'Requester' }]);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
