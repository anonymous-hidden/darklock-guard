import { app, BrowserWindow, safeStorage, shell } from 'electron';
import { isApprovedExternalUrl } from './desktopSecurity.js';
import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_CURRENTLY_PLAYING_URL = 'https://api.spotify.com/v1/me/player/currently-playing';
const SPOTIFY_SCOPES = 'user-read-currently-playing';
const CALLBACK_PATH = '/spotify/callback';
const MAX_RESPONSE_BYTES = 512 * 1024;
const OAUTH_ATTEMPT_TIMEOUT_MS = 5 * 60_000;

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

export type SpotifyPollResult =
  | { kind: 'activity'; activity: SpotifyActivity }
  | { kind: 'idle' }
  | { kind: 'error'; code: 'not_connected' | 'not_configured' | 'permission_revoked' | 'rate_limited' | 'temporarily_unavailable' | 'authorization_revoked'; retryAfterMs?: number };

interface StoredSpotifyCredentials {
  refreshToken: string;
  sharingEnabled: boolean;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export type SpotifyConnectionState =
  | { phase: 'idle' | 'pending' | 'success' }
  | { phase: 'error'; code: string };

interface PendingSpotifyAuthorization {
  authUrl: string;
  completion: Promise<string>;
  cancel: (code: string) => void;
  parent: BrowserWindow | null;
}

let pendingSpotifyAuthorization: PendingSpotifyAuthorization | null = null;
let spotifyConnectionState: SpotifyConnectionState = { phase: 'idle' };

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function configuredValue(name: string): string {
  const directValue = String(process.env[name] ?? '').trim();
  if (directValue) return directValue;
  try {
    const match = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8')
      .split(/\r?\n/)
      .map(entry => entry.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`)))
      .find(Boolean);
    if (!match) return '';
    const value = match[1].trim();
    return value.replace(/^(["'])(.*)\1$/, '$2').trim();
  } catch {
    return '';
  }
}

function redirectPort(): number {
  const configured = Number.parseInt(configuredValue('SPOTIFY_REDIRECT_PORT') || '8888', 10);
  return Number.isInteger(configured) && configured >= 1024 && configured <= 65535 ? configured : 8888;
}

function redirectUri(): string {
  return `http://127.0.0.1:${redirectPort()}${CALLBACK_PATH}`;
}

function spotifyClientId(): string {
  return configuredValue('SPOTIFY_CLIENT_ID');
}

function credentialsPath(): string {
  return path.join(app.getPath('userData'), 'spotify-credentials.bin');
}

function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // Electron can report a Linux fallback backend named "basic_text". Refuse to
  // persist a refresh token unless a real system credential backend is selected.
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

function readCredentials(): StoredSpotifyCredentials | null {
  const file = credentialsPath();
  if (!fs.existsSync(file) || !secureStorageAvailable()) return null;
  try {
    const plaintext = safeStorage.decryptString(Buffer.from(fs.readFileSync(file, 'utf8'), 'base64'));
    const parsed = JSON.parse(plaintext) as Partial<StoredSpotifyCredentials>;
    if (typeof parsed.refreshToken !== 'string' || parsed.refreshToken.length < 16) return null;
    return { refreshToken: parsed.refreshToken, sharingEnabled: parsed.sharingEnabled === true };
  } catch {
    return null;
  }
}

function writeCredentials(credentials: StoredSpotifyCredentials): void {
  if (!secureStorageAvailable()) throw new Error('secure_storage_unavailable');
  const encrypted = safeStorage.encryptString(JSON.stringify(credentials)).toString('base64');
  fs.mkdirSync(path.dirname(credentialsPath()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(credentialsPath(), encrypted, { encoding: 'utf8', mode: 0o600 });
}

function clearCredentials(): void {
  tokenCache = null;
  try { fs.rmSync(credentialsPath(), { force: true }); } catch {}
}

function requestJson(url: string, options: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      path: target.pathname + target.search,
      method: options.method ?? 'GET',
      headers: options.headers,
      timeout: 15_000,
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        raw += chunk;
        if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) response.destroy(new Error('spotify_response_too_large'));
      });
      response.on('end', () => {
        let body: unknown = null;
        try { body = raw ? JSON.parse(raw) : null; } catch {}
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body });
      });
    });
    request.on('timeout', () => request.destroy(new Error('spotify_timeout')));
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function tokenRequest(params: URLSearchParams): Promise<{ status: number; body: Record<string, unknown> | null }> {
  return requestJson(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(Buffer.byteLength(params.toString())) },
    body: params.toString(),
  }).then(({ status, body }) => ({ status, body: body && typeof body === 'object' ? body as Record<string, unknown> : null }));
}

async function refreshAccessToken(credentials: StoredSpotifyCredentials): Promise<TokenCache> {
  const clientId = spotifyClientId();
  if (!clientId) throw new Error('spotify_not_configured');
  const response = await tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: credentials.refreshToken,
    client_id: clientId,
  }));
  if (response.status === 400 || response.status === 401) {
    clearCredentials();
    throw new Error('spotify_authorization_revoked');
  }
  const accessToken = typeof response.body?.access_token === 'string' ? response.body.access_token : '';
  const expiresIn = typeof response.body?.expires_in === 'number' ? response.body.expires_in : 0;
  if (response.status !== 200 || !accessToken || expiresIn <= 0) throw new Error('spotify_refresh_failed');

  const nextRefreshToken = typeof response.body?.refresh_token === 'string'
    ? response.body.refresh_token
    : credentials.refreshToken;
  if (nextRefreshToken !== credentials.refreshToken) writeCredentials({ ...credentials, refreshToken: nextRefreshToken });
  tokenCache = { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  return tokenCache;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.accessToken;
  const credentials = readCredentials();
  if (!credentials) throw new Error('spotify_not_connected');
  return (await refreshAccessToken(credentials)).accessToken;
}

function isSpotifyTrackUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname === 'open.spotify.com' && /^\/track\/[A-Za-z0-9]+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function spotifyArtworkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname === 'i.scdn.co' ? value : null;
  } catch {
    return null;
  }
}

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength) : '';
}

function parseCurrentTrack(payload: unknown): SpotifyActivity | null {
  if (!payload || typeof payload !== 'object') return null;
  const response = payload as Record<string, unknown>;
  if (response.currently_playing_type !== 'track') return null;
  const item = response.item;
  if (!item || typeof item !== 'object') return null;
  const track = item as Record<string, unknown>;
  const trackId = text(track.id, 64);
  const title = text(track.name, 200);
  const external = track.external_urls && typeof track.external_urls === 'object'
    ? (track.external_urls as Record<string, unknown>).spotify
    : null;
  const duration = Number(track.duration_ms);
  const progress = Math.max(0, Number(response.progress_ms) || 0);
  if (!trackId || !title || !isSpotifyTrackUrl(external) || !Number.isFinite(duration) || duration < 1 || duration > 43_200_000 || progress > duration) return null;
  const album = track.album && typeof track.album === 'object' ? track.album as Record<string, unknown> : {};
  const images = Array.isArray(album.images) ? album.images : [];
  const artwork = images.map((image) => image && typeof image === 'object' ? spotifyArtworkUrl((image as Record<string, unknown>).url) : null).find(Boolean) ?? null;
  const artists = Array.isArray(track.artists)
    ? track.artists.map((artist) => artist && typeof artist === 'object' ? text((artist as Record<string, unknown>).name, 160) : '').filter(Boolean).slice(0, 8)
    : [];
  if (!artists.length) return null;
  const isPlaying = response.is_playing === true;
  return {
    type: 'spotify',
    track_id: trackId,
    title,
    artists,
    album: text(album.name, 200),
    artwork_url: artwork,
    external_url: external,
    duration_ms: Math.floor(duration),
    progress_ms: Math.floor(progress),
    playback_started_at: isPlaying ? new Date(Date.now() - progress).toISOString() : null,
    is_playing: isPlaying,
    sampled_at: Date.now(),
  };
}

function callbackPage(success: boolean): string {
  const title = success ? 'Spotify connected' : 'Spotify connection was not completed';
  const body = success
    ? 'You can return to Ridgeline now.'
    : 'You can close this tab and return to Ridgeline.';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#0f1118;color:#edf3ee;font:16px system-ui,-apple-system,"Segoe UI",sans-serif}main{min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(360px,100%);padding:28px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:#171a1f;box-shadow:0 18px 48px rgba(0,0,0,.32)}.mark{width:12px;height:12px;border-radius:999px;background:#1db954;box-shadow:0 0 0 6px rgba(29,185,84,.12)}h1{margin:18px 0 8px;font-size:20px}p{margin:0;color:#aeb8b0;line-height:1.5}</style></head><body><main><section class="card"><span class="mark"></span><h1>${title}</h1><p>${body}</p></section></main></body></html>`;
}

function startLoopbackAuthorization(parent: BrowserWindow | null, authUrl: string, state: string, callbackUrl: string): Promise<PendingSpotifyAuthorization> {
  return new Promise((resolve, reject) => {
    const callback = new URL(callbackUrl);
    let complete = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let settleCompletion: ((code: string) => void) | null = null;
    let rejectCompletion: ((error: Error) => void) | null = null;
    const completion = new Promise<string>((resolveCode, rejectCode) => {
      settleCompletion = resolveCode;
      rejectCompletion = rejectCode;
    });
    const finish = (handler: () => void) => {
      if (complete) return;
      complete = true;
      if (timeout) clearTimeout(timeout);
      server.close();
      handler();
    };
    const pending: PendingSpotifyAuthorization = {
      authUrl,
      completion,
      parent,
      cancel: (code) => finish(() => rejectCompletion?.(new Error(code))),
    };
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', callbackUrl);
      if (request.method !== 'GET' || requestUrl.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('Not found');
        return;
      }
      try {
        if (requestUrl.searchParams.get('state') !== state) throw new Error('invalid_state');
        const oauthError = requestUrl.searchParams.get('error');
        const code = requestUrl.searchParams.get('code');
        if (oauthError) throw new Error(oauthError === 'access_denied' ? 'authorization_cancelled' : 'authorization_denied');
        if (!code || code.length > 2048) throw new Error('invalid_callback');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
        response.end(callbackPage(true));
        finish(() => settleCompletion?.(code));
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
        response.end(callbackPage(false));
        finish(() => rejectCompletion?.(error instanceof Error ? error : new Error('authorization_failed')));
      }
    });
    server.once('error', () => reject(new Error('spotify_callback_unavailable')));
    server.listen(Number(callback.port), '127.0.0.1', () => {
      pendingSpotifyAuthorization = pending;
      timeout = setTimeout(() => pending.cancel('spotify_connection_timed_out'), OAUTH_ATTEMPT_TIMEOUT_MS);
      resolve(pending);
    });
  });
}

function connectionErrorCode(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'authorization_failed';
}

async function completeSpotifyAuthorization(pending: PendingSpotifyAuthorization, clientId: string, verifier: string, callbackUrl: string): Promise<void> {
  try {
    const code = await pending.completion;
    const token = await tokenRequest(new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
      code_verifier: verifier,
    }));
    const refreshToken = typeof token.body?.refresh_token === 'string' ? token.body.refresh_token : '';
    const accessToken = typeof token.body?.access_token === 'string' ? token.body.access_token : '';
    const expiresIn = typeof token.body?.expires_in === 'number' ? token.body.expires_in : 0;
    if (token.status !== 200 || !refreshToken || !accessToken || expiresIn <= 0) throw new Error('token_exchange_failed');
    writeCredentials({ refreshToken, sharingEnabled: false });
    tokenCache = { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
    spotifyConnectionState = { phase: 'success' };
    if (pending.parent && !pending.parent.isDestroyed()) {
      pending.parent.show();
      pending.parent.focus();
    }
  } catch (error) {
    spotifyConnectionState = { phase: 'error', code: connectionErrorCode(error) };
  } finally {
    if (pendingSpotifyAuthorization === pending) pendingSpotifyAuthorization = null;
  }
}

export async function connectSpotify(parent: BrowserWindow | null): Promise<{ pending: true }> {
  if (pendingSpotifyAuthorization) throw new Error('spotify_connection_pending');
  const clientId = spotifyClientId();
  if (!clientId) throw new Error('spotify_not_configured');
  if (!secureStorageAvailable()) throw new Error('secure_storage_unavailable');
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const callbackUrl = redirectUri();
  const authUrl = new URL(SPOTIFY_AUTHORIZE_URL);
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: callbackUrl,
    scope: SPOTIFY_SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  }).toString();
  spotifyConnectionState = { phase: 'pending' };
  let pending: PendingSpotifyAuthorization;
  try {
    pending = await startLoopbackAuthorization(parent, authUrl.toString(), state, callbackUrl);
  } catch (error) {
    spotifyConnectionState = { phase: 'error', code: connectionErrorCode(error) };
    throw error;
  }
  try {
    if (!isApprovedExternalUrl(pending.authUrl)) throw new Error('unapproved_external_url');
    await shell.openExternal(pending.authUrl);
  } catch {
    pending.cancel('browser_unavailable');
    spotifyConnectionState = { phase: 'error', code: 'browser_unavailable' };
    throw new Error('browser_unavailable');
  }
  void completeSpotifyAuthorization(pending, clientId, verifier, callbackUrl);
  return { pending: true };
}

export function getSpotifyConnectionState(): SpotifyConnectionState {
  return spotifyConnectionState;
}

export async function reopenSpotifyAuthorization(): Promise<void> {
  if (!pendingSpotifyAuthorization) throw new Error('spotify_connection_not_pending');
  try {
    if (!isApprovedExternalUrl(pendingSpotifyAuthorization.authUrl)) throw new Error('unapproved_external_url');
    await shell.openExternal(pendingSpotifyAuthorization.authUrl);
  } catch {
    throw new Error('browser_unavailable');
  }
}

export function cancelSpotifyConnection(): void {
  pendingSpotifyAuthorization?.cancel('authorization_cancelled');
}

export function getSpotifyStatus(): { connected: boolean; sharingEnabled: boolean; configured: boolean } {
  const credentials = readCredentials();
  return { connected: !!credentials, sharingEnabled: credentials?.sharingEnabled === true, configured: !!spotifyClientId() };
}

export function setSpotifySharing(sharingEnabled: boolean): { connected: boolean; sharingEnabled: boolean } {
  const credentials = readCredentials();
  if (!credentials) throw new Error('spotify_not_connected');
  writeCredentials({ ...credentials, sharingEnabled: Boolean(sharingEnabled) });
  return { connected: true, sharingEnabled: Boolean(sharingEnabled) };
}

export function disconnectSpotify(): void {
  cancelSpotifyConnection();
  spotifyConnectionState = { phase: 'idle' };
  clearCredentials();
}

export async function getSpotifyCurrentActivity(): Promise<SpotifyPollResult> {
  if (!spotifyClientId()) return { kind: 'error', code: 'not_configured' };
  if (!readCredentials()) return { kind: 'error', code: 'not_connected' };
  let token: string;
  try { token = await getAccessToken(); }
  catch (error) {
    return { kind: 'error', code: error instanceof Error && error.message === 'spotify_authorization_revoked' ? 'authorization_revoked' : 'temporarily_unavailable' };
  }
  let response: { status: number; headers: http.IncomingHttpHeaders; body: unknown };
  try {
    response = await requestJson(SPOTIFY_CURRENTLY_PLAYING_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) {
      token = await getAccessToken(true);
      response = await requestJson(SPOTIFY_CURRENTLY_PLAYING_URL, { headers: { Authorization: `Bearer ${token}` } });
    }
  } catch (error) {
    return {
      kind: 'error',
      code: error instanceof Error && error.message === 'spotify_authorization_revoked'
        ? 'authorization_revoked'
        : 'temporarily_unavailable',
    };
  }
  if (response.status === 204 || response.status === 404) return { kind: 'idle' };
  if (response.status === 401) return { kind: 'error', code: 'authorization_revoked' };
  if (response.status === 403) return { kind: 'error', code: 'permission_revoked' };
  if (response.status === 429) {
    const seconds = Number.parseInt(String(response.headers['retry-after'] ?? ''), 10);
    return { kind: 'error', code: 'rate_limited', retryAfterMs: Number.isFinite(seconds) ? Math.max(1, seconds) * 1000 : 60_000 };
  }
  if (response.status !== 200) return { kind: 'error', code: 'temporarily_unavailable' };
  const activity = parseCurrentTrack(response.body);
  return activity ? { kind: 'activity', activity } : { kind: 'idle' };
}

export async function openSpotifyTrack(url: string): Promise<void> {
  if (!isSpotifyTrackUrl(url) || !isApprovedExternalUrl(url)) throw new Error('invalid_spotify_url');
  await shell.openExternal(url);
}
