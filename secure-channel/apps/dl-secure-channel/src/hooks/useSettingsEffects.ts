/* ──────────────────────────────────────────────────────────
 *  useSettingsEffects — applies store settings to DOM/Electron
 *  Call once in App root component.
 * ────────────────────────────────────────────────────────── */

import { useEffect, useRef } from 'react';
import {
  useSettingsStore,
  resolveAppBodyBackground,
  resolveSidebarBackground,
  type ShellBackground,
} from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { useConvSecurityStore } from '../stores/convSecurityStore';
import { useUpdateStore } from '../stores/updateStore';
import { useChatStore } from '../stores/chatStore';

// Per-theme text color adjustments — keeps text readable against each colored background.
// All values are lightly tinted toward the background hue but remain high contrast.
const THEME_TEXT: Partial<Record<ShellBackground, { secondary: string; muted: string }>> = {
  graphite:        { secondary: '#c2c4d0', muted: '#8a8d9c' },
  sunset:          { secondary: '#cdbdb8', muted: '#9c8a85' },
  ocean:           { secondary: '#b8c8da', muted: '#7f96b0' },
  forest:          { secondary: '#b4c8b8', muted: '#7a9680' },
  berry:           { secondary: '#c4b4d4', muted: '#9280a8' },
  'midnight-grid': { secondary: '#bec8d8', muted: '#8898b4' },
  aurora:          { secondary: '#b8bce0', muted: '#8088c0' },
  ember:           { secondary: '#ccbaa8', muted: '#9c8070' },
  plum:            { secondary: '#c4acd8', muted: '#9070b0' },
  mono:            { secondary: '#c0c0cc', muted: '#8a8a98' },
};

const SHELL_TOGGLE_ACCENT: Partial<Record<ShellBackground, string>> = {
  graphite: '#48b9d5',
  sunset: '#f08a5b',
  ocean: '#4da7d9',
  forest: '#54bd82',
  berry: '#be74cc',
  'midnight-grid': '#6b9de0',
  aurora: '#58cbb7',
  ember: '#ef7749',
  plum: '#b67be1',
  mono: '#c0c4cc',
};

function isSafeCustomColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

const FONT_SCALE: Record<string, string> = {
  small: '14px',
  medium: '15px',
  large: '17px',
};

export function useSettingsEffects() {
  const theme = useSettingsStore(s => s.theme);
  const fontSize = useSettingsStore(s => s.fontSize);
  const compactMode = useSettingsStore(s => s.compactMode);
  const appBodyBackground = useSettingsStore(s => s.appBodyBackground);
  const appBodyBackgroundCustom = useSettingsStore(s => s.appBodyBackgroundCustom);
  const sidebarBackground = useSettingsStore(s => s.sidebarBackground);
  const sidebarBackgroundCustom = useSettingsStore(s => s.sidebarBackgroundCustom);
  const friendsHomeBackground = useSettingsStore(s => s.friendsHomeBackground);
  const friendsHomeBackgroundCustom = useSettingsStore(s => s.friendsHomeBackgroundCustom);
  const dmSidebarBackground = useSettingsStore(s => s.dmSidebarBackground);
  const dmSidebarBackgroundCustom = useSettingsStore(s => s.dmSidebarBackgroundCustom);
  const spellCheck = useSettingsStore(s => s.spellCheck);
  const hideTaskbar = useSettingsStore(s => s.hideMessagePreviewsInTaskbar);
  const autoLockMinutes = useSettingsStore(s => s.autoLockMinutes);
  const incognitoKeyboard = useSettingsStore(s => s.incognitoKeyboard);
  const screenshotProtection = useSettingsStore(s => s.screenshotProtection);
  const isUnlocked = useAuthStore(s => s.isUnlocked);

  /* ── Theme ───────────────────────────────────── */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
  }, [theme]);

  /* ── Shell Backgrounds ─────────────────────────── */
  useEffect(() => {
    const root = document.documentElement;

    // Body background: override --dl-bg-primary so every surface (settings,
    // chat empty area, profile pages, etc.) inherits the user's choice.
    if (appBodyBackground === 'default') {
      root.style.removeProperty('--dl-bg-primary');
      root.style.removeProperty('--dl-app-body-bg');
    } else {
      const bodyBg = resolveAppBodyBackground(appBodyBackground, appBodyBackgroundCustom);
      root.style.setProperty('--dl-bg-primary', bodyBg);
      root.style.setProperty('--dl-app-body-bg', bodyBg);
    }

    // General controls inherit the current App Settings surface palette. This
    // keeps toggles visually tied to the shell without changing the global
    // profile/chat accent color.
    const appShellTheme = sidebarBackground !== 'default' ? sidebarBackground : appBodyBackground;
    const customShellColor = sidebarBackground === 'custom'
      ? sidebarBackgroundCustom
      : appBodyBackground === 'custom'
        ? appBodyBackgroundCustom
        : '';
    const toggleAccent = appShellTheme === 'custom' && isSafeCustomColor(customShellColor)
      ? customShellColor
      : SHELL_TOGGLE_ACCENT[appShellTheme];
    if (toggleAccent) root.style.setProperty('--dl-settings-toggle-accent', toggleAccent);
    else root.style.removeProperty('--dl-settings-toggle-accent');

    // Text colors: tint secondary/muted text toward each theme's hue while keeping it readable.
    // Priority reflects what users visually interact with most when multiple themed surfaces are active.
    let activeTheme: ShellBackground = appBodyBackground;
    if (sidebarBackground !== 'default') activeTheme = sidebarBackground;
    if (friendsHomeBackground !== 'default') activeTheme = friendsHomeBackground;
    if (dmSidebarBackground !== 'default') activeTheme = dmSidebarBackground;
    const textVars = THEME_TEXT[activeTheme];
    if (textVars) {
      root.style.setProperty('--dl-text-secondary', textVars.secondary);
      root.style.setProperty('--dl-text-muted',     textVars.muted);
    } else {
      root.style.removeProperty('--dl-text-secondary');
      root.style.removeProperty('--dl-text-muted');
    }

    // Friends Home background (independent of App Settings body)
    if (friendsHomeBackground === 'default') {
      root.style.removeProperty('--dl-friends-home-bg');
    } else {
      root.style.setProperty(
        '--dl-friends-home-bg',
        resolveAppBodyBackground(friendsHomeBackground, friendsHomeBackgroundCustom),
      );
    }

    // DM/Chat sidebar background (independent of App Settings sidebar)
    if (dmSidebarBackground === 'default') {
      root.style.removeProperty('--dl-dm-sidebar-bg');
    } else {
      root.style.setProperty(
        '--dl-dm-sidebar-bg',
        resolveSidebarBackground(dmSidebarBackground, dmSidebarBackgroundCustom),
      );
    }
  }, [appBodyBackground, appBodyBackgroundCustom, sidebarBackground, sidebarBackgroundCustom,
      friendsHomeBackground, friendsHomeBackgroundCustom, dmSidebarBackground, dmSidebarBackgroundCustom]);

  /* ── Font Size ───────────────────────────────── */
  useEffect(() => {
    document.documentElement.style.fontSize = FONT_SCALE[fontSize] ?? '15px';
  }, [fontSize]);

  /* ── Compact Mode ────────────────────────────── */
  useEffect(() => {
    document.documentElement.classList.toggle('compact-mode', compactMode);
  }, [compactMode]);

  /* ── Spell Check ─────────────────────────────── */
  useEffect(() => {
    document.body.setAttribute('spellcheck', String(spellCheck));
    // The textarea attribute handles renderer inputs; this keeps Electron's
    // session-level spell service aligned with the same preference.
    window.electronAPI?.setSpellCheckerEnabled(spellCheck && !incognitoKeyboard);
  }, [spellCheck, incognitoKeyboard]);

  /* ── Electron: hide from taskbar ─────────────── */
  useEffect(() => {
    window.electronAPI?.setSkipTaskbar(hideTaskbar);
  }, [hideTaskbar]);

  /* ── Electron: lock on screen sleep ──────────── */
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const unsub = api.onLockSignal(() => {
      if (useSettingsStore.getState().lockOnScreenSleep) {
        useAuthStore.getState().lock();
      }
    });
    return unsub;
  }, []);

  /* ── Electron: incognito keyboard ────────────── */
  useEffect(() => {
    window.electronAPI?.setIncognitoKeyboard(incognitoKeyboard);
  }, [incognitoKeyboard]);

  /* Re-apply native capture protection after a desktop app restart. */
  useEffect(() => {
    window.electronAPI?.setContentProtection(screenshotProtection);
  }, [screenshotProtection]);

  /* Remove expired local messages even when their conversation is not open. */
  useEffect(() => {
    const prune = () => useChatStore.getState().pruneExpiredMessages();
    prune();
    const interval = window.setInterval(prune, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  /* ── Auto-lock timer ─────────────────────────── */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isUnlocked || autoLockMinutes <= 0) return;

    const ms = autoLockMinutes * 60 * 1000;

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        useAuthStore.getState().lock();
      }, ms);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [isUnlocked, autoLockMinutes]);

  /* ── Request notification permission ─────────── */
  useEffect(() => {
    const notifs = useSettingsStore.getState().notifications;
    if (notifs && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  /* ── Auto-update init ────────────────────────── */
  useEffect(() => {
    void useUpdateStore.getState().initialize();
  }, []);
}

/* ── Notification helper (call from chat store on new message) ── */
export function showNotification(title: string, body: string, convId?: string) {
  const s = useSettingsStore.getState();
  if (!s.notifications || s.doNotDisturb) return;
  // Per-conversation: hide preview if hideNotifPreview is on for this chat
  let displayBody = s.notificationContent ? body : 'New message';
  if (convId) {
    const sec = useConvSecurityStore.getState().get(convId);
    if (sec.hideNotifPreview) displayBody = 'New message';
  }
  // Prefer Electron native notifications (works in sandboxed renderer)
  const api = (window as any).electronAPI;
  if (api?.showNotification) {
    api.showNotification(title, displayBody);
    return;
  }
  // Fallback to web Notification API
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, {
      body: displayBody,
      silent: !s.notificationSound,
      icon: '/icon.png',
    });
    setTimeout(() => n.close(), 5000);
  }
}
