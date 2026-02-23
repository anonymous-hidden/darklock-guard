import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { broadcast } from './sse.js';
import { canUserAccessChannel } from './channel-rbac-engine.js';

/**
 * WebSocket signaling hub for voice/stage WebRTC.
 * Never logs SDP payloads or key material.
 */
export function initVoiceWs({ server, db, jwtSecret }) {
  const wss = new WebSocketServer({ server, path: '/voice/ws' });
  const clientsByUser = new Map(); // userId -> ws

  function safeSend(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {}
  }

  function cleanupVoiceMembership(userId) {
    if (!userId) return;
    const row = db.prepare('SELECT server_id, channel_id FROM voice_room_members WHERE user_id = ?').get(userId);
    if (!row) return;
    db.prepare('DELETE FROM voice_room_members WHERE user_id = ?').run(userId);
    const members = db.prepare(`
      SELECT vrm.user_id, vrm.is_muted, vrm.is_deafened, vrm.is_camera_on,
             vrm.is_stage_speaker, vrm.is_stage_requesting, vrm.last_heartbeat_at, vrm.fingerprint, vrm.joined_at,
             u.username, sm.nickname
      FROM voice_room_members vrm
      JOIN users u ON u.id = vrm.user_id
      LEFT JOIN server_members sm ON sm.server_id = vrm.server_id AND sm.user_id = vrm.user_id
      WHERE vrm.channel_id = ?
      ORDER BY vrm.joined_at ASC
    `).all(row.channel_id);
    broadcast(row.server_id, 'voice.leave', {
      channel_id: row.channel_id,
      user_id: userId,
      members,
    });
  }

  wss.on('connection', (ws, req) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        safeSend(ws, { type: 'error', code: 'unauthorized', error: 'Missing token' });
        ws.close();
        return;
      }
      const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
      const userId = payload.sub;
      if (!userId) {
        safeSend(ws, { type: 'error', code: 'unauthorized', error: 'Invalid token' });
        ws.close();
        return;
      }

      ws.userId = userId;
      clientsByUser.set(userId, ws);
      safeSend(ws, { type: 'connected', user_id: userId });

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return safeSend(ws, { type: 'error', code: 'bad_request', error: 'Invalid JSON payload' });
        }

        if (!msg || typeof msg !== 'object') return;
        const serverId = msg.server_id;
        const channelId = msg.channel_id;

        // ── RBAC: Verify VIEW_CHANNEL permission for voice channel actions ──
        if (serverId && channelId && msg.type !== 'voice.heartbeat') {
          const viewResult = canUserAccessChannel({ userId, serverId, channelId, permissionKey: 'channel.view', db });
          if (!viewResult.allowed) {
            return safeSend(ws, { type: 'error', code: 'forbidden', error: 'No access to this voice channel' });
          }
        }

        switch (msg.type) {
          case 'voice.heartbeat': {
            db.prepare(`
              UPDATE voice_room_members SET last_heartbeat_at = datetime('now')
              WHERE user_id = ? AND server_id = ? AND channel_id = ?
            `).run(userId, serverId, channelId);
            return;
          }
          case 'voice.fingerprint': {
            if (typeof msg.fingerprint === 'string') {
              db.prepare(`
                UPDATE voice_room_members
                SET fingerprint = ?, last_heartbeat_at = datetime('now')
                WHERE user_id = ? AND server_id = ? AND channel_id = ?
              `).run(msg.fingerprint, userId, serverId, channelId);
            }
            return;
          }
          case 'voice.signal': {
            const targetUserId = msg.target_user_id;
            if (!targetUserId || !serverId || !channelId) {
              return safeSend(ws, { type: 'error', code: 'bad_request', error: 'Missing signaling fields' });
            }
            const senderMember = db.prepare(`
              SELECT 1 FROM voice_room_members
              WHERE user_id = ? AND server_id = ? AND channel_id = ?
            `).get(userId, serverId, channelId);
            const targetMember = db.prepare(`
              SELECT 1 FROM voice_room_members
              WHERE user_id = ? AND server_id = ? AND channel_id = ?
            `).get(targetUserId, serverId, channelId);
            if (!senderMember || !targetMember) {
              return safeSend(ws, { type: 'error', code: 'forbidden', error: 'Both peers must be in the same voice channel' });
            }
            const targetWs = clientsByUser.get(targetUserId);
            if (targetWs) {
              // Intentionally do not log SDP/ICE payload for security.
              safeSend(targetWs, {
                type: 'voice.signal',
                server_id: serverId,
                channel_id: channelId,
                from_user_id: userId,
                signal_type: msg.signal_type,
                payload: msg.payload,
              });
            }
            return;
          }
          default:
            return safeSend(ws, { type: 'error', code: 'bad_request', error: 'Unsupported event type' });
        }
      });

      ws.on('close', () => {
        clientsByUser.delete(userId);
        cleanupVoiceMembership(userId);
      });
    } catch {
      safeSend(ws, { type: 'error', code: 'unauthorized', error: 'Invalid token' });
      ws.close();
    }
  });

  return wss;
}
