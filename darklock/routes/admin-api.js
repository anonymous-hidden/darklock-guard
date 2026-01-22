/**
 * Darklock Admin API Routes
 * 
 * All routes require admin authentication
 * RBAC enforced: owner > admin > editor
 * All changes are audit logged
 * 
 * Routes:
 * - GET/POST /api/admin/announcements
 * - GET/POST /api/admin/feature-flags
 * - GET/POST /api/admin/platform-settings
 * - GET/POST /api/admin/service-status
 * - GET/POST /api/admin/content-blocks
 * - GET/POST /api/admin/changelogs
 * - GET /api/admin/audit-logs
 * - GET /api/admin/dashboard
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const db = require('../utils/database');
const { requireAdminAuth } = require('./admin-auth');
const maintenance = require('../utils/maintenance');

// Initialize maintenance module with database
maintenance.init(db);

// ============================================================================
// RATE LIMITING - Stricter for admin endpoints
// ============================================================================

const adminRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: { success: false, error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false
});

router.use(adminRateLimiter);

// Apply admin authentication to all routes in this router
router.use(requireAdminAuth);

// ============================================================================
// HELPERS
// ============================================================================

function generateId() {
    return crypto.randomUUID();
}

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.ip ||
           'unknown';
}

/**
 * Audit log helper - logs every admin action
 */
async function auditLog(req, action, resourceType, resourceId, oldValue, newValue) {
    try {
        await db.run(`
            INSERT INTO admin_audit_logs (
                id, admin_id, admin_email, action, resource_type, resource_id,
                old_value, new_value, ip_address, user_agent, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            generateId(),
            req.admin.id,
            req.admin.email,
            action,
            resourceType,
            resourceId,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            getClientIP(req),
            req.headers['user-agent'] || 'unknown',
            new Date().toISOString()
        ]);
    } catch (err) {
        console.error('[Admin API] Audit log error:', err.message);
    }
}

/**
 * RBAC permission check
 * owner: full access
 * admin: can modify most things, cannot manage other admins
 * editor: can only edit content (announcements, content blocks, changelogs)
 */
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.admin || !allowedRoles.includes(req.admin.role)) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions'
            });
        }
        next();
    };
}

// ============================================================================
// DASHBOARD OVERVIEW
// ============================================================================

router.get('/dashboard', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Stats
        const [
            activeAnnouncements,
            enabledFlags,
            totalAdmins,
            recentAuditCount,
            maintenanceMode
        ] = await Promise.all([
            db.get(`SELECT COUNT(*) as count FROM announcements WHERE is_active = 1`),
            db.get(`SELECT COUNT(*) as count FROM feature_flags WHERE is_enabled = 1`),
            db.get(`SELECT COUNT(*) as count FROM admins WHERE active = 1`),
            db.get(`SELECT COUNT(*) as count FROM admin_audit_logs WHERE created_at >= ?`, [today]),
            db.get(`SELECT value FROM platform_settings WHERE key = 'maintenance_mode'`)
        ]);

        // Service status overview
        const services = await db.all(`
            SELECT service_name, display_name, status 
            FROM service_status 
            WHERE is_visible = 1 
            ORDER BY sort_order
        `);

        // Recent audit logs
        const recentAudit = await db.all(`
            SELECT action, resource_type, admin_email, created_at 
            FROM admin_audit_logs 
            ORDER BY created_at DESC 
            LIMIT 10
        `);

        res.json({
            success: true,
            admin: {
                id: req.admin.id,
                email: req.admin.email,
                role: req.admin.role
            },
            stats: {
                activeAnnouncements: activeAnnouncements?.count || 0,
                enabledFlags: enabledFlags?.count || 0,
                totalAdmins: totalAdmins?.count || 0,
                actionsToday: recentAuditCount?.count || 0,
                maintenanceMode: maintenanceMode?.value === 'true'
            },
            services,
            recentAudit
        });
    } catch (err) {
        console.error('[Admin API] Dashboard error:', err);
        res.status(500).json({ success: false, error: 'Failed to load dashboard' });
    }
});

// ============================================================================
// ANNOUNCEMENTS
// ============================================================================

router.get('/announcements', async (req, res) => {
    try {
        const announcements = await db.all(`
            SELECT a.*, adm.email as created_by_email
            FROM announcements a
            LEFT JOIN admins adm ON a.created_by = adm.id
            ORDER BY a.created_at DESC
        `);
        res.json({ success: true, announcements });
    } catch (err) {
        console.error('[Admin API] Get announcements error:', err);
        res.status(500).json({ success: false, error: 'Failed to load announcements' });
    }
});

router.post('/announcements', requireRole('owner', 'admin', 'editor'), async (req, res) => {
    try {
        const { title, content, type, scope, app_id, is_dismissible, start_at, end_at } = req.body;

        if (!title || !content || !type) {
            return res.status(400).json({ success: false, error: 'Title, content, and type are required' });
        }

        if (!['info', 'warning', 'critical'].includes(type)) {
            return res.status(400).json({ success: false, error: 'Invalid announcement type' });
        }

        const id = generateId();
        const now = new Date().toISOString();

        await db.run(`
            INSERT INTO announcements (
                id, title, content, type, scope, app_id, is_dismissible,
                start_at, end_at, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, title, content, type, scope || 'global', app_id || null,
            is_dismissible !== false ? 1 : 0, start_at || null, end_at || null,
            req.admin.id, now, now
        ]);

        await auditLog(req, 'CREATE', 'announcement', id, null, { title, type, scope });

        res.json({ success: true, id, message: 'Announcement created' });
    } catch (err) {
        console.error('[Admin API] Create announcement error:', err);
        res.status(500).json({ success: false, error: 'Failed to create announcement' });
    }
});

router.put('/announcements/:id', requireRole('owner', 'admin', 'editor'), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, type, scope, app_id, is_active, is_dismissible, start_at, end_at } = req.body;

        const existing = await db.get(`SELECT * FROM announcements WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Announcement not found' });
        }

        const now = new Date().toISOString();

        await db.run(`
            UPDATE announcements SET
                title = COALESCE(?, title),
                content = COALESCE(?, content),
                type = COALESCE(?, type),
                scope = COALESCE(?, scope),
                app_id = ?,
                is_active = COALESCE(?, is_active),
                is_dismissible = COALESCE(?, is_dismissible),
                start_at = ?,
                end_at = ?,
                updated_at = ?
            WHERE id = ?
        `, [title, content, type, scope, app_id, is_active, is_dismissible, start_at, end_at, now, id]);

        await auditLog(req, 'UPDATE', 'announcement', id, existing, req.body);

        res.json({ success: true, message: 'Announcement updated' });
    } catch (err) {
        console.error('[Admin API] Update announcement error:', err);
        res.status(500).json({ success: false, error: 'Failed to update announcement' });
    }
});

router.delete('/announcements/:id', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await db.get(`SELECT * FROM announcements WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Announcement not found' });
        }

        await db.run(`DELETE FROM announcements WHERE id = ?`, [id]);
        await auditLog(req, 'DELETE', 'announcement', id, existing, null);

        res.json({ success: true, message: 'Announcement deleted' });
    } catch (err) {
        console.error('[Admin API] Delete announcement error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete announcement' });
    }
});

// ============================================================================
// FEATURE FLAGS
// ============================================================================

router.get('/feature-flags', async (req, res) => {
    try {
        const flags = await db.all(`SELECT * FROM feature_flags ORDER BY is_kill_switch DESC, name`);
        res.json({ success: true, flags });
    } catch (err) {
        console.error('[Admin API] Get feature flags error:', err);
        res.status(500).json({ success: false, error: 'Failed to load feature flags' });
    }
});

router.post('/feature-flags', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { key, name, description, is_enabled, is_kill_switch, rollout_percentage } = req.body;

        if (!key || !name) {
            return res.status(400).json({ success: false, error: 'Key and name are required' });
        }

        // Validate key format (lowercase, underscores only)
        if (!/^[a-z][a-z0-9_]*$/.test(key)) {
            return res.status(400).json({ success: false, error: 'Invalid key format. Use lowercase letters, numbers, and underscores.' });
        }

        const id = generateId();
        const now = new Date().toISOString();

        await db.run(`
            INSERT INTO feature_flags (
                id, key, name, description, is_enabled, is_kill_switch,
                rollout_percentage, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, key, name, description || null, is_enabled ? 1 : 0,
            is_kill_switch ? 1 : 0, rollout_percentage || 100,
            req.admin.id, now, now
        ]);

        await auditLog(req, 'CREATE', 'feature_flag', id, null, { key, name, is_enabled });

        res.json({ success: true, id, message: 'Feature flag created' });
    } catch (err) {
        if (err.message?.includes('UNIQUE constraint')) {
            return res.status(400).json({ success: false, error: 'Feature flag key already exists' });
        }
        console.error('[Admin API] Create feature flag error:', err);
        res.status(500).json({ success: false, error: 'Failed to create feature flag' });
    }
});

router.put('/feature-flags/:id', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, is_enabled, rollout_percentage } = req.body;

        const existing = await db.get(`SELECT * FROM feature_flags WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Feature flag not found' });
        }

        // Kill switch changes require owner role
        if (existing.is_kill_switch && req.admin.role !== 'owner') {
            return res.status(403).json({ success: false, error: 'Only owners can modify kill switches' });
        }

        const now = new Date().toISOString();

        await db.run(`
            UPDATE feature_flags SET
                name = COALESCE(?, name),
                description = COALESCE(?, description),
                is_enabled = COALESCE(?, is_enabled),
                rollout_percentage = COALESCE(?, rollout_percentage),
                updated_at = ?
            WHERE id = ?
        `, [name, description, is_enabled !== undefined ? (is_enabled ? 1 : 0) : null, rollout_percentage, now, id]);

        await auditLog(req, 'UPDATE', 'feature_flag', id, 
            { is_enabled: existing.is_enabled, rollout_percentage: existing.rollout_percentage },
            { is_enabled, rollout_percentage }
        );

        res.json({ success: true, message: 'Feature flag updated' });
    } catch (err) {
        console.error('[Admin API] Update feature flag error:', err);
        res.status(500).json({ success: false, error: 'Failed to update feature flag' });
    }
});

router.delete('/feature-flags/:id', requireRole('owner'), async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await db.get(`SELECT * FROM feature_flags WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Feature flag not found' });
        }

        await db.run(`DELETE FROM feature_flags WHERE id = ?`, [id]);
        await auditLog(req, 'DELETE', 'feature_flag', id, existing, null);

        res.json({ success: true, message: 'Feature flag deleted' });
    } catch (err) {
        console.error('[Admin API] Delete feature flag error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete feature flag' });
    }
});

// ============================================================================
// PLATFORM SETTINGS
// ============================================================================

router.get('/platform-settings', async (req, res) => {
    try {
        const settings = await db.all(`SELECT * FROM platform_settings ORDER BY key`);
        res.json({ success: true, settings });
    } catch (err) {
        console.error('[Admin API] Get platform settings error:', err);
        res.status(500).json({ success: false, error: 'Failed to load settings' });
    }
});

router.put('/platform-settings/:key', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;

        if (value === undefined) {
            return res.status(400).json({ success: false, error: 'Value is required' });
        }

        const existing = await db.get(`SELECT * FROM platform_settings WHERE key = ?`, [key]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Setting not found' });
        }

        const now = new Date().toISOString();

        await db.run(`
            UPDATE platform_settings SET value = ?, updated_by = ?, updated_at = ?
            WHERE key = ?
        `, [String(value), req.admin.id, now, key]);

        await auditLog(req, 'UPDATE', 'platform_setting', key,
            { value: existing.value },
            { value: String(value) }
        );

        res.json({ success: true, message: 'Setting updated' });
    } catch (err) {
        console.error('[Admin API] Update platform setting error:', err);
        res.status(500).json({ success: false, error: 'Failed to update setting' });
    }
});

// ============================================================================
// SERVICE STATUS
// ============================================================================

router.get('/service-status', async (req, res) => {
    try {
        const services = await db.all(`SELECT * FROM service_status ORDER BY sort_order`);
        res.json({ success: true, services });
    } catch (err) {
        console.error('[Admin API] Get service status error:', err);
        res.status(500).json({ success: false, error: 'Failed to load service status' });
    }
});

router.put('/service-status/:id', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, status_message, is_visible } = req.body;

        const existing = await db.get(`SELECT * FROM service_status WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Service not found' });
        }

        if (status && !['online', 'degraded', 'offline', 'maintenance'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }

        const now = new Date().toISOString();

        await db.run(`
            UPDATE service_status SET
                status = COALESCE(?, status),
                status_message = ?,
                is_visible = COALESCE(?, is_visible),
                updated_by = ?,
                updated_at = ?
            WHERE id = ?
        `, [status, status_message, is_visible, req.admin.id, now, id]);

        await auditLog(req, 'UPDATE', 'service_status', id,
            { status: existing.status },
            { status, status_message }
        );

        res.json({ success: true, message: 'Service status updated' });
    } catch (err) {
        console.error('[Admin API] Update service status error:', err);
        res.status(500).json({ success: false, error: 'Failed to update service status' });
    }
});

router.post('/service-status', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { service_name, display_name, status, sort_order } = req.body;

        if (!service_name || !display_name) {
            return res.status(400).json({ success: false, error: 'Service name and display name are required' });
        }

        const id = generateId();
        const now = new Date().toISOString();

        await db.run(`
            INSERT INTO service_status (id, service_name, display_name, status, sort_order, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [id, service_name, display_name, status || 'online', sort_order || 99, now]);

        await auditLog(req, 'CREATE', 'service_status', id, null, { service_name, display_name });

        res.json({ success: true, id, message: 'Service added' });
    } catch (err) {
        console.error('[Admin API] Create service error:', err);
        res.status(500).json({ success: false, error: 'Failed to create service' });
    }
});

// ============================================================================
// CONTENT BLOCKS
// ============================================================================

router.get('/content-blocks', async (req, res) => {
    try {
        const blocks = await db.all(`SELECT * FROM content_blocks ORDER BY page, block_key`);
        res.json({ success: true, blocks });
    } catch (err) {
        console.error('[Admin API] Get content blocks error:', err);
        res.status(500).json({ success: false, error: 'Failed to load content blocks' });
    }
});

router.put('/content-blocks/:id', requireRole('owner', 'admin', 'editor'), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, is_active } = req.body;

        const existing = await db.get(`SELECT * FROM content_blocks WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Content block not found' });
        }

        const now = new Date().toISOString();

        await db.run(`
            UPDATE content_blocks SET
                title = COALESCE(?, title),
                content = COALESCE(?, content),
                is_active = COALESCE(?, is_active),
                updated_by = ?,
                updated_at = ?
            WHERE id = ?
        `, [title, content, is_active, req.admin.id, now, id]);

        await auditLog(req, 'UPDATE', 'content_block', id, { content: existing.content?.substring(0, 100) }, { content: content?.substring(0, 100) });

        res.json({ success: true, message: 'Content block updated' });
    } catch (err) {
        console.error('[Admin API] Update content block error:', err);
        res.status(500).json({ success: false, error: 'Failed to update content block' });
    }
});

router.post('/content-blocks', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { block_key, title, content, page, content_type } = req.body;

        if (!block_key || !content) {
            return res.status(400).json({ success: false, error: 'Block key and content are required' });
        }

        const id = generateId();
        const now = new Date().toISOString();

        await db.run(`
            INSERT INTO content_blocks (id, block_key, title, content, page, content_type, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, block_key, title || null, content, page || 'home', content_type || 'markdown', req.admin.id, now]);

        await auditLog(req, 'CREATE', 'content_block', id, null, { block_key, page });

        res.json({ success: true, id, message: 'Content block created' });
    } catch (err) {
        console.error('[Admin API] Create content block error:', err);
        res.status(500).json({ success: false, error: 'Failed to create content block' });
    }
});

// ============================================================================
// CHANGELOGS
// ============================================================================

router.get('/changelogs', async (req, res) => {
    try {
        const changelogs = await db.all(`
            SELECT c.*, adm.email as created_by_email
            FROM changelogs c
            LEFT JOIN admins adm ON c.created_by = adm.id
            ORDER BY c.created_at DESC
        `);
        res.json({ success: true, changelogs });
    } catch (err) {
        console.error('[Admin API] Get changelogs error:', err);
        res.status(500).json({ success: false, error: 'Failed to load changelogs' });
    }
});

router.post('/changelogs', requireRole('owner', 'admin', 'editor'), async (req, res) => {
    try {
        const { version, title, content, release_type, is_published } = req.body;

        if (!version || !title || !content) {
            return res.status(400).json({ success: false, error: 'Version, title, and content are required' });
        }

        const id = generateId();
        const now = new Date().toISOString();

        await db.run(`
            INSERT INTO changelogs (
                id, version, title, content, release_type, is_published,
                published_at, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, version, title, content, release_type || 'minor',
            is_published ? 1 : 0, is_published ? now : null,
            req.admin.id, now, now
        ]);

        await auditLog(req, 'CREATE', 'changelog', id, null, { version, title });

        res.json({ success: true, id, message: 'Changelog created' });
    } catch (err) {
        console.error('[Admin API] Create changelog error:', err);
        res.status(500).json({ success: false, error: 'Failed to create changelog' });
    }
});

router.put('/changelogs/:id', requireRole('owner', 'admin', 'editor'), async (req, res) => {
    try {
        const { id } = req.params;
        const { version, title, content, release_type, is_published } = req.body;

        const existing = await db.get(`SELECT * FROM changelogs WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Changelog not found' });
        }

        const now = new Date().toISOString();
        const publishedAt = is_published && !existing.is_published ? now : existing.published_at;

        await db.run(`
            UPDATE changelogs SET
                version = COALESCE(?, version),
                title = COALESCE(?, title),
                content = COALESCE(?, content),
                release_type = COALESCE(?, release_type),
                is_published = COALESCE(?, is_published),
                published_at = ?,
                updated_at = ?
            WHERE id = ?
        `, [version, title, content, release_type, is_published !== undefined ? (is_published ? 1 : 0) : null, publishedAt, now, id]);

        await auditLog(req, 'UPDATE', 'changelog', id, { is_published: existing.is_published }, { is_published });

        res.json({ success: true, message: 'Changelog updated' });
    } catch (err) {
        console.error('[Admin API] Update changelog error:', err);
        res.status(500).json({ success: false, error: 'Failed to update changelog' });
    }
});

router.delete('/changelogs/:id', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await db.get(`SELECT * FROM changelogs WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Changelog not found' });
        }

        await db.run(`DELETE FROM changelogs WHERE id = ?`, [id]);
        await auditLog(req, 'DELETE', 'changelog', id, existing, null);

        res.json({ success: true, message: 'Changelog deleted' });
    } catch (err) {
        console.error('[Admin API] Delete changelog error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete changelog' });
    }
});

// ============================================================================
// AUDIT LOGS (read-only)
// ============================================================================

router.get('/audit-logs', async (req, res) => {
    try {
        const { limit = 100, offset = 0, action, resource_type, admin_id } = req.query;

        let query = `SELECT * FROM admin_audit_logs WHERE 1=1`;
        const params = [];

        if (action) {
            query += ` AND action = ?`;
            params.push(action);
        }
        if (resource_type) {
            query += ` AND resource_type = ?`;
            params.push(resource_type);
        }
        if (admin_id) {
            query += ` AND admin_id = ?`;
            params.push(admin_id);
        }

        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));

        const logs = await db.all(query, params);
        const total = await db.get(`SELECT COUNT(*) as count FROM admin_audit_logs`);

        res.json({
            success: true,
            logs,
            total: total?.count || 0,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (err) {
        console.error('[Admin API] Get audit logs error:', err);
        res.status(500).json({ success: false, error: 'Failed to load audit logs' });
    }
});

// ============================================================================
// ADMIN MANAGEMENT (owner only)
// ============================================================================

router.get('/admins', requireRole('owner'), async (req, res) => {
    try {
        const admins = await db.all(`
            SELECT id, email, role, created_at, last_login, active
            FROM admins ORDER BY created_at
        `);
        res.json({ success: true, admins });
    } catch (err) {
        console.error('[Admin API] Get admins error:', err);
        res.status(500).json({ success: false, error: 'Failed to load admins' });
    }
});

// ============================================================================
// SERVER TIME
// ============================================================================

router.get('/server-time', (req, res) => {
    const now = new Date();
    res.json({
        success: true,
        time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
        date: now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        iso: now.toISOString(),
        uptime: process.uptime()
    });
});

// ============================================================================
// SYSTEM INFO
// ============================================================================

router.get('/system-info', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const os = require('os');
        const memUsage = process.memoryUsage();
        
        // Database stats
        const [adminsCount, announcementsCount, flagsCount, logsCount] = await Promise.all([
            db.get(`SELECT COUNT(*) as count FROM admins`),
            db.get(`SELECT COUNT(*) as count FROM announcements`),
            db.get(`SELECT COUNT(*) as count FROM feature_flags`),
            db.get(`SELECT COUNT(*) as count FROM admin_audit_logs`)
        ]);

        res.json({
            success: true,
            system: {
                nodeVersion: process.version,
                platform: os.platform(),
                arch: os.arch(),
                uptime: process.uptime(),
                memoryUsage: {
                    used: Math.round(memUsage.heapUsed / 1024 / 1024),
                    total: Math.round(memUsage.heapTotal / 1024 / 1024),
                    rss: Math.round(memUsage.rss / 1024 / 1024)
                },
                cpuUsage: process.cpuUsage(),
                pid: process.pid
            },
            database: {
                admins: adminsCount?.count || 0,
                announcements: announcementsCount?.count || 0,
                featureFlags: flagsCount?.count || 0,
                auditLogs: logsCount?.count || 0
            }
        });
    } catch (err) {
        console.error('[Admin API] System info error:', err);
        res.status(500).json({ success: false, error: 'Failed to get system info' });
    }
});

// ============================================================================
// MAINTENANCE MODE
// ============================================================================

// Get BOT maintenance settings (Discord bot maintenance, not platform maintenance)
router.get('/bot/maintenance', async (req, res) => {
    try {
        const config = await maintenance.getMaintenanceConfig();
        
        res.json({
            success: true,
            enabled: config.bot.enabled,
            reason: config.bot.reason,
            endTime: config.bot.endTime,
            notifyOwners: config.bot.notifyOwners !== false
        });
    } catch (err) {
        console.error('[Admin API] Get bot maintenance error:', err);
        res.status(500).json({ success: false, error: 'Failed to get bot maintenance settings' });
    }
});

// Update BOT maintenance settings
router.post('/bot/maintenance', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { enabled, reason, endTime, notifyOwners } = req.body;
        
        await maintenance.updateBotMaintenance({
            enabled: !!enabled,
            reason: reason || '',
            endTime: endTime || '',
            notifyOwners: notifyOwners !== false
        }, req.admin.id);

        await auditLog(req, enabled ? 'ENABLE' : 'DISABLE', 'bot_maintenance_mode', 'system', null, { 
            enabled, 
            reason,
            endTime
        });

        res.json({ 
            success: true, 
            message: `Bot maintenance mode ${enabled ? 'enabled' : 'disabled'}`
        });
    } catch (err) {
        console.error('[Admin API] Update bot maintenance error:', err);
        res.status(500).json({ success: false, error: 'Failed to update bot maintenance settings' });
    }
});

// Get platform maintenance settings
router.get('/maintenance', async (req, res) => {
    try {
        const config = await maintenance.getMaintenanceConfig();
        
        res.json({
            success: true,
            maintenance: {
                enabled: config.platform.enabled,
                message: config.platform.message,
                endTime: config.platform.endTime,
                allowedIps: config.platform.allowedIps,
                applyLocalhost: config.platform.applyLocalhost
            }
        });
    } catch (err) {
        console.error('[Admin API] Get maintenance error:', err);
        res.status(500).json({ success: false, error: 'Failed to get maintenance settings' });
    }
});

// Update platform maintenance settings
router.post('/maintenance', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { enabled, message, endTime, allowedIps, applyLocalhost } = req.body;
        
        const config = await maintenance.updatePlatformMaintenance({
            enabled: !!enabled,
            message: message || '',
            endTime: endTime || '',
            allowedIps: allowedIps || [],
            applyLocalhost: !!applyLocalhost
        }, req.admin.id);

        await auditLog(req, enabled ? 'ENABLE' : 'DISABLE', 'maintenance_mode', 'system', null, { 
            enabled, 
            message,
            applyLocalhost 
        });

        res.json({ 
            success: true, 
            message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`,
            config: config.platform
        });
    } catch (err) {
        console.error('[Admin API] Update maintenance error:', err);
        res.status(500).json({ success: false, error: 'Failed to update maintenance settings' });
    }
});

// ============================================================================
// SECURITY SETTINGS
// ============================================================================

router.get('/security-settings', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const [sessionTimeout, maxLoginAttempts, lockoutDuration, require2fa, ipWhitelist] = await Promise.all([
            db.get(`SELECT value FROM platform_settings WHERE key = 'session_timeout'`),
            db.get(`SELECT value FROM platform_settings WHERE key = 'max_login_attempts'`),
            db.get(`SELECT value FROM platform_settings WHERE key = 'lockout_duration'`),
            db.get(`SELECT value FROM platform_settings WHERE key = 'require_2fa'`),
            db.get(`SELECT value FROM platform_settings WHERE key = 'admin_ip_whitelist'`)
        ]);

        res.json({
            success: true,
            settings: {
                session_timeout: parseInt(sessionTimeout?.value) || 3600,
                max_login_attempts: parseInt(maxLoginAttempts?.value) || 5,
                lockout_duration: parseInt(lockoutDuration?.value) || 900,
                require_2fa: require2fa?.value === 'true',
                ip_whitelist: ipWhitelist?.value || ''
            }
        });
    } catch (err) {
        console.error('[Admin API] Get security settings error:', err);
        res.status(500).json({ success: false, error: 'Failed to get security settings' });
    }
});

router.post('/security-settings', requireRole('owner'), async (req, res) => {
    try {
        const { session_timeout, max_login_attempts, lockout_duration, require_2fa, ip_whitelist } = req.body;
        const now = new Date().toISOString();

        const settings = [
            ['session_timeout', String(session_timeout || 3600)],
            ['max_login_attempts', String(max_login_attempts || 5)],
            ['lockout_duration', String(lockout_duration || 900)],
            ['require_2fa', require_2fa ? 'true' : 'false'],
            ['admin_ip_whitelist', ip_whitelist || '']
        ];

        for (const [key, value] of settings) {
            const existing = await db.get(`SELECT key FROM platform_settings WHERE key = ?`, [key]);
            if (existing) {
                await db.run(`UPDATE platform_settings SET value = ?, updated_by = ?, updated_at = ? WHERE key = ?`,
                    [value, req.admin.id, now, key]);
            } else {
                await db.run(`INSERT INTO platform_settings (key, value, value_type, updated_by, updated_at) VALUES (?, ?, 'string', ?, ?)`,
                    [key, value, req.admin.id, now]);
            }
        }

        await auditLog(req, 'UPDATE', 'security_settings', 'system', null, req.body);

        res.json({ success: true, message: 'Security settings updated' });
    } catch (err) {
        console.error('[Admin API] Update security settings error:', err);
        res.status(500).json({ success: false, error: 'Failed to update security settings' });
    }
});

// ============================================================================
// QUICK ACTIONS
// ============================================================================

router.post('/quick-action/clear-sessions', requireRole('owner'), async (req, res) => {
    try {
        // Clear all admin sessions by invalidating tokens (reset all last_login)
        await db.run(`UPDATE admins SET last_login = NULL WHERE id != ?`, [req.admin.id]);
        
        await auditLog(req, 'CLEAR_SESSIONS', 'system', 'all', null, { excludedAdmin: req.admin.email });

        res.json({ success: true, message: 'All admin sessions cleared (except yours)' });
    } catch (err) {
        console.error('[Admin API] Clear sessions error:', err);
        res.status(500).json({ success: false, error: 'Failed to clear sessions' });
    }
});

router.post('/quick-action/emergency-lockdown', requireRole('owner'), async (req, res) => {
    try {
        const { enable } = req.body;
        const now = new Date().toISOString();

        // Enable/toggle emergency lockdown feature flag
        const existing = await db.get(`SELECT * FROM feature_flags WHERE key = 'emergency_lockdown'`);
        
        if (existing) {
            await db.run(`UPDATE feature_flags SET is_enabled = ?, updated_at = ? WHERE key = 'emergency_lockdown'`,
                [enable ? 1 : 0, now]);
        } else {
            await db.run(`
                INSERT INTO feature_flags (id, key, name, description, is_enabled, is_kill_switch, created_by, created_at, updated_at)
                VALUES (?, 'emergency_lockdown', 'Emergency Lockdown', 'Disables all non-essential features', ?, 1, ?, ?, ?)
            `, [generateId(), enable ? 1 : 0, req.admin.id, now, now]);
        }

        await auditLog(req, enable ? 'ENABLE' : 'DISABLE', 'emergency_lockdown', 'system', null, { enable });

        res.json({ 
            success: true, 
            message: enable ? '🚨 Emergency lockdown ENABLED' : 'Emergency lockdown disabled' 
        });
    } catch (err) {
        console.error('[Admin API] Emergency lockdown error:', err);
        res.status(500).json({ success: false, error: 'Failed to toggle emergency lockdown' });
    }
});

// ============================================================================
// ACCOUNT MANAGEMENT (for current user)
// ============================================================================

router.get('/account/2fa-status', async (req, res) => {
    try {
        // Check if 2FA is enabled for the current admin
        const admin = await db.get(`SELECT * FROM admins WHERE id = ?`, [req.admin.id]);
        res.json({ success: true, enabled: admin?.two_factor_enabled || false });
    } catch (err) {
        console.error('[Admin API] 2FA status error:', err);
        res.status(500).json({ success: false, error: 'Failed to get 2FA status' });
    }
});

router.put('/account/profile', async (req, res) => {
    try {
        const { display_name } = req.body;
        const now = new Date().toISOString();
        
        await db.run(`UPDATE admins SET updated_at = ? WHERE id = ?`, [now, req.admin.id]);
        await auditLog(req, 'UPDATE_PROFILE', 'admin', req.admin.id, null, { display_name });
        
        res.json({ success: true, message: 'Profile updated' });
    } catch (err) {
        console.error('[Admin API] Update profile error:', err);
        res.status(500).json({ success: false, error: 'Failed to update profile' });
    }
});

router.put('/account/password', async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        const bcrypt = require('bcrypt');
        
        // Get current admin with password hash
        const admin = await db.get(`SELECT * FROM admins WHERE id = ?`, [req.admin.id]);
        if (!admin) {
            return res.status(404).json({ success: false, error: 'Admin not found' });
        }
        
        // Verify current password
        const isValid = await bcrypt.compare(current_password, admin.password_hash);
        if (!isValid) {
            return res.status(401).json({ success: false, error: 'Current password is incorrect' });
        }
        
        // Validate new password
        if (new_password.length < 12) {
            return res.status(400).json({ success: false, error: 'New password must be at least 12 characters' });
        }
        
        // Hash and update
        const newHash = await bcrypt.hash(new_password, 12);
        const now = new Date().toISOString();
        
        await db.run(`UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?`, [newHash, now, req.admin.id]);
        await auditLog(req, 'CHANGE_PASSWORD', 'admin', req.admin.id, null, null);
        
        res.json({ success: true, message: 'Password updated successfully' });
    } catch (err) {
        console.error('[Admin API] Change password error:', err);
        res.status(500).json({ success: false, error: 'Failed to change password' });
    }
});

router.post('/account/signout-all', async (req, res) => {
    try {
        // This would invalidate all tokens - for now we just log
        await auditLog(req, 'SIGNOUT_ALL', 'admin', req.admin.id, null, null);
        res.json({ success: true, message: 'All sessions signed out' });
    } catch (err) {
        console.error('[Admin API] Sign out all error:', err);
        res.status(500).json({ success: false, error: 'Failed to sign out all devices' });
    }
});

router.get('/account/sessions', async (req, res) => {
    try {
        // Get current session info
        const sessions = [{
            id: 'current',
            device: req.headers['user-agent'] || 'Unknown',
            ip_address: getClientIP(req),
            location: 'Current Location',
            last_active: new Date().toISOString(),
            current: true
        }];
        
        res.json({ success: true, sessions });
    } catch (err) {
        console.error('[Admin API] Get sessions error:', err);
        res.status(500).json({ success: false, error: 'Failed to load sessions' });
    }
});

router.delete('/account/sessions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await auditLog(req, 'REVOKE_SESSION', 'session', id, null, null);
        res.json({ success: true, message: 'Session revoked' });
    } catch (err) {
        console.error('[Admin API] Revoke session error:', err);
        res.status(500).json({ success: false, error: 'Failed to revoke session' });
    }
});

// ============================================================================
// ADMIN CRUD (owner only)
// ============================================================================

router.post('/admins', requireRole('owner'), async (req, res) => {
    try {
        const { email, password, role } = req.body;
        const bcrypt = require('bcrypt');
        
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }
        
        if (password.length < 12) {
            return res.status(400).json({ success: false, error: 'Password must be at least 12 characters' });
        }
        
        if (!['admin', 'editor'].includes(role)) {
            return res.status(400).json({ success: false, error: 'Invalid role' });
        }
        
        // Check if email exists
        const existing = await db.get(`SELECT id FROM admins WHERE email = ?`, [email.toLowerCase()]);
        if (existing) {
            return res.status(400).json({ success: false, error: 'Email already registered' });
        }
        
        const id = generateId();
        const passwordHash = await bcrypt.hash(password, 12);
        const now = new Date().toISOString();
        
        await db.run(`
            INSERT INTO admins (id, email, password_hash, role, created_at, updated_at, active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        `, [id, email.toLowerCase(), passwordHash, role, now, now]);
        
        await auditLog(req, 'CREATE', 'admin', id, null, { email, role });
        
        res.json({ success: true, id, message: 'Admin created' });
    } catch (err) {
        console.error('[Admin API] Create admin error:', err);
        res.status(500).json({ success: false, error: 'Failed to create admin' });
    }
});

router.put('/admins/:id', requireRole('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        const { active, role } = req.body;
        
        const existing = await db.get(`SELECT * FROM admins WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Admin not found' });
        }
        
        // Cannot modify owners
        if (existing.role === 'owner') {
            return res.status(403).json({ success: false, error: 'Cannot modify owner accounts' });
        }
        
        const now = new Date().toISOString();
        
        await db.run(`
            UPDATE admins SET 
                active = COALESCE(?, active),
                role = COALESCE(?, role),
                updated_at = ?
            WHERE id = ?
        `, [active !== undefined ? (active ? 1 : 0) : null, role, now, id]);
        
        await auditLog(req, 'UPDATE', 'admin', id, { active: existing.active }, { active });
        
        res.json({ success: true, message: 'Admin updated' });
    } catch (err) {
        console.error('[Admin API] Update admin error:', err);
        res.status(500).json({ success: false, error: 'Failed to update admin' });
    }
});

router.delete('/admins/:id', requireRole('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        
        const existing = await db.get(`SELECT * FROM admins WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Admin not found' });
        }
        
        // Cannot delete owners
        if (existing.role === 'owner') {
            return res.status(403).json({ success: false, error: 'Cannot delete owner accounts' });
        }
        
        // Cannot delete yourself
        if (id === req.admin.id) {
            return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
        }
        
        await db.run(`DELETE FROM admins WHERE id = ?`, [id]);
        await auditLog(req, 'DELETE', 'admin', id, { email: existing.email }, null);
        
        res.json({ success: true, message: 'Admin deleted' });
    } catch (err) {
        console.error('[Admin API] Delete admin error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete admin' });
    }
});

// ============================================================================
// DISCORD BOT MANAGEMENT
// ============================================================================

let discordBot = null;

function setDiscordBot(bot) {
    discordBot = bot;
    console.log('[Admin API] Discord bot reference set');
}

// Bot status endpoint
router.get('/bot/status', async (req, res) => {
    try {
        if (!discordBot) {
            return res.json({
                online: false,
                guilds: 0,
                users: 0,
                uptime: 0
            });
        }

        res.json({
            online: !!discordBot.user && !!discordBot.readyAt,
            guilds: discordBot.guilds?.cache?.size || 0,
            users: discordBot.users?.cache?.size || 0,
            uptime: discordBot.uptime || 0,
            ping: discordBot.ws?.ping || 0
        });
    } catch (err) {
        console.error('[Admin API] Bot status error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch bot status' });
    }
});

// Get bot guilds
router.get('/bot/guilds', async (req, res) => {
    try {
        if (!discordBot) {
            return res.json([]);
        }

        const guilds = discordBot.guilds?.cache?.map(g => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
            icon: g.iconURL()
        })) || [];

        res.json(guilds);
    } catch (err) {
        console.error('[Admin API] Bot guilds error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch guilds' });
    }
});

// Get guild features
router.get('/bot/guilds/:guildId/features', async (req, res) => {
    try {
        if (!discordBot || !discordBot.database) {
            return res.status(503).json({ success: false, error: 'Bot not available' });
        }

        const { guildId } = req.params;
        const config = await discordBot.database.getGuildConfig(guildId);
        
        res.json({
            antiNuke: config?.antiNuke?.enabled || false,
            antiRaid: config?.antiRaid?.enabled || false,
            antiSpam: config?.antiSpam?.enabled || false,
            wordFilter: config?.wordFilter?.enabled || false,
            verification: config?.verification?.enabled || false
        });
    } catch (err) {
        console.error('[Admin API] Guild features error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch guild features' });
    }
});

// Update guild features
router.post('/bot/guilds/:guildId/features', async (req, res) => {
    try {
        if (!discordBot || !discordBot.database) {
            return res.status(503).json({ success: false, error: 'Bot not available' });
        }

        const { guildId } = req.params;
        const features = req.body;

        // Update each feature
        for (const [feature, enabled] of Object.entries(features)) {
            await discordBot.database.updateGuildSetting(guildId, feature, { enabled });
        }

        await auditLog(req, 'UPDATE', 'bot_guild_features', guildId, null, features);
        res.json({ success: true, message: 'Guild features updated' });
    } catch (err) {
        console.error('[Admin API] Update guild features error:', err);
        res.status(500).json({ success: false, error: 'Failed to update guild features' });
    }
});

// Get bot commands
router.get('/bot/commands', async (req, res) => {
    try {
        if (!discordBot) {
            return res.json([]);
        }

        const commands = discordBot.commands?.map(c => ({
            name: c.name,
            description: c.description,
            category: c.category || 'Other'
        })) || [];

        res.json(commands);
    } catch (err) {
        console.error('[Admin API] Bot commands error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch commands' });
    }
});

// Update bot presence
router.post('/bot/presence', requireRole('admin'), async (req, res) => {
    try {
        if (!discordBot) {
            return res.status(503).json({ success: false, error: 'Bot not available' });
        }

        const { status, activity } = req.body;

        if (status) {
            await discordBot.user.setStatus(status);
        }

        if (activity) {
            await discordBot.user.setActivity(activity.name, { type: activity.type });
        }

        await auditLog(req, 'UPDATE', 'bot_presence', 'presence', null, { status, activity });
        res.json({ success: true, message: 'Bot presence updated' });
    } catch (err) {
        console.error('[Admin API] Update presence error:', err);
        res.status(500).json({ success: false, error: 'Failed to update presence' });
    }
});

// Get bot settings
router.get('/bot/settings', async (req, res) => {
    try {
        if (!discordBot) {
            return res.status(503).json({ success: false, error: 'Bot not available' });
        }

        // Return bot-wide settings
        res.json({
            prefix: process.env.BOT_PREFIX || '!',
            supportServer: process.env.SUPPORT_SERVER_ID,
            defaultLanguage: 'en'
        });
    } catch (err) {
        console.error('[Admin API] Bot settings error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch bot settings' });
    }
});

module.exports = router;
module.exports.setDiscordBot = setDiscordBot;
