/* ──────────────────────────────────────────────────────────
 *  Login Screen Customization Store
 *  Persists visual settings for the login/create-account screen
 * ────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LoginBgMode     = 'default' | 'solid' | 'gradient' | 'image';
export type LoginLogoStyle  = 'shield' | 'lock' | 'fingerprint' | 'key' | 'eye' | 'image';
export type LoginAnimation  = 'none' | 'pulse' | 'glow' | 'float';
export type LoginLayout     = 'center' | 'top' | 'bottom';
export type LoginCardStyle  = 'solid' | 'glass' | 'none';

export interface LoginScreenTheme {
  /* ── Background ── */
  bgMode:           LoginBgMode;
  bgColor:          string;
  bgGradient:       string;
  bgImage:          string;
  bgOverlayOpacity: number;
  bgOverlayColor:   string;
  bgBlur:           number;

  /* ── Logo / Icon ── */
  logoStyle:        LoginLogoStyle;
  logoImage:        string;
  logoColor:        string;
  logoSize:         number;
  logoBgColor:      string;
  logoBgOpacity:    number;
  logoBgRadius:     number;
  logoAnimation:    LoginAnimation;

  /* ── Title & Subtitle ── */
  titleText:        string;
  subtitleText:     string;
  titleColor:       string;
  subtitleColor:    string;
  titleSize:        number;

  /* ── Card ── */
  cardStyle:        LoginCardStyle;
  cardBg:           string;
  cardBgOpacity:    number;
  cardBorder:       string;
  cardRadius:       number;
  cardBlur:         number;
  cardGlow:         number;
  cardGlowColor:    string;
  cardShadow:       number;

  /* ── Inputs ── */
  inputBg:          string;
  inputBorder:      string;
  inputRadius:      number;
  inputTextColor:   string;

  /* ── Button ── */
  buttonColor:      string;
  buttonTextColor:  string;
  buttonRadius:     number;

  /* ── Layout ── */
  layout:           LoginLayout;
  cardMaxWidth:     number;

  /* ── Accent ── */
  accentColor:      string;

  /* ── Footer ── */
  showEncBadge:     boolean;
  footerText:       string;
  footerColor:      string;
}

export const LOGIN_SCREEN_DEFAULTS: LoginScreenTheme = {
  bgMode:           'default',
  bgColor:          '#0a0a0f',
  bgGradient:       'linear-gradient(160deg, #0f0c29, #302b63, #24243e)',
  bgImage:          '',
  bgOverlayOpacity: 0.6,
  bgOverlayColor:   '#000000',
  bgBlur:           0,

  logoStyle:        'shield',
  logoImage:        '',
  logoColor:        '#6366f1',
  logoSize:         96,
  logoBgColor:      '#6366f1',
  logoBgOpacity:    0,
  logoBgRadius:     14,
  logoAnimation:    'none',

  titleText:        'RIDGELINE',
  subtitleText:     'Ridgeline encrypted direct messaging',
  titleColor:       '',
  subtitleColor:    '',
  titleSize:        24,

  cardStyle:        'solid',
  cardBg:           '#0a0a0f',
  cardBgOpacity:    1,
  cardBorder:       'transparent',
  cardRadius:       16,
  cardBlur:         0,
  cardGlow:         0,
  cardGlowColor:    '#6366f1',
  cardShadow:       0,

  inputBg:          '#12121a',
  inputBorder:      'rgba(255,255,255,0.08)',
  inputRadius:      8,
  inputTextColor:   '',

  buttonColor:      '#6366f1',
  buttonTextColor:  '#ffffff',
  buttonRadius:     8,

  layout:           'center',
  cardMaxWidth:     400,

  accentColor:      '#6366f1',

  showEncBadge:     true,
  footerText:       '',
  footerColor:      '',
};

const BG_GRADIENTS = [
  'linear-gradient(160deg, #0f0c29, #302b63, #24243e)',
  'linear-gradient(160deg, #0a2e1a, #0f4c2a)',
  'linear-gradient(160deg, #2e0a0a, #4c1515)',
  'linear-gradient(160deg, #1a0533, #3d0a47)',
  'linear-gradient(160deg, #080a2e, #0e1560)',
  'linear-gradient(160deg, #1a120a, #2e1e0a)',
  'linear-gradient(135deg, #0a0a2a, #1a0a3a, #2a0a1a)',
  'linear-gradient(160deg, #3a2a1a, #1a1a1a)',
];

export { BG_GRADIENTS };

interface LoginScreenState {
  theme: Partial<LoginScreenTheme>;
  set: (patch: Partial<LoginScreenTheme>) => void;
  reset: () => void;
  get: () => LoginScreenTheme;
}

export const useLoginScreenStore = create<LoginScreenState>()(
  persist(
    (set, get) => ({
      theme: {},

      set: (patch) =>
        set(s => ({ theme: { ...s.theme, ...patch } })),

      reset: () => set({ theme: {} }),

      get: () => ({ ...LOGIN_SCREEN_DEFAULTS, ...get().theme }),
    }),
    { name: 'dl-login-screen' },
  ),
);
