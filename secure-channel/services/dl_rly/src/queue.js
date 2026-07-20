/* ──────────────────────────────────────────────────────────
 *  Offline message queue — SQLite-backed
 *  Stores encrypted blobs for offline recipients.
 *  Auto-purges after 30 days.
 * ────────────────────────────────────────────────────────── */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours (MED-5: reduced from 30 days)

export function createQueue(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, '..', 'data', 'rly_queue.db');
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('secure_delete = ON'); // MED-4: overwrite deleted data with zeros

  db.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id TEXT NOT NULL,
      envelope TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_queue_recipient ON queue(recipient_id);
    CREATE INDEX IF NOT EXISTS idx_queue_created ON queue(created_at);
  `);

  const stmts = {
    enqueue: db.prepare(`INSERT INTO queue (recipient_id, envelope) VALUES (?, ?)`),
    drain: db.prepare(`DELETE FROM queue WHERE recipient_id = ? RETURNING envelope`),
    purge: db.prepare(`DELETE FROM queue WHERE created_at < ?`),
    count: db.prepare(`SELECT COUNT(*) as count FROM queue WHERE recipient_id = ?`),
  };

  // Auto-purge old messages every hour
  setInterval(() => {
    try {
      stmts.purge.run(Date.now() - RETENTION_MS);
    } catch { /* silent */ }
  }, 60 * 60 * 1000);

  // MED-4: Periodic VACUUM to reclaim space and ensure secure_delete is thorough
  setInterval(() => {
    try { db.exec('VACUUM'); } catch { /* silent */ }
  }, 6 * 60 * 60 * 1000);

  return {
    enqueue(recipientId, envelope) {
      stmts.enqueue.run(recipientId, JSON.stringify(envelope));
    },

    drain(recipientId) {
      const rows = stmts.drain.all(recipientId);
      return rows.map(r => JSON.parse(r.envelope));
    },

    count(recipientId) {
      return stmts.count.get(recipientId)?.count || 0;
    },

    close() {
      db.close();
    },
  };
}
