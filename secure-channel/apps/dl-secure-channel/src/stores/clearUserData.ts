/* ──────────────────────────────────────────────────────────
 *  Clear User Data — flush all per-user stores on account switch
 *  Called before unlock() when the userId changes.
 * ────────────────────────────────────────────────────────── */

import { useProfileStore } from './profileStore.js';
import { useChatStore } from './chatStore.js';
import { useSettingsStore } from './settingsStore.js';
import { useConvThemeStore } from './convThemeStore.js';
import { useTagStore } from './tagStore.js';
import { useConvSecurityStore } from './convSecurityStore.js';
import { useAuthStore } from './authStore.js';

/** localStorage keys for all per-user persisted Zustand stores (excluding dl-auth) */
const USER_STORE_KEYS = [
  'dl-profile',
  'dl-chat',
  'dl-settings',
  'dl-conv-themes',
  'dl-tags',
  'conv-security',
] as const;

/**
 * Flush every per-user store — both the persisted localStorage entries
 * and the live in-memory Zustand state.  Call this BEFORE unlock()
 * whenever the incoming userId differs from the previously stored one.
 */
export function clearAllUserStores(): void {
  // 1. Wipe persisted data
  for (const key of USER_STORE_KEYS) {
    localStorage.removeItem(key);
  }

  // 2. Reset in-memory Zustand state to factory defaults
  useProfileStore.setState({
    username: '',
    displayName: '',
    avatar: null,
    banner: null,
    bio: '',
    pronouns: '',
    links: [],
    usernameColor: '#6366f1',
    accentColor: '#6366f1',
    statusText: '',
    statusEmoji: '',
    presence: 'online',
    selectedTags: [],
  });

  useChatStore.setState({
    contacts: {},
    conversations: {},
    messages: {},
    activeConversation: null,
    groups: {},
    nicknames: {},
    searchQuery: '',
    remoteProfiles: {},
    typingUsers: {},
    attachmentData: {},
  });

  useSettingsStore.setState({
    fontSize: 'medium',
    compactMode: false,
    theme: 'dark',
    chatBackground: 'default',
    appBodyBackground: 'default',
    appBodyBackgroundCustom: '#1a1a24',
    sidebarBackground: 'default',
    sidebarBackgroundCustom: '#15151e',
    showTimestamps: true,
    use24HourTime: false,
    enterToSend: true,
    mediaAutoDownload: true,
    linkPreviews: true,
    spellCheck: true,
    emojiSuggestions: true,
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
    readReceipts: true,
    typingIndicators: true,
    onlineStatusVisible: true,
    lastSeenVisible: true,
    profileVisibility: 'everyone',
    notifications: true,
    notificationSound: true,
    notificationContent: true,
    mentionsOnly: false,
    doNotDisturb: false,
  });

  useConvThemeStore.setState({ themes: {} });
  useTagStore.setState({ userTags: {} });
  useConvSecurityStore.setState({ settings: {}, unlocked: {} });

  // Per-user staff role must never carry over to another account
  useAuthStore.setState({ systemRole: null });
}

/**
 * Check whether the incoming userId differs from the currently stored one.
 * If so, flush all per-user stores so the new account starts clean.
 */
export function clearStoresIfUserChanged(incomingUserId: string): void {
  const prevUserId = useAuthStore.getState().userId;
  if (prevUserId && prevUserId !== incomingUserId) {
    clearAllUserStores();
  }
}
