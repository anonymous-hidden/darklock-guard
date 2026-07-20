/**
 * RLY — Relay routes
 *
 * POST /send     — submit an encrypted envelope for a recipient
 * POST /poll     — fetch pending envelopes for the authenticated user
 * POST /ack      — acknowledge receipt of specific envelopes
 * POST /receipt  — deliver receipt notification (delivered / read)
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { RIDGELINE_SECURITY_CAPABILITIES } from '@darklock/ridgeline-security-capabilities';
import { verifyRelaySendPermit } from '../security/relay-permit.js';
import { securityEvent } from '../security-log.js';

export const relayRouter = Router();

// ── POST /send ───────────────────────────────────────────────────────────────
// Client sends an encrypted envelope to be stored until the recipient polls.
relayRouter.post('/send', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { recipient_id, ciphertext, init_data, chain_link, permit } = req.body;
    const normalizedRecipientId = String(recipient_id ?? '').trim();

    if (!normalizedRecipientId || typeof ciphertext !== 'string' || ciphertext.length === 0) {
      return res.status(400).json({ error: 'recipient_id and ciphertext are required', code: 'bad_request' });
    }
    if (ciphertext.length > 256 * 1024) {
      return res.status(413).json({ error: 'ciphertext_too_large', code: 'payload_too_large' });
    }

    try {
      verifyRelaySendPermit({
        secret: process.env.RLY_JWT_SECRET,
        permitToken: permit,
        fromUserId: req.userId,
        eventType: 'message',
        toUserId: normalizedRecipientId,
      });
    } catch (error) {
      return res.status(403).json({ error: error.message || 'invalid_permit', code: 'forbidden' });
    }

    const id = uuidv4();
    const sender_id = req.userId;

    securityEvent('RLY_REST_SEND_ACCEPTED', { ciphertext_bytes: ciphertext.length });

    db.prepare(`
      INSERT INTO envelopes (id, sender_id, recipient_id, ciphertext, init_data, chain_link)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sender_id, normalizedRecipientId, ciphertext, init_data || null, chain_link || null);

    res.status(201).json({ envelope_id: id, accepted: true });
  } catch (err) {
    securityEvent('RLY_REST_SEND_FAILED', {}, 'error');
    res.status(500).json({ error: 'Failed to send envelope', code: 'internal' });
  }
});

// ── POST /poll ───────────────────────────────────────────────────────────────
// Fetch pending envelopes for the authenticated user.
// Returns envelopes that haven't been delivered yet.
// Optional: `since` param to fetch only new envelopes.
relayRouter.post('/poll', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const recipient_id = String(req.userId ?? '').trim();
    const { since, limit } = req.body;
    const maxEnvelopes = Math.min(limit || 100, 500);

    let envelopes;
    if (since) {
      envelopes = db.prepare(`
        SELECT id, sender_id, ciphertext, init_data, chain_link, created_at
        FROM envelopes
        WHERE recipient_id = ? AND acked_at IS NULL AND created_at > ?
        ORDER BY created_at ASC
        LIMIT ?
      `).all(recipient_id, since, maxEnvelopes);
    } else {
      envelopes = db.prepare(`
        SELECT id, sender_id, ciphertext, init_data, chain_link, created_at
        FROM envelopes
        WHERE recipient_id = ? AND acked_at IS NULL
        ORDER BY created_at ASC
        LIMIT ?
      `).all(recipient_id, maxEnvelopes);
    }

    // NOTE: do NOT mark delivered_at here — mark it on ACK so that
    // if the client fails to decrypt (e.g. first-time X3DH race), the
    // envelope is re-delivered on the next poll instead of being lost.
    if (envelopes.length > 0 || process.env.RLY_LOG_POLL_ALL === '1') {
      securityEvent('RLY_REST_POLL_COMPLETED', { count: envelopes.length });
    }
    res.json({ envelopes, count: envelopes.length });
  } catch (err) {
    securityEvent('RLY_REST_POLL_FAILED', {}, 'error');
    res.status(500).json({ error: 'Failed to poll envelopes', code: 'internal' });
  }
});

// ── POST /ack ────────────────────────────────────────────────────────────────
// Client acknowledges successful decryption of envelopes.
// Acked envelopes can be cleaned up after a short retention.
relayRouter.post('/ack', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { envelope_ids } = req.body;

    if (!Array.isArray(envelope_ids) || envelope_ids.length === 0) {
      return res.status(400).json({ error: 'envelope_ids must be a non-empty array', code: 'bad_request' });
    }

    const now = new Date().toISOString();
    // Mark delivered_at AND acked_at on explicit ACK — this is the commit
    // point where the envelope is considered successfully received.
    const ackStmt = db.prepare('UPDATE envelopes SET delivered_at = COALESCE(delivered_at, ?), acked_at = ? WHERE id = ? AND recipient_id = ?');
    const ackMany = db.transaction((ids) => {
      let acked = 0;
      for (const id of ids) {
        const result = ackStmt.run(now, now, id, req.userId);
        acked += result.changes;
      }
      return acked;
    });

    const acked = ackMany(envelope_ids);
    securityEvent('RLY_REST_ACK_COMPLETED', { requested: envelope_ids.length, acked });
    res.json({ acked });
  } catch (err) {
    securityEvent('RLY_REST_ACK_FAILED', {}, 'error');
    res.status(500).json({ error: 'Failed to ack envelopes', code: 'internal' });
  }
});

// ── POST /receipt ────────────────────────────────────────────────────────────
// Send delivery receipt (delivered / read) for an envelope.
// Stored so sender can poll receipt status.
relayRouter.post('/receipt', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { envelope_id, status } = req.body;

    if (!envelope_id || !['delivered', 'read'].includes(status)) {
      return res.status(400).json({ error: 'envelope_id and status (delivered|read) required', code: 'bad_request' });
    }

    const envelope = db.prepare(
      'SELECT id FROM envelopes WHERE id = ? AND recipient_id = ? LIMIT 1'
    ).get(envelope_id, req.userId);
    if (!envelope) {
      return res.status(404).json({ error: 'envelope_not_found', code: 'not_found' });
    }

    db.prepare(`
      INSERT INTO delivery_receipts (envelope_id, recipient_id, status)
      VALUES (?, ?, ?)
      ON CONFLICT(envelope_id, recipient_id) DO UPDATE SET status = excluded.status, timestamp = datetime('now')
    `).run(envelope_id, req.userId, status);

    res.json({ accepted: true });
  } catch (err) {
    securityEvent('RLY_REST_RECEIPT_FAILED', {}, 'error');
    res.status(500).json({ error: 'Failed to process receipt', code: 'internal' });
  }
});

// ── GET /receipts ────────────────────────────────────────────────────────────
// Sender polls for delivery receipts of their messages.
relayRouter.get('/receipts', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const since = req.query.since || '1970-01-01';

    const receipts = db.prepare(`
      SELECT dr.envelope_id, dr.recipient_id, dr.status, dr.timestamp
      FROM delivery_receipts dr
      JOIN envelopes e ON e.id = dr.envelope_id
      WHERE e.sender_id = ? AND dr.timestamp > ?
      ORDER BY dr.timestamp ASC
      LIMIT 200
    `).all(req.userId, since);

    res.json({ receipts });
  } catch (err) {
    securityEvent('RLY_REST_RECEIPTS_READ_FAILED', {}, 'error');
    res.status(500).json({ error: 'Failed to fetch receipts', code: 'internal' });
  }
});

relayRouter.get('/security/capabilities', (_req, res) => {
  res.json(RIDGELINE_SECURITY_CAPABILITIES);
});
