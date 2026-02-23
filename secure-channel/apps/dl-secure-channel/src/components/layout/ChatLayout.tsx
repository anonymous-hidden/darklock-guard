/**
 * ChatLayout — Center chat area composing TopBar + MessageList + MessageInput.
 * Reads sessionId from route params.
 */
import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Lock, MessageSquare, ShieldCheck } from "lucide-react";

import { useChatStore } from "@/store/chatStore";
import TopBar from "./TopBar";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import TypingIndicator from "@/components/TypingIndicator";
import ThreadPanel from "@/components/ThreadPanel";
import type { MessageDto } from "@/types";

export default function ChatLayout() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { activeContactId, contacts } = useChatStore();

  const currentContact = contacts.find((c) => c.contact_user_id === activeContactId);
  const contactName = currentContact?.display_name ?? activeContactId ?? "Unknown";
  const isBlocked = currentContact?.key_change_pending;

  /* ── Typing indicator (simulated for now) ────────── */
  const [typingUsers] = useState<string[]>([]);

  /* ── Thread panel ────────────────────────────────── */
  const [activeThread, setActiveThread] = useState<{ parentMessage: MessageDto; replies: MessageDto[] } | null>(null);

  const handleOpenThread = useCallback((msg: MessageDto) => {
    setActiveThread({ parentMessage: msg, replies: [] });
  }, []);
  // Expose for future use in MessageItem integration
  void handleOpenThread;

  const handleCloseThread = useCallback(() => {
    setActiveThread(null);
  }, []);

  const handleSendThreadReply = useCallback(async (content: string) => {
    if (!activeThread) return;
    // Thread replies will be wired to backend later
    console.log("[thread-reply]", content);
  }, [activeThread]);

  // No session selected — show welcome
  if (!sessionId) {
    return (
      <div className="chat-layout">
        <TopBar />
        <div className="chat-layout__empty">
          <div className="chat-layout__empty-inner">
            <div className="chat-layout__empty-icon">
              <MessageSquare size={40} />
            </div>
            <h2 className="chat-layout__empty-title">Welcome to Darklock Secure Channel</h2>
            <p className="chat-layout__empty-text">
              Select a conversation from the sidebar to start messaging.
              <br />
              All conversations are end-to-end encrypted.
            </p>
            <div className="chat-layout__empty-badges">
              <span className="chat-layout__empty-badge">
                <Lock size={14} />
                X3DH Key Agreement
              </span>
              <span className="chat-layout__empty-badge">
                <ShieldCheck size={14} />
                Double Ratchet Protocol
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-layout">
      <TopBar />

      {/* Key change warning */}
      {currentContact?.key_change_pending && (
        <div className="chat-layout__warning">
          <strong>⚠ Identity key changed.</strong> Messaging is blocked until you verify this contact's new key.
        </div>
      )}

      <MessageList
        sessionId={sessionId}
        onReply={() => {/* future: set reply context */}}
        onDelete={() => {/* future: delete message */}}
      />

      {/* Typing indicator */}
      <TypingIndicator typingUsers={typingUsers} />

      <MessageInput
        sessionId={sessionId}
        disabled={!!isBlocked}
        disabledReason={isBlocked ? "Verify contact to unlock messaging" : undefined}
        contactName={contactName}
      />

      {/* Thread panel (slides in from right) */}
      <ThreadPanel
        parentMessage={activeThread?.parentMessage ?? null}
        replies={activeThread?.replies ?? []}
        open={!!activeThread}
        onClose={handleCloseThread}
        onSendReply={handleSendThreadReply}
        currentUsername="You"
        userNames={{}}
      />
    </div>
  );
}
