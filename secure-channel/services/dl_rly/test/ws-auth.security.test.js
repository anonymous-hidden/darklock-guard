import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = path.resolve(__dirname, '..');

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed_to_get_port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRelayEnv({ port, tempDir, secret, overrides = {} }) {
  // Only RLY_JWT_SECRET is set — JWT_SECRET and IDS_JWT_SECRET are deliberately
  // absent to prevent masking any fallback bypass in the relay.
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    RLY_PORT: String(port),
    RLY_JWT_SECRET: secret,
    RLY_DB_PATH: path.join(tempDir, 'rly.db'),
    RLY_QUEUE_PATH: path.join(tempDir, 'queue.db'),
  };

  // Strip any inherited fallback vars from the parent process environment.
  delete env.JWT_SECRET;
  delete env.IDS_JWT_SECRET;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete env[key];
      continue;
    }
    env[key] = value;
  }

  return env;
}

async function waitForHealth(port, child, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`relay_exited_early_${child.exitCode}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(100);
  }
  throw new Error('relay_health_timeout');
}

async function startRelay(overrides = {}) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dl-rly-test-'));
  const port = await getFreePort();
  const secret = 'relay-test-secret-0123456789abcdef0123456789';

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVICE_DIR,
    env: buildRelayEnv({ port, tempDir, secret, overrides }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForHealth(port, child);
  return { child, port, secret, tempDir };
}

async function startRelayExpectFailure(extraEnv = {}) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dl-rly-test-fail-'));
  const port = await getFreePort();
  const secret = 'relay-test-secret-0123456789abcdef0123456789';
  const stderrChunks = [];

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVICE_DIR,
    env: buildRelayEnv({ port, tempDir, secret, overrides: extraEnv }),
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

async function stopRelay(ctx) {
  if (!ctx) return;
  const { child, tempDir } = ctx;

  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(2000),
    ]);
  }
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(2000),
    ]);
  }

  rmSync(tempDir, { recursive: true, force: true });
}

async function expectServerRejectsAuth(port, authPayload, expectedError) {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let sawExpectedError = false;

    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('auth_rejection_timeout'));
    }, 2500);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', ...authPayload }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type === 'error' && msg?.error === expectedError) {
          sawExpectedError = true;
        }
      } catch {
        // ignore
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (!sawExpectedError) {
        reject(new Error(`expected_error_not_received_${expectedError}`));
        return;
      }
      resolve();
    });

    ws.on('error', () => {
      // ignore; close handler validates outcome
    });
  });
}

async function expectAuthAndPong(port, authPayload, wsOptions = {}) {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, wsOptions);
    let gotPong = false;

    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('auth_success_timeout'));
    }, 3000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', ...authPayload }));
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type === 'error') {
          clearTimeout(timer);
          ws.terminate();
          reject(new Error(`unexpected_error_${msg.error ?? 'unknown'}`));
          return;
        }
        if (msg?.type === 'pong') {
          gotPong = true;
          ws.close();
        }
      } catch {
        // ignore
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (!gotPong) {
        reject(new Error('missing_pong_after_auth'));
        return;
      }
      resolve();
    });

    ws.on('error', () => {
      // ignore; close/message handlers validate outcome
    });
  });
}

async function connectAuthedWs(port, authPayload, wsOptions = {}) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, wsOptions);
    const pendingMessages = [];
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('connect_authed_timeout'));
    }, 3000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', ...authPayload }));
      ws.send(JSON.stringify({ type: 'ping' }));
    });

    const onAuthMessage = (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type === 'error') {
          clearTimeout(timer);
          ws.terminate();
          reject(new Error(`auth_failed_${msg.error ?? 'unknown'}`));
          return;
        }
        if (msg?.type === 'pong') {
          clearTimeout(timer);
          ws.__pendingMessages = pendingMessages;
          ws.removeListener('message', onAuthMessage);
          resolve(ws);
          return;
        }
        pendingMessages.push(msg);
      } catch {
        // ignore
      }
    };
    ws.on('message', onAuthMessage);

    ws.on('error', () => {
      // errors are surfaced via timeout/reject paths above
    });
  });
}

async function waitForEnvelope(ws, matcher, timeoutMs = 3000) {
  return await new Promise((resolve, reject) => {
    const pending = Array.isArray(ws.__pendingMessages) ? ws.__pendingMessages : [];
    const pendingIdx = pending.findIndex((msg) => matcher(msg));
    if (pendingIdx >= 0) {
      const [found] = pending.splice(pendingIdx, 1);
      resolve(found);
      return;
    }

    const timer = setTimeout(() => {
      ws.removeListener('message', onMessage);
      reject(new Error('envelope_timeout'));
    }, timeoutMs);

    const onMessage = (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (matcher(msg)) {
          clearTimeout(timer);
          ws.removeListener('message', onMessage);
          resolve(msg);
        }
      } catch {
        // ignore
      }
    };

    ws.on('message', onMessage);
  });
}

function closeWs(ws) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.once('close', resolve);
    ws.close();
    setTimeout(resolve, 1000);
  });
}

function issueRelayPermit(secret, claims, expiresIn = '60s') {
  return jwt.sign(
    {
      type: 'relay_send_permit',
      ...claims,
    },
    secret,
    {
      algorithm: 'HS256',
      audience: 'dl-rly',
      issuer: 'dl-ids',
      expiresIn,
    },
  );
}

function issueAccessToken(secret, subject, overrides = {}) {
  return jwt.sign(
    { sub: subject, username: subject, type: 'access', ...overrides },
    secret,
    {
      algorithm: 'HS256',
      issuer: 'dl-ids',
      audience: 'ridgeline-services',
      expiresIn: '15m',
    },
  );
}

test('refuses startup when dev tokens are enabled outside development', { timeout: 15000 }, async () => {
  const { exitCode } = await startRelayExpectFailure({ RLY_ALLOW_DEV_TOKENS: '1' });
  if (exitCode !== 1) {
    throw new Error(`expected_exit_code_1_got_${String(exitCode)}`);
  }
});

test('refuses startup when RLY_JWT_SECRET is missing (no fallback)', { timeout: 15000 }, async () => {
  const { exitCode, stderr } = await startRelayExpectFailure({
    RLY_JWT_SECRET: '   ',
    JWT_SECRET: 'fallback-secret-0123456789abcdef0123456789',
    IDS_JWT_SECRET: 'fallback-secret-0123456789abcdef0123456789',
  });

  if (exitCode !== 1) {
    throw new Error(`expected_exit_code_1_got_${String(exitCode)}`);
  }
  if (!stderr.includes('[RLY_STARTUP_CONFIGURATION_INVALID]')) {
    throw new Error('missing_required_secret_error_message');
  }
});

test('refuses startup when RLY_JWT_SECRET is too short', { timeout: 15000 }, async () => {
  const { exitCode, stderr } = await startRelayExpectFailure({
    RLY_JWT_SECRET: 'short-secret',
  });

  if (exitCode !== 1) {
    throw new Error(`expected_exit_code_1_got_${String(exitCode)}`);
  }
  if (!stderr.includes('[RLY_STARTUP_CONFIGURATION_INVALID]')) {
    throw new Error('missing_short_secret_error_message');
  }
});

test('refuses startup when RLY_JWT_SECRET is a placeholder value', { timeout: 15000 }, async () => {
  const { exitCode, stderr } = await startRelayExpectFailure({
    RLY_JWT_SECRET: 'CHANGE_ME_generate_with_openssl_rand_hex_32',
  });

  if (exitCode !== 1) {
    throw new Error(`expected_exit_code_1_got_${String(exitCode)}`);
  }
  if (!stderr.includes('[RLY_STARTUP_CONFIGURATION_INVALID]')) {
    throw new Error('missing_weak_secret_error_message');
  }
});

test('refuses startup when RLY_ALLOWED_ORIGINS is missing in production', { timeout: 15000 }, async () => {
  const { exitCode, stderr } = await startRelayExpectFailure({
    NODE_ENV: 'production',
    RLY_ALLOWED_ORIGINS: null,
  });

  if (exitCode !== 1) {
    throw new Error(`expected_exit_code_1_got_${String(exitCode)}`);
  }
  if (!stderr.includes('[RLY_STARTUP_CONFIGURATION_INVALID]')) {
    throw new Error('missing_required_rly_allowed_origins_error');
  }
});

test('refuses startup when RLY_ALLOWED_ORIGINS contains wildcard in production', { timeout: 15000 }, async () => {
  const { exitCode, stderr } = await startRelayExpectFailure({
    NODE_ENV: 'production',
    RLY_ALLOWED_ORIGINS: '*',
  });

  if (exitCode !== 1) {
    throw new Error(`expected_exit_code_1_got_${String(exitCode)}`);
  }
  if (!stderr.includes('[RLY_STARTUP_CONFIGURATION_INVALID]')) {
    throw new Error('missing_rly_wildcard_rejection_error');
  }
});

test('rejects disallowed HTTP Origin with 403', { timeout: 20000 }, async () => {
  const ctx = await startRelay({ RLY_ALLOWED_ORIGINS: 'https://app.darklock.net' });
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
    await stopRelay(ctx);
  }
});

test('allows configured HTTP Origin and emits CORS header', { timeout: 20000 }, async () => {
  const allowedOrigin = 'https://app.darklock.net';
  const ctx = await startRelay({ RLY_ALLOWED_ORIGINS: allowedOrigin });
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
    await stopRelay(ctx);
  }
});

test('rejects websocket connection from disallowed Origin', { timeout: 20000 }, async () => {
  const ctx = await startRelay({ RLY_ALLOWED_ORIGINS: 'https://app.darklock.net' });
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`, {
        headers: { Origin: 'https://evil.darklock.attacker' },
      });

      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('disallowed_origin_ws_timeout'));
      }, 3000);

      ws.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 1008) {
          reject(new Error(`expected_close_code_1008_got_${code}`));
          return;
        }
        resolve();
      });

      ws.on('error', () => {
        // close handler validates outcome
      });
    });
  } finally {
    await stopRelay(ctx);
  }
});

test('rejects auth when claimed userId mismatches JWT subject', { timeout: 15000 }, async () => {
  const ctx = await startRelay();
  try {
    const token = issueAccessToken(ctx.secret, 'alice');

    await expectServerRejectsAuth(ctx.port, {
      userId: 'bob',
      token,
    }, 'userid_mismatch');
  } finally {
    await stopRelay(ctx);
  }
});

test('rejects dev bypass token', { timeout: 15000 }, async () => {
  const ctx = await startRelay();
  try {
    await expectServerRejectsAuth(ctx.port, {
      userId: 'alice',
      token: 'dev-bypass-token',
    }, 'unauthorized');
  } finally {
    await stopRelay(ctx);
  }
});

test('accepts auth when JWT subject matches userId', { timeout: 15000 }, async () => {
  const ctx = await startRelay();
  try {
    const token = issueAccessToken(ctx.secret, 'alice');

    await expectAuthAndPong(ctx.port, {
      userId: 'alice',
      token,
    });
  } finally {
    await stopRelay(ctx);
  }
});

test('rejects access tokens missing strict issuer and audience claims', { timeout: 15000 }, async () => {
  const ctx = await startRelay();
  try {
    const looseToken = jwt.sign(
      { sub: 'alice', username: 'alice', type: 'access' },
      ctx.secret,
      { algorithm: 'HS256', expiresIn: '15m' },
    );
    await expectServerRejectsAuth(ctx.port, { userId: 'alice', token: looseToken }, 'unauthorized');
  } finally {
    await stopRelay(ctx);
  }
});

test('REST send requires a recipient-bound permit and receipts require envelope ownership', { timeout: 20000 }, async () => {
  const ctx = await startRelay();
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');
    const headers = (token) => ({
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    });

    const missingPermit = await fetch(`http://127.0.0.1:${ctx.port}/send`, {
      method: 'POST',
      headers: headers(aliceToken),
      body: JSON.stringify({ recipient_id: 'bob', ciphertext: 'opaque-ciphertext' }),
    });
    if (missingPermit.status !== 403) throw new Error(`expected_missing_permit_403_got_${missingPermit.status}`);

    const permit = issueRelayPermit(ctx.secret, { sub: 'alice', eventType: 'message', to: 'bob' });
    const send = await fetch(`http://127.0.0.1:${ctx.port}/send`, {
      method: 'POST',
      headers: headers(aliceToken),
      body: JSON.stringify({ recipient_id: 'bob', ciphertext: 'opaque-ciphertext', permit }),
    });
    if (send.status !== 201) throw new Error(`expected_send_201_got_${send.status}`);
    const { envelope_id: envelopeId } = await send.json();

    const forgedReceipt = await fetch(`http://127.0.0.1:${ctx.port}/receipt`, {
      method: 'POST',
      headers: headers(aliceToken),
      body: JSON.stringify({ envelope_id: envelopeId, status: 'read' }),
    });
    if (forgedReceipt.status !== 404) throw new Error(`expected_forged_receipt_404_got_${forgedReceipt.status}`);

    const ownedReceipt = await fetch(`http://127.0.0.1:${ctx.port}/receipt`, {
      method: 'POST',
      headers: headers(bobToken),
      body: JSON.stringify({ envelope_id: envelopeId, status: 'delivered' }),
    });
    if (!ownedReceipt.ok) throw new Error(`expected_owned_receipt_ok_got_${ownedReceipt.status}`);

    const forgedAck = await fetch(`http://127.0.0.1:${ctx.port}/ack`, {
      method: 'POST',
      headers: headers(aliceToken),
      body: JSON.stringify({ envelope_ids: [envelopeId] }),
    });
    if ((await forgedAck.json()).acked !== 0) throw new Error('forged_ack_mutated_envelope');

    const ownedAck = await fetch(`http://127.0.0.1:${ctx.port}/ack`, {
      method: 'POST',
      headers: headers(bobToken),
      body: JSON.stringify({ envelope_ids: [envelopeId] }),
    });
    if ((await ownedAck.json()).acked !== 1) throw new Error('owned_ack_did_not_commit');
  } finally {
    await stopRelay(ctx);
  }
});

test('rejects message edits and deletes while ownership cannot be proven', { timeout: 15000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  try {
    aliceWs = await connectAuthedWs(ctx.port, {
      token: issueAccessToken(ctx.secret, 'alice'),
      userId: 'alice',
    });
    const editRejection = waitForEnvelope(aliceWs, (message) => message?.type === 'error');
    aliceWs.send(JSON.stringify({ type: 'edit_message', to: 'bob', messageId: 'message-1' }));
    const editResult = await editRejection;
    if (editResult.error !== 'message_edits_disabled_security') {
      throw new Error(`unexpected_edit_rejection_${editResult.error ?? 'missing'}`);
    }
    const deleteRejection = waitForEnvelope(aliceWs, (message) => message?.type === 'error');
    aliceWs.send(JSON.stringify({ type: 'delete_message', to: 'bob', messageId: 'message-1' }));
    const deleteResult = await deleteRejection;
    if (deleteResult.error !== 'message_deletes_disabled_security') {
      throw new Error(`unexpected_delete_rejection_${deleteResult.error ?? 'missing'}`);
    }
  } finally {
    await closeWs(aliceWs);
    await stopRelay(ctx);
  }
});

test('forwards envelopes using verified JWT subject as sender identity', { timeout: 20000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken });
    const permit = issueRelayPermit(ctx.secret, {
      sub: 'alice',
      eventType: 'message',
      to: 'bob',
    });

    aliceWs.send(JSON.stringify({
      type: 'message',
      to: 'bob',
      payload: 'hello',
      id: 'msg-1',
      permit,
    }));

    const msg = await waitForEnvelope(bobWs, (m) => m?.type === 'message' && m?.id === 'msg-1');
    if (msg.from !== 'alice') {
      throw new Error(`expected_from_alice_got_${String(msg.from)}`);
    }
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('rejects re-auth on an already-authenticated socket', { timeout: 20000 }, async () => {
  const ctx = await startRelay();
  let ws;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    // Authenticate as alice, then attempt to rebind identity to bob on the same socket.
    ws = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    await new Promise((resolve, reject) => {
      let sawError = false;
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('re_auth_rebind_not_rejected_timeout'));
      }, 3000);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(String(data));
          if (msg?.type === 'error' && msg?.error === 'already_authenticated') {
            sawError = true;
          }
        } catch { /* ignore */ }
      });

      ws.on('close', () => {
        clearTimeout(timer);
        if (!sawError) {
          reject(new Error('re_auth_rebind_not_rejected'));
          return;
        }
        resolve();
      });

      ws.send(JSON.stringify({ type: 'auth', token: bobToken, userId: 'bob' }));
    });
    ws = null;
  } finally {
    await closeWs(ws);
    await stopRelay(ctx);
  }
});

test('drains offline queue only for verified JWT subject', { timeout: 25000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    // Bob is offline; queue one message destined for bob.
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });
    const permit = issueRelayPermit(ctx.secret, {
      sub: 'alice',
      eventType: 'message',
      to: 'bob',
    });
    aliceWs.send(JSON.stringify({
      type: 'message',
      to: 'bob',
      payload: 'queued',
      id: 'queued-1',
      permit,
    }));
    await sleep(150);

    // Alice cannot impersonate bob to drain bob's queue.
    await expectServerRejectsAuth(ctx.port, {
      token: aliceToken,
      userId: 'bob',
    }, 'userid_mismatch');

    // Real bob login gets the queued envelope.
    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    const queued = await waitForEnvelope(bobWs, (m) => m?.type === 'message' && m?.id === 'queued-1');
    if (queued.from !== 'alice') {
      throw new Error(`expected_from_alice_got_${String(queued.from)}`);
    }
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('rejects expired relay send permit', { timeout: 20000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    const expiredPermit = issueRelayPermit(ctx.secret, {
      sub: 'alice',
      eventType: 'message',
      to: 'bob',
    }, '-1s');

    aliceWs.send(JSON.stringify({
      type: 'message',
      to: 'bob',
      payload: 'should-not-deliver',
      id: 'expired-1',
      permit: expiredPermit,
    }));

    await waitForEnvelope(aliceWs, (m) => m?.type === 'error' && m?.error === 'expired_permit');

    let delivered = false;
    try {
      await waitForEnvelope(bobWs, (m) => m?.type === 'message' && m?.id === 'expired-1', 700);
      delivered = true;
    } catch {
      // expected timeout
    }
    if (delivered) {
      throw new Error('expired_permit_message_was_forwarded');
    }
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('rejects mismatched relay send permit recipient', { timeout: 20000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    const mismatchedPermit = issueRelayPermit(ctx.secret, {
      sub: 'alice',
      eventType: 'message',
      to: 'charlie',
    });

    aliceWs.send(JSON.stringify({
      type: 'message',
      to: 'bob',
      payload: 'should-not-deliver',
      id: 'mismatch-1',
      permit: mismatchedPermit,
    }));

    await waitForEnvelope(aliceWs, (m) => m?.type === 'error' && m?.error === 'permit_recipient_mismatch');

    let delivered = false;
    try {
      await waitForEnvelope(bobWs, (m) => m?.type === 'message' && m?.id === 'mismatch-1', 700);
      delivered = true;
    } catch {
      // expected timeout
    }
    if (delivered) {
      throw new Error('mismatched_permit_message_was_forwarded');
    }
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('rejects group_message before routing while containment is active', { timeout: 20000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    const recipients = ['bob', ...Array.from({ length: 70 }, (_, i) => `user-${i}`)];
    const permit = issueRelayPermit(ctx.secret, {
      sub: 'alice',
      eventType: 'group_message',
      recipients,
      groupId: 'group-oversized',
    });

    aliceWs.send(JSON.stringify({
      type: 'group_message',
      groupId: 'group-oversized',
      recipients,
      payload: 'ciphertext',
      id: 'group-oversized-1',
      permit,
    }));

    await waitForEnvelope(aliceWs, (m) => m?.type === 'error' && m?.error === 'group_messaging_disabled_security');

    let delivered = false;
    try {
      await waitForEnvelope(bobWs, (m) => m?.type === 'group_message' && m?.id === 'group-oversized-1', 700);
      delivered = true;
    } catch {
      // expected timeout
    }
    if (delivered) {
      throw new Error('oversized_group_message_was_forwarded');
    }
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('rejects group_message even when its permit is valid', { timeout: 20000 }, async () => {
  const ctx = await startRelay({ RLY_ALLOWED_ORIGINS: 'http://localhost:3000' });
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    const recipients = ['bob'];
    const permit = issueRelayPermit(ctx.secret, {
      sub: 'alice',
      eventType: 'group_message',
      recipients,
      groupId: 'group-room',
    });

    aliceWs.send(JSON.stringify({
      type: 'group_message',
      groupId: 'group-room',
      channelId: 'channel-ops',
      channelName: 'operations',
      recipients,
      payload: 'ciphertext',
      id: 'group-room-1',
      permit,
    }));

    await waitForEnvelope(aliceWs, (m) => m?.type === 'error' && m?.error === 'group_messaging_disabled_security');
    await waitForEnvelope(bobWs, (m) => m?.type === 'group_message' && m?.id === 'group-room-1', 500)
      .then(() => { throw new Error('contained_group_message_was_forwarded'); }, () => {});
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('rejects group settings updates while containment is active', { timeout: 20000 }, async () => {
  const ctx = await startRelay({ RLY_ALLOWED_ORIGINS: 'http://localhost:3000' });
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    const recipients = ['bob'];
    const permit = issueRelayPermit(ctx.secret, {
      sub: 'alice',
      eventType: 'group_settings_update',
      recipients,
      groupId: 'group-room',
    });

    aliceWs.send(JSON.stringify({
      type: 'group_settings_update',
      groupId: 'group-room',
      recipients,
      settings: {
        theme: {
          bgType: 'solid',
          bgValue: '#111318',
        },
      },
      permit,
    }));

    await waitForEnvelope(aliceWs, (m) => m?.type === 'error' && m?.error === 'group_messaging_disabled_security');
    await waitForEnvelope(bobWs, (m) => m?.type === 'group_settings_update', 500)
      .then(() => { throw new Error('contained_group_settings_were_forwarded'); }, () => {});
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('rejects typing event without permit', { timeout: 20000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    aliceWs.send(JSON.stringify({
      type: 'typing',
      to: 'bob',
      conversationId: 'alice:bob',
    }));

    await waitForEnvelope(aliceWs, (m) => m?.type === 'error' && m?.error === 'missing_permit');

    let delivered = false;
    try {
      await waitForEnvelope(bobWs, (m) => m?.type === 'typing' && m?.from === 'alice', 700);
      delivered = true;
    } catch {
      // expected timeout
    }
    if (delivered) {
      throw new Error('typing_without_permit_was_forwarded');
    }
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('enforces per-user typing rate limits across multiple sockets', { timeout: 25000 }, async () => {
  const ctx = await startRelay();
  let aliceWsA;
  let aliceWsB;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWsA = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });
    aliceWsB = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    const permit = issueRelayPermit(ctx.secret, {
      sub: 'alice',
      eventType: 'typing',
      to: 'bob',
    });

    for (let i = 0; i < 25; i += 1) {
      aliceWsA.send(JSON.stringify({
        type: 'typing',
        to: 'bob',
        conversationId: 'alice:bob',
        permit,
      }));
    }

    await sleep(50);

    for (let i = 0; i < 25; i += 1) {
      aliceWsB.send(JSON.stringify({
        type: 'typing',
        to: 'bob',
        conversationId: 'alice:bob',
        permit,
      }));
    }

    await Promise.race([
      waitForEnvelope(aliceWsA, (m) => m?.type === 'error' && m?.error === 'rate_limited', 4000),
      waitForEnvelope(aliceWsB, (m) => m?.type === 'error' && m?.error === 'rate_limited', 4000),
    ]);
  } finally {
    await closeWs(aliceWsA);
    await closeWs(aliceWsB);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('rejects group invites while containment is active', { timeout: 22000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    const permit = issueRelayPermit(ctx.secret, {
      sub: 'alice',
      eventType: 'group_invite',
      recipients: ['charlie'],
      groupId: 'group-1',
    });

    aliceWs.send(JSON.stringify({
      type: 'group_invite',
      groupId: 'group-1',
      groupName: 'Test Group',
      members: [{ userId: 'alice', role: 'admin', joinedAt: Date.now() }],
      recipients: ['bob'],
      permit,
    }));

    await waitForEnvelope(aliceWs, (m) => m?.type === 'error' && m?.error === 'group_messaging_disabled_security');

    let delivered = false;
    try {
      await waitForEnvelope(bobWs, (m) => m?.type === 'group_invite' && m?.groupId === 'group-1', 700);
      delivered = true;
    } catch {
      // expected timeout
    }
    if (delivered) {
      throw new Error('group_invite_with_mismatched_permit_was_forwarded');
    }
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('rejects subscribe_presence without permit', { timeout: 20000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    aliceWs.send(JSON.stringify({
      type: 'subscribe_presence',
      userIds: ['bob'],
    }));

    await waitForEnvelope(aliceWs, (m) => m?.type === 'error' && m?.error === 'missing_permit');
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('rejects subscribe_presence when permit recipients mismatch', { timeout: 20000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    const mismatchedPermit = issueRelayPermit(ctx.secret, {
      sub: 'alice',
      eventType: 'subscribe_presence',
      recipients: ['charlie'],
    });

    aliceWs.send(JSON.stringify({
      type: 'subscribe_presence',
      userIds: ['bob'],
      permit: mismatchedPermit,
    }));

    await waitForEnvelope(aliceWs, (m) => m?.type === 'error' && m?.error === 'permit_recipients_mismatch');
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('rejects profile_request without permit and does not leak profile_data', { timeout: 22000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    bobWs.send(JSON.stringify({
      type: 'profile_sync',
      profile: { displayName: 'Bob', bio: 'hello' },
    }));
    await sleep(100);

    aliceWs.send(JSON.stringify({
      type: 'profile_request',
      userIds: ['bob'],
    }));

    await waitForEnvelope(aliceWs, (m) => m?.type === 'error' && m?.error === 'missing_permit');

    let leaked = false;
    try {
      await waitForEnvelope(aliceWs, (m) => m?.type === 'profile_data' && m?.userId === 'bob', 700);
      leaked = true;
    } catch {
      // expected timeout
    }
    if (leaked) {
      throw new Error('profile_data_leaked_without_permit');
    }
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});

test('allows profile_request with a valid metadata permit', { timeout: 22000 }, async () => {
  const ctx = await startRelay();
  let aliceWs;
  let bobWs;
  try {
    const aliceToken = issueAccessToken(ctx.secret, 'alice');
    const bobToken = issueAccessToken(ctx.secret, 'bob');

    bobWs = await connectAuthedWs(ctx.port, { token: bobToken, userId: 'bob' });
    aliceWs = await connectAuthedWs(ctx.port, { token: aliceToken, userId: 'alice' });

    bobWs.send(JSON.stringify({
      type: 'profile_sync',
      profile: { displayName: 'Bob', bio: 'hello' },
    }));
    await sleep(100);

    const permit = issueRelayPermit(ctx.secret, {
      sub: 'alice',
      eventType: 'profile_request',
      recipients: ['bob'],
    });

    aliceWs.send(JSON.stringify({
      type: 'profile_request',
      userIds: ['bob'],
      permit,
    }));

    const profileData = await waitForEnvelope(
      aliceWs,
      (m) => m?.type === 'profile_data' && m?.userId === 'bob',
    );
    if (!profileData?.profile || profileData.profile.displayName !== 'Bob') {
      throw new Error('expected_profile_data_not_received');
    }
  } finally {
    await closeWs(aliceWs);
    await closeWs(bobWs);
    await stopRelay(ctx);
  }
});
