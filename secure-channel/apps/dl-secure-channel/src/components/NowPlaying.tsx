/**
 * NowPlaying — shows the currently playing Spotify track at the bottom of the sidebar.
 * Polls Spotify API at a set interval, auto-refreshes tokens.
 */
import { useEffect, useRef, useCallback } from "react";
import { useConnectionsStore, fetchNowPlaying, refreshSpotifyToken } from "@/store/connectionsStore";

const POLL_INTERVAL_MS = 5_000;

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── Spotify polling hook ───────────────────────────────────────────────────────
export function useSpotifyPoller() {
  const {
    spotifyAccessToken,
    spotifyRefreshToken,
    spotifyTokenExpiry,
    spotifyClientId,
    setSpotifyTokens,
    setSpotifyNowPlaying,
    setSpotifyPolling,
    setSpotifyError,
    isSpotifyConnected,
  } = useConnectionsStore();

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!isSpotifyConnected()) return;

    let token = spotifyAccessToken;

    // Refresh if within 2 minutes of expiry
    if (spotifyTokenExpiry && Date.now() > spotifyTokenExpiry - 120_000) {
      try {
        const refreshed = await refreshSpotifyToken(spotifyRefreshToken!, spotifyClientId);
        setSpotifyTokens(
          refreshed.access_token,
          refreshed.refresh_token ?? spotifyRefreshToken!,
          refreshed.expires_in
        );
        token = refreshed.access_token;
      } catch {
        setSpotifyError("Token refresh failed — reconnect Spotify");
        return;
      }
    }

    try {
      const track = await fetchNowPlaying(token!);
      setSpotifyNowPlaying(track);
      setSpotifyError(null);
    } catch {
      setSpotifyNowPlaying(null);
    }
  }, [spotifyAccessToken, spotifyRefreshToken, spotifyTokenExpiry, spotifyClientId]);

  useEffect(() => {
    if (!isSpotifyConnected()) {
      setSpotifyPolling(false);
      return;
    }

    setSpotifyPolling(true);
    poll(); // immediate first poll

    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      setSpotifyPolling(false);
    };
  }, [spotifyAccessToken]); // restart polling when token changes
}

// ── NowPlaying component ──────────────────────────────────────────────────────
export default function NowPlaying() {
  const { spotifyNowPlaying: track, isSpotifyConnected } = useConnectionsStore();

  // Run the poller — only one instance needed app-wide
  useSpotifyPoller();

  if (!isSpotifyConnected() || !track) return null;

  const progress = track.durationMs > 0 ? (track.progressMs / track.durationMs) * 100 : 0;

  return (
    <div className="now-playing-bar mx-2 mb-2 rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="#1DB954" className="shrink-0">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
        </svg>
        <span className="text-[10px] font-semibold text-white/40 tracking-wide uppercase">
          Listening to Spotify
        </span>
      </div>

      {/* Track info */}
      <div className="flex items-center gap-2.5 px-3 pb-2.5">
        {/* Album art */}
        <div className="relative shrink-0">
          {track.albumArt ? (
            <img
              src={track.albumArt}
              alt={track.albumName}
              className="w-10 h-10 rounded-md object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-md bg-white/[0.06] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.3)">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
          {/* Playing pulse */}
          {track.isPlaying && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#1DB954]">
              <span className="absolute inset-0 rounded-full bg-[#1DB954] animate-ping opacity-60" />
            </span>
          )}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate leading-tight">{track.name}</p>
          <p className="text-[11px] text-white/40 truncate leading-tight mt-0.5">
            {track.artists.join(", ")}
          </p>

          {/* Progress bar + times */}
          <div className="mt-1.5 space-y-0.5">
            <div className="h-0.5 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#1DB954] transition-all duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-[9px] text-white/25">{formatTime(track.progressMs)}</span>
              <span className="text-[9px] text-white/25">{formatTime(track.durationMs)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
