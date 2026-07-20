import { create } from "zustand";
import type { ProfileDto } from "../types";
import { getSettings } from "../lib/tauri";

export type SettingsTab =
  | "account"
  | "profile"
  | "security"
  | "devices"
  | "privacy"
  | "encryption"
  | "notifications"
  | "appearance"
  | "advanced"
  | "connections";

export type ThemeId = "dark" | "darker" | "midnight" | "amoled" | "nord" | "mocha" | "system";

export interface AppearanceSettings {
  theme: ThemeId;
  accentColor: string;
  compactMode: boolean;
  fontSize: number;       // 12–20, default 14
  messageDensity: "cozy" | "compact" | "spacious";
}

export interface NotificationSettings {
  desktop: boolean;
  sound: boolean;
  messagePreview: boolean;
}

export interface PrivacySettings {
  autoLockMinutes: number;
  clipboardProtection: boolean;
  screenshotProtection: boolean;
  messageRetentionDays: number;
  sendReadReceipts: boolean;
  showTyping: boolean;
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  profileVisibility: "everyone" | "contacts" | "nobody";
}

interface SettingsState {
  isOpen: boolean;
  activeTab: SettingsTab;
  profile: ProfileDto | null;
  avatarDataUrl: string | null;
  bannerDataUrl: string | null;
  bannerColor: string;       // hex color for banner background (when no image)
  bioText: string;
  onlineStatus: string;       // online | idle | dnd | invisible
  profileColor: string;       // hex color
  appearance: AppearanceSettings;
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  strictKeyChangePolicy: boolean;
  highSecurityMode: boolean;
  debugLogs: boolean;
  hideInTaskbar: boolean;
  incognitoKeyboard: boolean;
  keyRotationDays: number;   // 14 | 30 | 60 | 90 | 0 (manual)
  loginAlerts: boolean;
  blockUnknownContacts: boolean;

  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setTab: (tab: SettingsTab) => void;
  setProfile: (profile: ProfileDto) => void;
  setAvatarDataUrl: (v: string | null) => void;
  setBannerDataUrl: (v: string | null) => void;
  setBannerColor: (v: string) => void;
  setBioText: (v: string) => void;
  setOnlineStatus: (v: string) => void;
  setProfileColor: (v: string) => void;
  updateAppearance: (p: Partial<AppearanceSettings>) => void;
  updateNotifications: (p: Partial<NotificationSettings>) => void;
  updatePrivacy: (p: Partial<PrivacySettings>) => void;
  setStrictKeyChangePolicy: (v: boolean) => void;
  setHighSecurityMode: (v: boolean) => void;
  setDebugLogs: (v: boolean) => void;
  setHideInTaskbar: (v: boolean) => void;
  setIncognitoKeyboard: (v: boolean) => void;
  setKeyRotationDays: (v: number) => void;
  setLoginAlerts: (v: boolean) => void;
  setBlockUnknownContacts: (v: boolean) => void;
  /** Reset all user-specific data to defaults (call on logout). */
  resetUserData: () => void;
  loadSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  isOpen: false,
  activeTab: "account",
  profile: null,
  avatarDataUrl: null,
  bannerDataUrl: null,
  bioText: "",
  onlineStatus: "online",
  profileColor: "#6366f1",
  appearance: {
    theme: "darker",
    accentColor: "#6366f1",
    compactMode: false,
    fontSize: 14,
    messageDensity: "cozy",
  },
  notifications: {
    desktop: true,
    sound: true,
    messagePreview: false,
  },
  privacy: {
    autoLockMinutes: 15,
    clipboardProtection: true,
    screenshotProtection: false,
    messageRetentionDays: 90,
    sendReadReceipts: true,
    showTyping: true,
    showOnlineStatus: true,
    showLastSeen: true,
    profileVisibility: "everyone" as const,
  },
  strictKeyChangePolicy: true,
  highSecurityMode: false,
  debugLogs: false,
  hideInTaskbar: false,
  incognitoKeyboard: false,
  keyRotationDays: 14,
  loginAlerts: true,
  blockUnknownContacts: false,

  openSettings: (tab = "account") => set({ isOpen: true, activeTab: tab }),
  closeSettings: () => set({ isOpen: false }),
  setTab: (tab) => set({ activeTab: tab }),
  setProfile: (profile) => set({ profile }),
  setAvatarDataUrl: (v) => set({ avatarDataUrl: v }),
  setBannerDataUrl: (v) => set({ bannerDataUrl: v }),
  setBannerColor: (v) => set({ bannerColor: v }),
  setBioText: (v) => set({ bioText: v }),
  setOnlineStatus: (v) => set({ onlineStatus: v }),
  setProfileColor: (v) => set({ profileColor: v }),
  updateAppearance: (p) =>
    set((s) => ({ appearance: { ...s.appearance, ...p } })),
  updateNotifications: (p) =>
    set((s) => ({ notifications: { ...s.notifications, ...p } })),
  updatePrivacy: (p) =>
    set((s) => ({ privacy: { ...s.privacy, ...p } })),
  setStrictKeyChangePolicy: (v) => set({ strictKeyChangePolicy: v }),
  setHighSecurityMode: (v) => set({ highSecurityMode: v }),
  setDebugLogs: (v) => set({ debugLogs: v }),
  setHideInTaskbar: (v) => set({ hideInTaskbar: v }),
  setIncognitoKeyboard: (v) => set({ incognitoKeyboard: v }),
  setKeyRotationDays: (v) => set({ keyRotationDays: v }),
  setLoginAlerts: (v) => set({ loginAlerts: v }),
  setBlockUnknownContacts: (v) => set({ blockUnknownContacts: v }),

  resetUserData: () => set({
    profile: null,
    avatarDataUrl: null,
    bannerDataUrl: null,
    bannerColor: '',
    bioText: "",
    onlineStatus: "online",
    profileColor: "#6366f1",
    strictKeyChangePolicy: true,
    highSecurityMode: false,
    debugLogs: false,
    hideInTaskbar: false,
    incognitoKeyboard: false,
    keyRotationDays: 14,
    loginAlerts: true,
    blockUnknownContacts: false,
  }),

  loadSettings: async () => {
    try {
      const db = await getSettings();
      const s = get();
      set({
        avatarDataUrl: db.avatar != null ? (db.avatar || null) : s.avatarDataUrl,
        bannerDataUrl: db.banner != null ? (db.banner || null) : s.bannerDataUrl,
        bannerColor: db.banner_color ?? s.bannerColor,
        bioText: db.bio ?? s.bioText,
        onlineStatus: db.online_status ?? s.onlineStatus,
        profileColor: db.profile_color ?? s.profileColor,
        appearance: {
          theme: (db.theme as AppearanceSettings["theme"]) ?? s.appearance.theme,
          accentColor: db.accent_color ?? s.appearance.accentColor,
          compactMode: db.compact_mode != null ? db.compact_mode === "true" : s.appearance.compactMode,
          fontSize: db.font_size != null ? Number(db.font_size) : s.appearance.fontSize,
          messageDensity: (db.message_density as AppearanceSettings["messageDensity"]) ?? s.appearance.messageDensity,
        },
        notifications: {
          desktop: db.notif_desktop != null ? db.notif_desktop !== "false" : s.notifications.desktop,
          sound: db.notif_sound != null ? db.notif_sound !== "false" : s.notifications.sound,
          messagePreview: db.notif_preview != null ? db.notif_preview === "true" : s.notifications.messagePreview,
        },
        privacy: {
          autoLockMinutes: db.auto_lock_minutes != null ? Number(db.auto_lock_minutes) : s.privacy.autoLockMinutes,
          clipboardProtection: db.clipboard_protection != null ? db.clipboard_protection === "true" : s.privacy.clipboardProtection,
          screenshotProtection: db.screenshot_protection != null ? db.screenshot_protection === "true" : s.privacy.screenshotProtection,
          messageRetentionDays: db.message_retention_days != null ? Number(db.message_retention_days) : s.privacy.messageRetentionDays,
          sendReadReceipts: db.send_read_receipts != null ? db.send_read_receipts === "true" : s.privacy.sendReadReceipts,
          showTyping: db.show_typing != null ? db.show_typing === "true" : s.privacy.showTyping,
          showOnlineStatus: db.show_online_status != null ? db.show_online_status === "true" : s.privacy.showOnlineStatus,
          showLastSeen: db.show_last_seen != null ? db.show_last_seen === "true" : s.privacy.showLastSeen,
          profileVisibility: (db.profile_visibility as PrivacySettings["profileVisibility"]) ?? s.privacy.profileVisibility,
        },
        strictKeyChangePolicy: db.verification_policy != null ? db.verification_policy === "block" : s.strictKeyChangePolicy,
        highSecurityMode: db.high_security_mode != null ? db.high_security_mode === "true" : s.highSecurityMode,
        debugLogs: db.debug_logs != null ? db.debug_logs === "true" : s.debugLogs,
        hideInTaskbar: db.hide_in_taskbar != null ? db.hide_in_taskbar === "true" : s.hideInTaskbar,
        incognitoKeyboard: db.incognito_keyboard != null ? db.incognito_keyboard === "true" : s.incognitoKeyboard,
        keyRotationDays: db.key_rotation_days != null ? Number(db.key_rotation_days) : s.keyRotationDays,
        loginAlerts: db.login_alerts != null ? db.login_alerts === "true" : s.loginAlerts,
        blockUnknownContacts: db.block_unknown_contacts != null ? db.block_unknown_contacts === "true" : s.blockUnknownContacts,
      });
    } catch {
      // Not logged in or DB unavailable — keep defaults
    }
  },
}));
