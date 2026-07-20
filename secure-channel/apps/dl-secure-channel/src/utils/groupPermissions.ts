/* ──────────────────────────────────────────────────────────
 *  Group permission helpers
 * ────────────────────────────────────────────────────────── */

import type { GroupInfo, GroupPermissions, GroupRoleInfo } from '../types';
import { DEFAULT_PERMISSIONS } from '../types';

const DENY_ALL_PERMISSIONS: GroupPermissions = {
  administrator: false,
  manageChannels: false,
  manageRoles: false,
  manageServer: false,
  kickMembers: false,
  banMembers: false,
  manageMessages: false,
  sendMessages: false,
  readMessages: false,
  attachFiles: false,
  useVoice: false,
  mentionEveryone: false,
  viewAuditLog: false,
  manageInvites: false,
};

const ALLOW_ALL_PERMISSIONS: GroupPermissions = {
  administrator: true,
  manageChannels: true,
  manageRoles: true,
  manageServer: true,
  kickMembers: true,
  banMembers: true,
  manageMessages: true,
  sendMessages: true,
  readMessages: true,
  attachFiles: true,
  useVoice: true,
  mentionEveryone: true,
  viewAuditLog: true,
  manageInvites: true,
};

function mergePermissions(base: GroupPermissions, patch: GroupPermissions): GroupPermissions {
  return {
    administrator: base.administrator || patch.administrator,
    manageChannels: base.manageChannels || patch.manageChannels,
    manageRoles: base.manageRoles || patch.manageRoles,
    manageServer: base.manageServer || patch.manageServer,
    kickMembers: base.kickMembers || patch.kickMembers,
    banMembers: base.banMembers || patch.banMembers,
    manageMessages: base.manageMessages || patch.manageMessages,
    sendMessages: base.sendMessages || patch.sendMessages,
    readMessages: base.readMessages || patch.readMessages,
    attachFiles: base.attachFiles || patch.attachFiles,
    useVoice: base.useVoice || patch.useVoice,
    mentionEveryone: base.mentionEveryone || patch.mentionEveryone,
    viewAuditLog: base.viewAuditLog || patch.viewAuditLog,
    manageInvites: base.manageInvites || patch.manageInvites,
  };
}

function sortRolesByPriority(roles: GroupRoleInfo[]): GroupRoleInfo[] {
  return [...roles].sort((a, b) => b.position - a.position);
}

export function resolveGroupPermissions(group: GroupInfo | null | undefined, userId: string | null | undefined): GroupPermissions {
  const normalizedUserId = String(userId ?? '').trim();
  if (!group || !normalizedUserId) return DENY_ALL_PERMISSIONS;

  const member = group.members.find((m) => m.userId === normalizedUserId);
  if (!member || member.banned) return DENY_ALL_PERMISSIONS;

  if (group.createdBy === normalizedUserId || member.role === 'admin') {
    return ALLOW_ALL_PERMISSIONS;
  }

  const roles = sortRolesByPriority(group.roles ?? []);
  const roleMap = new Map(roles.map((role) => [role.id, role]));
  const defaultRole = roles.find((role) => role.isDefault) ?? null;

  let resolved: GroupPermissions = defaultRole
    ? { ...defaultRole.permissions }
    : { ...DEFAULT_PERMISSIONS };

  for (const roleId of member.roleIds ?? []) {
    const role = roleMap.get(roleId);
    if (!role) continue;
    resolved = mergePermissions(resolved, role.permissions);
  }

  if (resolved.administrator) {
    return ALLOW_ALL_PERMISSIONS;
  }

  return resolved;
}
