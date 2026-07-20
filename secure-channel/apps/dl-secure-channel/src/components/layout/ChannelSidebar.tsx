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
  Hash,
  Volume2,
  Megaphone,
  BookOpen,
  Radio,
  MessageCircle,
  Lock,
  Eye,
  MicOff,
  EarOff,
  GripVertical,
  ChevronRight,
  FolderOpen,
} from "lucide-react";
import clsx from "clsx";
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
  const { username, systemRole } = useAuthStore();
  const openSettings = useSettingsStore((s) => s.openSettings);
  const avatarDataUrl = useSettingsStore((s) => s.avatarDataUrl);
  const onlineStatus = useSettingsStore((s) => s.onlineStatus);
  const profileColor = useSettingsStore((s) => s.profileColor);

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

  // Channel drag-to-reorder state
  const [chDragFromIdx, setChDragFromIdx] = useState<number | null>(null);
  const [chDragOverIdx, setChDragOverIdx] = useState<number | null>(null);
  const [chDragGroup, setChDragGroup] = useState<string | null>(null);

  const handleChDragStart = (e: React.DragEvent, group: string, idx: number, channelId: string) => {
    e.dataTransfer.setData('text/plain', channelId);
    e.dataTransfer.effectAllowed = 'move';
    setChDragGroup(group);
    setChDragFromIdx(idx);
    setChDragOverIdx(idx);
  };
  const handleChDragOver = (e: React.DragEvent, group: string, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (chDragGroup !== group || chDragFromIdx === null) return;
    setChDragOverIdx(idx);
  };
  // targetIdx passed directly — avoids stale-state async closure bug
  const handleChDrop = async (e: React.DragEvent, items: typeof channels, _group: string, targetIdx: number) => {
    e.preventDefault();
    const channelId = e.dataTransfer.getData('text/plain');
    const fromIdx = items.findIndex((c) => c.id === channelId);
    if (fromIdx === -1 || fromIdx === targetIdx) {
      setChDragFromIdx(null); setChDragOverIdx(null); setChDragGroup(null);
      return;
    }
    const reordered = [...items];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    setChDragFromIdx(null); setChDragOverIdx(null); setChDragGroup(null);
    if (activeServerId) {
      await reorderChannels(activeServerId, reordered.map((c) => c.id));
    }
  };
  const handleChDragEnd = () => {
    setChDragFromIdx(null); setChDragOverIdx(null); setChDragGroup(null);
  };

  const [collapsedSidebarCategories, setCollapsedSidebarCategories] = useState<Set<string>>(new Set());

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
      .catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]'))
      .finally(() => getContacts().then(setContacts).catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]')));
    console.log('[GROUP_LIST_FETCH_STARTED]');
    getGroups()
      .then((g) => { console.log('[GROUP_LIST_FETCH_COMPLETED]'); setGroups(g); })
      .catch(() => { console.error('[GROUP_LIST_FETCH_FAILED]'); });
    getPendingRequests().then(setPendingRequests).catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]'));
  }, []);

  // Poll friend requests
  useEffect(() => {
    const iv = setInterval(() => {
      getPendingRequests().then(setPendingRequests).catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]'));
    }, 30_000);
    return () => clearInterval(iv);
  }, []);

  // Fetch channels when active server changes — only if that server is known to exist
  useEffect(() => {
    if (activeServerId && sidebarView === "server" && servers.some((s) => s.id === activeServerId)) {
      fetchChannels(activeServerId).catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]'));
      fetchServerVoiceState(activeServerId).catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]'));
    }
  }, [activeServerId, sidebarView, fetchChannels, fetchServerVoiceState, servers]);

  // Poll voice state every 5s when in a server view
  useEffect(() => {
    if (!activeServerId || sidebarView !== "server") return;
    const iv = setInterval(() => {
      fetchServerVoiceState(activeServerId).catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]'));
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
      console.error('[DM_SESSION_START_FAILED]');
      setSessionError(String(err));
      setTimeout(() => setSessionError(null), 5000);
    }
  };

  const handleAcceptRequest = async (req: FriendRequestDto) => {
    await respondFriendRequest(req.request_id, true);
    setPendingRequests((prev) => prev.filter((r) => r.request_id !== req.request_id));
    getContacts().then(setContacts).catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]'));
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
            getPendingRequests().then(setPendingRequests).catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]'));
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
          {(() => {
            const categoryChs = channels.filter((c) => c.type === "category").sort((a, b) => a.position - b.position);
            const nonCatChs = channels.filter((c) => c.type !== "category");
            const textChannels = nonCatChs.filter((c) => c.type !== "voice" && c.type !== "stage").sort((a, b) => a.position - b.position);
            const voiceChannels = nonCatChs.filter((c) => c.type === "voice" || c.type === "stage").sort((a, b) => a.position - b.position);

            const channelTypeIcon = (type: string | null) => {
              switch (type) {
                case "voice": return <Volume2 size={16} className="text-dl-muted shrink-0" />;
                case "stage": return <Radio size={16} className="text-purple-400/60 shrink-0" />;
                case "announcement": return <Megaphone size={16} className="text-dl-muted shrink-0" />;
                case "rules": return <BookOpen size={16} className="text-dl-muted shrink-0" />;
                case "forum": return <MessageCircle size={16} className="text-green-400/50 shrink-0" />;
                case "private_encrypted": return <Lock size={16} className="text-red-400/50 shrink-0" />;
                case "read_only_news": return <Eye size={16} className="text-blue-400/50 shrink-0" />;
                default: return <Hash size={16} className="text-dl-muted shrink-0" />;
              }
            };

            // Reusable text channel row
            const renderTextChItem = (ch: (typeof channels)[0], idx: number, arr: (typeof channels), groupKey: string) => (
              <div
                key={ch.id}
                draggable
                onDragStart={(e) => handleChDragStart(e, groupKey, idx, ch.id)}
                onDragOver={(e) => handleChDragOver(e, groupKey, idx)}
                onDrop={(e) => handleChDrop(e, arr, groupKey, idx)}
                onDragEnd={handleChDragEnd}
                className={clsx(
                  "group/ch relative",
                  chDragGroup === groupKey && chDragFromIdx === idx && "opacity-40",
                  chDragGroup === groupKey && chDragOverIdx === idx && chDragFromIdx !== null && chDragFromIdx !== idx && "ring-1 ring-inset ring-dl-accent/40 rounded-md"
                )}
              >
                <GripVertical size={11} className="absolute left-1 top-1/2 -translate-y-1/2 text-white/20 opacity-0 group-hover/ch:opacity-100 cursor-grab z-10 pointer-events-none" />
                <button
                  onClick={() => { setActiveChannel(ch.id); navigate(`/server/${activeServerId}/channel/${ch.id}`); }}
                  className={clsx("channel-sidebar__channel pl-5", activeChannelId === ch.id && "channel-sidebar__channel--active")}
                >
                  {channelTypeIcon(ch.type)}
                  <span>{ch.name}</span>
                  {ch.type === "private_encrypted" && <Lock size={10} className="text-red-400/40 ml-auto shrink-0" />}
                </button>
              </div>
            );

            // Reusable voice channel row
            const renderVoiceChItem = (ch: (typeof channels)[0], idx: number, arr: (typeof channels), groupKey: string) => {
              const vcMembers = voiceChannelMembers[ch.id] ?? [];
              const isConnectedHere = voiceConnection?.channelId === ch.id;
              return (
                <div
                  key={ch.id}
                  draggable
                  onDragStart={(e) => handleChDragStart(e, groupKey, idx, ch.id)}
                  onDragOver={(e) => handleChDragOver(e, groupKey, idx)}
                  onDrop={(e) => handleChDrop(e, arr, groupKey, idx)}
                  onDragEnd={handleChDragEnd}
                  className={clsx(
                    "group/ch relative",
                    chDragGroup === groupKey && chDragFromIdx === idx && "opacity-40",
                    chDragGroup === groupKey && chDragOverIdx === idx && chDragFromIdx !== null && chDragFromIdx !== idx && "ring-1 ring-inset ring-dl-accent/40 rounded-md"
                  )}
                >
                  <GripVertical size={11} className="absolute left-1 top-3 text-white/20 opacity-0 group-hover/ch:opacity-100 cursor-grab z-10 pointer-events-none" />
                  <button
                    onClick={() => { if (isConnectedHere) return; if (activeServerId) joinVoice(activeServerId, ch.id).catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]')); }}
                    className={clsx("channel-sidebar__channel pl-5", isConnectedHere && "channel-sidebar__channel--active")}
                  >
                    {channelTypeIcon(ch.type)}
                    <span className="flex-1 truncate">{ch.name}</span>
                    {ch.type === "stage" && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400/60 border border-purple-500/15">LIVE</span>}
                    {vcMembers.length > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400/70 border border-green-500/15">{vcMembers.length}</span>}
                  </button>
                  {vcMembers.length > 0 ? (
                    <div className="ml-8 py-1 space-y-0.5">
                      {vcMembers.map((m) => (
                        <div key={m.user_id} className="flex items-center gap-1.5 px-2 py-0.5">
                          <div className="w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center text-[9px] font-medium text-white/50 shrink-0">
                            {(m.nickname ?? m.username).charAt(0).toUpperCase()}
                          </div>
                          <span className="text-[10px] text-white/40 truncate flex-1">{m.nickname ?? m.username}</span>
                          {m.is_muted && <MicOff size={9} className="text-red-400/50 shrink-0" />}
                          {m.is_deafened && <EarOff size={9} className="text-red-400/50 shrink-0" />}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="ml-8 py-1 space-y-0.5">
                      <p className="text-[10px] text-white/15 italic px-2">No one connected</p>
                    </div>
                  )}
                </div>
              );
            };

            // ── Category-based layout (when categories exist) ──
            if (categoryChs.length > 0) {
              const usedIds = new Set<string>();
              const sections = categoryChs.map((cat) => {
                const children = nonCatChs.filter((c) => c.category_id === cat.id).sort((a, b) => a.position - b.position);
                children.forEach((c) => usedIds.add(c.id));
                return { cat, children };
              });
              const uncatTextChs = nonCatChs.filter((c) => !usedIds.has(c.id) && c.type !== "voice" && c.type !== "stage").sort((a, b) => a.position - b.position);
              const uncatVoiceChs = nonCatChs.filter((c) => !usedIds.has(c.id) && (c.type === "voice" || c.type === "stage")).sort((a, b) => a.position - b.position);

              return (
                <>
                  {sections.map(({ cat, children }) => {
                    const isCollapsed = collapsedSidebarCategories.has(cat.id);
                    return (
                      <React.Fragment key={cat.id}>
                        <div
                          className="channel-sidebar__category cursor-pointer select-none"
                          onClick={() => setCollapsedSidebarCategories((prev) => {
                            const s = new Set(prev);
                            s.has(cat.id) ? s.delete(cat.id) : s.add(cat.id);
                            return s;
                          })}
                        >
                          {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                          <FolderOpen size={10} className="text-dl-accent/50" />
                          <span>{cat.name.toUpperCase()}</span>
                        </div>
                        {!isCollapsed && children.map((ch, idx) =>
                          (ch.type === "voice" || ch.type === "stage")
                            ? renderVoiceChItem(ch, idx, children, cat.id)
                            : renderTextChItem(ch, idx, children, cat.id)
                        )}
                        {!isCollapsed && children.length === 0 && (
                          <p className="text-[10px] text-white/15 italic px-3 py-1">Empty category</p>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {uncatTextChs.length > 0 && (
                    <>
                      <div className="channel-sidebar__category mt-2">
                        <ChevronDown size={10} />
                        <span>TEXT CHANNELS</span>
                      </div>
                      {uncatTextChs.map((ch, idx) => renderTextChItem(ch, idx, uncatTextChs, "text"))}
                    </>
                  )}
                  {uncatVoiceChs.length > 0 && (
                    <>
                      <div className="channel-sidebar__category mt-3">
                        <ChevronDown size={10} />
                        <span>VOICE & STAGE</span>
                      </div>
                      {uncatVoiceChs.map((ch, idx) => renderVoiceChItem(ch, idx, uncatVoiceChs, "voice"))}
                    </>
                  )}
                  {channels.length === 0 && <div className="channel-sidebar__empty">No channels yet</div>}
                </>
              );
            }

            // ── Default layout (no categories) — type-based grouping ──
            return (
              <>
                {textChannels.length > 0 && (
                  <>
                    <div className="channel-sidebar__category">
                      <ChevronDown size={10} />
                      <span>TEXT CHANNELS</span>
                    </div>
                    {textChannels.map((ch, idx) => renderTextChItem(ch, idx, textChannels, "text"))}
                  </>
                )}
                {voiceChannels.length > 0 && (
                  <>
                    <div className="channel-sidebar__category mt-3">
                      <ChevronDown size={10} />
                      <span>VOICE & STAGE</span>
                    </div>
                    {voiceChannels.map((ch, idx) => renderVoiceChItem(ch, idx, voiceChannels, "voice"))}
                  </>
                )}
                {channels.length === 0 && (
                  <div className="channel-sidebar__empty">No channels yet</div>
                )}
              </>
            );
          })()}
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
            onDisconnect={() => leaveVoice().catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]'))}
          />
        );
      })()}

      {/* ── User Panel (bottom) ──────────────────────────────────── */}
      <div className="channel-sidebar__user-panel">
        <div
          className="channel-sidebar__user-info"
          onClick={() => openSettings("profile")}
        >
          {/* Avatar with profile color background */}
          <div className="relative shrink-0">
            {avatarDataUrl ? (
              <img src={avatarDataUrl} alt="avatar" className="channel-sidebar__avatar" />
            ) : (
              <div
                className="channel-sidebar__avatar channel-sidebar__avatar--default"
                style={{ background: `linear-gradient(135deg, ${profileColor}88, ${profileColor}44)`, color: "white" }}
              >
                <span className="text-sm font-semibold">{(username ?? "U").charAt(0).toUpperCase()}</span>
              </div>
            )}
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
        <span>{displayName.charAt(0).toUpperCase()}</span>
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
