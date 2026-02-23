/**
 * MessageInput — Discord-style message composer with attachment button,
 * emoji picker, typing indicator, slash command integration, markdown toolbar,
 * character counter, and Enter-to-send.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Loader2,
  AlertCircle,
  Bold,
  Italic,
  Code,
  Strikethrough,
} from "lucide-react";

import { sendMessage, sendAttachment } from "@/lib/tauri";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import { useCommandStore } from "@/store/commandStore";
import SlashCommandMenu from "@/components/SlashCommandMenu";
import MessageComposerBar from "@/components/MessageComposerBar";
import type { MessageDto } from "@/types";

const MAX_MESSAGE_LENGTH = 4000;

// Common emoji categories for the picker
const EMOJI_CATEGORIES: Record<string, string[]> = {
  "Smileys": ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🫡","🤐","🤨","😐","😑","😶","🫥","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐","😕","🫤","😟","🙁","😮","😯","😲","😳","🥺","🥹","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","☠️","💩","🤡","👹","👺","👻","👽","👾","🤖"],
  "Gestures": ["👋","🤚","🖐️","✋","🖖","🫱","🫲","🫳","🫴","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","🫵","👍","👎","👊","✊","🤛","🤜","👏","🙌","🫶","👐","🤲","🤝","🙏","✍️","💅","🤳","💪"],
  "Hearts": ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓","💗","💖","💘","💝","💟"],
  "Objects": ["🎉","🎊","🎈","🎁","🎀","🏆","🥇","🥈","🥉","⚽","🏀","🏈","⚾","🥎","🎾","🏐","🎱","🔥","⭐","🌟","✨","💫","🌈","☀️","🌤️","⛅","🌥️","☁️","🌦️","🌧️","⛈️","🌩️","❄️","💧","🌊","🎵","🎶","🎤","🎧","🎸","🎹","🎺","🎻","🥁","📱","💻","🖥️","🖨️","⌨️","🖱️","💡","📷","📹","📺","📻","📚","📖","📝","📄","📌","📎","✂️","📐","📏"],
  "Food": ["🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶️","🫑","🌽","🥕","🧄","🧅","🍄","🥜","🫘","🌰","🍞","🥐","🥖","🫓","🥨","🥯","🥞","🧇","🍕","🍔","🍟","🌭","🥪","🌮","🌯","🫔","🥙","🧆","🥚","🍳","🥘","🍲","🫕","🥣","🍜","🍝","🍛","🍣","🍱","🍤","🍙","🍘","🍥","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","☕","🍵","🫖","🥤","🧋","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧃"],
  "Animals": ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🦟","🦗","🕷️","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🦧","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🦬","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐕‍🦺","🐈","🐈‍⬛","🪶","🐓","🦃","🦤","🦚","🦜","🦢","🦩","🕊️","🐇","🦝","🦨","🦡","🦫","🦦","🦥","🐁","🐀","🐿️","🦔"],
};

interface MessageInputProps {
  sessionId: string;
  disabled?: boolean;
  disabledReason?: string;
  contactName?: string;
}

export default function MessageInput({
  sessionId,
  disabled = false,
  disabledReason,
  contactName,
}: MessageInputProps) {
  const { appendMessage, replaceMessage, setMessageDeliveryState, activeContactId } = useChatStore();
  const { userId, username } = useAuthStore();
  const commandStore = useCommandStore();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState("Smileys");
  const [attachSending, setAttachSending] = useState(false);
  const [showMarkdownBar, setShowMarkdownBar] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [body]);

  // Focus on mount
  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [sessionId, disabled]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmoji) return;
    const handleClick = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showEmoji]);

  // ── Slash command input tracking ──
  const handleBodyChange = useCallback((text: string) => {
    setBody(text);
    if (text.startsWith("/")) {
      commandStore.setInputText(text);
    } else if (commandStore.menuOpen) {
      commandStore.closeMenu();
    }
  }, [commandStore]);

  // Markdown toolbar: wrap selection with syntax
  const wrapSelection = useCallback((prefix: string, suffix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = body.slice(start, end);
    const newBody = body.slice(0, start) + prefix + selected + suffix + body.slice(end);
    setBody(newBody);
    requestAnimationFrame(() => {
      ta.selectionStart = start + prefix.length;
      ta.selectionEnd = end + prefix.length;
      ta.focus();
    });
  }, [body]);

  // Is this a slash command input?
  const charCount = body.length;
  const isOverLimit = charCount > MAX_MESSAGE_LENGTH;

  const handleAttach = async () => {
    if (disabled || attachSending) return;
    let optimisticId: string | null = null;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        title: "Select a file to send",
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
          { name: "Documents", extensions: ["pdf", "txt", "doc", "docx", "zip"] },
          { name: "Media", extensions: ["mp4", "mp3", "wav", "webm"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (!selected) return; // user cancelled
      const filePath = typeof selected === "string" ? selected : selected;
      setAttachSending(true);
      setError(null);

      const nowIso = new Date().toISOString();
      const filename = String(filePath).split(/[/\\]/).pop() || "attachment";
      const tempId = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      optimisticId = tempId;
      const optimistic: MessageDto = {
        id: tempId,
        session_id: sessionId,
        sender_id: userId ?? "me",
        recipient_id: activeContactId ?? "",
        sent_at: nowIso,
        delivery_state: "sending",
        content: {
          type: "attachment",
          filename,
          mime_type: "application/octet-stream",
          size_bytes: 0,
          content_hash: "",
          storage_ref: "",
          attachment_key: "",
        },
        is_outgoing: true,
        chain_link: "",
        ratchet_n: 0,
      };
      appendMessage(sessionId, optimistic);

      console.log("[secure-channel] sending attachment", { sessionId, filename });
      const msg = await sendAttachment(sessionId, filePath);
      replaceMessage(sessionId, tempId, { ...msg, delivery_state: "delivered" });
      console.log("[secure-channel] attachment accepted by relay", { sessionId, messageId: msg.id });
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const lower = rawMsg.toLowerCase();
      let displayMsg = (lower.includes("token refresh") || lower.includes("not authenticated"))
        ? "Session expired. Please log out and log back in."
        : rawMsg;
      if (lower.includes("relay send failed") && lower.includes("401") && lower.includes("invalid token")) {
        displayMsg = "Relay rejected auth token. Ensure IDS and Relay share the same JWT secret (JWT_SECRET / IDS_JWT_SECRET / RLY_JWT_SECRET), then restart IDS + RLY and log in again.";
      }
      setError(displayMsg);
      if (optimisticId) setMessageDeliveryState(sessionId, optimisticId, "failed");
    } finally {
      setAttachSending(false);
    }
  };

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newBody = body.slice(0, start) + emoji + body.slice(end);
      setBody(newBody);
      // Set cursor after emoji
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + emoji.length;
        ta.focus();
      });
    } else {
      setBody(body + emoji);
    }
  };

  const handleSend = async () => {
    const text = body.trim();
    if (!text || !sessionId || disabled || isOverLimit) return;

    // ── Slash command execution ──
    if (text.startsWith("/")) {
      const ctx = {
        userId: userId ?? "",
        username: username ?? "me",
        serverId: undefined,
        channelId: undefined,
        sessionId,
        userPermissions: 0,
        userRoles: [] as string[],
        isOwner: false,
        isAdmin: false,
      };
      const result = await commandStore.execute(text, ctx);
      if (result) {
        if (!result.ephemeral) {
          // Non-ephemeral command results are sent as regular messages
          const resultText = result.message;
          setSending(true);
          setError(null);
          setBody("");
          const nowIso = new Date().toISOString();
          const tempId = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const optimistic: MessageDto = {
            id: tempId, session_id: sessionId, sender_id: userId ?? "me",
            recipient_id: activeContactId ?? "", sent_at: nowIso,
            delivery_state: "sending", content: { type: "text", body: resultText },
            is_outgoing: true, chain_link: "", ratchet_n: 0,
          };
          appendMessage(sessionId, optimistic);
          try {
            const msg = await sendMessage(sessionId, resultText);
            replaceMessage(sessionId, tempId, { ...msg, delivery_state: "delivered" });
          } catch {
            setMessageDeliveryState(sessionId, tempId, "failed");
          } finally {
            setSending(false);
          }
        }
        setBody("");
        commandStore.closeMenu();
        return;
      }
    }

    setSending(true);
    setError(null);
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
      console.log("[secure-channel] sending message", { sessionId, tempId, length: text.length });
      const msg = await sendMessage(sessionId, text);
      replaceMessage(sessionId, tempId, { ...msg, delivery_state: "delivered" });
      console.log("[secure-channel] message accepted by relay", { sessionId, messageId: msg.id });
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const lower = rawMsg.toLowerCase();

      // Token refresh failure means the session expired — guide the user
      let displayMsg = (lower.includes("token refresh") || lower.includes("not authenticated"))
        ? "Session expired. Please log out and log back in to resume messaging."
        : rawMsg;

      // Relay 401 Invalid token usually means IDS/RLY JWT secrets don't match.
      if (lower.includes("relay send failed") && lower.includes("401") && lower.includes("invalid token")) {
        displayMsg = "Relay rejected auth token. Ensure IDS and Relay share the same JWT secret (JWT_SECRET / IDS_JWT_SECRET / RLY_JWT_SECRET), then restart IDS + RLY and log in again.";
      }
      console.error("Send failed:", rawMsg);
      setError(displayMsg);
      setMessageDeliveryState(sessionId, tempId, "failed");
      setBody(text); // restore on failure
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash command navigation
    if (commandStore.menuOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); commandStore.moveHighlight("down"); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); commandStore.moveHighlight("up"); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        commandStore.selectSuggestion();
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); commandStore.closeMenu(); return; }
    }

    // Markdown shortcuts (Ctrl+B, Ctrl+I, Ctrl+E for code)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      if (e.key === "b") { e.preventDefault(); wrapSelection("**", "**"); return; }
      if (e.key === "i") { e.preventDefault(); wrapSelection("*", "*"); return; }
      if (e.key === "e") { e.preventDefault(); wrapSelection("`", "`"); return; }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="message-input-wrapper">
      {/* Slash command autocomplete overlay */}
      <SlashCommandMenu bottomOffset={56} />

      {/* Error banner */}
      {error && (
        <div className="message-input__error">
          <AlertCircle size={14} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="message-input__error-close">✕</button>
        </div>
      )}

      {/* Markdown toolbar (toggle with Hash icon) */}
      {showMarkdownBar && (
        <div className="message-input__markdown-bar">
          <button onClick={() => wrapSelection("**", "**")} title="Bold (Ctrl+B)" className="message-input__md-btn"><Bold size={14} /></button>
          <button onClick={() => wrapSelection("*", "*")} title="Italic (Ctrl+I)" className="message-input__md-btn"><Italic size={14} /></button>
          <button onClick={() => wrapSelection("~~", "~~")} title="Strikethrough" className="message-input__md-btn"><Strikethrough size={14} /></button>
          <button onClick={() => wrapSelection("`", "`")} title="Code (Ctrl+E)" className="message-input__md-btn"><Code size={14} /></button>
          <button onClick={() => wrapSelection("||", "||")} title="Spoiler" className="message-input__md-btn" style={{ fontSize: 11, fontWeight: 700 }}>S</button>
          <button onClick={() => wrapSelection("```\n", "\n```")} title="Code Block" className="message-input__md-btn" style={{ fontSize: 10 }}>{"{ }"}</button>
          <button onClick={() => wrapSelection("> ", "")} title="Quote" className="message-input__md-btn" style={{ fontSize: 13, fontWeight: 700 }}>❝</button>
        </div>
      )}

      <div className="relative" ref={emojiRef}>
        <MessageComposerBar
          disabled={disabled || attachSending}
          onAttach={handleAttach}
          onHash={() => setShowMarkdownBar(!showMarkdownBar)}
          onEmoji={() => setShowEmoji(!showEmoji)}
          hashActive={showMarkdownBar}
          rightSlot={body.trim() && (
            <button
              onClick={handleSend}
              disabled={sending || disabled || isOverLimit}
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
            placeholder={
              disabled
                ? disabledReason ?? "Messaging disabled"
                : `Message ${contactName ?? "..."}`
            }
            disabled={disabled}
            rows={1}
            className="message-input__textarea"
          />
        </MessageComposerBar>

        {/* ── Emoji Picker ─────────────────────────────────────── */}
        {showEmoji && (
          <div className="absolute bottom-12 right-0 w-[320px] bg-[#111218] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden">
            <div className="flex gap-0.5 px-2 pt-2 pb-1 overflow-x-auto scrollbar-thin">
              {Object.keys(EMOJI_CATEGORIES).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setEmojiCategory(cat)}
                  className={`px-2 py-1 text-[10px] rounded-md whitespace-nowrap transition-colors ${
                    emojiCategory === cat
                      ? "bg-white/[0.08] text-white/80"
                      : "text-white/30 hover:text-white/50 hover:bg-white/[0.04]"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-8 gap-0.5 p-2 max-h-[220px] overflow-y-auto scrollbar-thin">
              {(EMOJI_CATEGORIES[emojiCategory] ?? []).map((emoji, i) => (
                <button
                  key={`${emoji}-${i}`}
                  onClick={() => { insertEmoji(emoji); setShowEmoji(false); }}
                  className="w-9 h-9 flex items-center justify-center text-xl rounded-md hover:bg-white/[0.08] transition-colors"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Character counter (visible near limit) */}
      {charCount > MAX_MESSAGE_LENGTH * 0.8 && (
        <div className={`message-input__char-count ${isOverLimit ? "message-input__char-count--over" : ""}`}>
          {charCount}/{MAX_MESSAGE_LENGTH}
        </div>
      )}
    </div>
  );
}
