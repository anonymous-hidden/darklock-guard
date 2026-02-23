/**
 * Server-Sent Events (SSE) hub for real-time server updates.
 *
 * Clients connect to GET /servers/:serverId/events and receive a stream
 * of events: role.updated, role.reordered, override.updated,
 * member.roles.updated, audit.appended, etc.
 */
import { Router } from 'express';
import { requireAuth } from './middleware/auth.js';

export const sseRouter = Router();

/**
 * Map<serverId, Set<{ res, userId }>>
 * Tracks active SSE connections per server.
 */
const serverClients = new Map();
const globalClients = new Set();

/**
 * Broadcast an event to all connected clients of a server.
 *
 * @param {string} serverId
 * @param {string} event - event name (e.g. 'role.updated')
 * @param {object} data - JSON-serializable payload
 * @param {string|null} excludeUserId - don't send to this user (the actor)
 */
export function broadcast(serverId, event, data, excludeUserId = null) {
  const clients = serverClients.get(serverId);
  if (!clients || clients.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of clients) {
    if (excludeUserId && client.userId === excludeUserId) continue;
    try {
      client.res.write(payload);
    } catch {
      // Client disconnected — will be cleaned up on 'close'
    }
  }
}

export function broadcastGlobal(event, data, excludeUserId = null) {
  if (!globalClients.size) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of globalClients) {
    if (excludeUserId && client.userId === excludeUserId) continue;
    try {
      client.res.write(payload);
    } catch {}
  }
}

// ── GET /events — global SSE stream for account/profile level events ────────
sseRouter.get('/events', requireAuth, (req, res) => {
  const userId = req.userId;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`);

  const client = { res, userId };
  globalClients.add(client);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    globalClients.delete(client);
  });
});

// ── GET /servers/:serverId/events — SSE stream ──────────────────────────────
sseRouter.get('/:serverId/events', requireAuth, (req, res) => {
  const { serverId } = req.params;
  const userId = req.userId;
  const db = req.db;

  // Verify membership
  const membership = db.prepare(
    'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?'
  ).get(serverId, userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a member', code: 'forbidden' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Nginx passthrough
  });
  res.flushHeaders();

  // Send initial ping
  res.write(`event: connected\ndata: ${JSON.stringify({ serverId, userId })}\n\n`);

  // Register client
  if (!serverClients.has(serverId)) {
    serverClients.set(serverId, new Set());
  }
  const client = { res, userId };
  serverClients.get(serverId).add(client);

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    const clients = serverClients.get(serverId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) serverClients.delete(serverId);
    }
  });
});
