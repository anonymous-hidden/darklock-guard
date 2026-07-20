/// <reference types="vite/client" />

import type { AvailableUpdate, UpdateSnapshot } from './stores/updateStore';

export {};

interface ElectronAPI {
  getVersion: () => Promise<string>;
  platform: string;
  setContentProtection: (enabled: boolean) => Promise<void>;
  setSkipTaskbar: (skip: boolean) => Promise<void>;
  setSpellCheckerEnabled: (enabled: boolean) => Promise<void>;
  setIncognitoKeyboard: (enabled: boolean) => Promise<void>;
  clipboardClear: (seconds: number) => Promise<void>;
  clipboardClearNow: () => Promise<void>;
  onLockSignal: (callback: () => void) => () => void;
  onWindowBlur: (callback: () => void) => () => void;
  onWindowFocus: (callback: () => void) => () => void;
  onContentProtectionChanged: (callback: (enabled: boolean) => void) => () => void;
  winMinimize?: () => void;
  winMaximize?: () => void;
  winToggleFullscreen?: () => void;
  winIsFullscreen?: () => Promise<boolean>;
  winClose?: () => void;
  winTitlebarMenu?: () => void;
  onFullscreenChanged?: (callback: (isFullscreen: boolean) => void) => () => void;
  spotifyConnect?: () => Promise<{ pending: true }>;
  spotifyConnectionState?: () => Promise<SpotifyConnectionState>;
  spotifyReopenAuthorization?: () => Promise<void>;
  spotifyCancelConnection?: () => Promise<SpotifyConnectionState>;
  spotifyStatus?: () => Promise<{ connected: boolean; sharingEnabled: boolean; configured: boolean }>;
  spotifySetSharing?: (enabled: boolean) => Promise<{ connected: boolean; sharingEnabled: boolean }>;
  spotifyCurrentActivity?: () => Promise<SpotifyPollResult>;
  spotifyDisconnect?: () => Promise<{ connected: boolean; sharingEnabled: boolean }>;
  spotifyOpenTrack?: (url: string) => Promise<void>;
  checkForUpdates?: () => Promise<UpdateSnapshot | null>;
  updaterGetState?: () => Promise<UpdateSnapshot | null>;
  updaterGetHistory?: () => Promise<AvailableUpdate[]>;
  updaterGetPendingMajorNotes?: () => Promise<AvailableUpdate | null>;
  updaterRestartAndInstall?: () => Promise<UpdateSnapshot | null>;
  updaterDefer?: () => Promise<UpdateSnapshot | null>;
  updaterMarkMajorNotesSeen?: (version: string) => Promise<void>;
  updaterRecordNotesOpened?: (version: string) => Promise<void>;
  updaterSetRestartSafety?: (value: { activeCall: boolean; activeTransfer: boolean; unsavedDraft: boolean }) => Promise<void>;
  onUpdaterState?: (callback: (state: UpdateSnapshot) => void) => () => void;
}

interface SpotifyActivity {
  type: 'spotify';
  track_id: string;
  title: string;
  artists: string[];
  album: string;
  artwork_url: string | null;
  external_url: string;
  duration_ms: number;
  progress_ms: number;
  playback_started_at: string | null;
  is_playing: boolean;
  sampled_at: number;
}

type SpotifyPollResult =
  | { kind: 'activity'; activity: SpotifyActivity }
  | { kind: 'idle' }
  | { kind: 'error'; code: string; retryAfterMs?: number };

type SpotifyConnectionState =
  | { phase: 'idle' | 'pending' | 'success' }
  | { phase: 'error'; code: string };

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
