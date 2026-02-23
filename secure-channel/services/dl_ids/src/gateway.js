/**
 * WebSocket Messaging Gateway — real-time message delivery, typing indicators,
 * read receipts, and security alerts.
 *
 * Path: /gateway/ws?token=<jwt>
 *
 * Client → Server messages:
 *   { type: "subscribe",   server_id, channel_id }
 *   { type: "unsubscribe", server_id, channel_id }
 *   { type: "typing.start", server_id, channel_id }
 *   { type: "typing.stop",  server_id, channel_id }
 *   { type: "read.ack",     server_id, channel_id, message_id }
 *   { type: "heartbeat" }
 *
 * Server → Client messages:
 *   { type: "connected",    user_id }
 *   { type: "message.created",  server_id, channel_id, message }
 *   { type: "message.edited",   server_id, channel_id, message }
 *   { type: "message.deleted",  server_id, channel_id, message_id }
 *   { type: "typing.update",    server_id, channel_id, user_id, username, active }
 *   { type: "read.receipt",     server_id, channel_id, user_id, last_read_message_id }
 *   { type: "security.alert",   server_id, channel_id, alert }
 *   { type: "channel.lockdown", server_id, channel_id, active }
 *   { type: "channel.secured",  server_id, channel_id, is_secure }
 *   { type: "error",            code, error }
 */
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { eventBus } from './core/event-bus.js';
import { canUserAccessChannel } from './channel-rbac-engine.js';

/** @type {Map<string, Set<WebSocket>>} channelId → active subscribers */
const channelSubscriptions = new Map();

/** @type {Map<string, Set<WebSocket>>} serverId → active subscribers */
const serverSubscriptions = new Map();

/** @type {Map<WebSocket, { userId: string, subscribedChannels: Set<string>, subscribedServers: Set<string> }>} */
const clientState = new Map();

/** @type {Map<string, { username: string, timeout: ReturnType<typeof setTimeout> }>} `chId:userId` → typing info */
const typingState = new Map();

function safeSend(ws, payload) {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  } catch {}
}

function broadcastToChannel(channelId, payload, excludeUserId = null) {
  const subs = channelSubscriptions.get(channelId);
  if (!subs) return;
  for (const ws of subs) {
    const state = clientState.get(ws);
    if (excludeUserId && state?.userId === excludeUserId) continue;
    safeSend(ws, payload);
  }
}

function broadcastToServer(serverId, payload, excludeUserId = null) {
  const subs = serverSubscriptions.get(serverId);
  if (!subs) return;
  for (const ws of subs) {
    const state = clientState.get(ws);
    if (excludeUserId && state?.userId === excludeUserId) continue;
    safeSend(ws, payload);
  }
}

function subscribeChannel(ws, channelId) {
  if (!channelSubscriptions.has(channelId)) {
    channelSubscriptions.set(channelId, new Set());
  }
  channelSubscriptions.get(channelId).add(ws);
  const state = clientState.get(ws);
  if (state) state.subscribedChannels.add(channelId);
}

function unsubscribeChannel(ws, channelId) {
  const subs = channelSubscriptions.get(channelId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) channelSubscriptions.delete(channelId);
  }
  const state = clientState.get(ws);
  if (state) state.subscribedChannels.delete(channelId);
}

function subscribeServer(ws, serverId) {
  if (!serverSubscriptions.has(serverId)) {
    serverSubscriptions.set(serverId, new Set());
  }
  serverSubscriptions.get(serverId).add(ws);
  const state = clientState.get(ws);
  if (state) state.subscribedServers.add(serverId);
}

function cleanupClient(ws) {
  const state = clientState.get(ws);
  if (!state) return;

  // Unsubscribe from all channels
  for (const channelId of state.subscribedChannels) {
    const subs = channelSubscriptions.get(channelId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) channelSubscriptions.delete(channelId);
    }

    // Clear typing state
    const typingKey = `${channelId}:${state.userId}`;
    const typing = typingState.get(typingKey);
    if (typing) {
      clearTimeout(typing.timeout);
      typingState.delete(typingKey);
    }
  }

  // Unsubscribe from all servers
  for (const serverId of state.subscribedServers) {
    const subs = serverSubscriptions.get(serverId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) serverSubscriptions.delete(serverId);
    }
  }

  clientState.delete(ws);
}

/**
 * Initialize the messaging WebSocket gateway.
 * @param {{ server: import('http').Server, db: import('better-sqlite3').Database, jwtSecret: string }} opts
 */
export function initMessagingGateway({ server, db, jwtSecret }) {
  const wss = new WebSocketServer({ server, path: '/gateway/ws' });

  // ── Event bus listeners — relay to subscribed WebSocket clients ──

  eventBus.on('message.created', (evt) => {
    broadcastToChannel(evt.channelId, {
      type: 'message.created',
      server_id: evt.serverId,
      channel_id: evt.channelId,
      message: evt.message,
    }, evt.message?.author_id);
  });

  eventBus.on('message.edited', (evt) => {
    broadcastToChannel(evt.channelId, {
      type: 'message.edited',
      server_id: evt.serverId,
      channel_id: evt.channelId,
      message: evt.message,
    });
  });

  eventBus.on('message.deleted', (evt) => {
    broadcastToChannel(evt.channelId, {
      type: 'message.deleted',
      server_id: evt.serverId,
      channel_id: evt.channelId,
      message_id: evt.messageId,
    });
  });

  eventBus.on('read.receipt', (evt) => {
    broadcastToChannel(evt.channelId, {
      type: 'read.receipt',
      server_id: evt.serverId,
      channel_id: evt.channelId,
      user_id: evt.userId,
      last_read_message_id: evt.lastReadMessageId,
    });
  });

  eventBus.on('security.alert', (evt) => {
    broadcastToServer(evt.serverId, {
      type: 'security.alert',
      server_id: evt.serverId,
      channel_id: evt.channelId,
      alert: evt.alert,
    });
  });

  eventBus.on('channel.lockdown', (evt) => {
    broadcastToServer(evt.serverId, {
      type: 'channel.lockdown',
      server_id: evt.serverId,
      channel_id: evt.channelId,
      active: evt.active,
    });
  });

  eventBus.on('channel.secured', (evt) => {
    broadcastToServer(evt.serverId, {
      type: 'channel.secured',
      server_id: evt.serverId,
      channel_id: evt.channelId,
      is_secure: evt.isSecure,
    });
  });

  // ── WebSocket connection handler ──

  wss.on('connection', (ws, req) => {
    // JWT auth
    let userId;
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        safeSend(ws, { type: 'error', code: 'unauthorized', error: 'Missing token' });
        ws.close();
        return;
      }
      const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
      userId = payload.sub;
      if (!userId) throw new Error('Invalid token');
    } catch (err) {
      safeSend(ws, { type: 'error', code: 'unauthorized', error: 'Invalid or expired token' });
      ws.close();
      return;
    }

    // Register client state
    clientState.set(ws, {
      userId,
      subscribedChannels: new Set(),
      subscribedServers: new Set(),
    });

    safeSend(ws, { type: 'connected', user_id: userId });

    // Heartbeat / keepalive
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // ── Message handler ──

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return safeSend(ws, { type: 'error', code: 'bad_request', error: 'Invalid JSON' });
      }

      if (!msg || typeof msg !== 'object' || !msg.type) return;

      const serverId = msg.server_id;
      const channelId = msg.channel_id;

      switch (msg.type) {
        case 'heartbeat':
          safeSend(ws, { type: 'heartbeat_ack' });
          break;

        case 'subscribe': {
          if (!serverId || !channelId) {
            return safeSend(ws, { type: 'error', code: 'bad_request', error: 'server_id and channel_id required' });
          }

          // Verify membership
          const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
          if (!member) {
            return safeSend(ws, { type: 'error', code: 'forbidden', error: 'Not a member' });
          }

          // RBAC: check VIEW_CHANNEL
          const viewResult = canUserAccessChannel({ userId, serverId, channelId, permissionKey: 'channel.view', db });
          if (!viewResult.allowed) {
            return safeSend(ws, { type: 'error', code: 'forbidden', error: 'No access to this channel' });
          }

          subscribeChannel(ws, channelId);
          subscribeServer(ws, serverId);
          safeSend(ws, { type: 'subscribed', server_id: serverId, channel_id: channelId });
          break;
        }

        case 'unsubscribe': {
          if (!channelId) {
            return safeSend(ws, { type: 'error', code: 'bad_request', error: 'channel_id required' });
          }
          unsubscribeChannel(ws, channelId);
          safeSend(ws, { type: 'unsubscribed', channel_id: channelId });
          break;
        }

        case 'typing.start': {
          if (!serverId || !channelId) return;

          const typingKey = `${channelId}:${userId}`;
          const existing = typingState.get(typingKey);
          if (existing) clearTimeout(existing.timeout);

          // Get username for broadcast
          const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
          const username = user?.username ?? 'Unknown';

          // Auto-expire typing after 8 seconds
          const timeout = setTimeout(() => {
            typingState.delete(typingKey);
            broadcastToChannel(channelId, {
              type: 'typing.update',
              server_id: serverId,
              channel_id: channelId,
              user_id: userId,
              username,
              active: false,
            }, userId);
          }, 8000);

          typingState.set(typingKey, { username, timeout });

          broadcastToChannel(channelId, {
            type: 'typing.update',
            server_id: serverId,
            channel_id: channelId,
            user_id: userId,
            username,
            active: true,
          }, userId);
          break;
        }

        case 'typing.stop': {
          if (!channelId) return;
          const typingKey = `${channelId}:${userId}`;
          const existing = typingState.get(typingKey);
          if (existing) {
            clearTimeout(existing.timeout);
            typingState.delete(typingKey);

            broadcastToChannel(channelId, {
              type: 'typing.update',
              server_id: serverId,
              channel_id: channelId,
              user_id: userId,
              username: existing.username,
              active: false,
            }, userId);
          }
          break;
        }

        case 'read.ack': {
          if (!serverId || !channelId || !msg.message_id) return;

          // Update read state in DB
          try {
            const readAt = new Date().toISOString();
            db.prepare(`
              INSERT INTO channel_read_state (user_id, server_id, channel_id, last_read_message_id, last_read_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(user_id, channel_id) DO UPDATE SET
                last_read_message_id = excluded.last_read_message_id,
                last_read_at = excluded.last_read_at
            `).run(userId, serverId, channelId, msg.message_id, readAt);

            // Broadcast read receipt to channel subscribers
            broadcastToChannel(channelId, {
              type: 'read.receipt',
              server_id: serverId,
              channel_id: channelId,
              user_id: userId,
              last_read_message_id: msg.message_id,
            }, userId);
          } catch (err) {
            console.error('[gateway] read.ack error:', err.message);
          }
          break;
        }

        default:
          safeSend(ws, { type: 'error', code: 'unknown_type', error: `Unknown message type: ${msg.type}` });
      }
    });

    ws.on('close', () => cleanupClient(ws));
    ws.on('error', () => cleanupClient(ws));
  });

  // Ping/pong keepalive every 30s
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        cleanupClient(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  console.log('[Gateway] Messaging WebSocket gateway initialized at /gateway/ws');
  return wss;
}

/**
 * Get gateway stats (for health monitoring).
 */
export function getGatewayStats() {
  return {
    totalClients: clientState.size,
    channelSubscriptions: channelSubscriptions.size,
    serverSubscriptions: serverSubscriptions.size,
    activeTyping: typingState.size,
  };
}
