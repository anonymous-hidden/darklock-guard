/**
 * IDS Friend-request routes
 *
 * POST /friends/request              — send a friend request (by target_user_id or target_username)
 * GET  /friends/requests             — incoming pending requests
 * GET  /friends/requests/sent        — outgoing pending requests
 * POST /friends/requests/:id/accept  — accept an incoming request
 * POST /friends/requests/:id/deny    — deny an incoming request
 * DELETE /friends/requests/:id       — cancel an outgoing request
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { hitFixedWindowLimit } from '../security/rate-buckets.js';

export const friendsRouter = Router();

const FRIEND_REQUEST_USER_WINDOW_MS = Math.max(
  30_000,
  parseInt(process.env.IDS_FRIEND_REQUEST_USER_WINDOW_MS ?? String(10 * 60 * 1000), 10) || (10 * 60 * 1000),
);
const FRIEND_REQUEST_USER_MAX = Math.max(
  1,
  parseInt(process.env.IDS_FRIEND_REQUEST_USER_MAX ?? '10', 10) || 10,
);
const FRIEND_REQUEST_IP_WINDOW_MS = Math.max(
  30_000,
  parseInt(process.env.IDS_FRIEND_REQUEST_IP_WINDOW_MS ?? String(60 * 60 * 1000), 10) || (60 * 60 * 1000),
);
const FRIEND_REQUEST_IP_MAX = Math.max(
  1,
  parseInt(process.env.IDS_FRIEND_REQUEST_IP_MAX ?? '30', 10) || 30,
);
const FRIEND_MUTATION_USER_WINDOW_MS = Math.max(
  30_000,
  parseInt(process.env.IDS_FRIEND_MUTATION_USER_WINDOW_MS ?? String(10 * 60 * 1000), 10) || (10 * 60 * 1000),
);
const FRIEND_MUTATION_USER_MAX = Math.max(
  1,
  parseInt(process.env.IDS_FRIEND_MUTATION_USER_MAX ?? '40', 10) || 40,
);

const friendRequestUserRateState = new Map();
const friendRequestIpRateState = new Map();
const friendMutationUserRateState = new Map();

function publicUser(req, user) {
  return {
    userId: user.id,
    username: user.username,
    displayName: req.secureFields.decodeUserField(user.id, 'display_name', user.display_name) || user.username || user.id,
  };
}

function getRequestIp(req) {
  return String(req.ip ?? req.socket?.remoteAddress ?? 'unknown').trim().toLowerCase() || 'unknown';
}

function isFriendRequestRateLimited(req, userId) {
  const userKey = `friend-request-user:${String(userId ?? '').toLowerCase() || 'unknown'}`;
  if (hitFixedWindowLimit(friendRequestUserRateState, userKey, {
    limit: FRIEND_REQUEST_USER_MAX,
    windowMs: FRIEND_REQUEST_USER_WINDOW_MS,
  })) {
    return true;
  }

  const ipKey = `friend-request-ip:${getRequestIp(req)}`;
  return hitFixedWindowLimit(friendRequestIpRateState, ipKey, {
    limit: FRIEND_REQUEST_IP_MAX,
    windowMs: FRIEND_REQUEST_IP_WINDOW_MS,
  });
}

function isFriendMutationRateLimited(userId) {
  const userKey = `friend-mutation-user:${String(userId ?? '').toLowerCase() || 'unknown'}`;
  return hitFixedWindowLimit(friendMutationUserRateState, userKey, {
    limit: FRIEND_MUTATION_USER_MAX,
    windowMs: FRIEND_MUTATION_USER_WINDOW_MS,
  });
}

// ── GET /friends — list all accepted contacts ─────────────────────────────────
friendsRouter.get('/', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;

    const rows = db.prepare(`
      SELECT u.id, u.username, u.display_name
      FROM friend_requests fr
      JOIN users u ON u.id = CASE WHEN fr.from_user_id = ? THEN fr.to_user_id ELSE fr.from_user_id END
      WHERE (fr.from_user_id = ? OR fr.to_user_id = ?) AND fr.status = 'accepted'
    `).all(currentUserId, currentUserId, currentUserId);

    res.json({ friends: rows.map(user => publicUser(req, user)) });
  } catch (err) {
    console.error('friends GET error:');
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── POST /friends/request ────────────────────────────────────────────────────
friendsRouter.post('/request', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;          // set by requireAuth as req.userId
    const { target_user_id, target_username } = req.body ?? {};

    if (isFriendRequestRateLimited(req, currentUserId)) {
      return res.status(429).json({ error: 'rate_limited', code: 'rate_limited' });
    }

    // Resolve target
    let target;
    if (target_user_id) {
      target = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(target_user_id);
    } else if (target_username) {
      target = db.prepare('SELECT id, username, display_name FROM users WHERE username = ?').get(target_username);
    } else {
      return res.status(400).json({ error: 'target_user_id or target_username required', code: 'bad_request' });
    }

    if (!target) return res.status(404).json({ error: 'User not found', code: 'not_found' });
    if (target.id === currentUserId) {
      return res.status(400).json({ error: 'Cannot send request to yourself', code: 'bad_request' });
    }

    // Check existing
    const existing = db.prepare(
      'SELECT * FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)'
    ).get(currentUserId, target.id, target.id, currentUserId);

    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(409).json({ error: 'Already friends', code: 'already_friends' });
      }
      if (existing.status === 'pending') {
        // If *they* already sent us a request — auto-accept
        if (existing.from_user_id === target.id) {
          db.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(existing.id);
          return res.json({ requestId: existing.id, status: 'accepted', contact: publicUser(req, target) });
        }
        return res.status(409).json({ error: 'Friend request already pending', code: 'already_pending' });
      }
      // denied — allow resend
      db.prepare('DELETE FROM friend_requests WHERE id = ?').run(existing.id);
    }

    const id = uuidv4();
    db.prepare('INSERT INTO friend_requests (id, from_user_id, to_user_id) VALUES (?, ?, ?)')
      .run(id, currentUserId, target.id);

    res.status(201).json({ requestId: id, status: 'sent' });
  } catch (err) {
    console.error('friends/request error:');
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── GET /friends/requests — incoming pending ─────────────────────────────────
friendsRouter.get('/requests', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;

    const rows = db.prepare(`
      SELECT fr.id, fr.from_user_id, fr.created_at,
             u.username, u.display_name, u.id AS user_id
      FROM friend_requests fr
      JOIN users u ON u.id = fr.from_user_id
      WHERE fr.to_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).all(currentUserId);

    res.json({
      requests: rows.map(row => ({
        id: row.id,
        fromUser: row.from_user_id,
        displayName: req.secureFields.decodeUserField(row.user_id, 'display_name', row.display_name) || row.username || row.from_user_id,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error('friends/requests GET error:');
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── GET /friends/requests/sent — outgoing pending ────────────────────────────
friendsRouter.get('/requests/sent', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;

    const rows = db.prepare(`
      SELECT fr.id, fr.to_user_id, fr.status, fr.created_at,
             u.username, u.display_name, u.id AS user_id
      FROM friend_requests fr
      JOIN users u ON u.id = fr.to_user_id
      WHERE fr.from_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).all(currentUserId);

    res.json({
      requests: rows.map(row => ({
        id: row.id,
        toUser: row.to_user_id,
        displayName: req.secureFields.decodeUserField(row.user_id, 'display_name', row.display_name) || row.username || row.to_user_id,
        status: row.status,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error('friends/requests/sent GET error:');
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── POST /friends/requests/:id/accept ────────────────────────────────────────
friendsRouter.post('/requests/:id/accept', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;
    const requestId = req.params.id;

    if (isFriendMutationRateLimited(currentUserId)) {
      return res.status(429).json({ error: 'rate_limited', code: 'rate_limited' });
    }

    const request = db.prepare(
      "SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'"
    ).get(requestId, currentUserId);

    if (!request) {
      return res.status(404).json({ error: 'Friend request not found', code: 'not_found' });
    }

    const sender = db.prepare(
      'SELECT id, username, display_name FROM users WHERE id = ?'
    ).get(request.from_user_id);

    db.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = datetime('now') WHERE id = ?")
      .run(requestId);

    res.json({ status: 'accepted', contact: publicUser(req, sender) });
  } catch (err) {
    console.error('friends/requests accept error:');
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── POST /friends/requests/:id/deny ──────────────────────────────────────────
friendsRouter.post('/requests/:id/deny', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;
    const requestId = req.params.id;

    if (isFriendMutationRateLimited(currentUserId)) {
      return res.status(429).json({ error: 'rate_limited', code: 'rate_limited' });
    }

    const request = db.prepare(
      "SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'"
    ).get(requestId, currentUserId);

    if (!request) {
      return res.status(404).json({ error: 'Friend request not found', code: 'not_found' });
    }

    db.prepare("UPDATE friend_requests SET status = 'denied', updated_at = datetime('now') WHERE id = ?")
      .run(requestId);

    res.json({ status: 'denied' });
  } catch (err) {
    console.error('friends/requests deny error:');
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── DELETE /friends/requests/:id — cancel outgoing ───────────────────────────
friendsRouter.delete('/requests/:id', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;
    const requestId = req.params.id;

    if (isFriendMutationRateLimited(currentUserId)) {
      return res.status(429).json({ error: 'rate_limited', code: 'rate_limited' });
    }

    const info = db.prepare(
      "DELETE FROM friend_requests WHERE id = ? AND from_user_id = ? AND status = 'pending'"
    ).run(requestId, currentUserId);

    if (info.changes === 0) {
      return res.status(404).json({ error: 'Request not found', code: 'not_found' });
    }

    res.json({ status: 'cancelled' });
  } catch (err) {
    console.error('friends/requests DELETE error:');
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});
