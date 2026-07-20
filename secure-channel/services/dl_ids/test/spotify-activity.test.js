import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initDatabase } from '../src/db.js';
import { parseSpotifyActivityPayload, readPublicSpotifyActivity } from '../src/routes/users.js';

function validActivity(overrides = {}) {
  return {
    track_id: '0VjIjW4GlUZAMYd2vXMi3b',
    title: 'Blinding Lights',
    artists: ['The Weeknd'],
    album: 'After Hours',
    artwork_url: 'https://i.scdn.co/image/ab67616d0000b273',
    external_url: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b',
    duration_ms: 200_000,
    progress_ms: 20_000,
    playback_started_at: '2026-07-14T12:00:00.000Z',
    is_playing: true,
    ...overrides,
  };
}

test('rejects invalid Spotify duration, progress, and markup-like metadata', () => {
  assert.equal(parseSpotifyActivityPayload(validActivity({ progress_ms: 200_001 })), null);
  assert.equal(parseSpotifyActivityPayload(validActivity({ duration_ms: 0 })), null);
  assert.equal(parseSpotifyActivityPayload(validActivity({ title: '<img src=x onerror=alert(1)>' })), null);
  assert.equal(parseSpotifyActivityPayload(validActivity({ artists: ['<script>alert(1)</script>'] })), null);
});

test('returns a sanitized public activity without credentials', () => {
  const activity = parseSpotifyActivityPayload(validActivity());
  assert.ok(activity);
  assert.deepEqual(Object.keys(activity).sort(), [
    'album', 'artists', 'artworkUrl', 'durationMs', 'externalUrl', 'isPlaying',
    'playbackStartedAt', 'progressMs', 'title', 'trackId',
  ]);
});

test('expired Spotify activity is not returned and is removed lazily', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ridgeline-spotify-test-'));
  const db = initDatabase(path.join(directory, 'ids.sqlite'));
  try {
    db.prepare('INSERT INTO users (id, username, email, password_hash, identity_pubkey) VALUES (?, ?, ?, ?, ?)')
      .run('user-1', 'userone', 'user@example.test', 'hash', 'identity');
    db.prepare(`
      INSERT INTO user_profile_activities (
        user_id, provider, track_id, title, artists_json, album, artwork_url, external_url,
        duration_ms, progress_ms, playback_started_at, is_playing, expires_at
      ) VALUES (?, 'spotify', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'user-1', 'track', 'Song', JSON.stringify(['Artist']), 'Album',
      'https://i.scdn.co/image/art', 'https://open.spotify.com/track/track',
      1000, 100, null, 0, new Date(Date.now() - 1_000).toISOString(),
    );

    assert.equal(readPublicSpotifyActivity(db, 'user-1'), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_profile_activities').get().count, 0);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
