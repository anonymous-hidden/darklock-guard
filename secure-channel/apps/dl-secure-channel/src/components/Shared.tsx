/* ──────────────────────────────────────────────────────────
 *  Shared UI components — Button, Input, Modal, Avatar,
 *  Badge, Spinner, Tooltip
 * ────────────────────────────────────────────────────────── */

import React, { useState, useRef, useEffect, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import './Shared.css';

/* ── Button ────────────────────────────────────────────── */

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary', size = 'md', loading, icon,
  children, disabled, className = '', ...props
}: ButtonProps) {
  return (
    <button
      className={`dl-btn dl-btn--${variant} dl-btn--${size} ${loading ? 'dl-btn--loading' : ''} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="dl-btn__spinner" />}
      {!loading && icon && <span className="dl-btn__icon">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
}

/* ── Input ─────────────────────────────────────────────── */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, rightIcon, className = '', ...props }, ref) => (
    <div className={`dl-input-wrap ${error ? 'dl-input-wrap--error' : ''} ${className}`}>
      {label && <label className="dl-input-label">{label}</label>}
      <div className="dl-input-container">
        {icon && <span className="dl-input-icon dl-input-icon--left">{icon}</span>}
        <input ref={ref} className={`dl-input ${icon ? 'dl-input--with-icon' : ''} ${rightIcon ? 'dl-input--with-right-icon' : ''}`} {...props} />
        {rightIcon && <span className="dl-input-icon dl-input-icon--right">{rightIcon}</span>}
      </div>
      {error && <span className="dl-input-error">{error}</span>}
    </div>
  ),
);

/* ── TextArea ──────────────────────────────────────────── */

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  onSubmit?: () => void;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ onSubmit, className = '', ...props }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    };
    return (
      <textarea
        ref={ref}
        className={`dl-textarea ${className}`}
        onKeyDown={handleKeyDown}
        {...props}
      />
    );
  },
);

/* ── Avatar ────────────────────────────────────────────── */

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
  online?: boolean;
  statusColor?: string;
  style?: CSSProperties;
}

function stringToColor(str: string): string {
  const colors = [
    '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444',
    '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export function Avatar({ name, src, size = 40, online, statusColor, style }: AvatarProps) {
  const trimmed = (name || '').trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const initials = words.length >= 2
    ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
    : trimmed.slice(0, 2).toUpperCase();

  return (
    <div className="dl-avatar" style={{ width: size, height: size, ...style }}>
      <div
        className="dl-avatar__inner"
        style={src ? undefined : { backgroundColor: stringToColor(trimmed || 'default'), fontSize: size * 0.38 }}
      >
        {src
          ? <img src={src} alt={name} className="dl-avatar__img" />
          : initials
        }
      </div>
      {statusColor ? (
        <span className="dl-avatar__status" style={{ background: statusColor }} />
      ) : online !== undefined ? (
        <span className={`dl-avatar__status ${online ? 'dl-avatar__status--online' : 'dl-avatar__status--offline'}`} />
      ) : null}
    </div>
  );
}

/* ── Badge ─────────────────────────────────────────────── */

interface BadgeProps {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'encrypted';
  children: ReactNode;
  icon?: ReactNode;
}

export function Badge({ variant = 'default', children, icon }: BadgeProps) {
  return (
    <span className={`dl-badge dl-badge--${variant}`}>
      {icon && <span className="dl-badge__icon">{icon}</span>}
      {children}
    </span>
  );
}

/* ── Spinner ───────────────────────────────────────────── */

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg className="dl-spinner" width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="60" strokeLinecap="round" />
    </svg>
  );
}

/* ── Modal ─────────────────────────────────────────────── */

interface ModalProps {
  open?: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Modal({ open = true, onClose, title, children, footer, width = 440 }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useRef(`dl-modal-title-${Math.random().toString(36).slice(2, 9)}`).current;

  useEffect(() => {
    if (!open) return;
    // Remember what had focus before the modal opened so we can restore it on close.
    previousFocus.current = document.activeElement as HTMLElement | null;

    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);

    // Focus trap — keep Tab / Shift-Tab inside the modal.
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return;
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', trap);

    // Autofocus the first focusable element inside the modal.
    queueMicrotask(() => {
      const first = modalRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    });

    return () => {
      window.removeEventListener('keydown', handleEsc);
      window.removeEventListener('keydown', trap);
      // Restore focus to whatever opened the modal (handles keyboard-only users).
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="dl-modal-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="dl-modal dl-animate-slideUp"
        style={{ maxWidth: width }}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dl-modal__header">
          <h2 className="dl-modal__title" id={titleId}>{title}</h2>
          <button className="dl-modal__close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="dl-modal__body">{children}</div>
        {footer && <div className="dl-modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* ── Tooltip ───────────────────────────────────────────── */

interface TooltipProps {
  text: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ text, children, position = 'top' }: TooltipProps) {
  const [show, setShow] = useState(false);
  return (
    <div
      className="dl-tooltip-wrap"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && <div className={`dl-tooltip dl-tooltip--${position}`}>{text}</div>}
    </div>
  );
}

/* ── PasswordStrength ──────────────────────────────────── */

export function PasswordStrength({ password }: { password: string }) {
  const getStrength = (pw: string) => {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (pw.length >= 16) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    return Math.min(score, 5);
  };

  const strength = getStrength(password);
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  const colors = ['', 'var(--dl-danger)', 'var(--dl-warning)', 'var(--dl-info)', 'var(--dl-success)', 'var(--dl-encrypted)'];

  if (!password) return null;

  return (
    <div className="dl-pw-strength">
      <div className="dl-pw-strength__bars">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="dl-pw-strength__bar"
            style={{ backgroundColor: i <= strength ? colors[strength] : 'var(--dl-bg-active)' }}
          />
        ))}
      </div>
      <span className="dl-pw-strength__label" style={{ color: colors[strength] }}>
        {labels[strength]}
      </span>
    </div>
  );
}

/* ── TypingIndicator ───────────────────────────────────── */

export function TypingIndicator({ name }: { name: string }) {
  return (
    <div className="dl-typing">
      <span className="dl-typing__dots">
        <span className="dl-typing__dot" />
        <span className="dl-typing__dot" />
        <span className="dl-typing__dot" />
      </span>
      <span className="dl-typing__text">{name} is typing</span>
    </div>
  );
}

/* ── EncryptionIndicator ───────────────────────────────── */

export function EncryptionIndicator({ verified }: { verified?: boolean }) {
  return (
    <span className={`dl-encryption-indicator ${verified ? 'dl-encryption-indicator--verified' : ''}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <span>E2E</span>
    </span>
  );
}

/* ── ConfirmDialog ─────────────────────────────────────── */
/* Phase 05: in-app replacement for window.confirm() with
   proper theming, focus, destructive-action styling. */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="dl-confirm-message">{message}</p>
    </Modal>
  );
}
