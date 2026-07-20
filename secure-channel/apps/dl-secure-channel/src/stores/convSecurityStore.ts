/* ──────────────────────────────────────────────────────────
 *  Conversation Security Store — per-chat security settings
 * ────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSettingsStore } from './settingsStore';
import { parseGroupChannelConversationId } from '../utils/groupChannelKeys';

export type LockTimeout = 'immediate' | '1m' | '5m' | '15m' | '1h' | 'never';
export type DisappearTimer = 'off' | '30s' | '1m' | '5m' | '1h' | '24h' | '7d';

export interface ConvSecurity {
  /** Require a PIN/password to open this specific chat */
  requirePin:         boolean;
  /** The hashed (SHA-256 hex) PIN value — never store plaintext */
  pinHash:            string;
  /** Auto-lock after this duration of inactivity (when requirePin is on) */
  lockTimeout:        LockTimeout;
  /** Auto-delete messages after this duration */
  disappearTimer:     DisappearTimer;
  /** Block screenshots / screen capture for this chat (where supported) */
  blockScreenshots:   boolean;
  /** Hide message previews in notifications for this chat */
  hideNotifPreview:   boolean;
  /** Blur message content until tapped/hovered (privacy screen) */
  blurMessages:       boolean;
  /** Block this contact entirely */
  blocked:            boolean;
}

export const SECURITY_DEFAULTS: ConvSecurity = {
  requirePin:        false,
  pinHash:           '',
  lockTimeout:       '5m',
  disappearTimer:    'off',
  blockScreenshots:  false,
  hideNotifPreview:  false,
  blurMessages:      false,
  blocked:           false,
};

/** SHA-256 of the PIN — runs in the browser via SubtleCrypto */
export async function hashPin(pin: string): Promise<string> {
  const buf = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify a plaintext PIN against a stored hash */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return (await hashPin(pin)) === hash;
}

interface ConvSecurityState {
  settings: Record<string, Partial<ConvSecurity>>;
  /** Per-chat unlock state — true = currently unlocked (runtime only, not persisted) */
  unlocked: Record<string, boolean>;

  set:    (convId: string, patch: Partial<ConvSecurity>) => void;
  reset:  (convId: string) => void;
  get:    (convId: string) => ConvSecurity;
  unlock: (convId: string) => void;
  lock:   (convId: string) => void;
}

export const useConvSecurityStore = create<ConvSecurityState>()(
  persist(
    (set, get) => ({
      settings: {},
      unlocked: {},

      set: (convId, patch) =>
        set(s => ({
          settings: {
            ...s.settings,
            [convId]: { ...(s.settings[convId] ?? {}), ...patch },
          },
        })),

      reset: (convId) =>
        set(s => {
          const { [convId]: _removed, ...rest } = s.settings;
          return { settings: rest };
        }),

      get: (convId) => ({
        ...SECURITY_DEFAULTS,
        blockScreenshots: useSettingsStore.getState().defaultBlockScreenshots,
        ...(() => {
          const state = get();
          const parsed = parseGroupChannelConversationId(convId);
          if (!parsed.channelId) {
            return state.settings[convId] ?? {};
          }

          return {
            ...(state.settings[parsed.groupId] ?? {}),
            ...(state.settings[convId] ?? {}),
          };
        })(),
      }),

      unlock: (convId) =>
        set(s => ({ unlocked: { ...s.unlocked, [convId]: true } })),

      lock: (convId) =>
        set(s => ({ unlocked: { ...s.unlocked, [convId]: false } })),
    }),
    {
      name: 'conv-security',
      // Don't persist runtime unlock state
      partialize: (s) => ({ settings: s.settings }),
    }
  )
);
