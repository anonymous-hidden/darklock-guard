import { create } from 'zustand';

export type UpdatePhase =
  | 'idle' | 'checking' | 'update_available' | 'downloading' | 'verifying'
  | 'staged' | 'restart_required' | 'installing' | 'completed' | 'no_update'
  | 'deferred' | 'failed' | 'blocked';

export interface ReleaseNotes {
  title: string;
  summary: string;
  highlights: string[];
  fixes: string[];
  security: string[];
}

export interface AvailableUpdate {
  version: string;
  channel: 'stable' | 'beta' | 'enterprise-preview' | 'development';
  classification: 'patch' | 'minor' | 'major' | 'security' | 'hotfix';
  urgency: 'recommended' | 'required' | 'emergency';
  mandatory: boolean;
  publishedAt: string;
  releaseNotes: ReleaseNotes;
}

export interface UpdateSnapshot {
  phase: UpdatePhase;
  currentVersion: string;
  channel: AvailableUpdate['channel'];
  lastCheckedAt: string | null;
  available: AvailableUpdate | null;
  progressPercent: number | null;
  bytesPerSecond: number | null;
  errorCode: string | null;
  restartBlockedReason: string | null;
}

interface UpdateState {
  snapshot: UpdateSnapshot;
  history: AvailableUpdate[];
  pendingMajorNotes: AvailableUpdate | null;
  initialized: boolean;
  initialize: () => Promise<void>;
  checkForUpdate: () => Promise<void>;
  restartAndInstall: () => Promise<void>;
  defer: () => Promise<void>;
  markMajorNotesSeen: (version: string) => Promise<void>;
  recordNotesOpened: (version: string) => void;
}

const initialSnapshot: UpdateSnapshot = {
  phase: 'idle',
  currentVersion: '2.0.0',
  channel: 'stable',
  lastCheckedAt: null,
  available: null,
  progressPercent: null,
  bytesPerSecond: null,
  errorCode: null,
  restartBlockedReason: null,
};

let removeStateListener: (() => void) | null = null;
let initializePromise: Promise<void> | null = null;
let restartSafety = { activeCall: false, activeTransfer: false, unsavedDraft: false };

export function setUpdateRestartSafety(patch: Partial<typeof restartSafety>): void {
  restartSafety = { ...restartSafety, ...patch };
  void window.electronAPI?.updaterSetRestartSafety?.(restartSafety);
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  snapshot: initialSnapshot,
  history: [],
  pendingMajorNotes: null,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return;
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      const api = window.electronAPI;
      if (!api) {
        set({ initialized: true });
        return;
      }
      removeStateListener?.();
      removeStateListener = api.onUpdaterState?.((snapshot) => set({ snapshot })) ?? null;
      const [snapshot, history, pendingMajorNotes] = await Promise.all([
        api.updaterGetState?.(),
        api.updaterGetHistory?.(),
        api.updaterGetPendingMajorNotes?.(),
      ]);
      set({
        snapshot: snapshot ?? initialSnapshot,
        history: history ?? [],
        pendingMajorNotes: pendingMajorNotes ?? null,
        initialized: true,
      });
    })().finally(() => { initializePromise = null; });
    return initializePromise;
  },

  checkForUpdate: async () => {
    const snapshot = await window.electronAPI?.checkForUpdates?.();
    if (snapshot) set({ snapshot });
  },

  restartAndInstall: async () => {
    const snapshot = await window.electronAPI?.updaterRestartAndInstall?.();
    if (snapshot) set({ snapshot });
  },

  defer: async () => {
    const snapshot = await window.electronAPI?.updaterDefer?.();
    if (snapshot) set({ snapshot });
  },

  markMajorNotesSeen: async (version) => {
    await window.electronAPI?.updaterMarkMajorNotesSeen?.(version);
    set({ pendingMajorNotes: null });
  },

  recordNotesOpened: (version) => {
    void window.electronAPI?.updaterRecordNotesOpened?.(version);
  },
}));
