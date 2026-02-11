/**
 * Darklock Public API Routes
 * 
 * Unauthenticated endpoints for:
 * - Maintenance status (for maintenance page polling)
 * - Health check
 * - Public service status
 */

const express = require('express');
const router = express.Router();

// Database
const db = require('../utils/database');

// ============================================================================
// MAINTENANCE STATUS (PUBLIC)
// ============================================================================

/**
 * GET /api/maintenance/status
 * Public endpoint for the maintenance page to check current maintenance state
 * Returns: maintenance info for the requested scope
 */
router.get('/maintenance/status', async (req, res) => {
    try {
        const { scope = 'platform' } = req.query;
        
        // Get maintenance state for the requested scope
        const state = await db.get(`
            SELECT * FROM maintenance_state WHERE scope = ?
        `, [scope]).catch(() => null);

        if (!state || !state.enabled) {
            return res.json({
                success: true,
                maintenance: {
                    enabled: false,
                    scope: scope
                }
            });
        }

        // Parse status updates if present
        let updates = [];
        if (state.status_updates) {
            try {
                updates = JSON.parse(state.status_updates);
            } catch (e) {
                updates = [];
            }
        }

        res.json({
            success: true,
            maintenance: {
                enabled: true,
                scope: state.scope,
                title: state.title || 'Scheduled Maintenance',
                subtitle: state.subtitle || "We'll be back shortly",
                message: state.message || 'We are currently performing scheduled maintenance to improve your experience.',
                scheduledStart: state.scheduled_start,
                scheduledEnd: state.scheduled_end,
                updates: updates.slice(0, 5), // Only send last 5 updates
                discordUrl: process.env.DISCORD_SUPPORT_URL || null
            }
        });
    } catch (err) {
        console.error('[Public API] Maintenance status error:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch maintenance status' 
        });
    }
});

/**
 * GET /api/maintenance/all
 * Get maintenance status for all scopes (for apps that need to check multiple)
 */
router.get('/maintenance/all', async (req, res) => {
    try {
        const states = await db.all(`
            SELECT scope, enabled, title, subtitle, scheduled_end
            FROM maintenance_state
        `).catch(() => []);

        const scopes = {};
        for (const state of states) {
            scopes[state.scope] = {
                enabled: !!state.enabled,
                title: state.title,
                subtitle: state.subtitle,
                scheduledEnd: state.scheduled_end
            };
        }

        res.json({
            success: true,
            scopes,
            anyActive: states.some(s => s.enabled)
        });
    } catch (err) {
        console.error('[Public API] Maintenance all error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch status' });
    }
});

// ============================================================================
// HEALTH CHECK (PUBLIC)
// ============================================================================

/**
 * GET /api/health
 * Simple health check endpoint for uptime monitors
 */
router.get('/health', async (req, res) => {
    try {
        // Quick DB check
        const dbCheck = await db.get(`SELECT 1 as ok`).catch(() => null);
        
        res.json({
            status: dbCheck?.ok === 1 ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: process.env.npm_package_version || '1.0.0'
        });
    } catch (err) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: 'Service check failed'
        });
    }
});

/**
 * GET /api/status
 * Public service status page data
 */
router.get('/status', async (req, res) => {
    try {
        const services = await db.all(`
            SELECT service_name, status, latency_ms, last_check
            FROM service_status
            ORDER BY service_name
        `).catch(() => []);

        // Calculate overall status
        let overallStatus = 'operational';
        for (const service of services) {
            if (service.status === 'major_outage') {
                overallStatus = 'major_outage';
                break;
            } else if (service.status === 'partial_outage' || service.status === 'degraded') {
                overallStatus = 'partial_outage';
            }
        }

        res.json({
            success: true,
            status: overallStatus,
            services: services.map(s => ({
                name: s.service_name,
                status: s.status,
                latency: s.latency_ms,
                lastCheck: s.last_check
            })),
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('[Public API] Status error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch status' });
    }
});

// ============================================================================
// RFID GATEWAY STATUS (PUBLIC)
// ============================================================================

/**
 * GET /api/rfid/status
 * Check RFID gateway status for signin page
 */
router.get('/rfid/status', async (req, res) => {
    try {
        // Try to load RFID client
        const rfidClient = require('../../hardware/rfid_client');
        
        // Query gateway status
        const status = await rfidClient.getStatus();
        
        res.json({
            success: true,
            online: status.online || false,
            cards: status.cards || 0,
            stats: status.stats || {}
        });
    } catch (err) {
        // Gateway offline or not available
        res.json({
            success: true,
            online: false,
            cards: 0,
            error: err.message
        });
    }
});

module.exports = router;
