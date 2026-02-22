/**
 * IDS Device enrollment routes: /devices/enroll, /users/:id/devices
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';

export const devicesRouter = Router();

// ── POST /devices/enroll ─────────────────────────────────────────────────────
devicesRouter.post('/enroll', requireAuth, (req, res) => {
  try {
    const {
      device_id, device_name, platform, device_pubkey,
      device_cert, dh_pubkey, spk_pubkey, spk_sig,
      one_time_prekeys,
    } = req.body;

    if (!device_id || !device_name || !device_pubkey || !device_cert || !dh_pubkey || !spk_pubkey || !spk_sig) {
      return res.status(400).json({ error: 'Missing device enrollment fields', code: 'bad_request' });
    }

    const db = req.db;
    const userId = req.userId;

    // Insert device
    const id = uuidv4();
    const certJson = typeof device_cert === 'string' ? device_cert : JSON.stringify(device_cert);

    db.prepare(`
      INSERT INTO devices (id, user_id, device_id, device_name, platform, device_pubkey, device_cert, dh_pubkey)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, device_id, device_name, platform ?? 'unknown', device_pubkey, certJson, dh_pubkey);

    // Insert signed prekey
    db.prepare(`
      INSERT OR REPLACE INTO signed_prekeys (device_id, spk_pubkey, spk_sig)
      VALUES (?, ?, ?)
    `).run(device_id, spk_pubkey, spk_sig);

    // Insert one-time prekeys
    if (one_time_prekeys && Array.isArray(one_time_prekeys)) {
      const stmt = db.prepare('INSERT INTO one_time_prekeys (device_id, opk_pub) VALUES (?, ?)');
      const insertMany = db.transaction((keys) => {
        for (const key of keys) {
          stmt.run(device_id, key);
        }
      });
      insertMany(one_time_prekeys);
    }

    res.status(201).json({
      device_id,
      enrolled_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Enroll error:', err);
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Device already enrolled', code: 'conflict' });
    }
    res.status(500).json({ error: 'Device enrollment failed', code: 'internal' });
  }
});
