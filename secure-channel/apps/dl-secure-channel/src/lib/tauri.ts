/**
 * Tauri command bridge — thin typed wrappers over `invoke()`.
 * All crypto and DB operations happen in Rust; the frontend only has
 * serialisable DTOs.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  AuthResult,
  AuditLogEntryDto,
  AutoModEventDto,
  AutoModRuleDto,
  ChannelDto,
  ChannelOverrideDto,
  ContactDto,
  FriendRequestDto,
  GroupDto,
  InviteDto,
  InviteInfoDto,
  MentionNotificationDto,
  MyTagsDto,
  MessageDto,
  PinnedMessageDto,
  PresenceDto,
  ProfileDto,
  RoleDto,
  SecurityCheckResult,
  ServerDto,
  ServerUnreadDto,
  ServerMemberDto,
  UserTagDto,
  UserKeysResponse,
} from "../types";

// ── Auth ────────────────────────────────────────────────────────────────────

export const register = (username: string, email: string, password: string) => {
  console.log("[TAURI] register →", { username, email });
  return invoke<AuthResult>("cmd_register", { username, email, password })
    .then((r) => { console.log("[TAURI] register ✓ userId=", r.user_id); return r; })
    .catch((e) => { console.error("[TAURI] register ✗", String(e)); throw e; });
};

export const login = (usernameOrEmail: string, password: string) => {
  console.log("[TAURI] login →", { usernameOrEmail });
  return invoke<AuthResult>("cmd_login", { usernameOrEmail, password })
    .then((r) => { console.log("[TAURI] login ✓ userId=", r.user_id, "username=", r.username); return r; })
    .catch((e) => { console.error("[TAURI] login ✗", String(e)); throw e; });
};

export const logout = () => invoke<void>("cmd_logout");

export const enrollDevice = (deviceName: string) =>
  invoke<string>("cmd_enroll_device", { deviceName });

// ── Security ────────────────────────────────────────────────────────────────

export const runSecurityCheck = () =>
  invoke<SecurityCheckResult>("cmd_run_security_check");

// ── Contacts ────────────────────────────────────────────────────────────────

export const getContacts = () => invoke<ContactDto[]>("cmd_get_contacts");

/** Sync accepted IDS friends into the local contacts table. Returns count upserted. */
export const syncContacts = () => invoke<number>("cmd_sync_contacts");

export const verifyContact = (contactUserId: string, fingerprint?: string) =>
  invoke<void>("cmd_verify_contact", { contactUserId, fingerprint });

export const getUserKeys = (userId: string) =>
  invoke<UserKeysResponse>("cmd_get_user_keys", { userId });

// ── Friend requests ──────────────────────────────────────────────────────────

/** Send a friend request to a user by username. Returns a FriendRequestDto. */
export const sendFriendRequest = (username: string) =>
  invoke<FriendRequestDto>("cmd_send_friend_request", { username });

/** Poll IDS for all pending friend requests (incoming + outgoing). */
export const getPendingRequests = () =>
  invoke<FriendRequestDto[]>("cmd_get_pending_requests");

/** Accept or deny an incoming friend request by its IDS request_id. */
export const respondFriendRequest = (requestId: string, accept: boolean) =>
  invoke<void>("cmd_respond_friend_request", { requestId, accept });

/** Cancel an outgoing friend request by its IDS request_id. */
export const cancelFriendRequest = (requestId: string) =>
  invoke<void>("cmd_cancel_friend_request", { requestId });

// ── Messaging ───────────────────────────────────────────────────────────────

export const startSession = (peerUserId: string) =>
  invoke<string>("cmd_start_session", { peerUserId });

export const sendMessage = (sessionId: string, body: string) => {
  const t0 = performance?.now?.() ?? Date.now();
  console.log("[TAURI] sendMessage →", { sessionId, length: body?.length ?? 0 });
  return invoke<MessageDto>("cmd_send_message", { sessionId, body })
    .then((r) => {
      const dt = (performance?.now?.() ?? Date.now()) - t0;
      console.log("[TAURI] sendMessage ✓", { id: r?.id, delivery_state: r?.delivery_state, ms: Math.round(dt) });
      return r;
    })
    .catch((e) => {
      const dt = (performance?.now?.() ?? Date.now()) - t0;
      console.error("[TAURI] sendMessage ✗", { ms: Math.round(dt), error: String(e) });
      throw e;
    });
};

export const pollInbox = () => {
  const t0 = performance?.now?.() ?? Date.now();
  console.log("[TAURI] pollInbox →");
  return invoke<MessageDto[]>("cmd_poll_inbox")
    .then((r) => {
      const dt = (performance?.now?.() ?? Date.now()) - t0;
      console.log("[TAURI] pollInbox ✓", { count: r?.length ?? 0, ms: Math.round(dt) });
      return r;
    })
    .catch((e) => {
      const dt = (performance?.now?.() ?? Date.now()) - t0;
      console.error("[TAURI] pollInbox ✗", { ms: Math.round(dt), error: String(e) });
      throw e;
    });
};

export const getMessages = (sessionId: string, limit: number, beforeN?: number) => {
  const t0 = performance?.now?.() ?? Date.now();
  console.log("[TAURI] getMessages →", { sessionId, limit, beforeN });
  return invoke<MessageDto[]>("cmd_get_messages", { sessionId, limit, beforeN })
    .then((r) => {
      const dt = (performance?.now?.() ?? Date.now()) - t0;
      console.log("[TAURI] getMessages ✓", { sessionId, count: r?.length ?? 0, ms: Math.round(dt) });
      return r;
    })
    .catch((e) => {
      const dt = (performance?.now?.() ?? Date.now()) - t0;
      console.error("[TAURI] getMessages ✗", { sessionId, ms: Math.round(dt), error: String(e) });
      throw e;
    });
};

export const sendAttachment = (sessionId: string, filePath: string) => {
  const t0 = performance?.now?.() ?? Date.now();
  const filename = String(filePath).split(/[/\\]/).pop() ?? "(unknown)";
  console.log("[TAURI] sendAttachment →", { sessionId, filename });
  return invoke<MessageDto>("cmd_send_attachment", { sessionId, filePath })
    .then((r) => {
      const dt = (performance?.now?.() ?? Date.now()) - t0;
      console.log("[TAURI] sendAttachment ✓", { id: r?.id, delivery_state: r?.delivery_state, ms: Math.round(dt) });
      return r;
    })
    .catch((e) => {
      const dt = (performance?.now?.() ?? Date.now()) - t0;
      console.error("[TAURI] sendAttachment ✗", { ms: Math.round(dt), error: String(e) });
      throw e;
    });
};

// ── Groups ──────────────────────────────────────────────────────────────────

export const createGroup = (name: string, description?: string, memberUserIds?: string[]) =>
  invoke<GroupDto>("cmd_create_group", { name, description, memberUserIds: memberUserIds ?? [] });

export const getGroups = () => invoke<GroupDto[]>("cmd_get_groups");

// ── Profile ─────────────────────────────────────────────────────────────────

export const getProfile = () => invoke<ProfileDto>("cmd_get_profile");

export const rotateDeviceKey = () => invoke<void>("cmd_rotate_device_key");

export const updateProfile = (displayName: string) =>
  invoke<void>("cmd_update_profile", { displayName });

export const changePassword = (currentPassword: string, newPassword: string) =>
  invoke<void>("cmd_change_password", { currentPassword, newPassword });

export const removeDevice = (deviceId: string) =>
  invoke<void>("cmd_remove_device", { deviceId });

export const exportIdentityKey = () =>
  invoke<string>("cmd_export_identity_key");

export const getContactProfile = (userId: string) =>
  invoke<import("../types").ContactProfileDto>("cmd_get_contact_profile", { userId });

export const updatePublicProfile = (args: {
  profileBio?: string | null;
  pronouns?: string | null;
  customStatus?: string | null;
  profileColor?: string | null;
  avatar?: string | null;
  banner?: string | null;
}) => invoke<void>("cmd_update_public_profile", {
  profileBio: args.profileBio ?? null,
  pronouns: args.pronouns ?? null,
  customStatus: args.customStatus ?? null,
  profileColor: args.profileColor ?? null,
  avatar: args.avatar ?? null,
  banner: args.banner ?? null,
});

export const clearLocalCache = () =>
  invoke<void>("cmd_clear_local_cache");

export const resetVault = (password: string) =>
  invoke<void>("cmd_reset_vault", { password });

export const exportBackup = () =>
  invoke<string>("cmd_export_backup");

// ── Settings ────────────────────────────────────────────────────────────────

export const getSettings = () => invoke<Record<string, string>>("cmd_get_settings");

export const setSetting = (key: string, value: string) =>
  invoke<void>("cmd_set_setting", { key, value });

// ── Vault ───────────────────────────────────────────────────────────────────

export const lockVault = () => invoke<void>("cmd_lock_vault");

export const unlockVault = (password: string) =>
  invoke<void>("cmd_unlock_vault", { password });

// ── Servers ─────────────────────────────────────────────────────────────────

export const createServer = (name: string, description?: string) => {
  console.log("[TAURI] createServer →", { name, description });
  return invoke<ServerDto>("cmd_create_server", { name, description: description ?? null })
    .then((r) => { console.log("[TAURI] createServer ✓", r); return r; })
    .catch((e) => { console.error("[TAURI] createServer ✗", e); throw e; });
};

export const getServers = () => {
  console.log("[TAURI] getServers →");
  return invoke<ServerDto[]>("cmd_get_servers")
    .then((r) => { console.log("[TAURI] getServers ✓", r?.length, "servers:", r?.map(s => `${s.id.slice(0,8)} ${s.name}`)); return r; })
    .catch((e) => { console.error("[TAURI] getServers ✗", e); throw e; });
};

export const getServer = (serverId: string) => {
  console.log("[TAURI] getServer →", { serverId });
  return invoke<ServerDto>("cmd_get_server", { serverId })
    .then((r) => { console.log("[TAURI] getServer ✓", r); return r; })
    .catch((e) => { console.error("[TAURI] getServer ✗", e); throw e; });
};

export const updateServer = (serverId: string, name?: string, description?: string, icon?: string, bannerColor?: string) => {
  console.log("[TAURI] updateServer →", { serverId, name, description, icon, bannerColor });
  return invoke<ServerDto>("cmd_update_server", {
    serverId,
    name: name ?? null,
    description: description ?? null,
    icon: icon ?? null,
    bannerColor: bannerColor ?? null,
  })
    .then((r) => { console.log("[TAURI] updateServer ✓", r); return r; })
    .catch((e) => { console.error("[TAURI] updateServer ✗", e); throw e; });
};

export const deleteServer = (serverId: string) => {
  console.log("[TAURI] deleteServer →", { serverId });
  return invoke<void>("cmd_delete_server", { serverId })
    .then((r) => { console.log("[TAURI] deleteServer ✓"); return r; })
    .catch((e) => { console.error("[TAURI] deleteServer ✗", e); throw e; });
};

// ── Server Members ──────────────────────────────────────────────────────────

export const getServerMembers = (serverId: string) => {
  console.log("[TAURI] getServerMembers →", { serverId });
  return invoke<ServerMemberDto[]>("cmd_get_server_members", { serverId })
    .then((r) => { console.log("[TAURI] getServerMembers ✓", r?.length, "members"); return r; })
    .catch((e) => { console.error("[TAURI] getServerMembers ✗", e); throw e; });
};

export const addServerMember = (serverId: string, userId: string) => {
  console.log("[tauri] addServerMember", { serverId, targetUserId: userId });
  return invoke<void>("cmd_add_server_member", { serverId, targetUserId: userId });
};

export const removeServerMember = (serverId: string, userId: string) => {
  console.log("[tauri] removeServerMember", { serverId, targetUserId: userId });
  return invoke<void>("cmd_remove_server_member", { serverId, targetUserId: userId });
};

// ── Channels ────────────────────────────────────────────────────────────────

export const getChannels = (serverId: string) => {
  console.log("[TAURI] getChannels →", { serverId });
  return invoke<ChannelDto[]>("cmd_get_channels", { serverId })
    .then((r) => { console.log("[TAURI] getChannels ✓", r?.length, "channels:", r?.map(c => c.name)); return r; })
    .catch((e) => { console.error("[TAURI] getChannels ✗", e); throw e; });
};

export const createChannel = (serverId: string, name: string, channelType?: string, topic?: string, categoryId?: string | null, isSecure?: boolean) => {
  console.log("[tauri] createChannel", { serverId, name, channelType: channelType ?? "text", topic, categoryId, isSecure });
  return invoke<ChannelDto>("cmd_create_channel", {
    serverId,
    name,
    channelType: channelType ?? "text",
    topic: topic ?? null,
    categoryId: categoryId ?? null,
    isSecure: isSecure ?? false,
  });
};

export const updateChannel = (serverId: string, channelId: string, name?: string, topic?: string, position?: number, categoryId?: string | null) => {
  console.log("[TAURI] updateChannel →", { serverId, channelId, name, topic, position, categoryId });
  return invoke<void>("cmd_update_channel", {
    serverId,
    channelId,
    name: name ?? null,
    topic: topic ?? null,
    position: position ?? null,
    categoryId: categoryId ?? null,
  })
    .then((r) => { console.log("[TAURI] updateChannel ✓"); return r; })
    .catch((e) => { console.error("[TAURI] updateChannel ✗", e); throw e; });
};

export const deleteChannel = (serverId: string, channelId: string) => {
  console.log("[TAURI] deleteChannel →", { serverId, channelId });
  return invoke<void>("cmd_delete_channel", { serverId, channelId })
    .then((r) => { console.log("[TAURI] deleteChannel ✓"); return r; })
    .catch((e) => { console.error("[TAURI] deleteChannel ✗", e); throw e; });
};

export const reorderChannels = (serverId: string, channels: { id: string; position: number; category_id?: string | null }[]) => {
  console.log("[TAURI] reorderChannels →", { serverId, count: channels.length });
  return invoke<ChannelDto[]>("cmd_reorder_channels", { serverId, channels })
    .then((r) => { console.log("[TAURI] reorderChannels ✓", r?.length, "channels"); return r; })
    .catch((e) => { console.error("[TAURI] reorderChannels ✗", e); throw e; });
};

// ── Secure Channels (RBAC) ──────────────────────────────────────────────────

export const setChannelSecure = (serverId: string, channelId: string) =>
  invoke<{ ok: boolean; is_secure: boolean }>("cmd_set_channel_secure", { serverId, channelId });

export const removeChannelSecure = (serverId: string, channelId: string) =>
  invoke<{ ok: boolean; is_secure: boolean }>("cmd_remove_channel_secure", { serverId, channelId });

export const triggerLockdown = (serverId: string, channelId: string, reason?: string) =>
  invoke<{ ok: boolean; lockdown: boolean }>("cmd_trigger_lockdown", { serverId, channelId, reason: reason ?? null });

export const releaseLockdown = (serverId: string, channelId: string) =>
  invoke<{ ok: boolean; lockdown: boolean }>("cmd_release_lockdown", { serverId, channelId });

export const getSecureAudit = (serverId: string, channelId: string, limit?: number, before?: string) =>
  invoke<{ audit_entries: import("../types").SecureChannelAuditDto[] }>("cmd_get_secure_audit", {
    serverId, channelId, limit: limit ?? 50, before: before ?? null,
  });

// ── Security Alerts ─────────────────────────────────────────────────────────

export const createSecurityAlert = (
  serverId: string,
  alertType: string,
  severity?: string,
  channelId?: string | null,
  message?: string | null,
) =>
  invoke<import("../types").SecurityAlertDto>("cmd_create_security_alert", {
    serverId,
    alertType,
    severity: severity ?? "medium",
    channelId: channelId ?? null,
    message: message ?? null,
  });

export const getSecurityAlerts = (
  serverId: string,
  limit?: number,
  channelId?: string | null,
  alertType?: string | null,
) =>
  invoke<{ alerts: import("../types").SecurityAlertDto[] }>("cmd_get_security_alerts", {
    serverId,
    limit: limit ?? 50,
    channelId: channelId ?? null,
    alertType: alertType ?? null,
  });

export const resolveSecurityAlert = (serverId: string, alertId: string) =>
  invoke<{ ok: boolean }>("cmd_resolve_security_alert", { serverId, alertId });

export const getSecurityAuditLog = (
  serverId: string,
  limit?: number,
  channelId?: string | null,
  action?: string | null,
) =>
  invoke<{ audit_entries: import("../types").SecureChannelAuditDto[] }>("cmd_get_security_audit", {
    serverId,
    limit: limit ?? 50,
    channelId: channelId ?? null,
    action: action ?? null,
  });

// ── Roles ───────────────────────────────────────────────────────────────────

export const getRoles = (serverId: string) => {
  console.log("[TAURI] getRoles →", { serverId });
  return invoke<RoleDto[]>("cmd_get_roles", { serverId })
    .then((r) => { console.log("[TAURI] getRoles ✓", r?.length, "roles:", r?.map(ro => ro.name)); return r; })
    .catch((e) => { console.error("[TAURI] getRoles ✗", e); throw e; });
};

export const createRole = (
  serverId: string,
  name: string,
  colorHex?: string,
  permissions?: string,
  isAdmin?: boolean,
  showTag?: boolean,
  hoist?: boolean,
  tagStyle?: string,
  separateMembers?: boolean,
  badgeImageUrl?: string | null,
) => {
  console.log("[TAURI] createRole →", { serverId, name, colorHex, isAdmin, hoist });
  return invoke<RoleDto>("cmd_create_role", {
    serverId,
    name,
    colorHex: colorHex ?? "#99AAB5",
    permissions: permissions ?? null,
    isAdmin: isAdmin ?? false,
    showTag: showTag ?? true,
    hoist: hoist ?? false,
    tagStyle: tagStyle ?? "dot",
    separateMembers: separateMembers ?? false,
    badgeImageUrl: badgeImageUrl ?? null,
  })
    .then((r) => { console.log("[TAURI] createRole ✓", r); return r; })
    .catch((e) => { console.error("[TAURI] createRole ✗", e); throw e; });
};

export const updateRole = (
  serverId: string,
  roleId: string,
  name?: string,
  colorHex?: string,
  permissions?: string,
  isAdmin?: boolean,
  showTag?: boolean,
  hoist?: boolean,
  tagStyle?: string,
  separateMembers?: boolean,
  badgeImageUrl?: string | null,
) => {
  console.log("[TAURI] updateRole →", { serverId, roleId, name, colorHex, isAdmin });
  return invoke<void>("cmd_update_role", {
    serverId,
    roleId,
    name: name ?? null,
    colorHex: colorHex ?? null,
    permissions: permissions ?? null,
    isAdmin: isAdmin ?? null,
    showTag: showTag ?? null,
    hoist: hoist ?? null,
    tagStyle: tagStyle ?? null,
    separateMembers: separateMembers ?? null,
    badgeImageUrl: badgeImageUrl ?? null,
  })
    .then((r) => { console.log("[TAURI] updateRole ✓"); return r; })
    .catch((e) => { console.error("[TAURI] updateRole ✗", e); throw e; });
};

export const deleteRole = (serverId: string, roleId: string) => {
  console.log("[TAURI] deleteRole →", { serverId, roleId });
  return invoke<void>("cmd_delete_role", { serverId, roleId })
    .then((r) => { console.log("[TAURI] deleteRole ✓"); return r; })
    .catch((e) => { console.error("[TAURI] deleteRole ✗", e); throw e; });
};

export const reorderRoles = (serverId: string, roleIds: string[]) => {
  console.log("[TAURI] reorderRoles →", { serverId, roleIds });
  return invoke<void>("cmd_reorder_roles", { serverId, roleIds })
    .then((r) => { console.log("[TAURI] reorderRoles ✓"); return r; })
    .catch((e) => { console.error("[TAURI] reorderRoles ✗", e); throw e; });
};

// ── Role Assignment ─────────────────────────────────────────────────────────

export const assignRole = (serverId: string, userId: string, roleId: string) => {
  console.log("[tauri] assignRole", { serverId, targetUserId: userId, roleId });
  return invoke<void>("cmd_assign_role", { serverId, targetUserId: userId, roleId });
};

export const removeRole = (serverId: string, userId: string, roleId: string) => {
  console.log("[tauri] removeRole", { serverId, targetUserId: userId, roleId });
  return invoke<void>("cmd_remove_role", { serverId, targetUserId: userId, roleId });
};

// ── Channel Permission Overrides ────────────────────────────────────────────

export const getChannelOverrides = (serverId: string, channelId: string) => {
  console.log("[TAURI] getChannelOverrides →", { serverId, channelId });
  return invoke<ChannelOverrideDto[]>("cmd_get_channel_overrides", { serverId, channelId })
    .then((r) => { console.log("[TAURI] getChannelOverrides ✓", r?.length, "overrides"); return r; })
    .catch((e) => { console.error("[TAURI] getChannelOverrides ✗", e); throw e; });
};

export const setChannelOverride = (
  serverId: string,
  channelId: string,
  roleId: string,
  allowPermissions: string,
  denyPermissions: string,
) =>
  invoke<void>("cmd_set_channel_override", {
    serverId,
    channelId,
    roleId,
    allowPermissions,
    denyPermissions,
  });

export const deleteChannelOverride = (serverId: string, channelId: string, roleId: string) =>
  invoke<void>("cmd_delete_channel_override", { serverId, channelId, roleId });

// ── Audit Log ───────────────────────────────────────────────────────────────

export const getAuditLog = (
  serverId: string,
  limit?: number,
  before?: string,
  actorId?: string,
  action?: string,
  targetType?: string,
) => {
  console.log("[TAURI] getAuditLog →", { serverId, limit, before, actorId, action, targetType });
  return invoke<AuditLogEntryDto[]>("cmd_get_audit_log", {
    serverId,
    limit: limit ?? 50,
    before: before ?? null,
    actorId: actorId ?? null,
    action: action ?? null,
    targetType: targetType ?? null,
  })
    .then((r) => { console.log("[TAURI] getAuditLog ✓", r?.length, "entries"); return r; })
    .catch((e) => { console.error("[TAURI] getAuditLog ✗", e); throw e; });
};

// ── Presence ────────────────────────────────────────────────────────────────

export const presenceHeartbeat = (status?: string, customStatus?: string) =>
  invoke<void>("cmd_presence_heartbeat", { status: status ?? null, customStatus: customStatus ?? null });

export const getPresence = (userId: string) =>
  invoke<PresenceDto>("cmd_get_presence", { userId });

export const getBatchPresence = (userIds: string[]) =>
  invoke<PresenceDto[]>("cmd_get_batch_presence", { userIds });

export const setPresenceStatus = (status: string, customStatus?: string) =>
  invoke<void>("cmd_set_presence_status", { status, customStatus: customStatus ?? null });

// ── Invites ─────────────────────────────────────────────────────────────────

export const createInvite = (serverId: string, expiresIn?: string, maxUses?: number) =>
  invoke<InviteDto>("cmd_create_invite", { serverId, expiresIn: expiresIn ?? null, maxUses: maxUses ?? null });

export const getInvites = (serverId: string) =>
  invoke<InviteDto[]>("cmd_get_invites", { serverId });

export const revokeInvite = (serverId: string, inviteId: string) =>
  invoke<void>("cmd_revoke_invite", { serverId, inviteId });

export const getInviteInfo = (inviteToken: string) =>
  invoke<InviteInfoDto>("cmd_get_invite_info", { inviteToken });

export const joinViaInvite = (inviteToken: string) =>
  invoke<Record<string, unknown>>("cmd_join_via_invite", { inviteToken });

// ── AutoMod ─────────────────────────────────────────────────────────────────

export const getAutoModRules = (serverId: string) =>
  invoke<AutoModRuleDto[]>("cmd_get_automod_rules", { serverId });

export const createAutoModRule = (
  serverId: string,
  name: string,
  ruleType: string,
  action: string,
  config: Record<string, unknown>,
  exemptRoles?: string[],
  exemptChannels?: string[],
) =>
  invoke<AutoModRuleDto>("cmd_create_automod_rule", {
    serverId, name, ruleType, action, config,
    exemptRoles: exemptRoles ?? null,
    exemptChannels: exemptChannels ?? null,
  });

export const updateAutoModRule = (
  serverId: string,
  ruleId: string,
  opts: {
    name?: string;
    action?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
    exemptRoles?: string[];
    exemptChannels?: string[];
  },
) =>
  invoke<AutoModRuleDto>("cmd_update_automod_rule", {
    serverId, ruleId,
    name: opts.name ?? null,
    action: opts.action ?? null,
    config: opts.config ?? null,
    enabled: opts.enabled ?? null,
    exemptRoles: opts.exemptRoles ?? null,
    exemptChannels: opts.exemptChannels ?? null,
  });

export const deleteAutoModRule = (serverId: string, ruleId: string) =>
  invoke<void>("cmd_delete_automod_rule", { serverId, ruleId });

export const getAutoModEvents = (serverId: string, limit?: number) =>
  invoke<AutoModEventDto[]>("cmd_get_automod_events", { serverId, limit: limit ?? 50 });

// ── Pins ────────────────────────────────────────────────────────────────────

export const pinDmMessage = (sessionId: string, messageId: string, contentPreview: string) =>
  invoke<PinnedMessageDto>("cmd_pin_dm_message", { sessionId, messageId, contentPreview });

export const unpinDmMessage = (pinId: string) =>
  invoke<void>("cmd_unpin_dm_message", { pinId });

export const getDmPins = (sessionId: string) =>
  invoke<PinnedMessageDto[]>("cmd_get_dm_pins", { sessionId });

export const pinServerMessage = (serverId: string, channelId: string, messageId: string, contentPreview: string) =>
  invoke<PinnedMessageDto>("cmd_pin_server_message", { serverId, channelId, messageId, contentPreview });

export const getServerPins = (serverId: string, channelId: string) =>
  invoke<PinnedMessageDto[]>("cmd_get_server_pins", { serverId, channelId });

export const unpinServerMessage = (serverId: string, channelId: string, pinId: string) =>
  invoke<void>("cmd_unpin_server_message", { serverId, channelId, pinId });

// ── Channel Messages ────────────────────────────────────────────────────────

import type { ChannelMessageDto } from "@/types";

export const getChannelMessages = (serverId: string, channelId: string, limit?: number, before?: string) =>
  invoke<ChannelMessageDto[]>("cmd_get_channel_messages", { serverId, channelId, limit, before });

export const sendChannelMessage = (serverId: string, channelId: string, content: string, replyToId?: string, msgType?: string) =>
  invoke<ChannelMessageDto>("cmd_send_channel_message", { serverId, channelId, content, replyToId, msgType });

export const editChannelMessage = (serverId: string, channelId: string, messageId: string, content: string) =>
  invoke<ChannelMessageDto>("cmd_edit_channel_message", { serverId, channelId, messageId, content });

export const deleteChannelMessage = (serverId: string, channelId: string, messageId: string) =>
  invoke<void>("cmd_delete_channel_message", { serverId, channelId, messageId });

export const markChannelRead = (serverId: string, channelId: string, lastReadMessageId?: string | null) =>
  invoke<void>("cmd_mark_channel_read", { serverId, channelId, lastReadMessageId: lastReadMessageId ?? null });

export const getServerUnread = (serverId: string) =>
  invoke<ServerUnreadDto>("cmd_get_server_unread", { serverId });

export const getMentionNotifications = (limit?: number) =>
  invoke<MentionNotificationDto[]>("cmd_get_mention_notifications", { limit: limit ?? 50 });

export const markMentionsRead = (notificationIds?: string[], all?: boolean) =>
  invoke<void>("cmd_mark_mentions_read", { notificationIds: notificationIds ?? null, all: all ?? false });

export const getMyTags = () =>
  invoke<MyTagsDto>("cmd_get_my_tags");

export const updateSelectedTags = (tagIds: string[]) =>
  invoke<void>("cmd_update_selected_tags", { tagIds });

export const getUserTags = (userId: string) =>
  invoke<UserTagDto[]>("cmd_get_user_tags", { userId });

// ── Voice Rooms ──────────────────────────────────────────────────────────────

export interface VoiceMemberDto {
  user_id: string;
  is_muted: boolean;
  is_deafened: boolean;
  is_camera_on: boolean;
  is_stage_speaker: boolean;
  is_stage_requesting: boolean;
  last_heartbeat_at?: string | null;
  fingerprint?: string | null;
  joined_at: string;
  username: string;
  nickname: string | null;
}

export const joinVoiceChannel = (serverId: string, channelId: string, fingerprint?: string) =>
  invoke<VoiceMemberDto[]>("cmd_join_voice_channel", { serverId, channelId, fingerprint: fingerprint ?? null });

export const leaveVoiceChannel = (serverId: string, channelId: string) =>
  invoke<void>("cmd_leave_voice_channel", { serverId, channelId });

export const getVoiceMembers = (serverId: string, channelId: string) =>
  invoke<VoiceMemberDto[]>("cmd_get_voice_members", { serverId, channelId });

export const updateVoiceState = (serverId: string, channelId: string, isMuted?: boolean, isDeafened?: boolean, isCameraOn?: boolean, fingerprint?: string) =>
  invoke<void>("cmd_update_voice_state", { serverId, channelId, isMuted, isDeafened, isCameraOn, fingerprint: fingerprint ?? null });

export const getServerVoiceState = (serverId: string) =>
  invoke<{ channels: Record<string, VoiceMemberDto[]> }>("cmd_get_server_voice_state", { serverId });

export const voiceHeartbeat = (serverId: string, channelId: string) =>
  invoke<void>("cmd_voice_heartbeat", { serverId, channelId });

export const stageRequestSpeak = (serverId: string, channelId: string) =>
  invoke<void>("cmd_stage_request_speak", { serverId, channelId });

export const stagePromote = (serverId: string, channelId: string, targetUserId: string) =>
  invoke<void>("cmd_stage_promote", { serverId, channelId, targetUserId });

export const stageDemote = (serverId: string, channelId: string, targetUserId: string) =>
  invoke<void>("cmd_stage_demote", { serverId, channelId, targetUserId });

export const getRealtimeToken = () =>
  invoke<string>("cmd_get_realtime_token");

export const getIdsBaseUrl = () =>
  invoke<string>("cmd_get_ids_base_url");
