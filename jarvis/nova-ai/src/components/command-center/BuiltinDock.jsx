import React, { useState } from 'react';
import { BUILTIN_WIDGETS, getBuiltin } from '@builtins/registry.js';
import { useBuiltinStore } from '@store/builtinStore.js';

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
  const [picker, setPicker] = useState(false);

  const popout = async (id) => {
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
  };

  const closePopout = async (id) => {
    const popId = popoutMap[id];
    if (popId) await window.nova?.widgets?.closePopout?.(popId);
    clearPoppedOut(id);
  };

  const undocked = BUILTIN_WIDGETS.filter((w) => !docked.includes(w.id));

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="font-display text-lg text-nova-text">Built-in widgets</h2>
          <p className="text-xs text-nova-muted">Live tools you can dock here or pop onto your desktop.</p>
        </div>
        <button onClick={() => setPicker((p) => !p)} className="nova-btn text-xs">
          {picker ? 'Done' : '+ Add widget'}
        </button>
      </div>

      {picker && undocked.length > 0 && (
        <div className="bg-nova-panel border border-nova-border rounded p-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {undocked.map((w) => (
            <button key={w.id} onClick={() => { dock(w.id); }}
              className="bg-nova-panel2 hover:bg-nova-bg border border-nova-border rounded p-2 text-left">
              <div className="font-display text-base">{w.icon} {w.name}</div>
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
          return (
            <div key={id} className="bg-nova-panel border border-nova-border rounded overflow-hidden flex flex-col"
              style={{ minHeight: 320 }}>
              <header className="flex items-center justify-between px-2.5 py-1 border-b border-nova-border bg-nova-panel2">
                <div className="flex items-center gap-2">
                  <span className="text-nova-accent">{meta.icon}</span>
                  <span className="font-display text-[12.5px]">{meta.name}</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={popped ? () => closePopout(id) : () => popout(id)}
                    title={popped ? 'Close popout' : 'Pop out'}
                    className="text-[10.5px] text-nova-muted hover:text-nova-text px-1">
                    {popped ? '⤓' : '⤴'}
                  </button>
                  <button onClick={() => undock(id)} title="Remove" className="text-[10.5px] text-nova-muted hover:text-nova-err px-1">×</button>
                </div>
              </header>
              <div className="flex-1 min-h-0">
                <Component />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
