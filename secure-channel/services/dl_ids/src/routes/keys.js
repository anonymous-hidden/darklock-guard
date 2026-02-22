/**
 * IDS Key management routes: /keys/upload
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export const keysRouter = Router();

// ── POST /keys/upload — upload new one-time prekeys ──────────────────────────
keysRouter.post('/upload', requireAuth, (req, res) => {
  try {
    const { one_time_prekeys } = req.body;
    if (!one_time_prekeys || !Array.isArray(one_time_prekeys) || one_time_prekeys.length === 0) {
      return res.status(400).json({ error: 'Provide an array of one_time_prekeys', code: 'bad_request' });
    }

    const db = req.db;
    const userId = req.userId;

    // Find user's current device
    const device = db.prepare('SELECT device_id FROM devices WHERE user_id = ? LIMIT 1').get(userId);
    if (!device) {
      return res.status(404).json({ error: 'No enrolled device found', code: 'not_found' });
    }

    const stmt = db.prepare('INSERT INTO one_time_prekeys (device_id, opk_pub) VALUES (?, ?)');
    const insertMany = db.transaction((keys) => {
      for (const key of keys) {
        stmt.run(device.device_id, key);
      }
    });
    insertMany(one_time_prekeys);

    const remaining = db.prepare(
      'SELECT COUNT(*) as count FROM one_time_prekeys WHERE device_id = ? AND used = 0'
    ).get(device.device_id);

    res.json({ uploaded: one_time_prekeys.length, remaining: remaining.count });
  } catch (err) {
    console.error('Key upload error:', err);
    res.status(500).json({ error: 'Key upload failed', code: 'internal' });
  }
});

// ── PUT /keys/spk — replace the signed prekey for the current device ─────────
// Called at login time to refresh keys and fix any previously corrupted SPK.
keysRouter.put('/spk', requireAuth, (req, res) => {
  try {
    const { spk_pubkey, spk_sig, one_time_prekeys, identity_pubkey } = req.body;
    if (!spk_pubkey || !spk_sig) {
      return res.status(400).json({ error: 'spk_pubkey and spk_sig are required', code: 'bad_request' });
    }

    const db = req.db;
    const userId = req.userId;

    const device = db.prepare('SELECT device_id FROM devices WHERE user_id = ? LIMIT 1').get(userId);
    if (!device) {
      return res.status(404).json({ error: 'No enrolled device found', code: 'not_found' });
    }

    // Sync identity key if provided (ensures IDS stays consistent with the vault)
    if (identity_pubkey) {
      db.prepare('UPDATE users SET identity_pubkey = ? WHERE id = ?').run(identity_pubkey, userId);
    }

    // Upsert the SPK
    db.prepare(`
      INSERT OR REPLACE INTO signed_prekeys (device_id, spk_pubkey, spk_sig)
      VALUES (?, ?, ?)
    `).run(device.device_id, spk_pubkey, spk_sig);

    // Optionally replenish OPKs at the same time
    if (one_time_prekeys && Array.isArray(one_time_prekeys) && one_time_prekeys.length > 0) {
      const stmt = db.prepare('INSERT INTO one_time_prekeys (device_id, opk_pub) VALUES (?, ?)');
      const insertMany = db.transaction((keys) => {
        for (const key of keys) stmt.run(device.device_id, key);
      });
      insertMany(one_time_prekeys);
    }

    console.log(`[IDS] SPK refreshed for user ${userId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('SPK refresh error:', err);
    res.status(500).json({ error: 'SPK refresh failed', code: 'internal' });
  }
});
