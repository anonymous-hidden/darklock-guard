import React, { useState, useEffect } from 'react';
import { getBuiltin } from '@builtins/registry.js';
import { getWidgetThemeOption, useWidgetAppearanceStore } from '@store/widgetAppearanceStore.js';

/**
 * Standalone shell rendered into popout windows that load
 * `index.html?builtin=<id>`. It mounts ONLY the requested built-in
 * widget, full-bleed, with a tiny title bar.
 */
export default function BuiltinPopoutShell({ id }) {
  const meta = getBuiltin(id);
  const [pinned, setPinned] = useState(false);
  const theme = useWidgetAppearanceStore((s) => s.theme);
  const setDesktopMode = useWidgetAppearanceStore((s) => s.setDesktopMode);
  const syncAppearance = useWidgetAppearanceStore((s) => s.syncFromStorage);

  useEffect(() => {
    // Sync initial always-on-top state
    window.nova?.win?.alwaysOnTop?.get().then(setPinned).catch(() => {});
    // Keep in sync when changed via context menu
    const unsub = window.nova?.win?.alwaysOnTop?.onChange?.(setPinned);
    return () => unsub?.();
  }, []);

  useEffect(() => {
    const onStorage = () => syncAppearance();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [syncAppearance]);

  const togglePin = async () => {
    const next = await window.nova?.win?.alwaysOnTop?.toggle();
    if (next !== undefined) setPinned(next);
  };
  const themeOption = getWidgetThemeOption(theme);

  if (!meta) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-nova-bg text-nova-err font-mono text-sm">
        Unknown built-in: {id}
      </div>
    );
  }
  const Component = meta.component;
  return (
    <div className={`h-screen w-screen flex flex-col text-nova-text nova-widget-shell ${themeOption.className}`}>
      <header className="shrink-0 px-3 flex items-center gap-2 border-b border-nova-border select-none nova-widget-header"
        style={{ WebkitAppRegion: 'drag' }}>
        <div className="flex items-center gap-1.5 pr-1.5" aria-hidden>
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57] shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e] shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840] shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" />
        </div>
        <span className="text-nova-accent text-sm leading-none">{meta.icon}</span>
        <span className="font-display text-[12px] font-medium tracking-wide truncate">{meta.name}</span>
        <button
          onClick={() => {
            setDesktopMode(id, false);
            window.close();
          }}
          title="Disable desktop mode and close"
          style={{ WebkitAppRegion: 'no-drag' }}
          className="ml-auto nova-widget-window-control text-xs leading-none">
          ⇲
        </button>
        {/* Pin (always-on-top) button */}
        <button
          onClick={togglePin}
          title={pinned ? 'Unpin (disable always on top)' : 'Pin on top'}
          style={{ WebkitAppRegion: 'no-drag' }}
          className={`nova-widget-window-control text-xs leading-none
            ${pinned
              ? 'text-nova-accent bg-nova-accent/15'
              : ''}`}>
          ●
        </button>
        {/* Minimize */}
        <button
          onClick={() => window.nova?.win?.minimize()}
          title="Minimize"
          style={{ WebkitAppRegion: 'no-drag' }}
          className="nova-widget-window-control text-xs leading-none">
          ─
        </button>
        {/* Close */}
        <button
          onClick={() => window.close()}
          title="Close"
          style={{ WebkitAppRegion: 'no-drag' }}
          className="nova-widget-window-control nova-widget-window-control-danger text-xs leading-none">
          ✕
        </button>
      </header>
      <main className="flex-1 min-h-0 nova-widget-body">
        <Component />
      </main>
    </div>
  );
}
