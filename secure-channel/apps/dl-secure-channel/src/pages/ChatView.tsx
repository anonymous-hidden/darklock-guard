/**
 * ChatView — Message bubbles, composer, delivery states, attachments.
 */
import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Send,
  Paperclip,
  Loader2,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  Lock,
  MessageSquare,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";

import { getMessages, sendMessage, verifyContact, getContacts } from "@/lib/tauri";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import type { MessageDto } from "@/types";

const DELIVERY_ICONS: Record<string, React.ReactNode> = {
  sending: <Clock size={12} className="text-dl-muted" />,
  sent: <Check size={12} className="text-dl-muted" />,
  delivered: <Check size={12} className="text-dl-text-dim" />,
  read: <CheckCheck size={12} className="text-dl-accent" />,
  failed: <AlertCircle size={12} className="text-dl-danger" />,
};

const DELIVERY_LABELS: Record<string, string> = {
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  read: "Seen",
  failed: "Failed",
};

export default function ChatView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { messages, activeContactId, contacts, setMessages, appendMessage, replaceMessage, setMessageDeliveryState, setContacts } = useChatStore();
  const { userId } = useAuthStore();

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentContact = contacts.find((c) => c.contact_user_id === activeContactId);
  const sessionMessages = sessionId ? messages[sessionId] ?? [] : [];

  // Load messages when session changes
  useEffect(() => {
    if (!sessionId) return;
    getMessages(sessionId, 50).then((msgs) => setMessages(sessionId, msgs)).catch(console.error);
  }, [sessionId]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessionMessages.length]);

  const handleSend = async () => {
    if (!body.trim() || !sessionId) return;
    setSending(true);
    setSendError(null);
    const text = body;
    setBody("");

    const nowIso = new Date().toISOString();
    const tempId = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimistic: MessageDto = {
      id: tempId,
      session_id: sessionId,
      sender_id: userId ?? "me",
      recipient_id: activeContactId ?? "",
      sent_at: nowIso,
      delivery_state: "sending",
      content: { type: "text", body: text },
      is_outgoing: true,
      chain_link: "",
      ratchet_n: 0,
    };
    appendMessage(sessionId, optimistic);

    try {
      const msg = await sendMessage(sessionId, text);
      replaceMessage(sessionId, tempId, { ...msg, delivery_state: "delivered" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("Send failed:", errMsg);
      setSendError(errMsg);
      setMessageDeliveryState(sessionId, tempId, "failed");
      setBody(text); // restore on failure
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleTrust = async () => {
    if (!activeContactId) return;
    setVerifying(true);
    try {
      await verifyContact(activeContactId);
      // Refresh contacts list to reflect new verified_fingerprint
      const updated = await getContacts();
      setContacts(updated);
    } catch (err) {
      console.error("Verify failed:", err);
    } finally {
      setVerifying(false);
    }
  };

  // ── Empty state ───────────────────────────────────────────────────────
  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-dl-elevated flex items-center justify-center mx-auto">
            <MessageSquare className="w-8 h-8 text-dl-muted" />
          </div>
          <h3 className="text-lg font-medium text-dl-text-dim">Select a conversation</h3>
          <p className="text-sm text-dl-muted max-w-xs">
            Choose a contact from the sidebar to start messaging. All conversations are end-to-end encrypted.
          </p>
          <div className="flex items-center justify-center gap-1.5 text-xs text-dl-accent">
            <Lock size={12} />
            <span>E2E Encrypted</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-dl-border bg-dl-surface/50 backdrop-blur-sm">
        <div className="w-9 h-9 rounded-full bg-dl-elevated flex items-center justify-center text-sm font-medium uppercase">
          {(currentContact?.display_name ?? activeContactId ?? "?").charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">
            {currentContact?.display_name ?? activeContactId}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {currentContact?.verified_fingerprint ? (
              <span className="text-dl-success flex items-center gap-1">
                <ShieldCheck size={11} /> Verified
              </span>
            ) : (
              <>
                <span className="text-dl-warning flex items-center gap-1">
                  <ShieldAlert size={11} /> Not verified
                </span>
                {!currentContact?.key_change_pending && (
                  <button
                    onClick={handleTrust}
                    disabled={verifying}
                    className="ml-1 text-[10px] text-dl-accent bg-dl-accent/10 hover:bg-dl-accent/20 px-1.5 py-0.5 rounded transition-colors disabled:opacity-50"
                  >
                    {verifying ? "Trusting…" : "Trust"}
                  </button>
                )}
              </>
            )}
            {currentContact?.key_change_pending && (
              <span className="text-dl-danger font-medium ml-1">⚠ Key changed</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-dl-accent bg-dl-accent/10 px-2 py-1 rounded-full">
          <Lock size={10} />
          <span>E2E</span>
        </div>
      </div>

      {/* ── Key change warning banner ─────────────────────────────── */}
      {currentContact?.key_change_pending && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-dl-danger/10 border border-dl-danger/30 text-sm text-dl-danger flex items-center gap-2">
          <ShieldAlert size={16} />
          <span className="flex-1">
            <strong>Identity key changed.</strong> Messaging is blocked until you verify this
            contact's new key.
          </span>
        </div>
      )}

      {/* ── Messages ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {sessionMessages.length === 0 && (
          <div className="text-center text-sm text-dl-muted py-8">
            No messages yet. Say hello! 🔐
          </div>
        )}

        <AnimatePresence initial={false}>
          {sessionMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* ── Composer ──────────────────────────────────────────────── */}
      <div className="border-t border-dl-border bg-dl-surface/50 backdrop-blur-sm px-4 py-3">
        {sendError && (
          <div className="flex items-center gap-2 text-xs text-dl-danger bg-dl-danger/10 rounded-lg px-3 py-2 mb-2">
            <AlertCircle size={13} />
            <span className="flex-1 truncate">{sendError}</span>
            <button onClick={() => setSendError(null)} className="shrink-0 hover:opacity-70">✕</button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button className="dl-btn-ghost p-2 rounded-lg" title="Attach file">
            <Paperclip size={18} />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={currentContact?.key_change_pending ? "Messaging blocked — verify contact" : "Type a message..."}
            disabled={currentContact?.key_change_pending}
            className="dl-input flex-1 py-2"
          />
          <button
            onClick={handleSend}
            disabled={sending || !body.trim() || currentContact?.key_change_pending}
            className="dl-btn-primary p-2 rounded-lg"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: MessageDto }) {
  const content = message.content;
  const isOutgoing = message.is_outgoing;

  let textBody = "";
  if (content.type === "text") textBody = content.body;
  else if (content.type === "attachment") textBody = `📎 ${content.filename}`;
  else textBody = `[${content.type}]`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={clsx("flex", isOutgoing ? "justify-end" : "justify-start")}
    >
      <div
        className={clsx(
          "max-w-[70%] rounded-2xl px-4 py-2.5 relative group",
          isOutgoing
            ? "bg-dl-accent text-white rounded-br-md"
            : "bg-dl-elevated text-dl-text rounded-bl-md"
        )}
      >
        <p className="text-sm whitespace-pre-wrap break-words">{textBody}</p>
        <div className={clsx(
          "flex items-center gap-1.5 mt-1",
          isOutgoing ? "justify-end" : "justify-start"
        )}>
          <span className={clsx(
            "text-[10px]",
            isOutgoing ? "text-white/60" : "text-dl-muted"
          )}>
            {formatTime(message.sent_at)}
          </span>
          {isOutgoing && (
            <span className="flex items-center gap-1" title={DELIVERY_LABELS[message.delivery_state] ?? message.delivery_state}>
              {DELIVERY_ICONS[message.delivery_state]}
              <span className="text-[10px] text-white/60">
                {DELIVERY_LABELS[message.delivery_state] ?? message.delivery_state}
              </span>
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function formatTime(iso: string): string {
  try {
    return format(parseISO(iso), "HH:mm");
  } catch {
    return "";
  }
}
