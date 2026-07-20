/* ──────────────────────────────────────────────────────────
 *  Conversation Theme Store — per-DM personalisation
 * ────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { parseGroupChannelConversationId } from '../utils/groupChannelKeys';

export type BgType         = 'default' | 'solid' | 'gradient' | 'pattern' | 'image';
export type BubbleStyle    = 'default' | 'rounded' | 'sharp' | 'pill';
export type MsgFontSize    = 'sm' | 'md' | 'lg';
export type MsgBorderStyle = 'none' | 'glass' | 'frost' | 'darklock' | 'neon' | 'ember' | 'outline' | 'glow' | 'rgb';
export type MsgDensity     = 'compact' | 'comfortable' | 'cozy';

export interface MsgBorderOptions {
  color?:     string;   // hex for color-type borders (neon/ember/darklock/glow/outline)
  intensity?: number;   // 0–100: glow strength / blur level
  speed?:     number;   // RGB animation duration in seconds
  tint?:      string;   // glass/frost: tint color hex ('' = clear)
  mode?:      'rgb' | 'trail' | 'fill' | 'empty';  // RGB border mode
}

export interface BorderStyleDef {
  border:        string;
  backdrop:      string;
  glow:          string;
  needsPad:      boolean;
  bgOwn:         string;
  bgOther:       string;
  settingsType?: 'glass' | 'color-glow' | 'color-only' | 'rgb-speed';
}

export const BORDER_STYLE_DEFS: Record<MsgBorderStyle, BorderStyleDef> = {
  none:     { border: '',                                  backdrop: '',                          glow: '',                                                               needsPad: false, bgOwn: '',                      bgOther: '' },
  glass:    { border: '1px solid rgba(255,255,255,0.22)',  backdrop: 'blur(40px) saturate(200%)', glow: 'inset 0 1px 0 rgba(255,255,255,0.5)',                            needsPad: true,  bgOwn: 'rgba(255,255,255,0.06)', bgOther: 'rgba(255,255,255,0.04)', settingsType: 'glass'      },
  frost:    { border: '1px solid rgba(255,255,255,0.15)',  backdrop: 'blur(20px) saturate(160%)', glow: 'inset 0 1px 0 rgba(255,255,255,0.3)',                            needsPad: true,  bgOwn: 'rgba(255,255,255,0.05)', bgOther: 'rgba(255,255,255,0.03)', settingsType: 'glass'      },
  darklock: { border: '1px solid rgba(139,92,246,0.45)',   backdrop: '',                          glow: '0 0 0 1px rgba(139,92,246,0.12), 0 3px 10px rgba(0,0,0,0.45)',  needsPad: true,  bgOwn: 'rgba(139,92,246,0.08)',  bgOther: 'rgba(139,92,246,0.05)', settingsType: 'color-glow' },
  neon:     { border: '1px solid rgba(139,92,246,0.85)',   backdrop: '',                          glow: '0 0 14px rgba(139,92,246,0.45)',                                 needsPad: true,  bgOwn: 'rgba(139,92,246,0.10)',  bgOther: 'rgba(139,92,246,0.06)', settingsType: 'color-glow' },
  ember:    { border: '1px solid rgba(251,146,60,0.55)',   backdrop: '',                          glow: '0 0 10px rgba(251,146,60,0.28)',                                 needsPad: true,  bgOwn: 'rgba(251,146,60,0.10)',  bgOther: 'rgba(251,146,60,0.06)', settingsType: 'color-glow' },
  outline:  { border: '1px solid rgba(255,255,255,0.22)',  backdrop: '',                          glow: '',                                                               needsPad: true,  bgOwn: 'rgba(255,255,255,0.05)', bgOther: 'rgba(255,255,255,0.03)', settingsType: 'color-only' },
  glow:     { border: '',                                  backdrop: '',                          glow: '0 0 16px rgba(255,255,255,0.12), 0 0 6px rgba(255,255,255,0.06)', needsPad: true,  bgOwn: 'rgba(255,255,255,0.06)', bgOther: 'rgba(255,255,255,0.04)', settingsType: 'color-glow' },
  rgb:      { border: '',                                  backdrop: '',                          glow: '',                                                               needsPad: true,  bgOwn: 'rgba(255,255,255,0.05)', bgOther: 'rgba(255,255,255,0.03)', settingsType: 'rgb-speed'  },
};

/** Parses a 6-digit hex color into r,g,b components, or null on failure */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/** WCAG-based contrast helper — returns '#ffffff' or '#111111' */
export function contrastTextColor(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return lum > 0.179 ? '#111111' : '#ffffff';
}

export interface ConvTheme {
  bgType:         BgType;
  bgValue:        string;   // hex | gradient CSS | pattern key | data URL
  ownColor:       string;   // CSS color or 'default'
  ownText:        string;   // CSS text color or 'default'
  otherColor:     string;   // CSS color or 'default'
  otherText:      string;   // CSS text color or 'default'
  bubbleStyle:    BubbleStyle;
  fontSize:       MsgFontSize;
  shadow:             boolean;
  autoTextColor:      boolean;  // auto-compute text color from bubble bg
  msgBorder:          MsgBorderStyle;
  msgBorderOverrides: Partial<Record<MsgBorderStyle, MsgBorderOptions>>;
  inputBorder:          MsgBorderStyle;
  inputBorderOverrides: Partial<Record<MsgBorderStyle, MsgBorderOptions>>;
  msgDensity:         MsgDensity;
  monoFont:           boolean;
  chatFont:           string;   // font id: default | serif | mono | rounded | italic | display | modern | elegant | terminal | narrow | marker
  gradientText:       boolean;
  uppercase:          boolean;
  msgAnimation:       'none' | 'fade' | 'slide';
  hideAvatars:        boolean;
  patternColor:       string;   // custom base color for patterns (empty = use --dl-bg-primary)
}

export const CONV_THEME_DEFAULTS: ConvTheme = {
  bgType:        'default',
  bgValue:       '',
  ownColor:      'default',
  ownText:       'default',
  otherColor:    'default',
  otherText:     'default',
  bubbleStyle:   'default',
  fontSize:      'md',
  shadow:             false,
  autoTextColor:      false,
  msgBorder:          'none',
  msgBorderOverrides: {},
  inputBorder:          'none',
  inputBorderOverrides: {},
  msgDensity:         'comfortable',
  monoFont:           false,
  chatFont:           'default',
  gradientText:       false,
  uppercase:          false,
  msgAnimation:       'none',
  hideAvatars:        false,
  patternColor:       '',
};

export const BUBBLE_RADII: Record<BubbleStyle, { own: string; other: string }> = {
  default: { own: '16px 16px 4px 16px', other: '16px 16px 16px 4px' },
  rounded: { own: '16px',               other: '16px' },
  sharp:   { own: '4px',                other: '4px' },
  pill:    { own: '999px',              other: '999px' },
};

export const FONT_SIZES: Record<MsgFontSize, string> = {
  sm: '12.5px',
  md: '14px',
  lg: '16px',
};

/** CSS `background` strings for each pattern key. `var(--dl-bg-primary)` is
 *  resolved at cascade time, so the theme base colour always shows through. */
export const PATTERN_CSS: Record<string, string> = {
  dots:
    'radial-gradient(circle, rgba(255,255,255,0.07) 1.5px, transparent 1.5px)' +
    ' center/22px 22px var(--dl-bg-primary)',
  grid:
    'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px) 0 0/24px 24px,' +
    'linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px) 0 0/24px 24px' +
    ' var(--dl-bg-primary)',
  diagonal:
    'repeating-linear-gradient(45deg, transparent, transparent 10px,' +
    ' rgba(255,255,255,0.05) 10px, rgba(255,255,255,0.05) 11px) var(--dl-bg-primary)',
  diamonds:
    'linear-gradient(135deg, rgba(255,255,255,0.05) 25%, transparent 25%) 0 0/18px 18px,' +
    'linear-gradient(225deg, rgba(255,255,255,0.05) 25%, transparent 25%) 0 0/18px 18px,' +
    'linear-gradient(315deg, rgba(255,255,255,0.05) 25%, transparent 25%) 0 0/18px 18px,' +
    'linear-gradient(45deg,  rgba(255,255,255,0.05) 25%, transparent 25%) 0 0/18px 18px' +
    ' var(--dl-bg-primary)',
  crosshatch:
    'repeating-linear-gradient(0deg,   transparent, transparent 9px,' +
    ' rgba(255,255,255,0.04) 9px, rgba(255,255,255,0.04) 10px),' +
    'repeating-linear-gradient(90deg,  transparent, transparent 9px,' +
    ' rgba(255,255,255,0.04) 9px, rgba(255,255,255,0.04) 10px)' +
    ' var(--dl-bg-primary)',
  hexagons:
    'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.06) 2px, transparent 2px) 0 0/20px 12px,' +
    'radial-gradient(circle at 0% 50%, rgba(255,255,255,0.06) 2px, transparent 2px) 0 0/20px 12px' +
    ' var(--dl-bg-primary)',
  zigzag:
    'repeating-linear-gradient(120deg, transparent, transparent 6px, rgba(255,255,255,0.05) 6px, rgba(255,255,255,0.05) 7px),' +
    'repeating-linear-gradient(60deg,  transparent, transparent 6px, rgba(255,255,255,0.05) 6px, rgba(255,255,255,0.05) 7px)' +
    ' var(--dl-bg-primary)',
  triangles:
    'linear-gradient(60deg,  rgba(255,255,255,0.05) 25%, transparent 25%) 0 0/24px 14px,' +
    'linear-gradient(-60deg, rgba(255,255,255,0.05) 25%, transparent 25%) 0 0/24px 14px,' +
    'linear-gradient(60deg,  transparent 75%, rgba(255,255,255,0.05) 75%) 0 0/24px 14px,' +
    'linear-gradient(-60deg, transparent 75%, rgba(255,255,255,0.05) 75%) 0 0/24px 14px' +
    ' var(--dl-bg-primary)',
  checkerboard:
    'linear-gradient(45deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%) 0 0/18px 18px,' +
    'linear-gradient(45deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%) 9px 9px/18px 18px' +
    ' var(--dl-bg-primary)',
  stripes:
    'repeating-linear-gradient(0deg, transparent, transparent 8px, rgba(255,255,255,0.04) 8px, rgba(255,255,255,0.04) 16px)' +
    ' var(--dl-bg-primary)',
  plus:
    'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px) 50% 0/20px 20px,' +
    'linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px) 0 50%/20px 20px' +
    ' var(--dl-bg-primary)',
  waves:
    'repeating-radial-gradient(circle at 0 50%, transparent 0, rgba(255,255,255,0.04) 6px, transparent 12px) 0 0/24px 24px' +
    ' var(--dl-bg-primary)',
};

/** Build a pattern CSS string with a custom base color replacing --dl-bg-primary */
export function patternWithColor(key: string, color: string): string {
  const css = PATTERN_CSS[key];
  if (!css || !color) return css ?? '';
  return css.replace(/var\(--dl-bg-primary\)/g, color);
}

/** Returns the full CSS `background` value for a given theme */
export function computeBgStyle(theme: ConvTheme): string {
  switch (theme.bgType) {
    case 'solid':    return theme.bgValue;
    case 'gradient': return theme.bgValue;
    case 'pattern': {
      if (theme.patternColor) return patternWithColor(theme.bgValue, theme.patternColor);
      return PATTERN_CSS[theme.bgValue] ?? '';
    }
    case 'image':    return theme.bgValue ? `url("${theme.bgValue}") center/cover no-repeat` : '';
    default:         return '';
  }
}

/* ── Store ───────────────────────────────────────────────── */

interface ConvThemeState {
  /** Raw partial overrides per conversation (merges with CONV_THEME_DEFAULTS) */
  themes: Record<string, Partial<ConvTheme>>;
  /** Group channel theme source mode (per channel conversation key). */
  groupThemeModeByConversation: Record<string, 'group' | 'personal'>;

  setTheme:   (convId: string, patch: Partial<ConvTheme>) => void;
  resetTheme: (convId: string) => void;
  setGroupThemeMode: (convId: string, mode: 'group' | 'personal') => void;
  /** Non-reactive read — use `themes[convId]` subscriptions in components */
  getTheme:   (convId: string) => ConvTheme;
}

export const useConvThemeStore = create<ConvThemeState>()(persist((set, get) => ({
  themes: {},
  groupThemeModeByConversation: {},

  setTheme: (convId, patch) =>
    set(s => ({
      themes: { ...s.themes, [convId]: { ...(s.themes[convId] ?? {}), ...patch } },
    })),

  resetTheme: (convId) =>
    set(s => {
      const { [convId]: _removed, ...rest } = s.themes;
      return { themes: rest };
    }),

  setGroupThemeMode: (convId, mode) =>
    set((s) => {
      if (mode === 'group') {
        const { [convId]: _removed, ...rest } = s.groupThemeModeByConversation;
        return { groupThemeModeByConversation: rest };
      }
      return {
        groupThemeModeByConversation: {
          ...s.groupThemeModeByConversation,
          [convId]: mode,
        },
      };
    }),

  getTheme: (convId) => {
    const state = get();
    const parsed = parseGroupChannelConversationId(convId);
    const mode = state.groupThemeModeByConversation[convId] ?? 'group';
    const useGroupTheme = !!parsed.channelId && mode !== 'personal';
    const useConversationOverride = !parsed.channelId || mode === 'personal';

    return {
      ...CONV_THEME_DEFAULTS,
      ...(state.themes['__global__'] ?? {}),
      ...(useGroupTheme ? (state.themes[parsed.groupId] ?? {}) : {}),
      ...(useConversationOverride ? (state.themes[convId] ?? {}) : {}),
    };
  },
}), {
  name: 'dl-conv-themes',
  partialize: (s) => ({
    themes: s.themes,
    groupThemeModeByConversation: s.groupThemeModeByConversation,
  }),
}));
