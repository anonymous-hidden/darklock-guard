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
            SELECT id, email, username, role, display_name, created_at, last_login, active
            FROM admins ORDER BY created_at
        `);
        res.json({ success: true, admins });
    } catch (err) {
        console.error('[Admin API] Get admins error:', err);
        res.status(500).json({ success: false, error: 'Failed to load admins' });
    }
});

module.exports = router;
