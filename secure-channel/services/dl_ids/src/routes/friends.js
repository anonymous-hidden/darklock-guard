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

export const friendsRouter = Router();

// ── GET /friends — list all accepted contacts ─────────────────────────────────
friendsRouter.get('/', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;

    const rows = db.prepare(`
      SELECT u.id, u.username, u.identity_pubkey
      FROM friend_requests fr
      JOIN users u ON u.id = CASE WHEN fr.from_user_id = ? THEN fr.to_user_id ELSE fr.from_user_id END
      WHERE (fr.from_user_id = ? OR fr.to_user_id = ?) AND fr.status = 'accepted'
    `).all(currentUserId, currentUserId, currentUserId);

    res.json({ friends: rows });
  } catch (err) {
    console.error('friends GET error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── POST /friends/request ────────────────────────────────────────────────────
friendsRouter.post('/request', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;          // set by requireAuth as req.userId
    const { target_user_id, target_username } = req.body;

    // Resolve target
    let target;
    if (target_user_id) {
      target = db.prepare('SELECT id, username, identity_pubkey FROM users WHERE id = ?').get(target_user_id);
    } else if (target_username) {
      target = db.prepare('SELECT id, username, identity_pubkey FROM users WHERE username = ?').get(target_username);
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
          return res.json({ id: existing.id, status: 'accepted', contact: target });
        }
        return res.status(409).json({ error: 'Friend request already pending', code: 'already_pending' });
      }
      // denied — allow resend
      db.prepare('DELETE FROM friend_requests WHERE id = ?').run(existing.id);
    }

    const id = uuidv4();
    db.prepare('INSERT INTO friend_requests (id, from_user_id, to_user_id) VALUES (?, ?, ?)')
      .run(id, currentUserId, target.id);

    res.status(201).json({ id, from_user_id: currentUserId, to_user_id: target.id, status: 'pending' });
  } catch (err) {
    console.error('friends/request error:', err);
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
             u.username, u.identity_pubkey
      FROM friend_requests fr
      JOIN users u ON u.id = fr.from_user_id
      WHERE fr.to_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).all(currentUserId);

    res.json({ requests: rows });
  } catch (err) {
    console.error('friends/requests GET error:', err);
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
             u.username, u.identity_pubkey
      FROM friend_requests fr
      JOIN users u ON u.id = fr.to_user_id
      WHERE fr.from_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).all(currentUserId);

    res.json({ requests: rows });
  } catch (err) {
    console.error('friends/requests/sent GET error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── POST /friends/requests/:id/accept ────────────────────────────────────────
friendsRouter.post('/requests/:id/accept', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;
    const requestId = req.params.id;

    const request = db.prepare(
      "SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'"
    ).get(requestId, currentUserId);

    if (!request) {
      return res.status(404).json({ error: 'Friend request not found', code: 'not_found' });
    }

    const sender = db.prepare(
      'SELECT id, username, identity_pubkey FROM users WHERE id = ?'
    ).get(request.from_user_id);

    db.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = datetime('now') WHERE id = ?")
      .run(requestId);

    res.json({ status: 'accepted', contact: sender });
  } catch (err) {
    console.error('friends/requests accept error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── POST /friends/requests/:id/deny ──────────────────────────────────────────
friendsRouter.post('/requests/:id/deny', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;
    const requestId = req.params.id;

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
    console.error('friends/requests deny error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── DELETE /friends/requests/:id — cancel outgoing ───────────────────────────
friendsRouter.delete('/requests/:id', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const currentUserId = req.userId;
    const requestId = req.params.id;

    const info = db.prepare(
      "DELETE FROM friend_requests WHERE id = ? AND from_user_id = ? AND status = 'pending'"
    ).run(requestId, currentUserId);

    if (info.changes === 0) {
      return res.status(404).json({ error: 'Request not found', code: 'not_found' });
    }

    res.json({ status: 'cancelled' });
  } catch (err) {
    console.error('friends/requests DELETE error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});
