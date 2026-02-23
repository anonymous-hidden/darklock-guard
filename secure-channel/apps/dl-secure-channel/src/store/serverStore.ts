/**
 * serverStore — manages servers, channels, roles, members for the role/permission system.
 */
import { create } from "zustand";
import type {
  ServerDto,
  ChannelDto,
  RoleDto,
  ServerMemberDto,
  AuditLogEntryDto,
  ChannelOverrideDto,
  InviteDto,
  MentionNotificationDto,
  ServerUnreadDto,
  AutoModRuleDto,
  AutoModEventDto,
} from "../types";
import * as api from "../lib/tauri";
import { useLayoutStore } from "./layoutStore";
import { useChatStore } from "./chatStore";

interface ServerState {
  // ── Data ──────────────────────────────────────────────────────
  servers: ServerDto[];
  /** channels keyed by serverId */
  channels: Record<string, ChannelDto[]>;
  /** roles keyed by serverId (sorted by position desc) */
  roles: Record<string, RoleDto[]>;
  /** members keyed by serverId */
  members: Record<string, ServerMemberDto[]>;
  /** channel overrides keyed by channelId */
  overrides: Record<string, ChannelOverrideDto[]>;
  /** audit log entries keyed by serverId */
  auditLog: Record<string, AuditLogEntryDto[]>;
  /** invites keyed by serverId */
  invites: Record<string, InviteDto[]>;
  /** automod rules keyed by serverId */
  automodRules: Record<string, AutoModRuleDto[]>;
  /** automod events keyed by serverId */
  automodEvents: Record<string, AutoModEventDto[]>;
  /** unread summaries keyed by serverId */
  unreadByServer: Record<string, ServerUnreadDto>;
  mentionNotifications: MentionNotificationDto[];

  activeChannelId: string | null;

  // ── Loading flags ─────────────────────────────────────────────
  loading: boolean;

  // ── Actions ───────────────────────────────────────────────────

  // Servers
  fetchServers: () => Promise<void>;
  createServer: (name: string, description?: string) => Promise<ServerDto>;
  updateServer: (serverId: string, name?: string, description?: string, icon?: string, bannerColor?: string) => Promise<void>;
  deleteServer: (serverId: string) => Promise<void>;

  // Channels
  fetchChannels: (serverId: string) => Promise<void>;
  createChannel: (serverId: string, name: string, type?: string, topic?: string, categoryId?: string | null, isSecure?: boolean) => Promise<ChannelDto>;
  updateChannel: (serverId: string, channelId: string, name?: string, topic?: string, position?: number) => Promise<void>;
  reorderChannels: (serverId: string, channels: { id: string; position: number; category_id?: string | null }[]) => Promise<void>;
  deleteChannel: (serverId: string, channelId: string) => Promise<void>;
  setActiveChannel: (channelId: string | null) => void;
  fetchServerUnread: (serverId: string) => Promise<void>;
  markChannelRead: (serverId: string, channelId: string, lastReadMessageId?: string | null) => Promise<void>;
  fetchMentionNotifications: (limit?: number) => Promise<void>;

  // Roles
  fetchRoles: (serverId: string) => Promise<void>;
  createRole: (serverId: string, name: string, colorHex?: string, permissions?: string, isAdmin?: boolean, showTag?: boolean, hoist?: boolean, tagStyle?: string, separateMembers?: boolean, badgeImageUrl?: string | null) => Promise<RoleDto>;
  updateRole: (serverId: string, roleId: string, opts: { name?: string; colorHex?: string; permissions?: string; isAdmin?: boolean; showTag?: boolean; hoist?: boolean; tagStyle?: string; separateMembers?: boolean; badgeImageUrl?: string | null }) => Promise<void>;
  deleteRole: (serverId: string, roleId: string) => Promise<void>;
  reorderRoles: (serverId: string, roleIds: string[]) => Promise<void>;

  // Role assignment
  assignRole: (serverId: string, userId: string, roleId: string) => Promise<void>;
  removeRole: (serverId: string, userId: string, roleId: string) => Promise<void>;

  // Members
  fetchMembers: (serverId: string) => Promise<void>;
  addMember: (serverId: string, userId: string) => Promise<void>;
  removeMember: (serverId: string, userId: string) => Promise<void>;

  // Channel overrides
  fetchOverrides: (serverId: string, channelId: string) => Promise<void>;
  setOverride: (serverId: string, channelId: string, roleId: string, allow: string, deny: string) => Promise<void>;
  deleteOverride: (serverId: string, channelId: string, roleId: string) => Promise<void>;

  // Audit log
  fetchAuditLog: (serverId: string, opts?: { limit?: number; before?: string; actorId?: string; action?: string; targetType?: string; append?: boolean }) => Promise<number>;

  // Invites
  fetchInvites: (serverId: string) => Promise<void>;
  createInvite: (serverId: string, expiresIn?: string, maxUses?: number) => Promise<InviteDto>;
  revokeInvite: (serverId: string, inviteId: string) => Promise<void>;

  // AutoMod
  fetchAutoModRules: (serverId: string) => Promise<void>;
  createAutoModRule: (serverId: string, name: string, ruleType: string, action: string, config: Record<string, unknown>, exemptRoles?: string[], exemptChannels?: string[]) => Promise<AutoModRuleDto>;
  updateAutoModRule: (serverId: string, ruleId: string, opts: { name?: string; action?: string; config?: Record<string, unknown>; enabled?: boolean; exemptRoles?: string[]; exemptChannels?: string[] }) => Promise<void>;
  deleteAutoModRule: (serverId: string, ruleId: string) => Promise<void>;
  fetchAutoModEvents: (serverId: string, limit?: number) => Promise<void>;

  // SSE
  connectSSE: (serverId: string, apiBaseUrl: string, token: string) => void;
  disconnectSSE: () => void;

  // Reset
  reset: () => void;
}

const initialState = {
  servers: [] as ServerDto[],
  channels: {} as Record<string, ChannelDto[]>,
  roles: {} as Record<string, RoleDto[]>,
  members: {} as Record<string, ServerMemberDto[]>,
  overrides: {} as Record<string, ChannelOverrideDto[]>,
  auditLog: {} as Record<string, AuditLogEntryDto[]>,
  invites: {} as Record<string, InviteDto[]>,
  automodRules: {} as Record<string, AutoModRuleDto[]>,
  automodEvents: {} as Record<string, AutoModEventDto[]>,
  unreadByServer: {} as Record<string, ServerUnreadDto>,
  mentionNotifications: [] as MentionNotificationDto[],
  activeChannelId: null as string | null,
  loading: false,
};

let _sseSource: EventSource | null = null;

export const useServerStore = create<ServerState>((set, get) => ({
  ...initialState,

  // ── Servers ─────────────────────────────────────────────────────
  fetchServers: async () => {
    console.log("[serverStore] fetchServers START");
    set({ loading: true });
    try {
      const servers = await api.getServers();
      console.log("[serverStore] fetchServers GOT", servers?.length, "servers:", servers?.map(s => `${s.id.slice(0,8)} ${s.name}`));
      set({ servers });
      await Promise.allSettled(servers.map((sv) => get().fetchServerUnread(sv.id)));
      await get().fetchMentionNotifications(50);
      // Auto-clear activeServerId if the server no longer exists in the IDS list
      // BUT: do NOT clear local chat-store groups — they are not IDS servers
      const { activeServerId, setActiveServer } = useLayoutStore.getState();
      console.log("[serverStore] fetchServers activeServerId =", activeServerId);
      if (activeServerId && !servers.find((s) => s.id === activeServerId)) {
        const groups = useChatStore.getState().groups;
        const isLocalGroup = groups.some((g) => g.id === activeServerId);
        if (isLocalGroup) {
          console.log("[serverStore] fetchServers: activeServerId is a local group, NOT clearing");
        } else {
          console.warn("[serverStore] fetchServers: activeServerId not in list, clearing");
          setActiveServer(null);
        }
      }
    } catch (e) {
      console.error("[serverStore] fetchServers ERROR", e);
    } finally {
      set({ loading: false });
    }
  },

  createServer: async (name, description) => {
    console.log("[serverStore] createServer →", { name, description });
    const server = await api.createServer(name, description);
    console.log("[serverStore] createServer ✓", server);
    set((s) => ({ servers: [...s.servers, server] }));
    return server;
  },

  updateServer: async (serverId, name, description, icon, bannerColor) => {
    await api.updateServer(serverId, name, description, icon, bannerColor);
    set((s) => ({
      servers: s.servers.map((sv) =>
        sv.id === serverId
          ? { ...sv, ...(name && { name }), ...(description !== undefined && { description }), ...(icon !== undefined && { icon }), ...(bannerColor !== undefined && { banner_color: bannerColor }) }
          : sv
      ),
    }));
  },

  deleteServer: async (serverId) => {
    await api.deleteServer(serverId);
    set((s) => ({
      servers: s.servers.filter((sv) => sv.id !== serverId),
      channels: { ...s.channels, [serverId]: undefined } as Record<string, ChannelDto[]>,
      roles: { ...s.roles, [serverId]: undefined } as Record<string, RoleDto[]>,
      members: { ...s.members, [serverId]: undefined } as Record<string, ServerMemberDto[]>,
    }));
  },

  // ── Channels ────────────────────────────────────────────────────
  fetchChannels: async (serverId) => {
    console.log("[serverStore] fetchChannels →", { serverId });
    try {
      const channels = await api.getChannels(serverId);
      console.log("[serverStore] fetchChannels ✓", channels?.length, "channels:", channels?.map(c => c.name));
      set((s) => ({ channels: { ...s.channels, [serverId]: channels } }));
      await get().fetchServerUnread(serverId);
    } catch (e) {
      console.error("[serverStore] fetchChannels ERROR serverId=", serverId, e);
      throw e;
    }
  },

  createChannel: async (serverId, name, type, topic, categoryId, isSecure) => {
    const ch = await api.createChannel(serverId, name, type, topic, categoryId, isSecure);
    set((s) => ({
      channels: {
        ...s.channels,
        [serverId]: [...(s.channels[serverId] ?? []), ch],
      },
    }));
    return ch;
  },

  updateChannel: async (serverId, channelId, name, topic, position) => {
    await api.updateChannel(serverId, channelId, name, topic, position);
    set((s) => ({
      channels: {
        ...s.channels,
        [serverId]: (s.channels[serverId] ?? []).map((ch) =>
          ch.id === channelId
            ? { ...ch, ...(name && { name }), ...(topic !== undefined && { topic }), ...(position !== undefined && { position }) }
            : ch
        ),
      },
    }));
  },

  reorderChannels: async (serverId, channelsLayout) => {
    const current = get().channels[serverId] ?? [];
    const currentById = new Map(current.map((c) => [c.id, c]));
    const optimistic = channelsLayout
      .map((row, idx) => {
        const ch = currentById.get(row.id);
        if (!ch) return null;
        return {
          ...ch,
          position: typeof row.position === "number" ? row.position : idx,
          category_id: row.category_id ?? null,
        };
      })
      .filter(Boolean) as typeof current;

    set((s) => ({
      channels: {
        ...s.channels,
        [serverId]: optimistic,
      },
    }));

    try {
      const serverChannels = await api.reorderChannels(serverId, channelsLayout);
      set((s) => ({
        channels: { ...s.channels, [serverId]: serverChannels },
      }));
      await get().fetchServerUnread(serverId);
    } catch (e) {
      console.error("[serverStore] reorderChannels ERROR", e);
      set((s) => ({ channels: { ...s.channels, [serverId]: current } }));
      throw e;
    }
  },

  deleteChannel: async (serverId, channelId) => {
    await api.deleteChannel(serverId, channelId);
    set((s) => ({
      channels: {
        ...s.channels,
        [serverId]: (s.channels[serverId] ?? []).filter((ch) => ch.id !== channelId),
      },
      activeChannelId: s.activeChannelId === channelId ? null : s.activeChannelId,
    }));
  },

  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

  fetchServerUnread: async (serverId) => {
    try {
      const unread = await api.getServerUnread(serverId);
      set((s) => ({ unreadByServer: { ...s.unreadByServer, [serverId]: unread } }));
    } catch (e) {
      console.error("[serverStore] fetchServerUnread ERROR", e);
    }
  },

  markChannelRead: async (serverId, channelId, lastReadMessageId) => {
    await api.markChannelRead(serverId, channelId, lastReadMessageId ?? null);
    await get().fetchServerUnread(serverId);
  },

  fetchMentionNotifications: async (limit = 50) => {
    try {
      const mentions = await api.getMentionNotifications(limit);
      set({ mentionNotifications: mentions });
    } catch (e) {
      console.error("[serverStore] fetchMentionNotifications ERROR", e);
    }
  },

  // ── Roles ───────────────────────────────────────────────────────
  fetchRoles: async (serverId) => {
    console.log("[serverStore] fetchRoles →", { serverId });
    try {
      const roles = await api.getRoles(serverId);
      // Sort by position descending (highest first)
      roles.sort((a, b) => b.position - a.position);
      console.log("[serverStore] fetchRoles ✓", roles?.length, "roles:", roles?.map(r => r.name));
      set((s) => ({ roles: { ...s.roles, [serverId]: roles } }));
    } catch (e) {
      console.error("[serverStore] fetchRoles ERROR serverId=", serverId, e);
      throw e;
    }
  },

  createRole: async (serverId, name, colorHex, permissions, isAdmin, showTag, hoist, tagStyle, separateMembers, badgeImageUrl) => {
    const role = await api.createRole(serverId, name, colorHex, permissions, isAdmin, showTag, hoist, tagStyle, separateMembers, badgeImageUrl);
    set((s) => {
      const existing = s.roles[serverId] ?? [];
      const updated = [...existing, role].sort((a, b) => b.position - a.position);
      return { roles: { ...s.roles, [serverId]: updated } };
    });
    return role;
  },

  updateRole: async (serverId, roleId, opts) => {
    await api.updateRole(serverId, roleId, opts.name, opts.colorHex, opts.permissions, opts.isAdmin, opts.showTag, opts.hoist, opts.tagStyle, opts.separateMembers, opts.badgeImageUrl);
    set((s) => ({
      roles: {
        ...s.roles,
        [serverId]: (s.roles[serverId] ?? []).map((r) =>
          r.id === roleId
            ? {
                ...r,
                ...(opts.name !== undefined && { name: opts.name }),
                ...(opts.colorHex !== undefined && { color_hex: opts.colorHex }),
                ...(opts.permissions !== undefined && { permissions: opts.permissions }),
                ...(opts.isAdmin !== undefined && { is_admin: opts.isAdmin }),
                ...(opts.showTag !== undefined && { show_tag: opts.showTag }),
                ...(opts.hoist !== undefined && { hoist: opts.hoist }),
                ...(opts.tagStyle !== undefined && { tag_style: opts.tagStyle }),
                ...(opts.separateMembers !== undefined && { separate_members: opts.separateMembers }),
                ...(opts.badgeImageUrl !== undefined && { badge_image_url: opts.badgeImageUrl }),
              }
            : r
        ),
      },
    }));
  },

  deleteRole: async (serverId, roleId) => {
    await api.deleteRole(serverId, roleId);
    set((s) => ({
      roles: {
        ...s.roles,
        [serverId]: (s.roles[serverId] ?? []).filter((r) => r.id !== roleId),
      },
    }));
  },

  reorderRoles: async (serverId, roleIds) => {
    await api.reorderRoles(serverId, roleIds);
    // Re-fetch to get correct positions
    await get().fetchRoles(serverId);
  },

  // ── Role assignment ─────────────────────────────────────────────
  assignRole: async (serverId, userId, roleId) => {
    await api.assignRole(serverId, userId, roleId);
    // Re-fetch members to update role info
    await get().fetchMembers(serverId);
  },

  removeRole: async (serverId, userId, roleId) => {
    await api.removeRole(serverId, userId, roleId);
    await get().fetchMembers(serverId);
  },

  // ── Members ─────────────────────────────────────────────────────
  fetchMembers: async (serverId) => {
    console.log("[serverStore] fetchMembers →", { serverId });
    try {
      const members = await api.getServerMembers(serverId);
      console.log("[serverStore] fetchMembers ✓", members?.length, "members:", members?.map(m => m.username));
      set((s) => ({ members: { ...s.members, [serverId]: members } }));
    } catch (e) {
      console.error("[serverStore] fetchMembers ERROR serverId=", serverId, e);
      throw e;
    }
  },

  addMember: async (serverId, userId) => {
    await api.addServerMember(serverId, userId);
    await get().fetchMembers(serverId);
  },

  removeMember: async (serverId, userId) => {
    await api.removeServerMember(serverId, userId);
    set((s) => ({
      members: {
        ...s.members,
        [serverId]: (s.members[serverId] ?? []).filter((m) => m.user_id !== userId),
      },
    }));
  },

  // ── Channel overrides ──────────────────────────────────────────
  fetchOverrides: async (serverId, channelId) => {
    console.log("[serverStore] fetchOverrides →", { serverId, channelId });
    try {
      const ov = await api.getChannelOverrides(serverId, channelId);
      console.log("[serverStore] fetchOverrides ✓", ov?.length, "overrides");
      set((s) => ({ overrides: { ...s.overrides, [channelId]: ov } }));
    } catch (e) {
      console.error("[serverStore] fetchOverrides ERROR", { serverId, channelId }, e);
      throw e;
    }
  },

  setOverride: async (serverId, channelId, roleId, allow, deny) => {
    await api.setChannelOverride(serverId, channelId, roleId, allow, deny);
    await get().fetchOverrides(serverId, channelId);
  },

  deleteOverride: async (serverId, channelId, roleId) => {
    await api.deleteChannelOverride(serverId, channelId, roleId);
    set((s) => ({
      overrides: {
        ...s.overrides,
        [channelId]: (s.overrides[channelId] ?? []).filter((o) => o.role_id !== roleId),
      },
    }));
  },

  // ── Audit log ──────────────────────────────────────────────────
  fetchAuditLog: async (serverId, opts) => {
    console.log("[serverStore] fetchAuditLog →", { serverId, ...opts });
    try {
      const entries = await api.getAuditLog(
        serverId,
        opts?.limit,
        opts?.before,
        opts?.actorId,
        opts?.action,
        opts?.targetType,
      );
      console.log("[serverStore] fetchAuditLog ✓", entries?.length, "entries");
      set((s) => ({
        auditLog: {
          ...s.auditLog,
          [serverId]: opts?.append
            ? [...(s.auditLog[serverId] ?? []), ...entries]
            : entries,
        },
      }));
      return entries.length;
    } catch (e) {
      console.error("[serverStore] fetchAuditLog ERROR serverId=", serverId, e);
      throw e;
    }
  },

  // ── Invites ────────────────────────────────────────────────────
  fetchInvites: async (serverId) => {
    try {
      const invites = await api.getInvites(serverId);
      set((s) => ({ invites: { ...s.invites, [serverId]: invites } }));
    } catch (e) {
      console.error("[serverStore] fetchInvites ERROR", e);
      throw e;
    }
  },

  createInvite: async (serverId, expiresIn, maxUses) => {
    const invite = await api.createInvite(serverId, expiresIn, maxUses);
    set((s) => ({
      invites: {
        ...s.invites,
        [serverId]: [...(s.invites[serverId] ?? []), invite],
      },
    }));
    return invite;
  },

  revokeInvite: async (serverId, inviteId) => {
    await api.revokeInvite(serverId, inviteId);
    set((s) => ({
      invites: {
        ...s.invites,
        [serverId]: (s.invites[serverId] ?? []).filter((inv) => inv.id !== inviteId),
      },
    }));
  },

  // ── AutoMod ────────────────────────────────────────────────────
  fetchAutoModRules: async (serverId) => {
    try {
      const rules = await api.getAutoModRules(serverId);
      set((s) => ({ automodRules: { ...s.automodRules, [serverId]: rules } }));
    } catch (e) {
      console.error("[serverStore] fetchAutoModRules ERROR", e);
      throw e;
    }
  },

  createAutoModRule: async (serverId, name, ruleType, action, config, exemptRoles, exemptChannels) => {
    const rule = await api.createAutoModRule(serverId, name, ruleType, action, config, exemptRoles, exemptChannels);
    set((s) => ({
      automodRules: {
        ...s.automodRules,
        [serverId]: [...(s.automodRules[serverId] ?? []), rule],
      },
    }));
    return rule;
  },

  updateAutoModRule: async (serverId, ruleId, opts) => {
    const updated = await api.updateAutoModRule(serverId, ruleId, opts);
    set((s) => ({
      automodRules: {
        ...s.automodRules,
        [serverId]: (s.automodRules[serverId] ?? []).map((r) =>
          r.id === ruleId ? updated : r
        ),
      },
    }));
  },

  deleteAutoModRule: async (serverId, ruleId) => {
    await api.deleteAutoModRule(serverId, ruleId);
    set((s) => ({
      automodRules: {
        ...s.automodRules,
        [serverId]: (s.automodRules[serverId] ?? []).filter((r) => r.id !== ruleId),
      },
    }));
  },

  fetchAutoModEvents: async (serverId, limit) => {
    try {
      const events = await api.getAutoModEvents(serverId, limit);
      set((s) => ({ automodEvents: { ...s.automodEvents, [serverId]: events } }));
    } catch (e) {
      console.error("[serverStore] fetchAutoModEvents ERROR", e);
      throw e;
    }
  },

  // ── SSE ────────────────────────────────────────────────────────
  connectSSE: (serverId, apiBaseUrl, token) => {
    // Close any existing connection
    if (_sseSource) {
      _sseSource.close();
      _sseSource = null;
    }

    const url = `${apiBaseUrl}/servers/${serverId}/events`;
    // Using fetch-based EventSource with auth header via custom approach
    // Native EventSource doesn't support custom headers, so we use a simple
    // fetch + ReadableStream approach instead
    const ctrl = new AbortController();
    (async () => {
      try {
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (!resp.ok || !resp.body) return;

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE protocol
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let currentEvent = '';
          let currentData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              currentData = line.slice(6);
            } else if (line === '' && currentEvent && currentData) {
              // Process the event
              try {
                const data = JSON.parse(currentData);
                const state = get();

                switch (currentEvent) {
                  case 'role.created':
                  case 'role.updated':
                    // Re-fetch roles to stay in sync
                    state.fetchRoles(serverId);
                    break;
                  case 'role.deleted':
                    set((s) => ({
                      roles: {
                        ...s.roles,
                        [serverId]: (s.roles[serverId] ?? []).filter((r) => r.id !== data.id),
                      },
                    }));
                    break;
                  case 'role.reordered':
                    state.fetchRoles(serverId);
                    break;
                  case 'member.roles.updated':
                    state.fetchMembers(serverId);
                    break;
                  case 'override.updated':
                  case 'override.deleted':
                    if (data.channel_id) {
                      state.fetchOverrides(serverId, data.channel_id);
                    }
                    break;
                }
              } catch { /* ignore parse errors */ }
              currentEvent = '';
              currentData = '';
            }
          }
        }
      } catch { /* connection closed or aborted */ }
    })();

    // Store the abort controller so we can disconnect
    _sseSource = { close: () => ctrl.abort() } as unknown as EventSource;
  },

  disconnectSSE: () => {
    if (_sseSource) {
      _sseSource.close();
      _sseSource = null;
    }
  },

  // ── Reset ──────────────────────────────────────────────────────
  reset: () => {
    console.log("[serverStore] reset called");
    if (_sseSource) {
      _sseSource.close();
      _sseSource = null;
    }
    set(initialState);
  },
}));
