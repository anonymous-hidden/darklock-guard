/**
 * MessageItem — Single message row, Discord-style (avatar + name + timestamp).
 * Hover actions: Reply, Edit (own), Delete (own), Copy, Pin, Forward, React.
 * Supports: reactions display, thread indicators, markdown rendering.
 */
import { useState } from "react";
import {
  Reply,
  Pencil,
  Trash2,
  Copy,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  FileText,
  Download,
  Pin,
  Forward,
  Smile,
  MessageSquare,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import clsx from "clsx";

import type { MessageDto } from "@/types";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import ReactionBar, { type Reaction } from "@/components/ReactionBar";
import InviteEmbed from "@/components/InviteEmbed";

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

interface MessageItemProps {
  message: MessageDto;
  /** Whether to show avatar + name (false for consecutive messages from same sender) */
  showHeader: boolean;
  /** Display name of the sender */
  senderName: string;
  onReply?: (msg: MessageDto) => void;
  onEdit?: (msg: MessageDto) => void;
  onDelete?: (msg: MessageDto) => void;
  onPin?: (msg: MessageDto) => void;
  onForward?: (msg: MessageDto) => void;
  onReact?: (msg: MessageDto) => void;
  /** Reactions on this message */
  reactions?: Reaction[];
  /** Toggle reaction handler */
  onToggleReaction?: (emoji: string) => void;
  /** Thread reply count */
  threadCount?: number;
  /** Open thread handler */
  onOpenThread?: (msg: MessageDto) => void;
  /** Whether this message has been edited */
  edited?: boolean;
}

export default function MessageItem({
  message,
  showHeader,
  senderName,
  onReply,
  onEdit,
  onDelete,
  onPin,
  onForward,
  onReact,
  reactions = [],
  onToggleReaction,
  threadCount,
  onOpenThread,
  edited,
}: MessageItemProps) {
  const [hovering, setHovering] = useState(false);
  const [copied, setCopied] = useState(false);

  const content = message.content;
  let textBody = "";
  if (content.type === "text") textBody = content.body;
  else if (content.type === "attachment") textBody = `📎 ${content.filename}`;
  else if (content.type === "group_invite") textBody = `Invite: ${content.group_name}`;
  else textBody = `[${content.type}]`;

  const isImage = content.type === "attachment" &&
    content.mime_type?.startsWith("image/");

  /** Download attachment: decode base64 storage_ref → Blob → download. */
  const handleDownload = () => {
    if (content.type !== "attachment" || !content.storage_ref) return;
    try {
      const raw = atob(content.storage_ref.replace(/-/g, "+").replace(/_/g, "/"));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const blob = new Blob([bytes], { type: content.mime_type ?? "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = content.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      console.error("Download failed");
    }
  };

  /** Build a data URL for image preview from base64 storage_ref. */
  const imageDataUrl = isImage && content.storage_ref
    ? `data:${content.mime_type};base64,${content.storage_ref.replace(/-/g, "+").replace(/_/g, "/")}`
    : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  };

  const timeStr = formatTime(message.sent_at);
  const fullTime = formatFull(message.sent_at);

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
      {/* Avatar column */}
      <div className="message-item__gutter">
        {showHeader ? (
          <div className="message-item__avatar">
            <span>{senderName.charAt(0).toUpperCase()}</span>
          </div>
        ) : (
          <span className="message-item__timestamp-hover" title={fullTime}>
            {timeStr}
          </span>
        )}
      </div>

      {/* Content column */}
      <div className="message-item__content">
        {showHeader && (
          <div className="message-item__header">
            <span className="message-item__author">{senderName}</span>
            <span className="message-item__time" title={fullTime}>{fullTime}</span>
            {message.is_outgoing && (
              <span className="message-item__delivery" title={DELIVERY_LABELS[message.delivery_state] ?? message.delivery_state}>
                {DELIVERY_ICONS[message.delivery_state]}
                <span className="ml-1 text-[10px] text-dl-muted">
                  {DELIVERY_LABELS[message.delivery_state] ?? message.delivery_state}
                </span>
              </span>
            )}
          </div>
        )}
        <div className="message-item__body">
          {content.type === "text" && <MarkdownRenderer content={textBody} />}
          {content.type === "group_invite" && (
            <InviteEmbed inviteCode={content.invite_token} />
          )}
          {edited && <span className="message-item__edited">(edited)</span>}

          {content.type === "attachment" && (
            <div className="message-item__attachment">
              {/* Image preview */}
              {imageDataUrl ? (
                <div className="message-item__attachment-image">
                  <img
                    src={imageDataUrl}
                    alt={content.filename}
                    className="max-w-[300px] max-h-[300px] rounded-lg object-contain cursor-pointer"
                    onClick={handleDownload}
                  />
                </div>
              ) : (
                <div
                  className="flex items-center gap-3 bg-white/[0.04] rounded-lg p-3 cursor-pointer hover:bg-white/[0.06] transition-colors max-w-[320px]"
                  onClick={handleDownload}
                >
                  <div className="w-10 h-10 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                    <FileText size={20} className="text-white/40" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-dl-accent truncate">{content.filename}</p>
                    <p className="text-[10px] text-white/30">
                      {formatBytes(content.size_bytes)} • {content.mime_type}
                    </p>
                  </div>
                  <Download size={16} className="text-white/30 shrink-0" />
                </div>
              )}
              {/* Filename below image */}
              {imageDataUrl && (
                <p className="text-[11px] text-white/30 mt-1">{content.filename} • {formatBytes(content.size_bytes)}</p>
              )}
            </div>
          )}

          {content.type !== "text" && content.type !== "attachment" && (
            <span className="text-white/30 italic">[{content.type}]</span>
          )}
        </div>

        {/* Reactions */}
        {reactions.length > 0 && onToggleReaction && (
          <ReactionBar
            reactions={reactions}
            onToggle={onToggleReaction}
            onAddReaction={onReact ? () => onReact(message) : undefined}
          />
        )}

        {/* Thread indicator */}
        {threadCount != null && threadCount > 0 && onOpenThread && (
          <button
            className="message-item__thread-indicator"
            onClick={() => onOpenThread(message)}
          >
            <MessageSquare size={14} />
            <span>{threadCount} repl{threadCount === 1 ? "y" : "ies"}</span>
          </button>
        )}

        {!showHeader && message.is_outgoing && (
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-dl-muted">
            {DELIVERY_ICONS[message.delivery_state]}
            <span>{DELIVERY_LABELS[message.delivery_state] ?? message.delivery_state}</span>
          </div>
        )}
      </div>

      {/* Hover action buttons */}
      {hovering && (
        <div className="message-item__actions">
          {onReact && (
            <button
              onClick={() => onReact(message)}
              className="message-item__action-btn"
              title="Add Reaction"
            >
              <Smile size={16} />
            </button>
          )}
          {onReply && (
            <button
              onClick={() => onReply(message)}
              className="message-item__action-btn"
              title="Reply"
            >
              <Reply size={16} />
            </button>
          )}
          {onForward && (
            <button
              onClick={() => onForward(message)}
              className="message-item__action-btn"
              title="Forward"
            >
              <Forward size={16} />
            </button>
          )}
          {onPin && (
            <button
              onClick={() => onPin(message)}
              className="message-item__action-btn"
              title="Pin Message"
            >
              <Pin size={16} />
            </button>
          )}
          {message.is_outgoing && onEdit && content.type === "text" && (
            <button
              onClick={() => onEdit(message)}
              className="message-item__action-btn"
              title="Edit"
            >
              <Pencil size={16} />
            </button>
          )}
          <button
            onClick={handleCopy}
            className="message-item__action-btn"
            title={copied ? "Copied!" : "Copy"}
          >
            {copied ? <Check size={16} className="text-dl-success" /> : <Copy size={16} />}
          </button>
          {message.is_outgoing && onDelete && (
            <button
              onClick={() => onDelete(message)}
              className="message-item__action-btn message-item__action-btn--danger"
              title="Delete"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Date separator (used between message groups) ──────────────────────────── */

export function DateSeparator({ date }: { date: string }) {
  let label: string;
  try {
    label = format(parseISO(date), "MMMM d, yyyy");
  } catch {
    label = date;
  }
  return (
    <div className="message-date-separator">
      <div className="message-date-separator__line" />
      <span className="message-date-separator__label">{label}</span>
      <div className="message-date-separator__line" />
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return format(parseISO(iso), "HH:mm");
  } catch {
    return "";
  }
}

function formatFull(iso: string): string {
  try {
    return format(parseISO(iso), "MM/dd/yyyy HH:mm");
  } catch {
    return "";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
