/**
 * MessageList — Scrollable message area with date separators, auto-scroll,
 * and empty state. Connected to real encrypted message store.
 */
import { useEffect, useRef, useCallback, useState } from "react";
import { parseISO } from "date-fns";
import { Lock, ShieldCheck } from "lucide-react";

import { getMessages, pinDmMessage } from "@/lib/tauri";
import { useChatStore } from "@/store/chatStore";
import type { MessageDto } from "@/types";
import MessageItem, { DateSeparator } from "./MessageItem";
import JumpToLatest from "@/components/JumpToLatest";

interface MessageListProps {
  sessionId: string;
  onReply?: (msg: MessageDto) => void;
  onEdit?: (msg: MessageDto) => void;
  onDelete?: (msg: MessageDto) => void;
}

export default function MessageList({ sessionId, onReply, onEdit, onDelete }: MessageListProps) {
  const { messages, setMessages, activeContactId, contacts } = useChatStore();
  const sessionMessages = messages[sessionId] ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const currentContact = contacts.find((c) => c.contact_user_id === activeContactId);
  const contactName = currentContact?.display_name ?? activeContactId ?? "Unknown";

  const handlePin = useCallback(async (msg: MessageDto) => {
    try {
      const preview = msg.content.type === "text" ? msg.content.body.slice(0, 200) : `[${msg.content.type}]`;
      await pinDmMessage(sessionId, msg.id, preview);
    } catch (e) {
      console.error("Pin failed:", e);
    }
  }, [sessionId]);

  // Load messages on session change
  useEffect(() => {
    if (!sessionId) return;
    getMessages(sessionId, 50)
      .then((msgs) => setMessages(sessionId, msgs))
      .catch(console.error);
  }, [sessionId]);

  // Track scroll position + show Jump to Latest
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 100;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isAtBottom.current = atBottom;
    setShowJump(!atBottom);
    if (atBottom) setUnreadCount(0);
  }, [sessionId]);

  // Track new-message unread count when scrolled up
  useEffect(() => {
    if (!isAtBottom.current && sessionMessages.length > 0) {
      setUnreadCount((prev) => prev + 1);
    }
  }, [sessionMessages.length]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowJump(false);
    setUnreadCount(0);
  }, []);

  // Auto-scroll only if user was at bottom
  useEffect(() => {
    if (isAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [sessionMessages.length]);

  // Group messages: show header when sender changes or >5 min gap
  const groupedMessages = groupMessages(sessionMessages, contactName);

  if (sessionMessages.length === 0) {
    return (
      <div className="message-list message-list--empty">
        <div className="message-list__empty-state">
          <div className="message-list__empty-avatar">
            <span>{contactName.charAt(0).toUpperCase()}</span>
          </div>
          <h3 className="message-list__empty-name">{contactName}</h3>
          <p className="message-list__empty-hint">
            This is the beginning of your encrypted conversation with <strong>{contactName}</strong>.
          </p>
          <div className="message-list__empty-badges">
            <span className="message-list__empty-badge">
              <Lock size={12} />
              End-to-End Encrypted
            </span>
            {currentContact?.verified_fingerprint && (
              <span className="message-list__empty-badge message-list__empty-badge--success">
                <ShieldCheck size={12} />
                Identity Verified
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="message-list"
      onScroll={handleScroll}
    >
      {/* Top spacer for scroll loading area */}
      <div className="message-list__spacer" />

      {groupedMessages.map((item) => {
        if (item.type === "separator") {
          return <DateSeparator key={`sep-${item.date}`} date={item.date} />;
        }
        return (
          <MessageItem
            key={item.message.id}
            message={item.message}
            showHeader={item.showHeader}
            senderName={item.senderName}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
            onPin={handlePin}
          />
        );
      })}

      <div ref={bottomRef} className="h-1" />

      {/* Floating jump-to-latest pill */}
      <JumpToLatest
        visible={showJump}
        unreadCount={unreadCount}
        onClick={scrollToBottom}
      />
    </div>
  );
}

/* ── Message grouping logic ──────────────────────────────────────────────── */

type GroupedItem =
  | { type: "separator"; date: string }
  | { type: "message"; message: MessageDto; showHeader: boolean; senderName: string };

function groupMessages(messages: MessageDto[], contactName: string): GroupedItem[] {
  const items: GroupedItem[] = [];
  let lastSenderId: string | null = null;
  let lastDate: string | null = null;
  let lastTimestamp: number | null = null;

  for (const msg of messages) {
    const msgDate = parseISO(msg.sent_at);
    const dateKey = msgDate.toISOString().split("T")[0];

    // Date separator
    if (dateKey !== lastDate) {
      items.push({ type: "separator", date: msg.sent_at });
      lastDate = dateKey;
      lastSenderId = null;
      lastTimestamp = null;
    }

    // Show header if sender changed or >5 min gap
    const timeDiff = lastTimestamp ? msgDate.getTime() - lastTimestamp : Infinity;
    const showHeader = msg.sender_id !== lastSenderId || timeDiff > 5 * 60 * 1000;

    const senderName = msg.is_outgoing ? "You" : contactName;

    items.push({ type: "message", message: msg, showHeader, senderName });

    lastSenderId = msg.sender_id;
    lastTimestamp = msgDate.getTime();
  }

  return items;
}
