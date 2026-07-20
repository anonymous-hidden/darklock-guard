import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
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
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dl-ids-channel-page-test-'));
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
    // ignore parse errors
  }

  return { status: res.status, payload };
}

async function registerAndLogin(port, userId) {
  const register = await requestJson(port, 'POST', '/v1/auth/register', {
    userId,
    email: `${userId}@security.test`,
    displayName: userId,
    password: `password-${userId}-1234`,
  });
  if (register.status !== 201) {
    throw new Error(`register_failed_${register.status}`);
  }

  const login = await requestJson(port, 'POST', '/v1/auth/login', {
    userId,
    password: `password-${userId}-1234`,
  });
  if (login.status !== 200 || !login.payload?.token) {
    throw new Error(`login_failed_${login.status}`);
  }

  return login.payload.token;
}

function seedChannelFixture(dbPath, ownerId) {
  const db = new Database(dbPath);
  try {
    const serverId = randomUUID();
    const channelAId = randomUUID();
    const channelBId = randomUUID();

    const aOldId = randomUUID();
    const aNewId = randomUUID();
    const bCursorId = randomUUID();

    db.prepare('INSERT INTO servers (id, name, owner_id) VALUES (?, ?, ?)')
      .run(serverId, 'Security Test Server', ownerId);
    db.prepare('INSERT INTO server_members (id, server_id, user_id) VALUES (?, ?, ?)')
      .run(randomUUID(), serverId, ownerId);

    db.prepare('INSERT INTO channels (id, server_id, name) VALUES (?, ?, ?)')
      .run(channelAId, serverId, 'alpha');
    db.prepare('INSERT INTO channels (id, server_id, name) VALUES (?, ?, ?)')
      .run(channelBId, serverId, 'beta');

    db.prepare(`
      INSERT INTO channel_messages (id, server_id, channel_id, author_id, content, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(aOldId, serverId, channelAId, ownerId, 'a-old', 'text', '2026-01-01T00:00:00.000Z');

    db.prepare(`
      INSERT INTO channel_messages (id, server_id, channel_id, author_id, content, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(aNewId, serverId, channelAId, ownerId, 'a-new', 'text', '2026-01-01T00:10:00.000Z');

    db.prepare(`
      INSERT INTO channel_messages (id, server_id, channel_id, author_id, content, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(bCursorId, serverId, channelBId, ownerId, 'b-foreign-cursor', 'text', '2026-12-31T23:59:59.000Z');

    return { serverId, channelAId, aOldId, aNewId, bCursorId };
  } finally {
    db.close();
  }
}

function seedChannelAuthorizationFixture(dbPath, ownerId, removedUserId) {
  const db = new Database(dbPath);
  try {
    const serverId = randomUUID();
    const channelAId = randomUUID();
    const channelBId = randomUUID();
    const messageAId = randomUUID();
    const messageBId = randomUUID();
    const pinId = randomUUID();

    db.prepare('INSERT INTO servers (id, name, owner_id) VALUES (?, ?, ?)')
      .run(serverId, 'Authorization Test Server', ownerId);
    db.prepare('INSERT INTO server_members (id, server_id, user_id) VALUES (?, ?, ?)')
      .run(randomUUID(), serverId, ownerId);
    db.prepare('INSERT INTO server_members (id, server_id, user_id) VALUES (?, ?, ?)')
      .run(randomUUID(), serverId, removedUserId);
    db.prepare('INSERT INTO channels (id, server_id, name) VALUES (?, ?, ?)')
      .run(channelAId, serverId, 'alpha');
    db.prepare('INSERT INTO channels (id, server_id, name) VALUES (?, ?, ?)')
      .run(channelBId, serverId, 'beta');
    db.prepare(`
      INSERT INTO channel_messages (id, server_id, channel_id, author_id, content, type)
      VALUES (?, ?, ?, ?, ?, 'text')
    `).run(messageAId, serverId, channelAId, removedUserId, 'historical-a');
    db.prepare(`
      INSERT INTO channel_messages (id, server_id, channel_id, author_id, content, type)
      VALUES (?, ?, ?, ?, ?, 'text')
    `).run(messageBId, serverId, channelBId, ownerId, 'historical-b');
    db.prepare(`
      INSERT INTO pinned_messages (id, dm_id, message_id, pinned_by)
      VALUES (?, ?, ?, ?)
    `).run(pinId, `${serverId}:${channelAId}`, messageAId, ownerId);
    db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?')
      .run(serverId, removedUserId);
    return { serverId, channelAId, channelBId, messageAId, messageBId, pinId };
  } finally {
    db.close();
  }
}

test('channel pagination rejects before message IDs from other channels', { timeout: 30000 }, async () => {
  const ctx = await startIds();
  try {
    const token = await registerAndLogin(ctx.port, 'alice');
    const fixture = seedChannelFixture(ctx.dbPath, 'alice');

    const res = await requestJson(
      ctx.port,
      'GET',
      `/servers/${fixture.serverId}/channels/${fixture.channelAId}/messages?before=${encodeURIComponent(fixture.bCursorId)}`,
      null,
      token,
    );

    if (res.status !== 400) {
      throw new Error(`expected_400_got_${res.status}`);
    }
    if (res.payload?.error !== 'invalid_before_cursor') {
      throw new Error(`expected_invalid_before_cursor_got_${String(res.payload?.error)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('channel pagination accepts same-channel before message ID', { timeout: 30000 }, async () => {
  const ctx = await startIds();
  try {
    const token = await registerAndLogin(ctx.port, 'alice');
    const fixture = seedChannelFixture(ctx.dbPath, 'alice');

    const res = await requestJson(
      ctx.port,
      'GET',
      `/servers/${fixture.serverId}/channels/${fixture.channelAId}/messages?before=${encodeURIComponent(fixture.aNewId)}`,
      null,
      token,
    );

    if (res.status !== 200 || !Array.isArray(res.payload)) {
      throw new Error(`expected_200_array_got_${res.status}`);
    }
    if (res.payload.length !== 1 || res.payload[0]?.id !== fixture.aOldId) {
      throw new Error('same_channel_before_cursor_filter_failed');
    }
  } finally {
    await stopIds(ctx);
  }
});

test('channel pagination accepts strict ISO-8601 and rejects invalid timestamp cursor', { timeout: 30000 }, async () => {
  const ctx = await startIds();
  try {
    const token = await registerAndLogin(ctx.port, 'alice');
    const fixture = seedChannelFixture(ctx.dbPath, 'alice');

    const valid = await requestJson(
      ctx.port,
      'GET',
      `/servers/${fixture.serverId}/channels/${fixture.channelAId}/messages?before=${encodeURIComponent('2026-01-01T00:05:00.000Z')}`,
      null,
      token,
    );

    if (valid.status !== 200 || !Array.isArray(valid.payload) || valid.payload.length !== 1) {
      throw new Error(`expected_valid_iso_cursor_success_got_${valid.status}`);
    }
    if (valid.payload[0]?.id !== fixture.aOldId) {
      throw new Error('valid_iso_cursor_did_not_filter_expected_message');
    }

    const invalid = await requestJson(
      ctx.port,
      'GET',
      `/servers/${fixture.serverId}/channels/${fixture.channelAId}/messages?before=${encodeURIComponent('2026-01-01 00:05:00')}`,
      null,
      token,
    );

    if (invalid.status !== 400) {
      throw new Error(`expected_invalid_cursor_400_got_${invalid.status}`);
    }
    if (invalid.payload?.error !== 'invalid_before_cursor') {
      throw new Error(`expected_invalid_before_cursor_got_${String(invalid.payload?.error)}`);
    }
  } finally {
    await stopIds(ctx);
  }
});

test('removed members cannot edit, delete, pin, or read channel state', { timeout: 30000 }, async () => {
  const ctx = await startIds();
  try {
    await registerAndLogin(ctx.port, 'alice');
    const bobToken = await registerAndLogin(ctx.port, 'bob');
    const fixture = seedChannelAuthorizationFixture(ctx.dbPath, 'alice', 'bob');
    const base = `/servers/${fixture.serverId}/channels/${fixture.channelAId}`;

    const edit = await requestJson(ctx.port, 'PATCH', `${base}/messages/${fixture.messageAId}`, {
      content: 'forged edit',
    }, bobToken);
    if (edit.status !== 403) throw new Error(`expected_removed_edit_403_got_${edit.status}`);

    const remove = await requestJson(ctx.port, 'DELETE', `${base}/messages/${fixture.messageAId}`, null, bobToken);
    if (remove.status !== 403) throw new Error(`expected_removed_delete_403_got_${remove.status}`);

    const pins = await requestJson(ctx.port, 'GET', `${base}/pins`, null, bobToken);
    if (pins.status !== 403) throw new Error(`expected_removed_pins_403_got_${pins.status}`);

    const read = await requestJson(ctx.port, 'PUT', `${base}/read`, {
      last_read_message_id: fixture.messageAId,
    }, bobToken);
    if (read.status !== 403) throw new Error(`expected_removed_read_403_got_${read.status}`);
  } finally {
    await stopIds(ctx);
  }
});

test('pins and read markers are scoped to the requested channel', { timeout: 30000 }, async () => {
  const ctx = await startIds();
  try {
    const aliceToken = await registerAndLogin(ctx.port, 'alice');
    await registerAndLogin(ctx.port, 'bob');
    const fixture = seedChannelAuthorizationFixture(ctx.dbPath, 'alice', 'bob');
    const channelB = `/servers/${fixture.serverId}/channels/${fixture.channelBId}`;

    const crossPin = await requestJson(ctx.port, 'POST', `${channelB}/pins`, {
      message_id: fixture.messageAId,
      content_preview: 'untrusted plaintext',
    }, aliceToken);
    if (crossPin.status !== 404) throw new Error(`expected_cross_pin_404_got_${crossPin.status}`);

    const crossUnpin = await requestJson(ctx.port, 'DELETE', `${channelB}/pins/${fixture.pinId}`, null, aliceToken);
    if (crossUnpin.status !== 404) throw new Error(`expected_cross_unpin_404_got_${crossUnpin.status}`);

    const forgedRead = await requestJson(ctx.port, 'PUT', `${channelB}/read`, {
      last_read_message_id: fixture.messageAId,
      last_read_at: '2099-01-01T00:00:00.000Z',
    }, aliceToken);
    if (forgedRead.status !== 400) throw new Error(`expected_cross_read_400_got_${forgedRead.status}`);
  } finally {
    await stopIds(ctx);
  }
});
