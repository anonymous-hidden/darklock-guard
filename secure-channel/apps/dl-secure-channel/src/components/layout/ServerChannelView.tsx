/**
 * ServerChannelView — Chat view for a server text channel.
 * Reads serverId + channelId from route params and renders channel messages.
 *
 * Uses WebSocket gateway for real-time message delivery (with REST fallback).
 * Integrates typing indicators, secure channel features, and read receipts.
 */
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import {
  Hash,
  Users,
  Send,
  Loader2,
  Plus,
  Shield,
  ShieldAlert,
  Lock,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import clsx from "clsx";

import { useLayoutStore } from "@/store/layoutStore";
import { useServerStore } from "@/store/serverStore";
import { useAuthStore } from "@/store/authStore";
import { usePresenceStore } from "@/store/presenceStore";
import { useCommandStore } from "@/store/commandStore";
import { useSocketStore } from "@/store/socketStore";
import MessageComposerBar from "@/components/MessageComposerBar";
import {
  getChannelMessages,
  sendChannelMessage,
  deleteChannelMessage,
} from "@/lib/tauri";
import type { ChannelMessageDto } from "@/types";
import { SecurityLevel as SL } from "@/types";
import PresenceIndicator from "@/components/PresenceIndicator";
import InviteEmbed from "@/components/InviteEmbed";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import VoiceChannelView from "@/components/VoiceChannelView";
import Avatar from "@/components/Avatar";
import TypingIndicator from "@/components/TypingIndicator";
import SecureChannelView from "@/components/SecureChannelView";

export default function ServerChannelView() {
  const { serverId, channelId } = useParams<{ serverId: string; channelId: string }>();
  const { toggleRightPanel, rightPanelOpen, setInviteDialogOpen } = useLayoutStore();
  const channels = useServerStore((s) => serverId ? (s.channels[serverId] ?? []) : []);
  const roles = useServerStore((s) => serverId ? (s.roles[serverId] ?? []) : []);
  const members = useServerStore((s) => serverId ? (s.members[serverId] ?? []) : []);
  const fetchMembers = useServerStore((s) => s.fetchMembers);
  const fetchRoles = useServerStore((s) => s.fetchRoles);
  const markChannelRead = useServerStore((s) => s.markChannelRead);
  const { userId } = useAuthStore();
  const commandStore = useCommandStore();
  // Real-time socket store for messages
  const {
    connected: wsConnected,
    messages: wsMessages,
    setMessages: wsSetMessages,
    subscribe: wsSubscribe,
    unsubscribe: wsUnsubscribe,
    sendTypingStart,
    sendTypingStop,
    sendReadAck,
    appendMessage: wsAppendMessage,
    removeMessage: wsRemoveMessage,
    getTypingUsers,
    connect: wsConnect,
  } = useSocketStore();

  const messages = channelId ? (wsMessages[channelId] ?? []) : [];
  const typingUsers = channelId ? getTypingUsers(channelId) : [];
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionMode, setMentionMode] = useState<"user" | "role">("user");
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>();

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const channel = channels.find((c) => c.id === channelId);
  const channelName = channel?.name ?? "unknown";
  const isSecureChannel = channel?.is_secure ?? false;
  const isLockdown = channel?.lockdown ?? false;
  const [securityPanelOpen, setSecurityPanelOpen] = useState(false);
  const mentionUsers = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return members
      .filter((m) => (m.nickname ?? m.username).toLowerCase().includes(q))
      .slice(0, 8);
  }, [members, mentionQuery]);
  const mentionRoles = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return roles
      .filter((r) => r.position > 0 && r.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [roles, mentionQuery]);
  const currentMember = useMemo(() => members.find((m) => m.user_id === userId), [members, userId]);
  const userPermissions = useMemo(() => {
    if (!currentMember) return 0;
    let perms = 0;
    for (const mr of currentMember.roles) {
      const role = roles.find((r) => r.id === mr.id);
      if (!role) continue;
      perms |= Number(role.permissions);
    }
    return perms;
  }, [currentMember, roles]);

  // Compute security level for RBAC
  const securityLevel: number = useMemo(() => {
    const server = serverId ? useServerStore.getState().servers.find((s) => s.id === serverId) : null;
    if (server && server.owner_id === userId) return SL.OWNER as number;
    if (!currentMember) return SL.USER as number;
    let maxLevel: number = SL.USER;
    for (const mr of currentMember.roles) {
      const role = roles.find((r) => r.id === mr.id);
      if (!role) continue;
      const secLevel: number = (role as any).security_level ?? 0;
      if (secLevel > maxLevel) maxLevel = secLevel;
      if (role.is_admin && SL.ADMIN > maxLevel) maxLevel = SL.ADMIN;
    }
    return maxLevel;
  }, [currentMember, roles, serverId, userId]);

  const canViewSecurityActions = securityLevel >= SL.SECURITY_ADMIN;

  // Load messages (REST initial fetch + WebSocket subscription)
  const fetchMessages = useCallback(async () => {
    if (!serverId || !channelId) return;
    try {
      const msgs = await getChannelMessages(serverId, channelId, 50);
      wsSetMessages(channelId, msgs);
    } catch (err) {
      console.error("[ServerChannelView] fetch error:", err);
    }
  }, [serverId, channelId, wsSetMessages]);

  useEffect(() => {
    setLoading(true);
    fetchMessages().finally(() => setLoading(false));
    if (serverId) {
      fetchMembers(serverId).catch(console.error);
      fetchRoles(serverId).catch(console.error);
    }

    // Connect WS gateway if not connected, then subscribe to this channel
    if (!wsConnected) {
      wsConnect().catch(console.error);
    }
    if (serverId && channelId) {
      // Small delay to ensure WS is connected
      const subTimeout = setTimeout(() => {
        wsSubscribe(serverId, channelId);
      }, 500);
      return () => {
        clearTimeout(subTimeout);
        if (channelId) wsUnsubscribe(channelId);
      };
    }

    // Fallback poll every 10s (only as safety net when WS is connected)
    pollRef.current = setInterval(fetchMessages, 10000);
    return () => clearInterval(pollRef.current);
  }, [fetchMessages, serverId, channelId, fetchMembers, fetchRoles, wsConnected, wsConnect, wsSubscribe, wsUnsubscribe]);

  // Auto-scroll
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  useEffect(() => {
    if (isAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  useEffect(() => {
    if (!serverId || !channelId || messages.length === 0) return;
    const last = messages[messages.length - 1];
    markChannelRead(serverId, channelId, last?.id ?? null).catch(() => {});
    // Also send read ack via WebSocket for other users
    if (last?.id) sendReadAck(serverId, channelId, last.id);
  }, [serverId, channelId, messages, markChannelRead, sendReadAck]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [body]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, [channelId]);

  const handleBodyChange = (next: string) => {
    setBody(next);

    // Send typing indicator via WebSocket
    if (serverId && channelId && next.trim()) {
      sendTypingStart(serverId, channelId);
      // Auto-stop typing after 5s of no input
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        if (serverId && channelId) sendTypingStop(serverId, channelId);
      }, 5000);
    } else if (serverId && channelId && !next.trim()) {
      sendTypingStop(serverId, channelId);
    }

    const atMatch = next.match(/(?:^|\s)@([^\s@]*)$/);
    if (!atMatch) {
      setMentionOpen(false);
      setMentionQuery("");
      setMentionIndex(0);
      return;
    }
    const token = atMatch[1] ?? "";
    if (token.toLowerCase().startsWith("role")) {
      setMentionMode("role");
      setMentionQuery(token.slice(4));
    } else {
      setMentionMode("user");
      setMentionQuery(token);
    }
    setMentionOpen(true);
    setMentionIndex(0);
  };

  const insertMention = (value: string) => {
    const updated = body.replace(/(?:^|\s)@([^\s@]*)$/, (m) => {
      const prefix = m.startsWith(" ") ? " " : "";
      return `${prefix}${value} `;
    });
    setBody(updated);
    setMentionOpen(false);
    setMentionQuery("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // Send message
  const handleSend = async () => {
    const text = body.trim();
    if (!text || !serverId || !channelId) return;

    if (text.startsWith("/")) {
      const result = await commandStore.execute(text, {
        userId: userId ?? "",
        username: currentMember?.username ?? "me",
        serverId,
        channelId,
        userPermissions,
        userRoles: currentMember?.roles.map((r) => r.id) ?? [],
        isOwner: !!currentMember?.is_owner,
        isAdmin: !!currentMember?.roles.some((r) => roles.find((rr) => rr.id === r.id)?.is_admin),
      });
      if (result && !result.ephemeral) {
        try {
          await sendChannelMessage(serverId, channelId, result.message, undefined, "text");
          await fetchMessages();
        } catch {}
      }
      setBody("");
      return;
    }

    setSending(true);
    setBody("");
    // Stop typing indicator
    if (serverId && channelId) sendTypingStop(serverId, channelId);
    try {
      const inviteMatch = text.match(/(?:darklock:\/\/invite\/|https?:\/\/(?:www\.)?darklock\.(?:net|app)\/invite\/)([A-Za-z0-9_-]+)/i);
      const msgType = inviteMatch ? "invite" : "text";
      const msgBody = inviteMatch ? inviteMatch[1] : text;
      const msg = await sendChannelMessage(serverId, channelId, msgBody, undefined, msgType);
      // Append via socketStore (deduplicated if WS also delivers it)
      if (channelId) wsAppendMessage(channelId, msg);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (err) {
      console.error("Send failed:", err);
      setBody(text);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const options = mentionMode === "role" ? mentionRoles : mentionUsers;
    if (mentionOpen && options.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % options.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + options.length) % options.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const pick = options[mentionIndex];
        if (pick) {
          if (mentionMode === "role") {
            insertMention(`<@&${(pick as any).id}>`);
          } else {
            insertMention(`<@${(pick as any).user_id}>`);
          }
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDelete = async (msgId: string) => {
    if (!serverId || !channelId) return;
    try {
      await deleteChannelMessage(serverId, channelId, msgId);
      wsRemoveMessage(channelId, msgId);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  if (!serverId || !channelId) {
    return (
      <div className="chat-layout">
        <div className="chat-layout__empty">
          <div className="chat-layout__empty-inner">
            <Hash size={40} className="text-dl-muted mb-4" />
            <h2 className="chat-layout__empty-title">Select a Channel</h2>
            <p className="chat-layout__empty-text">
              Pick a text channel from the sidebar to start chatting.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (channel && (channel.type === "voice" || channel.type === "stage")) {
    return (
      <div className="chat-layout">
        <div className="topbar">
          <div className="topbar__left">
            <Hash size={20} className="text-dl-muted shrink-0" />
            <span className="topbar__name">{channelName}</span>
          </div>
        </div>
        <VoiceChannelView serverId={serverId} channel={channel} />
      </div>
    );
  }

  return (
    <div className="chat-layout">
      {/* ── Channel TopBar ─────────────────────────────────────────── */}
      <div className="topbar">
        <div className="topbar__left">
          {isSecureChannel ? (
            isLockdown ? (
              <ShieldAlert size={20} className="text-red-400 shrink-0" />
            ) : (
              <Shield size={20} className="text-emerald-400 shrink-0" />
            )
          ) : (
            <Hash size={20} className="text-dl-muted shrink-0" />
          )}
          <span className="topbar__name">{channelName}</span>
          {isSecureChannel && (
            <span className={clsx(
              "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ml-1",
              isLockdown
                ? "bg-red-500/15 text-red-400"
                : "bg-emerald-500/15 text-emerald-400"
            )}>
              {isLockdown ? "LOCKED" : "SECURE"}
            </span>
          )}
          {!wsConnected && (
            <span className="text-[10px] text-yellow-400/70 ml-2">Connecting...</span>
          )}
          {channel?.topic && (
            <span className="text-xs text-white/30 ml-2 truncate max-w-[300px]">{channel.topic}</span>
          )}
        </div>
        <div className="topbar__actions">
          {isSecureChannel && canViewSecurityActions && (
            <button
              className="topbar__action text-emerald-400/80 hover:text-emerald-400"
              title="Security Controls"
              onClick={() => setSecurityPanelOpen(!securityPanelOpen)}
            >
              <Lock size={18} />
            </button>
          )}
          <button
            className={`topbar__action ${rightPanelOpen ? "topbar__action--active" : ""}`}
            title="Member List"
            onClick={toggleRightPanel}
          >
            <Users size={18} />
          </button>
          <button
            className="topbar__action"
            title="Invite People"
            onClick={() => setInviteDialogOpen(true)}
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* ── Secure Channel View (banner + controls) ───────────────── */}
      {channel && isSecureChannel && (
        <SecureChannelView
          serverId={serverId}
          channel={channel}
          securityLevel={securityLevel}
        />
      )}

      {/* ── Messages ──────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="message-list"
        onScroll={handleScroll}
      >
        <div className="message-list__spacer" />

        {loading && messages.length === 0 && (
          <div className="flex items-center justify-center py-12 text-white/30">
            <Loader2 className="animate-spin mr-2" size={20} />
            Loading messages...
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-white/30">
            <Hash size={40} className="mb-3 text-white/10" />
            <p className="text-lg font-semibold text-white/50">Welcome to #{channelName}!</p>
            <p className="text-sm mt-1">This is the start of the #{channelName} channel.</p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const prevMsg = messages[idx - 1];
          const showHeader = !prevMsg ||
            prevMsg.author_id !== msg.author_id ||
            (new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime()) > 5 * 60 * 1000;

          return (
            <ChannelMessageItem
              key={msg.id}
              message={msg}
              showHeader={showHeader}
              isOwn={msg.author_id === userId}
              members={members}
              roles={roles}
              onDelete={() => handleDelete(msg.id)}
            />
          );
        })}

        <div ref={bottomRef} className="h-1" />
      </div>

      {/* ── Typing Indicator ──────────────────────────────────────── */}
      <TypingIndicator typingUsers={typingUsers.map((t) => t.username)} />

      {/* ── Message Input ─────────────────────────────────────────── */}
      <div className="message-input-wrapper relative">
        <MessageComposerBar
          onAttach={() => {}}
          onHash={() => {}}
          onEmoji={() => {}}
          rightSlot={body.trim() && (
            <button
              onClick={handleSend}
              disabled={sending}
              className="message-input__send"
              title="Send"
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          )}
        >
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => handleBodyChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message #${channelName}`}
            rows={1}
            className="message-input__textarea"
          />
        </MessageComposerBar>
        {mentionOpen && (mentionMode === "role" ? mentionRoles.length > 0 : mentionUsers.length > 0) && (
          <div className="absolute bottom-14 left-3 w-[280px] rounded-lg border border-white/[0.08] bg-[#111218] shadow-xl overflow-hidden z-20">
            {(mentionMode === "role" ? mentionRoles : mentionUsers).map((entry: any, idx: number) => (
              <button
                key={mentionMode === "role" ? entry.id : entry.user_id}
                onClick={() => {
                  if (mentionMode === "role") insertMention(`<@&${entry.id}>`);
                  else insertMention(`<@${entry.user_id}>`);
                }}
                className={clsx(
                  "w-full px-3 py-2 text-left text-xs transition-colors",
                  idx === mentionIndex ? "bg-white/[0.08] text-white/90" : "text-white/65 hover:bg-white/[0.05]"
                )}
              >
                @{mentionMode === "role" ? entry.name : (entry.nickname ?? entry.username)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Individual channel message row ──────────────────────────────────────── */

/** Regex to detect invite links in plain text */
const INVITE_URL_RE = /(?:darklock:\/\/invite\/|https?:\/\/(?:www\.)?darklock\.(?:net|app)\/invite\/)([A-Za-z0-9_-]+)/g;

/** Extract invite codes from text content */
function extractInviteCodes(text: string): string[] {
  const codes: string[] = [];
  let m;
  const re = new RegExp(INVITE_URL_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    codes.push(m[1]);
  }
  return codes;
}

function resolveMentionTokens(
  text: string,
  members: Array<{ user_id: string; username: string; nickname: string | null }>,
  roles: Array<{ id: string; name: string }>,
): string {
  return String(text ?? "")
    .replace(/<@([a-zA-Z0-9_-]+)>/g, (_m, id) => {
      const m = members.find((x) => x.user_id === id);
      return `@${m?.nickname ?? m?.username ?? "unknown"}`;
    })
    .replace(/<@&([a-zA-Z0-9_-]+)>/g, (_m, id) => {
      const r = roles.find((x) => x.id === id);
      return `@${r?.name ?? "role"}`;
    });
}

function ChannelMessageItem({
  message,
  showHeader,
  isOwn,
  members,
  roles,
  onDelete,
}: {
  message: ChannelMessageDto;
  showHeader: boolean;
  isOwn: boolean;
  members: Array<{
    user_id: string;
    username: string;
    nickname: string | null;
    roles: Array<{ id: string; name: string; position: number; badge_image_url?: string | null }>;
  }>;
  roles: Array<{ id: string; name: string }>;
  onDelete: () => void;
}) {
  const [hovering, setHovering] = useState(false);
  const getStatus = usePresenceStore((s) => s.getStatus);
  const authorMember = members.find((m) => m.user_id === message.author_id);
  const displayName = authorMember?.nickname ?? authorMember?.username ?? message.author_username ?? message.author_id.slice(0, 8);
  const badgeRole = authorMember?.roles
    ?.filter((r) => !!r.badge_image_url)
    .sort((a, b) => b.position - a.position)[0];

  let timeStr = "";
  let fullTime = "";
  try {
    const d = parseISO(message.created_at);
    timeStr = format(d, "HH:mm");
    fullTime = format(d, "MM/dd/yyyy HH:mm");
  } catch { /* */ }

  const resolvedContent = resolveMentionTokens(message.content, members, roles);

  return (
    <div
      className={clsx(
        "message-item",
        showHeader ? "message-item--with-header" : "message-item--compact",
        hovering && "message-item--hover"
      )}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Avatar gutter */}
      <div className="message-item__gutter">
        {showHeader ? (
          <div className="message-item__avatar relative overflow-visible">
            <Avatar userId={message.author_id} fallbackName={displayName} size={40} />
            <PresenceIndicator status={getStatus(message.author_id)} size="sm" className="absolute -bottom-0.5 -right-0.5" />
          </div>
        ) : (
          <span className="message-item__timestamp-hover" title={fullTime}>
            {timeStr}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="message-item__content">
        {showHeader && (
          <div className="message-item__header">
            <span className="message-item__author">{displayName}</span>
            {badgeRole?.badge_image_url && (
              <img
                src={badgeRole.badge_image_url}
                alt={`${badgeRole.name} badge`}
                className="w-3.5 h-3.5 rounded-sm object-cover"
              />
            )}
            <span className="message-item__time" title={fullTime}>{fullTime}</span>
            {message.edited_at && (
              <span className="text-[10px] text-white/20 ml-1">(edited)</span>
            )}
          </div>
        )}
        <div className="message-item__body">
          {message.type === "invite" ? (
            /* Invite message type — render as embed card */
            <InviteEmbed inviteCode={message.content} />
          ) : (
            <>
              <MarkdownRenderer content={resolvedContent} />
              {/* Auto-detect invite links in regular messages */}
              {extractInviteCodes(message.content).map((code) => (
                <div key={code} className="mt-2">
                  <InviteEmbed inviteCode={code} compact />
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Hover actions */}
      {hovering && isOwn && (
        <div className="message-item__actions">
          <button
            onClick={onDelete}
            className="message-item__action-btn message-item__action-btn--danger"
            title="Delete"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
