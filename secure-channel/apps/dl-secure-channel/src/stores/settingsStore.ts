/* ──────────────────────────────────────────────────────────
 *  Settings Store — app preferences
 * ────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Helper to safely call Electron APIs (no-op in browser)
const electron = () => window.electronAPI;

export type ChatBackground =
  | 'default'
  | 'gradient-midnight'
  | 'gradient-aurora'
  | 'gradient-ember'
  | 'gradient-ocean'
  | 'gradient-forest'
  | 'solid-dark'
  | 'solid-charcoal';

export type ShellBackground =
  | 'default'
  | 'graphite'
  | 'sunset'
  | 'ocean'
  | 'forest'
  | 'berry'
  | 'midnight-grid'
  | 'aurora'
  | 'ember'
  | 'plum'
  | 'mono'
  | 'custom';

const DEFAULT_BG_PRIMARY = 'var(--dl-bg-primary)';

export const APP_BODY_BACKGROUND_CSS: Record<ShellBackground, string> = {
  default: DEFAULT_BG_PRIMARY,
  graphite: 'linear-gradient(140deg, #10151c 0%, #191f28 48%, #112a30 100%)',
  sunset: 'linear-gradient(135deg, #2a1514 0%, #55312c 46%, #a9592d 100%)',
  ocean: 'linear-gradient(135deg, #0c1a2e 0%, #103251 45%, #1f6b92 100%)',
  forest: 'linear-gradient(135deg, #0d1f18 0%, #174535 45%, #2d7d52 100%)',
  berry: 'linear-gradient(135deg, #1d1328 0%, #3f1e47 48%, #8a3661 100%)',
  'midnight-grid': 'linear-gradient(130deg, #0d1117 0%, #131f2d 100%)',
  aurora: 'linear-gradient(135deg, #0b1530 0%, #1d2b6b 35%, #5a2a8a 70%, #2dd4bf 130%)',
  ember: 'linear-gradient(135deg, #1a0a0a 0%, #4a1010 40%, #b14a1a 100%)',
  plum: 'linear-gradient(135deg, #14101f 0%, #2c1846 50%, #6c2a8e 100%)',
  mono: '#0a0a0d',
  custom: DEFAULT_BG_PRIMARY,
};

export const SIDEBAR_BACKGROUND_CSS: Record<ShellBackground, string> = {
  default: DEFAULT_BG_PRIMARY,
  graphite: 'linear-gradient(180deg, #0f1319 0%, #171e27 100%)',
  sunset: 'linear-gradient(180deg, #2a1716 0%, #4b2a2a 100%)',
  ocean: 'linear-gradient(180deg, #101a2c 0%, #173455 100%)',
  forest: 'linear-gradient(180deg, #102119 0%, #1d3d2f 100%)',
  berry: 'linear-gradient(180deg, #1a1323 0%, #3a2145 100%)',
  'midnight-grid': 'linear-gradient(180deg, #0c1018 0%, #131b28 100%)',
  aurora: 'linear-gradient(180deg, #0b1530 0%, #1d2b6b 60%, #3a1d6f 100%)',
  ember: 'linear-gradient(180deg, #1a0a0a 0%, #3a1010 100%)',
  plum: 'linear-gradient(180deg, #14101f 0%, #2c1846 100%)',
  mono: '#0a0a0d',
  custom: DEFAULT_BG_PRIMARY,
};

/** Resolve the actual CSS background string, honoring 'custom' hex values. */
export function resolveAppBodyBackground(opt: ShellBackground, custom: string): string {
  if (opt === 'custom' && custom) return custom;
  return APP_BODY_BACKGROUND_CSS[opt] ?? APP_BODY_BACKGROUND_CSS.default;
}
export function resolveSidebarBackground(opt: ShellBackground, custom: string): string {
  if (opt === 'custom' && custom) return custom;
  return SIDEBAR_BACKGROUND_CSS[opt] ?? SIDEBAR_BACKGROUND_CSS.default;
}

interface SettingsState {
  /* ── Appearance ─────────────────── */
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
  theme: 'dark' | 'midnight' | 'amoled' | 'custom';
  chatBackground: ChatBackground;
  appBodyBackground: ShellBackground;
  appBodyBackgroundCustom: string;
  sidebarBackground: ShellBackground;
  sidebarBackgroundCustom: string;
  friendsHomeBackground: ShellBackground;
  friendsHomeBackgroundCustom: string;
  dmSidebarBackground: ShellBackground;
  dmSidebarBackgroundCustom: string;
  showTimestamps: boolean;
  use24HourTime: boolean;

  /* ── Chat ───────────────────────── */
  enterToSend: boolean;
  mediaAutoDownload: boolean;
  linkPreviews: boolean;
  spellCheck: boolean;
  emojiSuggestions: boolean;

  /* ── Security ───────────────────── */
  autoLockMinutes: number;
  screenshotProtection: boolean;
  defaultBlockScreenshots: boolean;
  clipboardAutoClear: boolean;
  clipboardClearSeconds: number;
  messageRetentionDays: number;
  loginAlerts: boolean;
  keyRotationDays: number;
  requirePasswordOnStart: boolean;
  lockOnScreenSleep: boolean;
  blockUnknownContacts: boolean;
  hideMessagePreviewsInTaskbar: boolean;
  incognitoKeyboard: boolean;

  /* ── Privacy ────────────────────── */
  readReceipts: boolean;
  typingIndicators: boolean;
  onlineStatusVisible: boolean;
  lastSeenVisible: boolean;
  profileVisibility: 'everyone' | 'contacts' | 'nobody';

  /* ── Notifications ──────────────── */
  notifications: boolean;
  notificationSound: boolean;
  notificationContent: boolean;
  mentionsOnly: boolean;
  doNotDisturb: boolean;

  /* ── Methods ────────────────────── */
  setAutoLockMinutes: (minutes: number) => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  setTheme: (theme: 'dark' | 'midnight' | 'amoled' | 'custom') => void;
  setChatBackground: (bg: ChatBackground) => void;
  setAppBodyBackground: (bg: ShellBackground) => void;
  setAppBodyBackgroundCustom: (value: string) => void;
  setSidebarBackground: (bg: ShellBackground) => void;
  setSidebarBackgroundCustom: (value: string) => void;
  setFriendsHomeBackground: (bg: ShellBackground) => void;
  setFriendsHomeBackgroundCustom: (value: string) => void;
  setDmSidebarBackground: (bg: ShellBackground) => void;
  setDmSidebarBackgroundCustom: (value: string) => void;
  setClipboardClearSeconds: (sec: number) => void;
  setMessageRetentionDays: (days: number) => void;
  setKeyRotationDays: (days: number) => void;
  setProfileVisibility: (v: 'everyone' | 'contacts' | 'nobody') => void;
  toggleReadReceipts: () => void;
  toggleTypingIndicators: () => void;
  toggleScreenshotProtection: () => void;
  toggleNotifications: () => void;
  toggleCompactMode: () => void;
  toggleShowTimestamps: () => void;
  toggleUse24HourTime: () => void;
  toggleEnterToSend: () => void;
  toggleMediaAutoDownload: () => void;
  toggleLinkPreviews: () => void;
  toggleSpellCheck: () => void;
  toggleEmojiSuggestions: () => void;
  toggleClipboardAutoClear: () => void;
  toggleLoginAlerts: () => void;
  toggleRequirePasswordOnStart: () => void;
  toggleLockOnScreenSleep: () => void;
  toggleBlockUnknownContacts: () => void;
  toggleHideMessagePreviewsInTaskbar: () => void;
  toggleIncognitoKeyboard: () => void;
  toggleDefaultBlockScreenshots: () => void;
  toggleOnlineStatusVisible: () => void;
  toggleLastSeenVisible: () => void;
  toggleNotificationSound: () => void;
  toggleNotificationContent: () => void;
  toggleMentionsOnly: () => void;
  toggleDoNotDisturb: () => void;
}

export const useSettingsStore = create<SettingsState>()(persist((set) => ({
  /* ── Appearance ─────────────────── */
  fontSize: 'medium',
  compactMode: false,
  theme: 'dark',
  chatBackground: 'default',
  appBodyBackground: 'default',
  appBodyBackgroundCustom: '#1a1a24',
  sidebarBackground: 'default',
  sidebarBackgroundCustom: '#15151e',
  friendsHomeBackground: 'default',
  friendsHomeBackgroundCustom: '#1a1a24',
  dmSidebarBackground: 'default',
  dmSidebarBackgroundCustom: '#15151e',
  showTimestamps: true,
  use24HourTime: false,

  /* ── Chat ───────────────────────── */
  enterToSend: true,
  mediaAutoDownload: true,
  linkPreviews: true,
  spellCheck: true,
  emojiSuggestions: true,

  /* ── Security ───────────────────── */
  autoLockMinutes: 5,
  screenshotProtection: false,
  defaultBlockScreenshots: false,
  clipboardAutoClear: false,
  clipboardClearSeconds: 30,
  messageRetentionDays: 0,
  loginAlerts: true,
  keyRotationDays: 14,
  requirePasswordOnStart: true,
  lockOnScreenSleep: true,
  blockUnknownContacts: false,
  hideMessagePreviewsInTaskbar: false,
  incognitoKeyboard: false,

  /* ── Privacy ────────────────────── */
  readReceipts: true,
  typingIndicators: true,
  onlineStatusVisible: true,
  lastSeenVisible: true,
  profileVisibility: 'everyone',

  /* ── Notifications ──────────────── */
  notifications: true,
  notificationSound: true,
  notificationContent: true,
  mentionsOnly: false,
  doNotDisturb: false,

  /* ── Methods ────────────────────── */
  setAutoLockMinutes: (minutes) => set({ autoLockMinutes: minutes }),
  setFontSize: (size) => set({ fontSize: size }),
  setTheme: (theme) => set((state) => theme === 'custom'
    ? { theme, appBodyBackground: 'custom', sidebarBackground: 'custom' }
    : { theme }),
  setChatBackground: (bg) => set({ chatBackground: bg }),
  setAppBodyBackground: (bg) => set({
    appBodyBackground: bg,
    ...(bg === 'custom' ? { theme: 'custom' } : {}),
  }),
  setAppBodyBackgroundCustom: (value) => set({ appBodyBackgroundCustom: value }),
  setSidebarBackground: (bg) => set({
    sidebarBackground: bg,
    ...(bg === 'custom' ? { theme: 'custom' } : {}),
  }),
  setSidebarBackgroundCustom: (value) => set({ sidebarBackgroundCustom: value }),
  setFriendsHomeBackground: (bg) => set({ friendsHomeBackground: bg }),
  setFriendsHomeBackgroundCustom: (value) => set({ friendsHomeBackgroundCustom: value }),
  setDmSidebarBackground: (bg) => set({ dmSidebarBackground: bg }),
  setDmSidebarBackgroundCustom: (value) => set({ dmSidebarBackgroundCustom: value }),
  setClipboardClearSeconds: (sec) => set({ clipboardClearSeconds: sec }),
  setMessageRetentionDays: (days) => set({ messageRetentionDays: days }),
  setKeyRotationDays: (days) => set({ keyRotationDays: days }),
  setProfileVisibility: (v) => set({ profileVisibility: v }),
  toggleReadReceipts: () => set((s) => ({ readReceipts: !s.readReceipts })),
  toggleTypingIndicators: () => set((s) => ({ typingIndicators: !s.typingIndicators })),
  toggleScreenshotProtection: () => set((s) => {
    const next = !s.screenshotProtection;
    electron()?.setContentProtection(next);
    return { screenshotProtection: next };
  }),
  toggleNotifications: () => set((s) => ({ notifications: !s.notifications })),
  toggleCompactMode: () => set((s) => ({ compactMode: !s.compactMode })),
  toggleShowTimestamps: () => set((s) => ({ showTimestamps: !s.showTimestamps })),
  toggleUse24HourTime: () => set((s) => ({ use24HourTime: !s.use24HourTime })),
  toggleEnterToSend: () => set((s) => ({ enterToSend: !s.enterToSend })),
  toggleMediaAutoDownload: () => set((s) => ({ mediaAutoDownload: !s.mediaAutoDownload })),
  toggleLinkPreviews: () => set((s) => ({ linkPreviews: !s.linkPreviews })),
  toggleSpellCheck: () => set((s) => ({ spellCheck: !s.spellCheck })),
  toggleEmojiSuggestions: () => set((s) => ({ emojiSuggestions: !s.emojiSuggestions })),
  toggleClipboardAutoClear: () => set((s) => {
    const next = !s.clipboardAutoClear;
    if (!next) electron()?.clipboardClear(0); // cancel any pending timer
    return { clipboardAutoClear: next };
  }),
  toggleLoginAlerts: () => set((s) => ({ loginAlerts: !s.loginAlerts })),
  toggleRequirePasswordOnStart: () => set((s) => ({ requirePasswordOnStart: !s.requirePasswordOnStart })),
  toggleLockOnScreenSleep: () => set((s) => ({ lockOnScreenSleep: !s.lockOnScreenSleep })),
  toggleBlockUnknownContacts: () => set((s) => ({ blockUnknownContacts: !s.blockUnknownContacts })),
  toggleHideMessagePreviewsInTaskbar: () => set((s) => {
    const next = !s.hideMessagePreviewsInTaskbar;
    electron()?.setSkipTaskbar(next);
    return { hideMessagePreviewsInTaskbar: next };
  }),
  toggleIncognitoKeyboard: () => set((s) => {
    const next = !s.incognitoKeyboard;
    electron()?.setIncognitoKeyboard(next);
    return { incognitoKeyboard: next };
  }),
  toggleDefaultBlockScreenshots: () => set((s) => ({ defaultBlockScreenshots: !s.defaultBlockScreenshots })),
  toggleOnlineStatusVisible: () => set((s) => ({ onlineStatusVisible: !s.onlineStatusVisible })),
  toggleLastSeenVisible: () => set((s) => ({ lastSeenVisible: !s.lastSeenVisible })),
  toggleNotificationSound: () => set((s) => ({ notificationSound: !s.notificationSound })),
  toggleNotificationContent: () => set((s) => ({ notificationContent: !s.notificationContent })),
  toggleMentionsOnly: () => set((s) => ({ mentionsOnly: !s.mentionsOnly })),
  toggleDoNotDisturb: () => set((s) => ({ doNotDisturb: !s.doNotDisturb })),
}), { name: 'dl-settings' }));
