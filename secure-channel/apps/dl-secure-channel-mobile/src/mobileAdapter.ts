/* ──────────────────────────────────────────────────────────
 *  Mobile Platform Adapter
 *  Provides window.electronAPI-compatible shims using
 *  Capacitor native plugins so the same React app can
 *  run on iOS/Android without code changes.
 * ────────────────────────────────────────────────────────── */

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import { Network } from '@capacitor/network';

const isMobile = Capacitor.isNativePlatform();

const VAULT_PREFIX = 'darklock_vault_';

if (isMobile) {
  const electronAPI: Record<string, any> = {
    /* ── App ── */
    getDataPath: async () => 'capacitor://data',
    getVersion: async () => {
      const info = await App.getInfo();
      return info.version;
    },
    platform: Capacitor.getPlatform(), // 'ios' | 'android'

    /* ── Vault (localStorage-backed, data is AEAD-encrypted before storage) ── */
    vaultWrite: async (filename: string, data: string) => {
      localStorage.setItem(VAULT_PREFIX + filename, data);
    },
    vaultRead: async (filename: string): Promise<string | null> => {
      return localStorage.getItem(VAULT_PREFIX + filename);
    },
    vaultExists: async (filename: string): Promise<boolean> => {
      return localStorage.getItem(VAULT_PREFIX + filename) !== null;
    },
    vaultDelete: async (filename: string) => {
      localStorage.removeItem(VAULT_PREFIX + filename);
    },

    /* ── Security ── */
    // Content protection — iOS supports flagSecure-like behavior via plugin
    setContentProtection: async (_enabled: boolean) => {
      // Native screenshot prevention is handled by Capacitor Screen plugin
      // or custom native code. Graceful no-op if unavailable.
    },

    setSkipTaskbar: async (_skip: boolean) => {
      // N/A on mobile
    },

    setIncognitoKeyboard: async (enabled: boolean) => {
      if (Capacitor.getPlatform() === 'ios') {
        try {
          await Keyboard.setAccessoryBarVisible({ isVisible: !enabled });
        } catch { /* keyboard plugin may not be ready */ }
      }
    },

    clipboardClear: async (seconds: number) => {
      setTimeout(async () => {
        try {
          await Clipboard.write({ string: '' });
          await Haptics.impact({ style: ImpactStyle.Light });
        } catch { /* ignore */ }
      }, seconds * 1000);
    },

    clipboardClearNow: async () => {
      try {
        await Clipboard.write({ string: '' });
      } catch { /* ignore */ }
    },

    /* ── Lock / Focus signals ── */
    onLockSignal: (callback: () => void) => {
      const handler = App.addListener('appStateChange', (state) => {
        if (!state.isActive) callback();
      });
      return () => { handler.then(h => h.remove()); };
    },

    onWindowBlur: (callback: () => void) => {
      const handler = App.addListener('appStateChange', (state) => {
        if (!state.isActive) callback();
      });
      return () => { handler.then(h => h.remove()); };
    },

    onWindowFocus: (callback: () => void) => {
      const handler = App.addListener('appStateChange', (state) => {
        if (state.isActive) callback();
      });
      return () => { handler.then(h => h.remove()); };
    },

    onContentProtectionChanged: (_callback: (enabled: boolean) => void) => {
      return () => {};
    },
  };

  // Inject the same API shape the React app expects
  (window as any).electronAPI = electronAPI;

  // Set up status bar
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#0a0a0f' }).catch(() => {});

  // Handle back button on Android — delegate to shared goBack() resolver
  // (exposed by pwaAdapter.ts on window.__darklockGoBack).
  App.addListener('backButton', () => {
    const goBack = (window as any).__darklockGoBack as (() => boolean) | undefined;
    const handled = goBack?.() ?? false;
    if (!handled) {
      // Nothing to pop — minimize app instead of exit for better UX
      App.minimizeApp().catch(() => App.exitApp());
    }
  });

  // Monitor network connectivity
  Network.addListener('networkStatusChange', (status) => {
    window.dispatchEvent(new CustomEvent('darklock:networkChange', {
      detail: { connected: status.connected, type: status.connectionType },
    }));
  });
}

export { isMobile };
