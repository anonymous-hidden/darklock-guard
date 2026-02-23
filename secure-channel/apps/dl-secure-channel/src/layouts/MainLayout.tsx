/**
 * MainLayout — Left sidebar (contacts + groups + profile) + right content area.
 * Sidebar is resizable by dragging the right edge (200 – 420 px).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import {
  Search,
  Users,
  MessageSquare,
  Plus,
  UserCheck,
  ChevronDown,
  ShieldCheck,
  User,
  BellOff,
  Bell,
  Ban,
  StickyNote,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import logo from "@/assets/logo.png";

import { getContacts, syncContacts, getGroups, startSession, pollInbox, getPendingRequests, respondFriendRequest, cancelFriendRequest } from "@/lib/tauri";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import type { ContactDto, FriendRequestDto, GroupDto } from "@/types";
import AddContactDialog from "@/components/AddContactDialog";
import CreateGroupDialog from "@/components/CreateGroupDialog";
import FriendRequestsSection from "@/components/FriendRequestsSection";
import SettingsModal from "@/components/settings/SettingsModal";
import { useSettingsStore } from "@/store/settingsStore";
import ContextMenu, { type ContextMenuEntry } from "@/components/ContextMenu";
import ContactProfileModal from "@/components/ContactProfileModal";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 280;

type Tab = "contacts" | "groups";

export default function MainLayout() {
  const navigate = useNavigate();

  const { contacts, groups, activeContactId, setContacts, setGroups, setActiveSession, appendMessages } =
    useChatStore();
  const { username } = useAuthStore();
  const openSettings = useSettingsStore((s) => s.openSettings);
  const avatarDataUrl = useSettingsStore((s) => s.avatarDataUrl);

  const [tab, setTab] = useState<Tab>("contacts");
  const [search, setSearch] = useState("");
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<FriendRequestDto[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // ── Context menu + profile modal ────────────────────────────────────────
  type CtxState = { contact: ContactDto; x: number; y: number };
  const [ctxMenu, setCtxMenu] = useState<CtxState | null>(null);
  const [profileContact, setProfileContact] = useState<ContactDto | null>(null);

  // Persisted local preferences (muted / blocked / notes) via localStorage
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
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const requestPollRef = useRef<ReturnType<typeof setInterval>>();

  // ── Resizable sidebar ───────────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = ev.clientX - resizeStartX.current;
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, resizeStartW.current + delta)));
    };
    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, [sidebarWidth]);

  // Load contacts + groups on mount; sync from IDS first, THEN start the
  // message poll — this prevents a race where the first poll arrives before
  // the contact identity keys are populated (causing silent decryption drop).
  useEffect(() => {
    const doPoll = async () => {
      try {
        const msgs = await pollInbox();
        if (msgs.length > 0) {
          console.log("[secure-channel] pollInbox ✓", { count: msgs.length });
          appendMessages(msgs);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[secure-channel] pollInbox ✗", msg);
      }
    };

    const init = async () => {
      // 1. Sync contacts so identity keys are in DB before first poll
      await syncContacts().catch(console.error);
      await getContacts().then(setContacts).catch(console.error);
      // 2. Now safe to start polling
      await doPoll();
      pollRef.current = setInterval(doPoll, 5000);
    };

    init();
    getGroups().then(setGroups).catch(console.error);
    getPendingRequests().then(setPendingRequests).catch(console.error);

    return () => clearInterval(pollRef.current);
  }, []);

  // Poll for incoming friend requests every 30 s
  useEffect(() => {
    requestPollRef.current = setInterval(() => {
      getPendingRequests().then(setPendingRequests).catch(console.error);
    }, 30_000);
    return () => clearInterval(requestPollRef.current);
  }, []);

  const handleSelectContact = async (contact: ContactDto) => {
    if (contact.key_change_pending) return;
    // Re-open a previously closed DM
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
      const msg = String(err);
      console.error("Failed to start session:", msg);
      setSessionError(msg);
      // Auto-clear after 5 s
      setTimeout(() => setSessionError(null), 5000);
    }
  };

  // Let errors throw so FriendRequestsSection can display them per-button
  const handleAcceptRequest = async (req: FriendRequestDto) => {
    await respondFriendRequest(req.request_id, true);
    setPendingRequests((prev) => prev.filter((r) => r.request_id !== req.request_id));
    // Refresh contacts list to include the newly added contact
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

  // ── Contact right-click actions ──────────────────────────────────────────
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
    // Hide from sidebar; navigate away if it was the open chat
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
    const isMuted   = mutedSet.has(id);
    const isBlocked = blockedSet.has(id);
    const hasNote   = !!(notes[id]?.trim());
    return [
      { label: "View Profile",
        icon: <User size={13} />,
        onClick: () => setProfileContact(contact) },
      { label: hasNote ? "Edit Note" : "Add Note",
        icon: <StickyNote size={13} />,
        onClick: () => setProfileContact(contact) },
      { label: "Verify Identity",
        icon: <ShieldCheck size={13} />,
        onClick: () => navigate(`/verify/${id}`),
        disabled: !!contact.verified_fingerprint && !contact.key_change_pending },
      { separator: true },
      { label: isMuted ? "Unmute" : "Mute",
        icon: isMuted ? <Bell size={13} /> : <BellOff size={13} />,
        onClick: () => handleMuteToggle(id),
        checked: isMuted },
      { separator: true },
      { label: "Close DM",
        icon: <XCircle size={13} />,
        onClick: () => handleCloseDM(contact) },
      { label: isBlocked ? "Unblock" : "Block",
        icon: <Ban size={13} />,
        onClick: () => handleBlockToggle(id),
        danger: !isBlocked,
        checked: isBlocked },
    ];
  };

  // Filtered lists
  const filteredContacts = contacts.filter((c) => {
    const name = (c.display_name ?? c.contact_user_id).toLowerCase();
    const matchesSearch = name.includes(search.toLowerCase());
    // Always show if search is active (lets user re-open a closed DM by name)
    const notClosed = search.trim() ? true : !closedDMs.has(c.contact_user_id);
    return matchesSearch && notClosed;
  });
  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-dl-bg overflow-hidden">
      {/* Settings modal (global) */}
      <SettingsModal />

      {/* Context menu (right-click on contact) */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildCtxItems(ctxMenu.contact)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Contact profile + note modal */}
      {profileContact && (
        <ContactProfileModal
          contact={profileContact}
          note={notes[profileContact.contact_user_id] ?? ""}
          onClose={() => setProfileContact(null)}
          onNoteSave={(n) => handleSaveNote(profileContact.contact_user_id, n)}
        />
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      {addContactOpen && (
        <AddContactDialog
          onClose={() => setAddContactOpen(false)}
          onAdded={() => {
            getPendingRequests().then(setPendingRequests).catch(console.error);
            setAddContactOpen(false);
          }}
          onOpenDM={(userId, _username) => {
            // Re-open a closed DM and navigate to it
            setClosedDMs((prev) => {
              const next = new Set(prev);
              next.delete(userId);
              localStorage.setItem("dl_closed_dms", JSON.stringify([...next]));
              return next;
            });
            const contact = contacts.find((c) => c.contact_user_id === userId);
            if (contact) handleSelectContact(contact);
          }}
        />
      )}
      {createGroupOpen && (
        <CreateGroupDialog
          contacts={contacts}
          onClose={() => setCreateGroupOpen(false)}
          onCreated={(g) => {
            setGroups([...groups, g]);
            setCreateGroupOpen(false);
          }}
        />
      )}

      {/* ── Left Sidebar (resizable) ──────────────────────────────────────── */}
      <aside
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        className="relative flex flex-col bg-dl-surface border-r border-dl-border overflow-hidden"
      >
        {/* Drag resize handle */}
        <div
          onMouseDown={onResizeStart}
          className="absolute top-0 right-0 w-[5px] h-full z-20 cursor-col-resize group flex items-center justify-center select-none"
          title="Drag to resize"
        >
          <div className="w-[1px] h-full bg-dl-border group-hover:bg-dl-accent/60 group-hover:w-[3px] transition-all" />
        </div>
        {/* Header */}
        <div className="px-4 py-3 border-b border-dl-border">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Darklock" className="w-5 h-5 object-contain" />
            <span className="font-semibold text-sm">Secure Channel</span>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dl-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="dl-input pl-8 py-1.5 text-sm"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-3 gap-1">
          {([
            { key: "contacts" as Tab, icon: MessageSquare, label: "Contacts" },
            { key: "groups" as Tab, icon: Users, label: "Groups" },
          ]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={clsx(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all",
                tab === key
                  ? "bg-dl-accent/10 text-dl-accent"
                  : "text-dl-muted hover:text-dl-text hover:bg-dl-elevated"
              )}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Session error banner */}
        {sessionError && (
          <div className="mx-2 mb-1 px-3 py-2 rounded-md bg-dl-danger/10 border border-dl-danger/30 text-xs text-dl-danger">
            {sessionError}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {tab === "contacts" && (
            <>
              {/* Friend requests section (inline, above contacts) */}
              {pendingRequests.length > 0 && (
                <FriendRequestsSection
                  requests={pendingRequests}
                  onAccept={handleAcceptRequest}
                  onDeny={handleDenyRequest}
                  onCancel={handleCancelRequest}
                />
              )}
              {filteredContacts.map((contact) => (
                <ContactItem
                  key={contact.id}
                  contact={contact}
                  isActive={activeContactId === contact.contact_user_id}
                  isMuted={mutedSet.has(contact.contact_user_id)}
                  isBlocked={blockedSet.has(contact.contact_user_id)}
                  onClick={() =>
                    !blockedSet.has(contact.contact_user_id) && handleSelectContact(contact)
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ contact, x: e.clientX, y: e.clientY });
                  }}
                />
              ))}
              <button
                onClick={() => setAddContactOpen(true)}
                className="flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm text-dl-muted hover:text-dl-text hover:bg-dl-elevated transition-colors"
              >
                <Plus size={14} />
                Add contact
              </button>
            </>
          )}

          {tab === "groups" && (
            <>
              {filteredGroups.map((group) => (
                <GroupItem key={group.id} group={group} />
              ))}
              <button
                onClick={() => setCreateGroupOpen(true)}
                className="flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm text-dl-muted hover:text-dl-text hover:bg-dl-elevated transition-colors"
              >
                <Plus size={14} />
                Create group
              </button>
            </>
          )}

          {((tab === "contacts" && filteredContacts.length === 0) ||
            (tab === "groups" && filteredGroups.length === 0)) && (
              <div className="text-center text-xs text-dl-muted py-8">
                {search ? "No results found" : `No ${tab} yet`}
              </div>
            )}
        </div>

        {/* ── Bottom: User Profile ───────────────────────────────────────── */}
        <div className="border-t border-dl-border p-3">
          <div
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-dl-elevated cursor-pointer transition-colors"
            onClick={() => openSettings("account")}
          >
            {avatarDataUrl ? (
              <img
                src={avatarDataUrl}
                alt="avatar"
                className="w-9 h-9 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-dl-accent/20 flex items-center justify-center shrink-0">
                <User size={18} className="text-dl-accent" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{username ?? "User"}</div>
              <div className="text-xs text-dl-success flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-dl-success" />
                Online
              </div>
            </div>
            <ChevronDown size={14} className="text-dl-muted" />
          </div>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ContactItem({
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
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={clsx(
        "flex w-full items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left group",
        isActive
          ? "bg-dl-accent/10 text-dl-text"
          : "text-dl-text-dim hover:bg-dl-elevated hover:text-dl-text",
        contact.key_change_pending && "ring-1 ring-dl-danger/50",
        isBlocked && "opacity-50"
      )}
    >
      <div className="relative shrink-0">
        <div className="w-8 h-8 rounded-full bg-dl-elevated flex items-center justify-center text-xs font-medium uppercase">
          {(contact.display_name ?? contact.contact_user_id).charAt(0)}
        </div>
        {/* Indicator badge — priority: blocked > muted > verified */}
        {isBlocked ? (
          <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-dl-surface rounded-full flex items-center justify-center">
            <Ban size={9} className="text-dl-danger" />
          </div>
        ) : isMuted ? (
          <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-dl-surface rounded-full flex items-center justify-center">
            <BellOff size={9} className="text-dl-muted" />
          </div>
        ) : contact.verified_fingerprint ? (
          <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-dl-surface rounded-full flex items-center justify-center">
            <UserCheck size={9} className="text-dl-success" />
          </div>
        ) : null}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {contact.display_name ?? contact.contact_user_id}
        </div>
        {contact.key_change_pending && (
          <div className="text-[10px] text-dl-danger font-medium">
            ⚠ Identity key changed — verify to unlock
          </div>
        )}
        {isBlocked && !contact.key_change_pending && (
          <div className="text-[10px] text-dl-danger">Blocked</div>
        )}
        {isMuted && !isBlocked && !contact.key_change_pending && (
          <div className="text-[10px] text-dl-muted">Muted</div>
        )}
      </div>
    </button>
  );
}

function GroupItem({ group }: { group: GroupDto }) {
  return (
    <button className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-dl-text-dim hover:bg-dl-elevated hover:text-dl-text transition-colors text-left">
      <div className="w-8 h-8 rounded-full bg-dl-elevated flex items-center justify-center">
        <Users size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{group.name}</div>
        <div className="text-[10px] text-dl-muted">
          {group.member_count} member{group.member_count !== 1 ? "s" : ""}
        </div>
      </div>
    </button>
  );
}
