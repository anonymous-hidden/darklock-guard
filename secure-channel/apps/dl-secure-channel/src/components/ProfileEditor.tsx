/* ──────────────────────────────────────────────────────────
 *  ProfileEditor — Discord-style profile builder with
 *  PFP, banner, bio, pronouns, links, color picker, preview
 * ────────────────────────────────────────────────────────── */

import React, { useState, useRef } from 'react';
import {
  useProfileStore,
  COLOR_PRESETS,
  type CustomStatusClearAfter,
  type ProfileLink,
} from '../stores/profileStore';
import { useTagStore, TAG_MAP, CATEGORY_LABELS, type TagCategory } from '../stores/tagStore';
import { useAuthStore } from '../stores/authStore';
import { useConnectionStore } from '../stores/connectionStore';
import { Button, Input, TextArea, Avatar, Badge, ConfirmDialog, Modal } from './Shared';
import { CustomStatusBubble } from './CustomStatusBubble';
import { SpotifyActivityCard } from './SpotifyActivityCard';
import { EmojiPicker } from './EmojiPicker';
import {
  Camera, Image, User, Link, Trash, Plus, X, Globe,
  Palette, Check, MoreVertical, } from './Icons';
import './ProfileEditor.css';

/* ── Display Name font definitions ─────────────────────── */
export interface NameFontDef {
  id: string;
  label: string;
  fontFamily: string;
  fontWeight?: number;
  letterSpacing?: string;
  fontStyle?: string;
}

export const NAME_FONTS: NameFontDef[] = [
  { id: 'default',  label: 'Default',  fontFamily: 'Inter, system-ui, sans-serif' },
  { id: 'serif',    label: 'Serif',    fontFamily: 'Georgia, "Times New Roman", serif' },
  { id: 'mono',     label: 'Mono',     fontFamily: '"JetBrains Mono", "Fira Code", monospace' },
  { id: 'rounded',  label: 'Rounded',  fontFamily: 'system-ui, sans-serif', fontWeight: 700, letterSpacing: '0.03em' },
  { id: 'italic',   label: 'Italic',   fontFamily: 'Inter, system-ui, sans-serif', fontStyle: 'italic', fontWeight: 600 },
  { id: 'display',  label: 'Display',  fontFamily: '"Segoe UI", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.03em' },
];

export const NAME_FONT_MAP: Record<string, NameFontDef> = {};
for (const f of NAME_FONTS) NAME_FONT_MAP[f.id] = f;

/** Returns CSS properties for a given font ID */
export function getNameFontStyle(fontId: string): React.CSSProperties {
  const f = NAME_FONT_MAP[fontId] ?? NAME_FONT_MAP['default'];
  return {
    fontFamily: f.fontFamily,
    fontWeight: f.fontWeight,
    letterSpacing: f.letterSpacing,
    fontStyle: f.fontStyle,
  };
}

/* ── Nameplate definitions ─────────────────────────────── */
export interface NameplateDef {
  id: string;
  label: string;
  gradient: string;        // CSS gradient for the nameplate bar
  textColor?: string;
}

export const NAMEPLATES: NameplateDef[] = [
  { id: 'none',       label: 'None',       gradient: 'transparent' },
  { id: 'ocean',      label: 'Ocean',      gradient: 'linear-gradient(90deg, #0077b6, #00b4d8, #90e0ef)' },
  { id: 'sunset',     label: 'Sunset',     gradient: 'linear-gradient(90deg, #ff6b6b, #ee5a24, #f0932b)' },
  { id: 'aurora',     label: 'Aurora',      gradient: 'linear-gradient(90deg, #a18cd1, #fbc2eb, #a6c1ee)' },
  { id: 'emerald',    label: 'Emerald',    gradient: 'linear-gradient(90deg, #11998e, #38ef7d)' },
  { id: 'cosmic',     label: 'Cosmic',     gradient: 'linear-gradient(90deg, #7f00ff, #e100ff, #7f00ff)' },
  { id: 'flame',      label: 'Flame',      gradient: 'linear-gradient(90deg, #f12711, #f5af19)' },
  { id: 'midnight',   label: 'Midnight',   gradient: 'linear-gradient(90deg, #0f0c29, #302b63, #24243e)', textColor: '#c4b5fd' },
  { id: 'sakura',     label: 'Sakura',     gradient: 'linear-gradient(90deg, #fbc2eb, #a6c1ee)' },
  { id: 'neon',       label: 'Neon',       gradient: 'linear-gradient(90deg, #00f260, #0575e6)' },
  { id: 'gold',       label: 'Gold',       gradient: 'linear-gradient(90deg, #f7971e, #ffd200)', textColor: '#1a1a1a' },
  { id: 'arctic',     label: 'Arctic',     gradient: 'linear-gradient(90deg, #e0eafc, #cfdef3)', textColor: '#1a1a2e' },
  { id: 'lava',       label: 'Lava',       gradient: 'linear-gradient(90deg, #c31432, #240b36)' },
  { id: 'forest',     label: 'Forest',     gradient: 'linear-gradient(90deg, #134e5e, #71b280)' },
  { id: 'cyberpunk',  label: 'Cyberpunk',  gradient: 'linear-gradient(90deg, #fc00ff, #00dbde)' },
  { id: 'darklock',   label: 'Ridgeline',  gradient: 'linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7)' },
];

export const NAMEPLATE_MAP: Record<string, NameplateDef> = {};
for (const np of NAMEPLATES) NAMEPLATE_MAP[np.id] = np;

const MAX_AVATAR_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_BANNER_SIZE = 15 * 1024 * 1024; // 15 MB
// GIFs are preserved instead of being canvas-compressed so animation survives.
// The profile relay limits data URLs, so animated banners need a tighter cap.
const MAX_ANIMATED_BANNER_SIZE = 350 * 1024; // 350 KB
const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';
const ACCEPTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const DISPLAY_NAME_MAX_LENGTH = 32;
const MAX_BIO_LENGTH = 190;
const MAX_STATUS_LENGTH = 80;
const MAX_LINKS = 5;
/** Relay server rejects profile fields > 512 000 chars.
 *  We target well under that after base64 data-URL overhead. */
const MAX_DATA_URL_CHARS = 480_000;

const PRONOUN_OPTIONS = [
  '', 'he/him', 'she/her', 'they/them', 'he/they', 'she/they',
  'any/all', 'ask me',
];

const STATUS_CLEAR_AFTER_OPTIONS: { value: CustomStatusClearAfter; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'end_of_today', label: 'End of today' },
];

interface ProfileDraftSnapshot {
  displayName: string;
  avatar: string | null;
  banner: string | null;
  bannerFit: 'cover' | 'contain';
  bio: string;
  pronouns: string;
  customStatus: string;
  customStatusClearAfter: CustomStatusClearAfter;
  links: ProfileLink[];
  usernameColor: string;
  accentColor: string;
  accentColor2: string;
  gradientAngle: number;
  selectedTags: string[];
  nameplate: string;
  displayNameFont: string;
  sectionOrder: string[];
}

function buildProfileSnapshot(profile: ReturnType<typeof useProfileStore.getState>): ProfileDraftSnapshot {
  return {
    displayName: profile.displayName,
    avatar: profile.avatar,
    banner: profile.banner,
    bannerFit: profile.bannerFit,
    bio: profile.bio,
    pronouns: profile.pronouns,
    customStatus: profile.customStatus,
    customStatusClearAfter: profile.customStatusClearAfter,
    links: profile.links.map(link => ({ ...link })),
    usernameColor: profile.usernameColor,
    accentColor: profile.accentColor,
    accentColor2: profile.accentColor2,
    gradientAngle: profile.gradientAngle,
    selectedTags: [...profile.selectedTags],
    nameplate: profile.nameplate,
    displayNameFont: profile.displayNameFont,
    sectionOrder: [...profile.sectionOrder],
  };
}

function serializeProfileSnapshot(snapshot: ProfileDraftSnapshot): string {
  return JSON.stringify(snapshot);
}

function restoreProfileSnapshot(profile: ReturnType<typeof useProfileStore.getState>, snapshot: ProfileDraftSnapshot) {
  profile.setDisplayName(snapshot.displayName);
  profile.setAvatar(snapshot.avatar);
  profile.setBanner(snapshot.banner);
  profile.setBannerFit(snapshot.bannerFit);
  profile.setBio(snapshot.bio);
  profile.setPronouns(snapshot.pronouns);
  profile.setCustomStatus(snapshot.customStatus);
  profile.setCustomStatusExpiry(profile.customStatusExpiresAt, snapshot.customStatusClearAfter);
  profile.setLinks(snapshot.links);
  profile.setUsernameColor(snapshot.usernameColor);
  profile.setAccentColor(snapshot.accentColor);
  profile.setAccentColor2(snapshot.accentColor2);
  profile.setGradientAngle(snapshot.gradientAngle);
  profile.setSelectedTags(snapshot.selectedTags);
  profile.setNameplate(snapshot.nameplate);
  profile.setDisplayNameFont(snapshot.displayNameFont);
  profile.setSectionOrder(snapshot.sectionOrder);
}

function validateProfileImage(file: File, maxSize: number, label: string): string | null {
  if (!ACCEPTED_IMAGE_MIME_TYPES.has(file.type)) {
    return `${label} must be a PNG, JPG, WebP, or GIF image.`;
  }
  if (file.size > maxSize) {
    return `${label} must be ${Math.round(maxSize / 1024 / 1024)} MB or smaller.`;
  }
  return null;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function hasGifSignature(file: File): Promise<boolean> {
  const header = new Uint8Array(await file.slice(0, 6).arrayBuffer());
  const signature = String.fromCharCode(...header);
  return signature === 'GIF87a' || signature === 'GIF89a';
}

/**
 * Compress an image so its data-URL fits within the relay's 512 KB limit.
 * Draws to a canvas, progressively lowering quality and dimensions until
 * the resulting JPEG data-URL is under MAX_DATA_URL_CHARS.
 */
function compressImageToDataURL(
  file: File,
  maxDim: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      // Scale down so the longest edge is ≤ maxDim
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);

      // Try decreasing quality until we fit
      for (let q = 0.85; q >= 0.3; q -= 0.1) {
        const dataUrl = canvas.toDataURL('image/jpeg', q);
        if (dataUrl.length <= MAX_DATA_URL_CHARS) {
          URL.revokeObjectURL(url);
          resolve(dataUrl);
          return;
        }
      }
      // Last resort: scale down further
      const small = document.createElement('canvas');
      small.width = Math.round(w * 0.5);
      small.height = Math.round(h * 0.5);
      small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height);
      const smallDataUrl = small.toDataURL('image/jpeg', 0.6);
      URL.revokeObjectURL(url);
      if (smallDataUrl.length <= MAX_DATA_URL_CHARS) {
        resolve(smallDataUrl);
      } else {
        reject(new Error('Image is too large to save as a profile image'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

/* ── Name Style Modal ──────────────────────────────────── */
function NameStyleModal({ onClose }: { onClose: () => void }) {
  const profile = useProfileStore();
  const [tab, setTab] = useState<'style' | 'color'>('style');

  // Close on backdrop click or Escape
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ns-modal-backdrop" onClick={handleBackdrop}>
      <div className="ns-modal" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="ns-modal__header">
          <span className="ns-modal__title">Display Name Style</span>
          <button className="ns-modal__close" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Live preview */}
        <div className="ns-modal__preview">
          <span
            className="ns-modal__preview-name"
            style={{ color: profile.usernameColor, ...getNameFontStyle(profile.displayNameFont) }}
          >
            {profile.displayName || 'Your Name'}
          </span>
        </div>

        {/* Tabs */}
        <div className="ns-modal__tabs">
          <button
            className={`ns-modal__tab ${tab === 'style' ? 'ns-modal__tab--active' : ''}`}
            onClick={() => setTab('style')}
          >
            Style
          </button>
          <button
            className={`ns-modal__tab ${tab === 'color' ? 'ns-modal__tab--active' : ''}`}
            onClick={() => setTab('color')}
          >
            Color
          </button>
        </div>

        {/* Tab: Style */}
        {tab === 'style' && (
          <div className="ns-modal__body">
            <div className="profile-editor__name-fonts">
              {NAME_FONTS.map((f) => (
                <button
                  key={f.id}
                  className={`profile-editor__name-font-card ${profile.displayNameFont === f.id ? 'profile-editor__name-font-card--active' : ''}`}
                  onClick={() => profile.setDisplayNameFont(f.id)}
                >
                  <span
                    className="profile-editor__name-font-preview"
                    style={{
                      fontFamily: f.fontFamily,
                      fontWeight: f.fontWeight,
                      letterSpacing: f.letterSpacing,
                      fontStyle: f.fontStyle,
                      color: profile.usernameColor,
                    }}
                  >
                    {profile.displayName || 'Name'}
                  </span>
                  <span className="profile-editor__name-font-label">{f.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Color */}
        {tab === 'color' && (
          <div className="ns-modal__body">
            <div className="profile-editor__colors">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  className={`profile-editor__color-swatch ${profile.usernameColor === color ? 'profile-editor__color-swatch--active' : ''}`}
                  style={{ background: color }}
                  onClick={() => profile.setUsernameColor(color)}
                >
                  {profile.usernameColor === color && <Check size={12} />}
                </button>
              ))}
            </div>
            <div className="ns-modal__custom-color">
              <input
                type="color"
                value={profile.usernameColor}
                onChange={e => profile.setUsernameColor(e.target.value)}
                className="ns-modal__color-input"
              />
              <span>Custom color</span>
              <span className="ns-modal__color-hex">{profile.usernameColor}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfileEditor() {
  const profile = useProfileStore();
  const sessionToken = useAuthStore(s => s.sessionToken);
  const idsUrl = useConnectionStore(s => s.idsUrl);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerImageInputRef = useRef<HTMLInputElement>(null);
  const currentSnapshot = serializeProfileSnapshot(buildProfileSnapshot(profile));

  const [editingLink, setEditingLink] = useState<{ label: string; url: string } | null>(null);
  const [showNameStyle, setShowNameStyle] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusEditorOpen, setStatusEditorOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [bannerPickerOpen, setBannerPickerOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [pendingGifUrl, setPendingGifUrl] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(currentSnapshot);
  const [saveBaselinePending, setSaveBaselinePending] = useState(false);
  const hasUnsavedChanges = currentSnapshot !== savedSnapshot;

  const chooseBannerImage = () => {
    setBannerPickerOpen(false);
    window.setTimeout(() => {
      bannerImageInputRef.current?.click();
    }, 0);
  };

  const prepareGifBanner = (url: string) => setPendingGifUrl(url);

  React.useEffect(() => {
    if (!saveBaselinePending) return;
    // Capture after the store has applied any server-normalized profile values.
    setSavedSnapshot(currentSnapshot);
    setSaveBaselinePending(false);
  }, [currentSnapshot, saveBaselinePending]);

  React.useEffect(() => {
    if (!saveMessage) return;
    const timeout = window.setTimeout(() => setSaveMessage(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [saveMessage]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const error = validateProfileImage(file, MAX_AVATAR_SIZE, 'Avatar');
    if (error) {
      setUploadError(error);
      e.target.value = '';
      return;
    }
    try {
      const dataUrl = await compressImageToDataURL(file, 512);
      profile.setAvatar(dataUrl);
      setUploadError('');
      e.target.value = '';
    } catch {
      setUploadError('Avatar could not be processed. Try a smaller image.');
      e.target.value = '';
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const error = validateProfileImage(file, MAX_BANNER_SIZE, 'Banner');
    if (error) {
      setUploadError(error);
      e.target.value = '';
      return;
    }
    try {
      const isGif = file.type === 'image/gif';
      if (isGif && file.size > MAX_ANIMATED_BANNER_SIZE) {
        throw new Error('Animated GIF banners must be 350 KB or smaller.');
      }
      if (isGif && !(await hasGifSignature(file))) {
        throw new Error('Banner must be a valid GIF image.');
      }

      // Canvas export converts GIFs to a single JPEG frame. Keep GIF data as
      // is so it remains animated wherever the profile banner is rendered.
      const dataUrl = isGif
        ? await readFileAsDataURL(file)
        : await compressImageToDataURL(file, 900);
      if (dataUrl.length > MAX_DATA_URL_CHARS) {
        throw new Error('Banner is too large to save. Try a smaller image.');
      }
      profile.setBanner(dataUrl);
      setUploadError('');
      e.target.value = '';
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Banner could not be processed. Try a smaller image.');
      e.target.value = '';
    }
  };

  const handleAddLink = () => {
    if (!editingLink || !editingLink.label.trim() || !editingLink.url.trim()) return;
    if (profile.links.length >= MAX_LINKS) return;
    let url = editingLink.url.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    profile.addLink(editingLink.label.trim(), url);
    setEditingLink(null);
  };

  const handleResetChanges = () => {
    restoreProfileSnapshot(profile, JSON.parse(savedSnapshot) as ProfileDraftSnapshot);
    setUploadError('');
  };

  const handleSaveChanges = async () => {
    const customStatus = profile.customStatus.trim();
    setSavingStatus(true);
    setUploadError('');
    try {
      if (!sessionToken) throw new Error('Sign in again to save your profile.');
      const profileResponse = await fetch(idsUrl + '/users/me/profile', {
        method: 'PUT',
        signal: AbortSignal.timeout(8_000),
        headers: {
          Authorization: 'Bearer ' + sessionToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profile_bio: profile.bio,
          pronouns: profile.pronouns,
          custom_status: customStatus,
          profile_color: profile.accentColor,
          avatar: profile.avatar,
          banner: profile.banner,
          banner_fit: profile.bannerFit,
        }),
      });
      const profileResult = await profileResponse.json().catch(() => null);
      if (!profileResponse.ok) throw new Error(profileResult?.error || 'Could not save profile changes.');

      const statusResponse = await fetch(idsUrl + '/users/me/profile/status', {
        method: 'PATCH',
        signal: AbortSignal.timeout(8_000),
        headers: {
          Authorization: 'Bearer ' + sessionToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          custom_status: customStatus,
          clear_after: profile.customStatusClearAfter,
        }),
      });
      const result = await statusResponse.json().catch(() => null);
      if (statusResponse.ok) {
        profile.setCustomStatus(result?.custom_status ?? '');
        profile.setCustomStatusExpiry(result?.custom_status_expires_at ?? null, profile.customStatusClearAfter);
      }
      setSaveBaselinePending(true);
      setSaveMessage('Profile changes saved');
      return true;
    } catch (error) {
      setUploadError(error instanceof DOMException && error.name === 'TimeoutError'
        ? 'Could not reach the IDS server. Check that 100.84.62.66:4100 is online, then try again.'
        : error instanceof Error ? error.message : 'Could not save profile changes.');
      return false;
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <div className="profile-editor profile-editor--split">
      {/* ── Left: edit form ──────────────────── */}
      {showAdvanced && (
      <div
        className="profile-editor__details-backdrop"
        role="presentation"
        onMouseDown={() => setShowAdvanced(false)}
      >
      <div
        className="profile-editor__form profile-editor__form--advanced"
        role="dialog"
        aria-modal="true"
        aria-label="Edit Profile"
        onMouseDown={(event) => event.stopPropagation()}
      >
          <div className="profile-editor__details-header">
            <div>
              <span>Edit Profile</span>
              <small>Update your Ridgeline identity.</small>
            </div>
            <button
              type="button"
              className="profile-editor__details-close"
              onClick={() => setShowAdvanced(false)}
              aria-label="Close profile editor"
            >
              <X size={16} />
            </button>
          </div>
          {/* ── Banner ─────────────────────────── */}
          <div className="profile-editor__banner-section">
            <h3><Image size={14} /> Banner <span className="profile-editor__banner-format">GIFs animate</span></h3>
            <div
              className="profile-editor__banner"
              style={profile.banner ? { backgroundImage: `url(${profile.banner})`, backgroundSize: profile.bannerFit } : { background: `linear-gradient(${profile.gradientAngle}deg, ${profile.accentColor}, ${profile.accentColor2 || profile.accentColor + '88'})` }}
              onClick={() => setBannerPickerOpen(true)}
            >
              <div className="profile-editor__banner-overlay">
                <Camera size={20} />
                <span>Change Banner</span>
              </div>
            </div>
            {profile.banner && (
              <button className="profile-editor__remove-btn" onClick={() => profile.setBanner(null)}>
                <Trash size={12} /> Remove Banner
              </button>
            )}
          </div>

          {/* ── Avatar ─────────────────────────── */}
          {uploadError && (
            <div className="profile-editor__notice profile-editor__notice--error">
              {uploadError}
            </div>
          )}

          <div className="profile-editor__avatar-section">
            <h3><User size={14} /> Avatar</h3>
            <div className="profile-editor__avatar-row">
              <div
                className="profile-editor__avatar"
                onClick={() => avatarInputRef.current?.click()}
              >
                {profile.avatar ? (
                  <img src={profile.avatar} alt="Avatar" className="profile-editor__avatar-img" />
                ) : (
                  <Avatar name={profile.displayName || profile.username || 'User'} size={80} />
                )}
                <div className="profile-editor__avatar-overlay">
                  <Camera size={16} />
                </div>
              </div>
              <div className="profile-editor__avatar-actions">
                <Button size="sm" variant="primary" onClick={() => avatarInputRef.current?.click()}>
                  <Camera size={12} /> Upload Avatar
                </Button>
                {profile.avatar && (
                  <Button size="sm" variant="ghost" onClick={() => profile.setAvatar(null)}>
                    <Trash size={12} /> Remove
                  </Button>
                )}
              </div>
            </div>
            <div className="profile-editor__custom-status-anchor">
              <CustomStatusBubble
                status={profile.customStatus}
                onClick={() => setStatusEditorOpen(true)}
              />
              {statusEditorOpen && (
                <div className="profile-editor__status-popover" role="dialog" aria-label="Custom status">
                  <div className="profile-editor__status-popover-heading">Custom Status</div>
                  <Input
                    autoFocus
                    placeholder="What\'s your hot take?"
                    value={profile.customStatus}
                    onChange={(e) => profile.setCustomStatus(e.target.value.slice(0, MAX_STATUS_LENGTH))}
                    maxLength={MAX_STATUS_LENGTH}
                  />
                  <div className="profile-editor__status-popover-meta">
                    <span>{profile.customStatus.length}/{MAX_STATUS_LENGTH}</span>
                    <select
                      className="settings-select profile-editor__status-expiry"
                      aria-label="Clear custom status after"
                      value={profile.customStatusClearAfter}
                      onChange={(e) => profile.setCustomStatusExpiry(
                        profile.customStatusExpiresAt,
                        e.target.value as CustomStatusClearAfter,
                      )}
                    >
                      {STATUS_CLEAR_AFTER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="profile-editor__status-popover-actions">
                    {profile.customStatus && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          profile.setCustomStatus('');
                          profile.setCustomStatusExpiry(null, 'never');
                        }}
                      >
                        Clear
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setStatusEditorOpen(false)}>Cancel</Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={savingStatus}
                      onClick={async () => {
                        if (await handleSaveChanges()) setStatusEditorOpen(false);
                      }}
                    >
                      {savingStatus ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              onChange={handleAvatarUpload}
              hidden
            />
          </div>

          {/* ── Display Name ───────────────────── */}
          <div className="profile-editor__field">
            <Input
              label="Display Name"
              placeholder="How others see your name"
              value={profile.displayName}
              onChange={(e) => profile.setDisplayName(e.target.value.slice(0, DISPLAY_NAME_MAX_LENGTH))}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
            />
          </div>

          {/* ── Display Name Style ─────────────── */}
          <div className="profile-editor__field">
            <button
              className="profile-editor__name-style-btn"
              onClick={() => setShowNameStyle(true)}
            >
              <span
                className="profile-editor__name-style-preview"
                style={{ color: profile.usernameColor, ...getNameFontStyle(profile.displayNameFont) }}
              >
                {profile.displayName || 'Your Name'}
              </span>
              <span className="profile-editor__name-style-hint">
                <Palette size={13} /> Customize style &amp; color
              </span>
            </button>
          </div>

          {/* ── Bio ────────────────────────────── */}
          <div className="profile-editor__field">
            <label className="dl-input-label">Bio</label>
            <TextArea
              placeholder="Tell the world a bit about yourself"
              value={profile.bio}
              onChange={(e) => {
                if (e.target.value.length <= MAX_BIO_LENGTH) profile.setBio(e.target.value);
              }}
              rows={3}
              maxLength={MAX_BIO_LENGTH}
            />
            <span className="profile-editor__char-count">
              {profile.bio.length}/{MAX_BIO_LENGTH}
            </span>
          </div>

          {/* ── Pronouns ───────────────────────── */}
          <div className="profile-editor__field">
            <label className="dl-input-label">Pronouns</label>
            <select
              className="settings-select profile-editor__select"
              value={profile.pronouns}
              onChange={(e) => profile.setPronouns(e.target.value)}
            >
              <option value="">Don&apos;t specify</option>
              {PRONOUN_OPTIONS.filter(Boolean).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* ── Accent Color ───────────────────── */}
          <div className="profile-editor__field">
            <label className="dl-input-label"><Palette size={12} /> Profile Accent</label>
            <div className="profile-editor__colors">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  className={`profile-editor__color-swatch ${profile.accentColor === color ? 'profile-editor__color-swatch--active' : ''}`}
                  style={{ background: color }}
                  onClick={() => profile.setAccentColor(color)}
                >
                  {profile.accentColor === color && <Check size={12} />}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                value={profile.accentColor}
                onChange={e => profile.setAccentColor(e.target.value)}
                className="profile-editor__custom-color"
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--dl-text-secondary)' }}>Custom</span>
            </div>
          </div>

          {/* ── Links ──────────────────────────── */}
          <div className="profile-editor__field">
            <label className="dl-input-label"><Globe size={12} /> Links</label>
            <div className="profile-editor__links">
              {profile.links.map((link) => (
                <div key={link.id} className="profile-editor__link-item">
                  <Link size={12} />
                  <span className="profile-editor__link-label">{link.label}</span>
                  <span className="profile-editor__link-url">{link.url}</span>
                  <button
                    className="profile-editor__link-remove"
                    onClick={() => profile.removeLink(link.id)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}

              {editingLink ? (
                <div className="profile-editor__link-form">
                  <Input
                    placeholder="Label (e.g. GitHub)"
                    value={editingLink.label}
                    onChange={(e) => setEditingLink({ ...editingLink, label: e.target.value })}
                    maxLength={30}
                  />
                  <Input
                    placeholder="https://..."
                    value={editingLink.url}
                    onChange={(e) => setEditingLink({ ...editingLink, url: e.target.value })}
                    maxLength={200}
                  />
                  <div className="profile-editor__link-form-actions">
                    <Button size="sm" variant="ghost" onClick={() => setEditingLink(null)}>Cancel</Button>
                    <Button size="sm" variant="primary" onClick={handleAddLink}>Add</Button>
                  </div>
                </div>
              ) : profile.links.length < MAX_LINKS ? (
                <Button size="sm" variant="ghost" onClick={() => setEditingLink({ label: '', url: '' })}>
                  <Plus size={12} /> Add Link
                </Button>
              ) : null}
            </div>
          </div>

          {/* ── Profile Tags ───────────────────── */}
          <TagPicker />
          {hasUnsavedChanges && (
            <div className="profile-editor__save-bar">
              <div className="profile-editor__save-copy">
                <span>Unsaved profile changes</span>
                <small>Review the live preview, then save or reset.</small>
              </div>
              <div className="profile-editor__save-actions">
                <Button size="sm" variant="ghost" onClick={handleResetChanges}>Reset</Button>
                <Button size="sm" variant="primary" onClick={handleSaveChanges} disabled={savingStatus}>
                  {savingStatus ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          )}
        </div>
        </div>

      )}
        {/* ── Right: live preview ─────────────── */}
        <div className="profile-editor__preview-pane">
          <input
            ref={bannerImageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleBannerUpload}
            hidden
          />
          <input
            ref={avatarInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            onChange={handleAvatarUpload}
            hidden
          />
          <ProfilePreview
            onBannerClick={() => setBannerPickerOpen(true)}
            onRemoveBanner={() => profile.setBanner(null)}
            onAvatarClick={() => avatarInputRef.current?.click()}
            onRemoveAvatar={() => profile.setAvatar(null)}
            onStatusClick={() => setStatusEditorOpen(true)}
            onOpenDetails={() => setShowAdvanced((open) => !open)}
            onCustomize={() => setShowNameStyle(true)}
          />
          {statusEditorOpen && (
            <div className="profile-editor__status-popover profile-editor__status-popover--card" role="dialog" aria-label="Custom status">
              <div className="profile-editor__status-popover-heading">Custom Status</div>
              <Input
                autoFocus
                placeholder="What's your hot take?"
                value={profile.customStatus}
                onChange={(e) => profile.setCustomStatus(e.target.value.slice(0, MAX_STATUS_LENGTH))}
                maxLength={MAX_STATUS_LENGTH}
              />
              <div className="profile-editor__status-popover-meta">
                <span>{profile.customStatus.length}/{MAX_STATUS_LENGTH}</span>
                <select
                  className="settings-select profile-editor__status-expiry"
                  aria-label="Clear custom status after"
                  value={profile.customStatusClearAfter}
                  onChange={(e) => profile.setCustomStatusExpiry(
                    profile.customStatusExpiresAt,
                    e.target.value as CustomStatusClearAfter,
                  )}
                >
                  {STATUS_CLEAR_AFTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="profile-editor__status-popover-actions">
                {profile.customStatus && (
                  <Button size="sm" variant="ghost" onClick={() => {
                    profile.setCustomStatus('');
                    profile.setCustomStatusExpiry(null, 'never');
                  }}>
                    Clear
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setStatusEditorOpen(false)}>Cancel</Button>
                <Button size="sm" variant="primary" disabled={savingStatus} onClick={async () => {
                  if (await handleSaveChanges()) setStatusEditorOpen(false);
                }}>
                  {savingStatus ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          )}
        </div>
        {hasUnsavedChanges && (
          <div className="profile-editor__save-bar profile-editor__save-bar--card">
            <div className="profile-editor__save-copy">
              <span>Unsaved profile changes</span>
              <small>Save your Ridgeline identity updates.</small>
            </div>
            <div className="profile-editor__save-actions">
              <Button size="sm" variant="ghost" onClick={handleResetChanges}>Reset</Button>
              <Button size="sm" variant="primary" onClick={handleSaveChanges} disabled={savingStatus}>
                {savingStatus ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        )}
        <Modal
          open={bannerPickerOpen}
          onClose={() => setBannerPickerOpen(false)}
          title="Change banner"
          width={460}
          footer={<Button size="sm" variant="ghost" onClick={() => setBannerPickerOpen(false)}>Cancel</Button>}
        >
          <div className="profile-editor__banner-picker">
            <p>Choose an image for your profile banner, or use a lightweight animated GIF.</p>
            <div className="profile-editor__banner-picker-options">
              <button type="button" className="profile-editor__banner-choice" onClick={chooseBannerImage}>
                <span className="profile-editor__banner-choice-icon"><Image size={18} /></span>
                <span><strong>Upload image</strong><small>PNG, JPG, or WebP</small></span>
              </button>
              <button type="button" className="profile-editor__banner-choice" onClick={() => { setBannerPickerOpen(false); setGifPickerOpen(true); }}>
                <span className="profile-editor__banner-choice-icon"><Camera size={18} /></span>
                <span><strong>Choose animated GIF</strong><small>GIF only, up to 350 KB</small></span>
              </button>
            </div>
          </div>
        </Modal>
        <Modal
          open={gifPickerOpen}
          onClose={() => { setGifPickerOpen(false); setPendingGifUrl(null); }}
          title="Choose animated GIF"
          width={520}
        >
          {pendingGifUrl ? (
            <div className="profile-editor__gif-fit-warning">
              <img src={pendingGifUrl} alt="Selected GIF banner preview" />
              <div>
                <strong>This GIF might not fit the banner.</strong>
                <p>Profile banners are wide. Filling the banner can crop the sides of a tall or square GIF.</p>
              </div>
              <div className="profile-editor__gif-fit-actions">
                <Button className="profile-editor__gif-action profile-editor__gif-action--choose" size="sm" variant="ghost" onClick={() => setPendingGifUrl(null)}>Choose another</Button>
                <Button className="profile-editor__gif-action profile-editor__gif-action--crop" size="sm" variant="primary" onClick={() => {
                  profile.setBanner(pendingGifUrl);
                  profile.setBannerFit('cover');
                  setPendingGifUrl(null);
                  setGifPickerOpen(false);
                }}>Use cropped fit</Button>
                <Button className="profile-editor__gif-action profile-editor__gif-action--fit" size="sm" variant="outline" onClick={() => {
                  profile.setBanner(pendingGifUrl);
                  profile.setBannerFit('contain');
                  setPendingGifUrl(null);
                  setGifPickerOpen(false);
                }}>Auto-fit banner</Button>
              </div>
              <p className="profile-editor__gif-fit-note">Auto-fit keeps the whole GIF visible, but may leave empty space and look less polished.</p>
            </div>
          ) : (
            <>
              <EmojiPicker
                gifOnly
                embedded
                initialTab="gif"
                closeOnGifSelect={false}
                onSelectEmoji={() => undefined}
                onSelectSticker={() => undefined}
                onSelectGif={(url) => prepareGifBanner(url)}
                onClose={() => { setGifPickerOpen(false); setPendingGifUrl(null); }}
              />
            </>
          )}
        </Modal>
        {showNameStyle && (
          <NameStyleModal onClose={() => setShowNameStyle(false)} />
        )}
        {saveMessage && (
          <div className="profile-editor__notice profile-editor__notice--success" role="status">
            <Check size={15} /> {saveMessage}
          </div>
        )}
    </div>
  );
}

/* ── Banner preset legacy helpers ────────── */

/** Banner gradient presets — formerly "nameplates", now rendered as
 *  full-width banners behind the avatar in the profile card. */
function BannerPicker() {
  const profile = useProfileStore();
  return (
    <div className="profile-editor__nameplate-section">
      <h3 className="profile-editor__nameplate-heading"><Palette size={14} /> Banner Presets</h3>
      <p style={{ fontSize: '0.72rem', color: 'var(--dl-text-muted)', margin: '0 0 8px' }}>
        Choose a banner gradient for the top of your profile card. Upload a custom image above, or pick a preset.
      </p>
      <div className="profile-editor__nameplate-grid">
        {NAMEPLATES.map((np) => {
          const active = profile.nameplate === np.id || (!profile.nameplate && np.id === 'none');
          return (
            <button
              key={np.id}
              className={`profile-editor__nameplate-card${active ? ' profile-editor__nameplate-card--active' : ''}`}
              onClick={() => profile.setNameplate(np.id === 'none' ? '' : np.id)}
            >
              <div
                className="profile-editor__nameplate-bar"
                style={{ background: np.gradient }}
              />
              <span className="profile-editor__nameplate-name">{np.label}</span>
              {active && (
                <span className="profile-editor__nameplate-check"><Check size={12} /></span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Tag Picker ────────────────────────────────────────── */

function TagPicker() {
  const userId = useAuthStore(s => s.userId) ?? '';
  const userTags = useTagStore(s => s.userTags[userId] ?? []);
  const selectedTags = useProfileStore(s => s.selectedTags);
  const toggleSelectedTag = useProfileStore(s => s.toggleSelectedTag);

  // Show all tags the user has been given
  const availableTags = userTags.map(id => TAG_MAP[id]).filter(Boolean);

  // Group by category
  const grouped: Partial<Record<TagCategory, typeof availableTags>> = {};
  for (const tag of availableTags) {
    (grouped[tag.category] ??= []).push(tag);
  }

  return (
    <div className="profile-editor__field">
      <label className="dl-input-label">
        Profile Tags
        <span style={{ fontWeight: 400, color: 'var(--dl-text-muted)', marginLeft: 6, fontSize: '0.75rem' }}>
          {selectedTags.length}/5 selected
        </span>
      </label>
      <p style={{ fontSize: '0.75rem', color: 'var(--dl-text-muted)', margin: '0 0 0.5rem' }}>
        Choose up to 5 tags to display on your profile
      </p>
      {availableTags.length === 0 ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--dl-text-muted)', fontStyle: 'italic' }}>
          No tags earned yet — keep using Ridgeline to unlock tags!
        </p>
      ) : (
        <div className="profile-editor__tags">
          {Object.entries(grouped).map(([cat, tags]) => (
            <div key={cat} className="profile-editor__tag-group">
              <span className="profile-editor__tag-category">{CATEGORY_LABELS[cat as TagCategory]}</span>
              <div className="profile-editor__tag-list">
                {tags!.map(tag => {
                  const isSelected = selectedTags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      className={`profile-editor__tag-pill ${isSelected ? 'profile-editor__tag-pill--selected' : ''}`}
                      style={{
                        background: isSelected ? tag.color : 'transparent',
                        color: isSelected ? (tag.textColor ?? '#fff') : tag.color,
                        borderColor: tag.color,
                      }}
                      onClick={() => toggleSelectedTag(tag.id)}
                      disabled={!isSelected && selectedTags.length >= 5}
                    >
                      {isSelected && <Check size={10} />} {tag.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Profile Preview Card ──────────────────────────────── */

/** Default section order used when store has none */
const DEFAULT_SECTION_ORDER = ['tags', 'status', 'bio', 'links'];

interface ProfilePreviewProps {
  onBannerClick?: () => void;
  onRemoveBanner?: () => void;
  onAvatarClick?: () => void;
  onRemoveAvatar?: () => void;
  onStatusClick?: () => void;
  onOpenDetails?: () => void;
  onCustomize?: () => void;
}

function safeProfileLink(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function ProfilePreview({
  onBannerClick,
  onRemoveBanner,
  onAvatarClick,
  onRemoveAvatar,
  onStatusClick,
  onOpenDetails,
  onCustomize,
}: ProfilePreviewProps) {
  const profile = useProfileStore();
  const selectedTags = useProfileStore(s => s.selectedTags);
  const sectionOrder = useProfileStore(s => s.sectionOrder) ?? DEFAULT_SECTION_ORDER;
  const setSectionOrder = useProfileStore(s => s.setSectionOrder);
  const selectedTagDefs = selectedTags.map(id => TAG_MAP[id]).filter(Boolean);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [editingPronouns, setEditingPronouns] = useState(false);
  const [pendingExternalLink, setPendingExternalLink] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const customStatusExpired = Boolean(
    profile.customStatusExpiresAt
      && new Date(profile.customStatusExpiresAt).getTime() <= now,
  );

  React.useEffect(() => {
    if (!profile.customStatusExpiresAt) return;
    const delay = new Date(profile.customStatusExpiresAt).getTime() - Date.now();
    if (delay <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = window.setTimeout(() => {
      profile.setCustomStatus('');
      profile.setCustomStatusExpiry(null, 'never');
      setNow(Date.now());
    }, delay);
    return () => window.clearTimeout(timer);
  }, [profile.customStatusExpiresAt]);

  const handleDragStart = (idx: number) => (e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverIdx(idx);
  };
  const handleDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const next = [...sectionOrder];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setSectionOrder(next);
    setDragIdx(null);
    setOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setOverIdx(null); };

  /* Section renderers keyed by id */
  const sectionMap: Record<string, React.ReactNode> = {
    tags: selectedTagDefs.length > 0 ? (
      <div className="profile-preview__tag-section">
        <h4>Profile Tags</h4>
        <div className="profile-preview__tag-list">
          {selectedTagDefs.map(tag => (
            <span
              key={tag.id}
              className="profile-preview__tag"
              style={{ background: tag.color, color: tag.textColor ?? '#fff' }}
            >
              {tag.label}
            </span>
          ))}
        </div>
      </div>
    ) : null,
    status: null,
    bio: (
      <div className="profile-preview__section">
        <div className="profile-preview__section-heading-row">
          <h4>About Me</h4>
          <button type="button" className="profile-preview__section-edit" onClick={() => setEditingBio(true)}>
            Edit
          </button>
        </div>
        {editingBio ? (
          <TextArea
            autoFocus
            value={profile.bio}
            onChange={(event) => profile.setBio(event.target.value.slice(0, MAX_BIO_LENGTH))}
            onBlur={() => setEditingBio(false)}
            rows={3}
            maxLength={MAX_BIO_LENGTH}
          />
        ) : (
          <button type="button" className="profile-preview__inline-copy" onClick={() => setEditingBio(true)}>
            <span className={profile.bio ? '' : 'profile-preview__empty-copy'}>
              {profile.bio || 'Add a short bio to introduce yourself.'}
            </span>
          </button>
        )}
      </div>
    ),
    links: (
      <div className="profile-preview__section">
        <h4>Links</h4>
        {profile.links.length > 0 ? (
          <div className="profile-preview__links">
            {profile.links.map((link) => (
            <a
              key={link.id}
              className="profile-preview__link"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              title={link.url}
              onClick={(event) => {
                event.preventDefault();
                setPendingExternalLink(safeProfileLink(link.url));
              }}
            >
              <Globe size={12} />
              <span className="profile-preview__link-label">{link.label || link.url}</span>
              <span aria-hidden="true" className="profile-preview__link-external" />
            </a>
            ))}
          </div>
        ) : (
          <button type="button" className="profile-preview__inline-copy" onClick={onOpenDetails}>
            <span className="profile-preview__empty-copy">No connections added yet. Add a link.</span>
          </button>
        )}
      </div>
    ),
  };

  /* Build ordered sections */
  const visibleSections: string[] = [];

  return (
    <div className="profile-preview">
      <div className="profile-preview__card">
        {/* Banner — uses nameplate preset gradient if set, otherwise custom banner/accent gradient */}
        <button
          type="button"
          className="profile-preview__banner"
          onClick={onBannerClick}
          style={
            profile.banner
              ? { backgroundImage: `url(${profile.banner})`, backgroundSize: profile.bannerFit }
              : profile.nameplate && NAMEPLATE_MAP[profile.nameplate]
                ? { background: NAMEPLATE_MAP[profile.nameplate].gradient }
                : { background: `linear-gradient(${profile.gradientAngle}deg, ${profile.accentColor}, ${profile.accentColor2 || profile.accentColor + '66'})` }
          }
        >
          {onBannerClick && (
            <span className="profile-preview__banner-edit">
              <Camera size={15} /> Change Banner
              {profile.banner && (
                <span
                  role="button"
                  className="profile-preview__banner-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveBanner?.();
                  }}
                >
                  Remove
                </span>
              )}
            </span>
          )}
        </button>

        {/* Avatar and custom status share one positioning anchor. */}
        <div className="profile-preview__avatar-anchor">
          <button type="button" className="profile-preview__avatar-wrap" onClick={onAvatarClick}>
            {profile.avatar ? (
              <img src={profile.avatar} alt="" className="profile-preview__avatar-img" />
            ) : (
              <Avatar name={profile.displayName || profile.username || 'User'} size={70} />
            )}
            <span className="profile-preview__status-dot" />
            {onAvatarClick && <span className="profile-preview__avatar-edit"><Camera size={15} /></span>}
            {profile.avatar && (
              <span
                role="button"
                className="profile-preview__avatar-remove"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveAvatar?.();
                }}
              >
                <Trash size={12} />
              </span>
            )}
          </button>
          <div className="profile-preview__status-bubble">
            <CustomStatusBubble
              status={customStatusExpired ? '' : profile.customStatus}
              onClick={onStatusClick}
            />
          </div>
        </div>

        {/* Info */}
          <div className="profile-preview__body">
          <div className="profile-preview__names">
            <div className="profile-preview__identity-line">
              {editingName ? (
                <input
                  autoFocus
                  className="profile-preview__inline-name"
                  value={profile.displayName}
                  onChange={(event) => profile.setDisplayName(event.target.value.slice(0, DISPLAY_NAME_MAX_LENGTH))}
                  onBlur={() => setEditingName(false)}
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                />
              ) : (
                <button
                  type="button"
                  className="profile-preview__display-name profile-preview__display-name--editable"
                  style={{ color: profile.usernameColor }}
                  onClick={() => setEditingName(true)}
                >
                  {profile.displayName || 'Display Name'}
                </button>
              )}
              {editingPronouns ? (
                <select
                  autoFocus
                  className="settings-select profile-preview__inline-pronouns"
                  value={profile.pronouns}
                  onChange={(event) => profile.setPronouns(event.target.value)}
                  onBlur={() => setEditingPronouns(false)}
                >
                  <option value="">Add pronouns</option>
                  {PRONOUN_OPTIONS.filter(Boolean).map((pronouns) => (
                    <option key={pronouns} value={pronouns}>{pronouns}</option>
                  ))}
                </select>
              ) : (
                <button type="button" className="profile-preview__pronouns-edit" onClick={() => setEditingPronouns(true)}>
                  {profile.pronouns ? <Badge variant="default">{profile.pronouns}</Badge> : 'Add pronouns'}
                </button>
              )}
            </div>
            {profile.username && (
              <span className="profile-preview__username">@{profile.username}</span>
            )}
            {selectedTagDefs.length > 0 && (
              <div className="profile-preview__tag-list profile-preview__tag-list--identity">
                {selectedTagDefs.map(tag => (
                  <span key={tag.id} className="profile-preview__tag" style={{ background: tag.color, color: tag.textColor ?? '#fff' }}>
                    {tag.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="profile-preview__actions profile-preview__actions--legacy">
            <button type="button" className="profile-preview__action profile-preview__action--primary" onClick={onOpenDetails}>
              Edit Profile
            </button>
            <button type="button" className="profile-preview__action profile-preview__action--more" onClick={onCustomize} aria-label="More profile options" title="More profile options">
              <MoreVertical size={16} />
            </button>
          </div>

          {sectionMap.bio}
          <SpotifyActivityCard compact popover />
          {sectionMap.links}
          <div className="profile-preview__actions">
            <button type="button" className="profile-preview__action profile-preview__action--primary" onClick={onOpenDetails}>
              Edit Profile
            </button>
            <button type="button" className="profile-preview__action profile-preview__action--more" onClick={onCustomize} aria-label="More profile options" title="More profile options">
              <MoreVertical size={16} />
            </button>
          </div>

          {/* Reorderable sections */}
          {visibleSections.map((sectionId, idx) => (
            <div
              key={sectionId}
              className={`profile-preview__drag-section${dragIdx === idx ? ' profile-preview__drag-section--dragging' : ''}${overIdx === idx ? ' profile-preview__drag-section--over' : ''}`}
              draggable
              onDragStart={handleDragStart(idx)}
              onDragOver={handleDragOver(idx)}
              onDrop={handleDrop(idx)}
              onDragEnd={handleDragEnd}
            >
              <div className="profile-preview__drag-handle" title="Drag to reorder">⠿</div>
              <div className="profile-preview__divider" />
              {sectionMap[sectionId]}
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={pendingExternalLink !== null}
        title="Open external link?"
        message={<>You are about to leave Darklock for an untrusted external link: <strong>{pendingExternalLink}</strong></>}
        confirmLabel="Open Link"
        onCancel={() => setPendingExternalLink(null)}
        onConfirm={() => {
          if (pendingExternalLink) window.open(pendingExternalLink, '_blank', 'noopener,noreferrer');
          setPendingExternalLink(null);
        }}
      />

    </div>
  );
}
