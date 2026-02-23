/**
 * Voice room state management routes.
 *
 * Tracks which users are in which voice channels and their mute/deafen state.
 * Actual audio is handled client-side via WebRTC — these routes only manage
 * the signaling state (who's connected, muted, deafened).
 *
 * All routes require auth + server membership.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { broadcast } from '../sse.js';
import { Permissions, resolvePermissions, hasPermission } from '../permissions.js';

export const voiceRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function isMember(db, serverId, userId) {
  return !!db.prepare(
    'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?'
  ).get(serverId, userId);
}

function isVoiceChannel(db, serverId, channelId) {
  const ch = db.prepare(
    "SELECT id, type FROM channels WHERE id = ? AND server_id = ? AND type IN ('voice', 'stage')"
  ).get(channelId, serverId);
  return !!ch;
}

function getVoiceMembersForChannel(db, channelId) {
  return db.prepare(`
    SELECT vrm.user_id, vrm.is_muted, vrm.is_deafened, vrm.is_camera_on,
           vrm.is_stage_speaker, vrm.is_stage_requesting, vrm.last_heartbeat_at, vrm.fingerprint, vrm.joined_at,
           u.username, sm.nickname
    FROM voice_room_members vrm
    JOIN users u ON u.id = vrm.user_id
    LEFT JOIN server_members sm ON sm.server_id = vrm.server_id AND sm.user_id = vrm.user_id
    WHERE vrm.channel_id = ?
    ORDER BY vrm.joined_at ASC
  `).all(channelId);
}

function cleanupStaleMembers(db, serverId = null) {
  const rows = db.prepare(`
    SELECT id, server_id, channel_id, user_id
    FROM voice_room_members
    WHERE last_heartbeat_at < datetime('now', '-45 seconds')
      ${serverId ? 'AND server_id = ?' : ''}
  `).all(...(serverId ? [serverId] : []));
  if (!rows.length) return;
  const del = db.prepare('DELETE FROM voice_room_members WHERE id = ?');
  const tx = db.transaction(() => {
    for (const row of rows) del.run(row.id);
  });
  tx();
  for (const row of rows) {
    const members = getVoiceMembersForChannel(db, row.channel_id);
    broadcast(row.server_id, 'voice.timeout', {
      channel_id: row.channel_id,
      user_id: row.user_id,
      members,
    });
  }
}

// ── POST /voice/:serverId/:channelId/join ────────────────────────────────────
voiceRouter.post('/:serverId/:channelId/join', requireAuth, (req, res) => {
  const { serverId, channelId } = req.params;
  const userId = req.userId;
  const db = req.db;
  cleanupStaleMembers(db, serverId);

  if (!isMember(db, serverId, userId)) {
    return res.status(403).json({ error: 'Not a member', code: 'forbidden' });
  }
  if (!isVoiceChannel(db, serverId, channelId)) {
    return res.status(404).json({ error: 'Voice channel not found', code: 'not_found' });
  }

  // Check if already in a voice channel — leave first
  const existing = db.prepare(
    'SELECT id, channel_id, server_id FROM voice_room_members WHERE user_id = ?'
  ).get(userId);

  const txn = db.transaction(() => {
    if (existing) {
      db.prepare('DELETE FROM voice_room_members WHERE id = ?').run(existing.id);
      // Broadcast leave to old channel
      broadcast(existing.server_id, 'voice.leave', {
        channel_id: existing.channel_id,
        user_id: userId,
      });
    }

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO voice_room_members (
        id, server_id, channel_id, user_id, is_muted, is_deafened, is_camera_on,
        is_stage_speaker, is_stage_requesting, last_heartbeat_at, fingerprint
      )
      VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, datetime('now'), ?)
    `).run(id, serverId, channelId, userId, req.body?.fingerprint ?? null);
  });

  txn();

  const members = getVoiceMembersForChannel(db, channelId);

  // Broadcast join
  broadcast(serverId, 'voice.join', {
    channel_id: channelId,
    user_id: userId,
    members,
  });

  res.json({ ok: true, members });
});

// ── POST /voice/:serverId/:channelId/leave ───────────────────────────────────
voiceRouter.post('/:serverId/:channelId/leave', requireAuth, (req, res) => {
  const { serverId, channelId } = req.params;
  const userId = req.userId;
  const db = req.db;

  db.prepare(
    'DELETE FROM voice_room_members WHERE server_id = ? AND channel_id = ? AND user_id = ?'
  ).run(serverId, channelId, userId);

  const members = getVoiceMembersForChannel(db, channelId);

  broadcast(serverId, 'voice.leave', {
    channel_id: channelId,
    user_id: userId,
    members,
  });

  res.json({ ok: true, members });
});

// ── PATCH /voice/:serverId/:channelId/state ──────────────────────────────────
voiceRouter.patch('/:serverId/:channelId/state', requireAuth, (req, res) => {
  const { serverId, channelId } = req.params;
  const userId = req.userId;
  const db = req.db;
  const { is_muted, is_deafened, is_camera_on, fingerprint } = req.body;

  const row = db.prepare(
    'SELECT id FROM voice_room_members WHERE server_id = ? AND channel_id = ? AND user_id = ?'
  ).get(serverId, channelId, userId);

  if (!row) {
    return res.status(404).json({ error: 'Not in this voice channel', code: 'not_found' });
  }

  const fields = [];
  const vals = [];
  if (typeof is_muted === 'boolean') { fields.push('is_muted = ?'); vals.push(is_muted ? 1 : 0); }
  if (typeof is_deafened === 'boolean') { fields.push('is_deafened = ?'); vals.push(is_deafened ? 1 : 0); }
  if (typeof is_camera_on === 'boolean') { fields.push('is_camera_on = ?'); vals.push(is_camera_on ? 1 : 0); }
  if (typeof fingerprint === 'string') { fields.push('fingerprint = ?'); vals.push(fingerprint); }
  fields.push("last_heartbeat_at = datetime('now')");

  if (fields.length > 0) {
    vals.push(row.id);
    db.prepare(`UPDATE voice_room_members SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  }

  const members = getVoiceMembersForChannel(db, channelId);

  broadcast(serverId, 'voice.state', {
    channel_id: channelId,
    user_id: userId,
    is_muted: is_muted ?? undefined,
    is_deafened: is_deafened ?? undefined,
    is_camera_on: is_camera_on ?? undefined,
    fingerprint: typeof fingerprint === 'string' ? fingerprint : undefined,
    members,
  });

  res.json({ ok: true, members });
});

// ── GET /voice/:serverId/:channelId/members ──────────────────────────────────
voiceRouter.get('/:serverId/:channelId/members', requireAuth, (req, res) => {
  const { serverId, channelId } = req.params;
  const userId = req.userId;
  const db = req.db;

  if (!isMember(db, serverId, userId)) {
    return res.status(403).json({ error: 'Not a member', code: 'forbidden' });
  }
  cleanupStaleMembers(db, serverId);

  const members = getVoiceMembersForChannel(db, channelId);
  res.json({ members });
});

// ── GET /voice/:serverId/state ───────────────────────────────────────────────
// Returns all voice room members across all voice channels in this server.
voiceRouter.get('/:serverId/state', requireAuth, (req, res) => {
  const { serverId } = req.params;
  const userId = req.userId;
  const db = req.db;
  cleanupStaleMembers(db, serverId);

  if (!isMember(db, serverId, userId)) {
    return res.status(403).json({ error: 'Not a member', code: 'forbidden' });
  }

  const rows = db.prepare(`
    SELECT vrm.channel_id, vrm.user_id, vrm.is_muted, vrm.is_deafened, vrm.is_camera_on,
           vrm.is_stage_speaker, vrm.is_stage_requesting, vrm.last_heartbeat_at, vrm.fingerprint, vrm.joined_at,
           u.username, sm.nickname
    FROM voice_room_members vrm
    JOIN users u ON u.id = vrm.user_id
    LEFT JOIN server_members sm ON sm.server_id = vrm.server_id AND sm.user_id = vrm.user_id
    WHERE vrm.server_id = ?
    ORDER BY vrm.joined_at ASC
  `).all(serverId);

  // Group by channel_id
  const channels = {};
  for (const r of rows) {
    if (!channels[r.channel_id]) channels[r.channel_id] = [];
    channels[r.channel_id].push(r);
  }

  res.json({ channels });
});

// ── POST /voice/:serverId/:channelId/heartbeat ──────────────────────────────
voiceRouter.post('/:serverId/:channelId/heartbeat', requireAuth, (req, res) => {
  const { serverId, channelId } = req.params;
  const userId = req.userId;
  const db = req.db;
  db.prepare(`
    UPDATE voice_room_members
    SET last_heartbeat_at = datetime('now')
    WHERE server_id = ? AND channel_id = ? AND user_id = ?
  `).run(serverId, channelId, userId);
  cleanupStaleMembers(db, serverId);
  res.json({ ok: true });
});

// ── POST /voice/:serverId/:channelId/stage/request ──────────────────────────
voiceRouter.post('/:serverId/:channelId/stage/request', requireAuth, (req, res) => {
  const { serverId, channelId } = req.params;
  const userId = req.userId;
  const db = req.db;
  const ch = db.prepare("SELECT type FROM channels WHERE id = ? AND server_id = ?").get(channelId, serverId);
  if (!ch || ch.type !== 'stage') return res.status(404).json({ error: 'Stage channel not found', code: 'not_found' });
  const inStage = db.prepare('SELECT id FROM voice_room_members WHERE server_id = ? AND channel_id = ? AND user_id = ?').get(serverId, channelId, userId);
  if (!inStage) return res.status(404).json({ error: 'Not in this stage channel', code: 'not_found' });

  db.prepare(`
    UPDATE voice_room_members
    SET is_stage_requesting = 1, last_heartbeat_at = datetime('now')
    WHERE server_id = ? AND channel_id = ? AND user_id = ?
  `).run(serverId, channelId, userId);
  const members = getVoiceMembersForChannel(db, channelId);
  broadcast(serverId, 'voice.stage.request', { channel_id: channelId, user_id: userId, members });
  res.json({ ok: true, members });
});

// ── POST /voice/:serverId/:channelId/stage/promote/:targetUserId ────────────
voiceRouter.post('/:serverId/:channelId/stage/promote/:targetUserId', requireAuth, (req, res) => {
  const { serverId, channelId, targetUserId } = req.params;
  const userId = req.userId;
  const db = req.db;
  const ch = db.prepare("SELECT type FROM channels WHERE id = ? AND server_id = ?").get(channelId, serverId);
  if (!ch || ch.type !== 'stage') return res.status(404).json({ error: 'Stage channel not found', code: 'not_found' });
  const { permissions: perms } = resolvePermissions({ userId, serverId, channelId, db });
  if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
    return res.status(403).json({ error: 'Missing stage moderation permission', code: 'forbidden' });
  }
  db.prepare(`
    UPDATE voice_room_members
    SET is_stage_speaker = 1, is_stage_requesting = 0
    WHERE server_id = ? AND channel_id = ? AND user_id = ?
  `).run(serverId, channelId, targetUserId);
  const members = getVoiceMembersForChannel(db, channelId);
  broadcast(serverId, 'voice.stage.promote', { channel_id: channelId, user_id: targetUserId, members });
  res.json({ ok: true, members });
});

// ── POST /voice/:serverId/:channelId/stage/demote/:targetUserId ─────────────
voiceRouter.post('/:serverId/:channelId/stage/demote/:targetUserId', requireAuth, (req, res) => {
  const { serverId, channelId, targetUserId } = req.params;
  const userId = req.userId;
  const db = req.db;
  const ch = db.prepare("SELECT type FROM channels WHERE id = ? AND server_id = ?").get(channelId, serverId);
  if (!ch || ch.type !== 'stage') return res.status(404).json({ error: 'Stage channel not found', code: 'not_found' });
  const { permissions: perms } = resolvePermissions({ userId, serverId, channelId, db });
  if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
    return res.status(403).json({ error: 'Missing stage moderation permission', code: 'forbidden' });
  }
  db.prepare(`
    UPDATE voice_room_members
    SET is_stage_speaker = 0, is_stage_requesting = 0
    WHERE server_id = ? AND channel_id = ? AND user_id = ?
  `).run(serverId, channelId, targetUserId);
  const members = getVoiceMembersForChannel(db, channelId);
  broadcast(serverId, 'voice.stage.demote', { channel_id: channelId, user_id: targetUserId, members });
  res.json({ ok: true, members });
});

export { cleanupStaleMembers };
