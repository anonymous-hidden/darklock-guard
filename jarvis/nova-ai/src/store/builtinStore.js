/**
 * Zustand store for built-in widgets — tracks which are docked
 * (open inside the Command Center) and which have been popped out
 * to their own desktop windows.
 */
import { create } from 'zustand';
import { BUILTIN_WIDGETS, getBuiltin } from '@builtins/registry.js';

export const useBuiltinStore = create((set, get) => ({
  /** ids that are currently docked in the in-app dashboard */
  docked: ['nova-call', 'nova-chat', 'clock'],
  /** map of id -> opened desktop popout window id */
  poppedOut: {},
  list: BUILTIN_WIDGETS,

  dock(id) {
    if (!getBuiltin(id)) return;
    set((s) => s.docked.includes(id) ? s : { docked: [...s.docked, id] });
  },
  undock(id) {
    set((s) => ({ docked: s.docked.filter((x) => x !== id) }));
  },
  toggleDock(id) {
    const { docked } = get();
    if (docked.includes(id)) get().undock(id);
    else get().dock(id);
  },
  setPoppedOut(id, popoutId) {
    set((s) => ({ poppedOut: { ...s.poppedOut, [id]: popoutId } }));
  },
  clearPoppedOut(id) {
    set((s) => {
      const next = { ...s.poppedOut };
      delete next[id];
      return { poppedOut: next };
    });
  },
}));
