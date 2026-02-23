/**
 * Permission Service — wraps the RBAC engine for clean access from routes/gateway.
 */
import {
  canUserAccessChannel,
  filterVisibleChannels,
  resolveSecurityLevel,
  SecurityLevel,
} from '../channel-rbac-engine.js';
import {
  checkSecureChannelAccess,
} from '../security-channel-rules.js';
import {
  Permissions,
  resolvePermissions,
  hasPermission,
} from '../permissions.js';

/**
 * Check if a user can view a specific channel.
 */
export function canView(db, { userId, serverId, channelId }) {
  return canUserAccessChannel({
    userId, serverId, channelId,
    permissionKey: 'channel.view', db,
  });
}

/**
 * Check if a user can send messages in a channel (handles secure channels).
 */
export function canSend(db, { userId, serverId, channelId, ip }) {
  return checkSecureChannelAccess({
    userId, serverId, channelId,
    permissionKey: 'channel.send',
    action: 'send_message',
    db, ip,
  });
}

/**
 * Check if a user can delete messages (others' messages) in a channel.
 */
export function canDeleteOthers(db, { userId, serverId, channelId, ip }) {
  return checkSecureChannelAccess({
    userId, serverId, channelId,
    permissionKey: 'channel.delete_messages',
    action: 'delete_message',
    db, ip,
    extra: { isOwnMessage: false },
  });
}

/**
 * Check if a user can manage channels.
 */
export function canManageChannels(db, { userId, serverId, channelId }) {
  return canUserAccessChannel({
    userId, serverId, channelId,
    permissionKey: 'channel.manage', db,
  });
}

/**
 * Get the security level for a user in a server.
 */
export function getSecurityLevel(db, { userId, serverId }) {
  return resolveSecurityLevel({ userId, serverId, db });
}

/**
 * Get all visible channels for a user in a server.
 */
export function getVisibleChannels(db, { userId, serverId }) {
  return filterVisibleChannels({ userId, serverId, db });
}

/**
 * Check if a user has ADMINISTRATOR permission in a server.
 */
export function isAdministrator(db, { userId, serverId }) {
  const { permissions } = resolvePermissions({ userId, serverId, db });
  return hasPermission(permissions, Permissions.ADMINISTRATOR);
}

export { SecurityLevel, Permissions };
