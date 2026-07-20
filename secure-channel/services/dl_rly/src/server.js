/**
 * RLY — Darklock Secure Channel Relay Service
 *
 * Relays direct-message ciphertext and operational metadata. Group traffic is
 * blocked until authenticated group encryption and membership checks ship.
 * Designed to run behind Caddy/Nginx reverse proxy with TLS.
 *
 * Env vars:
 *   RLY_PORT          — listen port (default 4101)
 *   RLY_JWT_SECRET    — shared JWT secret with IDS (≥32 chars)
 *   RLY_DB_PATH       — SQLite database path (default ./data/rly.db)
 *   RLY_ENVELOPE_TTL  — days to keep envelopes (default 7)
 *   RLY_ALLOWED_ORIGINS — comma-separated allowed origins (required in production)
 */
import { config as dotenvLoad } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';

// Load env from the secure-channel root first (shared IDS+RLY secrets), then
// optionally load the service-local .env without overriding shared values.
const __dirname_rly = dirname(fileURLToPath(import.meta.url));
const sharedEnvPath = resolve(__dirname_rly, '../../../.env');
const localEnvPath = resolve(__dirname_rly, '../.env');
if (fs.existsSync(sharedEnvPath)) {
  dotenvLoad({ path: sharedEnvPath, override: false });
}
dotenvLoad({ path: localEnvPath, override: false });

import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import db from './db.js';
import { relayRouter } from './routes/relay.js';
import { createQueue } from './queue.js';
import { RIDGELINE_SECURITY_CAPABILITIES } from '@darklock/ridgeline-security-capabilities';
import { verifyRelaySendPermit as verifySignedRelaySendPermit } from './security/relay-permit.js';
import { securityEvent } from './security-log.js';

// ── Env validation ───────────────────────────────────────────────────────────
const REQUIRED_RLY_JWT_ENV = 'RLY_JWT_SECRET';
const relayJwtSecretRaw = process.env[REQUIRED_RLY_JWT_ENV];

function fatalStartup(message) {
  void message;
  console.error('[RLY_STARTUP_CONFIGURATION_INVALID]');
  process.exit(1);
}

if (typeof relayJwtSecretRaw !== 'string' || relayJwtSecretRaw.trim().length === 0) {
  fatalStartup(`${REQUIRED_RLY_JWT_ENV} is required for relay JWT verification.`);
}

const RELAY_JWT_SECRET = relayJwtSecretRaw.trim();
if (RELAY_JWT_SECRET.length < 32) {
  fatalStartup(`${REQUIRED_RLY_JWT_ENV} is too short. Minimum length is 32 characters.`);
}

const weakSecretMarkers = [
  'change_me',
  'changeme',
  'replace_me',
  'placeholder',
  'example',
  'your_secret',
  'default',
  'darklock-secret-key-change-me',
];

if (weakSecretMarkers.some((marker) => RELAY_JWT_SECRET.toLowerCase().includes(marker))) {
  fatalStartup(`${REQUIRED_RLY_JWT_ENV} appears to be a placeholder or weak value. Use a cryptographically random secret.`);
}

if (/^(.)\1{31,}$/.test(RELAY_JWT_SECRET)) {
  fatalStartup(`${REQUIRED_RLY_JWT_ENV} appears weak (repeated characters). Use a cryptographically random secret.`);
}

const PORT = parseInt(process.env.RLY_PORT || '4101', 10);
const ENVELOPE_TTL_DAYS = parseInt(process.env.RLY_ENVELOPE_TTL || '7', 10);
const ALLOW_DEV_TOKENS = process.env.RLY_ALLOW_DEV_TOKENS === '1';
if (ALLOW_DEV_TOKENS && process.env.NODE_ENV !== 'development') {
  console.error('[RLY] FATAL: RLY_ALLOW_DEV_TOKENS=1 is allowed only when NODE_ENV=development');
  process.exit(1);
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function parseAllowedOrigins(raw) {
  return String(raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const DEV_ALLOWED_ORIGINS = [
  'http://localhost:1421',
  'http://127.0.0.1:1421',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'capacitor://localhost',
  'ionic://localhost',
];

const configuredOrigins = parseAllowedOrigins(process.env.RLY_ALLOWED_ORIGINS);
if (IS_PRODUCTION) {
  if (configuredOrigins.length === 0) {
    fatalStartup('RLY_ALLOWED_ORIGINS is required in production.');
  }
  if (configuredOrigins.some((origin) => origin === '*')) {
    fatalStartup('RLY_ALLOWED_ORIGINS must not contain wildcard (*) in production.');
  }
}

const allowedOrigins = new Set(IS_PRODUCTION
  ? configuredOrigins
  : [...DEV_ALLOWED_ORIGINS, ...configuredOrigins.filter((origin) => origin !== '*')]);

function isOriginAllowed(origin) {
  if (!origin) return true; // Native desktop requests may not send Origin.
  return allowedOrigins.has(origin);
}

function enforceOriginAllowlist(req, res, next) {
  const origin = req.headers.origin;
  if (!origin || isOriginAllowed(origin)) {
    next();
    return;
  }

  res.status(403).json({ error: 'origin_not_allowed', code: 'forbidden' });
}

const queue = createQueue(process.env.RLY_QUEUE_PATH);
const ACCESS_TOKEN_ISSUER = 'dl-ids';
const ACCESS_TOKEN_AUDIENCE = 'ridgeline-services';
const MAX_EVENT_RECIPIENTS = Math.max(
  1,
  Math.min(parseInt(process.env.RLY_MAX_EVENT_RECIPIENTS || '64', 10) || 64, 256),
);

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();

app.use(helmet());
app.use(enforceOriginAllowlist);
app.use(cors({
  origin(origin, callback) {
    if (!origin || isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: false,
}));
app.use(express.json({ limit: '256kb' })); // envelopes are small ciphertext blobs

// Attach db to all requests
app.use((req, _res, next) => {
  req.db = db;
  next();
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    const pending = db.prepare('SELECT COUNT(*) as count FROM envelopes WHERE acked_at IS NULL').get();
    res.json({
      status: 'ok',
      service: 'dl-rly',
      pending_envelopes: pending.count,
      uptime: Math.floor(process.uptime()),
    });
  } catch {
    res.status(503).json({ status: 'error', service: 'dl-rly' });
  }
});

// ── Mount routes ─────────────────────────────────────────────────────────────
app.use('/', relayRouter);

// ── WebSocket relay (local dev + realtime app protocol) ─────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const sessions = new Map(); // userId -> Set<WebSocket>
const presenceSubs = new Map(); // subscriber userId -> Set<target userId>
const profiles = new Map(); // userId -> profile payload

function wsSend(ws, payload) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function getSockets(userId) {
  return sessions.get(userId) ?? new Set();
}

function isOnline(userId) {
  return getSockets(userId).size > 0;
}

function verifyToken(token) {
  try {
    const payload = jwt.verify(token, RELAY_JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    });
    if (!payload || typeof payload !== 'object' || payload.type !== 'access' || typeof payload.sub !== 'string') {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function sendPresenceUpdate(targetUserId, online) {
  for (const [subscriberId, watched] of presenceSubs.entries()) {
    if (!watched.has(targetUserId)) continue;
    for (const ws of getSockets(subscriberId)) {
      wsSend(ws, { type: 'presence', userId: targetUserId, online });
    }
  }
}

function forwardToUser(targetUserId, payload, enqueueEnvelope = null) {
  const targets = getSockets(targetUserId);
  if (targets.size === 0) {
    if (enqueueEnvelope) queue.enqueue(targetUserId, enqueueEnvelope);
    return;
  }
  for (const ws of targets) wsSend(ws, payload);
}

const CALL_MESSAGE_TYPES = new Set([
  'call_invite',
  'call_accept',
  'call_reject',
  'call_end',
  'call_signal',
  'call_media',
]);

const GROUP_RECIPIENT_EVENT_TYPES = new Set([
  'group_message',
  'group_invite',
  'group_settings_update',
]);

const METADATA_RECIPIENT_EVENT_TYPES = new Set([
  'subscribe_presence',
  'profile_request',
]);

const DIRECT_PERMIT_EVENT_TYPES = new Set([
  'typing',
  'delete_message',
  'edit_message',
  'receipt',
  'friend_accept',
  'open_dm',
  'tag_update',
]);

const MAX_CALL_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAX_GROUP_SETTINGS_BYTES = 64 * 1024;
const MAX_PROFILE_SYNC_BYTES = Math.max(
  1_024,
  Math.min(parseInt(process.env.RLY_MAX_PROFILE_SYNC_BYTES || '32768', 10) || 32768, 262144),
);
const EVENT_RATE_LIMITS = {
  message: { limit: 40, windowMs: 10_000 },
  group_message: { limit: 20, windowMs: 10_000 },
  group_invite: { limit: 12, windowMs: 60_000 },
  group_settings_update: { limit: 24, windowMs: 60_000 },
  friend_request: { limit: 12, windowMs: 60_000 },
  friend_accept: { limit: 12, windowMs: 60_000 },
  open_dm: { limit: 20, windowMs: 60_000 },
  typing: { limit: 40, windowMs: 10_000 },
  receipt: { limit: 80, windowMs: 60_000 },
  edit_message: { limit: 30, windowMs: 60_000 },
  delete_message: { limit: 30, windowMs: 60_000 },
  tag_update: { limit: 20, windowMs: 60_000 },
  call_invite: { limit: 12, windowMs: 60_000 },
  call_accept: { limit: 40, windowMs: 60_000 },
  call_reject: { limit: 40, windowMs: 60_000 },
  call_end: { limit: 40, windowMs: 60_000 },
  call_signal: { limit: 300, windowMs: 10_000 },
  call_media: { limit: 300, windowMs: 10_000 },
  subscribe_presence: { limit: 12, windowMs: 60_000 },
  profile_request: { limit: 20, windowMs: 60_000 },
  profile_sync: { limit: 20, windowMs: 60_000 },
};

const userRateLimitState = new Map();

function normalizeUserId(value) {
  return String(value ?? '').trim();
}

function normalizeRecipients(rawRecipients, fromUserId) {
  if (!Array.isArray(rawRecipients)) return [];
  const out = [];
  const seen = new Set();
  for (const value of rawRecipients) {
    const userId = normalizeUserId(value);
    if (!userId || userId === fromUserId || seen.has(userId)) continue;
    seen.add(userId);
    out.push(userId);
  }
  return out.sort();
}

function hitRateLimitBucket(bucketMap, key, rule, now) {
  const bucket = bucketMap.get(key);
  if (!bucket || now - bucket.windowStart >= rule.windowMs) {
    bucketMap.set(key, { windowStart: now, count: 1 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > rule.limit;
}

function isRateLimited(ws, eventType, userId = '') {
  const rule = EVENT_RATE_LIMITS[eventType];
  if (!rule) return false;

  if (!ws.rateLimitState) ws.rateLimitState = new Map();

  const now = Date.now();
  const socketLimited = hitRateLimitBucket(ws.rateLimitState, eventType, rule, now);
  const userKey = userId ? `${userId}:${eventType}` : '';
  const userLimited = userKey
    ? hitRateLimitBucket(userRateLimitState, userKey, rule, now)
    : false;

  return socketLimited || userLimited;
}

function verifyRelaySendPermit({ permitToken, fromUserId, eventType, toUserId = '', recipients = [], groupId = '' }) {
  return verifySignedRelaySendPermit({
    secret: RELAY_JWT_SECRET,
    permitToken,
    fromUserId,
    eventType,
    toUserId,
    recipients,
    groupId,
  });
}

wss.on('connection', (ws, req) => {
  ws.userId = null;

  const origin = req?.headers?.origin;
  if (origin && !isOriginAllowed(origin)) {
    wsSend(ws, { type: 'error', error: 'origin_not_allowed' });
    ws.close(1008, 'origin_not_allowed');
    return;
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'auth') {
      // Prevent identity rebinding on an already-authenticated socket.
      if (ws.userId) {
        wsSend(ws, { type: 'error', error: 'already_authenticated' });
        ws.close();
        return;
      }

      const claimedUserId = String(msg.userId ?? '').trim();
      const token = String(msg.token ?? '');
      const verified = token ? verifyToken(token) : null;

      // Optional local-dev identity token for integration testing only.
      const devSubject = ALLOW_DEV_TOKENS
        && process.env.NODE_ENV === 'development'
        && token.startsWith('dev-local-')
        ? token.slice('dev-local-'.length).trim()
        : '';

      const tokenUserId = verified && typeof verified === 'object' && typeof verified.sub === 'string'
        ? verified.sub.trim()
        : devSubject;

      if (!tokenUserId) {
        wsSend(ws, { type: 'error', error: 'unauthorized' });
        ws.close();
        return;
      }

      if (claimedUserId && claimedUserId !== tokenUserId) {
        wsSend(ws, { type: 'error', error: 'userid_mismatch' });
        ws.close();
        return;
      }

      ws.userId = tokenUserId;
      if (!sessions.has(tokenUserId)) sessions.set(tokenUserId, new Set());
      sessions.get(tokenUserId).add(ws);

      // Deliver queued messages for this user on login.
      const pending = queue.drain(tokenUserId);
      for (const env of pending) wsSend(ws, env);

      sendPresenceUpdate(tokenUserId, true);
      return;
    }

    const from = ws.userId;
    if (!from) return;

    if (GROUP_RECIPIENT_EVENT_TYPES.has(msg.type)
      && !RIDGELINE_SECURITY_CAPABILITIES.groupMessagingSupported) {
      wsSend(ws, { type: 'error', error: 'group_messaging_disabled_security' });
      return;
    }
    if (msg.type === 'edit_message' && !RIDGELINE_SECURITY_CAPABILITIES.messageEditsSupported) {
      wsSend(ws, { type: 'error', error: 'message_edits_disabled_security' });
      return;
    }
    if (msg.type === 'delete_message' && !RIDGELINE_SECURITY_CAPABILITIES.messageDeletesSupported) {
      wsSend(ws, { type: 'error', error: 'message_deletes_disabled_security' });
      return;
    }

    if (Array.isArray(msg.recipients) && msg.recipients.length > MAX_EVENT_RECIPIENTS) {
      wsSend(ws, { type: 'error', error: 'recipients_too_many' });
      return;
    }

    if (msg.type === 'ping') {
      wsSend(ws, { type: 'pong', timestamp: Date.now() });
      return;
    }

    if (msg.type === 'subscribe_presence') {
      const recipients = normalizeRecipients(msg.userIds, from);
      if (recipients.length === 0) {
        presenceSubs.delete(from);
        return;
      }
      if (recipients.length > MAX_EVENT_RECIPIENTS) {
        wsSend(ws, { type: 'error', error: 'recipients_too_many' });
        return;
      }

      if (isRateLimited(ws, 'subscribe_presence', from)) {
        wsSend(ws, { type: 'error', error: 'rate_limited' });
        return;
      }

      try {
        verifyRelaySendPermit({
          permitToken: msg.permit,
          fromUserId: from,
          eventType: 'subscribe_presence',
          recipients,
        });
      } catch (err) {
        wsSend(ws, { type: 'error', error: err.message || 'invalid_permit' });
        return;
      }

      presenceSubs.set(from, new Set(recipients));
      for (const userId of recipients) {
        wsSend(ws, { type: 'presence', userId, online: isOnline(userId) });
      }
      return;
    }

    if (msg.type === 'profile_sync') {
      if (isRateLimited(ws, 'profile_sync', from)) {
        wsSend(ws, { type: 'error', error: 'rate_limited' });
        return;
      }

      const profile = msg.profile ?? {};
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        wsSend(ws, { type: 'error', error: 'invalid_profile' });
        return;
      }

      let serializedProfile = '';
      try {
        serializedProfile = JSON.stringify(profile);
      } catch {
        wsSend(ws, { type: 'error', error: 'invalid_profile' });
        return;
      }

      if (serializedProfile.length > MAX_PROFILE_SYNC_BYTES) {
        wsSend(ws, { type: 'error', error: 'profile_payload_too_large' });
        return;
      }

      profiles.set(from, profile);
      for (const [subscriberId, watched] of presenceSubs.entries()) {
        if (!watched.has(from)) continue;
        for (const s of getSockets(subscriberId)) wsSend(s, { type: 'profile_changed', userId: from });
      }
      return;
    }

    if (msg.type === 'profile_request') {
      const recipients = normalizeRecipients(msg.userIds, from);
      if (recipients.length === 0) {
        return;
      }
      if (recipients.length > MAX_EVENT_RECIPIENTS) {
        wsSend(ws, { type: 'error', error: 'recipients_too_many' });
        return;
      }

      if (isRateLimited(ws, 'profile_request', from)) {
        wsSend(ws, { type: 'error', error: 'rate_limited' });
        return;
      }

      try {
        verifyRelaySendPermit({
          permitToken: msg.permit,
          fromUserId: from,
          eventType: 'profile_request',
          recipients,
        });
      } catch (err) {
        wsSend(ws, { type: 'error', error: err.message || 'invalid_permit' });
        return;
      }

      for (const userId of recipients) {
        const profile = profiles.get(userId);
        if (profile) wsSend(ws, { type: 'profile_data', userId, profile });
      }
      return;
    }

    if (msg.type === 'message' && msg.to) {
      const to = normalizeUserId(msg.to);
      if (!to || to === from) return;

      if (isRateLimited(ws, 'message', from)) {
        wsSend(ws, { type: 'error', error: 'rate_limited' });
        return;
      }

      try {
        verifyRelaySendPermit({
          permitToken: msg.permit,
          fromUserId: from,
          eventType: 'message',
          toUserId: to,
        });
      } catch (err) {
        wsSend(ws, { type: 'error', error: err.message || 'invalid_permit' });
        return;
      }

      const envelope = {
        type: 'message',
        from,
        payload: msg.payload,
        id: msg.id,
        timestamp: Date.now(),
      };
      forwardToUser(to, envelope, envelope);
      return;
    }

    if (msg.type === 'group_message' && Array.isArray(msg.recipients)) {
      const recipients = normalizeRecipients(msg.recipients, from);
      if (recipients.length === 0) return;
      if (recipients.length > MAX_EVENT_RECIPIENTS) {
        wsSend(ws, { type: 'error', error: 'recipients_too_many' });
        return;
      }

      if (isRateLimited(ws, 'group_message', from)) {
        wsSend(ws, { type: 'error', error: 'rate_limited' });
        return;
      }

      const groupId = normalizeUserId(msg.groupId);
      const channelId = normalizeUserId(msg.channelId);
      const channelName = typeof msg.channelName === 'string'
        ? msg.channelName.trim().slice(0, 64)
        : '';
      try {
        verifyRelaySendPermit({
          permitToken: msg.permit,
          fromUserId: from,
          eventType: 'group_message',
          recipients,
          groupId,
        });
      } catch (err) {
        wsSend(ws, { type: 'error', error: err.message || 'invalid_permit' });
        return;
      }

      for (const recipient of recipients) {
        const envelope = {
          type: 'group_message',
          from,
          groupId,
          ...(channelId ? { channelId } : {}),
          ...(channelName ? { channelName } : {}),
          payload: msg.payload,
          id: msg.id,
          timestamp: Date.now(),
        };
        forwardToUser(recipient, envelope, envelope);
      }
      return;
    }

    if (msg.type === 'group_settings_update' && Array.isArray(msg.recipients)) {
      const recipients = normalizeRecipients(msg.recipients, from);
      if (recipients.length === 0) return;
      if (recipients.length > MAX_EVENT_RECIPIENTS) {
        wsSend(ws, { type: 'error', error: 'recipients_too_many' });
        return;
      }

      if (isRateLimited(ws, 'group_settings_update', from)) {
        wsSend(ws, { type: 'error', error: 'rate_limited' });
        return;
      }

      const groupId = normalizeUserId(msg.groupId);
      if (!msg.settings || typeof msg.settings !== 'object') {
        wsSend(ws, { type: 'error', error: 'invalid_group_settings' });
        return;
      }

      let serializedSettings = '';
      try {
        serializedSettings = JSON.stringify(msg.settings);
      } catch {
        wsSend(ws, { type: 'error', error: 'invalid_group_settings' });
        return;
      }

      if (serializedSettings.length > MAX_GROUP_SETTINGS_BYTES) {
        wsSend(ws, { type: 'error', error: 'group_settings_too_large' });
        return;
      }

      try {
        verifyRelaySendPermit({
          permitToken: msg.permit,
          fromUserId: from,
          eventType: 'group_settings_update',
          recipients,
          groupId,
        });
      } catch (err) {
        wsSend(ws, { type: 'error', error: err.message || 'invalid_permit' });
        return;
      }

      for (const recipient of recipients) {
        const envelope = {
          type: 'group_settings_update',
          from,
          groupId,
          settings: msg.settings,
          timestamp: Date.now(),
        };
        forwardToUser(recipient, envelope, envelope);
      }
      return;
    }

    if (msg.type === 'friend_request' && msg.to) {
      const to = normalizeUserId(msg.to);
      if (!to || to === from) return;

      if (isRateLimited(ws, 'friend_request', from)) {
        wsSend(ws, { type: 'error', error: 'rate_limited' });
        return;
      }

      try {
        verifyRelaySendPermit({
          permitToken: msg.permit,
          fromUserId: from,
          eventType: 'friend_request',
          toUserId: to,
        });
      } catch (err) {
        wsSend(ws, { type: 'error', error: err.message || 'invalid_permit' });
        return;
      }

      const { permit: _permit, ...rest } = msg;
      const payload = { ...rest, from, to };
      forwardToUser(to, payload);
      return;
    }

    if (msg.to && CALL_MESSAGE_TYPES.has(msg.type)) {
      const to = normalizeUserId(msg.to);
      if (!to || to === from) return;

      if (isRateLimited(ws, msg.type, from)) {
        wsSend(ws, { type: 'error', error: 'rate_limited' });
        return;
      }

      if (typeof msg.payload !== 'string' || msg.payload.length > MAX_CALL_PAYLOAD_BYTES) {
        wsSend(ws, { type: 'error', error: 'invalid_call_payload' });
        return;
      }

      try {
        verifyRelaySendPermit({
          permitToken: msg.permit,
          fromUserId: from,
          eventType: msg.type,
          toUserId: to,
        });
      } catch (err) {
        wsSend(ws, { type: 'error', error: err.message || 'invalid_permit' });
        return;
      }

      const envelope = {
        type: msg.type,
        from,
        payload: msg.payload,
        timestamp: Date.now(),
      };

      // Queue missed incoming call invites for users who reconnect quickly;
      // never queue transient signaling or media-state packets.
      const queueIfOffline = msg.type === 'call_invite' ? envelope : null;
      forwardToUser(to, envelope, queueIfOffline);
      return;
    }

    if (msg.type === 'group_invite') {
      const recipients = normalizeRecipients(
        Array.isArray(msg.recipients)
          ? msg.recipients
          : (msg.to ? [msg.to] : []),
        from,
      );

      if (recipients.length === 0) return;
      if (recipients.length > MAX_EVENT_RECIPIENTS) {
        wsSend(ws, { type: 'error', error: 'recipients_too_many' });
        return;
      }

      if (isRateLimited(ws, 'group_invite', from)) {
        wsSend(ws, { type: 'error', error: 'rate_limited' });
        return;
      }

      const groupId = normalizeUserId(msg.groupId);
      try {
        verifyRelaySendPermit({
          permitToken: msg.permit,
          fromUserId: from,
          eventType: 'group_invite',
          recipients,
          groupId,
        });
      } catch (err) {
        wsSend(ws, { type: 'error', error: err.message || 'invalid_permit' });
        return;
      }

      const { permit: _permit, ...rest } = msg;
      for (const recipient of recipients) {
        forwardToUser(recipient, {
          ...rest,
          type: 'group_invite',
          from,
          to: recipient,
          groupId,
        });
      }
      return;
    }

    if (msg.to && DIRECT_PERMIT_EVENT_TYPES.has(msg.type)) {
      const to = normalizeUserId(msg.to);
      if (!to || to === from) return;

      if (isRateLimited(ws, msg.type, from)) {
        wsSend(ws, { type: 'error', error: 'rate_limited' });
        return;
      }

      try {
        verifyRelaySendPermit({
          permitToken: msg.permit,
          fromUserId: from,
          eventType: msg.type,
          toUserId: to,
        });
      } catch (err) {
        wsSend(ws, { type: 'error', error: err.message || 'invalid_permit' });
        return;
      }

      const { permit: _permit, ...rest } = msg;
      const payload = { ...rest, from, to };
      forwardToUser(to, payload);
      return;
    }
  });

  ws.on('close', () => {
    const userId = ws.userId;
    if (!userId) return;
    const set = sessions.get(userId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) sessions.delete(userId);
    }
    if (!isOnline(userId)) sendPresenceUpdate(userId, false);
  });
});

// ── Envelope cleanup job ─────────────────────────────────────────────────────
// Purge acked envelopes older than TTL, and undelivered envelopes older than 2x TTL
function cleanupEnvelopes() {
  try {
    const acked = db.prepare(`
      DELETE FROM envelopes
      WHERE acked_at IS NOT NULL
        AND created_at < datetime('now', '-' || ? || ' days')
    `).run(ENVELOPE_TTL_DAYS);

    const expired = db.prepare(`
      DELETE FROM envelopes
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `).run(ENVELOPE_TTL_DAYS * 2);

    const total = (acked.changes || 0) + (expired.changes || 0);
    if (total > 0) {
      securityEvent('RLY_ENVELOPE_CLEANUP_COMPLETED', {
        acked: acked.changes,
        expired: expired.changes,
      });
    }
  } catch (err) {
    securityEvent('RLY_ENVELOPE_CLEANUP_FAILED', {}, 'error');
  }
}

// Run cleanup every hour
setInterval(cleanupEnvelopes, 60 * 60 * 1000);
// Initial cleanup on startup
cleanupEnvelopes();

// ── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  securityEvent('RLY_STARTED', { port: PORT, envelope_ttl_days: ENVELOPE_TTL_DAYS });
});
