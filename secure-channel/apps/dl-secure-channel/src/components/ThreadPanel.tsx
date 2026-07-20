/**
 * ThreadPanel — Slide-in panel for viewing/replying within a message thread.
 */
import React, { useState, useRef, useEffect } from "react";
import { X, Send, Loader2, MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { MessageDto } from "@/types";
import MessageItem from "@/components/layout/MessageItem";

interface ThreadPanelProps {
  /** Parent message that started the thread */
  parentMessage: MessageDto | null;
  /** Replies in this thread */
  replies: MessageDto[];
  /** Whether the panel is open */
  open: boolean;
  /** Close callback */
  onClose: () => void;
  /** Send reply callback */
  onSendReply: (text: string) => Promise<void>;
  /** Current user display name */
  currentUsername: string;
  /** Map of userId → displayName */
  userNames: Record<string, string>;
}

export default function ThreadPanel({
  parentMessage,
  replies,
  open,
  onClose,
  onSendReply,
  currentUsername,
  userNames,
}: ThreadPanelProps) {
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new replies arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [replies.length]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  const handleSend = async () => {
    const text = replyText.trim();
    if (!text) return;
    setSending(true);
    try {
      await onSendReply(text);
      setReplyText("");
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getName = (senderId: string, isOutgoing: boolean) => {
    if (isOutgoing) return currentUsername;
    return userNames[senderId] ?? senderId.slice(0, 8);
  };

  return (
    <AnimatePresence>
      {open && parentMessage && (
        <motion.div
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          className="thread-panel"
        >
          {/* Header */}
          <div className="thread-panel__header">
            <MessageSquare size={18} className="text-dl-accent" />
            <div className="thread-panel__header-text">
              <span className="thread-panel__header-title">Thread</span>
              <span className="thread-panel__header-sub">
                {replies.length} repl{replies.length === 1 ? "y" : "ies"}
              </span>
            </div>
            <button className="thread-panel__close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          {/* Parent message */}
          <div className="thread-panel__parent">
            <MessageItem
              message={parentMessage}
              showHeader
              senderName={getName(parentMessage.sender_id, parentMessage.is_outgoing)}
            />
          </div>

          <div className="thread-panel__divider">
            <span>{replies.length} repl{replies.length === 1 ? "y" : "ies"}</span>
          </div>

          {/* Replies list */}
          <div className="thread-panel__messages" ref={scrollRef}>
            {replies.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                showHeader
                senderName={getName(msg.sender_id, msg.is_outgoing)}
              />
            ))}
            {replies.length === 0 && (
              <div className="thread-panel__empty">
                No replies yet. Start the conversation!
              </div>
            )}
          </div>

          {/* Reply input */}
          <div className="thread-panel__input">
            <textarea
              ref={textareaRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Reply in thread…"
              rows={1}
              className="thread-panel__textarea"
            />
            {replyText.trim() && (
              <button
                onClick={handleSend}
                disabled={sending}
                className="thread-panel__send"
              >
                {sending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
