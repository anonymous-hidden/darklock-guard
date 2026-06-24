import React from 'react';
import { WIDGET_THEME_OPTIONS, getWidgetThemeOption, useWidgetAppearanceStore } from '@store/widgetAppearanceStore.js';

const MANAGED_WIDGETS = [
  { id: 'nova-call', name: 'Call Jarvis', icon: '☎' },
  { id: 'nova-chat', name: 'Chat with Jarvis', icon: '✦' },
  { id: 'clock', name: 'Clock', icon: '◷' },
  { id: 'calculator', name: 'Calculator', icon: '∑' },
  { id: 'notes', name: 'Notes', icon: '✎' },
  { id: 'todo', name: 'Todos', icon: '☑' },
  { id: 'calendar', name: 'Calendar', icon: '📅' },
  { id: 'emotions', name: 'Mood Journal', icon: '💭' },
  { id: 'sysmon', name: 'System Monitor', icon: '◐' },
  { id: 'spotify', name: 'Spotify', icon: '♫' },
  { id: 'weather', name: 'Weather', icon: '☼' },
  { id: 'map', name: 'Map', icon: '🗺' },
  { id: 'news', name: 'News', icon: '📰' },
  { id: 'room-control', name: 'Room Control', icon: '🏠' },
  { id: 'quick-actions', name: 'Quick Actions', icon: '⚡' },
  { id: 'reminders', name: 'Reminders', icon: '⏰' },
  { id: 'clipboard', name: 'Clipboard', icon: '⎘' },
  { id: 'logs', name: 'Logs', icon: '📋' },
];

const MANAGED_WIDGET_IDS = MANAGED_WIDGETS.map((w) => w.id);

export default function WidgetThemeWidget() {
  const theme = useWidgetAppearanceStore((s) => s.theme);
  const setTheme = useWidgetAppearanceStore((s) => s.setTheme);
  const desktopMode = useWidgetAppearanceStore((s) => s.desktopMode);
  const setDesktopMode = useWidgetAppearanceStore((s) => s.setDesktopMode);
  const setDesktopModeBulk = useWidgetAppearanceStore((s) => s.setDesktopModeBulk);

  const enabledCount = MANAGED_WIDGETS.reduce((n, w) => n + (desktopMode[w.id] ? 1 : 0), 0);
  const activeTheme = getWidgetThemeOption(theme);

  return (
    <div className="h-full flex flex-col gap-3 p-3 text-nova-text">
      <section className="nova-card nova-glass-panel p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm">Widget Appearance</h3>
            <p className="text-[11px] text-nova-muted mt-0.5">Apply one polished look across every Jarvis widget.</p>
          </div>
          <div className="text-[10px] font-mono text-nova-muted">{activeTheme.tone}</div>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {WIDGET_THEME_OPTIONS.map((option) => {
            const selected = theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setTheme(option.id)}
                className={`nova-theme-option px-3 py-2.5 text-left transition-all ${selected ? 'is-selected' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-[12px] font-semibold">{option.label}</span>
                  <span className="flex -space-x-1" aria-hidden>
                    {option.swatches.map((color) => (
                      <span
                        key={color}
                        className="h-4 w-4 rounded-full border border-white/30 shadow-sm"
                        style={{ background: color }}
                      />
                    ))}
                  </span>
                </div>
                <div className="mt-1 text-[10.5px] leading-snug text-nova-muted">{option.description}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex-1 min-h-0 nova-card nova-glass-panel p-3 flex flex-col">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm">Desktop Widget Mode</h3>
            <p className="text-[11px] text-nova-muted mt-0.5">{enabledCount}/{MANAGED_WIDGETS.length} widgets pinned to desktop mode.</p>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setDesktopModeBulk(MANAGED_WIDGET_IDS, true)}
              className="nova-btn px-2 py-1 text-[10.5px]"
            >
              All On
            </button>
            <button
              onClick={() => setDesktopModeBulk(MANAGED_WIDGET_IDS, false)}
              className="nova-btn px-2 py-1 text-[10.5px]"
            >
              All Off
            </button>
          </div>
        </div>

        <div className="mt-2 flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
          {MANAGED_WIDGETS.map((w) => {
            const enabled = !!desktopMode[w.id];
            return (
              <div
                key={w.id}
                className="nova-glass-control px-2.5 py-2 flex items-center gap-2 shadow-sm hover:bg-white/[0.08] transition-colors"
              >
                <span className="grid h-7 w-7 place-items-center rounded-xl bg-white/[0.075] text-sm text-nova-accent" aria-hidden>{w.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium truncate">{w.name}</div>
                  <div className="text-[10px] text-nova-muted">Desktop mode preference</div>
                </div>
                <button
                  onClick={() => setDesktopMode(w.id, !enabled)}
                  className={`px-2.5 py-1 rounded-lg border text-[10.5px] font-mono transition-all ${enabled
                    ? 'border-nova-accent/60 text-nova-accent bg-nova-accent/10'
                    : 'border-white/[0.08] text-nova-muted hover:text-nova-text hover:border-nova-accent/40 hover:bg-white/[0.055]'}`}
                >
                  {enabled ? 'ON' : 'OFF'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-[10.5px] text-nova-muted px-1">
        Desktop mode opens a widget in its own window when docked and closes that window when disabled.
      </p>
    </div>
  );
}
