import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useConnectionStore } from '../stores/connectionStore';
import { type SpotifyActivity, useSpotifyStore } from '../stores/spotifyStore';

const PLAYING_POLL_MS = 15_000;
const PAUSED_POLL_MS = 30_000;
const IDLE_POLL_STEPS_MS = [30_000, 60_000, 120_000];
const MAX_ERROR_BACKOFF_MS = 5 * 60_000;
const MIN_REMOTE_PUBLISH_INTERVAL_MS = 20_000;
const SIGNIFICANT_PROGRESS_DELTA_MS = 20_000;

function errorMessage(code: string): string {
  switch (code) {
    case 'not_configured': return 'Spotify connection is not configured on this desktop.';
    case 'permission_revoked': return 'Spotify permission was revoked. Reconnect Spotify to continue.';
    case 'authorization_revoked': return 'Spotify authorization expired. Reconnect Spotify to continue.';
    case 'rate_limited': return 'Spotify asked Ridgeline to slow down. Retrying shortly.';
    default: return 'Spotify is temporarily unavailable.';
  }
}

function activityChanged(previous: SpotifyActivity | null, next: SpotifyActivity): boolean {
  if (!previous || previous.track_id !== next.track_id || previous.is_playing !== next.is_playing) return true;
  return Math.abs(previous.progress_ms - next.progress_ms) >= SIGNIFICANT_PROGRESS_DELTA_MS;
}

export function useSpotifyActivitySync() {
  const sessionToken = useAuthStore(s => s.sessionToken);
  const idsUrl = useConnectionStore(s => s.idsUrl);
  const connected = useSpotifyStore(s => s.connected);
  const sharingEnabled = useSpotifyStore(s => s.sharingEnabled);
  const refreshStatus = useSpotifyStore(s => s.refreshStatus);
  const setActivity = useSpotifyStore(s => s.setActivity);
  const setError = useSpotifyStore(s => s.setError);

  const lastPublished = useRef<SpotifyActivity | null>(null);
  const lastPublishedAt = useRef(0);
  const remoteActivityExists = useRef(false);
  const lastSessionToken = useRef<string | null>(null);
  if (sessionToken) lastSessionToken.current = sessionToken;

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let idlePollCount = 0;
    let errors = 0;

    const clearRemoteActivity = async () => {
      const token = sessionToken ?? lastSessionToken.current;
      if (!remoteActivityExists.current || !token) return;
      remoteActivityExists.current = false;
      try {
        await fetch(`${idsUrl}/users/me/activity/spotify`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
          keepalive: true,
        });
      } catch {
        // The server-side TTL removes abandoned activity after a client closes.
      }
    };

    const publishActivity = async (activity: SpotifyActivity) => {
      const changed = activityChanged(lastPublished.current, activity);
      if (!changed && Date.now() - lastPublishedAt.current < MIN_REMOTE_PUBLISH_INTERVAL_MS) return;
      try {
        const response = await fetch(`${idsUrl}/users/me/activity/spotify`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            track_id: activity.track_id,
            title: activity.title,
            artists: activity.artists,
            album: activity.album,
            artwork_url: activity.artwork_url,
            external_url: activity.external_url,
            duration_ms: activity.duration_ms,
            progress_ms: activity.progress_ms,
            playback_started_at: activity.playback_started_at,
            is_playing: activity.is_playing,
          }),
        });
        if (!response.ok) {
          if (response.status === 429) setError('Ridgeline is rate limiting activity updates. Retrying shortly.');
          return;
        }
        remoteActivityExists.current = true;
        lastPublished.current = activity;
        lastPublishedAt.current = Date.now();
      } catch {
        // Keep the local preview responsive; the next scheduled poll retries.
      }
    };

    const schedule = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(poll, delay);
    };

    const poll = async () => {
      if (cancelled) return;
      if (!connected || !sharingEnabled || !sessionToken || !window.electronAPI?.spotifyCurrentActivity) {
        setActivity(null);
        await clearRemoteActivity();
        return;
      }
      if (document.visibilityState === 'hidden') {
        schedule(60_000);
        return;
      }

      try {
        const result = await window.electronAPI.spotifyCurrentActivity();
        if (cancelled) return;
        if (result.kind === 'activity') {
          errors = 0;
          idlePollCount = 0;
          setError(null);
          setActivity(result.activity);
          await publishActivity(result.activity);
          schedule(result.activity.is_playing ? PLAYING_POLL_MS : PAUSED_POLL_MS);
          return;
        }
        if (result.kind === 'idle') {
          errors = 0;
          setError(null);
          setActivity(null);
          await clearRemoteActivity();
          const delay = IDLE_POLL_STEPS_MS[Math.min(idlePollCount, IDLE_POLL_STEPS_MS.length - 1)];
          idlePollCount += 1;
          schedule(delay);
          return;
        }

        setActivity(null);
        setError(errorMessage(result.code));
        if (result.code === 'authorization_revoked') {
          await refreshStatus();
          await clearRemoteActivity();
          return;
        }
        errors += 1;
        const delay = result.code === 'rate_limited' && result.retryAfterMs
          ? result.retryAfterMs
          : Math.min(30_000 * 2 ** Math.min(errors - 1, 4), MAX_ERROR_BACKOFF_MS);
        schedule(delay);
      } catch {
        errors += 1;
        setError('Spotify is temporarily unavailable.');
        schedule(Math.min(30_000 * 2 ** Math.min(errors - 1, 4), MAX_ERROR_BACKOFF_MS));
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [connected, idsUrl, refreshStatus, sessionToken, setActivity, setError, sharingEnabled]);
}
