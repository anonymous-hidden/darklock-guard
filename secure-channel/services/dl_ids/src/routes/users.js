/**
 * IDS User public info routes:
 * GET /users/:id/keys     — fetch identity key + prekey bundle
 * GET /users/:id/devices  — list user's devices
 * GET /users/:id/profile  — public profile (bio, color, pronouns, status)
 * PUT /users/me/profile   — update own public profile
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export const usersRouter = Router();

// ── GET /users/:id/keys ──────────────────────────────────────────────────────
// :id can be a user_id or a username
usersRouter.get('/:id/keys', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const id = req.params.id;

    // Try by user_id first, then by username
    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE username = ?').get(id);
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'not_found' });
    }

    // Get a device's prekey bundle
    const device = db.prepare(
      'SELECT * FROM devices WHERE user_id = ? ORDER BY enrolled_at DESC LIMIT 1'
    ).get(user.id);

    if (!device) {
      return res.status(404).json({ error: 'No devices enrolled for this user', code: 'not_found' });
    }

    const spk = db.prepare('SELECT * FROM signed_prekeys WHERE device_id = ?').get(device.device_id);

    // NOTE: OPK (one-time prekeys) are currently disabled by default.
    // We publish OPK *public keys* to IDS, but the client does not yet persist
    // OPK *secrets* locally. If IDS hands out OPKs, session initiators derive
    // the X3DH shared key including DH4, but the responder cannot mirror DH4
    // without the OPK secret, causing first-message decrypt failures.
    //
    // Re-enable explicitly once OPK secret storage is implemented end-to-end.
    const enableOpk = process.env.IDS_ENABLE_OPK === '1';
    let opk = null;
    if (enableOpk) {
      // Consume one OPK (mark used after sending — one-time use)
      opk = db.prepare(
        'SELECT id, opk_pub FROM one_time_prekeys WHERE device_id = ? AND used = 0 LIMIT 1'
      ).get(device.device_id);

      if (opk) {
        db.prepare('UPDATE one_time_prekeys SET used = 1 WHERE id = ?').run(opk.id);
      }

      // Alert user if OPK supply is running low (< 10)
      const remaining = db.prepare(
        'SELECT COUNT(*) as count FROM one_time_prekeys WHERE device_id = ? AND used = 0'
      ).get(device.device_id);

      if (remaining.count < 10) {
        console.warn(`[IDS] Low OPK supply for user ${user.username}: ${remaining.count} remaining`);
      }
    }

    res.json({
      user_id: user.id,
      username: user.username,
      identity_pubkey: user.identity_pubkey,
      key_version: user.key_version,
      prekey_bundle: {
        ik_pub: user.identity_pubkey, // Ed25519 identity key — used to verify SPK signature
        spk_pub: spk ? spk.spk_pubkey : null,
        spk_sig: spk ? spk.spk_sig : null,
        opk_pub: opk ? opk.opk_pub : null,
      },
    });
  } catch (err) {
    console.error('Get user keys error:', err);
    res.status(500).json({ error: 'Failed to fetch keys', code: 'internal' });
  }
});

// ── GET /users/:id/devices ───────────────────────────────────────────────────
usersRouter.get('/:id/devices', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const id = req.params.id;

    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE username = ?').get(id);
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'not_found' });
    }

    const devices = db.prepare(
      'SELECT device_id, device_name, platform, device_pubkey, enrolled_at, last_seen_at FROM devices WHERE user_id = ?'
    ).all(user.id);

    res.json({
      user_id: user.id,
      devices: devices.map((d) => ({
        device_id: d.device_id,
        device_name: d.device_name,
        platform: d.platform,
        device_pubkey: d.device_pubkey,
        enrolled_at: d.enrolled_at,
        last_seen_at: d.last_seen_at,
      })),
    });
  } catch (err) {
    console.error('Get user devices error:', err);
    res.status(500).json({ error: 'Failed to fetch devices', code: 'internal' });
  }
});

// ── GET /users/:id/profile ───────────────────────────────────────────────────
// Returns public profile fields (bio, color, pronouns, custom status).
// :id can be a user_id or username.
usersRouter.get('/:id/profile', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const id = req.params.id;
    let user = db.prepare('SELECT id, username, profile_bio, pronouns, custom_status, profile_color, avatar, banner, system_role FROM users WHERE id = ?').get(id);
    if (!user) user = db.prepare('SELECT id, username, profile_bio, pronouns, custom_status, profile_color, avatar, banner, system_role FROM users WHERE username = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found', code: 'not_found' });
    res.json({
      user_id: user.id,
      username: user.username,
      profile_bio: user.profile_bio ?? null,
      pronouns: user.pronouns ?? null,
      custom_status: user.custom_status ?? null,
      profile_color: user.profile_color ?? null,
      avatar: user.avatar ?? null,
      banner: user.banner ?? null,
      system_role: user.system_role ?? null,
    });
  } catch (err) {
    console.error('Get user profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile', code: 'internal' });
  }
});

// ── PUT /users/me/profile ────────────────────────────────────────────────────
// Update the authenticated user's public profile fields.
usersRouter.put('/me/profile', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const { profile_bio, pronouns, custom_status, profile_color, avatar, banner } = req.body;

    db.prepare(
      'UPDATE users SET profile_bio = ?, pronouns = ?, custom_status = ?, profile_color = ?, avatar = ?, banner = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(
      profile_bio ?? null,
      pronouns ?? null,
      custom_status ?? null,
      profile_color ?? null,
      avatar ?? null,
      banner ?? null,
      userId,
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile', code: 'internal' });
  }
});
