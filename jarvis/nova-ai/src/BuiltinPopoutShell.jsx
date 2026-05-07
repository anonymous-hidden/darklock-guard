import React, { useState, useEffect } from 'react';
import { getBuiltin } from '@builtins/registry.js';

/**
 * Standalone shell rendered into popout windows that load
 * `index.html?builtin=<id>`. It mounts ONLY the requested built-in
 * widget, full-bleed, with a tiny title bar.
 */
export default function BuiltinPopoutShell({ id }) {
  const meta = getBuiltin(id);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    // Sync initial always-on-top state
    window.nova?.win?.alwaysOnTop?.get().then(setPinned).catch(() => {});
    // Keep in sync when changed via context menu
    const unsub = window.nova?.win?.alwaysOnTop?.onChange?.(setPinned);
    return () => unsub?.();
  }, []);

  const togglePin = async () => {
    const next = await window.nova?.win?.alwaysOnTop?.toggle();
    if (next !== undefined) setPinned(next);
  };

  if (!meta) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-nova-bg text-nova-err font-mono text-sm">
        Unknown built-in: {id}
      </div>
    );
  }
  const Component = meta.component;
  return (
    <div className="h-screen w-screen flex flex-col bg-nova-bg text-nova-text">
      <header className="h-7 shrink-0 px-2.5 flex items-center gap-2 border-b border-nova-border bg-nova-panel select-none"
        style={{ WebkitAppRegion: 'drag' }}>
        <span className="text-nova-accent text-xs">{meta.icon}</span>
        <span className="font-display text-[11px] tracking-wider">{meta.name.toUpperCase()}</span>
        {/* Pin (always-on-top) button */}
        <button
          onClick={togglePin}
          title={pinned ? 'Unpin (disable always on top)' : 'Pin on top'}
          style={{ WebkitAppRegion: 'no-drag' }}
          className={`ml-auto w-5 h-5 flex items-center justify-center rounded transition-colors text-xs leading-none
            ${pinned
              ? 'text-nova-accent bg-nova-accent/15 hover:bg-nova-accent/25'
              : 'text-nova-muted hover:text-nova-text hover:bg-nova-panel2'}`}>
          📌
        </button>
        {/* Minimize */}
        <button
          onClick={() => window.nova?.win?.minimize()}
          title="Minimize"
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-5 h-5 flex items-center justify-center rounded text-nova-muted hover:text-nova-text hover:bg-nova-panel2 transition-colors text-xs leading-none">
          ─
        </button>
        {/* Close */}
        <button
          onClick={() => window.close()}
          title="Close"
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-5 h-5 flex items-center justify-center rounded text-nova-muted hover:text-nova-err hover:bg-nova-err/15 transition-colors text-xs leading-none">
          ✕
        </button>
      </header>
      <main className="flex-1 min-h-0">
        <Component />
      </main>
    </div>
  );
}
