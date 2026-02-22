/**
 * RLY — Darklock Secure Channel Relay Service
 *
 * A DUMB relay: stores opaque ciphertext blobs for recipients to poll.
 * No plaintext access, no contact graph, no metadata correlation.
 * Designed to run behind Caddy/Nginx reverse proxy with TLS.
 *
 * Env vars:
 *   RLY_PORT          — listen port (default 4101)
 *   RLY_JWT_SECRET    — shared JWT secret with IDS (≥32 chars)
 *   RLY_DB_PATH       — SQLite database path (default ./data/rly.db)
 *   RLY_ENVELOPE_TTL  — days to keep envelopes (default 7)
 *   RLY_CORS_ORIGIN   — CORS origin (default *)
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
  dotenvLoad({ path: sharedEnvPath, override: true });
}
dotenvLoad({ path: localEnvPath, override: false });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import db from './db.js';
import { relayRouter } from './routes/relay.js';

// ── Env validation ───────────────────────────────────────────────────────────
const JWT_SECRET = process.env.RLY_JWT_SECRET || process.env.JWT_SECRET || process.env.IDS_JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[RLY] FATAL: RLY_JWT_SECRET (or JWT_SECRET) must be set and ≥32 characters');
  process.exit(1);
}

const PORT = parseInt(process.env.RLY_PORT || '4101', 10);
const CORS_ORIGIN = process.env.RLY_CORS_ORIGIN || '*';
const ENVELOPE_TTL_DAYS = parseInt(process.env.RLY_ENVELOPE_TTL || '7', 10);

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();

app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
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
      console.log(`[RLY] Cleanup: purged ${acked.changes} acked + ${expired.changes} expired envelopes`);
    }
  } catch (err) {
    console.error('[RLY] Cleanup error:', err);
  }
}

// Run cleanup every hour
setInterval(cleanupEnvelopes, 60 * 60 * 1000);
// Initial cleanup on startup
cleanupEnvelopes();

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[RLY] Darklock Relay listening on :${PORT}`);
  console.log(`[RLY] Envelope TTL: ${ENVELOPE_TTL_DAYS} days`);
});
