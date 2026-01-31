/* eslint-disable @typescript-eslint/no-var-requires */
// Ensure secrets and database URL are present before loading app/pool
const secret = process.env.API_JWT_SECRET || 'test-secret';
process.env.API_JWT_SECRET = secret;
if (!process.env.SERVER_SIGNING_SEED) {
  const signingSeed = require('crypto').randomBytes(32);
  process.env.SERVER_SIGNING_SEED = signingSeed.toString('base64');
}
if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createApp } = require('../src/app');
const { pool } = require('../src/db/pool');
const { runMigrations } = require('../src/db/migrate');

function serverToken() {
  return jwt.sign({ sub: 'server', role: 'server' }, secret, { expiresIn: '1h' });
}

function deviceToken(deviceId: string, profile: 'NORMAL' | 'ZERO_TRUST' = 'NORMAL') {
  return jwt.sign({ sub: deviceId, role: 'device', securityProfile: profile }, secret, { expiresIn: '1h' });
}

async function resetDb() {
  await pool.query('TRUNCATE device_commands, audit_logs, releases, devices RESTART IDENTITY CASCADE');
}

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await pool.end();
});

describe('command creation', () => {
  test('returns 403 for ZERO_TRUST devices', async () => {
    const device = await pool.query(
      `INSERT INTO devices (security_profile, link_code) VALUES ('ZERO_TRUST', 'code1') RETURNING id`,
    );
    const deviceId = device.rows[0].id as string;

    const app = createApp();
    const res = await request(app)
      .post(`/api/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${serverToken()}`)
      .send({ command: 'restart', nonce: 'n-1', signature: 'sig' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('zero_trust_forbidden');
  });

  test('replay (nonce reuse) is rejected', async () => {
    const device = await pool.query(
      `INSERT INTO devices (security_profile, link_code) VALUES ('NORMAL', 'code2') RETURNING id`,
    );
    const deviceId = device.rows[0].id as string;
    const app = createApp();

    const first = await request(app)
      .post(`/api/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${serverToken()}`)
      .send({ command: 'restart', nonce: 'dup', signature: 'sig' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${serverToken()}`)
      .send({ command: 'restart', nonce: 'dup', signature: 'sig' });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('nonce_reuse');
  });
});

describe('command results', () => {
  test('invalid signature rejected', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicRaw = publicKey.export({ format: 'raw' }) as Buffer;
    const publicB64 = publicRaw.toString('base64');

    const device = await pool.query(
      `INSERT INTO devices (security_profile, link_code, public_key) VALUES ('NORMAL', 'code3', $1) RETURNING id`,
      [publicB64],
    );
    const deviceId = device.rows[0].id as string;

    const inserted = await pool.query(
      `INSERT INTO device_commands (device_id, command, payload, nonce, signature, status, expires_at)
       VALUES ($1, 'restart', '{}', 'abc', 'serversig', 'PENDING', now() + interval '5 minutes')
       RETURNING id`,
      [deviceId],
    );
    const commandId = inserted.rows[0].id as string;

    const app = createApp();
    const res = await request(app)
      .post(`/api/devices/${deviceId}/commands/${commandId}/result`)
      .set('Authorization', `Bearer ${deviceToken(deviceId)}`)
      .send({ status: 'succeeded', nonce: 'abc', signature: 'bad', result: { ok: true } });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_signature');
  });

  test('expired command is rejected', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicRaw = publicKey.export({ format: 'raw' }) as Buffer;
    const publicB64 = publicRaw.toString('base64');

    const device = await pool.query(
      `INSERT INTO devices (security_profile, link_code, public_key) VALUES ('NORMAL', 'code4', $1) RETURNING id`,
      [publicB64],
    );
    const deviceId = device.rows[0].id as string;

    const inserted = await pool.query(
      `INSERT INTO device_commands (device_id, command, payload, nonce, signature, status, expires_at)
       VALUES ($1, 'restart', '{}', 'zzz', 'serversig', 'PENDING', now() - interval '1 minute')
       RETURNING id`,
      [deviceId],
    );
    const commandId = inserted.rows[0].id as string;

    const app = createApp();
    const res = await request(app)
      .post(`/api/devices/${deviceId}/commands/${commandId}/result`)
      .set('Authorization', `Bearer ${deviceToken(deviceId)}`)
      .send({ status: 'succeeded', nonce: 'zzz', signature: 'anything' });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('command_expired');
  });
});

describe('releases api', () => {
  test('returns releases with product, file_size, changelog', async () => {
    await pool.query(
      `INSERT INTO releases (product, os, channel, version, url, checksum, signature, file_size, changelog)
       VALUES ('Guard', 'Windows', 'stable', '2.1.0', 'https://example.com/guard.exe', 'abc', 'sig', '45 MB', '[{"type":"added","text":"New feature"}]'::jsonb)`,
    );

    const app = createApp();
    const res = await request(app).get('/api/releases');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.releases)).toBe(true);
    expect(res.body.releases[0]).toMatchObject({
      product: 'Guard',
      file_size: '45 MB',
      changelog: [{ type: 'added', text: 'New feature' }],
    });
  });
});

describe('device events api', () => {
  test('paginates audit log events', async () => {
    const device = await pool.query(
      `INSERT INTO devices (security_profile, link_code) VALUES ('NORMAL', 'code-events') RETURNING id`,
    );
    const deviceId = device.rows[0].id as string;

    await pool.query(
      `INSERT INTO audit_logs (device_id, action, path, method, status, metadata, created_at)
       VALUES ($1, 'heartbeat', '/api/devices/${deviceId}/heartbeat', 'POST', 200, '{}', now()),
              ($1, 'command', '/api/devices/${deviceId}/commands', 'POST', 201, '{"cmd":"refresh"}', now() - interval '1 minute'),
              ($1, 'link', '/api/devices/link', 'POST', 200, '{}', now() - interval '2 minutes')`,
      [deviceId],
    );

    const app = createApp();
    const res = await request(app)
      .get(`/api/devices/${deviceId}/events?limit=2`)
      .set('Authorization', `Bearer ${serverToken()}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBe(2);
    expect(res.body.events[0].action).toBe('heartbeat');
    expect(res.body.nextCursor).toBeTruthy();
  });
});

describe('request logs command', () => {
  test('normal device completes request logs and returns artifact URL', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicRaw = publicKey.export({ format: 'raw' }) as Buffer;
    const publicB64 = publicRaw.toString('base64');

    const device = await pool.query(
      `INSERT INTO devices (security_profile, link_code, public_key) VALUES ('NORMAL', 'code-logs', $1) RETURNING id`,
      [publicB64],
    );
    const deviceId = device.rows[0].id as string;
    const app = createApp();

    const createRes = await request(app)
      .post(`/api/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${serverToken()}`)
      .send({ command_type: 'REQUEST_LOGS' });

    expect(createRes.status).toBe(201);
    const commandId = createRes.body.commandId as string;
    expect(commandId).toBeTruthy();

    const commandRow = await pool.query('SELECT nonce FROM device_commands WHERE id = $1', [commandId]);
    const nonce = commandRow.rows[0].nonce as string;

    // Simulate device completing
    const message = JSON.stringify({ commandId, nonce, status: 'succeeded', result: { artifact_url: 'https://logs.example.com/file.zip' } });
    const sig = crypto.sign(null, Buffer.from(message), privateKey).toString('base64');

    const resultRes = await request(app)
      .post(`/api/devices/${deviceId}/commands/${commandId}/result`)
      .set('Authorization', `Bearer ${deviceToken(deviceId)}`)
      .send({ status: 'succeeded', nonce, signature: sig, result: { artifact_url: 'https://logs.example.com/file.zip' } });

    expect(resultRes.status).toBe(200);

    const commands = await pool.query('SELECT status, result FROM device_commands WHERE id = $1', [commandId]);
    expect(commands.rows[0].status).toBe('COMPLETED');
    expect(commands.rows[0].result.artifact_url).toBe('https://logs.example.com/file.zip');

    const auditCreate = await pool.query('SELECT * FROM audit_logs WHERE device_id = $1 AND action = $2', [deviceId, 'command_request_logs']);
    const auditResult = await pool.query('SELECT * FROM audit_logs WHERE device_id = $1 AND action = $2', [deviceId, 'command_result']);
    expect(auditCreate.rowCount).toBe(1);
    expect(auditResult.rowCount).toBe(1);
  });

  test('zero trust device cannot receive request logs', async () => {
    const device = await pool.query(
      `INSERT INTO devices (security_profile, link_code) VALUES ('ZERO_TRUST', 'code-zt') RETURNING id`,
    );
    const deviceId = device.rows[0].id as string;
    const app = createApp();

    const createRes = await request(app)
      .post(`/api/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${serverToken()}`)
      .send({ command_type: 'REQUEST_LOGS' });

    expect(createRes.status).toBe(403);
    expect(createRes.body.error).toBe('zero_trust_forbidden');
  });

  test('rejects duplicate pending request logs', async () => {
    const device = await pool.query(
      `INSERT INTO devices (security_profile, link_code) VALUES ('NORMAL', 'code-dupe') RETURNING id`,
    );
    const deviceId = device.rows[0].id as string;
    const app = createApp();

    await request(app)
      .post(`/api/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${serverToken()}`)
      .send({ command_type: 'REQUEST_LOGS' });

    const second = await request(app)
      .post(`/api/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${serverToken()}`)
      .send({ command_type: 'REQUEST_LOGS' });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('request_logs_pending');
  });
});

describe('enter safe mode command', () => {
  test('normal device enters safe mode and reports completion', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicRaw = publicKey.export({ format: 'raw' }) as Buffer;
    const publicB64 = publicRaw.toString('base64');

    const device = await pool.query(
      `INSERT INTO devices (security_profile, link_code, public_key) VALUES ('NORMAL', 'code-safe', $1) RETURNING id`,
      [publicB64],
    );
    const deviceId = device.rows[0].id as string;
    const app = createApp();

    const createRes = await request(app)
      .post(`/api/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${serverToken()}`)
      .send({ command_type: 'ENTER_SAFE_MODE' });

    expect(createRes.status).toBe(201);
    const commandId = createRes.body.commandId as string;
    expect(commandId).toBeTruthy();

    const commandRow = await pool.query('SELECT nonce, signature, payload, status FROM device_commands WHERE id = $1', [commandId]);
    expect(commandRow.rows[0].status).toBe('PENDING');
    expect(commandRow.rows[0].signature).toBeTruthy();

    const nonce = commandRow.rows[0].nonce as string;
    const message = JSON.stringify({ commandId, nonce, status: 'succeeded', result: { safe_mode: true, reason: 'REMOTE_COMMAND' } });
    const sig = crypto.sign(null, Buffer.from(message), privateKey).toString('base64');

    const resultRes = await request(app)
      .post(`/api/devices/${deviceId}/commands/${commandId}/result`)
      .set('Authorization', `Bearer ${deviceToken(deviceId)}`)
      .send({ status: 'succeeded', nonce, signature: sig, result: { safe_mode: true, reason: 'REMOTE_COMMAND' } });

    expect(resultRes.status).toBe(200);

    const commands = await pool.query('SELECT status, result FROM device_commands WHERE id = $1', [commandId]);
    expect(commands.rows[0].status).toBe('COMPLETED');
    expect(commands.rows[0].result.safe_mode).toBe(true);
    expect(commands.rows[0].result.reason).toBe('REMOTE_COMMAND');

    const auditCreate = await pool.query('SELECT * FROM audit_logs WHERE device_id = $1 AND action = $2', [deviceId, 'command_enter_safe_mode']);
    const auditResult = await pool.query('SELECT * FROM audit_logs WHERE device_id = $1 AND action = $2', [deviceId, 'command_result']);
    expect(auditCreate.rowCount).toBe(1);
    expect(auditResult.rowCount).toBe(1);
  });

  test('zero trust device cannot receive safe mode command', async () => {
    const device = await pool.query(
      `INSERT INTO devices (security_profile, link_code) VALUES ('ZERO_TRUST', 'code-safe-zt') RETURNING id`,
    );
    const deviceId = device.rows[0].id as string;
    const app = createApp();

    const createRes = await request(app)
      .post(`/api/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${serverToken()}`)
      .send({ command_type: 'ENTER_SAFE_MODE' });

    expect(createRes.status).toBe(403);
    expect(createRes.body.error).toBe('zero_trust_forbidden');
  });

  test('rejects duplicate pending safe mode', async () => {
    const device = await pool.query(
      `INSERT INTO devices (security_profile, link_code) VALUES ('NORMAL', 'code-safe-dupe') RETURNING id`,
    );
    const deviceId = device.rows[0].id as string;
    const app = createApp();

    await request(app)
      .post(`/api/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${serverToken()}`)
      .send({ command_type: 'ENTER_SAFE_MODE' });

    const second = await request(app)
      .post(`/api/devices/${deviceId}/commands`)
      .set('Authorization', `Bearer ${serverToken()}`)
      .send({ command_type: 'ENTER_SAFE_MODE' });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('enter_safe_mode_pending');
  });
});
