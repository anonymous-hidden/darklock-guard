import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import * as ws from '../net/wsClient';
import { useSettingsStore } from '../stores/settingsStore';
import { useProfileStore, PRESENCE_COLORS } from '../stores/profileStore';
import { useSwipeBack } from '../hooks/useMobileGestures';
import {
  useConvThemeStore,
  CONV_THEME_DEFAULTS,
  BUBBLE_RADII,
  FONT_SIZES,
  BORDER_STYLE_DEFS,
  computeBgStyle,
  hexToRgb,
  type MsgDensity,
  type MsgBorderStyle,
  type MsgBorderOptions,
} from '../stores/convThemeStore';
import {
  Send, Paperclip, Mic, Lock, Timer, Trash, Edit, Copy, Reply,
  Smile, Check, CheckDouble, ArrowLeft, Users,
  Shield, ShieldCheck, AlertTriangle, Fingerprint, Palette,
  Download, Image, X, Key, Eye, EyeOff, Camera, Settings,
  Phone, Video, Hash, MoreVertical,
} from './Icons';
import ridgelineScImg from '../assets/ridgeline-sc.png';

const RidgelineScIcon = ({ size, className }: { size?: number; className?: string }) => (
  <img src={ridgelineScImg} width={size} height={size} className={className} style={{ objectFit: 'contain', display: 'block' }} />
);
import { Avatar, Badge, TypingIndicator, EncryptionIndicator, Modal, ConfirmDialog } from './Shared';
import { AvatarWithStatus } from './AvatarWithStatus';
import { ConvPersonalize } from './ConvPersonalize';
import { ConvSecurity } from './ConvSecurity';
import { CameraCapture } from './CameraCapture';
import { LockScreenSettings } from './LockScreenSettings';
import { useLockScreenStore, type LockIconStyle } from '../stores/lockScreenStore';
import { FriendsHome } from './FriendsHome';
import { EmojiPicker } from './EmojiPicker';
import { useConvSecurityStore, verifyPin } from '../stores/convSecurityStore';
import { useCallStore } from '../stores/callStore';
import { setUpdateRestartSafety } from '../stores/updateStore';
import { CallOverlay } from './CallOverlay';
import { TAG_MAP } from '../stores/tagStore';
import type { Message, Attachment } from '../types';
import {
  generateAttachmentKey,
  encryptAttachment,
  decryptAttachment,
  readFileAsArrayBuffer,
  toObjectUrl,
} from '../crypto/attachmentCrypto';
import {
  confirmPeerIdentity,
  encryptPayload,
  getPeerVerificationDisplay,
  recipientHasNoBundle,
  recipientRequiresVerification,
  type PeerVerificationDisplay,
} from '../crypto/e2eeSessions';
import {
  GROUP_MESSAGING_CONTAINMENT_NOTICE,
  RIDGELINE_SECURITY_CAPABILITIES,
} from '@darklock/ridgeline-security-capabilities';
import { makeGroupChannelConversationId, parseGroupChannelConversationId } from '../utils/groupChannelKeys';
import { resolveGroupPermissions } from '../utils/groupPermissions';
import { evaluateModeration, getGroupModeration, hasModerationExemption } from '../utils/groupModeration';
import { getConversationSecurityUi } from '../security/securityClaims';
import './ChatView.css';

/* ── Spoiler text parser — ||spoiler|| syntax ────────────── */
const SPOILER_RE = /\|\|(.+?)\|\|/g;

function SpoilerSpan({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`chat-msg__spoiler${revealed ? ' chat-msg__spoiler--revealed' : ''}`}
      onClick={() => setRevealed(r => !r)}
    >
      {text}
    </span>
  );
}

const IMAGE_URL_RE = /\.(gif|png|jpe?g|webp)(\?[^\s]*)?$/i;
const TENOR_GIPHY_RE = /^https:\/\/((?:media\d*|c)\.tenor\.com|(?:media\d*|i)\.giphy\.com)\//i;

const COMPOSER_EMOJI_SUGGESTIONS = [
  { name: 'smile', emoji: '\u{1F604}' },
  { name: 'laugh', emoji: '\u{1F602}' },
  { name: 'heart', emoji: '\u{2764}\u{FE0F}' },
  { name: 'thumbsup', emoji: '\u{1F44D}' },
  { name: 'fire', emoji: '\u{1F525}' },
  { name: 'eyes', emoji: '\u{1F440}' },
  { name: 'thinking', emoji: '\u{1F914}' },
  { name: 'party', emoji: '\u{1F389}' },
];

function getComposerEmojiSuggestions(value: string) {
  const match = /:([a-z0-9_-]{1,20})$/i.exec(value);
  if (!match) return [];
  const query = match[1].toLowerCase();
  return COMPOSER_EMOJI_SUGGESTIONS
    .filter(item => item.name.startsWith(query))
    .slice(0, 4);
}

function renderMsgContent(content: string): React.ReactNode {
  // Detect raw E2EE envelope blobs that failed to decrypt
  if (content.startsWith('{"e2ee":true,') || content.startsWith('{\"e2ee\":true,')) {
    return <em style={{ opacity: 0.6 }}>🔒 This message is encrypted and cannot be decrypted on this device.</em>;
  }
  // Combined regex: spoilers ||text|| and URLs
  const TOKEN_RE = /(\|\|.+?\|\|)|(https?:\/\/[^\s]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(content)) !== null) {
    if (match.index > lastIdx) {
      parts.push(content.slice(lastIdx, match.index));
    }
    if (match[1]) {
      // Spoiler
      const inner = match[1].slice(2, -2);
      parts.push(<SpoilerSpan key={`s${match.index}`} text={inner} />);
    } else if (match[2]) {
      const url = match[2];
      if (IMAGE_URL_RE.test(url) || TENOR_GIPHY_RE.test(url)) {
        // Inline image / GIF
        parts.push(
          <img key={`i${match.index}`} src={url} alt="image"
            className="chat-msg__inline-img"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              // Fallback: show as link if image fails
              const a = document.createElement('a');
              a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
              a.textContent = url; a.className = 'chat-msg__link';
              (e.target as HTMLElement).replaceWith(a);
            }}
          />
        );
      } else {
        // Regular URL — render as clickable link
        parts.push(
          <a key={`a${match.index}`} href={url} target="_blank" rel="noopener noreferrer"
            className="chat-msg__link">{url}</a>
        );
      }
    }
    lastIdx = TOKEN_RE.lastIndex;
  }
  if (lastIdx < content.length) parts.push(content.slice(lastIdx));
  return parts.length > 0 ? parts : content;
}

function getConversationMembers(conversation: { participantIds?: string[]; members?: string[] } | null | undefined): string[] {
  if (!conversation) return [];
  if (Array.isArray(conversation.participantIds)) return conversation.participantIds;
  if (Array.isArray(conversation.members)) return conversation.members;
  return [];
}

/* ── Lightbox for viewing images fullscreen ──────────────── */
function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}><X size={24} /></button>
      <img src={src} alt={alt} className="lightbox-img" onClick={e => e.stopPropagation()} />
    </div>
  );
}

/* ── Inline attachment viewer with lazy decryption ──────── */
function AttachmentBubble({ attachment: att, onImageClick }: { attachment: Attachment; onImageClick?: (src: string, alt: string) => void }) {
  const isImage = att.mimeType.startsWith('image/');
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
  const [decryptState, setDecryptState] = useState<'idle' | 'busy' | 'failed'>('idle');
  // Use refs for guards so they don't trigger re-renders or useCallback invalidation
  const inProgress = useRef(false);
  const failedRef = useRef(false);

  const decrypt = useCallback(async () => {
    if (inProgress.current || decryptedUrl || failedRef.current) return;
    inProgress.current = true;
    setDecryptState('busy');
    try {
      let cipher: ArrayBuffer;
      try {
        // Try the in-memory blob URL first (valid within current session)
        const resp = await fetch(att.encryptedUrl);
        if (!resp.ok) throw new Error('dead blob URL');
        cipher = await resp.arrayBuffer();
      } catch {
        // Blob URL is dead (app restarted). Fall back to persisted base64 encrypted data.
        const b64 = useChatStore.getState().attachmentData[att.id];
        if (!b64) throw new Error('no stored attachment data');
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        cipher = bytes.buffer;
      }
      const plain = await decryptAttachment(cipher, att.key, att.nonce);
      setDecryptedUrl(toObjectUrl(plain, att.mimeType));
      setDecryptState('idle');
    } catch {
      failedRef.current = true;
      setDecryptState('failed');
    }
    inProgress.current = false;
  }, [att.id, att.encryptedUrl, att.key, att.nonce, att.mimeType, decryptedUrl]);

  // Auto-decrypt images once on mount (ref guard prevents infinite retries on failure)
  useEffect(() => { if (isImage) decrypt(); }, [isImage, decrypt]);

  const handleDownload = () => decrypt();

  useEffect(() => {
    if (!isImage && decryptedUrl) {
      const a = document.createElement('a');
      a.href = decryptedUrl;
      a.download = att.name;
      a.click();
    }
  }, [decryptedUrl, isImage, att.name]);

  const sizeLabel = att.size < 1024 ? `${att.size} B`
    : att.size < 1048576 ? `${(att.size / 1024).toFixed(1)} KB`
    : `${(att.size / 1048576).toFixed(1)} MB`;

  const statusLabel = decryptState === 'busy' ? 'Decrypting\u2026' : decryptState === 'failed' ? 'Unavailable' : null;

  if (isImage) {
    return (
      <div className="chat-msg__img-attach">
        {decryptedUrl
          ? <img src={decryptedUrl} alt={att.name} style={{ cursor: 'pointer' }} onClick={() => onImageClick?.(decryptedUrl, att.name)} />
          : <div className="chat-msg__img-placeholder">{statusLabel ?? <Image size={24} />}</div>
        }
        <span className="chat-msg__encrypt-badge"><Lock size={10} /> Encrypted</span>
      </div>
    );
  }

  return (
    <div className="chat-msg__file-attach">
      <Paperclip size={18} />
      <div className="chat-msg__file-info">
        <span className="chat-msg__file-name">{att.name}</span>
        <span className="chat-msg__file-size">{sizeLabel} &middot; <Lock size={10} /> Encrypted</span>
      </div>
      <button className="chat-msg__file-dl" onClick={handleDownload} disabled={decryptState === 'busy'} aria-label={`Download ${att.name}`}>
        <Download size={16} />
      </button>
    </div>
  );
}

export function ChatView() {
  const activeId = useChatStore(s => s.activeConversation);
  const conversations = useChatStore((s) => s.conversations ?? {});
  const messages = useChatStore((s) => s.messages ?? {});
  const contacts = useChatStore((s) => s.contacts ?? {});
  const groups = useChatStore((s) => s.groups ?? {});
  const activeGroupId = useChatStore(s => s.activeGroupId);
  const activeChannelId = useChatStore(s => s.activeChannelId);
  const sendMessage = useChatStore(s => s.sendMessage);
  const editMessage = useChatStore(s => s.editMessage);
  const deleteMessage = useChatStore(s => s.deleteMessage);
  const expireMessage = useChatStore(s => s.expireMessage);
  const addReaction = useChatStore(s => s.addReaction);
  const setActive = useChatStore(s => s.setActiveConversation);
  const userId = useAuthStore(s => s.userId);
  const setScreen = useAuthStore(s => s.setScreen);
  const _identityPubKey = useAuthStore(s => s.identityKeyPair?.publicKey);
  const noLocalKeys = !_identityPubKey || _identityPubKey.every(b => b === 0);

  // Swipe from left edge to go back to sidebar on mobile
  const handleSwipeBack = useCallback(() => setActive(null), [setActive]);
  useSwipeBack(handleSwipeBack);

  const authDisplayName = useAuthStore(s => s.displayName);
  const ownAvatar = useProfileStore(s => s.avatar);
  const remoteProfiles = useChatStore((s) => s.remoteProfiles ?? {});
  const typingUsers = useChatStore((s) => s.typingUsers ?? {});
  const setTypingUsers = useChatStore(s => s.setTypingUsers);
  const ownDisplayName = authDisplayName || userId?.slice(0, 8) || 'You';
  const showTimestamps = useSettingsStore(s => s.showTimestamps);
  const use24HourTime = useSettingsStore(s => s.use24HourTime);
  const enterToSend = useSettingsStore(s => s.enterToSend);
  const activeCall = useCallStore(s => s.activeCall);
  const startCall = useCallStore(s => s.startCall);
  const clipboardAutoClear = useSettingsStore(s => s.clipboardAutoClear);
  const clipboardClearSeconds = useSettingsStore(s => s.clipboardClearSeconds);
  const spellCheck = useSettingsStore(s => s.spellCheck);
  const emojiSuggestions = useSettingsStore(s => s.emojiSuggestions);
  const incognitoKeyboard = useSettingsStore(s => s.incognitoKeyboard);

  const activeConversationKey = (() => {
    if (!activeId) return null;
    const conversation = conversations[activeId];
    if (!conversation || conversation.type !== 'group') {
      return activeId;
    }

    const groupId = conversation.id;
    const group = groups[groupId];
    const selectedChannelId = activeGroupId === groupId
      ? (activeChannelId ?? group?.channels?.[0]?.id ?? null)
      : (group?.channels?.[0]?.id ?? null);

    return makeGroupChannelConversationId(groupId, selectedChannelId);
  })();

  const conv = activeId ? conversations[activeId] : null;
  const conversationSecurityUi = getConversationSecurityUi(conv?.type);

  // Per-conversation security settings
  const convSecStore = useConvSecurityStore();
  const activeSecurityId = activeConversationKey ?? activeId;
  const convSec = activeSecurityId ? convSecStore.get(activeSecurityId) : null;
  const convUnlocked = useConvSecurityStore(s => activeSecurityId ? s.unlocked[activeSecurityId] : false);

  // PIN lock state
  const [chatPinInput, setChatPinInput] = useState('');
  const [chatPinError, setChatPinError] = useState('');
  const [chatPinVisible, setChatPinVisible] = useState(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determine if this chat is currently locked
  const isLocked = !!(convSec?.requirePin && !convUnlocked);

  // Lock screen theme
  const lockTheme = useLockScreenStore(s => activeSecurityId ? s.getTheme(activeSecurityId) : null);

  const LOCK_ICONS: Record<LockIconStyle, typeof Lock> = { default: Lock, shield: RidgelineScIcon as unknown as typeof Lock, key: Key, fingerprint: Fingerprint, eye: Eye };

  const handleChatPinSubmit = async () => {
    if (!activeSecurityId || !convSec) return;
    const ok = await verifyPin(chatPinInput, convSec.pinHash);
    if (!ok) { setChatPinError('Incorrect PIN'); setChatPinInput(''); return; }
    setChatPinError('');
    setChatPinInput('');
    convSecStore.unlock(activeSecurityId);
  };

  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [contextMenu, setContextMenu] = useState<{ msg: Message; x: number; y: number } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showPersonalize, setShowPersonalize] = useState(false);
  const [showSecurity,    setShowSecurity]    = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const [showLockSettings, setShowLockSettings] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [pendingPreviews, setPendingPreviews] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [persDetached, setPersDetached] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [verificationDisplay, setVerificationDisplay] = useState<PeerVerificationDisplay | null>(null);
  const [confirmingIdentity, setConfirmingIdentity] = useState(false);
  const [deleteMsgConfirm, setDeleteMsgConfirm] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [showCamera, setShowCamera] = useState(false);
  const lastTypingSent = useRef(0);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const inlineEmojiSuggestions = useMemo(
    () => emojiSuggestions ? getComposerEmojiSuggestions(input) : [],
    [emojiSuggestions, input],
  );

  const insertEmojiSuggestion = (emoji: string) => {
    const match = /:([a-z0-9_-]{1,20})$/i.exec(input);
    if (!match) return;
    const next = `${input.slice(0, match.index)}${emoji} `;
    setInput(next);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    setUpdateRestartSafety({ unsavedDraft: input.trim().length > 0 || pendingFiles.length > 0 });
    return () => setUpdateRestartSafety({ unsavedDraft: false });
  }, [input, pendingFiles.length]);

  // Send typing indicator (debounced — at most once per 2 seconds)
  const emitTyping = useCallback(() => {
    if (!activeConversationKey || !userId) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 2000) return;
    lastTypingSent.current = now;
    const c = activeId ? conversations[activeId] : null;
    if (c && c.type === 'dm') {
      const recipient = getConversationMembers(c).find((memberId) => memberId !== userId);
      if (recipient) ws.sendTyping(recipient, activeConversationKey);
    } else if (c && c.type === 'group') {
      const recipients = getConversationMembers(c).filter((memberId) => memberId !== userId);
      ws.sendTyping('', activeConversationKey, recipients);
    }
  }, [activeConversationKey, activeId, userId, conversations]);

  // Voice-to-text toggle
  const toggleVoice = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recog = new SpeechRecognition();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = 'en-US';
    recognitionRef.current = recog;

    recog.onresult = (e: any) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setInput(prev => {
        // Replace interim results: keep text before voice started
        const baseText = (recog as any)._baseText ?? '';
        return baseText + (baseText ? ' ' : '') + transcript;
      });
    };

    recog.onerror = () => { setIsListening(false); recognitionRef.current = null; };
    recog.onend = () => { setIsListening(false); recognitionRef.current = null; };

    (recog as any)._baseText = input;
    recog.start();
    setIsListening(true);
  }, [isListening, input]);

  // Clean up stale typing indicators every second
  useEffect(() => {
    const iv = setInterval(() => {
      if (!activeConversationKey) return;
      const current = typingUsers[activeConversationKey];
      if (!current) return;
      const now = Date.now();
      const alive: Record<string, number> = {};
      let changed = false;
      for (const [uid, ts] of Object.entries(current)) {
        if (now - ts < 4000) alive[uid] = ts;
        else changed = true;
      }
      if (changed) setTypingUsers(activeConversationKey, alive);
    }, 1000);
    return () => clearInterval(iv);
  }, [activeConversationKey, typingUsers, setTypingUsers]);

  useEffect(() => {
    setShowMobileMore(false);
  }, [activeConversationKey]);

  // Compute who's currently typing in active conversation
  const typingNames = useMemo(() => {
    if (!activeConversationKey) return [];
    const current = typingUsers[activeConversationKey];
    if (!current) return [];
    return Object.keys(current)
      .filter(uid => uid !== userId)
      .map(uid => remoteProfiles[uid]?.displayName || contacts[uid]?.displayName || uid.slice(0, 8));
  }, [activeConversationKey, typingUsers, userId, remoteProfiles, contacts]);

  // ── Per-conversation theme (merges global → per-conv → defaults) ──
  const allThemes = useConvThemeStore(s => s.themes);
  const getConvTheme = useConvThemeStore(s => s.getTheme);
  const setConvTheme = useConvThemeStore(s => s.setTheme);
  const setGroupThemeMode = useConvThemeStore(s => s.setGroupThemeMode);
  const groupThemeMode = useConvThemeStore(s => activeConversationKey
    ? (s.groupThemeModeByConversation[activeConversationKey] ?? 'group')
    : 'group');
  const hasPersonalThemeOverride = useConvThemeStore(s => activeConversationKey
    ? Object.prototype.hasOwnProperty.call(s.themes, activeConversationKey)
    : false);
  const canUseGroupThemeMode = !!(conv?.type === 'group' && activeConversationKey);

  const convTheme = useMemo(
    () => {
      if (!activeConversationKey) return CONV_THEME_DEFAULTS;
      return getConvTheme(activeConversationKey);
    },
    [activeConversationKey, getConvTheme, allThemes, groupThemeMode],
  );

  // Build CSS custom-property map — applied on the .chat-view root
  const convStyle = useMemo((): React.CSSProperties => {
    if (!activeConversationKey) return {};
    const vars: Record<string, string> = {};
    const bg = computeBgStyle(convTheme);
    if (bg)                            vars['--conv-msgs-bg']     = bg;
    if (convTheme.ownColor !== 'default') {
      vars['--conv-own-bg']  = convTheme.ownColor;
      vars['--conv-own-pad'] = '7px 12px';
    }
    if (convTheme.ownText !== 'default') {
      vars['--conv-own-text'] = convTheme.ownText;
    }
    if (convTheme.otherColor !== 'default') {
      vars['--conv-other-bg']  = convTheme.otherColor;
      vars['--conv-other-pad'] = '7px 12px';
    }
    if (convTheme.otherText !== 'default') {
      vars['--conv-other-text'] = convTheme.otherText;
    }
    if (convTheme.bubbleStyle !== 'default') {
      const r = BUBBLE_RADII[convTheme.bubbleStyle];
      vars['--conv-own-radius']   = r.own;
      vars['--conv-other-radius'] = r.other;
    }
    if (convTheme.fontSize !== 'md')   vars['--conv-font-size']  = FONT_SIZES[convTheme.fontSize];

    // Shadow + border glow (combined into one box-shadow)
    const shadowParts: string[] = [];
    if (convTheme.shadow) shadowParts.push('0 2px 6px rgba(0,0,0,0.55)');

    // Message border style
    if (convTheme.msgBorder !== 'none') {
      const bd = BORDER_STYLE_DEFS[convTheme.msgBorder];
      if (bd.border)   vars['--conv-bubble-border']   = bd.border;
      if (bd.backdrop) vars['--conv-bubble-backdrop'] = bd.backdrop;
      if (bd.glow)     shadowParts.push(bd.glow);
      if (bd.needsPad) {
        if (!vars['--conv-own-pad'])   vars['--conv-own-pad']   = '7px 12px';
        if (!vars['--conv-other-pad']) vars['--conv-other-pad'] = '7px 12px';
      }
      if (bd.bgOwn   && convTheme.ownColor   === 'default') vars['--conv-own-bg']   = bd.bgOwn;
      if (bd.bgOther && convTheme.otherColor === 'default') vars['--conv-other-bg'] = bd.bgOther;

      // Apply per-border user overrides
      const opts: MsgBorderOptions | undefined = convTheme.msgBorderOverrides?.[convTheme.msgBorder as MsgBorderStyle];
      if (opts && bd.settingsType) {
        if (bd.settingsType === 'glass') {
          const intensity = opts.intensity ?? 60;
          const blur = Math.round(20 + intensity * 0.3);
          const sat  = Math.round(150 + intensity * 0.7);
          vars['--conv-bubble-backdrop'] = `blur(${blur}px) saturate(${sat}%)`;
          if (opts.tint) {
            const rgb = hexToRgb(opts.tint);
            if (rgb) {
              const a = (0.04 + intensity * 0.0012).toFixed(3);
              if (convTheme.ownColor   === 'default') vars['--conv-own-bg']   = `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
              if (convTheme.otherColor === 'default') vars['--conv-other-bg'] = `rgba(${rgb.r},${rgb.g},${rgb.b},${(parseFloat(a) * 0.7).toFixed(3)})`;
            }
          }
        } else if (bd.settingsType === 'color-glow' || bd.settingsType === 'color-only') {
          if (opts.color) {
            const rgb = hexToRgb(opts.color);
            if (rgb) {
              const { r, g, b } = rgb;
              const a = opts.intensity !== undefined ? opts.intensity / 100 : 0.5;
              vars['--conv-bubble-border'] = `1px solid rgba(${r},${g},${b},${(0.4 + a * 0.55).toFixed(2)})`;
              if (bd.settingsType === 'color-glow') {
                const glowStr = `0 0 ${Math.round(6 + a * 14)}px rgba(${r},${g},${b},${(0.2 + a * 0.45).toFixed(2)})`;
                const glowIdx = shadowParts.findIndex(s => /^0 0 \d/.test(s));
                if (glowIdx >= 0) shadowParts.splice(glowIdx, 1, glowStr);
                else shadowParts.push(glowStr);
              }
            }
          }
        } else if (bd.settingsType === 'rgb-speed' && opts.speed !== undefined) {
          vars['--conv-rgb-duration'] = `${opts.speed}s`;
        }
      }
    }

    if (shadowParts.length) vars['--conv-bubble-shadow'] = shadowParts.join(', ');

    // Input bar border style
    if (convTheme.inputBorder !== 'none') {
      const ibd = BORDER_STYLE_DEFS[convTheme.inputBorder];
      if (ibd.border)   vars['--conv-input-border']   = ibd.border;
      if (ibd.backdrop) vars['--conv-input-backdrop']  = ibd.backdrop;
      if (ibd.glow)     vars['--conv-input-shadow']    = ibd.glow;
      if (ibd.bgOwn)    vars['--conv-input-bg']        = ibd.bgOwn;

      const iOpts: MsgBorderOptions | undefined = convTheme.inputBorderOverrides?.[convTheme.inputBorder as MsgBorderStyle];
      if (iOpts && ibd.settingsType) {
        if (ibd.settingsType === 'glass') {
          const intensity = iOpts.intensity ?? 60;
          const blur = Math.round(20 + intensity * 0.3);
          const sat  = Math.round(150 + intensity * 0.7);
          vars['--conv-input-backdrop'] = `blur(${blur}px) saturate(${sat}%)`;
          if (iOpts.tint) {
            const rgb = hexToRgb(iOpts.tint);
            if (rgb) {
              const a = (0.04 + intensity * 0.0012).toFixed(3);
              vars['--conv-input-bg'] = `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
            }
          }
        } else if (ibd.settingsType === 'color-glow' || ibd.settingsType === 'color-only') {
          if (iOpts.color) {
            const rgb = hexToRgb(iOpts.color);
            if (rgb) {
              const { r, g, b } = rgb;
              const a = iOpts.intensity !== undefined ? iOpts.intensity / 100 : 0.5;
              vars['--conv-input-border'] = `1px solid rgba(${r},${g},${b},${(0.4 + a * 0.55).toFixed(2)})`;
              if (ibd.settingsType === 'color-glow') {
                vars['--conv-input-shadow'] = `0 0 ${Math.round(6 + a * 14)}px rgba(${r},${g},${b},${(0.2 + a * 0.45).toFixed(2)})`;
              }
            }
          }
        } else if (ibd.settingsType === 'rgb-speed' && iOpts.speed !== undefined) {
          vars['--conv-input-rgb-duration'] = `${iOpts.speed}s`;
        }
      }
    }

    // Message density
    const density = (convTheme as unknown as Record<string, unknown>).msgDensity as MsgDensity | undefined;
    if (density === 'compact') {
      vars['--conv-msg-gap']     = '6px';
      vars['--conv-compact-gap'] = '0px';
    } else if (density === 'cozy') {
      vars['--conv-msg-gap']     = '30px';
      vars['--conv-compact-gap'] = '3px';
    }
    // Monospace font (legacy toggle) or chatFont selection
    const mono = (convTheme as unknown as Record<string, unknown>).monoFont as boolean | undefined;
    const chatFont = (convTheme as unknown as Record<string, unknown>).chatFont as string | undefined;
    const CHAT_FONT_FAMILIES: Record<string, string> = {
      default:  'inherit',
      serif:    'Georgia, "Times New Roman", serif',
      mono:     '"Courier New", Consolas, monospace',
      rounded:  '"Nunito", "Varela Round", "Segoe UI", sans-serif',
      italic:   '"Georgia", serif',
      display:  '"Trebuchet MS", "Segoe UI", sans-serif',
      modern:   '"Poppins", "Segoe UI", sans-serif',
      elegant:  '"Garamond", "Palatino Linotype", serif',
      terminal: '"JetBrains Mono", "Fira Code", Consolas, monospace',
      narrow:   '"Tahoma", "Arial Narrow", sans-serif',
      marker:   '"Comic Sans MS", "Segoe Print", cursive',
    };
    if (chatFont && chatFont !== 'default') {
      vars['--conv-font-family'] = CHAT_FONT_FAMILIES[chatFont] ?? 'inherit';
    } else if (mono) {
      vars['--conv-font-family'] = '"Courier New", Consolas, monospace';
    }

    // Extra effects
    const ct = convTheme as unknown as Record<string, unknown>;
    if (ct.uppercase) vars['--conv-text-transform'] = 'uppercase';
    if (ct.gradientText) vars['--conv-gradient-text'] = '1';
    if (ct.hideAvatars) vars['--conv-hide-avatars'] = 'none';
    if (ct.msgAnimation === 'fade') vars['--conv-msg-animation'] = 'convMsgFade 0.3s ease';
    else if (ct.msgAnimation === 'slide') vars['--conv-msg-animation'] = 'convMsgSlide 0.3s ease';

    return vars as unknown as React.CSSProperties;
  }, [activeConversationKey, convTheme]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const convMessages = activeConversationKey ? (messages[activeConversationKey] ?? []) : [];

  const activeGroup = conv && conv.type === 'group' ? groups[conv.id] : null;
  const activeChannel = useMemo(() => {
    if (!activeGroup || !activeConversationKey) return null;
    const parsed = parseGroupChannelConversationId(activeConversationKey);
    const resolvedChannelId = parsed.channelId ?? activeGroup.channels?.[0]?.id ?? null;
    if (!resolvedChannelId) return null;
    return activeGroup.channels.find((channel) => channel.id === resolvedChannelId) ?? null;
  }, [activeGroup, activeConversationKey]);

  const groupPermissions = useMemo(
    () => resolveGroupPermissions(activeGroup, userId),
    [activeGroup, userId],
  );
  const groupModeration = useMemo(
    () => getGroupModeration(activeGroup),
    [activeGroup],
  );
  const activeGroupMember = useMemo(
    () => activeGroup?.members.find((member) => member.userId === userId) ?? null,
    [activeGroup, userId],
  );
  const moderationBypass = !!(
    groupPermissions.administrator
    || groupPermissions.manageMessages
    || groupPermissions.manageServer
    || hasModerationExemption(activeGroupMember?.roleIds, groupModeration)
  );
  const groupAccessDenied = !!(conv && conv.type === 'group' && !groupPermissions.readMessages);
  const groupSendBlocked = !!(conv && conv.type === 'group' && (!groupPermissions.sendMessages || !groupPermissions.readMessages));
  const groupAttachBlocked = !!(conv && conv.type === 'group' && !groupPermissions.attachFiles);

  const otherUserId = useMemo(() => {
    if (!conv || conv.type !== 'dm') return '';
    return getConversationMembers(conv).find((memberId) => memberId !== userId) ?? '';
  }, [conv, userId]);

  const headerName = useMemo(() => {
    if (!conv) return '';
    if (conv.type === 'group') return groups[conv.id]?.name ?? 'Group';
    return contacts[otherUserId]?.displayName ?? otherUserId.slice(0, 8);
  }, [conv, groups, contacts, otherUserId]);

  const headerOnline = useMemo(() => {
    if (!conv || conv.type !== 'dm') return false;
    return contacts[otherUserId]?.online ?? false;
  }, [conv, contacts, otherUserId]);

  const activeDmContact = conv && conv.type === 'dm' ? contacts[otherUserId] : undefined;
  const dmKeyChangePending = !!(
    conv
    && conv.type === 'dm'
    && otherUserId
    && (activeDmContact?.keyChangePending || recipientRequiresVerification(otherUserId))
  );
  const secureActionsBlocked = noLocalKeys || dmKeyChangePending;

  const refreshVerificationDisplay = useCallback(async () => {
    if (!conv || conv.type !== 'dm' || !otherUserId) {
      setVerificationDisplay(null);
      return;
    }
    const data = await getPeerVerificationDisplay(otherUserId);
    setVerificationDisplay(data);
  }, [conv, otherUserId]);

  const openVerificationModal = useCallback(async () => {
    await refreshVerificationDisplay();
    setShowVerificationModal(true);
  }, [refreshVerificationDisplay]);

  const handleConfirmIdentity = useCallback(async () => {
    if (!conv || conv.type !== 'dm' || !otherUserId) return;
    setConfirmingIdentity(true);
    try {
      const ok = await confirmPeerIdentity(otherUserId);
      if (!ok) {
        setSendError('Could not confirm this identity key. Try again.');
        return;
      }
      await refreshVerificationDisplay();
      setSendError(null);
      setShowVerificationModal(false);
    } finally {
      setConfirmingIdentity(false);
    }
  }, [conv, otherUserId, refreshVerificationDisplay]);

  useEffect(() => {
    void refreshVerificationDisplay();
  }, [
    refreshVerificationDisplay,
    activeDmContact?.keyChangePending,
    activeDmContact?.observedIdentityKey,
    activeDmContact?.pinnedIdentityKey,
  ]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [convMessages.length]);

  // Disappearing messages — tick every second, expire when due
  useEffect(() => {
    const hasAny = convMessages.some(m => m.disappearAt);
    if (!hasAny || !activeConversationKey) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      convMessages.forEach(m => {
        if (m.disappearAt && m.disappearAt <= t) expireMessage(activeConversationKey, m.id);
      });
    }, 1000);
    return () => clearInterval(id);
  }, [activeConversationKey, convMessages, expireMessage]);

  // Focus input when conversation changes
  useEffect(() => {
    inputRef.current?.focus();
    setReplyTo(null);
    setEditingMsg(null);
    setShowPersonalize(false);
    setShowAttachMenu(false);
    setShowVerificationModal(false);
  }, [activeConversationKey]);

  // Close attach menu on outside click
  useEffect(() => {
    if (!showAttachMenu) return;
    const close = () => setShowAttachMenu(false);
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', close); };
  }, [showAttachMenu]);

  useEffect(() => {
    if (!(isLocked || secureActionsBlocked || groupSendBlocked)) return;
    setShowAttachMenu(false);
    setShowEmojiPicker(false);
  }, [isLocked, secureActionsBlocked, groupSendBlocked]);

  // Auto-lock chat based on lockTimeout setting
  useEffect(() => {
    if (!activeSecurityId || !convSec?.requirePin) return;
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    return () => {
      // When navigating away from a locked chat, start the auto-lock timer
      if (!convSec?.requirePin) return;
      const timeout = convSec.lockTimeout;
      if (timeout === 'immediate') {
        convSecStore.lock(activeSecurityId);
      } else if (timeout !== 'never') {
        const ms: Record<string, number> = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000 };
        const delay = ms[timeout];
        if (delay) {
          lockTimerRef.current = setTimeout(() => convSecStore.lock(activeSecurityId), delay);
        }
      }
    };
  }, [activeSecurityId, convSec?.requirePin, convSec?.lockTimeout]);

  // Block screenshots when active conv has blockScreenshots on
  // (useSettingsEffects handles the blur overlay; this handles OS-level content protection)
  useEffect(() => {
    const on = !!convSec?.blockScreenshots;
    (window as unknown as { electronAPI?: { setContentProtection: (v: boolean) => void } })
      .electronAPI?.setContentProtection(on);
    return () => {
      // Restore global setting when leaving chat
      const globalOn = useSettingsStore.getState().screenshotProtection;
      (window as unknown as { electronAPI?: { setContentProtection: (v: boolean) => void } })
        .electronAPI?.setContentProtection(globalOn);
    };
  }, [convSec?.blockScreenshots]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  /* ── file helpers ─────────────────────────────── */
  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).slice(0, 10); // max 10
    setPendingFiles(prev => [...prev, ...arr].slice(0, 10));
    arr.forEach(f => {
      if (f.type.startsWith('image/')) {
        const url = URL.createObjectURL(f);
        setPendingPreviews(prev => ({ ...prev, [f.name + f.size]: url }));
      }
    });
  }, []);

  const removeFile = useCallback((idx: number) => {
    setPendingFiles(prev => {
      const f = prev[idx];
      if (f) {
        const key = f.name + f.size;
        setPendingPreviews(p => { const n = { ...p }; delete n[key]; return n; });
      }
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;
    if (!activeId || !activeConversationKey) return;

    if (noLocalKeys) {
      setSendError('Encryption keys are unavailable on this device.');
      return;
    }

    const activeConversation = conversations[activeId];
    if (!activeConversation) return;

    if (activeConversation.type === 'group' && !RIDGELINE_SECURITY_CAPABILITIES.groupMessagingSupported) {
      setSendError(GROUP_MESSAGING_CONTAINMENT_NOTICE);
      return;
    }

    if (activeConversation.type === 'group' && groupSendBlocked) {
      setSendError('You do not have permission to send messages in this channel.');
      return;
    }

    if (activeConversation.type === 'group' && pendingFiles.length > 0 && groupAttachBlocked) {
      setSendError('You do not have permission to attach files in this channel.');
      return;
    }

    const dmRecipient = activeConversation?.type === 'dm'
      ? getConversationMembers(activeConversation).find((memberId) => memberId !== userId)
      : null;
    if (dmRecipient && recipientRequiresVerification(dmRecipient)) {
      setSendError('Safety number changed for this contact. Verify identity before sending messages.');
      return;
    }

    // Bug #2 fix: reject messages over 10,000 chars
    const MAX_MESSAGE_LEN = 10_000;
    if (text.length > MAX_MESSAGE_LEN) {
      setSendError(`Message too long (${text.length.toLocaleString()} / ${MAX_MESSAGE_LEN.toLocaleString()} chars)`);
      return;
    }

    let outgoingText = text;
    if (activeConversation.type === 'group' && groupModeration.enabled && !moderationBypass) {
      const moderationResult = evaluateModeration(text, groupModeration);
      if (moderationResult.blocked) {
        setSendError('Message blocked by group moderation policy.');
        return;
      }

      if (groupModeration.mode === 'mask') {
        outgoingText = moderationResult.sanitizedText;
      }
    }

    setSendError(null);

    if (editingMsg) {
      editMessage(activeConversationKey, editingMsg.id, outgoingText);
      // Relay the edit to the other party via WebSocket
      const conv = activeConversation;
      if (conv && conv.type === 'dm') {
        const recipient = getConversationMembers(conv).find((memberId) => memberId !== userId);
        if (recipient) {
          ws.sendEditMessage(recipient, editingMsg.id, activeConversationKey, outgoingText);
        }
      } else if (conv && conv.type === 'group') {
        const recipients = getConversationMembers(conv).filter((memberId) => memberId !== userId);
        ws.sendEditMessage(null, editingMsg.id, activeConversationKey, outgoingText, recipients);
      }
      setEditingMsg(null);
    } else {
      let attachments: Attachment[] | undefined;
      // Encrypted ArrayBuffers kept in parallel for WS serialisation
      const encryptedBuffers: ArrayBuffer[] = [];

      if (pendingFiles.length > 0) {
        // Guard: double base64 encoding means ~2.67× size on the wire; cap total at 8MB
        const totalSize = pendingFiles.reduce((sum, f) => sum + f.size, 0);
        if (totalSize > 8 * 1024 * 1024) {
          setSendError('Attachments too large — maximum 8 MB total');
          return;
        }
        attachments = [];
        for (const file of pendingFiles) {
          const buf = await readFileAsArrayBuffer(file);
          const { key } = await generateAttachmentKey();
          // LOW-4: nonce generated at encrypt time, not at key-gen time
          const { blob: encryptedBlob, nonce } = await encryptAttachment(buf, key);
          const encryptedBuf = await encryptedBlob.arrayBuffer();
          encryptedBuffers.push(encryptedBuf);
          attachments.push({
            id: crypto.randomUUID(),
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            encryptedUrl: URL.createObjectURL(encryptedBlob),
            key,
            nonce,
          });
        }
        // clean up previews
        Object.values(pendingPreviews).forEach(u => URL.revokeObjectURL(u));
        setPendingFiles([]);
        setPendingPreviews({});
      }

      // Generate a stable message ID so both sender and receiver share the same ID
      // (required for replies to resolve correctly on the remote side)
      const msgId = crypto.randomUUID();

      sendMessage(activeConversationKey, outgoingText, replyTo?.id, attachments, msgId);

      // Build the WS payload — include attachment data as base64
      // Use chunked String.fromCharCode to avoid call-stack overflow on large files
      function bufToBase64(buf: ArrayBuffer): string {
        const bytes = new Uint8Array(buf);
        const CHUNK = 8192;
        let binary = '';
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...(bytes.subarray(i, i + CHUNK) as unknown as number[]));
        }
        return btoa(binary);
      }

      let wsPayload: string;
      if (attachments && attachments.length > 0) {
        const serializedAttachments = attachments.map((att, i) => {
          const b64 = bufToBase64(encryptedBuffers[i]);
          // Persist so blob URL can be recreated if app restarts before receiver fetches
          useChatStore.getState().storeAttachmentData(att.id, b64);
          return {
            id: att.id,
            name: att.name,
            mimeType: att.mimeType,
            size: att.size,
            data: b64,
            key: att.key,
            nonce: att.nonce,
          };
        });
        wsPayload = JSON.stringify({ text: outgoingText, attachments: serializedAttachments, ...(replyTo ? { replyTo: replyTo.id } : {}) });
      } else {
        wsPayload = JSON.stringify({ text: outgoingText, ...(replyTo ? { replyTo: replyTo.id } : {}) });
      }

      // CRIT-2: Encrypt the payload via Double Ratchet before sending
      // Send via WebSocket relay to the other party
      const conv = activeConversation;
      if (conv && conv.type === 'dm') {
        const recipient = getConversationMembers(conv).find((memberId) => memberId !== userId);
        if (recipient) {
          const result = await encryptPayload(recipient, wsPayload);
          if (result) {
            const wirePayload = JSON.stringify({
              e2ee: true,
              ciphertext: result.encrypted,
              ...(result.x3dhHeader ? { x3dh: result.x3dhHeader } : {}),
            });
            const ok = await ws.sendMessage(recipient, wirePayload, msgId);
            if (!ok) {
              // BUG #5 fix: ws.send returns false when the relay connection is
              // down. Without this check we'd show the message as 'sent' even
              // though it never left the device.
              setSendError("You appear to be offline — message not sent. It will not auto-retry.");
              useChatStore.getState().updateMessageStatus(activeConversationKey, msgId, 'failed');
              return;
            }
          } else {
            // Could not establish E2EE session after retries. Roll back the
            // local message (it was never sent) and keep the text in the input
            // so the user can try again when the connection is better.
            useChatStore.getState().deleteMessage(activeConversationKey, msgId);
            const ikp = useAuthStore.getState().identityKeyPair;
            const noKeys = !ikp || ikp.publicKey.every((b: number) => b === 0);
            const recipientNoKeys = recipient ? recipientHasNoBundle(recipient) : false;
            const verificationRequired = recipient ? recipientRequiresVerification(recipient) : false;
            setSendError(
              noKeys
                ? "Encryption keys not loaded — try locking and unlocking the app."
                : verificationRequired
                  ? 'Safety number changed for this contact. Verify identity before sending messages.'
                  : recipientNoKeys
                    ? `${recipient} hasn't registered encryption keys yet. They need to open the app and log in to set up their account.`
                    : 'Could not establish a secure session. Check your connection and try again.'
            );
            return;
          }
        }
      } else if (conv && conv.type === 'group') {
        // This branch is unreachable while group containment is active. The
        // relay independently rejects group traffic as the enforcement layer.
        const recipients = getConversationMembers(conv).filter((memberId) => memberId !== userId);
        const ok = await ws.sendGroupMessage(
          conv.id,
          recipients,
          wsPayload,
          msgId,
          activeChannel?.id,
          activeChannel?.name,
        );
        if (!ok) {
          setSendError("You appear to be offline — message not sent.");
          useChatStore.getState().updateMessageStatus(activeConversationKey, msgId, 'failed');
          return;
        }
      }

      setReplyTo(null);
    }
    setInput('');
    inputRef.current?.focus();
  }, [
    input,
    activeId,
    activeConversationKey,
    editingMsg,
    replyTo,
    sendMessage,
    editMessage,
    pendingFiles,
    pendingPreviews,
    conversations,
    userId,
    noLocalKeys,
    groupSendBlocked,
    groupAttachBlocked,
    groupModeration,
    moderationBypass,
    activeChannel?.id,
    activeChannel?.name,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      setReplyTo(null);
      setEditingMsg(null);
    }
  };

  const insertSpoiler = () => {
    const field = inputRef.current;
    if (!field) return;

    const start = field.selectionStart ?? input.length;
    const end = field.selectionEnd ?? start;
    const selected = input.slice(start, end);
    const next = `${input.slice(0, start)}||${selected}||${input.slice(end)}`;
    const caret = selected ? start + selected.length + 4 : start + 2;

    setInput(next);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(caret, caret);
    });
  };

  const handleContext = (e: React.MouseEvent, msg: Message) => {
    e.preventDefault();
    setContextMenu({ msg, x: e.clientX, y: e.clientY });
  };

  const statusIcon = (msg: Message) => {
    if (msg.senderId !== userId) return null;
    switch (msg.status) {
      case 'sending': return <span className="msg-status msg-status--sending" />;
      case 'sent': return <Check size={12} />;
      case 'delivered': return <CheckDouble size={12} />;
      case 'read': return <span className="msg-status--read"><CheckDouble size={12} /></span>;
      case 'failed': return <AlertTriangle size={12} />;
      default: return null;
    }
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      ...(use24HourTime ? { hour12: false } : {}),
    });
  };

  const formatDateSep = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  };

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = '';
    for (const msg of convMessages) {
      const date = formatDateSep(msg.timestamp);
      if (date !== currentDate) {
        currentDate = date;
        groups.push({ date, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    }
    return groups;
  }, [convMessages]);

  // ── Empty state ───────────────────────────────
  if (!conv) {
    return (
      <div className="chat-view">
        <FriendsHome />
        <CallOverlay />
      </div>
    );
  }

  const _rgbMode = convTheme.msgBorder === 'rgb' ? (convTheme.msgBorderOverrides?.['rgb']?.mode ?? 'rgb') : '';
  const _rgbClass = _rgbMode === 'trail' ? ' chat-view--rgb-trail'
    : _rgbMode === 'fill'  ? ' chat-view--rgb-fill'
    : _rgbMode === 'empty' ? ' chat-view--rgb-empty'
    : _rgbMode === 'rgb'   ? ' chat-view--rgb-border'
    : '';

  const _inputRgbMode = convTheme.inputBorder === 'rgb' ? (convTheme.inputBorderOverrides?.['rgb']?.mode ?? 'rgb') : '';
  const _inputRgbClass = _inputRgbMode === 'trail' ? ' chat-view--input-rgb-trail'
    : _inputRgbMode === 'fill'  ? ' chat-view--input-rgb-fill'
    : _inputRgbMode === 'empty' ? ' chat-view--input-rgb-empty'
    : _inputRgbMode === 'rgb'   ? ' chat-view--input-rgb-border'
    : '';
  const _inputStyleClass = convTheme.inputBorder !== 'none' ? ' chat-view--input-styled' : '';

  const groupSecurityBlocked = conv?.type === 'group'
    && !RIDGELINE_SECURITY_CAPABILITIES.groupMessagingSupported;
  const disableComposer = isLocked || secureActionsBlocked || groupSendBlocked || groupSecurityBlocked;
  const composerPlaceholder = noLocalKeys
    ? 'Encryption keys unavailable on this device'
    : groupSendBlocked
      ? 'You do not have permission to send messages in this channel'
    : dmKeyChangePending
      ? 'Verify safety number before sending messages'
      : 'Type a message…';

  return (
    <div className={`chat-view${_rgbClass}${_inputRgbClass}${_inputStyleClass}`} style={convStyle}>
      {/* ── Header ───────────────────────────────── */}
      <header className="chat-header">
        <button className="chat-header__back" onClick={() => setActive(null)}>
          <ArrowLeft size={18} />
        </button>

        <div className="chat-header__avatar">
          {conv.type === 'group'
            ? <div className="chat-header__group-icon"><Users size={20} /></div>
            : <AvatarWithStatus
                name={headerName}
                avatarUrl={remoteProfiles[otherUserId]?.avatar ?? null}
                statusText={remoteProfiles[otherUserId]?.statusText}
                statusEmoji={remoteProfiles[otherUserId]?.statusEmoji}
                size={36}
                online={headerOnline}
                statusColor={headerOnline ? PRESENCE_COLORS[remoteProfiles[otherUserId]?.presence ?? 'online'] : undefined}
              />
          }
        </div>

        <div className="chat-header__info" onClick={() => setShowInfo(true)}>
          <span className="chat-header__name">{headerName}</span>
          {conv.type === 'dm' && remoteProfiles[otherUserId]?.selectedTags?.length > 0 && (
            <div className="chat-header__tags">
              {remoteProfiles[otherUserId].selectedTags.slice(0, 3).map(tagId => {
                const tag = TAG_MAP[tagId];
                return tag ? (
                  <span key={tagId} className="chat-header__tag" style={{ background: tag.color, color: tag.textColor ?? '#fff' }}>
                    {tag.label}
                  </span>
                ) : null;
              })}
            </div>
          )}
          <span className="chat-header__meta">
            {conv.type === 'dm'
              ? (headerOnline ? 'Online' : 'Offline')
              : (() => {
                  const channelLabel = activeChannel ? `#${activeChannel.name}` : 'No channel';
                  const n = groups[conv.id]?.members?.length ?? 0;
                  return `${channelLabel} · ${n} ${n === 1 ? 'member' : 'members'}`;
                })()
            }
            {conversationSecurityUi && (
              <>
                <span className="chat-header__sep">·</span>
                {conversationSecurityUi.showLock && <Lock size={10} />}
                {conversationSecurityUi.label}
              </>
            )}
            {dmKeyChangePending && (
              <>
                <span className="chat-header__sep">·</span>
                <AlertTriangle size={10} />
                <span className="chat-header__warn">Verification required</span>
              </>
            )}
          </span>
        </div>

        <div className={`chat-header__actions chat-header__actions--${conv.type}`}>
          {conv.disappearingTimer && (
            <span className="chat-header__timer">
              <Timer size={14} />
              {conv.disappearingTimer < 3600
                ? `${Math.round(conv.disappearingTimer / 60)}m`
                : `${Math.round(conv.disappearingTimer / 3600)}h`
              }
            </span>
          )}
          {conv.type === 'dm' && (
            <>
              <button
                className="sidebar-icon-btn chat-header__btn chat-header__btn--call-audio chat-header__btn--mobile-primary"
                onClick={() => activeId && void startCall(activeId, 'audio')}
                title={activeCall
                  ? 'A call is already active'
                  : secureActionsBlocked
                    ? 'Verify the safety number before starting a call'
                    : 'Start voice call'}
                disabled={!!activeCall || secureActionsBlocked}
              >
                <Phone size={18} />
              </button>
              <button
                className="sidebar-icon-btn chat-header__btn chat-header__btn--call-video"
                onClick={() => activeId && void startCall(activeId, 'video')}
                title={activeCall
                  ? 'A call is already active'
                  : secureActionsBlocked
                    ? 'Verify the safety number before starting a call'
                    : 'Start video call'}
                disabled={!!activeCall || secureActionsBlocked}
              >
                <Video size={18} />
              </button>
            </>
          )}
          <button className="sidebar-icon-btn chat-header__btn chat-header__btn--security" onClick={() => { setShowSecurity(s => !s); setShowPersonalize(false); }} title="Chat security">
            <Shield size={18} />
          </button>
          {conv.type === 'group' && (
            <button className="sidebar-icon-btn chat-header__btn chat-header__btn--members chat-header__btn--mobile-primary" onClick={() => setShowMembers(true)} title="Members">
              <Users size={18} />
            </button>
          )}
          <button className="sidebar-icon-btn chat-header__btn chat-header__btn--personalize" onClick={() => { setShowPersonalize(p => !p); setShowSecurity(false); }} title="Personalize chat">
            <Palette size={18} />
          </button>
          <button
            className="sidebar-icon-btn chat-header__btn chat-header__btn--verify"
            onClick={() => {
              if (conv.type === 'dm') {
                void openVerificationModal();
              } else {
                setShowInfo(true);
              }
            }}
            title={conv.type === 'dm' ? 'View safety number and verify identity' : 'Conversation info'}
          >
            <Fingerprint size={18} />
          </button>
          <button
            className="sidebar-icon-btn chat-header__btn chat-header__btn--more"
            onClick={() => setShowMobileMore(true)}
            title="More actions"
          >
            <MoreVertical size={18} />
          </button>
        </div>
      </header>

      {showMobileMore && (
        <div className="chat-mobile-sheet-backdrop" onClick={() => setShowMobileMore(false)}>
          <div className="chat-mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="chat-mobile-sheet__title">Chat actions</div>

            {conv.type === 'dm' && (
              <>
                <button
                  className="chat-mobile-sheet__btn"
                  onClick={() => {
                    setShowMobileMore(false);
                    if (activeId) void startCall(activeId, 'audio');
                  }}
                  disabled={!!activeCall || secureActionsBlocked}
                >
                  <Phone size={16} />
                  Start voice call
                </button>

                <button
                  className="chat-mobile-sheet__btn"
                  onClick={() => {
                    setShowMobileMore(false);
                    if (activeId) void startCall(activeId, 'video');
                  }}
                  disabled={!!activeCall || secureActionsBlocked}
                >
                  <Video size={16} />
                  Start video call
                </button>
              </>
            )}

            {conv.type === 'group' && (
              <button
                className="chat-mobile-sheet__btn"
                onClick={() => {
                  setShowMobileMore(false);
                  setShowMembers(true);
                }}
              >
                <Users size={16} />
                View members
              </button>
            )}

            <button
              className="chat-mobile-sheet__btn"
              onClick={() => {
                setShowMobileMore(false);
                setShowSecurity((s) => !s);
                setShowPersonalize(false);
              }}
            >
              <Shield size={16} />
              Security
            </button>

            <button
              className="chat-mobile-sheet__btn"
              onClick={() => {
                setShowMobileMore(false);
                setShowPersonalize((p) => !p);
                setShowSecurity(false);
              }}
            >
              <Palette size={16} />
              Personalize
            </button>

            <button
              className="chat-mobile-sheet__btn"
              onClick={() => {
                setShowMobileMore(false);
                if (conv.type === 'dm') {
                  void openVerificationModal();
                } else {
                  setShowInfo(true);
                }
              }}
            >
              <Fingerprint size={16} />
              {conv.type === 'dm' ? 'Verify identity' : 'Conversation info'}
            </button>
          </div>
        </div>
      )}

      {/* ── PIN lock overlay ─────────────────────── */}
      {isLocked && lockTheme && (() => {
        const lt = lockTheme;
        const LockIcon = LOCK_ICONS[lt.iconStyle] ?? Lock;
        const bgStyle: React.CSSProperties = {};
        if (lt.bgMode === 'solid')    bgStyle.background = lt.bgValue;
        if (lt.bgMode === 'gradient') bgStyle.background = lt.bgValue;
        if (lt.bgMode === 'image')    { bgStyle.backgroundImage = `url(${lt.bgImage})`; bgStyle.backgroundSize = 'cover'; bgStyle.backgroundPosition = 'center'; }
        if (lt.bgMode === 'blur')     bgStyle.backdropFilter = `blur(${lt.blurAmount}px)`;
        const overlayStyle: React.CSSProperties = lt.bgMode !== 'default'
          ? { position: 'absolute' as const, inset: 0, background: lt.overlayColor, opacity: lt.overlayOpacity, pointerEvents: 'none' as const }
          : {};
        const boxStyle: React.CSSProperties = {
          background: lt.boxOpacity < 1
            ? lt.boxBg.startsWith('#')
              ? lt.boxBg + Math.round(lt.boxOpacity * 255).toString(16).padStart(2, '0')
              : lt.boxBg
            : lt.boxBg,
          border: `1px solid ${lt.boxBorder}`,
          borderRadius: lt.boxRadius,
          boxShadow: lt.boxGlow > 0 ? `0 0 ${lt.boxGlow}px ${lt.boxGlowColor}` : undefined,
          backdropFilter: lt.boxBlur > 0 ? `blur(${lt.boxBlur}px)` : undefined,
          WebkitBackdropFilter: lt.boxBlur > 0 ? `blur(${lt.boxBlur}px)` : undefined,
        };

        return (
          <div className="chat-pin-lock" style={lt.bgMode !== 'default' ? bgStyle : undefined}>
            {lt.bgMode !== 'default' && <div style={overlayStyle} />}
            <div className="chat-pin-lock__box" style={boxStyle}>
              <div className="chat-pin-lock__top-row">
                <span style={{ color: lt.iconColor }}>
                  <LockIcon
                    size={lt.iconSize}
                    className={`chat-pin-lock__icon chat-pin-lock__icon--${lt.iconAnimation}`}
                  />
                </span>
                <button
                  className="chat-pin-lock__settings-btn"
                  onClick={() => setShowLockSettings(true)}
                  title="Customize lock screen"
                >
                  <Settings size={14} />
                </button>
              </div>
              <h3 className="chat-pin-lock__title" style={{ color: lt.textColor }}>{lt.title || 'Chat Locked'}</h3>
              <p className="chat-pin-lock__desc" style={{ color: lt.textColor, opacity: 0.7 }}>{lt.description || 'Enter your PIN to open this conversation'}</p>
              <div className="chat-pin-lock__input-wrap">
                <Key size={14} className="chat-pin-lock__key-icon" />
                <input
                  className="chat-pin-lock__input"
                  type={chatPinVisible ? 'text' : 'password'}
                  value={chatPinInput}
                  onChange={e => { setChatPinInput(e.target.value); setChatPinError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleChatPinSubmit()}
                  placeholder="Enter PIN…"
                  autoFocus
                />
                <button
                  className="chat-pin-lock__vis"
                  onClick={() => setChatPinVisible(v => !v)}
                  tabIndex={-1}
                >
                  {chatPinVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {chatPinError && <p className="chat-pin-lock__error">{chatPinError}</p>}
              <button
                className="chat-pin-lock__btn"
                style={{ background: lt.buttonColor, color: lt.buttonText }}
                onClick={handleChatPinSubmit}
              >
                Unlock
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── No-vault E2EE warning banner ──────────── */}
      {noLocalKeys && (
        <div className="chat-e2ee-unavailable-banner" role="alert">
          <Lock size={13} />
          <span>Encryption keys unavailable on this device — messages cannot be sent until you set up keys.</span>
          <button onClick={() => setScreen('settings')}>Fix in Settings →</button>
        </div>
      )}

      {dmKeyChangePending && (
        <div className="chat-key-change-banner" role="alert">
          <AlertTriangle size={14} />
          <div className="chat-key-change-banner__text">
            <strong>Safety number changed.</strong>
            <span>Messages and calls are paused until you verify this contact's new identity key.</span>
          </div>
          <button onClick={() => void openVerificationModal()}>Review keys</button>
        </div>
      )}

      {groupSecurityBlocked && (
        <div className="chat-e2ee-unavailable-banner" role="alert">
          <AlertTriangle size={13} />
          <span>{GROUP_MESSAGING_CONTAINMENT_NOTICE}</span>
        </div>
      )}

      {/* ── Messages ─────────────────────────────── */}
      <div
        className={`chat-messages${isLocked ? ' chat-messages--hidden' : ''}`}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        role="log"
        aria-live="polite"
        aria-label="Messages"
      >
        {groupAccessDenied ? (
          <div className="chat-messages__start">
            <Shield size={16} />
            <p>You do not have permission to view messages in this channel.</p>
          </div>
        ) : (
          <>
            <div className="chat-messages__start">
              {conv?.type === 'dm' && RIDGELINE_SECURITY_CAPABILITIES.dmE2eeSupported ? (
                <>
                  <EncryptionIndicator />
                  <p>Direct messages use end-to-end encryption when a secure session is available.</p>
                </>
              ) : (
                <p>{GROUP_MESSAGING_CONTAINMENT_NOTICE}</p>
              )}
            </div>

            {groupedMessages.map(group => (
              <div key={group.date}>
                <div className="chat-date-sep">
                  <span>{group.date}</span>
                </div>

                {group.messages.map((msg, msgIdx) => {
              const isOwn = msg.senderId === userId;
              const isDecrypting = msg.content !== '' && (now - msg.timestamp) <= 1400;
              const senderName = isOwn
                ? ownDisplayName
                : (contacts[msg.senderId]?.displayName || msg.senderId.slice(0, 8));

              const repliedMsg = msg.replyTo
                ? convMessages.find(m => m.id === msg.replyTo)
                : null;

              // Show avatar + name header when sender changes or gap > 5 min
              const prevMsg = msgIdx > 0 ? group.messages[msgIdx - 1] : null;
              const showHeader = !prevMsg
                || prevMsg.senderId !== msg.senderId
                || (msg.timestamp - prevMsg.timestamp) > 5 * 60 * 1000;

              return (
                <div
                  key={msg.id}
                  className={[
                    'chat-msg',
                    isOwn ? 'chat-msg--own' : 'chat-msg--other',
                    showHeader ? '' : 'chat-msg--compact',
                    msg.content === '' && !(msg.attachments && msg.attachments.length > 0) ? 'chat-msg--deleted' : '',
                    msg.status === 'failed' ? 'chat-msg--failed' : '',
                  ].join(' ').trim()}
                  onContextMenu={e => handleContext(e, msg)}
                >
                  {/* Avatar / hover-timestamp column */}
                  <div className="chat-msg__avatar-col">
                    {showHeader
                      ? <Avatar name={senderName} src={isOwn ? ownAvatar : (remoteProfiles[msg.senderId]?.avatar ?? null)} size={36} />
                      : showTimestamps
                        ? <span className="chat-msg__ts-peek">{formatTimestamp(msg.timestamp)}</span>
                        : null
                    }
                  </div>

                  {/* Body */}
                  <div className="chat-msg__body">
                    {showHeader && (
                      <div className="chat-msg__header">
                        <span className={`chat-msg__name${isOwn ? ' chat-msg__name--own' : ''}`}>
                          {senderName}
                        </span>
                        {showTimestamps && (
                          <span className="chat-msg__time-header">{formatTimestamp(msg.timestamp)}</span>
                        )}
                      </div>
                    )}

                    {repliedMsg && (
                      <div className="chat-msg__reply-ref">
                        <Reply size={10} />
                        <span className="chat-msg__reply-name">
                          {repliedMsg.senderId === userId ? 'You' : (contacts[repliedMsg.senderId]?.displayName ?? 'User')}
                        </span>
                        <span className="chat-msg__reply-text">{repliedMsg.content.slice(0, 60)}</span>
                      </div>
                    )}

                    <div className={`chat-msg__content${isOwn ? ' chat-msg__content--own' : ' chat-msg__content--other'}${convSec?.blurMessages && !isOwn ? ' chat-msg__content--blurred' : ''}${isDecrypting ? ' chat-msg__content--decrypting' : ''}`}>
                      {msg.content === '' && !(msg.attachments && msg.attachments.length > 0) ? (
                        <span className="chat-msg__deleted-text">
                          <Trash size={12} /> This message was deleted
                        </span>
                      ) : msg.content !== '' ? (
                        <>
                          <span className={`chat-msg__text${isDecrypting ? ' chat-msg__text--decrypting' : ''}`}>{renderMsgContent(msg.content)}</span>
                          {msg.editedAt && <span className="chat-msg__edited">edited</span>}
                          {msg.disappearAt && (() => {
                            const remaining = msg.disappearAt - now;
                            if (remaining <= 0) return null;
                            const s = Math.ceil(remaining / 1000);
                            const label = s >= 86400 ? `${Math.ceil(s / 86400)}d`
                                        : s >= 3600  ? `${Math.ceil(s / 3600)}h`
                                        : s >= 60    ? `${Math.ceil(s / 60)}m`
                                        :              `${s}s`;
                            return (
                              <span className={`chat-msg__disappear-countdown${s <= 10 ? ' chat-msg__disappear-countdown--urgent' : ''}`}>
                                <Timer size={9} />
                                {label}
                              </span>
                            );
                          })()}
                        </>
                      ) : null}
                      {isOwn && (
                        <span className="chat-msg__status-inline">{statusIcon(msg)}</span>
                      )}
                    </div>

                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className={`chat-msg__attachments${convSec?.blurMessages && !isOwn ? ' chat-msg__attachments--blurred' : ''}`}>
                        {msg.attachments.map(att => (
                          <AttachmentBubble key={att.id} attachment={att} onImageClick={(src, alt) => setLightbox({ src, alt })} />
                        ))}
                      </div>
                    )}

                    {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                      <div className="chat-msg__reactions">
                        {Object.entries(msg.reactions).map(([emoji, users]) => (
                          <button
                            key={emoji}
                            className={`chat-msg__reaction ${users.includes(userId ?? '') ? 'chat-msg__reaction--own' : ''}`}
                            onClick={() => activeConversationKey && addReaction(activeConversationKey, msg.id, emoji)}
                          >
                            {emoji} {users.length}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Context Menu ─────────────────────────── */}
      {contextMenu && (
        <div
          className="chat-context"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
        >
          <button onClick={() => { setReplyTo(contextMenu.msg); setContextMenu(null); }}>
            <Reply size={14} /> Reply
          </button>
          <button onClick={() => {
            navigator.clipboard.writeText(contextMenu.msg.content);
            if (clipboardAutoClear) {
              window.electronAPI?.clipboardClear(clipboardClearSeconds);
            }
            setContextMenu(null);
          }}>
            <Copy size={14} /> Copy
          </button>
          {contextMenu.msg.senderId === userId && contextMenu.msg.content !== '' && (
            <>
              <button onClick={() => {
                setEditingMsg(contextMenu.msg);
                setInput(contextMenu.msg.content);
                setContextMenu(null);
              }}>
                <Edit size={14} /> Edit
              </button>
              <button className="chat-context__danger" onClick={() => {
                setDeleteMsgConfirm(contextMenu.msg.id);
                setContextMenu(null);
              }}>
                <Trash size={14} /> Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Input bar ────────────────────────────── */}
      <div className={`chat-input-wrapper${isLocked ? ' chat-input-wrapper--hidden' : ''}`}>
        {sendError && (
          <div className="chat-input-error" role="alert">
            <span>{sendError}</span>
            <button aria-label="Dismiss" onClick={() => setSendError(null)}>&times;</button>
          </div>
        )}
        {(replyTo || editingMsg) && (
          <div className="chat-input-context">
            {replyTo && (
              <>
                <Reply size={12} />
                <span>Replying to <strong>
                  {replyTo.senderId === userId ? 'yourself' : (contacts[replyTo.senderId]?.displayName ?? 'User')}
                </strong></span>
                <button onClick={() => setReplyTo(null)}>&times;</button>
              </>
            )}
            {editingMsg && (
              <>
                <Edit size={12} />
                <span>Editing message</span>
                <button onClick={() => { setEditingMsg(null); setInput(''); }}>&times;</button>
              </>
            )}
          </div>
        )}

        {pendingFiles.length > 0 && (
          <div className="chat-input-staging">
            {pendingFiles.map((f, i) => {
              const key = f.name + f.size;
              const preview = pendingPreviews[key];
              return (
                <div key={key} className="chat-input-staging__item">
                  {preview
                    ? <img src={preview} alt={f.name} className="chat-input-staging__thumb" />
                    : <div className="chat-input-staging__file-icon"><Paperclip size={16} /></div>
                  }
                  <span className="chat-input-staging__name">{f.name}</span>
                  <button className="chat-input-staging__remove" onClick={() => removeFile(i)}><X size={14} /></button>
                </div>
              );
            })}
          </div>
        )}

        {typingNames.length > 0 && (
          <TypingIndicator name={typingNames.length === 1 ? typingNames[0] : typingNames.join(', ')} />
        )}

        <div className="chat-input">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="chat-input__file-hidden"
            onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
          />
          <input
            ref={imageInputRef}
            type="file"
            multiple
            accept="image/*"
            className="chat-input__file-hidden"
            onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
          />
          <div className="chat-input__attach-wrap">
            <button
              className="chat-input__btn"
              onClick={() => setShowAttachMenu(v => !v)}
              disabled={disableComposer || groupAttachBlocked}
            >
              <Paperclip size={18} />
            </button>
            {showAttachMenu && (
              <div className="chat-input__attach-menu">
                <button disabled={disableComposer || groupAttachBlocked} onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}>
                  <Paperclip size={14} /> File
                </button>
                <button disabled={disableComposer || groupAttachBlocked} onClick={() => { imageInputRef.current?.click(); setShowAttachMenu(false); }}>
                  <Image size={14} /> Image
                </button>
                <button disabled={disableComposer || groupAttachBlocked} onClick={() => { setShowCamera(true); setShowAttachMenu(false); }}>
                  <Camera size={14} /> Camera
                </button>
              </div>
            )}
          </div>

          <button
            className="chat-input__btn chat-input__btn--spoiler"
            title="Mark text as spoiler"
            aria-label="Mark text as spoiler"
            disabled={disableComposer}
            onClick={insertSpoiler}
          >
            <EyeOff size={16} />
          </button>

          {/* Emoji / GIF / Sticker picker */}
          <div className="chat-input__emoji-wrap">
            <button
              className="chat-input__btn"
              title="Emoji, GIF & Stickers"
              disabled={disableComposer}
              onClick={() => setShowEmojiPicker(v => !v)}
            >
              <Smile size={18} />
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                onSelectEmoji={(emoji) => { setInput(prev => prev + emoji); }}
                onSelectGif={(url) => { setInput(prev => prev + (prev ? ' ' : '') + url); }}
                onSelectSticker={(text) => { setInput(prev => prev + (prev ? ' ' : '') + text); }}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
          </div>

          <div className="chat-input__field-wrap">
            {inlineEmojiSuggestions.length > 0 && (
              <div className="chat-input__emoji-suggestions" role="listbox" aria-label="Emoji suggestions">
                {inlineEmojiSuggestions.map(({ name, emoji }) => (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-label={`Insert ${name}`}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => insertEmojiSuggestion(emoji)}
                  >
                    <span aria-hidden="true">{emoji}</span>
                    <span>:{name}:</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="chat-input__field"
              placeholder={composerPlaceholder}
              aria-label="Message"
              value={input}
              onChange={e => { setInput(e.target.value); emitTyping(); }}
              onKeyDown={handleKeyDown}
              rows={1}
              spellCheck={spellCheck}
              autoComplete={incognitoKeyboard ? 'off' : 'on'}
              autoCorrect={incognitoKeyboard ? 'off' : 'on'}
              autoCapitalize={incognitoKeyboard ? 'off' : 'on'}
              disabled={disableComposer}
            />
          </div>

          {(input.trim() || pendingFiles.length > 0) ? (
            <button className="chat-input__send" onClick={handleSend} aria-label="Send message" disabled={disableComposer}>
              <Send size={18} />
            </button>
          ) : (
            <button
              className={`chat-input__btn${isListening ? ' chat-input__btn--recording' : ''}`}
              onClick={toggleVoice}
              aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
              aria-pressed={isListening}
              disabled={disableComposer}
            >
              <Mic size={18} />
            </button>
          )}
        </div>
      </div>

      {/* ── Personalize panel ──────────────────── */}
      {showPersonalize && canUseGroupThemeMode && (
        <div className="chat-pers-mode-toggle">
          <button
            className={`chat-pers-mode-toggle__btn ${groupThemeMode === 'group' ? 'chat-pers-mode-toggle__btn--active' : ''}`}
            onClick={() => {
              if (!activeConversationKey) return;
              setGroupThemeMode(activeConversationKey, 'group');
            }}
          >
            Use Group Personalize
          </button>
          <button
            className={`chat-pers-mode-toggle__btn ${groupThemeMode === 'personal' ? 'chat-pers-mode-toggle__btn--active' : ''}`}
            onClick={() => {
              if (!activeConversationKey) return;
              setGroupThemeMode(activeConversationKey, 'personal');
              if (!hasPersonalThemeOverride) {
                setConvTheme(activeConversationKey, {});
              }
            }}
          >
            Use My Personalize
          </button>
        </div>
      )}

      {showPersonalize && canUseGroupThemeMode && groupThemeMode === 'group' && (
        <div className="chat-pers-mode-note">
          Group personalization is active for this channel. Switch to your own personalize mode if you want a custom view.
        </div>
      )}

      {showPersonalize && activeConversationKey && !persDetached && (
        !canUseGroupThemeMode || groupThemeMode === 'personal'
          ? (
            <ConvPersonalize
              convId={activeConversationKey}
              onClose={() => setShowPersonalize(false)}
              onToggleDetach={() => setPersDetached(true)}
            />
          )
          : null
      )}
      {showPersonalize && activeConversationKey && persDetached && (
        (!canUseGroupThemeMode || groupThemeMode === 'personal')
          ? (
            <div className="conv-pers-overlay" onClick={() => { setShowPersonalize(false); setPersDetached(false); }}>
              <div className="conv-pers-floating" onClick={e => e.stopPropagation()}>
                <ConvPersonalize
                  convId={activeConversationKey}
                  detached
                  onClose={() => { setShowPersonalize(false); setPersDetached(false); }}
                  onToggleDetach={() => setPersDetached(false)}
                />
              </div>
            </div>
          )
          : null
      )}

      {/* ── Security panel ───────────────────────── */}
      {showSecurity && activeConversationKey && (
        <ConvSecurity convId={activeConversationKey} onClose={() => setShowSecurity(false)} />
      )}

      {/* ── Info modal ───────────────────────────── */}
      {showInfo && (
        <Modal title="Conversation Info" onClose={() => setShowInfo(false)}>
          <div className="chat-info-modal">
            <div className="chat-info-modal__section">
              <h4>Encryption</h4>
              {conv.type === 'dm' && RIDGELINE_SECURITY_CAPABILITIES.dmE2eeSupported ? (
                <>
                  <div className="chat-info-modal__row">
                    <ShieldCheck size={16} />
                    <span>Direct messages use the Double Ratchet protocol</span>
                  </div>
                  <div className="chat-info-modal__row">
                    <Fingerprint size={16} />
                    <span>Verify safety numbers to confirm identity</span>
                  </div>
                </>
              ) : (
                <div className="chat-info-modal__row">
                  <Shield size={16} />
                  <span>{GROUP_MESSAGING_CONTAINMENT_NOTICE}</span>
                </div>
              )}
            </div>
            {conv.type === 'group' && groups[conv.id] && (
              <div className="chat-info-modal__section">
                <h4>Channel</h4>
                <div className="chat-info-modal__row">
                  <Hash size={16} />
                  <span>{activeChannel ? `#${activeChannel.name}` : 'No active channel'}</span>
                </div>
                <div className="chat-info-modal__row">
                  <Shield size={16} />
                  <span>
                    {groupPermissions.readMessages ? 'Can read' : 'Read blocked'} · {groupPermissions.sendMessages ? 'Can send' : 'Send blocked'} · {groupPermissions.attachFiles ? 'Can attach files' : 'Attachments blocked'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {showMembers && conv.type === 'group' && groups[conv.id] && (
        <Modal title="Members" onClose={() => setShowMembers(false)}>
          <div className="chat-info-modal">
            <div className="chat-info-modal__section">
              <h4>Members ({groups[conv.id].members.length})</h4>
              {groups[conv.id].members.map(m => {
                const contactName = contacts[m.userId]?.displayName ?? remoteProfiles[m.userId]?.displayName ?? m.userId.slice(0, 8);
                const roleNames = (m.roleIds ?? [])
                  .map((id) => groups[conv.id]?.roles?.find((role) => role.id === id)?.name)
                  .filter(Boolean) as string[];

                return (
                  <div key={m.userId} className="chat-info-modal__member">
                    <Avatar name={contactName} size={28} />
                    <span>{contactName}</span>
                    {m.role === 'admin' && <Badge variant="primary">Admin</Badge>}
                    {roleNames.slice(0, 2).map((roleName) => (
                      <Badge key={`${m.userId}-${roleName}`} variant="default">{roleName}</Badge>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      {showVerificationModal && conv.type === 'dm' && (
        <Modal
          title="Safety Number Verification"
          onClose={() => setShowVerificationModal(false)}
          footer={(
            <div className="chat-verify-modal__footer">
              <button
                className="chat-verify-modal__btn chat-verify-modal__btn--ghost"
                onClick={() => setShowVerificationModal(false)}
              >
                Close
              </button>
              {dmKeyChangePending && (
                <button
                  className="chat-verify-modal__btn chat-verify-modal__btn--danger"
                  onClick={() => void handleConfirmIdentity()}
                  disabled={confirmingIdentity}
                >
                  {confirmingIdentity ? 'Confirming…' : 'I verified this new key'}
                </button>
              )}
            </div>
          )}
        >
          <div className="chat-verify-modal">
            {dmKeyChangePending && (
              <div className="chat-verify-modal__alert" role="alert">
                <AlertTriangle size={14} />
                <span>Identity key changed. Confirm this update out-of-band before sending messages or starting calls.</span>
              </div>
            )}

            {verificationDisplay ? (
              <>
                <p className="chat-verify-modal__hint">
                  Compare this safety number with {headerName} on another trusted channel.
                </p>
                <div className="chat-verify-modal__safety-number">
                  {verificationDisplay.safetyNumber || 'Safety number unavailable'}
                </div>
                <div className="chat-verify-modal__row">
                  <span>Your fingerprint</span>
                  <code>{verificationDisplay.localFingerprint || 'Unavailable'}</code>
                </div>
                <div className="chat-verify-modal__row">
                  <span>Pinned {headerName} fingerprint</span>
                  <code>{verificationDisplay.pinnedFingerprint || 'Unavailable'}</code>
                </div>
                <div className="chat-verify-modal__row">
                  <span>Observed {headerName} fingerprint</span>
                  <code>{verificationDisplay.observedFingerprint || 'Unavailable'}</code>
                </div>
              </>
            ) : (
              <p className="chat-verify-modal__hint">No identity key data is available for this conversation yet.</p>
            )}
          </div>
        </Modal>
      )}

      {/* ── Image lightbox ───────────────────────── */}
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}

      {/* ── Camera capture modal ────────────────── */}
      {showCamera && (
        <CameraCapture
          onCapture={file => addFiles([file])}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* ── Lock screen settings modal ──────────── */}
      {showLockSettings && activeConversationKey && (
        <LockScreenSettings
          convId={activeConversationKey}
          onClose={() => setShowLockSettings(false)}
        />
      )}

      {/* ── Delete message confirm ──────────────── */}
      <ConfirmDialog
        open={!!deleteMsgConfirm}
        title="Delete message?"
        destructive
        confirmLabel="Delete"
        message="This message will be removed for you and anyone it was sent to. This cannot be undone."
        onConfirm={() => {
          const msgId = deleteMsgConfirm;
          setDeleteMsgConfirm(null);
          if (!msgId || !activeId || !activeConversationKey) return;
          deleteMessage(activeConversationKey, msgId);
          const c = conversations[activeId];
          if (c && c.type === 'dm') {
            const recipient = getConversationMembers(c).find((memberId) => memberId !== userId);
            if (recipient) ws.sendDeleteMessage(recipient, msgId, activeConversationKey);
          } else if (c && c.type === 'group') {
            const recipients = getConversationMembers(c).filter((memberId) => memberId !== userId);
            ws.sendDeleteMessage(null, msgId, activeConversationKey, recipients);
          }
        }}
        onCancel={() => setDeleteMsgConfirm(null)}
      />

      <CallOverlay />
    </div>
  );
}
