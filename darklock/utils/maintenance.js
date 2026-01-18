/**
 * Centralized Maintenance Mode Configuration & Enforcement
 * Single source of truth for all maintenance-related settings and checks
 */

const path = require('path');

// Use singleton pattern for database connection
let db = null;

/**
 * Initialize the maintenance module with database connection
 * @param {Object} database - Database instance
 */
function init(database) {
    db = database;
}

/**
 * Get the full maintenance configuration from database
 * This is the SINGLE SOURCE OF TRUTH for maintenance state
 * @returns {Promise<Object>} Maintenance configuration
 */
async function getMaintenanceConfig() {
    if (!db) {
        console.error('[Maintenance] Database not initialized');
        return getDefaultConfig();
    }

    try {
        const keys = [
            'maintenance_mode',
            'maintenance_message', 
            'maintenance_end_time',
            'maintenance_allowed_ips',
            'maintenance_apply_localhost',
            'bot_maintenance'
        ];

        const results = await Promise.all(
            keys.map(key => db.get(`SELECT value FROM platform_settings WHERE key = ?`, [key]))
        );

        const [enabled, message, endTime, allowedIps, applyLocalhost, botMaintenance] = results;

        // Parse bot maintenance JSON
        let botMaintenanceData = { enabled: false, reason: '', endTime: null };
        if (botMaintenance?.value) {
            try {
                botMaintenanceData = JSON.parse(botMaintenance.value);
            } catch (e) {
                console.error('[Maintenance] Failed to parse bot_maintenance:', e.message);
            }
        }

        return {
            platform: {
                enabled: enabled?.value === 'true',
                message: message?.value || 'We are currently performing scheduled maintenance. Please check back soon.',
                endTime: endTime?.value || null,
                allowedIps: allowedIps?.value ? allowedIps.value.split(',').map(ip => ip.trim()).filter(Boolean) : [],
                applyLocalhost: applyLocalhost?.value === 'true'
            },
            bot: {
                enabled: botMaintenanceData.enabled || false,
                reason: botMaintenanceData.reason || '',
                endTime: botMaintenanceData.endTime || null,
                notifyOwners: botMaintenanceData.notifyOwners || false
            }
        };
    } catch (err) {
        console.error('[Maintenance] Error fetching config:', err.message);
        return getDefaultConfig();
    }
}

/**
 * Get default maintenance configuration (fail-safe)
 */
function getDefaultConfig() {
    return {
        platform: {
            enabled: false,
            message: 'We are currently performing scheduled maintenance. Please check back soon.',
            endTime: null,
            allowedIps: [],
            applyLocalhost: false
        },
        bot: {
            enabled: false,
            reason: '',
            endTime: null,
            notifyOwners: false
        }
    };
}

/**
 * Check if a request should be blocked by maintenance mode
 * @param {Object} req - Express request object
 * @param {Object} config - Maintenance configuration (optional, will fetch if not provided)
 * @returns {Promise<Object>} { blocked: boolean, reason: string, config: Object }
 */
async function shouldBlockRequest(req, config = null) {
    if (!config) {
        config = await getMaintenanceConfig();
    }

    // Check if either platform or bot maintenance is enabled
    const maintenanceActive = config.platform.enabled || config.bot.enabled;

    if (!maintenanceActive) {
        return { blocked: false, reason: null, config };
    }

    // Get client IP
    const clientIP = getClientIP(req);

    // Check bypass rules in order:
    // 1. Explicitly allowed IPs
    if (config.platform.allowedIps.length > 0) {
        for (const allowedIp of config.platform.allowedIps) {
            if (clientIP.includes(allowedIp) || allowedIp.includes(clientIP)) {
                return { blocked: false, reason: 'allowed_ip', config };
            }
        }
    }

    // 2. Localhost bypass (only if applyLocalhost is false)
    const isLocalhost = isLocalhostIP(clientIP);
    if (isLocalhost && !config.platform.applyLocalhost) {
        return { blocked: false, reason: 'localhost_bypass', config };
    }

    // No bypass applies - block the request
    return { 
        blocked: true, 
        reason: config.platform.enabled ? 'platform_maintenance' : 'bot_maintenance',
        config 
    };
}

/**
 * Extract client IP from request
 * @param {Object} req - Express request object
 * @returns {string} Client IP address
 */
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           req.ip ||
           '127.0.0.1';
}

/**
 * Check if an IP is localhost
 * @param {string} ip - IP address to check
 * @returns {boolean}
 */
function isLocalhostIP(ip) {
    const localhostPatterns = [
        '127.0.0.1',
        '::1',
        '::ffff:127.0.0.1',
        'localhost'
    ];
    return localhostPatterns.some(pattern => ip.includes(pattern));
}

/**
 * Check if a path should skip maintenance check
 * @param {string} path - Request path
 * @returns {boolean}
 */
function shouldSkipPath(path) {
    const skipPaths = [
        // Static assets
        '/css/',
        '/js/',
        '/images/',
        '/assets/',
        '/platform/static',
        '/platform/css',
        '/platform/js',
        '/favicon.ico',
        
        // API endpoints (return JSON 503 instead of redirect)
        '/api/',
        '/platform/api/',
        
        // Admin access (always allowed)
        '/admin',
        '/signin',
        '/signout',
        
        // Maintenance page itself (both root and mounted paths)
        '/maintenance',
        '/platform/maintenance',
        
        // Health checks
        '/platform/api/health',
        '/health'
    ];

    return skipPaths.some(skip => path.startsWith(skip));
}

/**
 * Create Express middleware for maintenance enforcement
 * @param {Object} options - Middleware options
 * @returns {Function} Express middleware
 */
function createMiddleware(options = {}) {
    const { 
        onBlock = null, // Custom handler when blocked
        apiMode = false // Return JSON 503 instead of redirect
    } = options;

    return async (req, res, next) => {
        // Use full path including baseUrl for mounted apps
        const fullPath = (req.baseUrl || '') + req.path;
        
        // Skip certain paths
        if (shouldSkipPath(fullPath)) {
            return next();
        }

        try {
            const config = await getMaintenanceConfig();
            const { blocked, reason, config: maintenanceConfig } = await shouldBlockRequest(req, config);

            if (!blocked) {
                return next();
            }

            // Log maintenance block
            const clientIP = getClientIP(req);
            console.log(`[Maintenance] Blocked request from ${clientIP} to ${fullPath} (reason: ${reason})`);

            // Custom handler
            if (onBlock) {
                return onBlock(req, res, maintenanceConfig);
            }

            // API mode - return 503 JSON
            if (apiMode || fullPath.startsWith('/api/') || fullPath.startsWith('/platform/api/')) {
                return res.status(503).json({
                    success: false,
                    error: 'Service temporarily unavailable',
                    maintenance: {
                        enabled: true,
                        message: maintenanceConfig.platform.message,
                        endTime: maintenanceConfig.platform.endTime || maintenanceConfig.bot.endTime
                    }
                });
            }

            // Redirect to maintenance page (use /platform/maintenance if on platform routes)
            const maintenancePath = fullPath.startsWith('/platform') ? '/platform/maintenance' : '/maintenance';
            return res.redirect(maintenancePath);
        } catch (err) {
            console.error('[Maintenance] Middleware error:', err.message);
            // Fail open - allow access if maintenance check fails
            next();
        }
    };
}

/**
 * Update platform maintenance settings
 * @param {Object} settings - New settings
 * @param {string} updatedBy - Admin ID who made the change
 */
async function updatePlatformMaintenance(settings, updatedBy = 'system') {
    if (!db) throw new Error('Database not initialized');

    const now = new Date().toISOString();
    const updates = [
        ['maintenance_mode', settings.enabled ? 'true' : 'false'],
        ['maintenance_message', settings.message || ''],
        ['maintenance_end_time', settings.endTime || ''],
        ['maintenance_allowed_ips', (settings.allowedIps || []).join(',')],
        ['maintenance_apply_localhost', settings.applyLocalhost ? 'true' : 'false']
    ];

    for (const [key, value] of updates) {
        const existing = await db.get(`SELECT key FROM platform_settings WHERE key = ?`, [key]);
        if (existing) {
            await db.run(
                `UPDATE platform_settings SET value = ?, updated_by = ?, updated_at = ? WHERE key = ?`,
                [value, updatedBy, now, key]
            );
        } else {
            await db.run(
                `INSERT INTO platform_settings (key, value, value_type, description, updated_by, updated_at) VALUES (?, ?, 'string', ?, ?, ?)`,
                [key, value, `Maintenance setting: ${key}`, updatedBy, now]
            );
        }
    }

    return getMaintenanceConfig();
}

/**
 * Update bot maintenance settings
 * @param {Object} settings - New settings
 * @param {string} updatedBy - Admin ID who made the change
 */
async function updateBotMaintenance(settings, updatedBy = 'system') {
    if (!db) throw new Error('Database not initialized');

    const now = new Date().toISOString();
    const botMaintenanceData = JSON.stringify({
        enabled: !!settings.enabled,
        reason: settings.reason || '',
        endTime: settings.endTime || null,
        notifyOwners: !!settings.notifyOwners
    });

    const existing = await db.get(`SELECT key FROM platform_settings WHERE key = 'bot_maintenance'`);
    if (existing) {
        await db.run(
            `UPDATE platform_settings SET value = ?, updated_by = ?, updated_at = ? WHERE key = 'bot_maintenance'`,
            [botMaintenanceData, updatedBy, now]
        );
    } else {
        await db.run(
            `INSERT INTO platform_settings (key, value, value_type, description, updated_by, updated_at) VALUES (?, ?, 'json', 'Bot maintenance settings', ?, ?)`,
            ['bot_maintenance', botMaintenanceData, updatedBy, now]
        );
    }

    return getMaintenanceConfig();
}

module.exports = {
    init,
    getMaintenanceConfig,
    shouldBlockRequest,
    shouldSkipPath,
    createMiddleware,
    updatePlatformMaintenance,
    updateBotMaintenance,
    getClientIP,
    isLocalhostIP
};
