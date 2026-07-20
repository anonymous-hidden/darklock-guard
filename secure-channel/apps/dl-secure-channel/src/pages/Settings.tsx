import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  useSettingsStore,
  APP_BODY_BACKGROUND_CSS,
  SIDEBAR_BACKGROUND_CSS,
  resolveAppBodyBackground,
  resolveSidebarBackground,
  type ShellBackground,
} from '../stores/settingsStore';
import { useProfileStore } from '../stores/profileStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useUpdateStore } from '../stores/updateStore';
import {
  initCrypto, generateIdentityKey, createSignedPreKey,
  generateOneTimePreKeys, buildPreKeyBundle, toBase64,
  deriveVaultKey, generateSalt, createKdfParams,
} from '@darklock/channel-crypto';
import { saveVault, saveKdfParams } from '../crypto/vault';
import { loadVaultKeys, wipeSessions } from '../crypto/e2eeSessions';
import {
  useConvThemeStore,
  BUBBLE_RADII,
  FONT_SIZES,
  BORDER_STYLE_DEFS,
  computeBgStyle,
  hexToRgb,
} from '../stores/convThemeStore';
import {
  ArrowLeft, Shield, ShieldCheck, Lock, Key, Bell, Fingerprint, Trash, Download, User, Wifi, WifiOff, Settings as SettingsIcon, Globe,
  AlertTriangle, Refresh, Check, Palette, Monitor, ShieldAlert, Send, CheckDouble, Eye,
} from '../components/Icons';
import { Button, Modal, Badge, Avatar } from '../components/Shared';
import { AvatarWithStatus } from '../components/AvatarWithStatus';
import { ProfileEditor } from '../components/ProfileEditor';
import { getNameFontStyle } from '../components/ProfileEditor';
import { SpotifyIntegrationSettings } from '../components/SpotifyIntegrationSettings';
import { ConvPersonalize } from '../components/ConvPersonalize';
import { LockScreenSettings } from '../components/LockScreenSettings';
import { LoginSettings } from '../components/LoginSettings';
import { useLockScreenStore, type LockIconStyle } from '../stores/lockScreenStore';
import { useLoginScreenStore } from '../stores/loginScreenStore';
import './Settings.css';

type Section = 'profile' | 'general' | 'customization' | 'security' | 'privacy' | 'notifications' | 'devices' | 'integrations' | 'updates' | 'danger';
type CustomSub = 'hub' | 'chat' | 'lockscreen' | 'login' | 'settings' | 'friends';

const BG_OPTION_LABELS: Record<ShellBackground, string> = {
  default: 'Default',
  graphite: 'Graphite',
  sunset: 'Sunset',
  ocean: 'Ocean',
  forest: 'Forest',
  berry: 'Berry',
  'midnight-grid': 'Midnight',
  aurora: 'Aurora',
  ember: 'Ember',
  plum: 'Plum',
  mono: 'Mono',
  custom: 'Custom',
};

const BODY_BG_OPTIONS: ShellBackground[] = ['default', 'graphite', 'midnight-grid', 'ocean', 'aurora', 'forest', 'sunset', 'ember', 'berry', 'plum', 'mono', 'custom'];
const SIDEBAR_BG_OPTIONS: ShellBackground[] = ['default', 'graphite', 'midnight-grid', 'ocean', 'aurora', 'forest', 'sunset', 'ember', 'berry', 'plum', 'mono', 'custom'];

function parseRgb(color: string): { r: number; g: number; b: number } | null {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
      };
    }
    if (h.length >= 6) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    }
    return null;
  }

  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }

  return null;
}

function luminance(color: string): number | null {
  const rgb = parseRgb(color);
  if (!rgb) return null;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

function backgroundLuminance(background: string, fallback: string): number {
  const source = background.startsWith('var(') ? fallback : background;
  const tokens = source.match(/#[0-9a-f]{3,8}|rgba?\([^)]+\)/ig) ?? [];
  if (tokens.length === 0) return luminance(fallback) ?? 0.2;

  const values = tokens
    .map(token => luminance(token))
    .filter((value): value is number => value !== null);

  if (values.length === 0) return luminance(fallback) ?? 0.2;

  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;

  // Blend median + average so bright outliers in gradients don't skew contrast too hard.
  return (median * 0.65) + (average * 0.35);
}

function rgba(color: string, alpha: number, fallback = '99, 102, 241'): string {
  const rgb = parseRgb(color);
  if (!rgb) return `rgba(${fallback}, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/* ── Mini preview components for the Customization hub ──── */
function ChatMiniPreview() {
  const theme = useConvThemeStore(s => s.getTheme('__global__'));
  const bgStr = computeBgStyle(theme);
  const bgStyle: React.CSSProperties = bgStr
    ? (theme.bgType === 'image'
        ? { backgroundImage: bgStr.startsWith('url(') ? bgStr.replace(/^url\(["']?(.*?)["']?\).*$/, 'url("$1")') : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: bgStr })
    : {};
  const ownRadius = BUBBLE_RADII[theme.bubbleStyle]?.own ?? BUBBLE_RADII.default.own;
  const otherRadius = BUBBLE_RADII[theme.bubbleStyle]?.other ?? BUBBLE_RADII.default.other;
  const borderDef = BORDER_STYLE_DEFS[theme.msgBorder] ?? BORDER_STYLE_DEFS.none;

  function bubbleMini(isOwn: boolean): React.CSSProperties {
    const base: React.CSSProperties = {
      borderRadius: isOwn ? ownRadius : otherRadius,
      fontSize: 9,
      padding: '4px 8px',
    };
    if (theme.msgBorder !== 'none') {
      base.border = borderDef.border || undefined;
      base.backdropFilter = borderDef.backdrop || undefined;
      base.boxShadow = borderDef.glow || undefined;
    }
    if (isOwn && theme.ownColor !== 'default') base.background = theme.ownColor;
    if (!isOwn && theme.otherColor !== 'default') base.background = theme.otherColor;
    if (isOwn && theme.ownText !== 'default') base.color = theme.ownText;
    if (!isOwn && theme.otherText !== 'default') base.color = theme.otherText;
    return base;
  }

  return (
    <div className="custom-card__mini-chat" style={bgStyle}>
      <div className="custom-card__mini-bubble custom-card__mini-bubble--other" style={bubbleMini(false)}>Hey there!</div>
      <div className="custom-card__mini-bubble custom-card__mini-bubble--own" style={bubbleMini(true)}>Looks great ✨</div>
    </div>
  );
}

function LockMiniPreview() {
  return (
    <div className="custom-card__mini-lock">
      <div className="custom-card__mini-lock-icon">
        <Lock size={20} />
      </div>
      <div className="custom-card__mini-dots">
        <span /><span /><span /><span />
      </div>
    </div>
  );
}

function LoginMiniPreview() {
  return (
    <div className="custom-card__mini-login">
      <div className="custom-card__mini-login-card">
        <div className="custom-card__mini-login-icon">
          <Shield size={14} />
        </div>
        <div className="custom-card__mini-field" />
        <div className="custom-card__mini-btn" />
      </div>
    </div>
  );
}

function FriendsMiniPreview({ expanded = false }: { expanded?: boolean }) {
  const settings = useSettingsStore();
  const bodyBg = resolveAppBodyBackground(settings.friendsHomeBackground, settings.friendsHomeBackgroundCustom);
  const sidebarBg = resolveSidebarBackground(settings.dmSidebarBackground, settings.dmSidebarBackgroundCustom);
  return (
    <div className={`custom-card__mini-friends${expanded ? ' custom-card__mini-friends--expanded' : ''}`} style={{ background: bodyBg }}>
      <div className="custom-card__mini-friends-sidebar" style={{ background: sidebarBg }}>
        <User size={20} className="custom-card__mini-friends-sidebar-icon" />
      </div>
      <div className="custom-card__mini-friends-rows">
        <div className="custom-card__mini-friend-row"><span /><div /></div>
        <div className="custom-card__mini-friend-row"><span /><div /></div>
        <div className="custom-card__mini-friend-row"><span /><div /></div>
      </div>
    </div>
  );
}

function SettingsMiniPreview() {
  const settings = useSettingsStore();
  const bodyBg = resolveAppBodyBackground(settings.appBodyBackground, settings.appBodyBackgroundCustom);
  const sidebarBg = resolveSidebarBackground(settings.sidebarBackground, settings.sidebarBackgroundCustom);
  return (
    <div className="custom-card__mini-settings" style={{ background: bodyBg }}>
      <div className="custom-card__mini-settings-sidebar" style={{ background: sidebarBg }}>
        <SettingsIcon size={20} className="custom-card__mini-settings-sidebar-icon" />
      </div>
      <div className="custom-card__mini-settings-body">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

/* ── Mock chat preview for the Chat Personalization tab ──── */
function ChatPreview() {
  const profile = useProfileStore();
  const displayName = useAuthStore(s => s.displayName);
  const theme = useConvThemeStore(s => s.getTheme('__global__'));

  const bgStr = computeBgStyle(theme);
  const bgStyle: React.CSSProperties = bgStr
    ? (theme.bgType === 'image'
        ? { backgroundImage: bgStr.startsWith('url(') ? bgStr.replace(/^url\(["']?(.*?)["']?\).*$/, 'url("$1")') : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: bgStr })
    : {};
  const ownRadius = BUBBLE_RADII[theme.bubbleStyle]?.own ?? BUBBLE_RADII.default.own;
  const otherRadius = BUBBLE_RADII[theme.bubbleStyle]?.other ?? BUBBLE_RADII.default.other;
  const fontSize = FONT_SIZES[theme.fontSize] ?? FONT_SIZES.md;
  const density = theme.msgDensity ?? 'comfortable';

  const borderDef = BORDER_STYLE_DEFS[theme.msgBorder] ?? BORDER_STYLE_DEFS.none;
  const borderOpts = theme.msgBorderOverrides?.[theme.msgBorder];

  function bubbleStyle(isOwn: boolean): React.CSSProperties {
    const base: React.CSSProperties = {
      borderRadius: isOwn ? ownRadius : otherRadius,
      fontSize,
      fontFamily: theme.monoFont ? 'var(--dl-font-mono)' : undefined,
    };
    if (theme.msgBorder !== 'none') {
      base.border = borderDef.border || undefined;
      base.backdropFilter = borderDef.backdrop || undefined;
      base.boxShadow = borderDef.glow || undefined;
      if (borderDef.bgOwn && isOwn) base.background = borderDef.bgOwn;
      if (borderDef.bgOther && !isOwn) base.background = borderDef.bgOther;
      if (borderDef.needsPad) base.padding = '10px 14px';
      if (borderOpts?.color && (borderDef.settingsType === 'color-glow' || borderDef.settingsType === 'color-only')) {
        const rgb = hexToRgb(borderOpts.color);
        if (rgb) {
          base.border = `1px solid rgba(${rgb.r},${rgb.g},${rgb.b},0.85)`;
          if (borderDef.settingsType === 'color-glow') base.boxShadow = `0 0 8px rgba(${rgb.r},${rgb.g},${rgb.b},0.5)`;
        }
      }
    }
    // Bubble colors
    if (isOwn && theme.ownColor !== 'default') base.background = theme.ownColor;
    if (!isOwn && theme.otherColor !== 'default') base.background = theme.otherColor;
    if (isOwn && theme.ownText !== 'default') base.color = theme.ownText;
    if (!isOwn && theme.otherText !== 'default') base.color = theme.otherText;
    if (theme.shadow) base.boxShadow = (base.boxShadow ? base.boxShadow + ', ' : '') + '0 2px 8px rgba(0,0,0,0.3)';
    return base;
  }

  const densityCls = density === 'compact' ? ' chat-preview--compact' : density === 'cozy' ? ' chat-preview--cozy' : '';

  return (
    <div className={`chat-preview${densityCls}`} style={bgStyle}>
      <div className="chat-preview__messages">
        {/* Other person's message */}
        <div className="chat-preview__row chat-preview__row--other">
          <Avatar name="Alex" size={32} />
          <div className="chat-preview__bubble-wrap">
            <div className="chat-preview__header">
              <span className="chat-preview__name">Alex</span>
              <span className="chat-preview__time">10:42 AM</span>
            </div>
            <div className="chat-preview__bubble" style={bubbleStyle(false)}>
              Hey! Check out the new theme options 🎨
            </div>
          </div>
        </div>
        {/* Your message */}
        <div className="chat-preview__row chat-preview__row--own">
          <div className="chat-preview__bubble-wrap">
            <div className="chat-preview__header chat-preview__header--own">
              <span className="chat-preview__time">10:43 AM</span>
              <span className="chat-preview__name chat-preview__name--own">
                {profile.displayName || displayName || 'You'}
              </span>
            </div>
            <div className="chat-preview__bubble chat-preview__bubble--own" style={bubbleStyle(true)}>
              Looks great! Love the customization ✨
              <span className="chat-preview__status"><CheckDouble size={12} /></span>
            </div>
          </div>
          {profile.avatar
            ? <img src={profile.avatar} alt="" className="chat-preview__avatar-img" />
            : <Avatar name={profile.displayName || displayName || 'You'} size={32} />
          }
        </div>
      </div>
      {/* Mock input bar */}
      <div className="chat-preview__input">
        <div className="chat-preview__input-field">Type a message…</div>
        <div className="chat-preview__send"><Send size={16} /></div>
      </div>
    </div>
  );
}

/* ── Lock Screen Preview ────────────────────────────────── */
const LOCK_PREVIEW_ICONS: Record<LockIconStyle, typeof Lock> = {
  default: Lock, shield: ShieldCheck, key: Key, fingerprint: Fingerprint, eye: Eye,
};

function LockScreenPreview() {
  const lt = useLockScreenStore(s => s.getTheme('__global__'));
  const Icon = LOCK_PREVIEW_ICONS[lt.iconStyle] ?? Lock;

  const bgStyle: React.CSSProperties = {};
  if (lt.bgMode === 'solid' || lt.bgMode === 'gradient') bgStyle.background = lt.bgValue;
  if (lt.bgMode === 'image') {
    bgStyle.backgroundImage = `url(${lt.bgImage})`;
    bgStyle.backgroundSize = 'cover';
    bgStyle.backgroundPosition = 'center';
  }
  if (lt.bgMode === 'default') bgStyle.background = '#0f0f14';

  const overlayStyle: React.CSSProperties = lt.bgMode !== 'default'
    ? { position: 'absolute', inset: 0, background: lt.overlayColor, opacity: lt.overlayOpacity, pointerEvents: 'none' }
    : {};

  const boxStyle: React.CSSProperties = {
    background: lt.boxBg,
    border: `1px solid ${lt.boxBorder}`,
    borderRadius: lt.boxRadius,
    boxShadow: lt.boxGlow > 0 ? `0 0 ${lt.boxGlow}px ${lt.boxGlowColor}` : undefined,
    backdropFilter: lt.boxBlur > 0 ? `blur(${lt.boxBlur}px)` : undefined,
    opacity: lt.boxOpacity,
  };

  return (
    <div className="screen-preview screen-preview--lock" style={bgStyle}>
      {lt.bgMode !== 'default' && <div style={overlayStyle} />}
      <div className="screen-preview__lock-box" style={boxStyle}>
        <span style={{ color: lt.iconColor, display: 'inline-flex' }}>
          <Icon size={Math.max(40, Math.min(lt.iconSize * 1, 40))} />
        </span>
        <h4 className="screen-preview__lock-title" style={{ color: lt.textColor }}>
          {lt.title || 'Chat Locked'}
        </h4>
        <p className="screen-preview__lock-desc" style={{ color: lt.textColor, opacity: 0.7 }}>
          {lt.description || 'Enter your PIN to open this conversation'}
        </p>
        <div className="screen-preview__lock-input">
          <Key size={30} />
          <span>•••••</span>
        </div>
        <div
          className="screen-preview__lock-btn"
          style={{ background: lt.buttonColor, color: lt.buttonText }}
        >
          Unlock
        </div>
      </div>
    </div>
  );
}

/* ── Login Page Preview ─────────────────────────────────── */
const LOGIN_PREVIEW_ICONS: Record<string, typeof Lock> = {
  shield: ShieldCheck, lock: Lock, key: Key, fingerprint: Fingerprint, eye: Eye, image: ShieldCheck,
};

function LoginPreview() {
  const lt = useLoginScreenStore(s => s.get());
  const Icon = LOGIN_PREVIEW_ICONS[lt.logoStyle] ?? ShieldCheck;

  const screenStyle: React.CSSProperties = {};
  if (lt.bgMode === 'solid')         screenStyle.background = lt.bgColor;
  else if (lt.bgMode === 'gradient') screenStyle.background = lt.bgGradient;
  else if (lt.bgMode === 'image' && lt.bgImage) {
    screenStyle.backgroundImage = `url(${lt.bgImage})`;
    screenStyle.backgroundSize = 'cover';
    screenStyle.backgroundPosition = 'center';
  } else {
    screenStyle.background = 'linear-gradient(160deg, #0f0c29, #302b63, #24243e)';
  }

  const overlayStyle: React.CSSProperties = lt.bgMode !== 'default'
    ? { position: 'absolute', inset: 0, background: lt.bgOverlayColor, opacity: lt.bgOverlayOpacity, pointerEvents: 'none' }
    : {};

  const cardStyle: React.CSSProperties = lt.cardStyle === 'none'
    ? { background: 'transparent', border: 'none' }
    : {
        background: lt.cardStyle === 'glass'
          ? `${lt.cardBg}${Math.round(lt.cardBgOpacity * 255).toString(16).padStart(2, '0')}`
          : lt.cardBg,
        border: `1px solid ${lt.cardBorder}`,
        borderRadius: Math.min(lt.cardRadius, 14),
        backdropFilter: lt.cardBlur > 0 ? `blur(${Math.min(lt.cardBlur, 12)}px)` : undefined,
        boxShadow: lt.cardGlow > 0 ? `0 0 ${lt.cardGlow}px ${lt.cardGlowColor}` : undefined,
      };

  const align = lt.layout === 'top' ? 'flex-start' : lt.layout === 'bottom' ? 'flex-end' : 'center';

  return (
    <div className="screen-preview screen-preview--login" style={{ ...screenStyle, justifyContent: align }}>
      {lt.bgMode !== 'default' && <div style={overlayStyle} />}
      <div className="screen-preview__login-card" style={cardStyle}>
        <span style={{ color: lt.logoColor, display: 'inline-flex' }}>
          <Icon size={Math.max(18, Math.min(lt.logoSize * 0.4, 32))} />
        </span>
        <h4
          className="screen-preview__login-title"
          style={{ color: lt.titleColor || '#e8e8f0', fontSize: Math.min(lt.titleSize * 0.6, 16) }}
        >
          {lt.titleText || 'RIDGELINE'}
        </h4>
        <p className="screen-preview__login-sub" style={{ color: lt.subtitleColor || '#888' }}>
          {lt.subtitleText || 'Encrypted direct messaging'}
        </p>
        <div
          className="screen-preview__login-input"
          style={{ background: lt.inputBg, border: `1px solid ${lt.inputBorder}`, borderRadius: Math.min(lt.inputRadius, 8) }}
        />
        <div
          className="screen-preview__login-input"
          style={{ background: lt.inputBg, border: `1px solid ${lt.inputBorder}`, borderRadius: Math.min(lt.inputRadius, 8) }}
        />
        <div
          className="screen-preview__login-btn"
          style={{ background: lt.buttonColor, color: lt.buttonTextColor, borderRadius: Math.min(lt.buttonRadius, 8) }}
        >
          Sign In
        </div>
      </div>
    </div>
  );
}

function AppShellPreview() {
  const settings = useSettingsStore();
  const bodyBg = resolveAppBodyBackground(settings.appBodyBackground, settings.appBodyBackgroundCustom);
  const sidebarBg = resolveSidebarBackground(settings.sidebarBackground, settings.sidebarBackgroundCustom);

  return (
    <div className="shell-preview" style={{ background: bodyBg }}>
      <div className="shell-preview__sidebar" style={{ background: sidebarBg }}>
        <div className="shell-preview__avatar" />
        <span />
        <span />
        <span />
      </div>
      <div className="shell-preview__content">
        <div className="shell-preview__header" />
        <div className="shell-preview__bubble shell-preview__bubble--other" />
        <div className="shell-preview__bubble shell-preview__bubble--own" />
        <div className="shell-preview__bubble shell-preview__bubble--other shell-preview__bubble--short" />
      </div>
    </div>
  );
}

export function Settings() {
  const [section, setSection] = useState<Section>('profile');
  const [customSub, setCustomSub] = useState<CustomSub>('hub');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [wipeInput, setWipeInput] = useState('');
  const [showRecoveryPhrase, setShowRecoveryPhrase] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const setScreen = useAuthStore(s => s.setScreen);
  const lock = useAuthStore(s => s.lock);
  const displayName = useAuthStore(s => s.displayName);
  const userId = useAuthStore(s => s.userId);
  const connected = useConnectionStore(s => s.status === 'connected');
  const profile = useProfileStore();

  const settings = useSettingsStore();

  const settingsThemeVars = useMemo(() => {
    const rootStyles = typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement)
      : null;

    const accent = rootStyles?.getPropertyValue('--dl-accent').trim() || '#6366f1';
    const accentHover = rootStyles?.getPropertyValue('--dl-accent-hover').trim() || accent;
    const danger = rootStyles?.getPropertyValue('--dl-danger').trim() || '#ef4444';
    const success = rootStyles?.getPropertyValue('--dl-success').trim() || '#22c55e';
    const warning = rootStyles?.getPropertyValue('--dl-warning').trim() || '#eab308';
    const info = rootStyles?.getPropertyValue('--dl-info').trim() || '#3b82f6';

    const fallbackBg = rootStyles?.getPropertyValue('--dl-bg-primary').trim() || '#10131a';
    const bodyBg = resolveAppBodyBackground(settings.appBodyBackground, settings.appBodyBackgroundCustom);
    const sidebarBg = resolveSidebarBackground(settings.sidebarBackground, settings.sidebarBackgroundCustom);
    const bodyIsLight = backgroundLuminance(bodyBg, fallbackBg) > 0.56;
    const sidebarIsLight = backgroundLuminance(sidebarBg, fallbackBg) > 0.56;

    const textPrimary = bodyIsLight ? '#0b1220' : '#f5f7ff';
    const textSecondary = bodyIsLight ? '#1e293b' : '#d8deef';
    const textMuted = bodyIsLight ? '#475569' : '#a9b4cd';
    const textTertiary = bodyIsLight ? '#64748b' : '#7f8ba6';
    const border = bodyIsLight ? 'rgba(15, 23, 42, 0.18)' : 'rgba(255, 255, 255, 0.1)';
    const surfaceBg = bodyIsLight ? 'rgba(255, 255, 255, 0.78)' : 'rgba(10, 14, 22, 0.72)';
    const secondaryBg = bodyIsLight ? 'rgba(255, 255, 255, 0.64)' : 'rgba(7, 11, 18, 0.68)';
    const inputBg = bodyIsLight ? 'rgba(255, 255, 255, 0.9)' : 'rgba(8, 12, 20, 0.86)';
    const hoverBg = bodyIsLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.08)';
    const activeBg = bodyIsLight ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.14)';

    const navTextPrimary = sidebarIsLight ? '#0b1220' : '#f5f7ff';
    const navTextSecondary = sidebarIsLight ? '#243247' : '#d8deef';
    const navTextMuted = sidebarIsLight ? '#5f6f85' : '#9ca9c8';
    const navBorder = sidebarIsLight ? 'rgba(15, 23, 42, 0.18)' : 'rgba(255, 255, 255, 0.1)';
    const navSurfaceBg = sidebarIsLight ? 'rgba(255, 255, 255, 0.64)' : 'rgba(255, 255, 255, 0.06)';
    const navHoverBg = sidebarIsLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.08)';
    const navActiveBg = sidebarIsLight ? rgba(accent, 0.18) : rgba(accent, 0.24);
    const navActiveText = sidebarIsLight ? '#1d4ed8' : '#e5e9ff';
    const navLockBg = sidebarIsLight ? 'rgba(234, 179, 8, 0.18)' : 'rgba(251, 191, 36, 0.12)';
    const navLockBorder = sidebarIsLight ? 'rgba(180, 83, 9, 0.35)' : 'rgba(251, 191, 36, 0.3)';
    const navLockText = sidebarIsLight ? '#92400e' : '#fcd34d';

    const successText = bodyIsLight ? '#166534' : '#86efac';
    const successBg = rgba(success, bodyIsLight ? 0.16 : 0.2, '34, 197, 94');
    const successBorder = rgba(success, bodyIsLight ? 0.42 : 0.5, '34, 197, 94');

    const warningText = bodyIsLight ? '#92400e' : '#fcd34d';
    const warningBg = rgba(warning, bodyIsLight ? 0.16 : 0.2, '234, 179, 8');
    const warningBorder = rgba(warning, bodyIsLight ? 0.4 : 0.5, '234, 179, 8');

    const dangerText = bodyIsLight ? '#991b1b' : '#fecaca';
    const dangerBg = rgba(danger, bodyIsLight ? 0.14 : 0.18, '239, 68, 68');
    const dangerBorder = rgba(danger, bodyIsLight ? 0.4 : 0.5, '239, 68, 68');

    const infoText = bodyIsLight ? '#1e3a8a' : '#dbe3ff';
    const infoBg = rgba(info, bodyIsLight ? 0.14 : 0.2, '59, 130, 246');
    const infoBorder = rgba(info, bodyIsLight ? 0.4 : 0.5, '59, 130, 246');

    const onAccent = (luminance(accent) ?? 0.2) > 0.62 ? '#0f172a' : '#ffffff';

    return {
      '--dl-text-primary': textPrimary,
      '--dl-text-secondary': textSecondary,
      '--dl-text-muted': textMuted,
      '--dl-text-tertiary': textTertiary,
      '--dl-border': border,

      '--dl-bg-surface': surfaceBg,
      '--dl-bg-secondary': secondaryBg,
      '--dl-bg-input': inputBg,
      '--dl-bg-hover': hoverBg,
      '--dl-bg-active': activeBg,

      '--settings-panel-bg': surfaceBg,
      '--settings-panel-alt-bg': secondaryBg,
      '--settings-panel-border': border,

      '--settings-status-success-text': successText,
      '--settings-status-success-bg': successBg,
      '--settings-status-success-border': successBorder,
      '--settings-status-warning-text': warningText,
      '--settings-status-warning-bg': warningBg,
      '--settings-status-warning-border': warningBorder,
      '--settings-status-danger-text': dangerText,
      '--settings-status-danger-bg': dangerBg,
      '--settings-status-danger-border': dangerBorder,
      '--settings-status-info-text': infoText,
      '--settings-status-info-bg': infoBg,
      '--settings-status-info-border': infoBorder,

      '--color-success': successText,
      '--color-warning': warningText,
      '--color-error': dangerText,

      '--settings-nav-bg': sidebarBg,
      '--settings-nav-text-primary': navTextPrimary,
      '--settings-nav-text-secondary': navTextSecondary,
      '--settings-nav-text-muted': navTextMuted,
      '--settings-nav-border': navBorder,
      '--settings-nav-surface-bg': navSurfaceBg,
      '--settings-nav-hover-bg': navHoverBg,
      '--settings-nav-active-bg': navActiveBg,
      '--settings-nav-item-active-text': navActiveText,
      '--settings-nav-lock-bg': navLockBg,
      '--settings-nav-lock-border': navLockBorder,
      '--settings-nav-lock-text': navLockText,

      '--settings-btn-primary-bg': `linear-gradient(135deg, ${accent}, ${accentHover})`,
      '--settings-btn-primary-text': onAccent,
      '--settings-btn-primary-border': rgba(accent, bodyIsLight ? 0.45 : 0.34),
      '--settings-btn-primary-shadow': `0 10px 24px ${rgba(accent, bodyIsLight ? 0.24 : 0.34)}`,

      '--settings-btn-ghost-bg': rgba(accent, bodyIsLight ? 0.14 : 0.2),
      '--settings-btn-ghost-border': rgba(accent, bodyIsLight ? 0.38 : 0.45),
      '--settings-btn-ghost-text': bodyIsLight ? '#1e3a8a' : '#dbe3ff',

      '--settings-btn-outline-bg': rgba(accent, bodyIsLight ? 0.18 : 0.24),
      '--settings-btn-outline-border': rgba(accent, bodyIsLight ? 0.52 : 0.68),
      '--settings-btn-outline-text': bodyIsLight ? '#172554' : '#eef1ff',

      '--settings-btn-secondary-bg': rgba(accent, bodyIsLight ? 0.12 : 0.16),
      '--settings-btn-secondary-border': rgba(accent, bodyIsLight ? 0.34 : 0.36),
      '--settings-btn-secondary-text': bodyIsLight ? '#0f172a' : '#e6ebff',

      '--settings-btn-danger-bg': `linear-gradient(135deg, ${danger}, #dc2626)`,
      '--settings-btn-danger-border': rgba(danger, 0.5, '239, 68, 68'),
      '--settings-btn-danger-text': '#ffffff',
      '--settings-btn-danger-shadow': `0 10px 24px ${rgba(danger, 0.34, '239, 68, 68')}`,

      '--settings-danger-soft-bg': rgba(danger, bodyIsLight ? 0.12 : 0.16, '239, 68, 68'),
      '--settings-danger-soft-border': rgba(danger, bodyIsLight ? 0.4 : 0.5, '239, 68, 68'),
      '--settings-danger-soft-text': dangerText,
    } as React.CSSProperties;
  }, [
    settings.theme,
    settings.appBodyBackground,
    settings.appBodyBackgroundCustom,
    settings.sidebarBackground,
    settings.sidebarBackgroundCustom,
  ]);

  const nav: { id: Section; icon: JSX.Element; label: string }[] = [
    { id: 'profile', icon: <User size={16} />, label: 'Profile' },
    { id: 'general', icon: <SettingsIcon size={16} />, label: 'General' },
    { id: 'customization', icon: <Palette size={16} />, label: 'Customization' },
    { id: 'security', icon: <Shield size={16} />, label: 'Security' },
    { id: 'privacy', icon: <Fingerprint size={16} />, label: 'Privacy' },
    { id: 'notifications', icon: <Bell size={16} />, label: 'Notifications' },
    { id: 'devices', icon: <Key size={16} />, label: 'Devices' },
    { id: 'integrations', icon: <Globe size={16} />, label: 'Integrations' },
    { id: 'updates' as Section, icon: <Download size={16} />, label: 'Updates' },
    { id: 'danger', icon: <AlertTriangle size={16} />, label: 'Danger Zone' },
  ];

  const customSubLabel: Record<CustomSub, string> = {
    hub: 'Customization',
    chat: 'Chat Customization',
    lockscreen: 'Lock Screen',
    login: 'Login Page',
    settings: 'App Settings',
    friends: 'Friends Home',
  };

  const activeSectionLabel = section === 'customization'
    ? customSubLabel[customSub]
    : (nav.find(item => item.id === section)?.label ?? 'Settings');
  const mobileBackLabel = section === 'customization' && customSub !== 'hub' ? 'Customization' : 'All Tabs';

  const handlePanicWipe = () => {
    if (wipeInput !== 'WIPE ALL DATA') return;
    // Clear all persisted stores from localStorage
    const keysToKeep: string[] = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && !keysToKeep.includes(key)) localStorage.removeItem(key);
    }
    // Lock & redirect to start
    lock();
    setShowWipeConfirm(false);
    window.location.reload();
  };

  const handleExportBackup = () => {
    try {
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) data[key] = localStorage.getItem(key) ?? '';
      }
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ridgeline-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus('Backup exported successfully!');
      setTimeout(() => setExportStatus(null), 3000);
    } catch {
      setExportStatus('Export failed');
      setTimeout(() => setExportStatus(null), 3000);
    }
  };
  const handleNavClick = (id: Section) => {
    setSection(id);
    if (id === 'customization') setCustomSub('hub');
    setMobileOpen(true);
  };

  const handleMobileBack = () => {
    if (section === 'customization' && customSub !== 'hub') {
      setCustomSub('hub');
      return;
    }
    setMobileOpen(false);
  };

  return (
    <div className={`settings${mobileOpen ? ' settings--mobile-open' : ''}`} style={settingsThemeVars}>
      {/* ── Nav ──────────────────────────────────── */}
      <div className="settings-nav">
        <button className="settings-nav__back" onClick={() => setScreen('main')}>
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>

        <div className="settings-nav__mobile-intro">
          <h1>User Settings</h1>
          <p>Choose a tab to open it full screen.</p>
        </div>

        <div className="settings-nav__profile">
          <AvatarWithStatus
            name={profile.displayName || displayName || 'User'}
            avatarUrl={profile.avatar}
            statusText={profile.statusText}
            statusEmoji={profile.statusEmoji}
            presence={profile.presence}
            size={40}
            editable
          />
          <div className="settings-nav__info">
            <span className="settings-nav__name" style={{ color: profile.usernameColor, ...getNameFontStyle(profile.displayNameFont) }}>
              {profile.displayName || displayName || 'User'}
            </span>
            <span className="settings-nav__id">@{profile.username || userId?.slice(0, 12)}</span>
          </div>
        </div>

        <div className="settings-nav__list">
          {nav.map(item => (
            <button
              key={item.id}
              className={`settings-nav__item ${section === item.id ? 'settings-nav__item--active' : ''}`}
              onClick={() => handleNavClick(item.id)}
            >
              {item.icon}
              <span className="settings-nav__item-label">{item.label}</span>
              <span className="settings-nav__item-arrow" aria-hidden="true">›</span>
            </button>
          ))}
        </div>

        <div className="settings-nav__footer">
          <button className="settings-nav__lock" onClick={lock}>
            <Lock size={14} />
            <span>Lock Vault</span>
          </button>
          <div className="settings-nav__conn">
            {connected ? <><Wifi size={10} /> Connected</> : <><WifiOff size={10} /> Offline</>}
          </div>
        </div>
      </div>

      {/* ── Content ──────────────────────────────── */}
      <div className="settings-content">
        <div className="settings-mobile-head" aria-live="polite">
          <button className="settings-mobile-head__back" onClick={handleMobileBack}>
            <ArrowLeft size={14} />
            <span>{mobileBackLabel}</span>
          </button>
          <span className="settings-mobile-head__eyebrow">User Settings</span>
          <div className="settings-mobile-head__row">
            <h1 className="settings-mobile-head__title">{activeSectionLabel}</h1>
            <span className={`settings-mobile-head__status ${connected ? 'settings-mobile-head__status--online' : ''}`}>
              {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
              {connected ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        {/* ══════ PROFILE ══════ */}
        {section === 'profile' && (
          <div className="settings-section settings-section--profile">
            <h2>Profile</h2>
            <ProfileEditor />
          </div>
        )}

        {/* ══════ GENERAL ══════ */}
        {section === 'general' && (
          <div className="settings-section">
            <h2>General</h2>

            <div className="settings-group">
              <h3>Appearance</h3>
              <SettingRow
                label="Theme"
                desc={settings.theme === 'custom'
                  ? 'Uses your saved Customization colors'
                  : 'Choose the overall look and feel'}
              >
                <select
                  className="settings-select"
                  value={settings.theme}
                  onChange={e => settings.setTheme(e.target.value as 'dark' | 'midnight' | 'amoled' | 'custom')}
                >
                  <option value="dark">Dark</option>
                  <option value="midnight">Midnight</option>
                  <option value="amoled">AMOLED Black</option>
                  <option value="custom">Custom</option>
                </select>
              </SettingRow>

              <SettingRow label="Font Size" desc="Adjust the base font size">
                <select
                  className="settings-select"
                  value={settings.fontSize}
                  onChange={e => settings.setFontSize(e.target.value as 'small' | 'medium' | 'large')}
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </SettingRow>

              <SettingRow label="Compact Mode" desc="Reduce spacing between messages">
                <Toggle checked={settings.compactMode} onChange={settings.toggleCompactMode} />
              </SettingRow>
            </div>

            <div className="settings-group">
              <h3>Time &amp; Date</h3>
              <SettingRow label="Show Timestamps" desc="Display time on each message">
                <Toggle checked={settings.showTimestamps} onChange={settings.toggleShowTimestamps} />
              </SettingRow>

              <SettingRow label="24-Hour Clock" desc="Use 24-hour time format">
                <Toggle checked={settings.use24HourTime} onChange={settings.toggleUse24HourTime} />
              </SettingRow>
            </div>

            <div className="settings-group">
              <h3>Language &amp; Input</h3>
              <SettingRow label="Spell Check" desc="Underline misspelled words">
                <Toggle checked={settings.spellCheck} onChange={settings.toggleSpellCheck} />
              </SettingRow>

              <SettingRow label="Emoji Suggestions" desc="Show emoji suggestions while typing">
                <Toggle checked={settings.emojiSuggestions} onChange={settings.toggleEmojiSuggestions} />
              </SettingRow>
            </div>
          </div>
        )}

        {/* ══════ CUSTOMIZATION ══════ */}
        {section === 'customization' && customSub === 'hub' && (
          <div className="settings-section">
            <div className="custom-hub-header">
              <h2>Customization</h2>
              <p>Personalize every part of your Ridgeline experience.</p>
            </div>

            <div className="custom-hub">
              {/* Chat Personalization */}
              <button className="custom-card custom-card--chat" onClick={() => setCustomSub('chat')}>
                <ChatMiniPreview />
                <div className="custom-card__info">
                  <h3>Chat</h3>
                  <p>Backgrounds, bubbles, fonts &amp; message styles</p>
                </div>
              </button>

              {/* App Settings */}
              <button className="custom-card custom-card--settings" onClick={() => setCustomSub('settings')}>
                <SettingsMiniPreview />
                <div className="custom-card__info">
                  <h3>App Settings</h3>
                  <p>Customize body and sidebar backgrounds</p>
                </div>
              </button>

              {/* Lock Screen */}
              <button className="custom-card custom-card--lock" onClick={() => setCustomSub('lockscreen')}>
                <LockMiniPreview />
                <div className="custom-card__info">
                  <h3>Lock Screen</h3>
                  <p>Background, icon, colors &amp; unlock animation</p>
                </div>
              </button>

              {/* Login Screen */}
              <button className="custom-card custom-card--login" onClick={() => setCustomSub('login')}>
                <LoginMiniPreview />
                <div className="custom-card__info">
                  <h3>Login Page</h3>
                  <p>Logo, card style, layout &amp; input theming</p>
                </div>
              </button>

              {/* Friends Home */}
              <button className="custom-card custom-card--friends" onClick={() => setCustomSub('friends')}>
                <FriendsMiniPreview />
                <div className="custom-card__info">
                  <h3>Friends Home</h3>
                  <p>Background &amp; DM sidebar theming</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {section === 'customization' && customSub === 'settings' && (
          <div className="settings-section settings-section--shell">
            <button className="custom-back" onClick={() => setCustomSub('hub')}>
              <ArrowLeft size={16} /> Customization
            </button>
            <div className="shell-hero">
              <h2 className="shell-hero__title">App Settings</h2>
              <p className="shell-hero__sub">Style your app body and sidebars. Pick a preset or paint your own.</p>
              <button
                className="shell-hero__reset"
                onClick={() => {
                  settings.setAppBodyBackground('default');
                  settings.setSidebarBackground('default');
                }}
              >
                Reset to default
              </button>
            </div>

            <AppShellPreview />

            <div className="shell-editor-grid">
              <div className="shell-editor-panel shell-editor-panel--body">
                <div className="shell-editor-panel__head">
                  <h3>Body Background</h3>
                  <span className="shell-editor-panel__badge">{BG_OPTION_LABELS[settings.appBodyBackground]}</span>
                </div>
                <div className="shell-option-grid">
                  {BODY_BG_OPTIONS.map((option) => {
                    const swatch = option === 'custom'
                      ? settings.appBodyBackgroundCustom
                      : APP_BODY_BACKGROUND_CSS[option];
                    return (
                      <button
                        key={option}
                        className={`shell-option ${settings.appBodyBackground === option ? 'shell-option--active' : ''}`}
                        onClick={() => settings.setAppBodyBackground(option)}
                        title={BG_OPTION_LABELS[option]}
                      >
                        <span className="shell-option__swatch" style={{ background: swatch }} />
                        <span className="shell-option__label">{BG_OPTION_LABELS[option]}</span>
                      </button>
                    );
                  })}
                </div>
                {settings.appBodyBackground === 'custom' && (
                  <div className="shell-color-row">
                    <label>Custom color</label>
                    <input
                      type="color"
                      value={settings.appBodyBackgroundCustom}
                      onChange={e => settings.setAppBodyBackgroundCustom(e.target.value)}
                    />
                    <input
                      type="text"
                      className="shell-color-hex"
                      value={settings.appBodyBackgroundCustom}
                      onChange={e => settings.setAppBodyBackgroundCustom(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>

              <div className="shell-editor-panel shell-editor-panel--sidebar">
                <div className="shell-editor-panel__head">
                  <h3>Sidebar Background</h3>
                  <span className="shell-editor-panel__badge">{BG_OPTION_LABELS[settings.sidebarBackground]}</span>
                </div>
                <div className="shell-option-grid">
                  {SIDEBAR_BG_OPTIONS.map((option) => {
                    const swatch = option === 'custom'
                      ? settings.sidebarBackgroundCustom
                      : SIDEBAR_BACKGROUND_CSS[option];
                    return (
                      <button
                        key={option}
                        className={`shell-option ${settings.sidebarBackground === option ? 'shell-option--active' : ''}`}
                        onClick={() => settings.setSidebarBackground(option)}
                        title={BG_OPTION_LABELS[option]}
                      >
                        <span className="shell-option__swatch" style={{ background: swatch }} />
                        <span className="shell-option__label">{BG_OPTION_LABELS[option]}</span>
                      </button>
                    );
                  })}
                </div>
                {settings.sidebarBackground === 'custom' && (
                  <div className="shell-color-row">
                    <label>Custom color</label>
                    <input
                      type="color"
                      value={settings.sidebarBackgroundCustom}
                      onChange={e => settings.setSidebarBackgroundCustom(e.target.value)}
                    />
                    <input
                      type="text"
                      className="shell-color-hex"
                      value={settings.sidebarBackgroundCustom}
                      onChange={e => settings.setSidebarBackgroundCustom(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {section === 'customization' && customSub === 'friends' && (
          <div className="settings-section settings-section--shell">
            <button className="custom-back" onClick={() => setCustomSub('hub')}>
              <ArrowLeft size={16} /> Customization
            </button>
            <div className="shell-hero">
              <h2 className="shell-hero__title">Friends Home</h2>
              <p className="shell-hero__sub">Style the Friends Home page and your DM / chat sidebar. Pick a preset or paint your own.</p>
              <button
                className="shell-hero__reset"
                onClick={() => {
                  settings.setFriendsHomeBackground('default');
                  settings.setDmSidebarBackground('default');
                }}
              >
                Reset to default
              </button>
            </div>

            <div className="shell-preview shell-preview--friends">
              <FriendsMiniPreview expanded />
            </div>

            <div className="shell-editor-grid">
              <div className="shell-editor-panel shell-editor-panel--body">
                <div className="shell-editor-panel__head">
                  <h3>Friends Home Background</h3>
                  <span className="shell-editor-panel__badge">{BG_OPTION_LABELS[settings.friendsHomeBackground]}</span>
                </div>
                <div className="shell-option-grid">
                  {BODY_BG_OPTIONS.map((option) => {
                    const swatch = option === 'custom'
                      ? settings.friendsHomeBackgroundCustom
                      : APP_BODY_BACKGROUND_CSS[option];
                    return (
                      <button
                        key={option}
                        className={`shell-option ${settings.friendsHomeBackground === option ? 'shell-option--active' : ''}`}
                        onClick={() => settings.setFriendsHomeBackground(option)}
                        title={BG_OPTION_LABELS[option]}
                      >
                        <span className="shell-option__swatch" style={{ background: swatch }} />
                        <span className="shell-option__label">{BG_OPTION_LABELS[option]}</span>
                      </button>
                    );
                  })}
                </div>
                {settings.friendsHomeBackground === 'custom' && (
                  <div className="shell-color-row">
                    <label>Custom color</label>
                    <input
                      type="color"
                      value={settings.friendsHomeBackgroundCustom}
                      onChange={e => settings.setFriendsHomeBackgroundCustom(e.target.value)}
                    />
                    <input
                      type="text"
                      className="shell-color-hex"
                      value={settings.friendsHomeBackgroundCustom}
                      onChange={e => settings.setFriendsHomeBackgroundCustom(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>

              <div className="shell-editor-panel shell-editor-panel--sidebar">
                <div className="shell-editor-panel__head">
                  <h3>DM &amp; Chat Sidebar</h3>
                  <span className="shell-editor-panel__badge">{BG_OPTION_LABELS[settings.dmSidebarBackground]}</span>
                </div>
                <div className="shell-option-grid">
                  {SIDEBAR_BG_OPTIONS.map((option) => {
                    const swatch = option === 'custom'
                      ? settings.dmSidebarBackgroundCustom
                      : SIDEBAR_BACKGROUND_CSS[option];
                    return (
                      <button
                        key={option}
                        className={`shell-option ${settings.dmSidebarBackground === option ? 'shell-option--active' : ''}`}
                        onClick={() => settings.setDmSidebarBackground(option)}
                        title={BG_OPTION_LABELS[option]}
                      >
                        <span className="shell-option__swatch" style={{ background: swatch }} />
                        <span className="shell-option__label">{BG_OPTION_LABELS[option]}</span>
                      </button>
                    );
                  })}
                </div>
                {settings.dmSidebarBackground === 'custom' && (
                  <div className="shell-color-row">
                    <label>Custom color</label>
                    <input
                      type="color"
                      value={settings.dmSidebarBackgroundCustom}
                      onChange={e => settings.setDmSidebarBackgroundCustom(e.target.value)}
                    />
                    <input
                      type="text"
                      className="shell-color-hex"
                      value={settings.dmSidebarBackgroundCustom}
                      onChange={e => settings.setDmSidebarBackgroundCustom(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {section === 'customization' && customSub === 'chat' && (
          <div className="settings-section settings-section--chat">
            <button className="custom-back" onClick={() => setCustomSub('hub')}>
              <ArrowLeft size={16} /> Customization
            </button>
            <h2>Chat Personalization</h2>
            <p className="settings-section__desc">
              Set default chat appearance. Per-conversation overrides (via the palette icon in chat) take priority.
            </p>
            <ChatPreview />
            <div className="settings-chat-embed">
              <ConvPersonalize convId="__global__" onClose={() => setCustomSub('hub')} />
            </div>
          </div>
        )}

        {section === 'customization' && customSub === 'lockscreen' && (
          <div className="settings-section settings-section--lockscreen">
            <button className="custom-back" onClick={() => setCustomSub('hub')}>
              <ArrowLeft size={16} /> Customization
            </button>
            <h2>Lock Screen</h2>
            <p className="settings-section__desc">Customize the unlock screen appearance.</p>
            <LockScreenPreview />
            <div className="settings-chat-embed">
              <LockScreenSettings convId="__global__" onClose={() => setCustomSub('hub')} />
            </div>
          </div>
        )}

        {section === 'customization' && customSub === 'login' && (
          <div className="settings-section settings-section--login">
            <button className="custom-back" onClick={() => setCustomSub('hub')}>
              <ArrowLeft size={16} /> Customization
            </button>
            <h2>Login Page</h2>
            <p className="settings-section__desc">Customize the login screen look and feel.</p>
            <LoginPreview />
            <div className="settings-chat-embed">
              <LoginSettings onClose={() => setCustomSub('hub')} />
            </div>
          </div>
        )}

        {/* ══════ SECURITY ══════ */}
        {section === 'security' && (
          <div className="settings-section settings-section--security">
            <div className="security-hero">
              <div className="security-hero__icon"><ShieldCheck size={22} /></div>
              <div className="security-hero__copy">
                <h2>Security</h2>
                <p>Controls that protect this device, your vault, and locally stored messages.</p>
              </div>
              <Button variant="outline" size="sm" onClick={lock}><Lock size={14} /> Lock now</Button>
            </div>

            <SecurityStatusCard />
            <PrivateBetaSecurityCard />

            <div className="security-dashboard">
              <div className="settings-group settings-group--security-panel">
                <h3>Vault protection</h3>
                <SettingRow label="Auto-lock" desc="Lock this vault after the selected period without activity.">
                  <select className="settings-select" value={settings.autoLockMinutes} onChange={e => settings.setAutoLockMinutes(Number(e.target.value))}>
                    <option value="1">1 minute</option><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="0">Never</option>
                  </select>
                </SettingRow>
                <SettingRow label="Lock when the screen sleeps" desc="Immediately lock the vault when the system locks or sleeps.">
                  <Toggle checked={settings.lockOnScreenSleep} onChange={settings.toggleLockOnScreenSleep} />
                </SettingRow>
                <div className="security-fact"><Lock size={14} /><span>Vault password is required when the app opens.</span></div>
              </div>

              <div className="settings-group settings-group--security-panel">
                <h3>Screen &amp; input privacy</h3>
                <SettingRow label="Block screen capture" desc="Ask the desktop shell to prevent capture of the Ridgeline window.">
                  <Toggle checked={settings.screenshotProtection} onChange={settings.toggleScreenshotProtection} />
                </SettingRow>
                <SettingRow label="Protect new conversations" desc="Enable capture protection by default for new conversations.">
                  <Toggle checked={settings.defaultBlockScreenshots} onChange={settings.toggleDefaultBlockScreenshots} />
                </SettingRow>
                <SettingRow label="Private typing mode" desc="Disable Electron spell checking and its input suggestions.">
                  <Toggle checked={settings.incognitoKeyboard} onChange={settings.toggleIncognitoKeyboard} />
                </SettingRow>
                <SettingRow label="Hide from taskbar" desc="Hide the Ridgeline window from the operating system taskbar.">
                  <Toggle checked={settings.hideMessagePreviewsInTaskbar} onChange={settings.toggleHideMessagePreviewsInTaskbar} />
                </SettingRow>
              </div>

              <div className="settings-group settings-group--security-panel">
                <h3>Clipboard &amp; local data</h3>
                <SettingRow label="Auto-clear copied messages" desc="Clear the system clipboard after copying a message in Ridgeline.">
                  <Toggle checked={settings.clipboardAutoClear} onChange={settings.toggleClipboardAutoClear} />
                </SettingRow>
                {settings.clipboardAutoClear && (
                  <SettingRow label="Clear clipboard after" desc="How long copied message text remains available.">
                    <select className="settings-select" value={settings.clipboardClearSeconds} onChange={e => settings.setClipboardClearSeconds(Number(e.target.value))}>
                      <option value="10">10 seconds</option><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option>
                    </select>
                  </SettingRow>
                )}
                <SettingRow label="Message retention" desc="Automatically remove locally stored messages after this period.">
                  <select className="settings-select" value={settings.messageRetentionDays} onChange={e => settings.setMessageRetentionDays(Number(e.target.value))}>
                    <option value="0">Keep forever</option><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option>
                  </select>
                </SettingRow>
                <div className="security-panel__action">
                  <span>Clear the current clipboard contents now.</span>
                  <Button variant="ghost" size="sm" onClick={() => void window.electronAPI?.clipboardClearNow()}><Trash size={14} /> Clear now</Button>
                </div>
              </div>

              <div className="security-dashboard__wide">
                <TwoFactorSetup />
              </div>

              <div className="settings-group settings-group--security-panel settings-group--security-panel-wide">
                <h3>Encryption identity</h3>
                <div className="settings-info-card">
                  <ShieldCheck size={20} />
                  <div><strong>Forward-secret direct messages</strong><p>Direct messages use the app's X3DH and Double Ratchet implementation. Conversation-specific disappearing messages take priority over local retention.</p></div>
                </div>
                <E2EERegenerate />
              </div>
            </div>
          </div>
        )}

        {/* ══════ PRIVACY ══════ */}
        {section === 'privacy' && (
          <div className="settings-section">
            <h2>Privacy</h2>

            <div className="settings-group">
              <h3>Message Indicators</h3>
              <SettingRow label="Send Read Receipts" desc="Let others know when you've read their messages">
                <Toggle checked={settings.readReceipts} onChange={settings.toggleReadReceipts} />
              </SettingRow>

              <SettingRow label="Show Typing" desc="Share when you're typing a message">
                <Toggle checked={settings.typingIndicators} onChange={settings.toggleTypingIndicators} />
              </SettingRow>
            </div>

            <div className="settings-group">
              <h3>Online Presence</h3>
              <SettingRow label="Show Online Status" desc="Let others see when you're online">
                <Toggle checked={settings.onlineStatusVisible} onChange={settings.toggleOnlineStatusVisible} />
              </SettingRow>

              <SettingRow label="Show Last Seen" desc="Let others see when you were last active">
                <Toggle checked={settings.lastSeenVisible} onChange={settings.toggleLastSeenVisible} />
              </SettingRow>
            </div>

            <div className="settings-group">
              <h3>Profile Visibility</h3>
              <SettingRow label="Who Can See Your Profile" desc="Control who can view your bio, links, and avatar">
                <select
                  className="settings-select"
                  value={settings.profileVisibility}
                  onChange={e => settings.setProfileVisibility(e.target.value as 'everyone' | 'contacts' | 'nobody')}
                >
                  <option value="everyone">Everyone</option>
                  <option value="contacts">Contacts Only</option>
                  <option value="nobody">Nobody</option>
                </select>
              </SettingRow>
            </div>
          </div>
        )}

        {/* ══════ NOTIFICATIONS ══════ */}
        {section === 'notifications' && (
          <div className="settings-section">
            <h2>Notifications</h2>

            <div className="settings-group">
              <h3>Desktop Notifications</h3>
              <SettingRow label="Enable Notifications" desc="Show desktop notifications for new messages">
                <Toggle checked={settings.notifications} onChange={settings.toggleNotifications} />
              </SettingRow>

              <SettingRow label="Notification Sound" desc="Play a sound for new messages">
                <Toggle checked={settings.notificationSound} onChange={settings.toggleNotificationSound} />
              </SettingRow>

              <SettingRow label="Show Content" desc="Show message content in notifications (less private)">
                <Toggle checked={settings.notificationContent} onChange={settings.toggleNotificationContent} />
              </SettingRow>
            </div>

            <div className="settings-group">
              <h3>Focus</h3>
              <SettingRow label="Mentions Only" desc="Only notify for @mentions and direct messages">
                <Toggle checked={settings.mentionsOnly} onChange={settings.toggleMentionsOnly} />
              </SettingRow>

              <SettingRow label="Do Not Disturb" desc="Suppress all notifications">
                <Toggle checked={settings.doNotDisturb} onChange={settings.toggleDoNotDisturb} />
              </SettingRow>
            </div>
          </div>
        )}

        {/* ══════ DEVICES ══════ */}
        {section === 'devices' && <DevicesSection />}

        {/* ══════ INTEGRATIONS ══════ */}
        {section === 'integrations' && <SpotifyIntegrationSettings />}

        {/* ══════ UPDATES ══════ */}
        {section === 'updates' && <UpdatesSection />}

        {/* ══════ DANGER ══════ */}
        {section === 'danger' && (
          <div className="settings-section">
            <h2>Danger Zone</h2>

            <div className="settings-group settings-group--danger">
              <h3>Export Data</h3>
              <SettingRow label="Export Encrypted Backup" desc="Download a backup of all your local data as JSON">
                <Button variant="outline" size="sm" onClick={handleExportBackup}>
                  <Download size={14} /> Export
                </Button>
              </SettingRow>
              {exportStatus && (
                <p className="settings-inline-status">{exportStatus}</p>
              )}
            </div>

            <div className="settings-group settings-group--danger">
              <h3>Recovery Phrase</h3>
              <SettingRow label="View Recovery Phrase" desc="Display your vault user ID (keep this secret)">
                <Button variant="outline" size="sm" onClick={() => setShowRecoveryPhrase(!showRecoveryPhrase)}>
                  <Key size={14} /> {showRecoveryPhrase ? 'Hide' : 'View'} Phrase
                </Button>
              </SettingRow>
              {showRecoveryPhrase && (
                <div className="settings-recovery-code">
                  {userId || 'No vault ID found'}
                </div>
              )}
            </div>

            <div className="settings-group settings-group--danger">
              <h3>Panic Wipe</h3>
              <p className="settings-danger-desc">
                Permanently delete all local data including keys, messages, and vault. This action cannot be undone.
              </p>
              <Button variant="danger" onClick={() => setShowWipeConfirm(true)}>
                <Trash size={14} /> Wipe All Data
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Wipe Confirmation Modal ──────────────── */}
      {showWipeConfirm && (
        <Modal title="Confirm Data Wipe" onClose={() => { setShowWipeConfirm(false); setWipeInput(''); }}>
          <div className="settings-wipe-modal">
            <div className="settings-wipe-modal__warning">
              <AlertTriangle size={24} />
              <p>This will permanently destroy all local data including your identity keys, messages, and vault. This cannot be undone.</p>
            </div>
            <label className="settings-wipe-modal__label">
              Type <strong>WIPE ALL DATA</strong> to confirm:
            </label>
            <input
              className="settings-wipe-modal__input"
              type="text"
              value={wipeInput}
              onChange={e => setWipeInput(e.target.value)}
              placeholder="WIPE ALL DATA"
              autoFocus
            />
            <div className="settings-wipe-modal__actions">
              <Button variant="ghost" onClick={() => { setShowWipeConfirm(false); setWipeInput(''); }}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={wipeInput !== 'WIPE ALL DATA'}
                onClick={handlePanicWipe}
              >
                <Trash size={14} /> Wipe Everything
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── Inline QR Code generator (no external deps) ─────────── */

function QrCode({ data, size = 200 }: { data: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !data) return;
    // Encode data to QR matrix using a minimal alphanumeric/byte-mode encoder
    // We use the browser to render via a tiny QR encoding lib inlined below
    const modules = generateQrMatrix(data);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const cellSize = size / modules.length;
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    for (let r = 0; r < modules.length; r++) {
      for (let c = 0; c < modules[r].length; c++) {
        if (modules[r][c]) {
          ctx.fillRect(c * cellSize, r * cellSize, cellSize + 0.5, cellSize + 0.5);
        }
      }
    }
  }, [data, size]);

  return (
    <div className="settings-qr">
      <canvas ref={canvasRef} width={size} height={size} className="settings-qr__canvas" />
    </div>
  );
}

// Minimal QR Code matrix generator (Version 1-6, byte mode, ECC-L)
// Based on Kazuhiko Arase's qrcode-generator (MIT) — stripped to essentials
function generateQrMatrix(text: string): boolean[][] {
  const data = new TextEncoder().encode(text);
  const len = data.length;
  // Pick smallest version that fits (ECC L)
  const capacityL = [0,17,32,53,78,106,134,154,192,230,271,321,367,425,458,520,586,644,718,792,858];
  let version = 1;
  for (let v = 1; v <= 20; v++) {
    if (capacityL[v] >= len) { version = v; break; }
  }
  const size = version * 4 + 17;
  const grid: (boolean|null)[][] = Array.from({length: size}, () => Array(size).fill(null));

  // Place finder patterns
  function placeFinder(r: number, c: number) {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const fill = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                   (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                   (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
      grid[rr][cc] = fill;
    }
  }
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (grid[6][i] === null) grid[6][i] = (i % 2 === 0);
    if (grid[i][6] === null) grid[i][6] = (i % 2 === 0);
  }

  // Alignment patterns (version >= 2)
  if (version >= 2) {
    const positions = getAlignmentPositions(version);
    for (const r of positions) for (const c of positions) {
      if (grid[r][c] !== null) continue; // skip if overlaps finder
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const fill = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
        grid[r + dr][c + dc] = fill;
      }
    }
  }

  // Dark module + reserved areas
  grid[size - 8][8] = true;

  // Format info areas (reserve)
  for (let i = 0; i < 15; i++) {
    const r1 = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
    const c1 = i < 8 ? size - 1 - i : i < 9 ? 15 - i : 14 - i;
    if (grid[8][r1] === null) grid[8][r1] = false;
    if (grid[c1][8] === null) grid[c1][8] = false;
  }

  // Version info (version >= 7)
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3), c = size - 11 + (i % 3);
      if (grid[r][c] === null) grid[r][c] = false;
      if (grid[c][r] === null) grid[c][r] = false;
    }
  }

  // Encode data
  const ecBlocks = getEcInfo(version);
  const totalCodewords = ecBlocks.totalCodewords;
  const ecCodewordsPerBlock = ecBlocks.ecCodewordsPerBlock;
  const dataCodewords = totalCodewords - (ecBlocks.numBlocks * ecCodewordsPerBlock);

  const bits: number[] = [];
  // Mode indicator: byte mode = 0100
  bits.push(0, 1, 0, 0);
  // Character count
  const ccBits = version <= 9 ? 8 : 16;
  for (let i = ccBits - 1; i >= 0; i--) bits.push((len >> i) & 1);
  // Data
  for (const byte of data) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  // Terminator
  for (let i = 0; i < 4 && bits.length < dataCodewords * 8; i++) bits.push(0);
  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);
  // Pad codewords
  const padBytes = [0xEC, 0x11];
  let padIdx = 0;
  while (bits.length < dataCodewords * 8) {
    for (let i = 7; i >= 0; i--) bits.push((padBytes[padIdx] >> i) & 1);
    padIdx = (padIdx + 1) % 2;
  }

  // Convert bits to codewords
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] || 0);
    codewords.push(byte);
  }

  // RS error correction
  const allData = computeEcc(codewords, ecBlocks);

  // Place data bits
  const dataBits: number[] = [];
  for (const b of allData) for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1);

  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5; // skip timing column
    const rows = upward ? Array.from({length: size}, (_, i) => size - 1 - i) : Array.from({length: size}, (_, i) => i);
    for (const row of rows) {
      for (const dc of [0, -1]) {
        const c = col + dc;
        if (c < 0 || c >= size) continue;
        if (grid[row][c] !== null) continue;
        grid[row][c] = bitIdx < dataBits.length ? !!dataBits[bitIdx] : false;
        bitIdx++;
      }
    }
    upward = !upward;
  }

  // Apply best mask
  let bestMask = 0, bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(grid, mask, size);
    applyFormatInfo(masked, mask, size);
    const penalty = computePenalty(masked, size);
    if (penalty < bestPenalty) { bestPenalty = penalty; bestMask = mask; }
  }

  const result = applyMask(grid, bestMask, size);
  applyFormatInfo(result, bestMask, size);

  return result.map(row => row.map(cell => !!cell));
}

function getAlignmentPositions(version: number): number[] {
  if (version <= 1) return [];
  const size = version * 4 + 17;
  const last = size - 7;
  const intervals = version === 2 ? 1 : Math.ceil((last - 6) / (Math.floor(version / 7) + 1));
  const count = Math.floor((last - 6) / intervals) + 1;
  const pos = [6];
  for (let i = 1; i < count; i++) pos.push(last - (count - 1 - i) * intervals);
  return pos;
}

function getEcInfo(version: number) {
  // Simplified ECC-L parameters for common versions
  const table: Record<number, { totalCodewords: number; ecCodewordsPerBlock: number; numBlocks: number }> = {
    1: { totalCodewords: 26, ecCodewordsPerBlock: 7, numBlocks: 1 },
    2: { totalCodewords: 44, ecCodewordsPerBlock: 10, numBlocks: 1 },
    3: { totalCodewords: 70, ecCodewordsPerBlock: 15, numBlocks: 1 },
    4: { totalCodewords: 100, ecCodewordsPerBlock: 20, numBlocks: 1 },
    5: { totalCodewords: 134, ecCodewordsPerBlock: 26, numBlocks: 1 },
    6: { totalCodewords: 172, ecCodewordsPerBlock: 18, numBlocks: 2 },
    7: { totalCodewords: 196, ecCodewordsPerBlock: 20, numBlocks: 2 },
    8: { totalCodewords: 242, ecCodewordsPerBlock: 24, numBlocks: 2 },
    9: { totalCodewords: 292, ecCodewordsPerBlock: 30, numBlocks: 2 },
    10: { totalCodewords: 346, ecCodewordsPerBlock: 18, numBlocks: 4 },
  };
  return table[version] ?? table[5];
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  let r = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) r ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xFF;
    if (hi) a ^= 0x1D;
    b >>= 1;
  }
  return r;
}

function computeEcc(data: number[], ecInfo: { ecCodewordsPerBlock: number; numBlocks: number; totalCodewords: number }): number[] {
  const { ecCodewordsPerBlock, numBlocks, totalCodewords } = ecInfo;
  const dataPerBlock = Math.floor(data.length / numBlocks);
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];

  // Generate generator polynomial
  let gen = [1];
  for (let i = 0; i < ecCodewordsPerBlock; i++) {
    const next = new Array(gen.length + 1).fill(0);
    let exp = 1;
    for (let j = 0; j < i; j++) exp = gfMul(exp, 2);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], exp);
    }
    gen = next;
  }

  for (let b = 0; b < numBlocks; b++) {
    const start = b * dataPerBlock;
    const end = b < numBlocks - 1 ? start + dataPerBlock : data.length;
    const block = data.slice(start, end);
    blocks.push(block);

    // Polynomial division
    const msg = [...block, ...new Array(ecCodewordsPerBlock).fill(0)];
    for (let i = 0; i < block.length; i++) {
      const coeff = msg[i];
      if (coeff === 0) continue;
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coeff);
      }
    }
    ecBlocks.push(msg.slice(block.length));
  }

  // Interleave
  const result: number[] = [];
  const maxDataLen = Math.max(...blocks.map(b => b.length));
  for (let i = 0; i < maxDataLen; i++) for (const b of blocks) if (i < b.length) result.push(b[i]);
  for (let i = 0; i < ecCodewordsPerBlock; i++) for (const b of ecBlocks) if (i < b.length) result.push(b[i]);
  return result;
}

function applyMask(grid: (boolean|null)[][], mask: number, size: number): boolean[][] {
  const result = grid.map(row => [...row]) as boolean[][];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === null || grid[r][c] === undefined) continue;
      // Only mask data cells (not function patterns)
      // For simplicity, we check if the original grid had null (data area)
      // Actually grid has been filled, so we need a separate function-pattern check
    }
  }
  // Re-walk and only flip data modules
  const funcPattern = grid.map(row => row.map(cell => cell !== null));
  // Reconstruct: funcPattern marks the cells placed BEFORE data
  // But our grid already has data placed. We need to flip data-area cells.
  // Since we placed data where grid was null, use a mask check approach:
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let shouldFlip = false;
      switch (mask) {
        case 0: shouldFlip = (r + c) % 2 === 0; break;
        case 1: shouldFlip = r % 2 === 0; break;
        case 2: shouldFlip = c % 3 === 0; break;
        case 3: shouldFlip = (r + c) % 3 === 0; break;
        case 4: shouldFlip = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
        case 5: shouldFlip = ((r * c) % 2 + (r * c) % 3) === 0; break;
        case 6: shouldFlip = ((r * c) % 2 + (r * c) % 3) % 2 === 0; break;
        case 7: shouldFlip = ((r + c) % 2 + (r * c) % 3) % 2 === 0; break;
      }
      // Only flip if it's in the data area (wasn't a function pattern originally)
      // We'll use a simpler heuristic: check reserved areas
      if (shouldFlip && isDataModule(r, c, size, grid)) {
        result[r][c] = !result[r][c];
      }
    }
  }
  return result;
}

function isDataModule(r: number, c: number, size: number, _grid: (boolean|null)[][]): boolean {
  // Finder patterns + separators
  if (r <= 8 && c <= 8) return false;
  if (r <= 8 && c >= size - 8) return false;
  if (r >= size - 8 && c <= 8) return false;
  // Timing
  if (r === 6 || c === 6) return false;
  // Dark module
  if (r === size - 8 && c === 8) return false;
  return true;
}

function applyFormatInfo(grid: boolean[][], mask: number, size: number) {
  // ECC level L = 01, format info with BCH error correction
  const formatData = (0b01 << 3) | mask;
  const FORMAT_INFOS = [
    0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976,
    0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0,
    0x355F, 0x3068, 0x3F31, 0x3A06, 0x24B4, 0x2183, 0x2EDA, 0x2BED,
    0x1689, 0x13BE, 0x1CE7, 0x19D0, 0x0762, 0x0255, 0x0D0C, 0x083B,
  ];
  const fmtBits = FORMAT_INFOS[formatData] ?? 0;

  // Place along finder pattern edges
  const bits: boolean[] = [];
  for (let i = 14; i >= 0; i--) bits.push(!!((fmtBits >> i) & 1));

  for (let i = 0; i < 15; i++) {
    // Horizontal: row 8
    const hc = i < 8 ? (i < 6 ? i : i + 1) : size - 15 + i;
    grid[8][hc] = bits[i];
    // Vertical: col 8
    const vr = i < 8 ? (size - 1 - i) : (i < 9 ? 15 - i - 1 : 14 - i);
    grid[vr][8] = bits[i];
  }
}

function computePenalty(grid: boolean[][], size: number): number {
  let penalty = 0;
  // Rule 1: runs of same color
  for (let r = 0; r < size; r++) {
    let count = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === grid[r][c-1]) { count++; }
      else { if (count >= 5) penalty += count - 2; count = 1; }
    }
    if (count >= 5) penalty += count - 2;
  }
  for (let c = 0; c < size; c++) {
    let count = 1;
    for (let r = 1; r < size; r++) {
      if (grid[r][c] === grid[r-1][c]) { count++; }
      else { if (count >= 5) penalty += count - 2; count = 1; }
    }
    if (count >= 5) penalty += count - 2;
  }
  return penalty;
}

/* ── E2EE Key Regeneration Component ────────────────────── */

function E2EERegenerate() {
  const [state, setState] = useState<'idle' | 'confirm' | 'working' | 'done' | 'error'>('idle');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const userId = useAuthStore(s => s.userId);
  const sessionToken = useAuthStore(s => s.sessionToken);
  const { idsUrl } = useConnectionStore();

  const handleRegenerate = async () => {
    if (!userId || !sessionToken) {
      setError('Not logged in.');
      setState('error');
      return;
    }
    if (!password) {
      setError('Password is required to protect the new vault.');
      return;
    }
    setState('working');
    setError('');
    try {
      await initCrypto();

      // Derive vault encryption key from the user's password
      const salt = await generateSalt();
      const kdfParams = createKdfParams(salt);
      const { encryptionKey } = await deriveVaultKey(password, kdfParams);

      const identityKeyPair = await generateIdentityKey();
      const { spk, secretKey: spkSecret } = await createSignedPreKey(identityKeyPair.secretKey, 1);
      const { keys: otpks, secrets: otpkSecrets } = await generateOneTimePreKeys(1, 20);
      const bundle = buildPreKeyBundle(identityKeyPair.publicKey, spk, otpks);

      const vaultKeys = {
        identityKeyPair: {
          publicKey: toBase64(identityKeyPair.publicKey),
          secretKey: toBase64(identityKeyPair.secretKey),
        },
        signedPreKey: {
          keyId: spk.keyId,
          publicKey: spk.publicKey,
          secretKey: toBase64(spkSecret),
          signature: spk.signature,
        },
        oneTimePreKeys: otpks.map(k => ({
          keyId: k.keyId,
          publicKey: k.publicKey,
          secretKey: toBase64(otpkSecrets.get(k.keyId)!),
        })),
      };

      await saveVault(userId, vaultKeys, encryptionKey);
      await saveKdfParams(userId, kdfParams);

      // Register new bundle on IDS
      const regRes = await fetch(`${idsUrl}/v1/keys/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
        body: JSON.stringify({
          userId,
          identityKey: bundle.identityKey,
          signedPreKey: {
            keyId: bundle.signedPreKey.keyId,
            publicKey: bundle.signedPreKey.publicKey,
            signature: bundle.signedPreKey.signature,
            createdAt: Date.now(),
          },
          oneTimePreKeys: bundle.oneTimePreKeys,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!regRes.ok) throw new Error(`IDS registration failed: ${regRes.status}`);

      // Push public bundle to cross-device sync
      await fetch(`${idsUrl}/v1/sync/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
        body: JSON.stringify({ key: 'e2eeBundle', value: {
          identityKey: bundle.identityKey,
          signedPreKey: bundle.signedPreKey,
          oneTimePreKeys: bundle.oneTimePreKeys,
        }}),
        signal: AbortSignal.timeout(8_000),
      });

      // Wipe any stale ratchet sessions from previous keys
      wipeSessions();

      // Update in-memory identity keys so the session works immediately
      loadVaultKeys(vaultKeys, userId);

      // Critical: also update authStore — X3DH send/receive both read from here
      useAuthStore.setState({
        identityKeyPair: {
          publicKey: identityKeyPair.publicKey,
          secretKey: identityKeyPair.secretKey,
        },
        encryptionKey,   // keep real key in memory so vault updates work
        kdfParams,
      });

      setPassword('');
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  };

  if (state === 'confirm') {
    return (
      <div className="settings-info-card settings-inline-panel">
        <strong className="settings-inline-title settings-inline-title--warning">Regenerate E2EE keys?</strong>
        <p className="settings-inline-copy">This creates new encryption keys on this device. Existing encrypted sessions will need to be re-established. Enter your account password to protect the new vault.</p>
        <input
          type="password"
          className="settings-input"
          placeholder="Your account password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleRegenerate()}
          autoFocus
        />
        {error && <span className="settings-inline-error">{error}</span>}
        <div className="settings-inline-actions">
          <Button variant="danger" size="sm" onClick={handleRegenerate}>Generate new keys</Button>
          <Button variant="ghost" size="sm" onClick={() => { setState('idle'); setPassword(''); setError(''); }}>Cancel</Button>
        </div>
      </div>
    );
  }
  if (state === 'working') {
    return <div className="settings-info-card"><span className="settings-inline-copy">Generating new keys and registering…</span></div>;
  }
  if (state === 'done') {
    return <div className="settings-info-card settings-inline-panel settings-inline-panel--success"><Check size={16} /> New E2EE keys generated and registered. Tell your contacts to refresh — messages can now be encrypted.</div>;
  }
  if (state === 'error') {
    return (
      <div className="settings-info-card settings-inline-panel">
        <span className="settings-inline-error">Error: {error}</span>
        <Button variant="ghost" size="sm" onClick={() => setState('idle')}>Try again</Button>
      </div>
    );
  }
  return (
    <SettingRow label="Regenerate E2EE Keys" desc="Generate new encryption keys for this device (use if E2EE is unavailable after a data loss)">
      <Button variant="ghost" size="sm" onClick={() => setState('confirm')}>Regenerate</Button>
    </SettingRow>
  );
}

/* ── 2FA Setup Component ─────────────────────────────────── */

function TwoFactorSetup() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'setup' | 'enabled' | 'error'>('idle');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailHint, setEmailHint] = useState('');
  const [devEmailCode, setDevEmailCode] = useState('');
  const [error, setError] = useState('');
  const [is2faEnabled, setIs2faEnabled] = useState(false);
  const idsUrl = useConnectionStore(s => s.idsUrl);
  const userId = useAuthStore(s => s.userId);
  const sessionToken = useAuthStore(s => s.sessionToken);

  // Check 2FA status on mount
  useEffect(() => {
    if (!userId) return;
    fetch(`${idsUrl}/v1/auth/2fa/status/${encodeURIComponent(userId)}`)
      .then(r => r.json())
      .then(d => setIs2faEnabled(!!d.enabled))
      .catch(() => {});
  }, [userId, idsUrl]);

  const handleSetup = async () => {
    setStatus('loading');
    setError('');
    try {
      const token = sessionToken;
      if (!token) { setError('Not authenticated. Please log out and log back in.'); setStatus('idle'); return; }
      const res = await fetch(`${idsUrl}/v1/auth/2fa/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Setup failed'); setStatus('idle'); return; }
      setSecret(data.secret);
      setOtpauthUri(data.otpauthUri);
      setEmailHint(data.emailHint || 'your email');
      setDevEmailCode(data.devEmailCode || '');
      setBackupCodes([]);
      setCode('');
      setEmailCode('');
      setStatus('setup');
    } catch {
      setError('Failed to connect to server');
      setStatus('idle');
    }
  };

  const handleConfirm = async () => {
    if (code.length !== 6 || emailCode.length !== 6) return;
    setError('');
    try {
      const token = sessionToken;
      if (!token) { setError('Not authenticated'); return; }
      const res = await fetch(`${idsUrl}/v1/auth/2fa/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code, emailCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'invalid_totp_code') setError('Invalid authenticator code. Try again.');
        else if (data.error === 'invalid_email_code') setError('Invalid email verification code. Try again.');
        else if (data.error === 'email_code_expired') setError('Email code expired. Start setup again.');
        else setError('Verification failed. Try again.');
        return;
      }
      setBackupCodes(Array.isArray(data.backupCodes) ? data.backupCodes : []);
      setIs2faEnabled(true);
      setStatus('enabled');
    } catch {
      setError('Failed to connect to server');
    }
  };

  const handleDisable = async () => {
    try {
      const token = sessionToken;
      if (!token) { setError('Not authenticated'); return; }
      const res = await fetch(`${idsUrl}/v1/auth/2fa/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setIs2faEnabled(false);
        setStatus('idle');
        setSecret('');
        setOtpauthUri('');
        setBackupCodes([]);
        setCode('');
        setEmailCode('');
        setEmailHint('');
        setDevEmailCode('');
      }
    } catch {
      setError('Failed to disable 2FA');
    }
  };

  return (
    <div className="settings-group">
      <h3><ShieldCheck size={14} /> Two-Factor Authentication</h3>
      {is2faEnabled ? (
        <>
          <div className="settings-info-card settings-2fa-card" style={{ borderColor: 'var(--settings-status-success-border)' }}>
            <span className="settings-2fa-icon" style={{ color: 'var(--settings-status-success-text)' }}><Check size={20} /></span>
            <div>
              <strong>2FA is enabled</strong>
              <p>Your account is protected with TOTP two-factor authentication.</p>
            </div>
          </div>
          <div className="settings-inline-actions">
            <Button variant="danger" size="sm" onClick={handleDisable}>
              Disable 2FA
            </Button>
          </div>
        </>
      ) : status === 'setup' ? (
        <>
          <p className="settings-2fa-copy">
            Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.),
            or manually enter the secret key below.
          </p>
          <QrCode data={otpauthUri} size={200} />
          <div className="settings-2fa-secret">
            Secret: {secret}
          </div>
          <div className="settings-2fa-hints">
            <p className="settings-2fa-hint">
              We sent a 6-digit verification code to {emailHint}. Enter both codes below to enable 2FA and reveal your backup codes.
            </p>
            {devEmailCode && (
              <p className="settings-2fa-hint settings-2fa-hint--warning">
                Dev email code: <strong>{devEmailCode}</strong>
              </p>
            )}
          </div>
          <div className="settings-2fa-code-row">
            <input
              type="text"
              className="settings-input settings-2fa-code-input"
              placeholder="Authenticator code"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && handleConfirm()}
            />
            <input
              type="text"
              className="settings-input settings-2fa-code-input"
              placeholder="Email code"
              value={emailCode}
              onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && handleConfirm()}
            />
            <Button variant="primary" size="sm" onClick={handleConfirm} disabled={code.length !== 6 || emailCode.length !== 6}>
              <Check size={14} /> Verify &amp; Enable
            </Button>
          </div>
          {error && <p className="settings-inline-error">{error}</p>}
        </>
      ) : status === 'enabled' ? (
        <div className="settings-info-card settings-2fa-card" style={{ borderColor: 'var(--settings-status-success-border)' }}>
          <span className="settings-2fa-icon" style={{ color: 'var(--settings-status-success-text)' }}><Check size={20} /></span>
          <div>
            <strong>2FA enabled successfully!</strong>
            <p>Your account is now protected with two-factor authentication.</p>
            {backupCodes.length > 0 && (
              <>
                <p className="settings-2fa-copy" style={{ marginTop: 8 }}>
                  Save these backup codes in a secure password manager. Each code is single-use.
                </p>
                <div className="settings-2fa-backup-grid">
                  {backupCodes.map((c, i) => <span key={i}>{c}</span>)}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <p className="settings-2fa-copy">
            Add an extra layer of security to your account with time-based one-time passwords (TOTP).
          </p>
          <Button variant="primary" size="sm" onClick={handleSetup} disabled={status === 'loading'}>
            <Shield size={14} /> {status === 'loading' ? 'Setting up\u2026' : 'Enable 2FA'}
          </Button>
          {error && <p className="settings-inline-error">{error}</p>}
        </>
      )}
    </div>
  );
}

type PrivateBetaCapabilities = {
  dmE2eeSupported?: boolean;
  groupMessagingSupported?: boolean;
  encryptedLocalStorageSupported?: boolean;
  serverDataEncryptedAtRestSupported?: boolean;
  dmEncryptedAttachmentsSupported?: boolean;
  encryptedBackupsSupported?: boolean;
  integrationCredentialsProtected?: boolean;
};

function PrivateBetaSecurityCard() {
  const idsUrl = useConnectionStore(s => s.idsUrl);
  const [capabilities, setCapabilities] = useState<PrivateBetaCapabilities | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${idsUrl}/v1/security/capabilities`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('capabilities_failed')))
      .then((value) => setCapabilities(value))
      .catch(() => setCapabilities(null));
    return () => controller.abort();
  }, [idsUrl]);

  const rows = [
    ['Direct messages', capabilities?.dmE2eeSupported, 'End-to-end encrypted'],
    ['Group messages', false, 'Disabled until secure group encryption is complete'],
    ['Local database', capabilities?.encryptedLocalStorageSupported, 'Encrypted'],
    ['Server data', capabilities?.serverDataEncryptedAtRestSupported, 'Encrypted at rest'],
    ['Direct-message attachments', capabilities?.dmEncryptedAttachmentsSupported, 'Encrypted before upload'],
    ['Backups', capabilities?.encryptedBackupsSupported, 'Encrypted'],
    ['Integration credentials', capabilities?.integrationCredentialsProtected, 'Protected'],
  ] as const;

  return (
    <div className="settings-group settings-group--private-beta-security">
      <div className="private-beta-security__heading">
        <div>
          <h3>Private Beta Security</h3>
          <p>Verified protection currently reported by Ridgeline services.</p>
        </div>
        <span className="private-beta-security__badge">PRIVATE BETA</span>
      </div>
      <div className="private-beta-security__rows">
        {rows.map(([label, verified, verifiedLabel]) => (
          <div className="private-beta-security__row" key={label}>
            <span>{label}</span>
            <strong className={verified ? 'is-verified' : 'is-unconfigured'}>
              {verified ? <Check size={13} /> : <AlertTriangle size={13} />}
              {label === 'Group messages' ? verifiedLabel : (verified ? verifiedLabel : 'Not configured')}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function SecurityStatusCard() {
  const idsUrl = useConnectionStore(s => s.idsUrl);
  const userId = useAuthStore(s => s.userId);
  const sessionToken = useAuthStore(s => s.sessionToken);
  const localLoginAlerts = useSettingsStore(s => s.loginAlerts);

  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [busyAction, setBusyAction] = useState<'toggle' | 'secure' | null>(null);
  const [status, setStatus] = useState<{
    loginAlertsEnabled: boolean;
    posture: { score: number; level: 'strong' | 'guarded' | 'watch' | 'risk' };
    factors: { twoFactorEnabled: boolean; backupCodesRemaining: number; knownDevices: number; uniqueLocations: number };
    recentLogins: Array<{ deviceLabel: string; locationLabel: string; ipHint: string; lastSeenAt: string }>;
  } | null>(null);

  const syncStatus = async () => {
    if (!userId || !sessionToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${idsUrl}/v1/auth/security/status/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res.ok) throw new Error('status_failed');
      const data = await res.json();
      const loginAlertsEnabled = !!data.loginAlertsEnabled;
      setStatus({
        loginAlertsEnabled,
        posture: {
          score: Number(data?.posture?.score ?? 0),
          level: (data?.posture?.level ?? 'watch') as 'strong' | 'guarded' | 'watch' | 'risk',
        },
        factors: {
          twoFactorEnabled: !!data?.factors?.twoFactorEnabled,
          backupCodesRemaining: Number(data?.factors?.backupCodesRemaining ?? 0),
          knownDevices: Number(data?.factors?.knownDevices ?? 0),
          uniqueLocations: Number(data?.factors?.uniqueLocations ?? 0),
        },
        recentLogins: Array.isArray(data?.recentLogins) ? data.recentLogins : [],
      });
      useSettingsStore.setState({ loginAlerts: loginAlertsEnabled });
    } catch {
      setNotice('Unable to load security status right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    syncStatus();
  }, [idsUrl, userId, sessionToken]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('secure_account_token');
    if (!token) return;

    (async () => {
      try {
        const res = await fetch(`${idsUrl}/v1/auth/security/secure-account-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          setNotice('Security link confirmed. Active sessions were revoked.');
        } else {
          setNotice('Security link is invalid or expired.');
        }
      } catch {
        setNotice('Could not process the security link.');
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete('secure_account_token');
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
        void syncStatus();
      }
    })();
  }, [idsUrl]);

  const handleToggleLoginAlerts = async () => {
    if (!sessionToken || busyAction) return;
    const next = !(status?.loginAlertsEnabled ?? localLoginAlerts);
    setBusyAction('toggle');
    setNotice('');
    try {
      const res = await fetch(`${idsUrl}/v1/auth/security/login-alerts`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error('toggle_failed');
      setStatus(prev => prev ? { ...prev, loginAlertsEnabled: next } : prev);
      useSettingsStore.setState({ loginAlerts: next });
      setNotice(next ? 'Login alerts are now enabled.' : 'Login alerts are now disabled.');
    } catch {
      setNotice('Could not update login alerts right now.');
    } finally {
      setBusyAction(null);
      void syncStatus();
    }
  };

  const handleSecureAccount = async () => {
    if (!sessionToken || busyAction === 'secure') return;
    const confirmed = window.confirm('Secure your account now? This will sign out every active session.');
    if (!confirmed) return;

    setBusyAction('secure');
    setNotice('');
    try {
      const res = await fetch(`${idsUrl}/v1/auth/security/secure-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res.ok) throw new Error('secure_failed');
      const data = await res.json();
      const revoked = Number(data?.revokedSessions ?? 0);
      setNotice(`Account secured. Revoked ${revoked} session${revoked === 1 ? '' : 's'}.`);
    } catch {
      setNotice('Could not secure your account right now.');
    } finally {
      setBusyAction(null);
      void syncStatus();
    }
  };

  const score = Math.max(0, Math.min(100, Number(status?.posture?.score ?? 0)));
  const level = status?.posture?.level ?? 'watch';

  const toneByLevel: Record<'strong' | 'guarded' | 'watch' | 'risk', { title: string; face: string }> = {
    strong: { title: 'Strong', face: ':D' },
    guarded: { title: 'Guarded', face: ':)' },
    watch: { title: 'Watch', face: ':/' },
    risk: { title: 'At Risk', face: ':(' },
  };

  const faceStops = [
    { threshold: 0, face: ':(' },
    { threshold: 40, face: ':/' },
    { threshold: 60, face: ':)' },
    { threshold: 80, face: ':D' },
  ];

  return (
    <div className="settings-group settings-group--security-status">
      <h3>Account Security Status</h3>
      {loading ? (
        <p className="settings-hint">Loading security status…</p>
      ) : (
        <>
          <div className={`settings-security-status settings-security-status--${level}`}>
            <div className="settings-security-status__head">
              <span className="settings-security-status__face">{toneByLevel[level].face}</span>
              <div>
                <strong>{toneByLevel[level].title} Protection</strong>
                <p>Security score {score}/100 based on 2FA, login alerts, and recent device activity.</p>
              </div>
            </div>

            <div className="settings-security-status__line">
              <div className="settings-security-status__meter" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${score}%` }} />
              </div>
              <div className="settings-security-status__faces" aria-hidden="true">
                {faceStops.map(stop => (
                  <span key={stop.threshold} className={score >= stop.threshold ? 'is-active' : ''}>{stop.face}</span>
                ))}
              </div>
            </div>

            <div className="settings-security-status__facts">
              <span>2FA: {status?.factors.twoFactorEnabled ? 'On' : 'Off'}</span>
              <span>Backup codes: {status?.factors.backupCodesRemaining ?? 0}</span>
              <span>Known devices: {status?.factors.knownDevices ?? 0}</span>
              <span>Locations: {status?.factors.uniqueLocations ?? 0}</span>
            </div>
          </div>

          <SettingRow
            label="Login Alerts"
            desc="Email alerts when your account signs in from a new device or area"
          >
            <Toggle
              checked={status?.loginAlertsEnabled ?? localLoginAlerts}
              onChange={handleToggleLoginAlerts}
            />
          </SettingRow>

          <SettingRow
            label="Secure Account"
            desc="Immediately revoke all active sessions if you suspect unauthorized access"
          >
            <Button variant="danger" size="sm" onClick={handleSecureAccount}>
              <ShieldAlert size={14} /> {busyAction === 'secure' ? 'Securing…' : 'Secure Now'}
            </Button>
          </SettingRow>

          {Array.isArray(status?.recentLogins) && status!.recentLogins.length > 0 && (
            <div className="settings-security-status__recent">
              <strong>Recent login activity</strong>
              <div className="settings-security-status__recent-list">
                {status!.recentLogins.slice(0, 3).map((entry, idx) => (
                  <div key={`${entry.lastSeenAt}-${idx}`} className="settings-security-status__recent-item">
                    <span>{entry.deviceLabel}</span>
                    <span>{entry.locationLabel} · {entry.ipHint}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {notice ? <p className="settings-hint">{notice}</p> : null}
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────── */

function DevicesSection() {
  const idsUrl = useConnectionStore(s => s.idsUrl);
  const sessionToken = useAuthStore(s => s.sessionToken);
  const [sessions, setSessions] = useState<Array<{
    id?: string;
    token: string;
    createdAt: number;
    expiresAt: number | null;
    deviceInfo: {
      deviceLabel?: string;
      locationLabel?: string;
      ipHint?: string;
      userAgent?: string;
      lastActiveAt?: number;
    } | null;
    isCurrent: boolean;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const getDeviceHeaders = (): Record<string, string> => {
    try {
      const deviceId = localStorage.getItem('ridgeline:device-id');
      return deviceId ? { 'X-Ridgeline-Device-ID': deviceId } : {};
    } catch {
      return {};
    }
  };

  const fetchSessions = async () => {
    if (!sessionToken) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotice('');
    try {
      const res = await fetch(`${idsUrl}/v1/auth/sessions`, {
        headers: { Authorization: `Bearer ${sessionToken}`, ...getDeviceHeaders() },
      });
      if (!res.ok) throw new Error('sessions_failed');
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      setSessions([]);
      setNotice('Device activity could not be loaded. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSessions(); }, [sessionToken, idsUrl]);

  const parseDevice = (info: { deviceLabel?: string; userAgent?: string } | null) => {
    if (!info) return 'Unknown Device';
    if (typeof info.deviceLabel === 'string' && info.deviceLabel.trim()) return info.deviceLabel;
    const ua = String(info.userAgent || '');
    if (/Electron/i.test(ua)) return 'Desktop App';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac/i.test(ua)) return 'macOS';
    if (/Linux/i.test(ua)) return 'Linux';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad/i.test(ua)) return 'iOS';
    return 'Browser';
  };

  const fmtDate = (ts: number | null) => ts ? new Date(ts).toLocaleString() : 'Unknown';

  const handleRevoke = async (session: { id?: string; token: string; isCurrent: boolean }) => {
    const sessionId = session.id || session.token;
    if (!sessionToken || !sessionId || session.isCurrent) return;
    if (!window.confirm('Sign out this device? It will need to log in again to access Ridgeline.')) return;

    setRevokingId(sessionId);
    setNotice('');
    try {
      const res = await fetch(`${idsUrl}/v1/auth/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res.ok) throw new Error('revoke_failed');
      setSessions(current => current.filter(entry => (entry.id || entry.token) !== sessionId));
      setNotice('Device signed out.');
    } catch {
      setNotice('Could not sign out that device. Please try again.');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="settings-section settings-section--devices">
      <div className="settings-devices__heading">
        <div>
          <h2>Devices</h2>
          <p className="settings-section__desc">Review where your account is signed in and remove access you no longer trust.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void fetchSessions()} disabled={loading}>
          <Refresh size={14} /> {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      <div className="settings-devices__summary">
        <span className="settings-devices__summary-icon"><Monitor size={18} /></span>
        <div>
          <strong>{sessions.length} active {sessions.length === 1 ? 'session' : 'sessions'}</strong>
          <span>Session details include the device, rough location, and masked network address.</span>
        </div>
      </div>

      <div className="settings-group settings-devices__list">
        {loading ? (
          <p className="settings-hint">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="settings-hint">No active sessions found for this account.</p>
        ) : (
          sessions.map((s, i) => (
            <div key={s.id || s.token || i} className={`settings-device ${s.isCurrent ? 'settings-device--current' : ''}`}>
              <div className="settings-device__icon"><Monitor size={18} /></div>
              <div className="settings-device__info">
                <strong>{parseDevice(s.deviceInfo)}{s.isCurrent ? ' (This Device)' : ''}</strong>
                <span>
                  Logged in {fmtDate(s.createdAt)} &mdash; Expires {fmtDate(s.expiresAt)}
                  {s.deviceInfo?.locationLabel ? ` · ${s.deviceInfo.locationLabel}` : ''}
                </span>
                <span className="settings-device__network">
                  {s.deviceInfo?.lastActiveAt ? `Last active ${fmtDate(s.deviceInfo.lastActiveAt)}` : 'Last active time unavailable'}
                  {s.deviceInfo?.ipHint ? ` · Network ${s.deviceInfo.ipHint}` : ''}
                </span>
              </div>
              {s.isCurrent ? (
                <span className="settings-device__badge">Current</span>
              ) : (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void handleRevoke(s)}
                  disabled={revokingId === (s.id || s.token)}
                >
                  <Trash size={13} /> {revokingId === (s.id || s.token) ? 'Signing out...' : 'Sign out'}
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      {notice ? <p className="settings-devices__notice">{notice}</p> : null}
    </div>
  );
}

function UpdatesSection() {
  const update = useUpdateStore();
  const { snapshot, history } = update;
  const { phase, available, currentVersion, lastCheckedAt, errorCode, channel, progressPercent, restartBlockedReason } = snapshot;
  const checking = phase === 'checking';
  const activeDownload = phase === 'downloading' || phase === 'verifying';
  const readyToRestart = ['staged', 'restart_required', 'deferred', 'blocked'].includes(phase);
  const handleCheck = () => { void update.checkForUpdate(); };
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleString() : 'Never';
  const statusTone = phase === 'failed' ? 'failed' : (checking || activeDownload ? 'checking' : (available ? 'available' : 'current'));
  const statusLabel = ({
    idle: 'Ready', checking: 'Checking now', update_available: 'Update available', downloading: 'Downloading',
    verifying: 'Verifying', staged: 'Ready to restart', restart_required: 'Restart required', installing: 'Installing',
    completed: 'Updated', no_update: 'Up to date', deferred: 'Restart later', failed: 'Check failed', blocked: 'Update required',
  } as Record<typeof phase, string>)[phase];
  const friendlyError = errorCode ? ({
    timeout: 'The update service did not respond. Ridgeline will try again later.',
    rate_limited: 'Update checks are temporarily limited. Please try again later.',
    server_error: 'The update service is temporarily unavailable.',
    invalid_signature: 'The release could not be verified and was rejected.',
    unknown_signing_key: 'The release was signed by an untrusted key and was rejected.',
    expired_metadata: 'The release information expired and was rejected.',
    artifact_hash_mismatch: 'The downloaded update did not pass verification and was deleted.',
    updater_manifest_mismatch: 'The update package did not match its release information and was rejected.',
    metadata_not_found: 'The update service did not provide the release file requested by this build.',
    artifact_size_mismatch: 'The downloaded update size did not match the verified release information.',
    unapproved_redirect: 'The update service redirected to an unapproved location and was blocked.',
    invalid_json: 'The update service returned invalid release information.',
    network_unavailable: 'Ridgeline could not reach the update service.',
  } as Record<string, string>)[errorCode] ?? 'Ridgeline could not check for updates. It will try again later.' : null;
  const errorAdvice = errorCode === 'metadata_not_found'
    ? 'The release channel is being refreshed. Try again in a moment.'
    : errorCode === 'timeout' || errorCode === 'server_error' || errorCode === 'network_unavailable'
      ? 'Check your connection, then try again. Your current build is unchanged.'
      : errorCode
        ? 'Your current build is unchanged. Recheck after the service is available.'
        : null;

  return (
    <div className="settings-section settings-section--updates">
      <h2>Updates</h2>
      <p className="settings-updates__intro">Stay current with secure, verified Ridgeline releases.</p>

      <div className={`settings-update-banner settings-update-banner--${statusTone}`}>
        <div className="settings-update-banner__top">
          <div className="settings-update-banner__ver">
            <span className="settings-update-banner__icon"><Shield size={20} /></span>
            <div className="settings-update-banner__version-wrap">
              <span className="settings-update-banner__brand">RIDGELINE <strong>v{currentVersion}</strong></span>
              <span className="settings-update-banner__meta">Last checked: {fmtDate(lastCheckedAt)}</span>
            </div>
          </div>
          <span className={`settings-update-pill settings-update-pill--${statusTone}`}>{statusLabel}</span>
        </div>

        <div className="settings-update-banner__summary">
          {available ? (
            <>
              <p className="settings-update-banner__message">
                Version <strong>v{available.version}</strong> is {readyToRestart ? 'verified and ready to install' : statusLabel.toLowerCase()}.
              </p>
              <div className="settings-update-banner__actions">
                {readyToRestart && (
                  <Button variant="primary" size="sm" onClick={() => void update.restartAndInstall()}>
                    <Refresh size={14} /> Restart and Update
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleCheck} disabled={checking}>
                  <Refresh size={14} /> {checking ? 'Checking\u2026' : 'Recheck'}
                </Button>
              </div>
            </>
          ) : (
            <div className="settings-update-banner__actions">
              <p className="settings-update-banner__message">You are running the latest verified build.</p>
              <Button variant="primary" size="sm" onClick={handleCheck} disabled={checking}>
                <Refresh size={14} /> {checking ? 'Checking\u2026' : 'Check Now'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="settings-group">
        <h3>Update Preferences</h3>
        <div className="settings-update-controls">
          <SettingRow label="Release channel" desc="The channel is fixed by this signed Ridgeline build">
            <Badge>{channel}</Badge>
          </SettingRow>
          <SettingRow label="Automatic downloads" desc="Verified routine updates download quietly and install when Ridgeline restarts">
            <Badge>On</Badge>
          </SettingRow>
          {activeDownload && (
            <div className="settings-update-controls__source">
              <span className="settings-update-source">{phase === 'verifying' ? 'Verifying downloaded update' : `Downloading ${Math.round(progressPercent ?? 0)}%`}</span>
            </div>
          )}
        </div>
        {friendlyError && (
          <div className="settings-update-error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <strong>Update check needs attention</strong>
              <p>{friendlyError}</p>
              {errorAdvice && <span>{errorAdvice}</span>}
              <code>Code: {errorCode}</code>
            </div>
            <Button variant="ghost" size="sm" onClick={handleCheck} disabled={checking}>
              <Refresh size={14} /> Try again
            </Button>
          </div>
        )}
        {restartBlockedReason && <p className="settings-update-error">{restartBlockedReason}</p>}
      </div>

      {available && (
        <div className="settings-group">
          <h3>Release Details</h3>
          <div className="settings-update-card">
            <div className="settings-update-card__header">
              <span className="settings-update-badge">v{available.version}</span>
              <span className="settings-update-card__title">{available.releaseNotes.title}</span>
              {available.mandatory && <span className="settings-update-badge settings-update-badge--force">Required</span>}
              <span className="settings-update-badge settings-update-badge--channel">{available.channel}</span>
            </div>
            <p className="settings-update-card__changelog">{available.releaseNotes.summary}</p>
            {[...available.releaseNotes.highlights, ...available.releaseNotes.fixes, ...available.releaseNotes.security].length > 0 && (
              <ul className="settings-update-card__changelog">
                {[...available.releaseNotes.highlights, ...available.releaseNotes.fixes, ...available.releaseNotes.security].map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            )}
            <div className="settings-update-card__meta">
              <span>{available.classification} / {available.urgency}</span>
              <span>Published: {fmtDate(available.publishedAt)}</span>
            </div>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="settings-group">
          <h3>Update History</h3>
          <div className="settings-update-history">
            {history.map(h => (
              <div key={h.version} className="settings-update-history__item">
                <div className="settings-update-history__head">
                  <span className="settings-update-badge">v{h.version}</span>
                  <span className="settings-update-history__title">{h.releaseNotes.title}</span>
                  <span className="settings-update-badge settings-update-badge--channel">{h.channel}</span>
                </div>
                <p className="settings-update-history__changelog">{h.releaseNotes.summary}</p>
                <span className="settings-update-history__date">{fmtDate(h.publishedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <span className="settings-row__label">{label}</span>
        <span className="settings-row__desc">{desc}</span>
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      className={`settings-toggle ${checked ? 'settings-toggle--on' : ''}`}
      onClick={onChange}
      role="switch"
      aria-checked={checked}
    >
      <span className="settings-toggle__thumb" />
    </button>
  );
}
