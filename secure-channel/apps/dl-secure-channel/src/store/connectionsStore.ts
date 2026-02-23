/**
 * connectionsStore — manages third-party service connections (Spotify, etc.)
 *
 * Spotify uses PKCE OAuth 2.0 — no client secret required.
 * The user registers their own Spotify app at https://developer.spotify.com/dashboard
 * and pastes the Client ID + adds http://localhost:5173/spotify-callback as redirect.
 */
import { create } from "zustand";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  albumName: string;
  albumArt: string | null;
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
}

export interface SpotifyProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

interface ConnectionsState {
  // ── Spotify ──────────────────────────────────────────────────────────────
  spotifyClientId: string;
  spotifyAccessToken: string | null;
  spotifyRefreshToken: string | null;
  spotifyTokenExpiry: number | null; // epoch ms
  spotifyProfile: SpotifyProfile | null;
  spotifyNowPlaying: SpotifyTrack | null;
  spotifyPolling: boolean;
  spotifyError: string | null;

  // ── Actions ──────────────────────────────────────────────────────────────
  setSpotifyClientId: (id: string) => void;
  setSpotifyTokens: (access: string, refresh: string, expiresIn: number) => void;
  setSpotifyProfile: (profile: SpotifyProfile | null) => void;
  setSpotifyNowPlaying: (track: SpotifyTrack | null) => void;
  setSpotifyPolling: (v: boolean) => void;
  setSpotifyError: (e: string | null) => void;
  disconnectSpotify: () => void;
  isSpotifyConnected: () => boolean;
}

// ── Persistence helpers ───────────────────────────────────────────────────────

function loadSpotify() {
  try {
    return {
      clientId: localStorage.getItem("spotify_client_id") ?? "",
      access: localStorage.getItem("spotify_access_token"),
      refresh: localStorage.getItem("spotify_refresh_token"),
      expiry: Number(localStorage.getItem("spotify_token_expiry")) || null,
    };
  } catch {
    return { clientId: "", access: null, refresh: null, expiry: null };
  }
}

function saveSpotify(access: string, refresh: string, expiry: number) {
  try {
    localStorage.setItem("spotify_access_token", access);
    localStorage.setItem("spotify_refresh_token", refresh);
    localStorage.setItem("spotify_token_expiry", String(expiry));
  } catch {}
}

function clearSpotify() {
  try {
    localStorage.removeItem("spotify_access_token");
    localStorage.removeItem("spotify_refresh_token");
    localStorage.removeItem("spotify_token_expiry");
  } catch {}
}

// ── Store ─────────────────────────────────────────────────────────────────────

const saved = loadSpotify();

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  spotifyClientId: saved.clientId,
  spotifyAccessToken: saved.access,
  spotifyRefreshToken: saved.refresh,
  spotifyTokenExpiry: saved.expiry,
  spotifyProfile: null,
  spotifyNowPlaying: null,
  spotifyPolling: false,
  spotifyError: null,

  setSpotifyClientId: (id) => {
    try { localStorage.setItem("spotify_client_id", id); } catch {}
    set({ spotifyClientId: id });
  },

  setSpotifyTokens: (access, refresh, expiresIn) => {
    const expiry = Date.now() + expiresIn * 1000;
    saveSpotify(access, refresh, expiry);
    set({ spotifyAccessToken: access, spotifyRefreshToken: refresh, spotifyTokenExpiry: expiry, spotifyError: null });
  },

  setSpotifyProfile: (profile) => set({ spotifyProfile: profile }),
  setSpotifyNowPlaying: (track) => set({ spotifyNowPlaying: track }),
  setSpotifyPolling: (v) => set({ spotifyPolling: v }),
  setSpotifyError: (e) => set({ spotifyError: e }),

  disconnectSpotify: () => {
    clearSpotify();
    set({
      spotifyAccessToken: null,
      spotifyRefreshToken: null,
      spotifyTokenExpiry: null,
      spotifyProfile: null,
      spotifyNowPlaying: null,
      spotifyPolling: false,
      spotifyError: null,
    });
  },

  isSpotifyConnected: () => {
    const s = get();
    return !!s.spotifyAccessToken && !!s.spotifyRefreshToken;
  },
}));

// ── PKCE Helpers ──────────────────────────────────────────────────────────────

function randomBase64url(len = 64): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256Base64url(plain: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const SPOTIFY_SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-private",
].join(" ");

export const SPOTIFY_REDIRECT_URI = "http://127.0.0.1:5173/spotify-callback";
export const SPOTIFY_CLIENT_ID = "859efaea731b4883895880f7ac68ed00";

/** Opens a popup to Spotify's authorize page using PKCE. */
export async function startSpotifyAuth(clientId: string = SPOTIFY_CLIENT_ID): Promise<void> {
  const verifier = randomBase64url(64);
  const challenge = await sha256Base64url(verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES,
    show_dialog: "false",
  });

  const url = `https://accounts.spotify.com/authorize?${params}`;

  // Pass PKCE verifier via window.name — survives the Spotify redirect across origins
  const windowName = JSON.stringify({ verifier, clientId });

  // Open as popup — 500×700 centered
  const left = Math.round(window.screenX + (window.outerWidth - 500) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - 700) / 2);
  window.open(url, windowName, `width=500,height=700,left=${left},top=${top}`);
}

/** Exchanges auth code → tokens using PKCE verifier. */
export async function exchangeSpotifyCode(
  code: string,
  clientId: string,
  verifier: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }
  return res.json();
}

/** Refreshes a Spotify access token. */
export async function refreshSpotifyToken(
  refreshToken: string,
  clientId: string
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) throw new Error("Refresh failed");
  return res.json();
}

/** Fetches the Spotify user profile. */
export async function fetchSpotifyProfile(accessToken: string): Promise<SpotifyProfile> {
  const res = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Profile fetch failed");
  const data = await res.json();
  return {
    id: data.id,
    displayName: data.display_name ?? data.id,
    avatarUrl: data.images?.[0]?.url ?? null,
  };
}

/** Fetches currently playing track. Returns null if nothing playing. */
export async function fetchNowPlaying(accessToken: string): Promise<SpotifyTrack | null> {
  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 204 || res.status === 404) return null; // nothing playing
  if (!res.ok) throw new Error(`Now playing fetch failed: ${res.status}`);
  const data = await res.json();
  if (!data?.item) return null;

  const item = data.item;
  return {
    id: item.id,
    name: item.name,
    artists: item.artists?.map((a: { name: string }) => a.name) ?? [],
    albumName: item.album?.name ?? "",
    albumArt: item.album?.images?.[0]?.url ?? null,
    durationMs: item.duration_ms ?? 0,
    progressMs: data.progress_ms ?? 0,
    isPlaying: data.is_playing ?? false,
  };
}
