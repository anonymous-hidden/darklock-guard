/**
 * ConnectionsTab — manage third-party service connections (Spotify, etc.)
 */
import { useEffect, useRef, useState } from "react";
import {
  useConnectionsStore,
  startSpotifyAuth,
  fetchSpotifyProfile,
  SPOTIFY_CLIENT_ID,
  type SpotifyTrack,
} from "@/store/connectionsStore";

// ── Spotify icon ──────────────────────────────────────────────────────────────
function SpotifyIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#1DB954">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── Now Playing mini preview ──────────────────────────────────────────────────
function NowPlayingPreview({ track }: { track: SpotifyTrack }) {
  const progress = track.durationMs > 0 ? (track.progressMs / track.durationMs) * 100 : 0;
  return (
    <div className="mt-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
      <div className="flex items-center gap-2.5">
        {track.albumArt ? (
          <img src={track.albumArt} alt={track.albumName} className="w-10 h-10 rounded-md object-cover shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-md bg-white/[0.06] shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">{track.name}</p>
          <p className="text-[11px] text-white/40 truncate">{track.artists.join(", ")}</p>
          <div className="mt-1.5">
            <div className="h-0.5 rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-[#1DB954]" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-white/25">{formatTime(track.progressMs)}</span>
              <span className="text-[9px] text-white/25">{formatTime(track.durationMs)}</span>
            </div>
          </div>
        </div>
        {track.isPlaying && (
          <div className="shrink-0 flex gap-px items-end h-4">
            {[3, 5, 4].map((h, i) => (
              <div key={i} className="w-0.5 rounded-sm bg-[#1DB954]"
                style={{ height: `${h * 3}px`, animation: `eq-bar ${0.5 + i * 0.15}s ease-in-out infinite alternate` }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────
export default function ConnectionsTab() {
  const {
    spotifyProfile,
    spotifyNowPlaying,
    spotifyError,
    setSpotifyProfile,
    disconnectSpotify,
    isSpotifyConnected,
  } = useConnectionsStore();

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  // Fetch profile once connected
  useEffect(() => {
    const { spotifyAccessToken } = useConnectionsStore.getState();
    if (isSpotifyConnected() && !spotifyProfile && spotifyAccessToken) {
      fetchSpotifyProfile(spotifyAccessToken)
        .then(setSpotifyProfile)
        .catch(() => {});
    }
  }, [isSpotifyConnected()]); // eslint-disable-line

  // Listen for OAuth callback message from popup
  const handleConnect = () => {
    setError(null);
    setConnecting(true);

    // Remove previous listener
    if (listenerRef.current) window.removeEventListener("message", listenerRef.current);

    const listener = async (e: MessageEvent) => {
      if (e.data?.type === "SPOTIFY_AUTH_SUCCESS") {
        window.removeEventListener("message", listener);
        setConnecting(false);
        const { access_token, refresh_token, expires_in } = e.data;
        useConnectionsStore.getState().setSpotifyTokens(access_token, refresh_token, expires_in);
        try {
          const profile = await fetchSpotifyProfile(access_token);
          setSpotifyProfile(profile);
        } catch {}
      } else if (e.data?.type === "SPOTIFY_AUTH_ERROR") {
        window.removeEventListener("message", listener);
        setConnecting(false);
        setError(e.data.error ?? "Authentication failed");
      }
    };

    listenerRef.current = listener;
    window.addEventListener("message", listener);
    startSpotifyAuth(SPOTIFY_CLIENT_ID);

    // Timeout after 3 minutes
    setTimeout(() => {
      if (connecting) {
        setConnecting(false);
        window.removeEventListener("message", listener);
      }
    }, 180_000);
  };

  const connected = isSpotifyConnected();

  return (
    <div className="space-y-8">
      {/* Page description */}
      <p className="text-sm text-white/40 leading-relaxed">
        Connect third-party services to enhance your profile. Others can see your activity when you share it.
      </p>

      {/* ── Spotify card ─────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">Music</h2>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
          {/* Header row */}
          <div className="flex items-center gap-4 p-5">
            <div className="w-12 h-12 rounded-xl bg-[#1DB954]/10 flex items-center justify-center shrink-0">
              <SpotifyIcon size={26} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white">Spotify</p>
                {connected && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#1DB954]/15 text-[#1DB954]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1DB954]" />
                    Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-white/35 mt-0.5">
                {connected && spotifyProfile
                  ? `@${spotifyProfile.displayName}`
                  : "Share what you're listening to"}
              </p>
            </div>

            {connected ? (
              <button
                onClick={disconnectSpotify}
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-white/[0.08] text-white/40 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-all"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="shrink-0 text-xs font-semibold px-4 py-1.5 rounded-lg bg-[#1DB954] text-black hover:bg-[#1ed760] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>

          {/* Now playing preview if connected */}
          {connected && spotifyNowPlaying && (
            <div className="px-5 pb-5">
              <NowPlayingPreview track={spotifyNowPlaying} />
            </div>
          )}

          {connected && !spotifyNowPlaying && (
            <div className="px-5 pb-5">
              <p className="text-xs text-white/25 italic">Not playing anything right now</p>
            </div>
          )}

          {/* Error */}
          {(error || spotifyError) && (
            <div className="mx-5 mb-5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400">{error ?? spotifyError}</p>
            </div>
          )}

          {/* Info when not connected */}
          {!connected && (
            <div className="border-t border-white/[0.06] px-5 py-4">
              <p className="text-xs text-white/30">Connect your Spotify account to show what you're listening to in the sidebar.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Coming Soon ───────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">Coming Soon</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: "Apple Music", color: "#fc3c44", icon: "♫" },
            { name: "Steam", color: "#1b2838", border: "#4c6b8a", icon: "🎮" },
          ].map(({ name, color, icon, border }) => (
            <div key={name}
              className="flex items-center gap-3 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] opacity-40 cursor-not-allowed"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                style={{ background: `${color}22`, border: `1px solid ${border ?? color}44` }}
              >
                {icon}
              </div>
              <div>
                <p className="text-sm font-medium text-white">{name}</p>
                <p className="text-[11px] text-white/30">Coming soon</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes eq-bar {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}
