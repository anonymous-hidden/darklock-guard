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

export const relayRouter = Router();

// ── POST /send ───────────────────────────────────────────────────────────────
// Client sends an encrypted envelope to be stored until the recipient polls.
relayRouter.post('/send', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { recipient_id, ciphertext, init_data, chain_link } = req.body;
    const normalizedRecipientId = String(recipient_id ?? '').trim();

    if (!normalizedRecipientId || !ciphertext) {
      return res.status(400).json({ error: 'recipient_id and ciphertext are required', code: 'bad_request' });
    }

    const id = uuidv4();
    const sender_id = req.userId;

    console.log('[RLY] /send accepted', {
      envelope_id: id,
      sender_id,
      recipient_id: normalizedRecipientId,
      chain_link: chain_link || null,
      ciphertext_len: typeof ciphertext === 'string' ? ciphertext.length : null,
      has_init_data: Boolean(init_data),
      at: new Date().toISOString(),
    });

    db.prepare(`
      INSERT INTO envelopes (id, sender_id, recipient_id, ciphertext, init_data, chain_link)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sender_id, normalizedRecipientId, ciphertext, init_data || null, chain_link || null);

    res.status(201).json({ envelope_id: id, accepted: true });
  } catch (err) {
    console.error('Send envelope error:', err);
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
      console.log('[RLY] /poll', {
        recipient_id,
        count: envelopes.length,
        at: new Date().toISOString(),
      });
    }
    res.json({ envelopes, count: envelopes.length });
  } catch (err) {
    console.error('Poll envelopes error:', err);
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
    console.log('[RLY] /ack', {
      recipient_id: req.userId,
      requested: envelope_ids.length,
      acked,
      at: new Date().toISOString(),
    });
    res.json({ acked });
  } catch (err) {
    console.error('Ack envelopes error:', err);
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

    db.prepare(`
      INSERT INTO delivery_receipts (envelope_id, recipient_id, status)
      VALUES (?, ?, ?)
      ON CONFLICT(envelope_id, recipient_id) DO UPDATE SET status = excluded.status, timestamp = datetime('now')
    `).run(envelope_id, req.userId, status);

    res.json({ accepted: true });
  } catch (err) {
    console.error('Delivery receipt error:', err);
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
    console.error('Get receipts error:', err);
    res.status(500).json({ error: 'Failed to fetch receipts', code: 'internal' });
  }
});
