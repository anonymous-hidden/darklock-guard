/**
 * ChannelSidebar — Second column. Shows DM list (home) or channel list (server).
 * Includes search, friend requests, add contact, user panel at bottom.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
  Users,
  UserCheck,
  ChevronDown,
  User,
  BellOff,
  Bell,
  Ban,
  StickyNote,
  XCircle,
  ShieldCheck,
} from "lucide-react";
import clsx from "clsx";
import NowPlaying from "@/components/NowPlaying";
import VoiceStatusBar from "@/components/VoiceStatusBar";

import {
  getContacts,
  syncContacts,
  getGroups,
  startSession,
  getPendingRequests,
  respondFriendRequest,
  cancelFriendRequest,
} from "@/lib/tauri";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useServerStore } from "@/store/serverStore";
import { useSettingsStore } from "@/store/settingsStore";
import { Permissions as PermissionBits } from "@/types";
import type { ContactDto, FriendRequestDto } from "@/types";
import AddContactDialog from "@/components/AddContactDialog";
import CreateServerDialog from "@/components/CreateServerDialog";
import FriendRequestsSection from "@/components/FriendRequestsSection";
import ContextMenu, { type ContextMenuEntry } from "@/components/ContextMenu";
import ContactProfileModal from "@/components/ContactProfileModal";
import PresenceIndicator from "@/components/PresenceIndicator";
import { usePresenceStore } from "@/store/presenceStore";
import { useVoiceStore } from "@/store/voiceStore";
import RoleTag from "@/components/RoleTag";
import ChannelTree from "@/components/ChannelTree";
import Avatar from "@/components/Avatar";

type FriendsTab = "online" | "all" | "pending" | "blocked";

export default function ChannelSidebar() {
  const navigate = useNavigate();
  const { sidebarView, activeServerId, openServerSettings } = useLayoutStore();
  const {
    contacts,
    groups,
    activeContactId,
    setContacts,
    setGroups,
    setActiveSession,
  } = useChatStore();
  const servers = useServerStore((s) => s.servers);
  const channels = useServerStore((s) => activeServerId ? (s.channels[activeServerId] ?? []) : []);
  const activeChannelId = useServerStore((s) => s.activeChannelId);
  const setActiveChannel = useServerStore((s) => s.setActiveChannel);
  const fetchChannels = useServerStore((s) => s.fetchChannels);
  const reorderChannels = useServerStore((s) => s.reorderChannels);
  const fetchServerUnread = useServerStore((s) => s.fetchServerUnread);
  const unreadByChannel = useServerStore((s) => activeServerId ? (s.unreadByServer[activeServerId]?.channels ?? {}) : {});
  const roles = useServerStore((s) => activeServerId ? (s.roles[activeServerId] ?? []) : []);
  const members = useServerStore((s) => activeServerId ? (s.members[activeServerId] ?? []) : []);
  const fetchMembers = useServerStore((s) => s.fetchMembers);
  const { username, systemRole, userId } = useAuthStore();
  const openSettings = useSettingsStore((s) => s.openSettings);
  const onlineStatus = useSettingsStore((s) => s.onlineStatus);

  // Voice
  const voiceConnection = useVoiceStore((s) => s.connection);
  const voiceChannelMembers = useVoiceStore((s) => s.channelMembers);
  const joinVoice = useVoiceStore((s) => s.joinChannel);
  const leaveVoice = useVoiceStore((s) => s.leaveChannel);
  const fetchServerVoiceState = useVoiceStore((s) => s.fetchServerVoiceState);

  const [search, setSearch] = useState("");
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [createServerOpen, setCreateServerOpen] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<FriendRequestDto[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [friendsTab] = useState<FriendsTab>("all");
  const [serverDropdown, setServerDropdown] = useState(false);

  // Context menu + profile modal
  type CtxState = { contact: ContactDto; x: number; y: number };
  const [ctxMenu, setCtxMenu] = useState<CtxState | null>(null);
  const [profileContact, setProfileContact] = useState<ContactDto | null>(null);

  // Local preferences
  const [mutedSet, setMutedSet] = useState<Set<string>>(
    () => new Set<string>(JSON.parse(localStorage.getItem("dl_muted") ?? "[]"))
  );
  const [blockedSet, setBlockedSet] = useState<Set<string>>(
    () => new Set<string>(JSON.parse(localStorage.getItem("dl_blocked") ?? "[]"))
  );
  const [closedDMs, setClosedDMs] = useState<Set<string>>(
    () => new Set<string>(JSON.parse(localStorage.getItem("dl_closed_dms") ?? "[]"))
  );
  const [notes, setNotes] = useState<Record<string, string>>(
    () => JSON.parse(localStorage.getItem("dl_notes") ?? "{}") as Record<string, string>
  );

  // Load contacts on mount
  useEffect(() => {
    syncContacts()
      .catch(console.error)
      .finally(() => getContacts().then(setContacts).catch(console.error));
    console.log("[ChannelSidebar] loading groups from Tauri...");
    getGroups()
      .then((g) => { console.log("[ChannelSidebar] getGroups ✓", g?.length, "groups:", g?.map((gr) => `${gr.id.slice(0,8)} ${gr.name}`)); setGroups(g); })
      .catch((e) => { console.error("[ChannelSidebar] getGroups ✗", e); });
    getPendingRequests().then(setPendingRequests).catch(console.error);
  }, []);

  // Poll friend requests
  useEffect(() => {
    const iv = setInterval(() => {
      getPendingRequests().then(setPendingRequests).catch(console.error);
    }, 30_000);
    return () => clearInterval(iv);
  }, []);

  // Fetch channels when active server changes — only if that server is known to exist
  useEffect(() => {
    if (activeServerId && sidebarView === "server" && servers.some((s) => s.id === activeServerId)) {
      fetchChannels(activeServerId).catch(console.error);
      fetchServerVoiceState(activeServerId).catch(console.error);
      fetchServerUnread(activeServerId).catch(console.error);
      fetchMembers(activeServerId).catch(console.error);
    }
  }, [activeServerId, sidebarView, fetchChannels, fetchServerVoiceState, fetchServerUnread, fetchMembers, servers]);

  // Poll voice state every 5s when in a server view
  useEffect(() => {
    if (!activeServerId || sidebarView !== "server") return;
    const iv = setInterval(() => {
      fetchServerVoiceState(activeServerId).catch(console.error);
    }, 5000);
    return () => clearInterval(iv);
  }, [activeServerId, sidebarView, fetchServerVoiceState]);

  const handleSelectContact = async (contact: ContactDto) => {
    if (contact.key_change_pending) return;
    if (closedDMs.has(contact.contact_user_id)) {
      setClosedDMs((prev) => {
        const next = new Set(prev);
        next.delete(contact.contact_user_id);
        localStorage.setItem("dl_closed_dms", JSON.stringify([...next]));
        return next;
      });
    }
    setSessionError(null);
    try {
      const sessionId = await startSession(contact.contact_user_id);
      setActiveSession(sessionId, contact.contact_user_id);
      navigate(`/chat/${sessionId}`);
    } catch (err) {
      console.error("Failed to start session:", String(err));
      setSessionError(String(err));
      setTimeout(() => setSessionError(null), 5000);
    }
  };

  const handleAcceptRequest = async (req: FriendRequestDto) => {
    await respondFriendRequest(req.request_id, true);
    setPendingRequests((prev) => prev.filter((r) => r.request_id !== req.request_id));
    getContacts().then(setContacts).catch(console.error);
  };
  const handleDenyRequest = async (req: FriendRequestDto) => {
    await respondFriendRequest(req.request_id, false);
    setPendingRequests((prev) => prev.filter((r) => r.request_id !== req.request_id));
  };
  const handleCancelRequest = async (req: FriendRequestDto) => {
    await cancelFriendRequest(req.request_id);
    setPendingRequests((prev) => prev.filter((r) => r.request_id !== req.request_id));
  };

  // Context menu helpers
  const handleMuteToggle = (id: string) => {
    setMutedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("dl_muted", JSON.stringify([...next]));
      return next;
    });
  };
  const handleBlockToggle = (id: string) => {
    setBlockedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("dl_blocked", JSON.stringify([...next]));
      return next;
    });
  };
  const handleSaveNote = (contactId: string, note: string) => {
    setNotes((prev) => {
      const next = { ...prev, [contactId]: note };
      localStorage.setItem("dl_notes", JSON.stringify(next));
      return next;
    });
  };
  const handleCloseDM = (contact: ContactDto) => {
    setClosedDMs((prev) => {
      const next = new Set(prev);
      next.add(contact.contact_user_id);
      localStorage.setItem("dl_closed_dms", JSON.stringify([...next]));
      return next;
    });
    if (activeContactId === contact.contact_user_id) navigate("/");
  };

  const buildCtxItems = (contact: ContactDto): ContextMenuEntry[] => {
    const id = contact.contact_user_id;
    const isMuted = mutedSet.has(id);
    const isBlocked = blockedSet.has(id);
    const hasNote = !!(notes[id]?.trim());
    return [
      { label: "View Profile", icon: <User size={13} />, onClick: () => setProfileContact(contact) },
      { label: hasNote ? "Edit Note" : "Add Note", icon: <StickyNote size={13} />, onClick: () => setProfileContact(contact) },
      { label: "Verify Identity", icon: <ShieldCheck size={13} />, onClick: () => navigate(`/verify/${id}`), disabled: !!contact.verified_fingerprint && !contact.key_change_pending },
      { separator: true },
      { label: isMuted ? "Unmute" : "Mute", icon: isMuted ? <Bell size={13} /> : <BellOff size={13} />, onClick: () => handleMuteToggle(id), checked: isMuted },
      { separator: true },
      { label: "Close DM", icon: <XCircle size={13} />, onClick: () => handleCloseDM(contact) },
      { label: isBlocked ? "Unblock" : "Block", icon: <Ban size={13} />, onClick: () => handleBlockToggle(id), danger: !isBlocked, checked: isBlocked },
    ];
  };

  const filteredContacts = contacts.filter((c) => {
    const name = (c.display_name ?? c.contact_user_id).toLowerCase();
    const matchesSearch = name.includes(search.toLowerCase());
    const notClosed = search.trim() ? true : !closedDMs.has(c.contact_user_id);
    const notBlocked = friendsTab === "blocked" ? blockedSet.has(c.contact_user_id) : !blockedSet.has(c.contact_user_id);
    return matchesSearch && notClosed && notBlocked;
  });

  const activeGroup = groups.find((g) => g.id === activeServerId);
  const activeServer = servers.find((s) => s.id === activeServerId);
  const serverName = activeServer?.name ?? activeGroup?.name ?? "Server";

  // Listen for create-server action from ServerSidebar + button
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const btn = target.closest("[data-action='create-group']");
      if (btn) setCreateServerOpen(true);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return (
    <div className="channel-sidebar">
      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildCtxItems(ctxMenu.contact)}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {/* Profile modal */}
      {profileContact && (
        <ContactProfileModal
          contact={profileContact}
          note={notes[profileContact.contact_user_id] ?? ""}
          onClose={() => setProfileContact(null)}
          onNoteSave={(n) => handleSaveNote(profileContact.contact_user_id, n)}
        />
      )}

      {/* Dialogs */}
      {addContactOpen && (
        <AddContactDialog
          onClose={() => setAddContactOpen(false)}
          onAdded={() => {
            getPendingRequests().then(setPendingRequests).catch(console.error);
            setAddContactOpen(false);
          }}
          onOpenDM={(userId) => {
            setClosedDMs((prev) => {
              const next = new Set(prev);
              next.delete(userId);
              localStorage.setItem("dl_closed_dms", JSON.stringify([...next]));
              return next;
            });
            const c = contacts.find((ct) => ct.contact_user_id === userId);
            if (c) handleSelectContact(c);
          }}
        />
      )}
      {createServerOpen && (
        <CreateServerDialog
          onClose={() => setCreateServerOpen(false)}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="channel-sidebar__header">
        {sidebarView === "home" ? (
          <div className="flex items-center justify-between w-full">
            <span className="font-semibold text-sm text-dl-text">Direct Messages</span>
            <button
              onClick={() => setAddContactOpen(true)}
              className="channel-sidebar__header-action"
              title="New DM"
            >
              <Plus size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full relative">
            <button
              onClick={() => setServerDropdown(!serverDropdown)}
              className="flex items-center gap-1 w-full text-left"
            >
              <span className="font-semibold text-sm text-dl-text truncate">
                {serverName}
              </span>
              <ChevronDown size={16} className="text-dl-muted shrink-0" />
            </button>
            {/* Server dropdown menu */}
            {serverDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setServerDropdown(false)} />
                <div className="absolute left-0 top-full mt-1 z-20 w-52 bg-[#1a1d27] border border-white/[0.06] rounded-lg shadow-xl py-1">
                  <button
                    onClick={() => { openServerSettings("overview"); setServerDropdown(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white/90"
                  >
                    Server Settings
                  </button>
                  <button
                    onClick={() => { openServerSettings("roles"); setServerDropdown(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white/90"
                  >
                    Manage Roles
                  </button>
                  <button
                    onClick={() => { openServerSettings("channels"); setServerDropdown(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white/90"
                  >
                    Manage Channels
                  </button>
                  <button
                    onClick={() => { openServerSettings("members"); setServerDropdown(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white/90"
                  >
                    Members
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Search ────────────────────────────────────────────────── */}
      <div className="channel-sidebar__search">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-dl-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find or start a conversation"
            className="channel-sidebar__search-input"
          />
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────── */}
      {sidebarView === "home" ? (
        <>
          {/* Friends tabs */}
          <div className="channel-sidebar__tabs">
            <button
              onClick={() => navigate("/")}
              className={clsx("channel-sidebar__tab", !friendsTab && "channel-sidebar__tab--active")}
            >
              <Users size={16} />
              <span>Friends</span>
              {pendingRequests.filter((r) => r.direction === "incoming").length > 0 && (
                <span className="channel-sidebar__badge">
                  {pendingRequests.filter((r) => r.direction === "incoming").length}
                </span>
              )}
            </button>
          </div>

          {/* Session error */}
          {sessionError && (
            <div className="channel-sidebar__error">
              {sessionError}
            </div>
          )}

          {/* DM list */}
          <div className="channel-sidebar__list">
            {/* Friend requests inline */}
            {pendingRequests.length > 0 && (
              <FriendRequestsSection
                requests={pendingRequests}
                onAccept={handleAcceptRequest}
                onDeny={handleDenyRequest}
                onCancel={handleCancelRequest}
              />
            )}

            {filteredContacts.map((contact) => (
              <DMContactItem
                key={contact.id}
                contact={contact}
                isActive={activeContactId === contact.contact_user_id}
                isMuted={mutedSet.has(contact.contact_user_id)}
                isBlocked={blockedSet.has(contact.contact_user_id)}
                onClick={() => !blockedSet.has(contact.contact_user_id) && handleSelectContact(contact)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ contact, x: e.clientX, y: e.clientY });
                }}
              />
            ))}

            {filteredContacts.length === 0 && !search && (
              <div className="channel-sidebar__empty">
                No conversations yet
              </div>
            )}
            {filteredContacts.length === 0 && search && (
              <div className="channel-sidebar__empty">
                No results found
              </div>
            )}
          </div>
        </>
      ) : (
        /* Server channel list — real channels from IDS */
        <div className="channel-sidebar__list">
          <ChannelTree
            channels={channels}
            activeChannelId={activeChannelId}
            unreadByChannel={unreadByChannel}
            voiceMembersByChannel={voiceChannelMembers}
            connectedVoiceChannelId={voiceConnection?.channelId ?? null}
            canManageChannels={Boolean(
              members.find((m) => m.user_id === userId)?.is_owner ||
              members.find((m) => m.user_id === userId)?.roles.some((mr) => {
                const role = roles.find((r) => r.id === mr.id);
                return !!role && (role.is_admin || (Number(role.permissions) & PermissionBits.MANAGE_CHANNELS) === PermissionBits.MANAGE_CHANNELS);
              })
            )}
            onSelectChannel={(ch) => {
              if (!activeServerId) return;
              setActiveChannel(ch.id);
              navigate(`/server/${activeServerId}/channel/${ch.id}`);
            }}
            onJoinVoice={(ch) => {
              if (!activeServerId) return;
              setActiveChannel(ch.id);
              navigate(`/server/${activeServerId}/channel/${ch.id}`);
              if (voiceConnection?.channelId !== ch.id) {
                joinVoice(activeServerId, ch.id).catch(console.error);
              }
            }}
            onReorder={async (layout) => {
              if (!activeServerId) return;
              await reorderChannels(activeServerId, layout);
            }}
          />
        </div>
      )}

      {/* ── Voice Status Bar ──────────────────────────────── */}
      {(() => {
        if (!voiceConnection) return null;
        const ch = channels.find((c) => c.id === voiceConnection.channelId);
        const server = servers.find((s: any) => s.id === voiceConnection.serverId);
        return (
          <VoiceStatusBar
            channelName={ch?.name ?? "Voice"}
            serverName={server?.name ?? "Server"}
            onDisconnect={() => leaveVoice().catch(console.error)}
          />
        );
      })()}

      {/* ── Now Playing widget (Spotify) ─────────────────────── */}
      <NowPlaying />

      {/* ── User Panel (bottom) ──────────────────────────────────── */}
      <div className="channel-sidebar__user-panel">
        <div
          className="channel-sidebar__user-info"
          onClick={() => openSettings("profile")}
        >
          {/* Avatar with profile color background */}
          <div className="relative shrink-0">
            <Avatar
              userId={userId ?? ""}
              fallbackName={username ?? "U"}
              size={32}
              className="channel-sidebar__avatar"
            />
            {/* Status dot */}
            <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-dl-bg flex items-center justify-center">
              <div className={[
                "w-2.5 h-2.5 rounded-full",
                onlineStatus === "online" ? "bg-green-500" :
                onlineStatus === "idle" ? "bg-amber-500" :
                onlineStatus === "dnd" ? "bg-red-500" :
                "bg-gray-500",
              ].join(" ")} />
            </div>
          </div>
          <div className="channel-sidebar__user-text">
            <div className="channel-sidebar__username">{username ?? "User"}</div>
            <RoleTag role={systemRole} className="channel-sidebar__user-role" />
            <div className="channel-sidebar__status">
              {onlineStatus === "online" ? "Online" :
               onlineStatus === "idle" ? "Idle" :
               onlineStatus === "dnd" ? "Do Not Disturb" :
               "Invisible"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── DM Contact Item ──────────────────────────────────────────────────────── */

function DMContactItem({
  contact,
  isActive,
  isMuted,
  isBlocked,
  onClick,
  onContextMenu,
}: {
  contact: ContactDto;
  isActive: boolean;
  isMuted: boolean;
  isBlocked: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const displayName = contact.display_name ?? contact.contact_user_id;
  const getStatus = usePresenceStore((s) => s.getStatus);

  // Get last message preview from the messages store
  const messages = useChatStore((s) => s.messages);
  // Find the session for this contact (best-effort from stored messages)
  const sessionMessages = Object.entries(messages).find(
    ([, msgs]) => msgs.some((m) => m.sender_id === contact.contact_user_id || m.recipient_id === contact.contact_user_id)
  );
  const lastMessage = sessionMessages?.[1]?.[sessionMessages[1].length - 1];
  const lastMsgPreview = lastMessage
    ? lastMessage.content.type === "text"
      ? lastMessage.content.body.slice(0, 40) + (lastMessage.content.body.length > 40 ? "…" : "")
      : lastMessage.content.type === "attachment"
        ? `📎 ${(lastMessage.content as { filename: string }).filename}`
        : ""
    : "";
  const lastMsgTime = lastMessage?.sent_at
    ? formatRelativeTime(lastMessage.sent_at)
    : "";

  // Count unread (messages from contact after last outgoing)
  const unreadCount = (() => {
    if (!sessionMessages) return 0;
    const msgs = sessionMessages[1];
    const lastOutIdx = (() => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].is_outgoing) return i;
      }
      return -1;
    })();
    if (lastOutIdx === -1) return msgs.filter((m) => !m.is_outgoing).length;
    return msgs.slice(lastOutIdx + 1).filter((m) => !m.is_outgoing).length;
  })();

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={clsx(
        "channel-sidebar__dm-item",
        isActive && "channel-sidebar__dm-item--active",
        contact.key_change_pending && "channel-sidebar__dm-item--warning",
        isBlocked && "channel-sidebar__dm-item--blocked"
      )}
    >
      <div className="channel-sidebar__dm-avatar">
        <Avatar userId={contact.contact_user_id} fallbackName={displayName} size={32} />
        {/* Presence indicator */}
        <PresenceIndicator status={getStatus(contact.contact_user_id)} size="sm" className="absolute -bottom-0.5 -right-0.5" />
        {/* Status indicators */}
        {isBlocked ? (
          <div className="channel-sidebar__dm-badge channel-sidebar__dm-badge--danger">
            <Ban size={8} />
          </div>
        ) : isMuted ? (
          <div className="channel-sidebar__dm-badge channel-sidebar__dm-badge--muted">
            <BellOff size={8} />
          </div>
        ) : contact.verified_fingerprint ? (
          <div className="channel-sidebar__dm-badge channel-sidebar__dm-badge--verified">
            <UserCheck size={8} />
          </div>
        ) : null}
        {/* Role badge — shown for any non-default role */}
        {contact.system_role && contact.system_role !== 'user' && (
          <RoleTag role={contact.system_role} variant="badge" />
        )}
      </div>
      <div className="channel-sidebar__dm-info">
        <div className="flex items-center justify-between gap-1">
          <span className="channel-sidebar__dm-name">{displayName}</span>
          {lastMsgTime && (
            <span className="text-[10px] text-white/20 shrink-0">{lastMsgTime}</span>
          )}
        </div>
        {contact.key_change_pending ? (
          <span className="channel-sidebar__dm-warning">⚠ Key changed</span>
        ) : lastMsgPreview ? (
          <span className="channel-sidebar__dm-preview">{lastMsgPreview}</span>
        ) : null}
      </div>
      {/* Unread badge */}
      {unreadCount > 0 && !isMuted && (
        <span className="channel-sidebar__dm-unread">{unreadCount > 99 ? "99+" : unreadCount}</span>
      )}
      {/* Close button on hover */}
      <XCircle
        size={14}
        className="channel-sidebar__dm-close"
        onClick={(e) => {
          e.stopPropagation();
          // trigger close via context menu handler
        }}
      />
    </button>
  );
}

/** Format a timestamp as relative time (e.g., "2m", "1h", "Yesterday") */
function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "now";
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
