/* ──────────────────────────────────────────────────────────
 *  AvatarWithStatus — reusable avatar + custom status badge
 *
 *  Single source of truth for avatar + status rendering.
 *  Shows presence dot + custom status emoji/text adjacent
 *  to the avatar. Clicking the status opens an inline
 *  edit popover (own profile only).
 * ────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect } from 'react';
import { useProfileStore, PRESENCE_COLORS, type PresenceStatus } from '../stores/profileStore';
import { Avatar, Input } from './Shared';
import { X } from './Icons';
import './AvatarWithStatus.css';

interface AvatarWithStatusProps {
  /** User display name (for initials fallback) */
  name: string;
  /** Avatar image URL */
  avatarUrl?: string | null;
  /** Custom status text (from remote profile or own) */
  statusText?: string;
  /** Custom status emoji */
  statusEmoji?: string;
  /** Presence color override (pass for remote users) */
  statusColor?: string;
  /** Presence status (for own profile — derives color) */
  presence?: PresenceStatus;
  /** Avatar diameter in px */
  size?: number;
  /** Online indicator (for remote users without presence data) */
  online?: boolean;
  /** Allow editing status on click (only for own avatar) */
  editable?: boolean;
  /** Additional class names */
  className?: string;
}

export function AvatarWithStatus({
  name,
  avatarUrl,
  statusText,
  statusEmoji,
  statusColor,
  presence,
  size = 40,
  online,
  editable = false,
  className = '',
}: AvatarWithStatusProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const resolvedColor = statusColor ?? (presence ? PRESENCE_COLORS[presence] : undefined);
  const hasStatus = !!(statusEmoji || statusText);

  // Close popover on outside click / Escape
  useEffect(() => {
    if (!popoverOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false);
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [popoverOpen]);

  return (
    <div
      ref={wrapRef}
      className={`avatar-status ${className}`}
      style={{ '--avatar-size': `${size}px` } as React.CSSProperties}
    >
      <div className="avatar-status__avatar">
        <Avatar
          name={name}
          src={avatarUrl}
          size={size}
          online={online}
          statusColor={resolvedColor}
        />
        {/* Custom status emoji badge overlaid on avatar */}
        {hasStatus && (
          <button
            className="avatar-status__badge"
            onClick={editable ? (e) => { e.stopPropagation(); setPopoverOpen(v => !v); } : undefined}
            style={editable ? { cursor: 'pointer' } : { cursor: 'default', pointerEvents: 'none' }}
            title={statusText || undefined}
          >
            {statusEmoji || '💬'}
          </button>
        )}
        {/* If no status but editable, show a subtle add-status dot */}
        {!hasStatus && editable && (
          <button
            className="avatar-status__badge avatar-status__badge--add"
            onClick={(e) => { e.stopPropagation(); setPopoverOpen(v => !v); }}
            title="Set a status"
          >
            +
          </button>
        )}
      </div>

      {/* Status text next to avatar (only at larger sizes) */}
      {hasStatus && size >= 36 && (
        <span
          className="avatar-status__text"
          onClick={editable ? (e) => { e.stopPropagation(); setPopoverOpen(v => !v); } : undefined}
          style={editable ? { cursor: 'pointer' } : undefined}
        >
          {statusEmoji && <span className="avatar-status__emoji">{statusEmoji}</span>}
          {statusText && <span className="avatar-status__label">{statusText}</span>}
        </span>
      )}

      {/* Inline edit popover */}
      {editable && popoverOpen && (
        <StatusEditPopover onClose={() => setPopoverOpen(false)} />
      )}
    </div>
  );
}

/* ── Inline Status Edit Popover ─────────────────────────── */

const QUICK_EMOJIS = ['😊', '🎮', '💻', '🎵', '📚', '🏃', '☕', '🌙', '🔥', '💀', '🤔', '❤️'];

function StatusEditPopover({ onClose }: { onClose: () => void }) {
  const statusText = useProfileStore(s => s.statusText);
  const statusEmoji = useProfileStore(s => s.statusEmoji);
  const setStatusText = useProfileStore(s => s.setStatusText);
  const setStatusEmoji = useProfileStore(s => s.setStatusEmoji);

  const [text, setText] = useState(statusText);
  const [emoji, setEmoji] = useState(statusEmoji || '😊');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSave = () => {
    setStatusText(text.slice(0, 128));
    setStatusEmoji(emoji);
    onClose();
  };

  const handleClear = () => {
    setStatusText('');
    setStatusEmoji('');
    onClose();
  };

  return (
    <div className="status-popover" onClick={e => e.stopPropagation()}>
      <div className="status-popover__header">
        <span className="status-popover__title">Set Custom Status</span>
        <button className="status-popover__close" onClick={onClose}><X size={14} /></button>
      </div>

      <div className="status-popover__emoji-row">
        <button className="status-popover__current-emoji">{emoji}</button>
        <Input
          ref={inputRef}
          placeholder="What are you up to?"
          value={text}
          onChange={e => setText(e.target.value.slice(0, 128))}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          maxLength={128}
        />
      </div>

      <div className="status-popover__quick-emojis">
        {QUICK_EMOJIS.map(e => (
          <button
            key={e}
            className={`status-popover__emoji-btn ${emoji === e ? 'status-popover__emoji-btn--active' : ''}`}
            onClick={() => setEmoji(e)}
          >
            {e}
          </button>
        ))}
      </div>

      <div className="status-popover__actions">
        {(statusText || statusEmoji) && (
          <button className="status-popover__clear" onClick={handleClear}>Clear Status</button>
        )}
        <button className="status-popover__save" onClick={handleSave}>Save</button>
      </div>
    </div>
  );
}
