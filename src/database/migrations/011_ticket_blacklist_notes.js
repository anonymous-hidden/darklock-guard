'use strict';
/**
 * Migration 011: Ticket Blacklist & Notes
 *
 * Adds:
 *  - ticket_blacklist — per-guild user blacklist for tickets
 *  - ticket_notes     — internal staff notes per ticket channel
 *  - priority col on tickets (alias for tag-based priority tracking)
 *  - locked col on tickets (locked channels)
 *  - close_reason col on tickets
 */

module.exports = {
    version: 11,
    name: '011_ticket_blacklist_notes',
    description: 'Add ticket blacklist, staff notes, priority, lock columns',

    async up(db) {
        // ── ticket_blacklist ────────────────────────────────────────────────────
        await db.run(`
            CREATE TABLE IF NOT EXISTS ticket_blacklist (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id   TEXT NOT NULL,
                user_id    TEXT NOT NULL,
                reason     TEXT,
                added_by   TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(guild_id, user_id)
            )
        `);

        // ── ticket_notes ────────────────────────────────────────────────────────
        await db.run(`
            CREATE TABLE IF NOT EXISTS ticket_notes (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id     TEXT NOT NULL,
                guild_id       TEXT NOT NULL,
                content        TEXT NOT NULL,
                added_by_id    TEXT NOT NULL,
                added_by_tag   TEXT,
                created_at     TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_ticket_notes_channel ON ticket_notes(channel_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_ticket_blacklist_guild  ON ticket_blacklist(guild_id)`);

        // ── Extra columns on tickets ─────────────────────────────────────────────
        const addCol = async (table, col, type) => {
            try { await db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); }
            catch (e) { if (!e.message?.includes('duplicate column')) throw e; }
        };

        await addCol('tickets', 'priority',     "TEXT DEFAULT 'normal'");
        await addCol('tickets', 'locked',       'INTEGER DEFAULT 0');
        await addCol('tickets', 'close_reason', 'TEXT');
        await addCol('tickets', 'notes',        "TEXT DEFAULT '[]'");
        await addCol('tickets', 'updated_at',   "TEXT DEFAULT (datetime('now'))");

        // Same extras for active_tickets
        await addCol('active_tickets', 'priority',     "TEXT DEFAULT 'normal'");
        await addCol('active_tickets', 'locked',       'INTEGER DEFAULT 0');
        await addCol('active_tickets', 'close_reason', 'TEXT');

        console.log('[Migration 011] Ticket blacklist & notes complete');
    },

    async down(db) {
        await db.run('DROP TABLE IF EXISTS ticket_blacklist');
        await db.run('DROP TABLE IF EXISTS ticket_notes');
    }
};
