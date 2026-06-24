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
const os = require('os');
const net = require('net');

// Database
const db = require('../utils/database');

function getActionsToken() {
    return process.env.CHATGPT_ACTIONS_TOKEN || process.env.API_ACTIONS_TOKEN || '';
}

function requireActionsToken(req, res, next) {
    const token = getActionsToken();
    if (!token) {
        return res.status(503).json({
            success: false,
            error: 'ChatGPT Actions token not configured'
        });
    }

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const provided = auth.slice('Bearer '.length).trim();
    if (provided !== token) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    return next();
}

function checkPort(port, host = '127.0.0.1', timeoutMs = 1200) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let finished = false;

        const done = (open) => {
            if (finished) return;
            finished = true;
            try { socket.destroy(); } catch (_) {}
            resolve(open);
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
        socket.connect(port, host);
    });
}

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

// ============================================================================
// CHATGPT ACTIONS STATUS API (TOKEN PROTECTED)
// ============================================================================

/**
 * GET /api/chatgpt/health
 * Token-protected health snapshot for ChatGPT Actions.
 */
 router.get('/chatgpt/health', requireActionsToken, async (req, res) => {
    try {
        const dbCheck = await db.get(`SELECT 1 as ok`).catch(() => null);
        const now = new Date().toISOString();
        const healthy = dbCheck?.ok === 1;

        res.json({
            success: true,
            status: healthy ? 'healthy' : 'degraded',
            timestamp: now,
            host: os.hostname(),
            nodeVersion: process.version,
            uptimeSec: Math.floor(process.uptime()),
            memory: process.memoryUsage(),
            db: healthy ? 'ok' : 'error'
        });
    } catch (err) {
        res.status(503).json({
            success: false,
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: 'Service check failed'
        });
    }
});

/**
 * GET /api/chatgpt/services
 * Token-protected local service reachability on common DarkLock ports.
 */
    router.get('/chatgpt/services', requireActionsToken, async (req, res) => {
    const serviceDefs = [
        { name: 'discord-bot', port: 3001 },
        { name: 'darklock-platform', port: Number(process.env.DARKLOCK_PORT || process.env.PORT || 3002) },
        { name: 'room-control-bridge', port: 3099 },
        { name: 'darklock-notes-server', port: 3003 },
        { name: 'secure-channel-ids', port: 4100 },
        { name: 'secure-channel-relay', port: 4101 },
        { name: 'jarvis-api', port: 8950 },
        { name: 'ollama', port: 11434 }
    ];

    const statuses = await Promise.all(serviceDefs.map(async (svc) => ({
        name: svc.name,
        port: svc.port,
        reachable: await checkPort(svc.port)
    })));

    const down = statuses.filter(s => !s.reachable).map(s => s.name);
    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        summary: down.length === 0 ? 'all_reachable' : 'partial_outage',
        down,
        services: statuses
    });
});

/**
 * GET /api/chatgpt/info
 * Token-protected quick reference for external access and key URLs.
 */
router.get('/chatgpt/info', requireActionsToken, async (req, res) => {
    const base = process.env.PUBLIC_BASE_URL || 'https://admin.darklock.net';

    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        host: os.hostname(),
        environment: process.env.NODE_ENV || 'development',
        urls: {
            dashboard: `${base}/`,
            admin: `${base}/admin`,
            platform: `${base}/platform`,
            platformHealth: `${base}/platform/api/health`,
            publicHealth: `${base}/api/health`
        },
        notes: [
            'Use Authorization: Bearer <CHATGPT_ACTIONS_TOKEN> for /api/chatgpt/* endpoints.',
            'Set CHATGPT_ACTIONS_TOKEN in .env before exposing these actions publicly.'
        ]
    });
});

module.exports = router;
