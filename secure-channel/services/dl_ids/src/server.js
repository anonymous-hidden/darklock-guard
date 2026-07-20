/**
 * Darklock Secure Channel — Identity Service (IDS)
 *
 * Responsibilities:
 * - User registration and authentication (JWT)
 * - Device enrollment (store device certs + public keys)
 * - Key publishing (prekey bundles, identity keys)
 * - Key retrieval (for X3DH-style session init)
 *
 * SECURITY NOTES:
 * - Messaging private keys remain client-side; account security records and
 *   public messaging keys are stored here.
 * - New passwords use Argon2id; successful legacy bcrypt logins migrate atomically.
 * - JWTs are short-lived (15 min access + 7 day refresh).
 * - IDS and Relay process relationship and routing metadata required to
 *   authorize delivery. Ridgeline does not claim metadata anonymity.
 */

import { config as dotenvLoad } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';

// Load env from the secure-channel root first (shared IDS+RLY secrets), then
// optionally load the service-local .env without overriding shared values.
const __dirname_ids = dirname(fileURLToPath(import.meta.url));
const sharedEnvPath = resolve(__dirname_ids, '../../../.env');
const localEnvPath = resolve(__dirname_ids, '../.env');
if (fs.existsSync(sharedEnvPath)) {
  dotenvLoad({ path: sharedEnvPath, override: false });
}
dotenvLoad({ path: localEnvPath, override: false });
// Absolute DB path fallback so spaces in cwd can never cause wrong DB
const DEFAULT_IDS_DB = resolve(__dirname_ids, '../data/ids.db');

import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createHash } from 'crypto';

import { initDatabase } from './db.js';
import { createIdsSecureFields } from './security/secure-fields.js';
import {
  prepareIdsPrivateStorage,
  validateIdsPrivateDatabaseFiles,
} from './security/storage-permissions.js';
import { authRouter } from './routes/auth.js';
import { devicesRouter } from './routes/devices.js';
import { keysRouter } from './routes/keys.js';
import { usersRouter } from './routes/users.js';
import { friendsRouter } from './routes/friends.js';
import { serversRouter } from './routes/servers.js';
import { rolesRouter } from './routes/roles.js';
import { auditRouter } from './routes/audit.js';
import { presenceRouter } from './routes/presence.js';
import { invitesRouter } from './routes/invites.js';
import { automodRouter } from './routes/automod.js';
import channelMessagesRouter from './routes/channel-messages.js';
import { voiceRouter, cleanupStaleMembers } from './routes/voice.js';
import { sseRouter } from './sse.js';
import { tagsRouter } from './routes/tags.js';
import { initVoiceWs } from './voice-ws.js';
import { secureChannelRouter } from './routes/secure-channels.js';
import { initMessagingGateway, getGatewayStats } from './gateway.js';
import { securityAlertRouter } from './routes/security-alerts.js';
import { v1Router } from './routes/v1.js';
import { securityEvent } from './security-log.js';

const PORT = parseInt(process.env.IDS_PORT ?? '4100', 10);
const JWT_SECRET = process.env.IDS_JWT_SECRET ?? process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('FATAL: IDS_JWT_SECRET (or JWT_SECRET) must be set and at least 32 characters');
  process.exit(1);
}
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEBUG_SECURITY = process.env.DEBUG_SECURITY === '1';

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

const configuredOrigins = parseAllowedOrigins(process.env.IDS_ALLOWED_ORIGINS);
if (IS_PRODUCTION) {
  if (configuredOrigins.length === 0) {
    console.error('FATAL: IDS_ALLOWED_ORIGINS is required in production.');
    process.exit(1);
  }
  if (configuredOrigins.some((origin) => origin === '*')) {
    console.error('FATAL: IDS_ALLOWED_ORIGINS must not contain wildcard (*) in production.');
    process.exit(1);
  }
}

const allowedOrigins = new Set(IS_PRODUCTION ? configuredOrigins : [
  ...DEV_ALLOWED_ORIGINS,
  ...configuredOrigins.filter((origin) => origin !== '*'),
]);

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

function createRateLimiter(options) {
  const {
    windowMs,
    max,
    message = { error: 'rate_limited', code: 'rate_limited' },
    keyGenerator = (req) => String(req.ip ?? req.socket?.remoteAddress ?? 'unknown').trim().toLowerCase(),
    skipSuccessfulRequests = false,
  } = options;

  const buckets = new Map();

  function getBucket(key, now) {
    const existing = buckets.get(key);
    if (!existing || now - existing.windowStart >= windowMs) {
      const fresh = { windowStart: now, count: 0 };
      buckets.set(key, fresh);
      return fresh;
    }
    return existing;
  }

  return (req, res, next) => {
    const now = Date.now();
    const key = String(keyGenerator(req) ?? '').trim().toLowerCase() || 'unknown';
    const bucket = getBucket(key, now);

    if (skipSuccessfulRequests) {
      if (bucket.count >= max) {
        res.status(429).json(message);
        return;
      }

      res.on('finish', () => {
        if (res.statusCode < 400) return;
        const finishNow = Date.now();
        const finishBucket = getBucket(key, finishNow);
        finishBucket.count += 1;
      });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      res.status(429).json(message);
      return;
    }

    next();
  };
}

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
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
app.use(compression());
app.use(express.json({ limit: '10mb' }));
if (!IS_PRODUCTION || DEBUG_SECURITY) {
  app.use((_req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      securityEvent('IDS_HTTP_REQUEST_COMPLETED', {
        status: res.statusCode,
        duration_ms: Date.now() - startedAt,
      });
    });
    next();
  });
}

// Rate limiting
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 30,
  message: { error: 'Too many auth attempts', code: 'rate_limited' },
});

const v1RegisterLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many registrations from this IP', code: 'rate_limited' },
});

const v1AvailabilityLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 30,
  message: { error: 'Too many availability checks', code: 'rate_limited' },
});

const v1ExistsLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 30,
  message: { error: 'Too many existence checks', code: 'rate_limited' },
});

const v1BundleIpLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 120,
  message: { error: 'Too many bundle fetches', code: 'rate_limited' },
});

const friendRequestIpLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  message: { error: 'Too many friend requests from this IP', code: 'rate_limited' },
});

const v1LoginAccountLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const raw = String(req.body?.email ?? req.body?.userId ?? req.body?.username_or_email ?? '')
      .trim()
      .toLowerCase();
    return raw ? `v1-login-account:${raw}` : `v1-login-ip:${req.ip}`;
  },
  message: { error: 'Too many login attempts for this account', code: 'rate_limited' },
});

app.use('/register', authLimiter);
app.use('/login', authLimiter);
app.use('/v1/auth/register', authLimiter);
app.use('/v1/auth/login', authLimiter);
app.use('/v1/auth/2fa/setup', authLimiter);
app.use('/v1/auth/2fa/confirm', authLimiter);
app.use('/v1/auth/2fa/disable', authLimiter);
app.use('/v1/auth/2fa/verify', authLimiter);
app.use('/v1/auth/login', v1LoginAccountLimiter);
app.use('/v1/auth/register', v1RegisterLimiter);
app.use('/v1/auth/availability', v1AvailabilityLimiter);
app.use('/v1/auth/exists', v1ExistsLimiter);
app.use('/v1/keys/bundle', v1BundleIpLimiter);
app.use('/friends/request', friendRequestIpLimiter);

// ── DB init ──────────────────────────────────────────────────────────────────
const secureFields = await createIdsSecureFields(process.env);
const idsDatabasePath = process.env.IDS_DB_PATH ?? DEFAULT_IDS_DB;
prepareIdsPrivateStorage(idsDatabasePath, secureFields.configured);
const db = initDatabase(idsDatabasePath);
validateIdsPrivateDatabaseFiles(idsDatabasePath, secureFields.configured);
secureFields.verifyDatabaseKeyCheck(db);

function sha256Prefixed(value) {
  return `sha256:${createHash('sha256').update(String(value || '').trim()).digest('hex')}`;
}

function hashLegacyBackupCode(value) {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return sha256Prefixed(`ridgeline-backup-code:${normalized}`);
}

db.transaction(() => {
  const legacyInvites = db.prepare(
    "SELECT id, token FROM server_invites WHERE token NOT LIKE 'sha256:%'"
  ).all();
  const updateInvite = db.prepare('UPDATE server_invites SET token = ? WHERE id = ?');
  for (const invite of legacyInvites) updateInvite.run(sha256Prefixed(invite.token), invite.id);

  const usersWithBackupCodes = db.prepare(
    "SELECT id, backup_codes FROM users WHERE backup_codes IS NOT NULL AND backup_codes != ''"
  ).all();
  const updateBackupCodes = db.prepare('UPDATE users SET backup_codes = ? WHERE id = ?');
  for (const user of usersWithBackupCodes) {
    try {
      const parsed = JSON.parse(user.backup_codes);
      if (!Array.isArray(parsed)) continue;
      const digests = parsed.map((entry) => (
        String(entry).startsWith('sha256:') ? String(entry) : hashLegacyBackupCode(entry)
      ));
      updateBackupCodes.run(JSON.stringify(digests), user.id);
    } catch {
      updateBackupCodes.run(null, user.id);
    }
  }

  // Pre-remediation pending tokens/setups cannot be trusted to be hashed.
  db.prepare('DELETE FROM pending_2fa_tokens').run();
  db.prepare(`
    UPDATE users
    SET twofa_pending_secret = NULL,
        twofa_pending_backup_codes = NULL,
        twofa_pending_email_code_hash = NULL,
        twofa_pending_email_code_expires_at = NULL
  `).run();
})();

secureFields.assertEncryptedDatabase(db);

// Attach db and config to requests
app.use((req, _res, next) => {
  req.db = db;
  req.jwtSecret = JWT_SECRET;
  req.secureFields = secureFields;
  next();
});

// Health (with gateway stats)
app.get('/health', (_req, res) => {
  const stats = getGatewayStats();
  res.json({ status: 'ok', service: 'dl-ids', gateway: stats });
});

// ── Routes ───────────────────────────────────────────────────────────────────
// v1 compatibility API used by secure-channel app (auth/keys/sync contract)
app.use('/v1', v1Router);
const enableLegacyAuthRoutes = process.env.IDS_ENABLE_LEGACY_AUTH === '1' && !IS_PRODUCTION;
if (enableLegacyAuthRoutes) {
  app.use('/', authRouter);
} else {
  const legacyAuthDisabled = (_req, res) => {
    res.status(410).json({ error: 'legacy_auth_disabled', code: 'gone' });
  };
  app.post('/register', legacyAuthDisabled);
  app.post('/login', legacyAuthDisabled);
  app.post('/refresh', legacyAuthDisabled);
}
app.use('/devices', devicesRouter);
app.use('/keys', keysRouter);
app.use('/users', usersRouter);
app.use('/friends', friendsRouter);
app.use('/servers', serversRouter);
app.use('/servers', rolesRouter);
app.use('/servers', auditRouter);
app.use('/servers', sseRouter);
app.use('/', sseRouter);
app.use('/presence',  presenceRouter);
app.use('/servers', invitesRouter);
app.use('/invites', invitesRouter);   // public invite lookup
app.use('/api/invites', invitesRouter); // preview alias: /api/invites/:code/preview
app.use('/servers', automodRouter);
app.use('/voice',   voiceRouter);
app.use('/',        tagsRouter);
app.use('/',        channelMessagesRouter);
app.use('/servers', secureChannelRouter);  // Secure channel RBAC routes
app.use('/servers', securityAlertRouter);  // Security alert routes

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  securityEvent('IDS_UNHANDLED_REQUEST_ERROR', {}, 'error');
  res.status(500).json({ error: 'Internal server error', code: 'internal' });
});

const httpServer = http.createServer(app);
initVoiceWs({ server: httpServer, db, jwtSecret: JWT_SECRET });
initMessagingGateway({ server: httpServer, db, jwtSecret: JWT_SECRET });
const staleMemberCleanupTimer = setInterval(() => {
  try { cleanupStaleMembers(db); } catch {}
}, 15000);
httpServer.listen(PORT, () => {
  console.log(`[IDS] Darklock Identity Service listening on :${PORT}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(staleMemberCleanupTimer);
  const forceExit = setTimeout(() => process.exit(1), 5000);
  forceExit.unref();
  httpServer.close(() => {
    try { db.close(); } catch {}
    secureFields.destroy();
    clearTimeout(forceExit);
    process.exit(0);
  });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

export default app;
