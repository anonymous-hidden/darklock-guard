import { useEffect, useRef, useState } from 'react';
import {
  useConvThemeStore,
  CONV_THEME_DEFAULTS,
  PATTERN_CSS,
  patternWithColor,
  BORDER_STYLE_DEFS,
  contrastTextColor,
  hexToRgb,
  type BgType,
  type BubbleStyle,
  type MsgFontSize,
  type MsgBorderStyle,
  type MsgBorderOptions,
  type MsgDensity,
} from '../stores/convThemeStore';
import { X, Check, Palette, Upload, Settings } from './Icons';
import './ConvPersonalize.css';

/* ── Chat font presets ───────────────────────────────────── */
const CHAT_FONTS: Array<{ id: string; label: string; preview: string; style: React.CSSProperties }> = [
  { id: 'default', label: 'Default',     preview: 'Hey, how are you?',        style: {} },
  { id: 'serif',   label: 'Serif',       preview: 'Hey, how are you?',        style: { fontFamily: 'Georgia, "Times New Roman", serif' } },
  { id: 'mono',    label: 'Monospace',   preview: 'Hey, how are you?',        style: { fontFamily: '"Courier New", Consolas, monospace' } },
  { id: 'rounded', label: 'Rounded',     preview: 'Hey, how are you?',        style: { fontFamily: '"Nunito", "Varela Round", "Segoe UI", sans-serif' } },
  { id: 'italic',  label: 'Italic',      preview: 'Hey, how are you?',        style: { fontFamily: 'Georgia, serif', fontStyle: 'italic' } },
  { id: 'display', label: 'Display',     preview: 'Hey, how are you?',        style: { fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif' } },
  { id: 'modern',  label: 'Modern',      preview: 'Hey, how are you?',        style: { fontFamily: '"Poppins", "Segoe UI", sans-serif' } },
  { id: 'elegant', label: 'Elegant',     preview: 'Hey, how are you?',        style: { fontFamily: '"Garamond", "Palatino Linotype", serif' } },
  { id: 'terminal', label: 'Terminal',   preview: 'Hey, how are you?',        style: { fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace' } },
  { id: 'narrow',  label: 'Narrow',      preview: 'Hey, how are you?',        style: { fontFamily: '"Tahoma", "Arial Narrow", sans-serif' } },
  { id: 'marker',  label: 'Marker',      preview: 'Hey, how are you?',        style: { fontFamily: '"Comic Sans MS", "Segoe Print", cursive' } },
];

/* ── Preset data ─────────────────────────────────────────── */

const BG_SOLIDS = [
  { value: '#0f0f11', label: 'Void' },
  { value: '#111318', label: 'Obsidian' },
  { value: '#0f172a', label: 'Navy' },
  { value: '#0c1a12', label: 'Forest' },
  { value: '#1a0a1a', label: 'Plum' },
  { value: '#1a0c0c', label: 'Ember' },
  { value: '#1a140a', label: 'Espresso' },
  { value: '#0a1a1a', label: 'Teal' },
  { value: '#1c1a2e', label: 'Twilight' },
  { value: '#1a1a0f', label: 'Olive' },
  { value: '#282828', label: 'Charcoal' },
  { value: '#18181b', label: 'Zinc' },
  { value: '#fafaf9', label: 'Snow' },
  { value: '#f0ebe3', label: 'Parchment' },
  { value: '#e8f4f0', label: 'Mint' },
  { value: '#f0e8f4', label: 'Lavender' },
  { value: '#e11d48', label: 'Crimson' },
  { value: '#0e7490', label: 'Deep Cyan' },
  { value: '#7c2d12', label: 'Burnt' },
  { value: '#1e3a5f', label: 'Deep Navy' },
  { value: '#312e81', label: 'Indigo' },
  { value: '#064e3b', label: 'Jungle' },
  { value: '#3d3d3d', label: 'Steel' },
  { value: '#d1d5db', label: 'Silver' },
];

const BG_PATTERNS = [
  { key: 'dots',         label: 'Dots' },
  { key: 'grid',         label: 'Grid' },
  { key: 'diagonal',     label: 'Lines' },
  { key: 'diamonds',     label: 'Diamonds' },
  { key: 'crosshatch',   label: 'Cross' },
  { key: 'hexagons',     label: 'Hex' },
  { key: 'zigzag',       label: 'Zigzag' },
  { key: 'triangles',    label: 'Triangles' },
  { key: 'checkerboard', label: 'Checker' },
  { key: 'stripes',      label: 'Stripes' },
  { key: 'plus',         label: 'Plus' },
  { key: 'waves',        label: 'Waves' },
];

interface ColorPreset { color: string; text: string; label: string }

const TEXT_COLORS: Array<{ color: string; label: string }> = [
  { color: 'default',  label: 'Default' },
  { color: '#ffffff',  label: 'White' },
  { color: '#f1f5f9',  label: 'Off-white' },
  { color: '#94a3b8',  label: 'Muted' },
  { color: '#111111',  label: 'Black' },
  { color: '#fbbf24',  label: 'Gold' },
  { color: '#34d399',  label: 'Mint' },
  { color: '#60a5fa',  label: 'Blue' },
  { color: '#f472b6',  label: 'Pink' },
  { color: '#a78bfa',  label: 'Violet' },
  { color: '#fb923c',  label: 'Orange' },
  { color: '#4ade80',  label: 'Green' },
  { color: '#f87171',  label: 'Red' },
  { color: '#e879f9',  label: 'Fuchsia' },
  { color: '#22d3ee',  label: 'Cyan' },
  { color: '#fde047',  label: 'Yellow' },
];

const OWN_COLORS: ColorPreset[] = [
  { color: 'default', text: 'default',  label: 'Default' },
  { color: '#6d28d9', text: '#fff',     label: 'Violet' },
  { color: '#7c3aed', text: '#fff',     label: 'Purple' },
  { color: '#0891b2', text: '#fff',     label: 'Cyan' },
  { color: '#0284c7', text: '#fff',     label: 'Sky' },
  { color: '#1d4ed8', text: '#fff',     label: 'Blue' },
  { color: '#059669', text: '#fff',     label: 'Emerald' },
  { color: '#16a34a', text: '#fff',     label: 'Green' },
  { color: '#dc2626', text: '#fff',     label: 'Red' },
  { color: '#ea580c', text: '#fff',     label: 'Orange' },
  { color: '#ca8a04', text: '#fff',     label: 'Amber' },
  { color: '#be185d', text: '#fff',     label: 'Pink' },
  { color: '#db2777', text: '#fff',     label: 'Rose' },
  { color: '#374151', text: '#fff',     label: 'Gray' },
  { color: '#18181b', text: '#fff',     label: 'Black' },
  { color: '#fafafa', text: '#111111',  label: 'White' },
];

const OTHER_COLORS: ColorPreset[] = [
  { color: 'default', text: 'default',  label: 'Default' },
  { color: '#6d28d9', text: '#fff',     label: 'Violet' },
  { color: '#7c3aed', text: '#fff',     label: 'Purple' },
  { color: '#0891b2', text: '#fff',     label: 'Cyan' },
  { color: '#0284c7', text: '#fff',     label: 'Sky' },
  { color: '#1d4ed8', text: '#fff',     label: 'Blue' },
  { color: '#059669', text: '#fff',     label: 'Emerald' },
  { color: '#16a34a', text: '#fff',     label: 'Green' },
  { color: '#dc2626', text: '#fff',     label: 'Red' },
  { color: '#ea580c', text: '#fff',     label: 'Orange' },
  { color: '#ca8a04', text: '#fff',     label: 'Amber' },
  { color: '#be185d', text: '#fff',     label: 'Pink' },
  { color: '#db2777', text: '#fff',     label: 'Rose' },
  { color: '#374151', text: '#fff',     label: 'Gray' },
  { color: '#18181b', text: '#fff',     label: 'Black' },
  { color: '#fafafa', text: '#111111',  label: 'White' },
];

const BUBBLE_STYLES: Array<{
  value: BubbleStyle;
  label: string;
  own: string;
  other: string;
}> = [
  { value: 'default', label: 'Default',  own: '16px 16px 4px 16px',  other: '16px 16px 16px 4px' },
  { value: 'rounded', label: 'Rounded',  own: '16px',                other: '16px' },
  { value: 'sharp',   label: 'Sharp',    own: '4px',                 other: '4px' },
  { value: 'pill',    label: 'Pill',     own: '999px',               other: '999px' },
];

const BORDER_STYLE_CARDS: Array<{
  value:    MsgBorderStyle;
  label:    string;
  border:   string;
  backdrop: string;
  glow:     string;
  bg:       string;
}> = [
  { value: 'none',     label: 'None',     border: 'none',                              backdrop: 'none',       glow: 'none',                            bg: 'var(--dl-bg-surface)' },
  { value: 'glass',    label: 'Glass',    border: '1px solid rgba(255,255,255,0.22)',  backdrop: 'blur(40px) saturate(200%)', glow: 'inset 0 1px 0 rgba(255,255,255,0.5)',  bg: 'rgba(255,255,255,0.06)' },
  { value: 'frost',    label: 'Frost',    border: '1px solid rgba(255,255,255,0.15)',  backdrop: 'blur(20px) saturate(160%)', glow: 'inset 0 1px 0 rgba(255,255,255,0.3)',  bg: 'rgba(255,255,255,0.05)' },
  { value: 'darklock', label: 'Ridgeline', border: '1px solid rgba(139,92,246,0.55)',   backdrop: 'none',       glow: '0 0 6px rgba(139,92,246,0.35)',   bg: 'var(--dl-bg-surface)' },
  { value: 'neon',     label: 'Neon',     border: '1px solid rgba(139,92,246,0.9)',    backdrop: 'none',       glow: '0 0 10px rgba(139,92,246,0.5)',   bg: 'var(--dl-bg-surface)' },
  { value: 'ember',    label: 'Ember',    border: '1px solid rgba(251,146,60,0.65)',   backdrop: 'none',       glow: '0 0 8px rgba(251,146,60,0.3)',    bg: 'var(--dl-bg-surface)' },
  { value: 'outline',  label: 'Outline',  border: '1px solid rgba(255,255,255,0.26)',  backdrop: 'none',       glow: 'none',                            bg: 'var(--dl-bg-surface)' },
  { value: 'glow',     label: 'Glow',     border: 'none',                              backdrop: 'none',       glow: '0 0 12px rgba(255,255,255,0.14)', bg: 'var(--dl-bg-surface)' },
  { value: 'rgb',      label: 'RGB',      border: 'none',                              backdrop: 'none',       glow: 'none',                            bg: 'rgba(255,255,255,0.05)' },
];

/* ── Component ───────────────────────────────────────────── */

/** Color presets for color-type border styles */
const BORDER_COLOR_PRESETS: Partial<Record<MsgBorderStyle, Array<{ color: string; label: string }>>> = {
  neon:     [{ color: '#8b5cf6', label: 'Purple' }, { color: '#06b6d4', label: 'Cyan'  }, { color: '#ec4899', label: 'Pink'   }, { color: '#22d3ee', label: 'Sky'   }, { color: '#a3e635', label: 'Lime'   }],
  ember:    [{ color: '#fb923c', label: 'Orange' }, { color: '#ef4444', label: 'Red'   }, { color: '#fbbf24', label: 'Amber'  }, { color: '#f97316', label: 'Gold'  }, { color: '#fb7185', label: 'Rose'   }],
  darklock: [{ color: '#8b5cf6', label: 'Purple' }, { color: '#06b6d4', label: 'Cyan'  }, { color: '#34d399', label: 'Green'  }, { color: '#60a5fa', label: 'Blue'  }, { color: '#f472b6', label: 'Pink'   }],
  glow:     [{ color: '#ffffff', label: 'White'  }, { color: '#06b6d4', label: 'Cyan'  }, { color: '#8b5cf6', label: 'Violet' }, { color: '#34d399', label: 'Green' }, { color: '#fb923c', label: 'Amber'  }],
  outline:  [{ color: '#ffffff', label: 'White'  }, { color: '#06b6d4', label: 'Cyan'  }, { color: '#8b5cf6', label: 'Violet' }, { color: '#fb923c', label: 'Amber' }, { color: '#34d399', label: 'Green'  }],
};

/** Tint presets for glass / frost */
const GLASS_TINTS = [
  { hex: '',        label: 'Clear'  },
  { hex: '#ffffff', label: 'White'  },
  { hex: '#63b3ed', label: 'Blue'   },
  { hex: '#a78bfa', label: 'Violet' },
  { hex: '#fbbf24', label: 'Warm'   },
  { hex: '#fb7185', label: 'Rose'   },
];

/** Return the preview style for a border card, factoring in any user overrides */
function getBorderPreviewStyle(
  b: { value: MsgBorderStyle; border: string; backdrop: string; glow: string; bg: string },
  overrides: Partial<Record<MsgBorderStyle, MsgBorderOptions>>,
): React.CSSProperties {
  if (b.value === 'rgb') return { background: b.bg };
  const opts = overrides[b.value];
  if (!opts) return { border: b.border, backdropFilter: b.backdrop, boxShadow: b.glow, background: b.bg };
  const bd = BORDER_STYLE_DEFS[b.value];
  let border    = b.border;
  let boxShadow = b.glow === 'none' ? undefined : b.glow;
  let background = b.bg;
  if (bd.settingsType === 'glass' && opts.tint) {
    const rgb = hexToRgb(opts.tint);
    if (rgb) background = `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`;
  } else if ((bd.settingsType === 'color-glow' || bd.settingsType === 'color-only') && opts.color) {
    const rgb = hexToRgb(opts.color);
    if (rgb) {
      const { r, g, b: bv } = rgb;
      border    = `1px solid rgba(${r},${g},${bv},0.85)`;
      if (bd.settingsType === 'color-glow') boxShadow = `0 0 8px rgba(${r},${g},${bv},0.5)`;
    }
  }
  return { border, backdropFilter: b.backdrop, boxShadow, background };
}

interface Props {
  convId:  string;
  onClose: () => void;
  detached?: boolean;
  onToggleDetach?: () => void;
}

export function ConvPersonalize({ convId, onClose, detached, onToggleDetach }: Props) {
  const setTheme   = useConvThemeStore(s => s.setTheme);
  const resetTheme = useConvThemeStore(s => s.resetTheme);

  // Reactive subscription — re-renders on every theme change for this conv
  const rawTheme = useConvThemeStore(s => s.themes[convId]);
  const theme = { ...CONV_THEME_DEFAULTS, ...(rawTheme ?? {}) };

  // Local tab for the background type picker
  type BgTab = 'none' | 'solid' | 'scene' | 'pattern';
  const bgTypeToTab = (t: BgType): BgTab =>
    t === 'image' ? 'scene' :
    t === 'solid' ? 'solid' : t === 'pattern' ? 'pattern' : 'none';
  const [bgTab, setBgTab] = useState<BgTab>(bgTypeToTab(theme.bgType));
  type MainTab = 'bg' | 'bubbles' | 'style';
  const [mainTab, setMainTab] = useState<MainTab>('bg');
  const [activeBorderSettings, setActiveBorderSettings] = useState<MsgBorderStyle | null>(null);
  const [activeInputBorderSettings, setActiveInputBorderSettings] = useState<MsgBorderStyle | null>(null);
  const fileInputRef      = useRef<HTMLInputElement>(null);
  const ownTextColorRef   = useRef<HTMLInputElement>(null);
  const otherTextColorRef = useRef<HTMLInputElement>(null);
  const borderColorRef    = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showFontModal, setShowFontModal] = useState(false);

  const overrides = (theme.msgBorderOverrides ?? {}) as Partial<Record<MsgBorderStyle, MsgBorderOptions>>;

  // Keep bg sub-tab in sync when theme resets externally
  useEffect(() => { setBgTab(bgTypeToTab(theme.bgType)); }, [theme.bgType]);

  /* ── Helpers ───────────────────────────────────────────── */
  const set = (patch: Parameters<typeof setTheme>[1]) => setTheme(convId, patch);

  /** Merge options for the given border key */
  const setBorderOpt = (border: MsgBorderStyle, key: keyof MsgBorderOptions, value: string | number) => {
    const current = (theme.msgBorderOverrides ?? {}) as Partial<Record<MsgBorderStyle, MsgBorderOptions>>;
    set({ msgBorderOverrides: { ...current, [border]: { ...(current[border] ?? {}), [key]: value } } } as never);
  };

  const clearBorderOpt = (border: MsgBorderStyle, key: keyof MsgBorderOptions) => {
    const current = (theme.msgBorderOverrides ?? {}) as Partial<Record<MsgBorderStyle, MsgBorderOptions>>;
    const entry = { ...(current[border] ?? {}) };
    delete entry[key];
    set({ msgBorderOverrides: { ...current, [border]: entry } } as never);
  };

  const inputOverrides = (theme.inputBorderOverrides ?? {}) as Partial<Record<MsgBorderStyle, MsgBorderOptions>>;

  const setInputBorderOpt = (border: MsgBorderStyle, key: keyof MsgBorderOptions, value: string | number) => {
    const current = (theme.inputBorderOverrides ?? {}) as Partial<Record<MsgBorderStyle, MsgBorderOptions>>;
    set({ inputBorderOverrides: { ...current, [border]: { ...(current[border] ?? {}), [key]: value } } } as never);
  };

  const clearInputBorderOpt = (border: MsgBorderStyle, key: keyof MsgBorderOptions) => {
    const current = (theme.inputBorderOverrides ?? {}) as Partial<Record<MsgBorderStyle, MsgBorderOptions>>;
    const entry = { ...(current[border] ?? {}) };
    delete entry[key];
    set({ inputBorderOverrides: { ...current, [border]: entry } } as never);
  };

  const inputBorderColorRef = useRef<HTMLInputElement>(null);

  const selectBg = (type: BgType, value: string) => {
    setBgTab(bgTypeToTab(type));
    set({ bgType: type, bgValue: value });
  };

  const handleReset = () => {
    resetTheme(convId);
    setBgTab('none');
    setMainTab('bg');
  };

  /** Read a File and store it as a resized data URL background */
  const loadImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      // Resize large images to prevent localStorage quota issues
      const img = new window.Image();
      img.onload = () => {
        const MAX = 1920;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          const scale = MAX / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', 0.75);
        selectBg('image', compressed);
      };
      img.onerror = () => {
        // Fallback: use original if image can't be loaded into canvas
        selectBg('image', dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadImageFile(file);
    // reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadImageFile(file);
  };

  /** Apply WCAG-contrast text colour to both bubble colours that are non-default */
  const applyAutoText = () => {
    const patch: Record<string, string> = {};
    if (theme.ownColor !== 'default')   { patch.ownText   = contrastTextColor(theme.ownColor); }
    if (theme.otherColor !== 'default') { patch.otherText = contrastTextColor(theme.otherColor); }
    set({ autoTextColor: true, ...patch });
  };

  /** Pick colour + auto-resolve text when autoTextColor is on */
  const pickOwnColor = (color: string, presetText: string) => {
    const text = theme.autoTextColor && color !== 'default'
      ? contrastTextColor(color)
      : presetText;
    set({ ownColor: color, ownText: text });
  };

  const pickOtherColor = (color: string, presetText: string) => {
    const text = theme.autoTextColor && color !== 'default'
      ? contrastTextColor(color)
      : presetText;
    set({ otherColor: color, otherText: text });
  };

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div className={`conv-pers${detached ? ' conv-pers--detached' : ''}`} onClick={e => e.stopPropagation()}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className={`conv-pers__header${detached ? ' conv-pers__header--draggable' : ''}`}>
        <Palette size={15} />
        <span>Personalize Chat</span>
        {onToggleDetach && (
          <button className="conv-pers__close" onClick={onToggleDetach} title={detached ? 'Dock panel' : 'Pop out panel'}>
            {detached ? <Check size={15} /> : <Settings size={15} />}
          </button>
        )}
        <button className="conv-pers__close" onClick={onClose} title="Close">
          <X size={15} />
        </button>
      </div>

      {/* ── Main tab nav ─────────────────────────────────── */}
      <div className="conv-pers__main-tabs">
        {([
          { id: 'bg',      label: 'Background' },
          { id: 'bubbles', label: 'Bubbles'    },
          { id: 'style',   label: 'Style'      },
        ] as { id: MainTab; label: string }[]).map(t => (
          <button
            key={t.id}
            className={`conv-pers__main-tab ${mainTab === t.id ? 'conv-pers__main-tab--active' : ''}`}
            onClick={() => setMainTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ──────────────────────────────────── */}
      <div className="conv-pers__body">

        {/* ══ BACKGROUND TAB ═══════════════════════════════ */}
        {mainTab === 'bg' && (
          <>
            {/* Horizontal type strip */}
            <section className="conv-pers__section">
              <h3 className="conv-pers__section-title">Type</h3>
              <div className="conv-pers__bg-tabs">
                {([
                  { id: 'none',    label: 'None'     },
                  { id: 'solid',   label: 'Colors'   },
                  { id: 'scene',   label: 'Photo'    },
                ] as { id: BgTab; label: string }[]).map(t => (
                  <button
                    key={t.id}
                    className={`conv-pers__bg-tab ${bgTab === t.id ? 'conv-pers__bg-tab--active' : ''}`}
                    onClick={() => {
                      setBgTab(t.id);
                      if (t.id === 'none') set({ bgType: 'default', bgValue: '' });
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Solid colours + Patterns */}
            {bgTab === 'solid' && (
              <>
                <section className="conv-pers__section">
                  <h3 className="conv-pers__section-title">Color</h3>
                  <div className="conv-pers__swatch-grid">
                    {BG_SOLIDS.map(s => (
                      <button
                        key={s.value}
                        className={`conv-pers__bg-swatch ${theme.bgType === 'solid' && theme.bgValue === s.value ? 'conv-pers__swatch--sel' : ''}`}
                        style={{ background: s.value }}
                        title={s.label}
                        onClick={() => selectBg('solid', s.value)}
                      >
                        {theme.bgType === 'solid' && theme.bgValue === s.value && <Check size={11} />}
                      </button>
                    ))}
                  </div>
                  {/* Custom hex color input */}
                  <div className="conv-pers__hex-row">
                    <input
                      type="color"
                      value={theme.bgType === 'solid' && theme.bgValue ? theme.bgValue : '#111318'}
                      onChange={e => selectBg('solid', e.target.value)}
                      className="conv-pers__hex-picker"
                    />
                    <div className="conv-pers__hex-input-wrap">
                      <span className="conv-pers__hex-hash">#</span>
                      <input
                        type="text"
                        className="conv-pers__hex-input"
                        placeholder="1a1a2e"
                        maxLength={6}
                        value={(theme.bgType === 'solid' && theme.bgValue ? theme.bgValue : '').replace('#', '')}
                        onChange={e => {
                          const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                          if (v.length === 6) selectBg('solid', '#' + v);
                        }}
                        onBlur={e => {
                          const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                          if (v.length === 6) selectBg('solid', '#' + v);
                        }}
                      />
                    </div>
                    <span className="conv-pers__hex-label">Custom</span>
                  </div>
                </section>
                <section className="conv-pers__section">
                  <h3 className="conv-pers__section-title">Pattern Overlay</h3>
                  <div className="conv-pers__pattern-grid">
                    <button
                      className={`conv-pers__pattern-card ${theme.bgType !== 'pattern' ? 'conv-pers__swatch--sel' : ''}`}
                      style={{ background: 'var(--dl-bg-surface)', border: '1px dashed var(--dl-border)' }}
                      onClick={() => set({ bgType: theme.bgType === 'pattern' ? 'default' : theme.bgType, bgValue: theme.bgType === 'pattern' ? '' : theme.bgValue, patternColor: '' })}
                    >
                      <span className="conv-pers__pattern-label">None</span>
                    </button>
                    {BG_PATTERNS.map(p => {
                      const isActive = theme.bgType === 'pattern' && theme.bgValue === p.key;
                      const previewBg = isActive && theme.patternColor
                        ? patternWithColor(p.key, theme.patternColor)
                        : PATTERN_CSS[p.key];
                      return (
                        <button
                          key={p.key}
                          className={`conv-pers__pattern-card ${isActive ? 'conv-pers__swatch--sel' : ''}`}
                          style={{ background: previewBg }}
                          onClick={() => selectBg('pattern', p.key)}
                        >
                          {isActive && (
                            <span className="conv-pers__pattern-check"><Check size={10} /></span>
                          )}
                          <span className="conv-pers__pattern-label">{p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {/* Pattern base color picker */}
                  {theme.bgType === 'pattern' && (
                    <div className="conv-pers__hex-row" style={{ marginTop: 8 }}>
                      <input
                        type="color"
                        value={theme.patternColor || '#111318'}
                        onChange={e => set({ patternColor: e.target.value })}
                        className="conv-pers__hex-picker"
                      />
                      <div className="conv-pers__hex-input-wrap">
                        <span className="conv-pers__hex-hash">#</span>
                        <input
                          type="text"
                          className="conv-pers__hex-input"
                          placeholder="111318"
                          maxLength={6}
                          value={(theme.patternColor || '').replace('#', '')}
                          onChange={e => {
                            const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                            if (v.length === 6) set({ patternColor: '#' + v });
                          }}
                          onBlur={e => {
                            const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                            if (v.length === 6) set({ patternColor: '#' + v });
                          }}
                        />
                      </div>
                      <span className="conv-pers__hex-label">Pattern Color</span>
                      {theme.patternColor && (
                        <button
                          className="conv-pers__hex-clear"
                          onClick={() => set({ patternColor: '' })}
                          title="Reset to default"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}

            {/* Photo background */}
            {bgTab === 'scene' && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                <section className="conv-pers__section">
                  <h3 className="conv-pers__section-title">Photo</h3>
                  {theme.bgType === 'image' && theme.bgValue ? (
                    <div className="conv-pers__img-preview">
                      <img src={theme.bgValue} alt="Chat background" />
                      <div className="conv-pers__img-actions">
                        <button className="conv-pers__img-btn" onClick={() => fileInputRef.current?.click()}>Change</button>
                        <button className="conv-pers__img-btn conv-pers__img-btn--remove" onClick={() => selectBg('default', '')}>Remove</button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`conv-pers__dropzone conv-pers__dropzone--compact ${dragOver ? 'conv-pers__dropzone--over' : ''}`}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                    >
                      <Upload size={18} />
                      <span className="conv-pers__drop-title">Upload photo</span>
                      <span className="conv-pers__drop-sub">Click or drag &amp; drop · JPG, PNG, GIF, WebP</span>
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}

        {/* ══ BUBBLES TAB ══════════════════════════════════ */}
        {mainTab === 'bubbles' && (
          <>
            {/* Your bubble color */}
            <section className="conv-pers__section">
              <h3 className="conv-pers__section-title">Your Color</h3>
              <div className="conv-pers__swatch-grid">
                {OWN_COLORS.map(c => (
                  <button
                    key={c.color}
                    className={[
                      'conv-pers__color-swatch',
                      c.color === 'default' ? 'conv-pers__color-swatch--default' : '',
                      theme.ownColor === c.color ? 'conv-pers__swatch--sel' : '',
                    ].join(' ')}
                    style={c.color !== 'default' ? { background: c.color } : undefined}
                    title={c.label}
                    onClick={() => pickOwnColor(c.color, c.text)}
                  >
                    {theme.ownColor === c.color && <Check size={10} />}
                  </button>
                ))}
              </div>
            </section>

            {/* Your text color */}
            <section className="conv-pers__section">
              <h3 className="conv-pers__section-title">Your Text Color</h3>
              <div className="conv-pers__swatch-grid">
                {TEXT_COLORS.map(c => (
                  <button
                    key={c.color}
                    className={[
                      'conv-pers__color-swatch',
                      c.color === 'default' ? 'conv-pers__color-swatch--default' : '',
                      theme.ownText === c.color ? 'conv-pers__swatch--sel' : '',
                    ].join(' ')}
                    style={c.color !== 'default' ? { background: c.color } : undefined}
                    title={c.label}
                    onClick={() => set({ ownText: c.color as 'default' | string, autoTextColor: false })}
                  >
                    {theme.ownText === c.color && <Check size={10} />}
                  </button>
                ))}
              </div>
              <input
                ref={ownTextColorRef}
                type="color"
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                onChange={e => set({ ownText: e.target.value, autoTextColor: false })}
              />
              <button
                className="conv-pers__colorwheel-btn"
                onClick={() => ownTextColorRef.current?.click()}
              >
                <div
                  className="conv-pers__colorwheel-preview"
                  style={theme.ownText !== 'default' ? { background: theme.ownText } : undefined}
                />
                <span>Custom color</span>
                <Palette size={12} />
              </button>
            </section>

            {/* Their bubble color */}
            <section className="conv-pers__section">
              <h3 className="conv-pers__section-title">Their Color</h3>
              <div className="conv-pers__swatch-grid">
                {OTHER_COLORS.map(c => (
                  <button
                    key={c.color}
                    className={[
                      'conv-pers__color-swatch',
                      c.color === 'default' ? 'conv-pers__color-swatch--default' : '',
                      theme.otherColor === c.color ? 'conv-pers__swatch--sel' : '',
                    ].join(' ')}
                    style={c.color !== 'default' ? { background: c.color } : undefined}
                    title={c.label}
                    onClick={() => pickOtherColor(c.color, c.text)}
                  >
                    {theme.otherColor === c.color && <Check size={10} />}
                  </button>
                ))}
              </div>
            </section>

            {/* Their text color */}
            <section className="conv-pers__section">
              <h3 className="conv-pers__section-title">Their Text Color</h3>
              <div className="conv-pers__swatch-grid">
                {TEXT_COLORS.map(c => (
                  <button
                    key={c.color}
                    className={[
                      'conv-pers__color-swatch',
                      c.color === 'default' ? 'conv-pers__color-swatch--default' : '',
                      theme.otherText === c.color ? 'conv-pers__swatch--sel' : '',
                    ].join(' ')}
                    style={c.color !== 'default' ? { background: c.color } : undefined}
                    title={c.label}
                    onClick={() => set({ otherText: c.color as 'default' | string, autoTextColor: false })}
                  >
                    {theme.otherText === c.color && <Check size={10} />}
                  </button>
                ))}
              </div>
              <input
                ref={otherTextColorRef}
                type="color"
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                onChange={e => set({ otherText: e.target.value, autoTextColor: false })}
              />
              <button
                className="conv-pers__colorwheel-btn"
                onClick={() => otherTextColorRef.current?.click()}
              >
                <div
                  className="conv-pers__colorwheel-preview"
                  style={theme.otherText !== 'default' ? { background: theme.otherText } : undefined}
                />
                <span>Custom color</span>
                <Palette size={12} />
              </button>
            </section>

            {/* Automatic contrast */}
            <section className={`conv-pers__section conv-pers__section--auto-text${theme.autoTextColor ? ' conv-pers__section--auto-text-active' : ''}`}>
              <h3 className="conv-pers__section-title">Text Contrast</h3>
              <div className="conv-pers__toggle-row">
                <div className="conv-pers__toggle-info">
                  <span className="conv-pers__toggle-label">Auto Text Color</span>
                  <span className="conv-pers__toggle-desc">
                    {theme.autoTextColor ? 'Text adjusts when you change a bubble color' : 'Choose readable text for each bubble automatically'}
                  </span>
                </div>
                <button
                  className={`conv-pers__toggle ${theme.autoTextColor ? 'conv-pers__toggle--on' : ''}`}
                  onClick={() => { if (!theme.autoTextColor) applyAutoText(); else set({ autoTextColor: false }); }}
                  role="switch"
                  aria-checked={theme.autoTextColor}
                  aria-label="Automatically choose readable text colors"
                >
                  <span className="conv-pers__toggle-thumb" />
                </button>
              </div>
              {theme.autoTextColor && (
                <button className="conv-pers__recalc" onClick={applyAutoText}>Refresh contrast</button>
              )}
            </section>

            {/* Bubble shape */}
            <section className="conv-pers__section">
              <h3 className="conv-pers__section-title">Shape</h3>
              <div className="conv-pers__style-grid">
                {BUBBLE_STYLES.map(s => (
                  <button
                    key={s.value}
                    className={`conv-pers__style-card ${theme.bubbleStyle === s.value ? 'conv-pers__style-card--sel' : ''}`}
                    onClick={() => set({ bubbleStyle: s.value })}
                    aria-pressed={theme.bubbleStyle === s.value}
                  >
                    <div className="conv-pers__style-preview">
                      <div className="conv-pers__preview-bubble conv-pers__preview-bubble--own"   style={{ borderRadius: s.own }} />
                      <div className="conv-pers__preview-bubble conv-pers__preview-bubble--other" style={{ borderRadius: s.other }} />
                    </div>
                    <span className="conv-pers__style-label">{s.label}</span>
                    {theme.bubbleStyle === s.value && <Check className="conv-pers__style-check" size={12} />}
                  </button>
                ))}
              </div>
            </section>

            {/* Message border */}
            <section className="conv-pers__section">
              <h3 className="conv-pers__section-title">Border</h3>
              <div className="conv-pers__border-grid">
                {BORDER_STYLE_CARDS.map(b => {
                  const canConfigure = !!BORDER_STYLE_DEFS[b.value].settingsType;
                  const previewStyle = getBorderPreviewStyle(b, overrides);
                  return (
                    <button
                      key={b.value}
                      className={`conv-pers__border-card ${theme.msgBorder === b.value ? 'conv-pers__border-card--sel' : ''}`}
                      onClick={() => set({ msgBorder: b.value })}
                      title={b.label}
                    >
                      {canConfigure && (
                        <button
                          className="conv-pers__border-gear"
                          title="Customize"
                          onClick={e => {
                            e.stopPropagation();
                            set({ msgBorder: b.value });
                            setActiveBorderSettings(prev => prev === b.value ? null : b.value);
                          }}
                        >
                          <Settings size={10} />
                        </button>
                      )}
                      <div className="conv-pers__border-preview">
                        <div
                          className={`conv-pers__border-bubble${
                            b.value === 'rgb'
                              ? {
                                  trail: ' conv-pers__border-bubble--rgb-trail',
                                  fill:  ' conv-pers__border-bubble--rgb-fill',
                                  empty: ' conv-pers__border-bubble--rgb-empty',
                                  rgb:   ' conv-pers__border-bubble--rgb',
                                }[overrides['rgb']?.mode ?? 'rgb'] ?? ' conv-pers__border-bubble--rgb'
                              : ''
                          }`}
                          style={previewStyle}
                        />
                      </div>
                      <span>{b.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* ── Per-border settings panel ── */}
              {activeBorderSettings && activeBorderSettings !== 'none' && (
                <div className="conv-pers__border-settings">
                  <div className="conv-pers__bs-header">
                    <span>
                      {BORDER_STYLE_CARDS.find(b => b.value === activeBorderSettings)?.label} settings
                    </span>
                    <button className="conv-pers__bs-close" onClick={() => setActiveBorderSettings(null)}>
                      <X size={11} />
                    </button>
                  </div>

                  {/* Glass / Frost */}
                  {(activeBorderSettings === 'glass' || activeBorderSettings === 'frost') && (() => {
                    const bs = activeBorderSettings;
                    const opts = overrides[bs] ?? {};
                    return (
                      <>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Blur</span>
                          <div className="conv-pers__bs-slider-wrap">
                            <span className="conv-pers__bs-hint">Light</span>
                            <input
                              type="range" min="0" max="100"
                              value={opts.intensity ?? 60}
                              onChange={e => setBorderOpt(bs, 'intensity', Number(e.target.value))}
                              className="conv-pers__bs-slider"
                            />
                            <span className="conv-pers__bs-hint">Heavy</span>
                          </div>
                        </div>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Tint</span>
                          <div className="conv-pers__bs-swatches">
                            {GLASS_TINTS.map(t => (
                              <button
                                key={t.hex}
                                className={`conv-pers__bs-swatch ${opts.tint === t.hex || (!opts.tint && t.hex === '') ? 'conv-pers__bs-swatch--sel' : ''}`}
                                style={t.hex ? { background: t.hex } : { background: 'transparent', border: '1px dashed rgba(255,255,255,0.3)' }}
                                title={t.label}
                                onClick={() => {
                                  if (t.hex === '') clearBorderOpt(bs, 'tint');
                                  else setBorderOpt(bs, 'tint', t.hex);
                                }}
                              >
                                {(opts.tint === t.hex || (!opts.tint && t.hex === '')) && <Check size={8} />}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {/* Color-glow borders */}
                  {(activeBorderSettings === 'neon' || activeBorderSettings === 'ember' || activeBorderSettings === 'darklock' || activeBorderSettings === 'glow') && (() => {
                    const bs = activeBorderSettings;
                    const opts = overrides[bs] ?? {};
                    const presets = BORDER_COLOR_PRESETS[bs] ?? [];
                    return (
                      <>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Color</span>
                          <div className="conv-pers__bs-swatches">
                            {presets.map(p => (
                              <button
                                key={p.color}
                                className={`conv-pers__bs-swatch ${opts.color === p.color ? 'conv-pers__bs-swatch--sel' : ''}`}
                                style={{ background: p.color }}
                                title={p.label}
                                onClick={() => setBorderOpt(bs, 'color', p.color)}
                              >
                                {opts.color === p.color && <Check size={8} />}
                              </button>
                            ))}
                            <input
                              ref={borderColorRef}
                              type="color"
                              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                              value={opts.color?.startsWith('#') ? opts.color : '#8b5cf6'}
                              onChange={e => setBorderOpt(bs, 'color', e.target.value)}
                            />
                            <button
                              className="conv-pers__bs-swatch conv-pers__bs-swatch--custom"
                              title="Custom"
                              style={opts.color && !presets.find(p => p.color === opts.color)
                                ? { background: opts.color }
                                : { background: 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)' }}
                              onClick={() => borderColorRef.current?.click()}
                            />
                          </div>
                        </div>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Intensity</span>
                          <div className="conv-pers__bs-slider-wrap">
                            <span className="conv-pers__bs-hint">Soft</span>
                            <input
                              type="range" min="0" max="100"
                              value={opts.intensity ?? 50}
                              onChange={e => setBorderOpt(bs, 'intensity', Number(e.target.value))}
                              className="conv-pers__bs-slider"
                            />
                            <span className="conv-pers__bs-hint">Strong</span>
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {/* Outline — color only */}
                  {activeBorderSettings === 'outline' && (() => {
                    const opts = overrides['outline'] ?? {};
                    const presets = BORDER_COLOR_PRESETS['outline'] ?? [];
                    return (
                      <div className="conv-pers__bs-row">
                        <span className="conv-pers__bs-label">Color</span>
                        <div className="conv-pers__bs-swatches">
                          {presets.map(p => (
                            <button
                              key={p.color}
                              className={`conv-pers__bs-swatch ${opts.color === p.color ? 'conv-pers__bs-swatch--sel' : ''}`}
                              style={{ background: p.color }}
                              title={p.label}
                              onClick={() => setBorderOpt('outline', 'color', p.color)}
                            >
                              {opts.color === p.color && <Check size={8} />}
                            </button>
                          ))}
                          <input
                            ref={borderColorRef}
                            type="color"
                            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                            value={opts.color?.startsWith('#') ? opts.color : '#ffffff'}
                            onChange={e => setBorderOpt('outline', 'color', e.target.value)}
                          />
                          <button
                            className="conv-pers__bs-swatch conv-pers__bs-swatch--custom"
                            title="Custom"
                            style={opts.color && !presets.find(p => p.color === opts.color)
                              ? { background: opts.color }
                              : { background: 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)' }}
                            onClick={() => borderColorRef.current?.click()}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {/* RGB — mode + speed */}
                  {activeBorderSettings === 'rgb' && (() => {
                    const opts = overrides['rgb'] ?? {};
                    const modes  = [
                      { label: 'RGB',   value: 'rgb'   as const },
                      { label: 'Trail', value: 'trail' as const },
                      { label: 'Fill',  value: 'fill'  as const },
                      { label: 'Empty', value: 'empty' as const },
                    ];
                    const speeds = [{ label: 'Slow', value: 7 }, { label: 'Med', value: 3 }, { label: 'Fast', value: 1.2 }];
                    return (
                      <>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Mode</span>
                          <div className="conv-pers__seg conv-pers__seg--sm">
                            {modes.map(m => (
                              <button
                                key={m.value}
                                className={`conv-pers__seg-btn ${(opts.mode ?? 'rgb') === m.value ? 'conv-pers__seg-btn--sel' : ''}`}
                                onClick={() => setBorderOpt('rgb', 'mode', m.value)}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Speed</span>
                          <div className="conv-pers__seg conv-pers__seg--sm">
                            {speeds.map(s => (
                              <button
                                key={s.value}
                                className={`conv-pers__seg-btn ${(opts.speed ?? 3) === s.value ? 'conv-pers__seg-btn--sel' : ''}`}
                                onClick={() => setBorderOpt('rgb', 'speed', s.value)}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </section>

            {/* Message bar border */}
            <section className="conv-pers__section conv-pers__section--message-bar">
              <h3 className="conv-pers__section-title">Message Bar</h3>
              <div className="conv-pers__border-grid">
                {BORDER_STYLE_CARDS.map(b => {
                  const canConfigure = !!BORDER_STYLE_DEFS[b.value].settingsType;
                  const previewStyle = getBorderPreviewStyle(b, inputOverrides);
                  return (
                    <button
                      key={b.value}
                      className={`conv-pers__border-card ${theme.inputBorder === b.value ? 'conv-pers__border-card--sel' : ''}`}
                      onClick={() => set({ inputBorder: b.value })}
                      title={b.label}
                    >
                      {canConfigure && (
                        <button
                          className="conv-pers__border-gear"
                          title="Customize"
                          onClick={e => {
                            e.stopPropagation();
                            set({ inputBorder: b.value });
                            setActiveInputBorderSettings(prev => prev === b.value ? null : b.value);
                          }}
                        >
                          <Settings size={10} />
                        </button>
                      )}
                      <div className="conv-pers__border-preview">
                        <div
                          className={`conv-pers__border-bubble${
                            b.value === 'rgb'
                              ? {
                                  trail: ' conv-pers__border-bubble--rgb-trail',
                                  fill:  ' conv-pers__border-bubble--rgb-fill',
                                  empty: ' conv-pers__border-bubble--rgb-empty',
                                  rgb:   ' conv-pers__border-bubble--rgb',
                                }[inputOverrides['rgb']?.mode ?? 'rgb'] ?? ' conv-pers__border-bubble--rgb'
                              : ''
                          }`}
                          style={previewStyle}
                        />
                      </div>
                      <span>{b.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* ── Per-border settings panel (input bar) ── */}
              {activeInputBorderSettings && activeInputBorderSettings !== 'none' && (
                <div className="conv-pers__border-settings">
                  <div className="conv-pers__bs-header">
                    <span>
                      {BORDER_STYLE_CARDS.find(b => b.value === activeInputBorderSettings)?.label} settings
                    </span>
                    <button className="conv-pers__bs-close" onClick={() => setActiveInputBorderSettings(null)}>
                      <X size={11} />
                    </button>
                  </div>

                  {/* Glass / Frost */}
                  {(activeInputBorderSettings === 'glass' || activeInputBorderSettings === 'frost') && (() => {
                    const bs = activeInputBorderSettings;
                    const opts = inputOverrides[bs] ?? {};
                    return (
                      <>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Blur</span>
                          <div className="conv-pers__bs-slider-wrap">
                            <span className="conv-pers__bs-hint">Light</span>
                            <input
                              type="range" min="0" max="100"
                              value={opts.intensity ?? 60}
                              onChange={e => setInputBorderOpt(bs, 'intensity', Number(e.target.value))}
                              className="conv-pers__bs-slider"
                            />
                            <span className="conv-pers__bs-hint">Heavy</span>
                          </div>
                        </div>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Tint</span>
                          <div className="conv-pers__bs-swatches">
                            {GLASS_TINTS.map(t => (
                              <button
                                key={t.hex}
                                className={`conv-pers__bs-swatch ${opts.tint === t.hex || (!opts.tint && t.hex === '') ? 'conv-pers__bs-swatch--sel' : ''}`}
                                style={t.hex ? { background: t.hex } : { background: 'transparent', border: '1px dashed rgba(255,255,255,0.3)' }}
                                title={t.label}
                                onClick={() => {
                                  if (t.hex === '') clearInputBorderOpt(bs, 'tint');
                                  else setInputBorderOpt(bs, 'tint', t.hex);
                                }}
                              >
                                {(opts.tint === t.hex || (!opts.tint && t.hex === '')) && <Check size={8} />}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {/* Color-glow borders */}
                  {(activeInputBorderSettings === 'neon' || activeInputBorderSettings === 'ember' || activeInputBorderSettings === 'darklock' || activeInputBorderSettings === 'glow') && (() => {
                    const bs = activeInputBorderSettings;
                    const opts = inputOverrides[bs] ?? {};
                    const presets = BORDER_COLOR_PRESETS[bs] ?? [];
                    return (
                      <>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Color</span>
                          <div className="conv-pers__bs-swatches">
                            {presets.map(p => (
                              <button
                                key={p.color}
                                className={`conv-pers__bs-swatch ${opts.color === p.color ? 'conv-pers__bs-swatch--sel' : ''}`}
                                style={{ background: p.color }}
                                title={p.label}
                                onClick={() => setInputBorderOpt(bs, 'color', p.color)}
                              >
                                {opts.color === p.color && <Check size={8} />}
                              </button>
                            ))}
                            <input
                              ref={inputBorderColorRef}
                              type="color"
                              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                              value={opts.color?.startsWith('#') ? opts.color : '#8b5cf6'}
                              onChange={e => setInputBorderOpt(bs, 'color', e.target.value)}
                            />
                            <button
                              className="conv-pers__bs-swatch conv-pers__bs-swatch--custom"
                              title="Custom"
                              style={opts.color && !presets.find(p => p.color === opts.color)
                                ? { background: opts.color }
                                : { background: 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)' }}
                              onClick={() => inputBorderColorRef.current?.click()}
                            />
                          </div>
                        </div>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Intensity</span>
                          <div className="conv-pers__bs-slider-wrap">
                            <span className="conv-pers__bs-hint">Soft</span>
                            <input
                              type="range" min="0" max="100"
                              value={opts.intensity ?? 50}
                              onChange={e => setInputBorderOpt(bs, 'intensity', Number(e.target.value))}
                              className="conv-pers__bs-slider"
                            />
                            <span className="conv-pers__bs-hint">Strong</span>
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {/* Outline — color only */}
                  {activeInputBorderSettings === 'outline' && (() => {
                    const opts = inputOverrides['outline'] ?? {};
                    const presets = BORDER_COLOR_PRESETS['outline'] ?? [];
                    return (
                      <div className="conv-pers__bs-row">
                        <span className="conv-pers__bs-label">Color</span>
                        <div className="conv-pers__bs-swatches">
                          {presets.map(p => (
                            <button
                              key={p.color}
                              className={`conv-pers__bs-swatch ${opts.color === p.color ? 'conv-pers__bs-swatch--sel' : ''}`}
                              style={{ background: p.color }}
                              title={p.label}
                              onClick={() => setInputBorderOpt('outline', 'color', p.color)}
                            >
                              {opts.color === p.color && <Check size={8} />}
                            </button>
                          ))}
                          <input
                            ref={inputBorderColorRef}
                            type="color"
                            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                            value={opts.color?.startsWith('#') ? opts.color : '#ffffff'}
                            onChange={e => setInputBorderOpt('outline', 'color', e.target.value)}
                          />
                          <button
                            className="conv-pers__bs-swatch conv-pers__bs-swatch--custom"
                            title="Custom"
                            style={opts.color && !presets.find(p => p.color === opts.color)
                              ? { background: opts.color }
                              : { background: 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)' }}
                            onClick={() => inputBorderColorRef.current?.click()}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {/* RGB — mode + speed */}
                  {activeInputBorderSettings === 'rgb' && (() => {
                    const opts = inputOverrides['rgb'] ?? {};
                    const modes  = [
                      { label: 'RGB',   value: 'rgb'   as const },
                      { label: 'Trail', value: 'trail' as const },
                      { label: 'Fill',  value: 'fill'  as const },
                      { label: 'Empty', value: 'empty' as const },
                    ];
                    const speeds = [{ label: 'Slow', value: 7 }, { label: 'Med', value: 3 }, { label: 'Fast', value: 1.2 }];
                    return (
                      <>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Mode</span>
                          <div className="conv-pers__seg conv-pers__seg--sm">
                            {modes.map(m => (
                              <button
                                key={m.value}
                                className={`conv-pers__seg-btn ${(opts.mode ?? 'rgb') === m.value ? 'conv-pers__seg-btn--sel' : ''}`}
                                onClick={() => setInputBorderOpt('rgb', 'mode', m.value)}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="conv-pers__bs-row">
                          <span className="conv-pers__bs-label">Speed</span>
                          <div className="conv-pers__seg conv-pers__seg--sm">
                            {speeds.map(s => (
                              <button
                                key={s.value}
                                className={`conv-pers__seg-btn ${(opts.speed ?? 3) === s.value ? 'conv-pers__seg-btn--sel' : ''}`}
                                onClick={() => setInputBorderOpt('rgb', 'speed', s.value)}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </section>
          </>
        )}

        {/* ══ STYLE TAB ════════════════════════════════════ */}
        {mainTab === 'style' && (
          <>
            {/* Message Font */}
            <section className="conv-pers__section">
              <h3 className="conv-pers__section-title">Message Font</h3>
              {(() => {
                const currentFont = CHAT_FONTS.find(f => f.id === ((theme as unknown as Record<string,unknown>).chatFont ?? 'default')) ?? CHAT_FONTS[0];
                return (
                  <button
                    className="conv-pers__font-btn"
                    onClick={() => setShowFontModal(true)}
                  >
                    <span style={currentFont.style}>{currentFont.label}</span>
                    <span className="conv-pers__font-btn-preview" style={currentFont.style}>{currentFont.preview}</span>
                    <span className="conv-pers__font-btn-caret">▾</span>
                  </button>
                );
              })()}
            </section>

            {/* Font size */}
            <section className="conv-pers__section">
              <h3 className="conv-pers__section-title">Message Size</h3>
              <div className="conv-pers__seg">
                {(['sm', 'md', 'lg'] as MsgFontSize[]).map(sz => (
                  <button
                    key={sz}
                    className={`conv-pers__seg-btn ${theme.fontSize === sz ? 'conv-pers__seg-btn--sel' : ''}`}
                    onClick={() => set({ fontSize: sz })}
                  >
                    {sz === 'sm' ? 'Small' : sz === 'md' ? 'Medium' : 'Large'}
                  </button>
                ))}
              </div>
            </section>

            {/* Message spacing / density */}
            <section className="conv-pers__section">
              <h3 className="conv-pers__section-title">Message Spacing</h3>
              <div className="conv-pers__seg">
                {(['compact', 'comfortable', 'cozy'] as MsgDensity[]).map(d => (
                  <button
                    key={d}
                    className={`conv-pers__seg-btn ${(theme as unknown as Record<string, unknown>).msgDensity === d ? 'conv-pers__seg-btn--sel' : ''}`}
                    onClick={() => set({ msgDensity: d } as never)}
                  >
                    {d === 'compact' ? 'Compact' : d === 'comfortable' ? 'Normal' : 'Cozy'}
                  </button>
                ))}
              </div>
            </section>

            {/* Effects */}
            <section className="conv-pers__section">
              <h3 className="conv-pers__section-title">Effects</h3>
              <div className="conv-pers__toggle-row">
                <div className="conv-pers__toggle-info">
                  <span className="conv-pers__toggle-label">Bubble Shadow</span>
                  <span className="conv-pers__toggle-desc">Subtle depth behind each message</span>
                </div>
                <button
                  className={`conv-pers__toggle ${theme.shadow ? 'conv-pers__toggle--on' : ''}`}
                  onClick={() => set({ shadow: !theme.shadow })}
                  role="switch"
                  aria-checked={theme.shadow}
                >
                  <span className="conv-pers__toggle-thumb" />
                </button>
              </div>
              <div className="conv-pers__toggle-row" style={{ marginTop: 8 }}>
                <div className="conv-pers__toggle-info">
                  <span className="conv-pers__toggle-label">Monospace Font</span>
                  <span className="conv-pers__toggle-desc">Use a fixed-width font for messages</span>
                </div>
                <button
                  className={`conv-pers__toggle ${(theme as unknown as Record<string, unknown>).monoFont ? 'conv-pers__toggle--on' : ''}`}
                  onClick={() => set({ monoFont: !(theme as unknown as Record<string, unknown>).monoFont } as never)}
                  role="switch"
                  aria-checked={!!(theme as unknown as Record<string, unknown>).monoFont}
                >
                  <span className="conv-pers__toggle-thumb" />
                </button>
              </div>
              <div className="conv-pers__toggle-row" style={{ marginTop: 8 }}>
                <div className="conv-pers__toggle-info">
                  <span className="conv-pers__toggle-label">Gradient Text</span>
                  <span className="conv-pers__toggle-desc">Apply a gradient effect to message text</span>
                </div>
                <button
                  className={`conv-pers__toggle ${(theme as unknown as Record<string, unknown>).gradientText ? 'conv-pers__toggle--on' : ''}`}
                  onClick={() => set({ gradientText: !(theme as unknown as Record<string, unknown>).gradientText } as never)}
                  role="switch"
                  aria-checked={!!(theme as unknown as Record<string, unknown>).gradientText}
                >
                  <span className="conv-pers__toggle-thumb" />
                </button>
              </div>
              <div className="conv-pers__toggle-row" style={{ marginTop: 8 }}>
                <div className="conv-pers__toggle-info">
                  <span className="conv-pers__toggle-label">Uppercase</span>
                  <span className="conv-pers__toggle-desc">Display all message text in uppercase</span>
                </div>
                <button
                  className={`conv-pers__toggle ${(theme as unknown as Record<string, unknown>).uppercase ? 'conv-pers__toggle--on' : ''}`}
                  onClick={() => set({ uppercase: !(theme as unknown as Record<string, unknown>).uppercase } as never)}
                  role="switch"
                  aria-checked={!!(theme as unknown as Record<string, unknown>).uppercase}
                >
                  <span className="conv-pers__toggle-thumb" />
                </button>
              </div>
              <div className="conv-pers__toggle-row" style={{ marginTop: 8 }}>
                <div className="conv-pers__toggle-info">
                  <span className="conv-pers__toggle-label">Hide Avatars</span>
                  <span className="conv-pers__toggle-desc">Remove avatar icons from messages</span>
                </div>
                <button
                  className={`conv-pers__toggle ${(theme as unknown as Record<string, unknown>).hideAvatars ? 'conv-pers__toggle--on' : ''}`}
                  onClick={() => set({ hideAvatars: !(theme as unknown as Record<string, unknown>).hideAvatars } as never)}
                  role="switch"
                  aria-checked={!!(theme as unknown as Record<string, unknown>).hideAvatars}
                >
                  <span className="conv-pers__toggle-thumb" />
                </button>
              </div>
              <div style={{ marginTop: 8 }}>
                <span className="conv-pers__toggle-label" style={{ display: 'block', marginBottom: 6 }}>Message Animation</span>
                <div className="conv-pers__seg">
                  {(['none', 'fade', 'slide'] as const).map(a => (
                    <button
                      key={a}
                      className={`conv-pers__seg-btn ${(theme as unknown as Record<string, unknown>).msgAnimation === a ? 'conv-pers__seg-btn--sel' : ''}`}
                      onClick={() => set({ msgAnimation: a } as never)}
                    >
                      {a === 'none' ? 'None' : a === 'fade' ? 'Fade In' : 'Slide In'}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

      </div>

      {/* ── Font picker modal ──────────────────── */}
      {showFontModal && (
        <div className="conv-pers__font-overlay" onClick={() => setShowFontModal(false)}>
          <div className="conv-pers__font-modal" onClick={e => e.stopPropagation()}>
            <div className="conv-pers__font-modal-header">
              <span>Choose Message Font</span>
              <button className="conv-pers__font-modal-close" onClick={() => setShowFontModal(false)}><X size={14}/></button>
            </div>
            <div className="conv-pers__font-modal-list">
              {CHAT_FONTS.map(f => {
                const active = ((theme as unknown as Record<string,unknown>).chatFont ?? 'default') === f.id;
                return (
                  <button
                    key={f.id}
                    className={`conv-pers__font-option ${active ? 'conv-pers__font-option--sel' : ''}`}
                    onClick={() => { set({ chatFont: f.id } as never); setShowFontModal(false); }}
                  >
                    <span className="conv-pers__font-option-name" style={f.style}>{f.label}</span>
                    <span className="conv-pers__font-option-preview" style={f.style}>{f.preview}</span>
                    {active && <Check size={13} className="conv-pers__font-option-check" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ─────────────────────────────── */}
      <div className="conv-pers__footer">
        <button className="conv-pers__reset" onClick={handleReset}>
          Reset to Default
        </button>
      </div>
    </div>
  );
}
