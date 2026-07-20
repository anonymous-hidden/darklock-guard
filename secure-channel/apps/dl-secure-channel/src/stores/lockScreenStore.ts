/* ──────────────────────────────────────────────────────────
 *  Lock Screen Appearance Store — per-chat lock screen look
 * ────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LockIconStyle  = 'default' | 'shield' | 'key' | 'fingerprint' | 'eye';
export type LockBackground = 'default' | 'solid' | 'gradient' | 'blur' | 'image';
export type LockAnimation  = 'none' | 'pulse' | 'glow' | 'float';

export interface LockScreenTheme {
  /** Background mode */
  bgMode:       LockBackground;
  /** Solid / gradient value */
  bgValue:      string;
  /** Background image data URL */
  bgImage:      string;
  /** Blur intensity (1-20) for the blur mode */
  blurAmount:   number;
  /** Overlay opacity (0-1) over the background */
  overlayOpacity: number;
  /** Overlay color */
  overlayColor: string;
  /** Lock icon style */
  iconStyle:    LockIconStyle;
  /** Lock icon color */
  iconColor:    string;
  /** Icon size (24-64) */
  iconSize:     number;
  /** Custom lock title text */
  title:        string;
  /** Custom lock description text */
  description:  string;
  /** Title/description text color */
  textColor:    string;
  /** Box background color */
  boxBg:        string;
  /** Box border color */
  boxBorder:    string;
  /** Box border radius (4-24) */
  boxRadius:    number;
  /** Unlock button color */
  buttonColor:  string;
  /** Unlock button text color */
  buttonText:   string;
  /** Icon animation */
  iconAnimation: LockAnimation;
  /** Box shadow glow (0-30) */
  boxGlow:      number;
  /** Box glow color */
  boxGlowColor: string;
  /** Glass effect: backdrop blur (0-30) */
  boxBlur:      number;
  /** Glass effect: box background opacity (0-1) */
  boxOpacity:   number;
}

export const LOCK_SCREEN_DEFAULTS: LockScreenTheme = {
  bgMode:         'default',
  bgValue:        '#0f0f14',
  bgImage:        '',
  blurAmount:     8,
  overlayOpacity: 0.7,
  overlayColor:   '#000000',
  iconStyle:      'default',
  iconColor:      '#6366f1',
  iconSize:       28,
  title:          'Chat Locked',
  description:    'Enter your PIN to open this conversation',
  textColor:      '#e8e8f0',
  boxBg:          '#1a1a24',
  boxBorder:      'rgba(255,255,255,0.08)',
  boxRadius:      16,
  buttonColor:    '#6366f1',
  buttonText:     '#ffffff',
  iconAnimation:  'none',
  boxGlow:        0,
  boxGlowColor:   '#6366f1',
  boxBlur:        0,
  boxOpacity:     1,
};

interface LockScreenState {
  themes: Record<string, Partial<LockScreenTheme>>;
  setTheme: (convId: string, patch: Partial<LockScreenTheme>) => void;
  resetTheme: (convId: string) => void;
  getTheme: (convId: string) => LockScreenTheme;
}

export const useLockScreenStore = create<LockScreenState>()(
  persist(
    (set, get) => ({
      themes: {},

      setTheme: (convId, patch) =>
        set(s => ({
          themes: {
            ...s.themes,
            [convId]: { ...(s.themes[convId] ?? {}), ...patch },
          },
        })),

      resetTheme: (convId) =>
        set(s => {
          const { [convId]: _removed, ...rest } = s.themes;
          return { themes: rest };
        }),

      getTheme: (convId) => ({
        ...LOCK_SCREEN_DEFAULTS,
        ...(get().themes['__global__'] ?? {}),
        ...(get().themes[convId] ?? {}),
      }),
    }),
    { name: 'dl-lock-screen' }
  )
);
