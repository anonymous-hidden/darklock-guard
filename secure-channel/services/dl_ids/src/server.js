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
 * - This service stores PUBLIC keys only.  No private key material.
 * - Passwords are hashed with bcrypt (cost 12).
 * - JWTs are short-lived (15 min access + 7 day refresh).
 * - The server DOES know who registered, but NOT who talks to whom
 *   (that is the Relay's concern, and it also stores minimal metadata).
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
  dotenvLoad({ path: sharedEnvPath, override: true });
}
dotenvLoad({ path: localEnvPath, override: false });
// Absolute DB path fallback so spaces in cwd can never cause wrong DB
const DEFAULT_IDS_DB = resolve(__dirname_ids, '../data/ids.db');

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { initDatabase } from './db.js';
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
import { sseRouter } from './sse.js';

const PORT = parseInt(process.env.IDS_PORT ?? '4100', 10);
const JWT_SECRET = process.env.IDS_JWT_SECRET ?? process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('FATAL: IDS_JWT_SECRET (or JWT_SECRET) must be set and at least 32 characters');
  process.exit(1);
}

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' })); // Tauri desktop — tighten in production
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('short'));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 30,
  message: { error: 'Too many auth attempts', code: 'rate_limited' },
});
app.use('/register', authLimiter);
app.use('/login', authLimiter);

// ── DB init ──────────────────────────────────────────────────────────────────
const db = initDatabase(process.env.IDS_DB_PATH ?? DEFAULT_IDS_DB);

// Attach db and config to requests
app.use((req, _res, next) => {
  req.db = db;
  req.jwtSecret = JWT_SECRET;
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/', authRouter);
app.use('/devices', devicesRouter);
app.use('/keys', keysRouter);
app.use('/users', usersRouter);
app.use('/friends', friendsRouter);
app.use('/servers', serversRouter);
app.use('/servers', rolesRouter);
app.use('/servers', auditRouter);
app.use('/servers', sseRouter);
app.use('/',        presenceRouter);
app.use('/servers', invitesRouter);
app.use('/invites', invitesRouter);   // public invite lookup
app.use('/servers', automodRouter);
app.use('/',        channelMessagesRouter);

// Health
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'dl-ids' }));

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('IDS error:', err);
  res.status(500).json({ error: 'Internal server error', code: 'internal' });
});

app.listen(PORT, () => {
  console.log(`[IDS] Darklock Identity Service listening on :${PORT}`);
});

export default app;
