/**
 * Room Control - DB schema + helpers
 * ===================================
 * Persists in the existing darklock.db.
 *
 * Tables:
 *   room_passwords      - one-time-per-IP access passwords
 *   room_sessions       - active panel sessions (cookie -> identity)
 *   room_action_logs    - every panel action, with IP + username
 *   room_config         - singleton k/v table for slug, etc.
 */

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../utils/database');

const BCRYPT_ROUNDS = 12;

async function init() {
    await db.run(`
        CREATE TABLE IF NOT EXISTS room_passwords (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            password_hash TEXT NOT NULL,
            preview       TEXT NOT NULL,                  -- first 6 + last 4 chars for admin UI
            length        INTEGER NOT NULL,
            label         TEXT,                            -- optional name e.g. "for Alex"
            status        TEXT NOT NULL DEFAULT 'active',  -- active | claimed | revoked
            permissions   TEXT NOT NULL DEFAULT 'buzzer_active,buzzer_songs,lights', -- comma-separated
            created_at    TEXT NOT NULL,
            claimed_at    TEXT,
            claimed_ip    TEXT,
            claimed_username TEXT,
            revoked_at    TEXT
        )
    `);
    // Migrate existing rows that have no permissions column
    try {
        await db.run(`ALTER TABLE room_passwords ADD COLUMN permissions TEXT NOT NULL DEFAULT 'buzzer_active,buzzer_songs,lights'`);
    } catch { /* column already exists */ }
    await db.run(`CREATE INDEX IF NOT EXISTS idx_room_passwords_status ON room_passwords(status)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_room_passwords_ip ON room_passwords(claimed_ip)`);

    await db.run(`
        CREATE TABLE IF NOT EXISTS room_sessions (
            id            TEXT PRIMARY KEY,                -- random session id (cookie value)
            password_id   INTEGER NOT NULL,
            ip            TEXT NOT NULL,
            username      TEXT,
            user_agent    TEXT,
            created_at    TEXT NOT NULL,
            last_active   TEXT NOT NULL,
            expires_at    TEXT NOT NULL,
            revoked_at    TEXT,
            FOREIGN KEY (password_id) REFERENCES room_passwords(id)
        )
    `);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_room_sessions_ip ON room_sessions(ip)`);

    await db.run(`
        CREATE TABLE IF NOT EXISTS room_action_logs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id    TEXT,
            ip            TEXT NOT NULL,
            username      TEXT,
            action        TEXT NOT NULL,
            params        TEXT,
            result        TEXT,
            success       INTEGER NOT NULL DEFAULT 1,
            user_agent    TEXT,
            created_at    TEXT NOT NULL
        )
    `);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_room_logs_username ON room_action_logs(username)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_room_logs_ip ON room_action_logs(ip)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_room_logs_created ON room_action_logs(created_at)`);

    await db.run(`
        CREATE TABLE IF NOT EXISTS room_config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);

    // Ensure a hidden slug exists
    const slugRow = await db.get(`SELECT value FROM room_config WHERE key='slug'`);
    if (!slugRow) {
        const slug = crypto.randomBytes(16).toString('hex'); // 32-char hex
        await db.run(`INSERT INTO room_config (key, value) VALUES ('slug', ?)`, [slug]);
        console.log('[RoomCtrl] Generated hidden URL slug:', slug);
    }

    console.log('[RoomCtrl] Schema ready');
}

async function getSlug() {
    const row = await db.get(`SELECT value FROM room_config WHERE key='slug'`);
    return row ? row.value : null;
}

async function rotateSlug() {
    const slug = crypto.randomBytes(16).toString('hex');
    await db.run(`INSERT OR REPLACE INTO room_config (key, value) VALUES ('slug', ?)`, [slug]);
    return slug;
}

// ---- Passwords -------------------------------------------------------------
function generateRandomPassword(length = 250) {
    // URL-safe printable charset
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += charset[bytes[i] % charset.length];
    return out;
}

// All available permission keys
const ALL_PERMISSIONS = ['buzzer_active', 'buzzer_songs', 'lights'];

function normalizePermissions(perms) {
    if (!perms) return ALL_PERMISSIONS.join(',');
    if (Array.isArray(perms)) return perms.filter(p => ALL_PERMISSIONS.includes(p)).join(',');
    if (typeof perms === 'string') return perms.split(',').filter(p => ALL_PERMISSIONS.includes(p.trim())).join(',');
    return ALL_PERMISSIONS.join(',');
}

async function createPassword({ length = 250, label = null, permissions = null } = {}) {
    const plain = generateRandomPassword(length);
    const hash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
    const preview = plain.slice(0, 6) + '...' + plain.slice(-4);
    const permsStr = normalizePermissions(permissions);
    const r = await db.run(
        `INSERT INTO room_passwords (password_hash, preview, length, label, permissions, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [hash, preview, length, label, permsStr, new Date().toISOString()]
    );
    return { id: r.lastID, plain, preview, length, label, permissions: permsStr };
}

async function listActivePasswords() {
    return db.all(`SELECT id, preview, length, label, permissions, status, created_at, claimed_at, claimed_ip, claimed_username
                   FROM room_passwords ORDER BY created_at DESC`);
}

/**
 * Try to consume a password for the given IP. Returns the password row on
 * success (and marks claimed). On any failure returns null.
 *
 * Rules:
 *  - Active passwords can be claimed by the first IP that submits them.
 *    They become "claimed" and bound to that IP.
 *  - Already-claimed passwords ONLY validate again if the IP matches.
 *  - Revoked passwords never validate.
 */
async function consumePassword(plain, ip) {
    if (!plain || typeof plain !== 'string') return null;
    if (plain.length < 16 || plain.length > 1024) return null; // sanity bounds
    const rows = await db.all(
        `SELECT id, password_hash, status, claimed_ip FROM room_passwords
         WHERE status IN ('active','claimed')`
    );
    for (const row of rows) {
        let match = false;
        try { match = await bcrypt.compare(plain, row.password_hash); } catch { match = false; }
        if (!match) continue;

        if (row.status === 'revoked') return null;
        if (row.status === 'claimed') {
            if (row.claimed_ip && row.claimed_ip === ip) return row;   // same IP returning
            return null;                                                // different IP -> deny
        }
        // active -> claim it for this IP
        await db.run(
            `UPDATE room_passwords
             SET status='claimed', claimed_at=?, claimed_ip=?
             WHERE id=? AND status='active'`,
            [new Date().toISOString(), ip, row.id]
        );
        return { ...row, status: 'claimed', claimed_ip: ip };
    }
    return null;
}

async function getPasswordById(id) {
    return db.get(`SELECT * FROM room_passwords WHERE id = ?`, [id]);
}

async function revokePassword(id) {
    await db.run(`UPDATE room_passwords SET status='revoked', revoked_at=? WHERE id=?`,
        [new Date().toISOString(), id]);
}

// ---- Sessions --------------------------------------------------------------
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

async function createSession({ passwordId, ip, userAgent }) {
    const id = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_TTL_MS);
    await db.run(
        `INSERT INTO room_sessions (id, password_id, ip, user_agent, created_at, last_active, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, passwordId, ip, userAgent || '', now.toISOString(), now.toISOString(), expires.toISOString()]
    );
    return { id, expires };
}

async function getSession(id) {
    if (!id) return null;
    const row = await db.get(`SELECT * FROM room_sessions WHERE id = ?`, [id]);
    if (!row) return null;
    if (row.revoked_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return row;
}

async function setSessionUsername(id, username) {
    await db.run(`UPDATE room_sessions SET username=? WHERE id=?`, [username, id]);
}

async function touchSession(id) {
    await db.run(`UPDATE room_sessions SET last_active=? WHERE id=?`,
        [new Date().toISOString(), id]);
}

async function revokeSession(id) {
    await db.run(`UPDATE room_sessions SET revoked_at=? WHERE id=?`,
        [new Date().toISOString(), id]);
}

// ---- Logs ------------------------------------------------------------------
async function logAction({ sessionId, ip, username, action, params, result, success, userAgent }) {
    try {
        await db.run(
            `INSERT INTO room_action_logs
             (session_id, ip, username, action, params, result, success, user_agent, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                sessionId || null,
                ip,
                username || null,
                action,
                params ? JSON.stringify(params).slice(0, 4000) : null,
                result ? JSON.stringify(result).slice(0, 4000) : null,
                success ? 1 : 0,
                userAgent || null,
                new Date().toISOString(),
            ]
        );
    } catch (e) {
        console.error('[RoomCtrl] logAction failed:', e.message);
    }
}

async function recentLogs(limit = 100) {
    return db.all(
        `SELECT id, session_id, ip, username, action, params, result, success, created_at
         FROM room_action_logs ORDER BY id DESC LIMIT ?`,
        [Math.min(1000, Math.max(1, parseInt(limit, 10) || 100))]
    );
}

module.exports = {
    init,
    getSlug,
    rotateSlug,
    generateRandomPassword,
    createPassword,
    listActivePasswords,
    consumePassword,
    getPasswordById,
    revokePassword,
    createSession,
    getSession,
    setSessionUsername,
    touchSession,
    revokeSession,
    logAction,
    recentLogs,
    ALL_PERMISSIONS,
};
