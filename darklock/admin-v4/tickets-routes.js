'use strict';
/**
 * Darklock Admin v4 — Ticket Management Routes
 * Mounted at: /api/v4/admin/tickets
 *
 * Reads/writes the bot's security_bot.db directly (same process).
 * Tables used:
 *   tickets            – per-guild ticket records
 *   active_tickets     – mirrors for live tickets
 *   ticket_settings    – per-guild configuration
 *   ticket_blacklist   – blocked users
 *   ticket_notes       – internal staff notes
 *   ticket_transcripts – auto-saved transcripts
 */

const express  = require('express');
const sqlite3  = require('sqlite3').verbose();
const path     = require('path');
const fs       = require('fs');
const router   = express.Router();

// ── Lazy bot-DB singleton ────────────────────────────────────────────────────────
let _botDb = null;

function getBotDb() {
    if (_botDb) return _botDb;

    const dataDir = process.env.DB_PATH || './data';
    const dbName  = process.env.DB_NAME  || 'security_bot.db';
    const dbPath  = path.resolve(dataDir, dbName);

    if (!fs.existsSync(dbPath)) {
        throw new Error(`Bot database not found at: ${dbPath}`);
    }

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
            if (err) return reject(err);
            db.run('PRAGMA journal_mode=WAL');
            db.run('PRAGMA foreign_keys=ON');

            // Promisify helpers
            db.getP  = (sql, p) => new Promise((res, rej) => db.get(sql,  p || [], (e, r)  => e ? rej(e) : res(r)));
            db.allP  = (sql, p) => new Promise((res, rej) => db.all(sql,  p || [], (e, r)  => e ? rej(e) : res(r)));
            db.runP  = (sql, p) => new Promise((res, rej) => db.run(sql,  p || [], function(e) { e ? rej(e) : res(this); }));

            _botDb = db;
            resolve(db);
        });
    });
}

// ── Stat helpers ─────────────────────────────────────────────────────────────────
async function getStats(db) {
    const [totals, today, avgRow] = await Promise.all([
        db.allP(`SELECT status, COUNT(*) as cnt FROM tickets GROUP BY status`),
        db.getP(`SELECT COUNT(*) as cnt FROM tickets WHERE date(created_at) = date('now')`),
        db.getP(`
            SELECT AVG(CAST((julianday(closed_at) - julianday(created_at)) * 1440 AS INTEGER)) as avg_min
            FROM tickets WHERE closed_at IS NOT NULL
        `),
    ]);

    const byStatus = {};
    for (const r of (totals || [])) byStatus[r.status] = r.cnt;

    return {
        total:        (totals || []).reduce((s, r) => s + r.cnt, 0),
        open:         byStatus['open']   || 0,
        closed:       byStatus['closed'] || 0,
        claimed:      byStatus['claimed']|| 0,
        resolved:     byStatus['resolved']||0,
        today:        today?.cnt || 0,
        avg_minutes:  avgRow?.avg_min ? Math.round(avgRow.avg_min) : null,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /stats  — global ticket statistics
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
    try {
        const db = await getBotDb();
        const stats = await getStats(db);

        // Top categories
        const cats = await db.allP(`
            SELECT category, COUNT(*) as cnt FROM tickets WHERE category IS NOT NULL
            GROUP BY category ORDER BY cnt DESC LIMIT 5
        `);

        // Recent activity (last 7 days)
        const trend = await db.allP(`
            SELECT date(created_at) as day, COUNT(*) as cnt
            FROM tickets
            WHERE created_at >= date('now', '-7 days')
            GROUP BY day ORDER BY day ASC
        `);

        res.json({ success: true, ...stats, categories: cats || [], trend: trend || [] });
    } catch (err) {
        console.error('[Admin Tickets] Stats error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /  — list tickets (paginated, filtered)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
    try {
        const db    = await getBotDb();
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(100, parseInt(req.query.limit) || 25);
        const off   = (page - 1) * limit;

        const allowed = ['created_at', 'updated_at', 'status', 'priority', 'guild_id'];
        const sort    = allowed.includes(req.query.sort) ? req.query.sort : 'created_at';
        const order   = req.query.order === 'ASC' ? 'ASC' : 'DESC';

        const conditions = ['1=1'];
        const params     = [];

        if (req.query.status   && req.query.status   !== 'all') { conditions.push('status   = ?'); params.push(req.query.status); }
        if (req.query.priority && req.query.priority !== 'all') { conditions.push('priority = ?'); params.push(req.query.priority); }
        if (req.query.guild_id)                                  { conditions.push('guild_id = ?'); params.push(req.query.guild_id); }
        if (req.query.category && req.query.category !== 'all') { conditions.push('category = ?'); params.push(req.query.category); }
        if (req.query.search) {
            conditions.push('(subject LIKE ? OR description LIKE ? OR user_tag LIKE ? OR user_id LIKE ?)');
            const q = `%${req.query.search}%`;
            params.push(q, q, q, q);
        }

        const where = conditions.join(' AND ');
        const count = await db.getP(`SELECT COUNT(*) as cnt FROM tickets WHERE ${where}`, params);
        const rows  = await db.allP(
            `SELECT id, guild_id, ticket_id, user_id, user_tag, channel_id,
                    assigned_to, assigned_to_name, status, priority, category,
                    subject, description, tags, severity,
                    created_at, updated_at, closed_at, close_reason,
                    escalated, locked, total_messages, sla_breached
             FROM tickets
             WHERE ${where}
             ORDER BY ${sort} ${order}
             LIMIT ? OFFSET ?`,
            [...params, limit, off]
        );

        const total = count?.cnt || 0;
        res.json({
            success: true,
            tickets: rows || [],
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        console.error('[Admin Tickets] List error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /:id  — single ticket detail
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
    try {
        const db     = await getBotDb();
        const ticket = await db.getP(`SELECT * FROM tickets WHERE id = ?`, [req.params.id]);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

        const notes = await db.allP(
            `SELECT * FROM ticket_notes WHERE channel_id = ? ORDER BY created_at ASC`,
            [ticket.channel_id]
        );

        const messages = await db.allP(
            `SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC LIMIT 200`,
            [ticket.ticket_id || ticket.channel_id]
        );

        const transcript = await db.getP(
            `SELECT content, created_at FROM ticket_transcripts WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1`,
            [ticket.channel_id]
        );

        res.json({ success: true, ticket, notes: notes || [], messages: messages || [], transcript });
    } catch (err) {
        console.error('[Admin Tickets] Get error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PUT /:id/status  — close, reopen, resolve
// ═══════════════════════════════════════════════════════════════════════════════
router.put('/:id/status', async (req, res) => {
    try {
        const db       = await getBotDb();
        const { status, reason } = req.body || {};
        const allowed  = ['closed', 'open', 'resolved', 'claimed'];
        if (!allowed.includes(status))
            return res.status(400).json({ success: false, error: `Invalid status: ${status}` });

        const ticket = await db.getP(`SELECT id, status FROM tickets WHERE id = ?`, [req.params.id]);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

        const now = new Date().toISOString();
        const closedAt   = ['closed', 'resolved'].includes(status) ? now : null;
        const closeReason= reason || null;

        await db.runP(
            `UPDATE tickets
             SET status = ?, close_reason = ?, closed_at = ?,
                 updated_at = ?
             WHERE id = ?`,
            [status, closeReason, closedAt, now, req.params.id]
        );

        // Mirror to active_tickets
        if (status === 'closed' || status === 'resolved') {
            await db.runP(
                `UPDATE active_tickets SET status = ?, updated_at = ? WHERE channel_id = (SELECT channel_id FROM tickets WHERE id = ?)`,
                [status, now, req.params.id]
            );
        }

        res.json({ success: true, status });
    } catch (err) {
        console.error('[Admin Tickets] Status update error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PUT /:id/priority
// ═══════════════════════════════════════════════════════════════════════════════
router.put('/:id/priority', async (req, res) => {
    try {
        const db = await getBotDb();
        const { priority } = req.body || {};
        const allowed = ['low', 'normal', 'high', 'urgent'];
        if (!allowed.includes(priority))
            return res.status(400).json({ success: false, error: 'Invalid priority' });

        await db.runP(
            `UPDATE tickets SET priority = ?, updated_at = ? WHERE id = ?`,
            [priority, new Date().toISOString(), req.params.id]
        );
        res.json({ success: true, priority });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /:id/note  — add staff note
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/:id/note', async (req, res) => {
    try {
        const db = await getBotDb();
        const { content } = req.body || {};
        if (!content || !content.trim())
            return res.status(400).json({ success: false, error: 'Note content required' });

        const ticket = await db.getP(`SELECT channel_id, guild_id FROM tickets WHERE id = ?`, [req.params.id]);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

        await db.runP(
            `INSERT INTO ticket_notes (channel_id, guild_id, content, added_by_id, added_by_tag, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [ticket.channel_id, ticket.guild_id, content.trim(),
             req.admin?.id || 'admin', req.admin?.name || 'Admin',
             new Date().toISOString()]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[Admin Tickets] Note error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DELETE /:id  — delete ticket (owner only)
// ═══════════════════════════════════════════════════════════════════════════════
router.delete('/:id', async (req, res) => {
    try {
        if ((req.admin?.level || 0) < 90)
            return res.status(403).json({ success: false, error: 'Insufficient permissions' });

        const db = await getBotDb();
        const ticket = await db.getP(`SELECT id FROM tickets WHERE id = ?`, [req.params.id]);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

        await db.runP(`DELETE FROM tickets WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  BLACKLIST routes
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/blacklist/all', async (req, res) => {
    try {
        const db = await getBotDb();
        const page  = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, parseInt(req.query.limit) || 25);
        const off   = (page - 1) * limit;

        const conditions = ['1=1'];
        const params     = [];
        if (req.query.guild_id) { conditions.push('guild_id = ?'); params.push(req.query.guild_id); }
        if (req.query.search)   { conditions.push('(user_id LIKE ? OR reason LIKE ?)'); const q = `%${req.query.search}%`; params.push(q, q); }

        const where = conditions.join(' AND ');
        const count  = await db.getP(`SELECT COUNT(*) as cnt FROM ticket_blacklist WHERE ${where}`,  params);
        const rows   = await db.allP(`SELECT * FROM ticket_blacklist WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, off]);

        res.json({ success: true, blacklist: rows || [], pagination: { page, limit, total: count?.cnt || 0, pages: Math.ceil((count?.cnt || 0) / limit) } });
    } catch (err) {
        console.error('[Admin Tickets] Blacklist list error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/blacklist/add', async (req, res) => {
    try {
        const db = await getBotDb();
        const { guild_id, user_id, reason } = req.body || {};
        if (!guild_id || !user_id)
            return res.status(400).json({ success: false, error: 'guild_id and user_id are required' });

        await db.runP(
            `INSERT OR REPLACE INTO ticket_blacklist (guild_id, user_id, reason, added_by, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [guild_id, user_id, reason || null, req.admin?.name || 'Admin', new Date().toISOString()]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[Admin Tickets] Blacklist add error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/blacklist/:guildId/:userId', async (req, res) => {
    try {
        const db = await getBotDb();
        await db.runP(
            `DELETE FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?`,
            [req.params.guildId, req.params.userId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SETTINGS routes — per-guild ticket_settings
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/settings/:guildId', async (req, res) => {
    try {
        const db  = await getBotDb();
        const row = await db.getP(`SELECT * FROM ticket_settings WHERE guild_id = ?`, [req.params.guildId]);
        res.json({ success: true, settings: row || null });
    } catch (err) {
        console.error('[Admin Tickets] Settings get error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/settings/:guildId', async (req, res) => {
    try {
        if ((req.admin?.level || 0) < 50)
            return res.status(403).json({ success: false, error: 'Insufficient permissions' });

        const db = await getBotDb();
        const s  = req.body || {};

        // Safe columns
        const allowed = [
            'enabled', 'category_id', 'support_role_id', 'log_channel_id',
            'ticket_limit', 'auto_close_hours', 'transcript_channel_id',
            'welcome_message', 'close_confirmation', 'severity_enabled',
            'default_severity', 'require_reason', 'require_severity',
            'allow_user_close', 'dm_on_update', 'dm_on_close',
            'panel_title', 'panel_description', 'panel_footer',
            'custom_embed_color', 'custom_open_emoji', 'custom_close_emoji',
        ];

        const setClauses = [];
        const params     = [];
        for (const col of allowed) {
            if (s[col] !== undefined) {
                setClauses.push(`${col} = ?`);
                params.push(s[col]);
            }
        }
        if (!setClauses.length)
            return res.status(400).json({ success: false, error: 'No valid fields provided' });

        setClauses.push('updated_at = ?');
        params.push(new Date().toISOString());
        params.push(req.params.guildId);

        // Upsert
        const existing = await db.getP(`SELECT guild_id FROM ticket_settings WHERE guild_id = ?`, [req.params.guildId]);
        if (existing) {
            await db.runP(`UPDATE ticket_settings SET ${setClauses.join(', ')} WHERE guild_id = ?`, params);
        } else {
            const cols = ['guild_id', ...allowed.filter(c => s[c] !== undefined)];
            const vals = [req.params.guildId, ...allowed.filter(c => s[c] !== undefined).map(c => s[c])];
            await db.runP(
                `INSERT INTO ticket_settings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
                vals
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[Admin Tickets] Settings update error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /guilds/list  — list guild IDs that have tickets
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/guilds/list', async (req, res) => {
    try {
        const db   = await getBotDb();
        const rows = await db.allP(`
            SELECT guild_id, COUNT(*) as ticket_count,
                   SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_count
            FROM tickets GROUP BY guild_id ORDER BY ticket_count DESC
        `);
        res.json({ success: true, guilds: rows || [] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
