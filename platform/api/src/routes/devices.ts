import { Router, Response } from 'express';
import nacl from 'tweetnacl';
import crypto from 'crypto';
import { pool, withTransaction } from '../db/pool';
import { AuthenticatedRequest, requireDeviceAuth, requireServerAuth, signDeviceToken } from '../middleware/auth';
import { SecurityProfile } from '../types/api';

const router = Router();
const PROFILE_VALUES: SecurityProfile[] = ['NORMAL', 'ZERO_TRUST'];
let serverSigning: { publicKey: Buffer; secretKey: Buffer } | null = null;

function loadServerSigningKey() {
  if (serverSigning) return serverSigning;
  const seedB64 = process.env.SERVER_SIGNING_SEED;
  if (!seedB64) return null;
  const seed = Buffer.from(seedB64, 'base64');
  if (seed.length !== 32) {
    throw new Error('SERVER_SIGNING_SEED must be 32 bytes base64');
  }
  const pair = nacl.sign.keyPair.fromSeed(seed);
  serverSigning = { publicKey: Buffer.from(pair.publicKey), secretKey: Buffer.from(pair.secretKey) };
  return serverSigning;
}

function canonicalCommandMessage(command: string, nonce: string, expiresAt: Date, payload: any): Buffer {
  const hasher = crypto.createHash('sha256');
  hasher.update(Buffer.from(command));
  hasher.update(Buffer.from(nonce));
  hasher.update(Buffer.from(expiresAt.toISOString()));
  hasher.update(Buffer.from(JSON.stringify(payload || {})));
  return hasher.digest();
}

function signCommand(command: string, nonce: string, expiresAt: Date, payload: any): string {
  const signing = loadServerSigningKey();
  if (!signing) {
    throw Object.assign(new Error('server_signing_key_missing'), { status: 500 });
  }
  const message = canonicalCommandMessage(command, nonce, expiresAt, payload);
  const sig = nacl.sign.detached(message, signing.secretKey);
  return Buffer.from(sig).toString('base64');
}

function normalizeProfile(value?: string | null): SecurityProfile {
  const normalized = (value || 'NORMAL').toUpperCase();
  if (!PROFILE_VALUES.includes(normalized as SecurityProfile)) {
    return 'NORMAL';
  }
  return normalized as SecurityProfile;
}

function verifyDeviceSignature(publicKey: string, message: string, signature: string): boolean {
  try {
    const pk = Buffer.from(publicKey, 'base64');
    const sig = Buffer.from(signature, 'base64');
    return nacl.sign.detached.verify(Buffer.from(message), sig, pk);
  } catch (err) {
    return false;
  }
}

function ensureDeviceMatch(req: AuthenticatedRequest, res: Response): boolean {
  if (!req.auth?.deviceId || req.auth.deviceId !== req.params.id) {
    res.status(403).json({ error: 'device_mismatch' });
    return false;
  }
  return true;
}

router.post('/link', async (req, res) => {
  const { linkCode, publicKey, securityProfile } = req.body || {};
  if (!linkCode || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'link_code_and_public_key_required' });
  }

  const profile = normalizeProfile(securityProfile);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, link_code_expires_at, link_code_used, security_profile FROM devices WHERE link_code = $1 FOR UPDATE',
      [linkCode],
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'link_code_not_found' });
    }

    const device = rows[0];
    if (device.link_code_used) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'link_code_used' });
    }
    if (device.link_code_expires_at && new Date(device.link_code_expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'link_code_expired' });
    }

    await client.query(
      `UPDATE devices
       SET public_key = $1,
           linked_at = now(),
           link_code_used = true,
           security_profile = $2,
           mode = 'CONNECTED',
           last_seen_at = now(),
           updated_at = now()
       WHERE id = $3`,
      [publicKey, profile, device.id],
    );
    await client.query('COMMIT');

    const token = signDeviceToken(device.id, profile);
    return res.json({ deviceId: device.id, token, securityProfile: profile });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'link_failed', details: err?.message });
  } finally {
    client.release();
  }
});

router.post('/:id/heartbeat', requireDeviceAuth, async (req: AuthenticatedRequest, res) => {
  if (!ensureDeviceMatch(req, res)) return;

  const { status } = req.body || {};
  await pool.query(
    'UPDATE devices SET last_seen_at = now(), updated_at = now() WHERE id = $1',
    [req.params.id],
  );

  await pool.query(
    'INSERT INTO audit_logs (device_id, action, path, method, status, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [req.params.id, 'heartbeat', req.originalUrl, req.method, 200, JSON.stringify({ status })],
  );

  return res.json({ ok: true });
});

router.get('/:id/pending-commands', requireDeviceAuth, async (req: AuthenticatedRequest, res) => {
  if (!ensureDeviceMatch(req, res)) return;

  await pool.query(
    `UPDATE device_commands
     SET status = 'EXPIRED'
     WHERE device_id = $1 AND status = 'PENDING' AND expires_at < now()`,
    [req.params.id],
  );

  const { rows } = await pool.query(
    `SELECT id, command, payload, nonce, signature, expires_at, issued_at
     FROM device_commands
     WHERE device_id = $1 AND status = 'PENDING'
     ORDER BY issued_at ASC`,
    [req.params.id],
  );

  return res.json({ commands: rows });
});

router.post('/:id/commands', requireServerAuth, async (req: AuthenticatedRequest, res) => {
  const { command, command_type, payload, nonce: bodyNonce, expiresAt, signature: bodySignature } = req.body || {};

  const requestedType = command_type || command;
  const isRequestLogs = requestedType === 'REQUEST_LOGS';
  const isEnterSafeMode = requestedType === 'ENTER_SAFE_MODE';
  const effectiveCommand = isRequestLogs ? 'REQUEST_LOGS' : isEnterSafeMode ? 'ENTER_SAFE_MODE' : command;

  if (!effectiveCommand) {
    return res.status(400).json({ error: 'command_required' });
  }

  if (command_type && !isRequestLogs && !isEnterSafeMode) {
    return res.status(400).json({ error: 'unsupported_command_type' });
  }

  const expires = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 5 * 60_000);
  if (Number.isNaN(expires.getTime())) {
    return res.status(400).json({ error: 'invalid_expires_at' });
  }

  const nonce = isRequestLogs || isEnterSafeMode ? crypto.randomUUID() : bodyNonce;
  const signature = isRequestLogs || isEnterSafeMode ? null : bodySignature;
  if (!nonce || (!signature && !isRequestLogs && !isEnterSafeMode)) {
    return res.status(400).json({ error: 'command_nonce_signature_required' });
  }

  try {
    const result = await withTransaction(async (client) => {
      const device = await client.query(
        'SELECT id, security_profile FROM devices WHERE id = $1 FOR UPDATE',
        [req.params.id],
      );
      if (!device.rows.length) {
        throw Object.assign(new Error('not_found'), { status: 404 });
      }
      const profile = normalizeProfile(device.rows[0].security_profile);
      if (profile === 'ZERO_TRUST') {
        throw Object.assign(new Error('zero_trust_forbidden'), { status: 403 });
      }

      if (isRequestLogs || isEnterSafeMode) {
        const duplicateError = isRequestLogs ? 'request_logs_pending' : 'enter_safe_mode_pending';
        const pending = await client.query(
          `SELECT 1 FROM device_commands
            WHERE device_id = $1 AND command = $2 AND status = 'PENDING'`,
          [req.params.id, effectiveCommand],
        );
        if (pending.rows.length) {
          throw Object.assign(new Error(duplicateError), { status: 409 });
        }
      }

      const payloadToUse = isEnterSafeMode ? { reason: 'REMOTE_COMMAND' } : payload || {};
      const signatureToUse = isRequestLogs || isEnterSafeMode
        ? signCommand(effectiveCommand, nonce, expires, payloadToUse)
        : signature;

      const inserted = await client.query(
        `INSERT INTO device_commands (device_id, command, payload, nonce, signature, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
         RETURNING id`,
        [req.params.id, effectiveCommand, payloadToUse, nonce, signatureToUse, expires.toISOString()],
      );

      const auditAction = isRequestLogs ? 'command_request_logs' : isEnterSafeMode ? 'command_enter_safe_mode' : 'command_create';
      await client.query(
        `INSERT INTO audit_logs (device_id, action, path, method, status, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          req.params.id,
          auditAction,
          req.originalUrl,
          req.method,
          201,
          JSON.stringify({ command: effectiveCommand }),
        ],
      );

      return inserted.rows[0].id as string;
    });

    return res.status(201).json({ commandId: result });
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'nonce_reuse' });
    }
    if (err?.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: 'command_create_failed', details: err?.message });
  }
});

router.post('/:id/commands/:commandId/result', requireDeviceAuth, async (req: AuthenticatedRequest, res) => {
  if (!ensureDeviceMatch(req, res)) return;

  const { status, nonce, signature, result, error } = req.body || {};
  if (!status || !nonce || !signature) {
    return res.status(400).json({ error: 'status_nonce_signature_required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const command = await client.query(
      `SELECT dc.id, dc.device_id, dc.nonce, dc.signature, dc.status, dc.expires_at, d.public_key
         FROM device_commands dc
         JOIN devices d ON d.id = dc.device_id
         WHERE dc.id = $1 AND dc.device_id = $2
         FOR UPDATE`,
      [req.params.commandId, req.params.id],
    );

    if (!command.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'command_not_found' });
    }

    const row = command.rows[0];
    if (row.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'command_not_pending' });
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query("UPDATE device_commands SET status = 'EXPIRED' WHERE id = $1", [row.id]);
      await client.query('COMMIT');
      return res.status(410).json({ error: 'command_expired' });
    }

    if (row.nonce !== nonce) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'nonce_mismatch' });
    }

    if (!row.public_key) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'device_public_key_missing' });
    }

    const message = JSON.stringify({ commandId: row.id, nonce, status, result: result || null });
    const valid = verifyDeviceSignature(row.public_key, message, signature);
    if (!valid) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'invalid_signature' });
    }

    const newStatus = status === 'failed' ? 'FAILED' : status === 'rejected' ? 'REJECTED' : 'COMPLETED';
    await client.query(
      `UPDATE device_commands
         SET status = $1,
             responded_at = now(),
             result = $2,
             error = $3,
             response_signature = $4,
             updated_at = now()
         WHERE id = $5`,
      [newStatus, result || null, error || null, signature, row.id],
    );

    await client.query(
      `INSERT INTO audit_logs (device_id, action, path, method, status, metadata)
         VALUES ($1, 'command_result', $2, $3, $4, $5)`,
      [
        req.params.id,
        req.originalUrl,
        req.method,
        200,
        JSON.stringify({ commandId: row.id, status: newStatus, error: error || null }),
      ],
    );

    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'command_result_failed', details: err?.message });
  } finally {
    client.release();
  }
});

router.get('/', requireServerAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, security_profile, public_key, last_seen_at, linked_at, mode
       FROM devices
       ORDER BY created_at DESC`,
  );

  return res.json({ devices: rows });
});

router.get('/:id', requireServerAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, security_profile, public_key, last_seen_at, linked_at, mode
       FROM devices
       WHERE id = $1`,
    [req.params.id],
  );

  if (!rows.length) {
    return res.status(404).json({ error: 'device_not_found' });
  }

  return res.json({ device: rows[0] });
});

router.get('/:id/commands', requireServerAuth, async (req, res) => {
  const { command, limit: limitRaw } = req.query as { command?: string; limit?: string };
  const limitParsed = Number.parseInt(limitRaw || '', 10);
  const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), 200) : 50;

  const params: any[] = [req.params.id];
  const conditions = ['device_id = $1'];
  if (command) {
    params.push(command);
    conditions.push(`command = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT id, command, payload, nonce, signature, status, expires_at, issued_at, responded_at, result, error
       FROM device_commands
       WHERE ${conditions.join(' AND ')}
       ORDER BY issued_at DESC
       LIMIT ${limit}`,
    params,
  );

  return res.json({ commands: rows });
});

router.get('/:id/events', requireServerAuth, async (req, res) => {
  const device = await pool.query('SELECT id FROM devices WHERE id = $1', [req.params.id]);
  if (!device.rows.length) {
    return res.status(404).json({ error: 'device_not_found' });
  }

  const limitRaw = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const beforeRaw = req.query.before ? new Date(String(req.query.before)) : null;
  const beforeValid = beforeRaw && !Number.isNaN(beforeRaw.getTime());

  const params: any[] = [req.params.id];
  const clauses = ['device_id = $1'];
  if (beforeValid) {
    params.push(beforeRaw!.toISOString());
    clauses.push(`created_at < $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT id, action, path, method, status, metadata, created_at
       FROM audit_logs
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ${limit + 1}`,
    params,
  );

  const events = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? events[events.length - 1].created_at : null;

  return res.json({ events, nextCursor });
});

export default router;
