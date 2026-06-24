import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BUILTIN_WIDGETS, getBuiltin } from '@builtins/registry.js';
import { useBuiltinStore } from '@store/builtinStore.js';
import { getWidgetThemeOption, useWidgetAppearanceStore } from '@store/widgetAppearanceStore.js';

/**
 * BuiltinDock — renders a responsive grid of every docked built-in
 * widget. Each tile has a header with name, popout, and close.
 */
export default function BuiltinDock() {
  const docked = useBuiltinStore((s) => s.docked);
  const undock = useBuiltinStore((s) => s.undock);
  const dock   = useBuiltinStore((s) => s.dock);
  const popoutMap = useBuiltinStore((s) => s.poppedOut);
  const setPoppedOut = useBuiltinStore((s) => s.setPoppedOut);
  const clearPoppedOut = useBuiltinStore((s) => s.clearPoppedOut);
  const theme = useWidgetAppearanceStore((s) => s.theme);
  const desktopMode = useWidgetAppearanceStore((s) => s.desktopMode);
  const setDesktopMode = useWidgetAppearanceStore((s) => s.setDesktopMode);
  const syncAppearance = useWidgetAppearanceStore((s) => s.syncFromStorage);
  const [picker, setPicker] = useState(false);
  const pendingDesktopSync = useRef(new Set());
  const prevDesktopMode = useRef(desktopMode);
  const themeOption = getWidgetThemeOption(theme);

  const popout = useCallback(async (id) => {
    const meta = getBuiltin(id);
    if (!meta) return;
    // Open the LIVE widget (real React + IPC bridge) in its own window.
    const popoutId = await window.nova?.widgets?.popout?.({
      id: `builtin:${id}:${Date.now()}`,
      name: meta.name,
      builtinId: id,
      width: meta.w,
      height: meta.h,
    });
    if (popoutId) setPoppedOut(id, popoutId);
  }, [setPoppedOut]);

  const closePopout = useCallback(async (id) => {
    const popId = popoutMap[id];
    if (popId) await window.nova?.widgets?.closePopout?.(popId);
    clearPoppedOut(id);
  }, [popoutMap, clearPoppedOut]);

  useEffect(() => {
    const onStorage = () => syncAppearance();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [syncAppearance]);

  useEffect(() => {
    for (const id of docked) {
      const wantsDesktop = !!desktopMode[id];
      const isPopped = !!popoutMap[id];
      const hadDesktop = !!prevDesktopMode.current[id];
      const needsOpen = wantsDesktop && !isPopped;
      const needsClose = !wantsDesktop && hadDesktop && isPopped;
      if (!needsOpen && !needsClose) continue;
      if (pendingDesktopSync.current.has(id)) continue;
      pendingDesktopSync.current.add(id);
      const op = needsOpen ? popout(id) : closePopout(id);
      Promise.resolve(op)
        .catch(() => {})
        .finally(() => pendingDesktopSync.current.delete(id));
    }
    prevDesktopMode.current = desktopMode;
  }, [docked, desktopMode, popoutMap, popout, closePopout]);

  const undocked = BUILTIN_WIDGETS.filter((w) => !docked.includes(w.id));

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-lg text-nova-text">Built-in widgets</h2>
          <p className="text-xs text-nova-muted">Live tools you can dock here or pop onto your desktop. Theme: {themeOption.label}.</p>
        </div>
        <button onClick={() => setPicker((p) => !p)} className="nova-btn text-xs self-start sm:self-auto">
          {picker ? 'Done' : '+ Add widget'}
        </button>
      </div>

      {picker && undocked.length > 0 && (
        <div className="nova-card p-2 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {undocked.map((w) => (
            <button key={w.id} onClick={() => { dock(w.id); }}
              className="group rounded-lg p-2.5 text-left bg-white/[0.045] hover:bg-white/[0.075] border border-white/[0.07] hover:border-nova-accent/35 shadow-sm">
              <div className="font-display text-sm font-medium flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06] text-nova-accent group-hover:bg-nova-accent/10">{w.icon}</span>
                <span>{w.name}</span>
              </div>
              <div className="text-[10.5px] text-nova-muted line-clamp-2">{w.description}</div>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {docked.map((id) => {
          const meta = getBuiltin(id);
          if (!meta) return null;
          const Component = meta.component;
          const popped = !!popoutMap[id];
          const desktopEnabled = !!desktopMode[id];
          return (
            <div key={id} className={`nova-widget-shell ${themeOption.className} border border-nova-border rounded-xl overflow-hidden flex flex-col`}
              style={{ minHeight: 320 }}>
              <header className="nova-widget-header flex items-center justify-between px-3 py-1.5 border-b border-nova-border">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-white/[0.06] text-nova-accent text-sm">{meta.icon}</span>
                  <span className="font-display text-[12.5px] font-medium tracking-wide">{meta.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setDesktopMode(id, !desktopEnabled)}
                    title={desktopEnabled ? 'Disable desktop mode' : 'Enable desktop mode'}
                    className={`h-6 px-2 rounded-lg border text-[10px] font-medium transition-all ${desktopEnabled
                      ? 'text-nova-accent border-nova-accent/45 bg-nova-accent/10 shadow-[0_0_18px_rgba(100,210,255,0.1)]'
                      : 'text-nova-muted border-white/[0.08] hover:text-nova-text hover:border-nova-accent/35 hover:bg-white/[0.055]'}`}
                  >
                    desktop
                  </button>
                  <button onClick={popped ? () => closePopout(id) : () => popout(id)}
                    title={popped ? 'Close popout' : 'Pop out'}
                    className="nova-widget-window-control text-[11px]">
                    {popped ? '⤓' : '⤴'}
                  </button>
                  <button onClick={() => undock(id)} title="Remove" className="nova-widget-window-control nova-widget-window-control-danger text-[12px]">×</button>
                </div>
              </header>
              <div className="nova-widget-body flex-1 min-h-0">
                <Component />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
