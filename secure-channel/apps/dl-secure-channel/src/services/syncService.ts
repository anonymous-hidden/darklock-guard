/* ──────────────────────────────────────────────────────────
 *  Cross-Device Sync Service
 *  Pulls user data from IDS on login, pushes changes on update.
 *  Ensures settings, profile, and preferences sync across
 *  all devices logged into the same account.
 * ────────────────────────────────────────────────────────── */

import { useAuthStore } from '../stores/authStore';
import { useProfileStore } from '../stores/profileStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useLoginScreenStore } from '../stores/loginScreenStore';
import { useTagStore } from '../stores/tagStore';
import { useConvThemeStore } from '../stores/convThemeStore';
import { useConvSecurityStore } from '../stores/convSecurityStore';
import { useLockScreenStore } from '../stores/lockScreenStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useChatStore } from '../stores/chatStore';
import { createLogger } from '../utils/logger';

const log = createLogger('sync');

const SYNC_DEBOUNCE_MS = 2000;
const CHAT_SYNC_DEBOUNCE_MS = 5000; // Chat data is larger, debounce longer

// When true, store subscriptions should be ignored (we're applying synced data,
// not a real local edit).  This prevents apply() → subscription → push-back loops
// and stops lastLocalWriteAt from being set during sync-apply operations.
let _applySyncInProgress = false;

// ── Sync key → store mapping ──────────────────────────────
// Each entry defines how to extract data from a store and how
// to apply synced data back into it.

interface SyncDef {
  extract: () => any;
  apply: (data: any) => void;
  subscribe: (cb: () => void) => () => void;
}

function getProfileSyncData() {
  const s = useProfileStore.getState();
  return {
    // NOTE: username and displayName are NOT synced — they come from the
    // auth identity, not the profile store.  Syncing them would overwrite
    // one user's identity with another's across shared devices.
    avatar: s.avatar, banner: s.banner, bannerFit: s.bannerFit, bio: s.bio,
    pronouns: s.pronouns, links: s.links,
    usernameColor: s.usernameColor, accentColor: s.accentColor,
    accentColor2: s.accentColor2, gradientAngle: s.gradientAngle,
    statusText: s.statusText, statusEmoji: s.statusEmoji,
    presence: s.presence, selectedTags: s.selectedTags,
    nameplate: s.nameplate, sectionOrder: s.sectionOrder,
  };
}

function getSettingsSyncData() {
  const s = useSettingsStore.getState();
  // Extract only data fields, not methods
  const { setAutoLockMinutes, setFontSize, setTheme, setChatBackground,
    setClipboardClearSeconds, setMessageRetentionDays, setKeyRotationDays,
    setProfileVisibility, ...data } = s as any;
  // Filter out functions
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== 'function') clean[k] = v;
  }
  return clean;
}

function getLoginScreenSyncData() {
  const s = useLoginScreenStore.getState();
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'function') clean[k] = v;
  }
  return clean;
}

function getLockScreenSyncData() {
  const s = useLockScreenStore.getState();
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'function') clean[k] = v;
  }
  return clean;
}

function getChatSyncData() {
  const s = useChatStore.getState();
  return {
    contacts: s.contacts,
    conversations: s.conversations,
    messages: s.messages,
    groups: s.groups,
    nicknames: s.nicknames,
  };
}

function applyChatSyncData(data: any) {
  if (!data) return;
  const local = useChatStore.getState();

  // Merge contacts: union of both — local overrides for existing keys
  const mergedContacts = { ...data.contacts, ...local.contacts };

  // Merge conversations: ADDITIVE — never remove a local conversation
  // Server fills in missing ones, local overrides its own
  const mergedConversations = { ...data.conversations, ...local.conversations };

  // Merge messages: combine per-conversation, dedup by message id
  // Include conversations from BOTH sources
  const mergedMessages: Record<string, any[]> = {};
  const allConvIds = new Set([
    ...Object.keys(data.messages ?? {}),
    ...Object.keys(local.messages ?? {}),
  ]);
  for (const convId of allConvIds) {
    const serverMsgs = data.messages?.[convId] ?? [];
    const localMsgs = local.messages?.[convId] ?? [];
    const byId = new Map<string, any>();
    // Server messages first, then local overrides (local is more recent)
    for (const msg of serverMsgs) byId.set(msg.id, msg);
    for (const msg of localMsgs) byId.set(msg.id, msg);
    mergedMessages[convId] = Array.from(byId.values())
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  // Merge groups
  const mergedGroups = { ...data.groups, ...local.groups };

  // Merge nicknames: local takes precedence
  const mergedNicknames = { ...data.nicknames, ...local.nicknames };

  useChatStore.setState({
    contacts: mergedContacts,
    conversations: mergedConversations,
    messages: mergedMessages,
    groups: mergedGroups,
    nicknames: mergedNicknames,
  });
}

const SYNC_DEFS: Record<string, SyncDef> = {
  profile: {
    extract: getProfileSyncData,
    apply: (data) => {
      // Never overwrite username/displayName from sync — identity is per-account
      const { username, displayName, ...safe } = data ?? {};
      useProfileStore.setState(safe);
    },
    subscribe: (cb) => useProfileStore.subscribe(cb),
  },
  settings: {
    extract: getSettingsSyncData,
    apply: (data) => useSettingsStore.setState(data),
    subscribe: (cb) => useSettingsStore.subscribe(cb),
  },
  loginScreen: {
    extract: getLoginScreenSyncData,
    apply: (data) => {
      // Migrate old explicit default colors → '' so the auto-color system kicks in.
      // These were the hard-coded defaults before auto-color was introduced; they are
      // NOT real user customisations, so stripping them is safe.
      const OLD_DEFAULTS: Record<string, string> = {
        titleColor:    '#e8e8f0',
        subtitleColor: '#888',
        inputTextColor:'#e8e8f0',
        footerColor:   '#555',
      };
      if (data?.theme && typeof data.theme === 'object') {
        for (const [k, oldVal] of Object.entries(OLD_DEFAULTS)) {
          if (data.theme[k] === oldVal) data.theme[k] = '';
        }
      }
      useLoginScreenStore.setState(data);
    },
    subscribe: (cb) => useLoginScreenStore.subscribe(cb),
  },
  tags: {
    extract: () => ({ userTags: useTagStore.getState().userTags }),
    apply: (data) => {
      if (data?.userTags) useTagStore.setState({ userTags: data.userTags });
    },
    subscribe: (cb) => useTagStore.subscribe(cb),
  },
  convThemes: {
    extract: () => ({ themes: useConvThemeStore.getState().themes }),
    apply: (data) => {
      if (data?.themes) useConvThemeStore.setState({ themes: data.themes });
    },
    subscribe: (cb) => useConvThemeStore.subscribe(cb),
  },
  convSecurity: {
    extract: () => ({ settings: useConvSecurityStore.getState().settings }),
    apply: (data) => {
      if (data?.settings) useConvSecurityStore.setState({ settings: data.settings });
    },
    subscribe: (cb) => useConvSecurityStore.subscribe(cb),
  },
  lockScreen: {
    extract: getLockScreenSyncData,
    apply: (data) => useLockScreenStore.setState(data),
    subscribe: (cb) => useLockScreenStore.subscribe(cb),
  },
  chatData: {
    extract: getChatSyncData,
    apply: applyChatSyncData,
    subscribe: (cb) => useChatStore.subscribe(cb),
  },
};

// ── API helpers ───────────────────────────────────────────

function getIdsUrl(): string {
  return useConnectionStore.getState().idsUrl;
}

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().sessionToken;
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

async function fetchAllSyncData(userId: string): Promise<Record<string, any> | null> {
  try {
    const hdrs = authHeaders();
    if (!hdrs.Authorization) {
      log.warn('No session token — skipping pull');
      return null;
    }
    const res = await fetch(
      `${getIdsUrl()}/v1/sync/${encodeURIComponent(userId)}`,
      { headers: hdrs, cache: 'no-store' },
    );
    if (!res.ok) {
      log.warn(`pull failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const json = await res.json();
    log.info('pulled keys:', Object.keys(json.data ?? {}));
    return json.data ?? null;
  } catch (e) {
    log.error('pull error:', e);
    return null;
  }
}

async function pushSyncData(userId: string, key: string, value: any): Promise<boolean> {
  try {
    const hdrs = authHeaders();
    if (!hdrs.Authorization) {
      log.warn(`push ${key} skipped — no session token`);
      return false;
    }
    const res = await fetch(
      `${getIdsUrl()}/v1/sync/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        headers: hdrs,
        body: JSON.stringify({ key, value }),
        cache: 'no-store',
      },
    );
    if (!res.ok) log.warn(`push ${key} failed: ${res.status} ${res.statusText}`);
    else log.info(`push ${key} ok`);
    return res.ok;
  } catch (e) {
    log.error(`push ${key} error:`, e);
    return false;
  }
}

async function pushBulkSyncData(userId: string, data: Record<string, any>): Promise<boolean> {
  try {
    const hdrs = authHeaders();
    if (!hdrs.Authorization) {
      log.warn('bulk push skipped — no session token');
      return false;
    }
    const res = await fetch(
      `${getIdsUrl()}/v1/sync/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        headers: hdrs,
        body: JSON.stringify({ data }),
        cache: 'no-store',
      },
    );
    if (!res.ok) log.warn(`bulk push failed: ${res.status} ${res.statusText}`);
    else log.info('bulk push ok, keys:', Object.keys(data));
    return res.ok;
  } catch (e) {
    log.error('bulk push error:', e);
    return false;
  }
}

// ── Wait for Zustand persist stores to finish rehydrating ─────
// Without this, pullSync can apply server data that gets immediately
// overwritten when persist finishes rehydrating from localStorage.
async function waitForHydration(): Promise<void> {
  const persisted: Array<{ persist: any }> = [
    useChatStore as any,
    useProfileStore as any,
    useSettingsStore as any,
    useLoginScreenStore as any,
    useTagStore as any,
    useConvThemeStore as any,
    useConvSecurityStore as any,
    useLockScreenStore as any,
  ];
  await Promise.all(
    persisted.map((store) => {
      if (!store.persist) return Promise.resolve();
      if (store.persist.hasHydrated()) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const unsub = store.persist.onFinishHydration(() => { unsub(); resolve(); });
      });
    }),
  );
}

// ── Pull: fetch from server and apply to local stores ─────

export async function pullSync(): Promise<boolean> {
  // Only pull once per login session — prevents server data from overwriting
  // local edits when the user navigates between screens (e.g. settings → main)
  if (hasSynced) return true;

  // Wait for all persisted stores to finish rehydrating first
  await waitForHydration();

  const userId = useAuthStore.getState().userId;
  if (!userId) { log.warn('pullSync: no userId'); return false; }

  // Don't attempt sync without a session token — userId is persisted to
  // localStorage so it's available before unlock, but the token is not.
  const token = useAuthStore.getState().sessionToken;
  if (!token) { log.warn('pullSync: no session token — skipping until after unlock'); return false; }

  const serverData = await fetchAllSyncData(userId);
  if (!serverData || Object.keys(serverData).length === 0) {
    // No server data yet — this is the first device or first sync.
    // Push current local state to the server so other devices can pull it.
    log.info('No server data — pushing local state');
    hasSynced = true;
    await pushAllSync();
    return false;
  }

  let applied = 0;
  _applySyncInProgress = true;
  try {
    for (const [key, def] of Object.entries(SYNC_DEFS)) {
      const entry = serverData[key];
      if (entry?.value) {
        try {
          def.apply(entry.value);
          applied++;
          // Record the server timestamp so polls don't re-apply this same data
          lastLocalWriteAt[key] = entry.updatedAt ?? Date.now();
          log.info(`applied: ${key}`);
        } catch (e) {
          log.error(`failed to apply ${key}:`, e);
        }
      }
    }
  } finally {
    _applySyncInProgress = false;
  }

  log.info(`applied ${applied} keys`);
  hasSynced = true;

  // Push any local-only keys that the server doesn't have yet
  const missingKeys = Object.keys(SYNC_DEFS).filter(k => !serverData[k]);
  if (missingKeys.length > 0) {
    log.info('pushing missing keys:', missingKeys);
    const data: Record<string, any> = {};
    for (const key of missingKeys) {
      try { data[key] = SYNC_DEFS[key].extract(); } catch {}
    }
    pushBulkSyncData(userId, data);
  }

  return applied > 0;
}

// ── Push: save current local state to server ──────────────

export async function pushAllSync(): Promise<boolean> {
  const userId = useAuthStore.getState().userId;
  if (!userId) return false;

  const data: Record<string, any> = {};
  const now = Date.now();
  for (const [key, def] of Object.entries(SYNC_DEFS)) {
    try {
      data[key] = def.extract();
      lastLocalWriteAt[key] = now;
    } catch { /* skip */ }
  }

  return pushBulkSyncData(userId, data);
}

// ── Auto-sync: subscribe to store changes and push ────────

let unsubscribers: (() => void)[] = [];
let debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
let pendingKeys: Set<string> = new Set(); // keys with unsaved changes
let pollTimer: ReturnType<typeof setInterval> | null = null;

// Track when we last locally-modified each key so we don't overwrite
// local-newer data with older server data during background polls.
let lastLocalWriteAt: Record<string, number> = {};

const POLL_INTERVAL_MS = 30_000; // re-check server every 30 seconds

let hasSynced = false; // whether we've done an initial pull this session

export function resetSyncSession() {
  hasSynced = false;
  lastLocalWriteAt = {};
}

// ── Background poll: apply server data only when server is newer ──────────
async function pollSync() {
  const userId = useAuthStore.getState().userId;
  const token = useAuthStore.getState().sessionToken;
  if (!userId || !token) return;

  const serverData = await fetchAllSyncData(userId);
  if (!serverData) return;

  _applySyncInProgress = true;
  try {
    for (const [key, def] of Object.entries(SYNC_DEFS)) {
      const entry = serverData[key];
      if (!entry?.value) continue;

      // Only apply if server data is newer than our last local write for this key
      // Add a 5-second grace window to account for clock drift
      const localTs = lastLocalWriteAt[key] ?? 0;
      if (entry.updatedAt > localTs + 5000) {
        try {
          def.apply(entry.value);
          log.info(`poll applied: ${key} (server ${entry.updatedAt} > local ${localTs})`);
        } catch (e) {
          log.error(`poll apply error for ${key}:`, e);
        }
      } else {
        log.info(`poll skipped: ${key} (server ${entry.updatedAt} <= local ${localTs} + 5000)`);
      }
    }
  } finally {
    _applySyncInProgress = false;
  }
}

export function startAutoSync() {
  stopAutoSync(); // Clean up any existing subscriptions

  for (const [key, def] of Object.entries(SYNC_DEFS)) {
    const unsub = def.subscribe(() => {
      // Ignore store changes triggered by sync apply — not a real local edit
      if (_applySyncInProgress) return;
      // Track this key as dirty and record local write time
      pendingKeys.add(key);
      lastLocalWriteAt[key] = Date.now();
      log.info(`change detected: ${key}`, key === 'profile' ? def.extract() : '(skipped log)');
      // Debounce pushes to avoid flooding the server
      if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
      debounceTimers[key] = setTimeout(() => {
        const userId = useAuthStore.getState().userId;
        const token = useAuthStore.getState().sessionToken;
        if (!userId || !token) return;
        pendingKeys.delete(key);
        lastLocalWriteAt[key] = Date.now();
        try {
          const value = def.extract();
          log.info(`pushing ${key}:`, key === 'profile' ? JSON.stringify(value).slice(0, 200) : '...');
          pushSyncData(userId, key, value);
        } catch { /* ignore */ }
      }, key === 'chatData' ? CHAT_SYNC_DEBOUNCE_MS : SYNC_DEBOUNCE_MS);
    });
    unsubscribers.push(unsub);
  }

  // Periodically poll server for changes from other devices
  pollTimer = setInterval(pollSync, POLL_INTERVAL_MS);
}

export function stopAutoSync() {
  for (const unsub of unsubscribers) {
    try { unsub(); } catch { /* ignore */ }
  }
  unsubscribers = [];

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Flush any pending (debounced) changes before clearing timers
  if (pendingKeys.size > 0) {
    const userId = useAuthStore.getState().userId;
    const token = useAuthStore.getState().sessionToken;
    if (userId && token) {
      const data: Record<string, any> = {};
      for (const key of pendingKeys) {
        const def = SYNC_DEFS[key];
        if (!def) continue;
        clearTimeout(debounceTimers[key]);
        try { data[key] = def.extract(); } catch { /* skip */ }
      }
      if (Object.keys(data).length > 0) {
        pushBulkSyncData(userId, data);
      }
    }
  }
  pendingKeys.clear();

  for (const timer of Object.values(debounceTimers)) {
    clearTimeout(timer);
  }
  debounceTimers = {};
}
