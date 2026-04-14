"""
Nova — Spotify Integration
============================
Full Spotify Web API control: playback, search, queue, playlists, and
"now playing" context for the system prompt.

OAuth 2.0 Authorization Code flow with automatic token refresh.
Tokens stored locally in data/spotify_tokens.json.
"""

import json
import time
import threading
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

import httpx

# Spotify API endpoints
AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"

# Scopes needed for full playback control
SCOPES = " ".join([
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "user-read-recently-played",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
    "user-top-read",
])

TOKEN_FILE = Path(__file__).parent.parent / "data" / "spotify_tokens.json"


@dataclass
class NowPlaying:
    """Current playback snapshot."""
    is_playing: bool = False
    track: str = ""
    artist: str = ""
    album: str = ""
    progress_ms: int = 0
    duration_ms: int = 0
    device: str = ""
    shuffle: bool = False
    repeat: str = "off"
    volume: int | None = None

    def summary(self) -> str:
        if not self.track:
            return "Nothing playing."
        state = "Playing" if self.is_playing else "Paused"
        prog = f"{self.progress_ms // 60000}:{(self.progress_ms // 1000) % 60:02d}"
        dur = f"{self.duration_ms // 60000}:{(self.duration_ms // 1000) % 60:02d}"
        parts = [f"{state}: \"{self.track}\" by {self.artist}"]
        if self.album:
            parts.append(f"Album: {self.album}")
        parts.append(f"[{prog}/{dur}]")
        if self.device:
            parts.append(f"on {self.device}")
        return " — ".join(parts)


class SpotifyClient:
    """Spotify Web API client with OAuth token management."""

    def __init__(self, client_id: str, client_secret: str, redirect_uri: str):
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._expires_at: float = 0
        self._load_tokens()

    @property
    def is_authenticated(self) -> bool:
        return self._refresh_token is not None

    @property
    def needs_refresh(self) -> bool:
        return time.time() >= self._expires_at - 60

    # ── OAuth Flow ─────────────────────────────────────

    def get_auth_url(self) -> str:
        """Generate the Spotify authorization URL for the user to visit."""
        params = {
            "client_id": self._client_id,
            "response_type": "code",
            "redirect_uri": self._redirect_uri,
            "scope": SCOPES,
            "show_dialog": "false",
        }
        return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"

    async def exchange_code(self, code: str) -> bool:
        """Exchange authorization code for access + refresh tokens."""
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(TOKEN_URL, data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self._redirect_uri,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            })
            if resp.status_code != 200:
                return False
            data = resp.json()
            self._access_token = data["access_token"]
            self._refresh_token = data.get("refresh_token", self._refresh_token)
            self._expires_at = time.time() + data.get("expires_in", 3600)
            self._save_tokens()
            return True

    async def _refresh_access_token(self):
        """Refresh the access token using the stored refresh token."""
        if not self._refresh_token:
            return
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(TOKEN_URL, data={
                "grant_type": "refresh_token",
                "refresh_token": self._refresh_token,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            })
            if resp.status_code == 200:
                data = resp.json()
                self._access_token = data["access_token"]
                if "refresh_token" in data:
                    self._refresh_token = data["refresh_token"]
                self._expires_at = time.time() + data.get("expires_in", 3600)
                self._save_tokens()

    async def _ensure_token(self):
        """Auto-refresh token if expired."""
        if self.needs_refresh and self._refresh_token:
            await self._refresh_access_token()

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._access_token}"}

    def _save_tokens(self):
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(json.dumps({
            "access_token": self._access_token,
            "refresh_token": self._refresh_token,
            "expires_at": self._expires_at,
        }))

    def _load_tokens(self):
        if TOKEN_FILE.exists():
            try:
                data = json.loads(TOKEN_FILE.read_text())
                self._access_token = data.get("access_token")
                self._refresh_token = data.get("refresh_token")
                self._expires_at = data.get("expires_at", 0)
            except (json.JSONDecodeError, KeyError):
                pass

    # ── API Helpers ────────────────────────────────────

    async def _get(self, path: str, params: dict | None = None) -> dict | None:
        await self._ensure_token()
        if not self._access_token:
            return None
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{API_BASE}{path}", headers=self._headers(), params=params,
            )
            if resp.status_code == 401:
                await self._refresh_access_token()
                resp = await client.get(
                    f"{API_BASE}{path}", headers=self._headers(), params=params,
                )
            if resp.status_code == 204:
                return {}
            return resp.json() if resp.status_code == 200 else None

    async def _put(self, path: str, json_data: dict | None = None) -> bool:
        await self._ensure_token()
        if not self._access_token:
            return False
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.put(
                f"{API_BASE}{path}", headers=self._headers(), json=json_data,
            )
            if resp.status_code == 401:
                await self._refresh_access_token()
                resp = await client.put(
                    f"{API_BASE}{path}", headers=self._headers(), json=json_data,
                )
            return resp.status_code in (200, 204)

    async def _post(self, path: str, json_data: dict | None = None) -> dict | bool:
        await self._ensure_token()
        if not self._access_token:
            return False
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{API_BASE}{path}", headers=self._headers(), json=json_data,
            )
            if resp.status_code == 401:
                await self._refresh_access_token()
                resp = await client.post(
                    f"{API_BASE}{path}", headers=self._headers(), json=json_data,
                )
            if resp.status_code in (200, 201):
                try:
                    return resp.json()
                except Exception:
                    return True
            return resp.status_code == 204

    # ── Playback Control ───────────────────────────────

    async def get_playback(self) -> NowPlaying:
        """Get current playback state."""
        data = await self._get("/me/player")
        if not data or "item" not in data:
            return NowPlaying()
        item = data["item"]
        device = data.get("device", {})
        return NowPlaying(
            is_playing=data.get("is_playing", False),
            track=item.get("name", "Unknown"),
            artist=", ".join(a["name"] for a in item.get("artists", [])),
            album=item.get("album", {}).get("name", ""),
            progress_ms=data.get("progress_ms", 0),
            duration_ms=item.get("duration_ms", 0),
            device=device.get("name", ""),
            shuffle=data.get("shuffle_state", False),
            repeat=data.get("repeat_state", "off"),
            volume=device.get("volume_percent"),
        )

    async def play(self, device_id: str | None = None) -> str:
        """Resume playback."""
        path = "/me/player/play"
        if device_id:
            path += f"?device_id={device_id}"
        ok = await self._put(path)
        return "Playback resumed." if ok else "Failed to resume — is Spotify open?"

    async def pause(self) -> str:
        """Pause playback."""
        ok = await self._put("/me/player/pause")
        return "Paused." if ok else "Failed to pause — nothing playing?"

    async def next_track(self) -> str:
        ok = await self._post("/me/player/next")
        return "Skipped to next track." if ok else "Failed to skip."

    async def prev_track(self) -> str:
        ok = await self._post("/me/player/previous")
        return "Back to previous track." if ok else "Failed to go back."

    async def set_volume(self, percent: int) -> str:
        percent = max(0, min(100, percent))
        ok = await self._put(f"/me/player/volume?volume_percent={percent}")
        return f"Spotify volume set to {percent}%." if ok else "Failed to set volume."

    async def set_shuffle(self, state: bool) -> str:
        ok = await self._put(f"/me/player/shuffle?state={'true' if state else 'false'}")
        return f"Shuffle {'on' if state else 'off'}." if ok else "Failed to toggle shuffle."

    async def set_repeat(self, state: str = "track") -> str:
        """state: 'track', 'context', or 'off'"""
        ok = await self._put(f"/me/player/repeat?state={state}")
        return f"Repeat: {state}." if ok else "Failed to set repeat."

    async def seek(self, position_ms: int) -> str:
        ok = await self._put(f"/me/player/seek?position_ms={position_ms}")
        if ok:
            secs = position_ms // 1000
            return f"Seeked to {secs // 60}:{secs % 60:02d}."
        return "Failed to seek."

    async def get_devices(self) -> list[dict]:
        data = await self._get("/me/player/devices")
        if not data:
            return []
        return [
            {"id": d["id"], "name": d["name"], "type": d["type"], "active": d["is_active"]}
            for d in data.get("devices", [])
        ]

    async def transfer_playback(self, device_id: str) -> str:
        ok = await self._put("/me/player", {"device_ids": [device_id], "play": True})
        return "Transferred playback." if ok else "Failed to transfer."

    # ── Search & Play ──────────────────────────────────

    async def search(self, query: str, types: str = "track", limit: int = 5) -> list[dict]:
        """Search Spotify. types: track, artist, album, playlist (comma-separated)."""
        data = await self._get("/search", {"q": query, "type": types, "limit": limit})
        if not data:
            return []
        results = []
        for t in types.split(","):
            t = t.strip()
            key = f"{t}s"
            for item in data.get(key, {}).get("items", []):
                entry = {"type": t, "name": item["name"], "uri": item["uri"]}
                if t == "track":
                    entry["artist"] = ", ".join(a["name"] for a in item.get("artists", []))
                    entry["album"] = item.get("album", {}).get("name", "")
                elif t == "artist":
                    entry["genres"] = item.get("genres", [])[:3]
                results.append(entry)
        return results

    async def play_track(self, query: str) -> str:
        """Search for a track and play it immediately."""
        results = await self.search(query, "track", 1)
        if not results:
            return f"No tracks found for \"{query}\"."
        track = results[0]
        ok = await self._put("/me/player/play", {"uris": [track["uri"]]})
        if ok:
            return f"Playing \"{track['name']}\" by {track['artist']}."
        return f"Found \"{track['name']}\" but couldn't start playback — is Spotify open on a device?"

    async def play_artist(self, query: str) -> str:
        """Search for an artist and play their top songs."""
        results = await self.search(query, "artist", 1)
        if not results:
            return f"No artist found for \"{query}\"."
        artist = results[0]
        ok = await self._put("/me/player/play", {"context_uri": artist["uri"]})
        if ok:
            return f"Playing {artist['name']}."
        return f"Found {artist['name']} but couldn't start playback — is Spotify open?"

    async def play_album(self, query: str) -> str:
        """Search for an album and play it."""
        results = await self.search(query, "album", 1)
        if not results:
            return f"No album found for \"{query}\"."
        album = results[0]
        ok = await self._put("/me/player/play", {"context_uri": album["uri"]})
        if ok:
            return f"Playing album \"{album['name']}\"."
        return f"Found \"{album['name']}\" but couldn't start playback."

    async def play_playlist(self, query: str) -> str:
        """Search for a playlist and play it."""
        results = await self.search(query, "playlist", 1)
        if not results:
            return f"No playlist found for \"{query}\"."
        pl = results[0]
        ok = await self._put("/me/player/play", {"context_uri": pl["uri"]})
        if ok:
            return f"Playing playlist \"{pl['name']}\"."
        return f"Found \"{pl['name']}\" but couldn't start playback."

    async def queue_track(self, query: str) -> str:
        """Search for a track and add it to the queue."""
        results = await self.search(query, "track", 1)
        if not results:
            return f"No track found for \"{query}\"."
        track = results[0]
        ok = await self._post(f"/me/player/queue?uri={track['uri']}")
        if ok:
            return f"Added \"{track['name']}\" by {track['artist']} to your queue."
        return "Failed to add to queue."

    async def get_queue(self) -> str:
        """Get the current playback queue."""
        data = await self._get("/me/player/queue")
        if not data:
            return "Couldn't fetch queue."
        currently = data.get("currently_playing")
        queue = data.get("queue", [])[:10]
        lines = []
        if currently:
            artists = ", ".join(a["name"] for a in currently.get("artists", []))
            lines.append(f"Now: \"{currently['name']}\" by {artists}")
        if queue:
            lines.append("Up next:")
            for i, item in enumerate(queue, 1):
                artists = ", ".join(a["name"] for a in item.get("artists", []))
                lines.append(f"  {i}. \"{item['name']}\" by {artists}")
        return "\n".join(lines) if lines else "Queue is empty."

    async def get_recently_played(self, limit: int = 5) -> str:
        data = await self._get("/me/player/recently-played", {"limit": limit})
        if not data:
            return "Couldn't fetch history."
        lines = ["Recently played:"]
        for item in data.get("items", []):
            track = item["track"]
            artists = ", ".join(a["name"] for a in track.get("artists", []))
            lines.append(f"  • \"{track['name']}\" by {artists}")
        return "\n".join(lines)


class SpotifyContextProvider:
    """Maintains a cached 'now playing' snapshot for the system prompt.
    
    Refreshes every 30 seconds in a background daemon thread.
    """

    def __init__(self, client: SpotifyClient):
        self._client = client
        self._now_playing: NowPlaying = NowPlaying()
        self._lock = threading.Lock()
        self._running = False

    def start(self):
        if self._running:
            return
        self._running = True
        t = threading.Thread(target=self._refresh_loop, daemon=True)
        t.start()

    def _refresh_loop(self):
        import asyncio
        loop = asyncio.new_event_loop()
        while self._running:
            try:
                if self._client.is_authenticated:
                    np = loop.run_until_complete(self._client.get_playback())
                    with self._lock:
                        self._now_playing = np
            except Exception:
                pass
            import time as _time
            _time.sleep(30)

    @property
    def now_playing(self) -> NowPlaying:
        with self._lock:
            return self._now_playing

    def get_prompt_context(self) -> str:
        """Return Spotify context string for injection into the system prompt."""
        if not self._client.is_authenticated:
            return ""
        np = self.now_playing
        if not np.track:
            return ""
        return f"## Spotify — Now Playing\n{np.summary()}"
