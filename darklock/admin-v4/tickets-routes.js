'use strict';
/**
 * Darklock Admin v4 — Ticket Management Routes
 * Mounted at: /api/v4/admin/tickets
 *
 * Reads/writes the bot's security_bot.db directly (same process).
 * Supports both ticket schemas used in production:
 *   tickets            – legacy/advanced ticket records
 *   help_tickets       – /help command ticket records
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
let _ticketTableInfo = null;

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

async function getTicketTableInfo(db) {
    if (_ticketTableInfo) return _ticketTableInfo;

    const rows = await db.allP(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name IN ('tickets', 'help_tickets')
    `);

    const names = new Set((rows || []).map(r => r.name));
    _ticketTableInfo = {
        hasTickets: names.has('tickets'),
        hasHelpTickets: names.has('help_tickets'),
    };

    return _ticketTableInfo;
}

function normalizeHelpStatus(status) {
    // Keep UI semantics: "claimed" and "in_progress" are equivalent active-assigned states.
    if (status === 'in_progress') return 'claimed';
    return status;
}

async function findTicketById(db, tableInfo, id) {
    if (tableInfo.hasTickets) {
        const row = await db.getP(`SELECT *, 'tickets' as source FROM tickets WHERE id = ?`, [id]);
        if (row) return row;
    }

    if (tableInfo.hasHelpTickets) {
        const row = await db.getP(`SELECT *, 'help_tickets' as source FROM help_tickets WHERE id = ? OR ticket_id = ?`, [id, id]);
        if (row) {
            return {
                ...row,
                status: normalizeHelpStatus(row.status),
                close_reason: row.response || null,
                closed_at: row.resolved_at || null,
                channel_id: null,
                user_tag: row.user_id,
                assigned_to_name: null,
                tags: null,
                severity: null,
                escalated: 0,
                locked: 0,
                total_messages: null,
                sla_breached: 0,
            };
        }
    }

    return null;
}

// ── Stat helpers ─────────────────────────────────────────────────────────────────
async function getStats(db, tableInfo) {
    let total = 0;
    let open = 0;
    let closed = 0;
    let claimed = 0;
    let resolved = 0;
    let today = 0;

    let avgWeightedSum = 0;
    let avgWeightedCount = 0;

    if (tableInfo.hasTickets) {
        const [totals, todayRow, avgRow] = await Promise.all([
            db.allP(`SELECT status, COUNT(*) as cnt FROM tickets GROUP BY status`),
            db.getP(`SELECT COUNT(*) as cnt FROM tickets WHERE date(created_at) = date('now')`),
            db.getP(`
                SELECT
                    COUNT(*) as n,
                    AVG((julianday(closed_at) - julianday(created_at)) * 1440.0) as avg_min
                FROM tickets
                WHERE closed_at IS NOT NULL
            `),
        ]);

        for (const r of (totals || [])) {
            const status = String(r.status || '').toLowerCase();
            const cnt = Number(r.cnt || 0);
            total += cnt;
            if (status === 'open') open += cnt;
            if (status === 'claimed') claimed += cnt;
            if (status === 'closed') closed += cnt;
            if (status === 'resolved') resolved += cnt;
        }

        today += Number(todayRow?.cnt || 0);

        if (avgRow?.n && avgRow?.avg_min != null) {
            avgWeightedSum += Number(avgRow.avg_min) * Number(avgRow.n);
            avgWeightedCount += Number(avgRow.n);
        }
    }

    if (tableInfo.hasHelpTickets) {
        const [totals, todayRow, avgRow] = await Promise.all([
            db.allP(`SELECT status, COUNT(*) as cnt FROM help_tickets GROUP BY status`),
            db.getP(`SELECT COUNT(*) as cnt FROM help_tickets WHERE date(created_at) = date('now')`),
            db.getP(`
                SELECT
                    COUNT(*) as n,
                    AVG((julianday(resolved_at) - julianday(created_at)) * 1440.0) as avg_min
                FROM help_tickets
                WHERE resolved_at IS NOT NULL
            `),
        ]);

        for (const r of (totals || [])) {
            const status = String(r.status || '').toLowerCase();
            const cnt = Number(r.cnt || 0);
            total += cnt;
            if (status === 'open') open += cnt;
            if (status === 'claimed' || status === 'in_progress') claimed += cnt;
            if (status === 'closed') closed += cnt;
            if (status === 'resolved') resolved += cnt;
        }

        today += Number(todayRow?.cnt || 0);

        if (avgRow?.n && avgRow?.avg_min != null) {
            avgWeightedSum += Number(avgRow.avg_min) * Number(avgRow.n);
            avgWeightedCount += Number(avgRow.n);
        }
    }

    return {
        total,
        open,
        closed,
        claimed,
        resolved,
        today,
        avg_minutes: avgWeightedCount > 0 ? Math.round(avgWeightedSum / avgWeightedCount) : null,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /stats  — global ticket statistics
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
    try {
        const db = await getBotDb();
        const tableInfo = await getTicketTableInfo(db);
        const stats = await getStats(db, tableInfo);

        const categoryMap = new Map();
        const trendMap = new Map();

        if (tableInfo.hasTickets) {
            const [cats, trend] = await Promise.all([
                db.allP(`
                    SELECT category, COUNT(*) as cnt FROM tickets WHERE category IS NOT NULL
                    GROUP BY category
                `),
                db.allP(`
                    SELECT date(created_at) as day, COUNT(*) as cnt
                    FROM tickets
                    WHERE created_at >= date('now', '-7 days')
                    GROUP BY day
                `),
            ]);

            for (const c of (cats || [])) {
                categoryMap.set(c.category, (categoryMap.get(c.category) || 0) + Number(c.cnt || 0));
            }
            for (const r of (trend || [])) {
                trendMap.set(r.day, (trendMap.get(r.day) || 0) + Number(r.cnt || 0));
            }
        }

        if (tableInfo.hasHelpTickets) {
            const [cats, trend] = await Promise.all([
                db.allP(`
                    SELECT category, COUNT(*) as cnt FROM help_tickets WHERE category IS NOT NULL
                    GROUP BY category
                `),
                db.allP(`
                    SELECT date(created_at) as day, COUNT(*) as cnt
                    FROM help_tickets
                    WHERE created_at >= date('now', '-7 days')
                    GROUP BY day
                `),
            ]);

            for (const c of (cats || [])) {
                categoryMap.set(c.category, (categoryMap.get(c.category) || 0) + Number(c.cnt || 0));
            }
            for (const r of (trend || [])) {
                trendMap.set(r.day, (trendMap.get(r.day) || 0) + Number(r.cnt || 0));
            }
        }

        const categories = [...categoryMap.entries()]
            .map(([category, cnt]) => ({ category, cnt }))
            .sort((a, b) => b.cnt - a.cnt)
            .slice(0, 5);

        const trend = [...trendMap.entries()]
            .map(([day, cnt]) => ({ day, cnt }))
            .sort((a, b) => a.day.localeCompare(b.day));

        res.json({ success: true, ...stats, categories, trend });
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
        const tableInfo = await getTicketTableInfo(db);
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(100, parseInt(req.query.limit) || 25);
        const off   = (page - 1) * limit;

        const allowed = ['created_at', 'updated_at', 'status', 'priority', 'guild_id'];
        const sort    = allowed.includes(req.query.sort) ? req.query.sort : 'created_at';
        const order   = req.query.order === 'ASC' ? 'ASC' : 'DESC';

        if (!tableInfo.hasTickets && !tableInfo.hasHelpTickets) {
            return res.json({
                success: true,
                tickets: [],
                pagination: { page, limit, total: 0, pages: 0 },
            });
        }

        const classicConditions = ['1=1'];
        const classicParams = [];
        const helpConditions = ['1=1'];
        const helpParams = [];

        if (req.query.status && req.query.status !== 'all') {
            classicConditions.push('status = ?');
            classicParams.push(req.query.status);

            if (req.query.status === 'claimed') {
                helpConditions.push(`status IN ('claimed', 'in_progress')`);
            } else {
                helpConditions.push('status = ?');
                helpParams.push(req.query.status);
            }
        }
        if (req.query.priority && req.query.priority !== 'all') {
            classicConditions.push('priority = ?');
            classicParams.push(req.query.priority);
            helpConditions.push('priority = ?');
            helpParams.push(req.query.priority);
        }
        if (req.query.guild_id) {
            classicConditions.push('guild_id = ?');
            classicParams.push(req.query.guild_id);
            helpConditions.push('guild_id = ?');
            helpParams.push(req.query.guild_id);
        }
        if (req.query.category && req.query.category !== 'all') {
            classicConditions.push('category = ?');
            classicParams.push(req.query.category);
            helpConditions.push('category = ?');
            helpParams.push(req.query.category);
        }
        if (req.query.search) {
            const q = `%${req.query.search}%`;
            classicConditions.push('(subject LIKE ? OR description LIKE ? OR user_tag LIKE ? OR user_id LIKE ? OR ticket_id LIKE ?)');
            classicParams.push(q, q, q, q, q);
            helpConditions.push('(subject LIKE ? OR description LIKE ? OR user_id LIKE ? OR ticket_id LIKE ?)');
            helpParams.push(q, q, q, q);
        }

        const classicWhere = classicConditions.join(' AND ');
        const helpWhere = helpConditions.join(' AND ');

        const countPromises = [];
        if (tableInfo.hasTickets) {
            countPromises.push(db.getP(`SELECT COUNT(*) as cnt FROM tickets WHERE ${classicWhere}`, classicParams));
        } else {
            countPromises.push(Promise.resolve({ cnt: 0 }));
        }
        if (tableInfo.hasHelpTickets) {
            countPromises.push(db.getP(`SELECT COUNT(*) as cnt FROM help_tickets WHERE ${helpWhere}`, helpParams));
        } else {
            countPromises.push(Promise.resolve({ cnt: 0 }));
        }

        const [classicCount, helpCount] = await Promise.all(countPromises);

        let rows = [];
        if (tableInfo.hasTickets && tableInfo.hasHelpTickets) {
            rows = await db.allP(
                `SELECT * FROM (
                    SELECT
                        'tickets' as source,
                        CAST(id AS TEXT) as id,
                        guild_id, ticket_id, user_id, user_tag, channel_id,
                        assigned_to, assigned_to_name,
                        status,
                        priority, category, subject, description, tags, severity,
                        created_at, updated_at,
                        closed_at,
                        close_reason,
                        escalated, locked, total_messages, sla_breached
                    FROM tickets
                    WHERE ${classicWhere}

                    UNION ALL

                    SELECT
                        'help_tickets' as source,
                        CAST(id AS TEXT) as id,
                        guild_id, ticket_id, user_id,
                        user_id as user_tag,
                        NULL as channel_id,
                        assigned_to,
                        NULL as assigned_to_name,
                        CASE WHEN status = 'in_progress' THEN 'claimed' ELSE status END as status,
                        priority, category, subject, description,
                        NULL as tags,
                        NULL as severity,
                        created_at, updated_at,
                        resolved_at as closed_at,
                        response as close_reason,
                        0 as escalated,
                        0 as locked,
                        NULL as total_messages,
                        0 as sla_breached
                    FROM help_tickets
                    WHERE ${helpWhere}
                ) combined
                ORDER BY ${sort} ${order}
                LIMIT ? OFFSET ?`,
                [...classicParams, ...helpParams, limit, off]
            );
        } else if (tableInfo.hasTickets) {
            rows = await db.allP(
                `SELECT
                    'tickets' as source,
                    CAST(id AS TEXT) as id,
                    guild_id, ticket_id, user_id, user_tag, channel_id,
                    assigned_to, assigned_to_name,
                    status,
                    priority, category, subject, description, tags, severity,
                    created_at, updated_at,
                    closed_at,
                    close_reason,
                    escalated, locked, total_messages, sla_breached
                 FROM tickets
                 WHERE ${classicWhere}
                 ORDER BY ${sort} ${order}
                 LIMIT ? OFFSET ?`,
                [...classicParams, limit, off]
            );
        } else {
            rows = await db.allP(
                `SELECT
                    'help_tickets' as source,
                    CAST(id AS TEXT) as id,
                    guild_id, ticket_id, user_id,
                    user_id as user_tag,
                    NULL as channel_id,
                    assigned_to,
                    NULL as assigned_to_name,
                    CASE WHEN status = 'in_progress' THEN 'claimed' ELSE status END as status,
                    priority, category, subject, description,
                    NULL as tags,
                    NULL as severity,
                    created_at, updated_at,
                    resolved_at as closed_at,
                    response as close_reason,
                    0 as escalated,
                    0 as locked,
                    NULL as total_messages,
                    0 as sla_breached
                 FROM help_tickets
                 WHERE ${helpWhere}
                 ORDER BY ${sort} ${order}
                 LIMIT ? OFFSET ?`,
                [...helpParams, limit, off]
            );
        }

        const total = Number(classicCount?.cnt || 0) + Number(helpCount?.cnt || 0);
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
        const db = await getBotDb();
        const tableInfo = await getTicketTableInfo(db);
        const ticket = await findTicketById(db, tableInfo, req.params.id);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

        let notes = [];
        let messages = [];
        let transcript = null;

        if (ticket.source === 'tickets') {
            notes = await db.allP(
                `SELECT * FROM ticket_notes WHERE channel_id = ? ORDER BY created_at ASC`,
                [ticket.channel_id]
            );

            messages = await db.allP(
                `SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC LIMIT 200`,
                [ticket.ticket_id || ticket.channel_id]
            );

            transcript = await db.getP(
                `SELECT content, created_at FROM ticket_transcripts WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1`,
                [ticket.channel_id]
            );
        } else {
            notes = await db.allP(
                `
                SELECT
                    id,
                    ticket_id,
                    user_id as added_by_id,
                    user_id as added_by_tag,
                    REPLACE(content, '[INTERNAL NOTE] ', '') as content,
                    created_at
                FROM help_ticket_messages
                WHERE ticket_id = ? AND is_admin = 2
                ORDER BY created_at ASC
                `,
                [ticket.ticket_id]
            );

            messages = await db.allP(
                `
                SELECT
                    id,
                    ticket_id,
                    user_id,
                    content,
                    is_admin,
                    created_at
                FROM help_ticket_messages
                WHERE ticket_id = ?
                ORDER BY created_at ASC
                LIMIT 200
                `,
                [ticket.ticket_id]
            );
        }

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
        const db = await getBotDb();
        const tableInfo = await getTicketTableInfo(db);
        const { status, reason } = req.body || {};
        const allowed  = ['closed', 'open', 'resolved', 'claimed'];
        if (!allowed.includes(status))
            return res.status(400).json({ success: false, error: `Invalid status: ${status}` });

        const ticket = await findTicketById(db, tableInfo, req.params.id);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

        const now = new Date().toISOString();
        const closedAt = ['closed', 'resolved'].includes(status) ? now : null;
        const closeReason = reason || null;

        if (ticket.source === 'tickets') {
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
        } else {
            const mappedStatus = status === 'claimed' ? 'in_progress' : status;
            await db.runP(
                `UPDATE help_tickets
                 SET status = ?, response = COALESCE(?, response), resolved_at = ?, updated_at = ?
                 WHERE id = ?`,
                [mappedStatus, closeReason, ['closed', 'resolved'].includes(mappedStatus) ? now : null, now, ticket.id]
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
        const tableInfo = await getTicketTableInfo(db);
        const { priority } = req.body || {};
        const allowed = ['low', 'normal', 'high', 'urgent'];
        if (!allowed.includes(priority))
            return res.status(400).json({ success: false, error: 'Invalid priority' });

        const ticket = await findTicketById(db, tableInfo, req.params.id);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

        if (ticket.source === 'tickets') {
            await db.runP(
                `UPDATE tickets SET priority = ?, updated_at = ? WHERE id = ?`,
                [priority, new Date().toISOString(), req.params.id]
            );
        } else {
            await db.runP(
                `UPDATE help_tickets SET priority = ?, updated_at = ? WHERE id = ?`,
                [priority, new Date().toISOString(), ticket.id]
            );
        }
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
        const tableInfo = await getTicketTableInfo(db);
        const { content } = req.body || {};
        if (!content || !content.trim())
            return res.status(400).json({ success: false, error: 'Note content required' });

        const ticket = await findTicketById(db, tableInfo, req.params.id);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

        if (ticket.source === 'tickets') {
            await db.runP(
                `INSERT INTO ticket_notes (channel_id, guild_id, content, added_by_id, added_by_tag, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [ticket.channel_id, ticket.guild_id, content.trim(),
                 req.admin?.id || 'admin', req.admin?.name || 'Admin',
                 new Date().toISOString()]
            );
        } else {
            await db.runP(
                `INSERT INTO help_ticket_messages (ticket_id, user_id, content, is_admin, created_at)
                 VALUES (?, ?, ?, 2, ?)`,
                [ticket.ticket_id, req.admin?.id || 'admin', `[INTERNAL NOTE] ${content.trim()}`, new Date().toISOString()]
            );
        }

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
        const tableInfo = await getTicketTableInfo(db);
        const ticket = await findTicketById(db, tableInfo, req.params.id);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

        if (ticket.source === 'tickets') {
            await db.runP(`DELETE FROM tickets WHERE id = ?`, [req.params.id]);
        } else {
            await db.runP(`DELETE FROM help_ticket_messages WHERE ticket_id = ?`, [ticket.ticket_id]);
            await db.runP(`DELETE FROM help_tickets WHERE id = ?`, [ticket.id]);
        }
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
        const db = await getBotDb();
        const tableInfo = await getTicketTableInfo(db);
        const guildMap = new Map();

        if (tableInfo.hasTickets) {
            const rows = await db.allP(`
                SELECT guild_id, COUNT(*) as ticket_count,
                       SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_count
                FROM tickets
                GROUP BY guild_id
            `);
            for (const r of (rows || [])) {
                const current = guildMap.get(r.guild_id) || { guild_id: r.guild_id, ticket_count: 0, open_count: 0 };
                current.ticket_count += Number(r.ticket_count || 0);
                current.open_count += Number(r.open_count || 0);
                guildMap.set(r.guild_id, current);
            }
        }

        if (tableInfo.hasHelpTickets) {
            const rows = await db.allP(`
                SELECT guild_id, COUNT(*) as ticket_count,
                       SUM(CASE WHEN status IN ('open','in_progress','claimed') THEN 1 ELSE 0 END) as open_count
                FROM help_tickets
                GROUP BY guild_id
            `);
            for (const r of (rows || [])) {
                const current = guildMap.get(r.guild_id) || { guild_id: r.guild_id, ticket_count: 0, open_count: 0 };
                current.ticket_count += Number(r.ticket_count || 0);
                current.open_count += Number(r.open_count || 0);
                guildMap.set(r.guild_id, current);
            }
        }

        const guilds = [...guildMap.values()].sort((a, b) => b.ticket_count - a.ticket_count);
        res.json({ success: true, guilds });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
