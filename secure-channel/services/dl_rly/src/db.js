/**
 * RLY — Relay database (message queue / ephemeral store)
 *
 * The relay intentionally stores ONLY opaque ciphertext blobs.
 * No plaintext, no contact graph, no metadata correlation.
 * Envelopes are deleted after ACK or after TTL (default 7 days).
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.RLY_DB_PATH || './data/rly.db';

// Ensure data directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH, { verbose: process.env.NODE_ENV === 'development' ? console.log : undefined });

// WAL mode for concurrent reads
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS envelopes (
    id           TEXT PRIMARY KEY,
    sender_id    TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    ciphertext   TEXT NOT NULL,         -- base64 blob (opaque to relay)
    init_data    TEXT,                   -- base64 X3DH init message (first msg only)
    chain_link   TEXT,                   -- chain hash for ordering
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    delivered_at TEXT,                   -- null = pending delivery
    acked_at     TEXT                    -- null = not yet acknowledged
  );

  CREATE INDEX IF NOT EXISTS idx_envelopes_recipient ON envelopes(recipient_id);
  CREATE INDEX IF NOT EXISTS idx_envelopes_recipient_pending ON envelopes(recipient_id, delivered_at);
  CREATE INDEX IF NOT EXISTS idx_envelopes_created ON envelopes(created_at);

  CREATE TABLE IF NOT EXISTS delivery_receipts (
    envelope_id  TEXT NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL,
    status       TEXT NOT NULL CHECK(status IN ('delivered', 'read')),
    timestamp    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (envelope_id, recipient_id)
  );
`);

export default db;
