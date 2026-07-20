import { create } from 'zustand';

export interface SpotifyActivity {
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

export interface SpotifyStatus {
  connected: boolean;
  sharingEnabled: boolean;
  configured: boolean;
}

interface SpotifyStore extends SpotifyStatus {
  activity: SpotifyActivity | null;
  error: string | null;
  refreshStatus: () => Promise<SpotifyStatus>;
  setStatus: (status: Partial<SpotifyStatus>) => void;
  setActivity: (activity: SpotifyActivity | null) => void;
  setError: (error: string | null) => void;
}

const desktopUnavailable: SpotifyStatus = {
  connected: false,
  sharingEnabled: false,
  configured: false,
};

export const useSpotifyStore = create<SpotifyStore>((set) => ({
  ...desktopUnavailable,
  activity: null,
  error: null,

  refreshStatus: async () => {
    if (!window.electronAPI?.spotifyStatus) {
      set({ ...desktopUnavailable, activity: null });
      return desktopUnavailable;
    }
    try {
      const status = await window.electronAPI.spotifyStatus();
      set({ ...status, error: null, ...(status.connected ? {} : { activity: null }) });
      return status;
    } catch {
      set({ ...desktopUnavailable, activity: null, error: 'Spotify is temporarily unavailable.' });
      return desktopUnavailable;
    }
  },

  setStatus: (status) => set(status),
  setActivity: (activity) => set({ activity }),
  setError: (error) => set({ error }),
}));
