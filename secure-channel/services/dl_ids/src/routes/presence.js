/**
 * IDS Presence routes:
 *
 * POST   /presence/heartbeat   — update heartbeat (called every 30s)
 * GET    /presence/:userId     — get user presence
 * POST   /presence/batch       — get presence for multiple users
 * PATCH  /presence/status      — set manual status override
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export const presenceRouter = Router();

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;     // 5 min
const OFFLINE_THRESHOLD_MS = 60 * 1000;        // 60s
const RECENTLY_ONLINE_MS = 5 * 60 * 1000;     // 5 min

function computeStatus(row) {
  if (!row) return { status: 'offline', last_seen: null, custom_status: null };

  // Manual overrides
  if (row.manual_override === 'invisible') {
    return { status: 'offline', last_seen: row.last_seen, custom_status: row.custom_status };
  }
  if (row.manual_override === 'dnd') {
    return { status: 'dnd', last_seen: row.last_seen, custom_status: row.custom_status };
  }

  const lastSeen = new Date(row.last_seen).getTime();
  const elapsed = Date.now() - lastSeen;

  if (elapsed < OFFLINE_THRESHOLD_MS) {
    return { status: 'online', last_seen: row.last_seen, custom_status: row.custom_status };
  }
  if (elapsed < IDLE_THRESHOLD_MS) {
    return { status: 'idle', last_seen: row.last_seen, custom_status: row.custom_status };
  }
  if (elapsed < RECENTLY_ONLINE_MS) {
    return { status: 'recently_online', last_seen: row.last_seen, custom_status: row.custom_status };
  }
  return { status: 'offline', last_seen: row.last_seen, custom_status: row.custom_status };
}

// ── POST /presence/heartbeat ─────────────────────────────────────────────────
presenceRouter.post('/heartbeat', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;

    db.prepare(`
      INSERT INTO user_presence (user_id, status, last_seen)
      VALUES (?, 'online', datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        last_seen = datetime('now'),
        status = CASE WHEN manual_override IN ('dnd', 'invisible') THEN status ELSE 'online' END
    `).run(userId);

    res.json({ ok: true });
  } catch (err) {
    console.error('Heartbeat error:', err);
    res.status(500).json({ error: 'Heartbeat failed', code: 'internal' });
  }
});

// ── GET /presence/:userId ────────────────────────────────────────────────────
presenceRouter.get('/:userId', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const row = db.prepare('SELECT * FROM user_presence WHERE user_id = ?').get(req.params.userId);
    const result = computeStatus(row);
    res.json({ user_id: req.params.userId, ...result });
  } catch (err) {
    console.error('Get presence error:', err);
    res.status(500).json({ error: 'Failed to get presence', code: 'internal' });
  }
});

// ── POST /presence/batch ─────────────────────────────────────────────────────
presenceRouter.post('/batch', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { user_ids } = req.body;
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ error: 'user_ids required', code: 'bad_request' });
    }

    const placeholders = user_ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM user_presence WHERE user_id IN (${placeholders})`
    ).all(...user_ids);

    const map = {};
    for (const row of rows) {
      map[row.user_id] = computeStatus(row);
    }

    // Fill in missing users as offline
    const result = user_ids.map(uid => ({
      user_id: uid,
      ...(map[uid] || { status: 'offline', last_seen: null, custom_status: null }),
    }));

    res.json({ presences: result });
  } catch (err) {
    console.error('Batch presence error:', err);
    res.status(500).json({ error: 'Failed to get presences', code: 'internal' });
  }
});

// ── PATCH /presence/status ───────────────────────────────────────────────────
presenceRouter.patch('/status', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const { status, custom_status } = req.body;

    const validStatuses = ['online', 'idle', 'dnd', 'invisible', null];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status', code: 'bad_request' });
    }

    const manualOverride = (status === 'dnd' || status === 'invisible') ? status : null;

    db.prepare(`
      INSERT INTO user_presence (user_id, status, last_seen, manual_override, custom_status)
      VALUES (?, ?, datetime('now'), ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        manual_override = ?,
        custom_status = COALESCE(?, custom_status),
        last_seen = datetime('now')
    `).run(userId, status || 'online', manualOverride, custom_status || null, manualOverride, custom_status);

    res.json({ ok: true, status, manual_override: manualOverride });
  } catch (err) {
    console.error('Set status error:', err);
    res.status(500).json({ error: 'Failed to set status', code: 'internal' });
  }
});
