/**
 * IDS User public info routes:
 * GET /users/:id/keys     — fetch identity key + prekey bundle
 * GET /users/:id/devices  — list user's devices
 * GET /users/:id/profile  — public profile (bio, color, pronouns, status)
 * PUT /users/me/profile   — update own public profile
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { broadcastGlobal, broadcastGlobalWhere } from '../sse.js';
import {
  canAccessUserRelationshipData,
  normalizeUserId,
} from '../security/relationship-policy.js';
import { hitFixedWindowLimit } from '../security/rate-buckets.js';

export const usersRouter = Router();

const USER_KEYS_RATE_WINDOW_MS = Math.max(
  30_000,
  parseInt(process.env.IDS_USER_KEYS_RATE_WINDOW_MS ?? String(15 * 60 * 1000), 10) || (15 * 60 * 1000),
);
const USER_KEYS_RATE_REQUESTER_MAX = Math.max(
  1,
  parseInt(process.env.IDS_USER_KEYS_RATE_REQUESTER_MAX ?? '60', 10) || 60,
);
const USER_KEYS_RATE_PAIR_MAX = Math.max(
  1,
  parseInt(process.env.IDS_USER_KEYS_RATE_PAIR_MAX ?? '20', 10) || 20,
);
const USER_KEYS_RATE_PAIR_OPK_MAX = Math.max(
  1,
  parseInt(process.env.IDS_USER_KEYS_RATE_PAIR_OPK_MAX ?? '8', 10) || 8,
);
const USER_SEARCH_RATE_WINDOW_MS = Math.max(
  30_000,
  parseInt(process.env.IDS_USER_SEARCH_RATE_WINDOW_MS ?? String(60 * 1000), 10) || (60 * 1000),
);
const USER_SEARCH_RATE_REQUESTER_MAX = Math.max(
  1,
  parseInt(process.env.IDS_USER_SEARCH_RATE_REQUESTER_MAX ?? '30', 10) || 30,
);
const USER_SEARCH_MAX_RESULTS = 20;

const userKeysRequesterRateState = new Map();
const userKeysPairRateState = new Map();
const userSearchRateState = new Map();
const MAX_PROFILE_BIO_CHARS = 190;
const MAX_PROFILE_IMAGE_DATA_URL_CHARS = 512_000;
const PROFILE_IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
const GIPHY_GIF_URL_RE = /^https:\/\/[a-z0-9-]+\.giphy\.com\/.+\.gif(?:\?[a-z0-9._~%=&-]*)?$/i;
const SPOTIFY_ACTIVITY_RATE_WINDOW_MS = 60_000;
const SPOTIFY_ACTIVITY_RATE_MAX = 8;
const SPOTIFY_ACTIVITY_TTL_MS = 90_000;
const SPOTIFY_PAUSED_ACTIVITY_TTL_MS = 45_000;
const MAX_SPOTIFY_TRACK_ID_CHARS = 64;
const MAX_SPOTIFY_TITLE_CHARS = 200;
const MAX_SPOTIFY_ARTIST_CHARS = 160;
const MAX_SPOTIFY_ARTISTS = 8;
const MAX_SPOTIFY_ALBUM_CHARS = 200;
const MAX_SPOTIFY_URL_CHARS = 512;
const MAX_SPOTIFY_DURATION_MS = 43_200_000;
const spotifyActivityRateState = new Map();

function getProfileImageValidationError(value, fieldName, allowGiphyGif = false) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    return { error: `${fieldName} must be an image data URL`, code: 'invalid_profile_image' };
  }
  // Animated profile banners may use a Giphy media URL. The hostname and GIF
  // path are strictly constrained; arbitrary remote image URLs are not allowed.
  if (allowGiphyGif && GIPHY_GIF_URL_RE.test(value)) return null;
  if (value.length > MAX_PROFILE_IMAGE_DATA_URL_CHARS) {
    return { error: `${fieldName} is too large`, code: 'profile_image_too_large' };
  }
  if (!PROFILE_IMAGE_DATA_URL_RE.test(value)) {
    return { error: `${fieldName} must be a PNG, JPG, WebP, or GIF image`, code: 'invalid_profile_image' };
  }
  return null;
}

function getRequestIp(req) {
  return String(req.ip ?? req.socket?.remoteAddress ?? 'unknown').trim().toLowerCase() || 'unknown';
}

function getUserKeysPairLimit() {
  return process.env.IDS_ENABLE_OPK === '1'
    ? USER_KEYS_RATE_PAIR_OPK_MAX
    : USER_KEYS_RATE_PAIR_MAX;
}

function isUserKeysRateLimited(req, requesterUserId, targetUserId) {
  const requesterKey = `user-keys-requester:${normalizeUserId(requesterUserId).toLowerCase() || getRequestIp(req)}`;
  if (hitFixedWindowLimit(userKeysRequesterRateState, requesterKey, {
    limit: USER_KEYS_RATE_REQUESTER_MAX,
    windowMs: USER_KEYS_RATE_WINDOW_MS,
  })) {
    return true;
  }

  const pairKey = `user-keys-pair:${normalizeUserId(requesterUserId).toLowerCase()}->${normalizeUserId(targetUserId).toLowerCase()}`;
  return hitFixedWindowLimit(userKeysPairRateState, pairKey, {
    limit: getUserKeysPairLimit(),
    windowMs: USER_KEYS_RATE_WINDOW_MS,
  });
}

function isUserSearchRateLimited(req, requesterUserId) {
  const requesterKey = `user-search:${normalizeUserId(requesterUserId).toLowerCase() || getRequestIp(req)}`;
  return hitFixedWindowLimit(userSearchRateState, requesterKey, {
    limit: USER_SEARCH_RATE_REQUESTER_MAX,
    windowMs: USER_SEARCH_RATE_WINDOW_MS,
  });
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

// GET /users/search?q=... — authenticated, bounded lookup for adding friends.
// Display names are encrypted at rest, so discovery intentionally matches only
// the public username/user ID and returns no sensitive profile fields.
usersRouter.get('/search', requireAuth, (req, res) => {
  const query = String(req.query.q ?? '').trim();
  if (query.length < 2 || query.length > 64 || /[\u0000-\u001f\u007f]/.test(query)) {
    return res.status(400).json({ error: 'Use 2 to 64 valid characters', code: 'invalid_query' });
  }
  if (isUserSearchRateLimited(req, req.userId)) {
    return res.status(429).json({ error: 'rate_limited', code: 'rate_limited' });
  }

  try {
    const like = `${escapeLike(query)}%`;
    const users = req.db.prepare(`
      SELECT id, username, display_name
      FROM users
      WHERE (username LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\') AND id != ?
      ORDER BY CASE WHEN username = ? OR id = ? THEN 0 ELSE 1 END, username COLLATE NOCASE ASC
      LIMIT ?
    `).all(like, like, req.userId, query, query, USER_SEARCH_MAX_RESULTS).map(user => ({
      userId: user.id,
      username: user.username,
      displayName: req.secureFields.decodeUserField(user.id, 'display_name', user.display_name) || user.username || user.id,
    }));

    res.json({ users });
  } catch {
    console.error('[IDS_USER_SEARCH_FAILED]');
    res.status(500).json({ error: 'User lookup failed', code: 'internal' });
  }
});

function cleanSpotifyText(value, maxLength) {
  if (typeof value !== 'string') return null;
  if (/[\u0000-\u001f\u007f<>]/.test(value)) return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

function isSpotifyUrl(value, kind) {
  if (typeof value !== 'string' || value.length > MAX_SPOTIFY_URL_CHARS) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    if (kind === 'track') return parsed.hostname === 'open.spotify.com' && /^\/track\/[A-Za-z0-9]+$/.test(parsed.pathname);
    return parsed.hostname === 'i.scdn.co';
  } catch {
    return false;
  }
}

export function readPublicSpotifyActivity(db, userId) {
  const row = db.prepare(`
    SELECT track_id, title, artists_json, album, artwork_url, external_url,
      duration_ms, progress_ms, playback_started_at, is_playing, updated_at, expires_at
    FROM user_profile_activities
    WHERE user_id = ? AND provider = 'spotify'
  `).get(userId);
  if (!row) return null;

  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    db.prepare("DELETE FROM user_profile_activities WHERE user_id = ? AND provider = 'spotify'").run(userId);
    return null;
  }

  let artists = [];
  try {
    const parsed = JSON.parse(row.artists_json);
    artists = Array.isArray(parsed)
      ? parsed.map(value => cleanSpotifyText(value, MAX_SPOTIFY_ARTIST_CHARS)).filter(Boolean).slice(0, MAX_SPOTIFY_ARTISTS)
      : [];
  } catch {}
  if (!artists.length) return null;

  return {
    type: 'spotify',
    track_id: row.track_id,
    title: row.title,
    artists,
    album: row.album || '',
    artwork_url: row.artwork_url || null,
    external_url: row.external_url,
    duration_ms: row.duration_ms,
    progress_ms: row.progress_ms,
    playback_started_at: row.playback_started_at || null,
    is_playing: row.is_playing === 1,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
}

export function parseSpotifyActivityPayload(body) {
  if (!body || typeof body !== 'object') return null;
  const trackId = cleanSpotifyText(body.track_id, MAX_SPOTIFY_TRACK_ID_CHARS);
  const title = cleanSpotifyText(body.title, MAX_SPOTIFY_TITLE_CHARS);
  const album = body.album == null || body.album === '' ? '' : cleanSpotifyText(body.album, MAX_SPOTIFY_ALBUM_CHARS);
  const artists = Array.isArray(body.artists)
    ? body.artists.map(value => cleanSpotifyText(value, MAX_SPOTIFY_ARTIST_CHARS)).filter(Boolean).slice(0, MAX_SPOTIFY_ARTISTS)
    : [];
  const durationMs = Number(body.duration_ms);
  const progressMs = Number(body.progress_ms);
  const isPlaying = body.is_playing === true;
  const artworkUrl = body.artwork_url == null || body.artwork_url === '' ? null : body.artwork_url;
  const externalUrl = body.external_url;
  let playbackStartedAt = null;
  if (body.playback_started_at != null && body.playback_started_at !== '') {
    if (typeof body.playback_started_at !== 'string') return null;
    const parsedPlaybackStartedAt = Date.parse(body.playback_started_at);
    if (!Number.isFinite(parsedPlaybackStartedAt)) return null;
    playbackStartedAt = new Date(parsedPlaybackStartedAt).toISOString();
  }

  if (
    !trackId || !title || album === null || !artists.length || !isSpotifyUrl(externalUrl, 'track') ||
    (artworkUrl !== null && !isSpotifyUrl(artworkUrl, 'artwork')) ||
    !Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_SPOTIFY_DURATION_MS ||
    !Number.isInteger(progressMs) || progressMs < 0 || progressMs > durationMs
  ) return null;

  return {
    trackId,
    title,
    album,
    artists,
    durationMs,
    progressMs,
    isPlaying,
    artworkUrl,
    externalUrl,
    playbackStartedAt,
  };
}

// ── GET /users/:id/keys ──────────────────────────────────────────────────────
// :id can be a user_id or a username
usersRouter.get('/:id/keys', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const requesterUserId = normalizeUserId(req.userId);
    const id = req.params.id;

    // Try by user_id first, then by username
    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE username = ?').get(id);
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'not_found' });
    }

    const relationship = canAccessUserRelationshipData(db, requesterUserId, user.id, {
      allowSharedServer: true,
    });
    if (!relationship.ok) {
      return res.status(403).json({ error: 'forbidden', code: 'forbidden' });
    }

    if (isUserKeysRateLimited(req, requesterUserId, user.id)) {
      return res.status(429).json({ error: 'rate_limited', code: 'rate_limited' });
    }

    // Get a device's prekey bundle
    const device = db.prepare(
      'SELECT * FROM devices WHERE user_id = ? ORDER BY enrolled_at DESC LIMIT 1'
    ).get(user.id);

    if (!device) {
      return res.status(404).json({ error: 'No devices enrolled for this user', code: 'not_found' });
    }

    const spk = db.prepare('SELECT * FROM signed_prekeys WHERE device_id = ?').get(device.device_id);

    // NOTE: OPK (one-time prekeys) are currently disabled by default.
    // We publish OPK *public keys* to IDS, but the client does not yet persist
    // OPK *secrets* locally. If IDS hands out OPKs, session initiators derive
    // the X3DH shared key including DH4, but the responder cannot mirror DH4
    // without the OPK secret, causing first-message decrypt failures.
    //
    // Re-enable explicitly once OPK secret storage is implemented end-to-end.
    const enableOpk = process.env.IDS_ENABLE_OPK === '1';
    let opk = null;
    if (enableOpk) {
      // Consume one OPK (mark used after sending — one-time use)
      opk = db.prepare(
        'SELECT id, opk_pub FROM one_time_prekeys WHERE device_id = ? AND used = 0 LIMIT 1'
      ).get(device.device_id);

      if (opk) {
        db.prepare('UPDATE one_time_prekeys SET used = 1 WHERE id = ?').run(opk.id);
      }

      // Alert user if OPK supply is running low (< 10)
      const remaining = db.prepare(
        'SELECT COUNT(*) as count FROM one_time_prekeys WHERE device_id = ? AND used = 0'
      ).get(device.device_id);

      if (remaining.count < 10) {
        if (process.env.DEBUG_SECURITY === '1' || process.env.NODE_ENV !== 'production') {
          console.warn('[IDS_LOW_OPK_SUPPLY]');
        } else {
          console.warn('[IDS] Low OPK supply detected');
        }
      }
    }

    res.json({
      user_id: user.id,
      username: user.username,
      identity_pubkey: user.identity_pubkey,
      key_version: user.key_version,
      prekey_bundle: {
        ik_pub: user.identity_pubkey, // Ed25519 identity key — used to verify SPK signature
        spk_pub: spk ? spk.spk_pubkey : null,
        spk_sig: spk ? spk.spk_sig : null,
        opk_pub: opk ? opk.opk_pub : null,
      },
    });
  } catch (err) {
    console.error('[IDS_USER_KEYS_READ_FAILED]');
    res.status(500).json({ error: 'Failed to fetch keys', code: 'internal' });
  }
});

// ── GET /users/:id/devices ───────────────────────────────────────────────────
usersRouter.get('/:id/devices', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const id = req.params.id;

    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE username = ?').get(id);
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'not_found' });
    }

    const devices = db.prepare(
      'SELECT device_id, device_name, platform, device_pubkey, enrolled_at, last_seen_at FROM devices WHERE user_id = ?'
    ).all(user.id);

    res.json({
      user_id: user.id,
      devices: devices.map((d) => ({
        device_id: d.device_id,
        device_name: d.device_name,
        platform: d.platform,
        device_pubkey: d.device_pubkey,
        enrolled_at: d.enrolled_at,
        last_seen_at: d.last_seen_at,
      })),
    });
  } catch (err) {
    console.error('[IDS_USER_DEVICES_READ_FAILED]');
    res.status(500).json({ error: 'Failed to fetch devices', code: 'internal' });
  }
});

// ── GET /users/:id/profile ───────────────────────────────────────────────────
// Returns public profile fields (bio, color, pronouns, custom status).
// :id can be a user_id or username.
usersRouter.get('/:id/profile', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const id = req.params.id;
    let user = db.prepare('SELECT id, username, profile_bio, pronouns, custom_status, custom_status_expires_at, profile_color, avatar, banner, system_role FROM users WHERE id = ?').get(id);
    if (!user) user = db.prepare('SELECT id, username, profile_bio, pronouns, custom_status, custom_status_expires_at, profile_color, avatar, banner, system_role FROM users WHERE username = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found', code: 'not_found' });
    for (const fieldName of ['profile_bio', 'pronouns', 'custom_status', 'profile_color', 'avatar', 'banner']) {
      user[fieldName] = req.secureFields.decodeUserField(user.id, fieldName, user[fieldName]);
    }
    const selectedTags = db.prepare(`
      SELECT t.id, t.key, t.label, t.color_hex, uts.position
      FROM user_tag_selections uts
      JOIN app_tags t ON t.id = uts.tag_id
      WHERE uts.user_id = ?
      ORDER BY uts.position ASC
    `).all(user.id);

    const statusExpired = user.custom_status_expires_at && new Date(user.custom_status_expires_at).getTime() <= Date.now();
    if (statusExpired) {
      db.prepare('UPDATE users SET custom_status = NULL, custom_status_expires_at = NULL WHERE id = ?').run(user.id);
    }

    const activityRelationship = canAccessUserRelationshipData(db, req.userId, user.id, {
      allowSharedServer: true,
    });

    res.json({
      user_id: user.id,
      username: user.username,
      profile_bio: user.profile_bio ?? null,
      pronouns: user.pronouns ?? null,
      custom_status: statusExpired ? null : (user.custom_status ?? null),
      custom_status_expires_at: statusExpired ? null : (user.custom_status_expires_at ?? null),
      profile_color: user.profile_color ?? null,
      avatar: user.avatar ?? null,
      banner: user.banner ?? null,
      system_role: user.system_role ?? null,
      selected_tags: selectedTags,
      spotify_activity: activityRelationship.ok ? readPublicSpotifyActivity(db, user.id) : null,
    });
  } catch (err) {
    console.error('[IDS_USER_PROFILE_READ_FAILED]');
    res.status(500).json({ error: 'Failed to fetch profile', code: 'internal' });
  }
});

// ── PUT /users/me/activity/spotify ──────────────────────────────────────────
// Receives only a sanitized public snapshot. Spotify credentials never leave the
// desktop process, and the target user is always taken from the access token.
usersRouter.put('/me/activity/spotify', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const body = req.body ?? {};
    const rateKey = `spotify-activity:${normalizeUserId(req.userId).toLowerCase() || getRequestIp(req)}`;
    if (hitFixedWindowLimit(spotifyActivityRateState, rateKey, {
      limit: SPOTIFY_ACTIVITY_RATE_MAX,
      windowMs: SPOTIFY_ACTIVITY_RATE_WINDOW_MS,
    })) {
      res.set('Retry-After', String(Math.ceil(SPOTIFY_ACTIVITY_RATE_WINDOW_MS / 1000)));
      return res.status(429).json({ error: 'Too many activity updates', code: 'rate_limited' });
    }

    const activity = parseSpotifyActivityPayload(body);
    if (!activity) {
      return res.status(400).json({ error: 'Invalid Spotify activity', code: 'invalid_spotify_activity' });
    }

    const expiresAt = new Date(Date.now() + (activity.isPlaying ? SPOTIFY_ACTIVITY_TTL_MS : SPOTIFY_PAUSED_ACTIVITY_TTL_MS)).toISOString();
    db.prepare(`
      INSERT INTO user_profile_activities (
        user_id, provider, track_id, title, artists_json, album, artwork_url, external_url,
        duration_ms, progress_ms, playback_started_at, is_playing, updated_at, expires_at
      ) VALUES (?, 'spotify', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(user_id) DO UPDATE SET
        provider = excluded.provider,
        track_id = excluded.track_id,
        title = excluded.title,
        artists_json = excluded.artists_json,
        album = excluded.album,
        artwork_url = excluded.artwork_url,
        external_url = excluded.external_url,
        duration_ms = excluded.duration_ms,
        progress_ms = excluded.progress_ms,
        playback_started_at = excluded.playback_started_at,
        is_playing = excluded.is_playing,
        updated_at = datetime('now'),
        expires_at = excluded.expires_at
    `).run(
      req.userId, activity.trackId, activity.title, JSON.stringify(activity.artists), activity.album, activity.artworkUrl, activity.externalUrl,
      activity.durationMs, activity.progressMs, activity.playbackStartedAt, activity.isPlaying ? 1 : 0, expiresAt,
    );

    broadcastSpotifyActivityUpdate(db, req.userId);
    res.json({ activity: readPublicSpotifyActivity(db, req.userId) });
  } catch {
    res.status(500).json({ error: 'Failed to update Spotify activity', code: 'internal' });
  }
});

function broadcastSpotifyActivityUpdate(db, userId) {
  broadcastGlobalWhere('PROFILE_ACTIVITY_UPDATED', {
    user_id: userId,
    updated_at: new Date().toISOString(),
  }, viewerUserId => canAccessUserRelationshipData(db, viewerUserId, userId, {
    allowSharedServer: true,
  }).ok, userId);
}

// ── DELETE /users/me/activity/spotify ───────────────────────────────────────
usersRouter.delete('/me/activity/spotify', requireAuth, (req, res) => {
  try {
    req.db.prepare("DELETE FROM user_profile_activities WHERE user_id = ? AND provider = 'spotify'").run(req.userId);
    broadcastSpotifyActivityUpdate(req.db, req.userId);
    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'Failed to clear Spotify activity', code: 'internal' });
  }
});

const CUSTOM_STATUS_MAX_CHARS = 80;
const CUSTOM_STATUS_CLEAR_AFTER = new Set(['never', '30m', '1h', '4h', 'end_of_today']);

function statusExpiryFor(clearAfter) {
  const now = new Date();
  if (clearAfter === '30m') return new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  if (clearAfter === '1h') return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  if (clearAfter === '4h') return new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
  if (clearAfter === 'end_of_today') {
    now.setHours(23, 59, 59, 999);
    return now.toISOString();
  }
  return null;
}

// Dedicated custom-status save avoids accidentally replacing other public profile fields.
usersRouter.patch('/me/profile/status', requireAuth, (req, res) => {
  try {
    const { custom_status, clear_after = 'never' } = req.body ?? {};
    if (typeof custom_status !== 'string') {
      return res.status(400).json({ error: 'Custom status must be text', code: 'invalid_custom_status' });
    }
    if (!CUSTOM_STATUS_CLEAR_AFTER.has(clear_after)) {
      return res.status(400).json({ error: 'Invalid clear-after option', code: 'invalid_clear_after' });
    }

    const status = custom_status.trim();
    if (status.length > CUSTOM_STATUS_MAX_CHARS || /[\u0000-\u001f\u007f<>]/.test(status)) {
      return res.status(400).json({ error: 'Custom status contains invalid text', code: 'invalid_custom_status' });
    }

    const expiresAt = status ? statusExpiryFor(clear_after) : null;
    req.db.prepare(
      'UPDATE users SET custom_status = ?, custom_status_expires_at = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(req.secureFields.encodeUserField(req.userId, 'custom_status', status || null), expiresAt, req.userId);

    broadcastGlobal('PROFILE_UPDATED', { user_id: req.userId, updated_at: new Date().toISOString() }, req.userId);
    res.json({ custom_status: status || null, custom_status_expires_at: expiresAt });
  } catch (err) {
    console.error('[IDS_CUSTOM_STATUS_UPDATE_FAILED]');
    res.status(500).json({ error: 'Failed to update custom status', code: 'internal' });
  }
});

// ── PUT /users/me/profile ────────────────────────────────────────────────────
// Update the authenticated user's public profile fields.
usersRouter.put('/me/profile', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const { profile_bio, pronouns, custom_status, profile_color, avatar, banner } = req.body;
    if (typeof profile_bio === 'string' && profile_bio.length > MAX_PROFILE_BIO_CHARS) {
      return res.status(400).json({ error: 'Profile bio is too long', code: 'profile_bio_too_long' });
    }
    const avatarError = getProfileImageValidationError(avatar, 'Avatar');
    if (avatarError) {
      return res.status(400).json(avatarError);
    }
    const bannerError = getProfileImageValidationError(banner, 'Banner', true);
    if (bannerError) {
      return res.status(400).json(bannerError);
    }

    db.prepare(
      'UPDATE users SET profile_bio = ?, pronouns = ?, custom_status = ?, profile_color = ?, avatar = ?, banner = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(
      req.secureFields.encodeUserField(userId, 'profile_bio', profile_bio ?? null),
      req.secureFields.encodeUserField(userId, 'pronouns', pronouns ?? null),
      req.secureFields.encodeUserField(userId, 'custom_status', custom_status ?? null),
      req.secureFields.encodeUserField(userId, 'profile_color', profile_color ?? null),
      req.secureFields.encodeUserField(userId, 'avatar', avatar ?? null),
      req.secureFields.encodeUserField(userId, 'banner', banner ?? null),
      userId,
    );

    broadcastGlobal('PROFILE_UPDATED', {
      user_id: userId,
      updated_at: new Date().toISOString(),
    }, userId);

    res.json({ ok: true });
  } catch (err) {
    console.error('[IDS_USER_PROFILE_UPDATE_FAILED]');
    res.status(500).json({ error: 'Failed to update profile', code: 'internal' });
  }
});
