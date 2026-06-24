import { create } from 'zustand';

const PERSIST_KEY = 'nova:widgetAppearance:v1';
export const WIDGET_THEME_OPTIONS = [
  {
    id: 'default',
    label: 'Jarvis',
    description: 'Balanced dark glass with calm blue highlights.',
    tone: 'dark',
    className: 'nova-widget-theme-default',
    swatches: ['#11151d', '#f6f7fb', '#77d8ff'],
  },
  {
    id: 'glass',
    label: 'Liquid Glass',
    description: 'Clearer frosted surface with extra depth.',
    tone: 'dark',
    className: 'nova-widget-theme-glass',
    swatches: ['#141a23', '#ffffff', '#8cddff'],
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Quiet charcoal, lower tint, highest contrast.',
    tone: 'dark',
    className: 'nova-widget-theme-graphite',
    swatches: ['#090b0f', '#f6f7fb', '#c7d0dd'],
  },
  {
    id: 'aqua',
    label: 'Aqua',
    description: 'Cool glass with subtle teal highlights.',
    tone: 'dark',
    className: 'nova-widget-theme-aqua',
    swatches: ['#0d181c', '#effffb', '#8be7d2'],
  },
  {
    id: 'pearl',
    label: 'Pearl',
    description: 'Light macOS-style glass for brighter rooms.',
    tone: 'light',
    className: 'nova-widget-theme-pearl',
    swatches: ['#f4f8ff', '#18202b', '#007aff'],
  },
];

export const WIDGET_THEMES = WIDGET_THEME_OPTIONS.map((theme) => theme.id);

export function getWidgetThemeOption(theme) {
  return WIDGET_THEME_OPTIONS.find((option) => option.id === theme) || WIDGET_THEME_OPTIONS[0];
}

function normalizeDesktopMode(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const next = {};
  for (const [id, enabled] of Object.entries(raw)) {
    if (id) next[id] = !!enabled;
  }
  return next;
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return { theme: 'default', desktopMode: {} };
    const parsed = JSON.parse(raw);
    const theme = WIDGET_THEMES.includes(parsed?.theme) ? parsed.theme : 'default';
    return {
      theme,
      desktopMode: normalizeDesktopMode(parsed?.desktopMode),
    };
  } catch {
    return { theme: 'default', desktopMode: {} };
  }
}

function persist(theme, desktopMode) {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      theme: WIDGET_THEMES.includes(theme) ? theme : 'default',
      desktopMode: normalizeDesktopMode(desktopMode),
    }));
  } catch {}
}

const initial = loadPersisted();

export const useWidgetAppearanceStore = create((set, get) => ({
  theme: initial.theme,
  desktopMode: initial.desktopMode,

  setTheme(theme) {
    const nextTheme = WIDGET_THEMES.includes(theme) ? theme : 'default';
    const desktopMode = get().desktopMode;
    set({ theme: nextTheme });
    persist(nextTheme, desktopMode);
  },

  setDesktopMode(id, enabled) {
    if (!id) return;
    const nextDesktopMode = {
      ...get().desktopMode,
      [id]: !!enabled,
    };
    set({ desktopMode: nextDesktopMode });
    persist(get().theme, nextDesktopMode);
  },

  toggleDesktopMode(id) {
    if (!id) return;
    const current = !!get().desktopMode[id];
    get().setDesktopMode(id, !current);
  },

  setDesktopModeBulk(ids, enabled) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const nextDesktopMode = { ...get().desktopMode };
    for (const id of ids) {
      if (id) nextDesktopMode[id] = !!enabled;
    }
    set({ desktopMode: nextDesktopMode });
    persist(get().theme, nextDesktopMode);
  },

  syncFromStorage() {
    const next = loadPersisted();
    set({
      theme: next.theme,
      desktopMode: next.desktopMode,
    });
  },
}));
