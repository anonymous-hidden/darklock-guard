/**
 * Channel Service — business logic for channel CRUD and secure channel operations.
 */
import { randomUUID } from 'crypto';
import { eventBus } from '../core/event-bus.js';
import { broadcast } from '../sse.js';

/**
 * Get a channel by ID.
 */
export function getChannel(db, { channelId, serverId }) {
  return db.prepare('SELECT * FROM channels WHERE id = ? AND server_id = ?').get(channelId, serverId);
}

/**
 * Get all channels for a server.
 */
export function getChannels(db, { serverId }) {
  return db.prepare(
    'SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC'
  ).all(serverId);
}

/**
 * Verify user membership in a server.
 */
export function verifyMembership(db, { serverId, userId }) {
  return !!db.prepare(
    'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?'
  ).get(serverId, userId);
}

/**
 * Mark a channel as secure.
 * @returns {{ success: boolean, error?: string }}
 */
export function setChannelSecure(db, { serverId, channelId }) {
  const channel = getChannel(db, { channelId, serverId });
  if (!channel) return { success: false, error: 'Channel not found' };
  if (channel.is_secure) return { success: true }; // already secure

  db.prepare('UPDATE channels SET is_secure = 1 WHERE id = ?').run(channelId);

  eventBus.fire('channel.secured', { serverId, channelId, isSecure: true });
  broadcast(serverId, 'channel.secured', { channel_id: channelId, is_secure: true });

  return { success: true };
}

/**
 * Remove secure status from a channel.
 */
export function removeChannelSecure(db, { serverId, channelId }) {
  const channel = getChannel(db, { channelId, serverId });
  if (!channel) return { success: false, error: 'Channel not found' };

  db.prepare('UPDATE channels SET is_secure = 0 WHERE id = ?').run(channelId);

  eventBus.fire('channel.secured', { serverId, channelId, isSecure: false });
  broadcast(serverId, 'channel.secured', { channel_id: channelId, is_secure: false });

  return { success: true };
}

/**
 * Activate lockdown on a channel.
 */
export function activateLockdown(db, { serverId, channelId }) {
  const channel = getChannel(db, { channelId, serverId });
  if (!channel) return { success: false, error: 'Channel not found' };
  if (!channel.is_secure) return { success: false, error: 'Channel must be secure to lockdown' };

  db.prepare('UPDATE channels SET lockdown = 1 WHERE id = ?').run(channelId);

  eventBus.fire('channel.lockdown', { serverId, channelId, active: true });
  broadcast(serverId, 'channel.lockdown', { channel_id: channelId, active: true });

  return { success: true };
}

/**
 * Release lockdown on a channel.
 */
export function releaseLockdown(db, { serverId, channelId }) {
  const channel = getChannel(db, { channelId, serverId });
  if (!channel) return { success: false, error: 'Channel not found' };

  db.prepare('UPDATE channels SET lockdown = 0 WHERE id = ?').run(channelId);

  eventBus.fire('channel.lockdown', { serverId, channelId, active: false });
  broadcast(serverId, 'channel.lockdown', { channel_id: channelId, active: false });

  return { success: true };
}
