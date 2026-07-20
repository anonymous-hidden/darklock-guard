import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

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
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dl-ids-rly-permit-test-'));
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
  return { child, port, tempDir, dbPath, secret };
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

async function registerUser(port, userId) {
  const res = await requestJson(port, 'POST', '/v1/auth/register', {
    userId,
    email: `${userId}@security.test`,
    displayName: userId,
    password: `password-${userId}-1234`,
  });
  if (res.status !== 201) {
    throw new Error(`register_failed_${userId}_${res.status}`);
  }
}

async function loginUser(port, userId) {
  const res = await requestJson(port, 'POST', '/v1/auth/login', {
    userId,
    password: `password-${userId}-1234`,
  });
  if (res.status !== 200 || !res.payload?.token) {
    throw new Error(`login_failed_${userId}_${res.status}`);
  }
  return res.payload.token;
}

async function makeFriends(port, aliceToken, bobToken, bobId) {
  const sendReq = await requestJson(
    port,
    'POST',
    '/friends/request',
    { target_user_id: bobId },
    aliceToken,
  );
  if (!(sendReq.status === 201 || sendReq.status === 200)) {
    throw new Error(`friend_request_failed_${sendReq.status}`);
  }

  const incoming = await requestJson(port, 'GET', '/friends/requests', null, bobToken);
  if (incoming.status !== 200 || !Array.isArray(incoming.payload?.requests) || incoming.payload.requests.length === 0) {
    throw new Error('friend_request_not_visible_to_bob');
  }

  const requestId = incoming.payload.requests[0].id;
  const accept = await requestJson(port, 'POST', `/friends/requests/${requestId}/accept`, {}, bobToken);
  if (accept.status !== 200) {
    throw new Error(`friend_accept_failed_${accept.status}`);
  }
}

test('relay permit denies non-friend direct message send', { timeout: 25000 }, async () => {
  const ctx = await startIds();
  try {
    await registerUser(ctx.port, 'alice');
    await registerUser(ctx.port, 'bob');

    const aliceToken = await loginUser(ctx.port, 'alice');

    const permitRes = await requestJson(
      ctx.port,
      'POST',
      '/v1/relay/permit',
      { type: 'message', to: 'bob' },
      aliceToken,
    );

    if (permitRes.status !== 403) {
      throw new Error(`expected_403_got_${permitRes.status}`);
    }
    if (permitRes.payload?.code !== 'not_friends') {
      throw new Error(`expected_not_friends_got_${String(permitRes.payload?.code)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('relay permit denies blocked pair send even if users are friends', { timeout: 30000 }, async () => {
  const ctx = await startIds();
  try {
    await registerUser(ctx.port, 'alice');
    await registerUser(ctx.port, 'bob');

    const aliceToken = await loginUser(ctx.port, 'alice');
    const bobToken = await loginUser(ctx.port, 'bob');

    await makeFriends(ctx.port, aliceToken, bobToken, 'bob');

    const localDb = new Database(ctx.dbPath);
    try {
      localDb
        .prepare('INSERT INTO user_blocks (id, blocker_user_id, blocked_user_id) VALUES (?, ?, ?)')
        .run(randomUUID(), 'bob', 'alice');
    } finally {
      localDb.close();
    }

    const permitRes = await requestJson(
      ctx.port,
      'POST',
      '/v1/relay/permit',
      { type: 'message', to: 'bob' },
      aliceToken,
    );

    if (permitRes.status !== 403) {
      throw new Error(`expected_403_got_${permitRes.status}`);
    }
    if (permitRes.payload?.code !== 'blocked') {
      throw new Error(`expected_blocked_got_${String(permitRes.payload?.code)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

const RESIDUAL_DIRECT_EVENT_TYPES = [
  'typing',
  'delete_message',
  'edit_message',
  'receipt',
  'friend_accept',
  'open_dm',
  'tag_update',
];

const METADATA_RECIPIENT_EVENT_TYPES = [
  'subscribe_presence',
  'profile_request',
];

test('relay permit denies non-friend residual events to arbitrary users', { timeout: 45000 }, async () => {
  const ctx = await startIds();
  try {
    await registerUser(ctx.port, 'alice');
    await registerUser(ctx.port, 'bob');

    const aliceToken = await loginUser(ctx.port, 'alice');

    for (const eventType of RESIDUAL_DIRECT_EVENT_TYPES) {
      const permitRes = await requestJson(
        ctx.port,
        'POST',
        '/v1/relay/permit',
        { type: eventType, to: 'bob' },
        aliceToken,
      );

      const capabilityDisabled = eventType === 'edit_message' || eventType === 'delete_message';
      const expectedStatus = capabilityDisabled ? 503 : 403;
      const expectedCode = capabilityDisabled ? 'service_unavailable' : 'not_friends';
      if (permitRes.status !== expectedStatus) {
        throw new Error(`expected_${expectedStatus}_for_${eventType}_got_${permitRes.status}`);
      }
      if (permitRes.payload?.code !== expectedCode) {
        throw new Error(`expected_${expectedCode}_for_${eventType}_got_${String(permitRes.payload?.code)}`);
      }
    }

    const groupInviteRes = await requestJson(
      ctx.port,
      'POST',
      '/v1/relay/permit',
      { type: 'group_invite', recipients: ['bob'], groupId: 'group-test' },
      aliceToken,
    );

    if (groupInviteRes.status !== 503) {
      throw new Error(`expected_503_for_group_invite_got_${groupInviteRes.status}`);
    }
    if (groupInviteRes.payload?.code !== 'service_unavailable') {
      throw new Error(`expected_service_unavailable_for_group_invite_got_${String(groupInviteRes.payload?.code)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('relay permit denies blocked residual events even if users are friends', { timeout: 50000 }, async () => {
  const ctx = await startIds();
  try {
    await registerUser(ctx.port, 'alice');
    await registerUser(ctx.port, 'bob');

    const aliceToken = await loginUser(ctx.port, 'alice');
    const bobToken = await loginUser(ctx.port, 'bob');

    await makeFriends(ctx.port, aliceToken, bobToken, 'bob');

    const localDb = new Database(ctx.dbPath);
    try {
      localDb
        .prepare('INSERT INTO user_blocks (id, blocker_user_id, blocked_user_id) VALUES (?, ?, ?)')
        .run(randomUUID(), 'bob', 'alice');
    } finally {
      localDb.close();
    }

    for (const eventType of RESIDUAL_DIRECT_EVENT_TYPES) {
      const permitRes = await requestJson(
        ctx.port,
        'POST',
        '/v1/relay/permit',
        { type: eventType, to: 'bob' },
        aliceToken,
      );

      const capabilityDisabled = eventType === 'edit_message' || eventType === 'delete_message';
      const expectedStatus = capabilityDisabled ? 503 : 403;
      const expectedCode = capabilityDisabled ? 'service_unavailable' : 'blocked';
      if (permitRes.status !== expectedStatus) {
        throw new Error(`expected_${expectedStatus}_for_${eventType}_got_${permitRes.status}`);
      }
      if (permitRes.payload?.code !== expectedCode) {
        throw new Error(`expected_${expectedCode}_for_${eventType}_got_${String(permitRes.payload?.code)}`);
      }
    }

    const groupInviteRes = await requestJson(
      ctx.port,
      'POST',
      '/v1/relay/permit',
      { type: 'group_invite', recipients: ['bob'], groupId: 'group-test' },
      aliceToken,
    );

    if (groupInviteRes.status !== 503) {
      throw new Error(`expected_503_for_group_invite_got_${groupInviteRes.status}`);
    }
    if (groupInviteRes.payload?.code !== 'service_unavailable') {
      throw new Error(`expected_service_unavailable_for_group_invite_got_${String(groupInviteRes.payload?.code)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('relay permit denies non-friend metadata recipient events', { timeout: 35000 }, async () => {
  const ctx = await startIds();
  try {
    await registerUser(ctx.port, 'alice');
    await registerUser(ctx.port, 'bob');

    const aliceToken = await loginUser(ctx.port, 'alice');

    for (const eventType of METADATA_RECIPIENT_EVENT_TYPES) {
      const permitRes = await requestJson(
        ctx.port,
        'POST',
        '/v1/relay/permit',
        { type: eventType, recipients: ['bob'] },
        aliceToken,
      );

      if (permitRes.status !== 403) {
        throw new Error(`expected_403_for_${eventType}_got_${permitRes.status}`);
      }
      if (permitRes.payload?.code !== 'forbidden') {
        throw new Error(`expected_forbidden_for_${eventType}_got_${String(permitRes.payload?.code)}`);
      }
    }
  } finally {
    await stopIds(ctx);
  }
});

test('relay permit allows friend metadata events and signs recipients claims', { timeout: 45000 }, async () => {
  const ctx = await startIds();
  try {
    await registerUser(ctx.port, 'alice');
    await registerUser(ctx.port, 'bob');

    const aliceToken = await loginUser(ctx.port, 'alice');
    const bobToken = await loginUser(ctx.port, 'bob');

    await makeFriends(ctx.port, aliceToken, bobToken, 'bob');

    const permitRes = await requestJson(
      ctx.port,
      'POST',
      '/v1/relay/permit',
      { type: 'profile_request', recipients: ['bob'] },
      aliceToken,
    );

    if (permitRes.status !== 200 || typeof permitRes.payload?.permit !== 'string') {
      throw new Error(`expected_200_with_permit_got_${permitRes.status}`);
    }

    const payload = jwt.verify(permitRes.payload.permit, ctx.secret, {
      algorithms: ['HS256'],
      audience: 'dl-rly',
      issuer: 'dl-ids',
    });

    if (String(payload?.sub ?? '') !== 'alice') {
      throw new Error('permit_subject_mismatch');
    }
    if (String(payload?.eventType ?? '') !== 'profile_request') {
      throw new Error('permit_event_type_mismatch');
    }

    const recipients = Array.isArray(payload?.recipients) ? payload.recipients.slice() : [];
    if (recipients.length !== 1 || recipients[0] !== 'bob') {
      throw new Error('permit_recipients_mismatch');
    }
  } finally {
    await stopIds(ctx);
  }
});
