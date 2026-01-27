/**
 * Centralized Maintenance Mode Configuration & Enforcement
 * Single source of truth for all maintenance-related settings and checks
 */

const path = require('path');
const debugLogger = require('./debug-logger');

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
 * Uses the new RBAC maintenance_state table with scopes
 * @returns {Promise<Object>} Maintenance configuration
 */
async function getMaintenanceConfig() {
    if (!db) {
        console.error('[Maintenance] Database not initialized');
        return getDefaultConfig();
    }

    try {
        // Get all active maintenance states from new RBAC system
        debugLogger.log('[Maintenance Config] Querying database for enabled maintenance states...');
        const states = await db.all(`
            SELECT * FROM maintenance_state WHERE enabled = 1
        `);

        debugLogger.log('[Maintenance Config] Found', states.length, 'enabled maintenance state(s)');
        if (states.length > 0) {
            debugLogger.log('[Maintenance Config] Scopes with enabled=1:', states.map(s => `${s.scope} (apply_localhost=${s.apply_localhost})`).join(', '));
        }

        // Find darklock_site (platform) maintenance
        const platformMaintenance = states.find(s => s.scope === 'darklock_site');
        
        // Find bot_dashboard maintenance
        const botMaintenance = states.find(s => s.scope === 'bot_dashboard');

        // Check if maintenance has started and hasn't ended
        const isMaintenanceActive = (state) => {
            if (!state) {
                console.log('[isMaintenanceActive] No state provided');
                return false;
            }
            
            console.log('[isMaintenanceActive] Checking scope:', state.scope, '| enabled:', state.enabled, '| scheduled_start:', state.scheduled_start, '| scheduled_end:', state.scheduled_end);
            
            // Must be explicitly enabled in database
            if (!state.enabled) {
                console.log('[isMaintenanceActive] NOT enabled - returning false');
                return false;
            }
            
            // Check scheduled start
            if (state.scheduled_start) {
                const startTime = new Date(state.scheduled_start);
                console.log('[isMaintenanceActive] Checking scheduled start:', startTime, 'vs now:', new Date());
                if (startTime > new Date()) {
                    console.log('[isMaintenanceActive] Not started yet - returning false');
                    return false; // Not started yet
                }
            }
            
            // Check scheduled end
            if (state.scheduled_end) {
                const endTime = new Date(state.scheduled_end);
                console.log('[isMaintenanceActive] Checking scheduled end:', endTime, 'vs now:', new Date());
                if (endTime < new Date()) {
                    console.log('[isMaintenanceActive] Expired - auto-disabling');
                    // Auto-disable expired maintenance
                    db.run(`UPDATE maintenance_state SET enabled = 0 WHERE scope = ?`, [state.scope]).catch(e => {
                        console.error('[Maintenance] Failed to auto-disable:', e);
                    });
                    return false;
                }
            }
            
            console.log('[isMaintenanceActive] All checks passed - returning TRUE');
            return true;
        };

        // Parse bypass IPs
        const parseBypassIps = (state) => {
            if (!state || !state.bypass_ips) return [];
            try {
                return JSON.parse(state.bypass_ips);
            } catch (e) {
                return [];
            }
        };

        console.log('[Maintenance Config] About to call isMaintenanceActive for platform. platformMaintenance:', {
            scope: platformMaintenance?.scope,
            enabled: platformMaintenance?.enabled,
            scheduled_start: platformMaintenance?.scheduled_start,
            scheduled_end: platformMaintenance?.scheduled_end
        });
        
        const platformIsActive = isMaintenanceActive(platformMaintenance);
        console.log('[Maintenance Config] isMaintenanceActive returned:', platformIsActive);
        
        const config = {
            platform: {
                enabled: platformIsActive,
                message: platformMaintenance?.message || platformMaintenance?.title || 'We are currently performing scheduled maintenance. Please check back soon.',
                endTime: platformMaintenance?.scheduled_end || null,
                allowedIps: parseBypassIps(platformMaintenance),
                applyLocalhost: !!(platformMaintenance?.apply_localhost),
                adminBypass: !!(platformMaintenance?.admin_bypass),
                title: platformMaintenance?.title || 'Scheduled Maintenance',
                subtitle: platformMaintenance?.subtitle || 'We\'ll be back shortly'
            },
            bot: {
                enabled: isMaintenanceActive(botMaintenance),
                reason: botMaintenance?.message || botMaintenance?.title || 'Bot is under maintenance',
                endTime: botMaintenance?.scheduled_end || null,
                notifyOwners: botMaintenance?.discord_announce || false
            }
        };
        
        console.log('[Maintenance Config] Final config:', {
            platformEnabled: config.platform.enabled,
            platformApplyLocalhost: config.platform.applyLocalhost,
            platformAdminBypass: config.platform.adminBypass,
            botEnabled: config.bot.enabled
        });
        
        return config;
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
            applyLocalhost: false,
            title: 'Scheduled Maintenance',
            subtitle: 'We\'ll be back shortly'
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

    console.log('[Maintenance Check] Active:', maintenanceActive, '| Platform:', config.platform.enabled, '| Bot:', config.bot.enabled);

    if (!maintenanceActive) {
        return { blocked: false, reason: null, config };
    }

    // Get client IP
    const clientIP = getClientIP(req);

    // Check bypass rules in order:
    // 1. Admin user bypass (if logged in as admin and admin_bypass is enabled)
    if (req.adminUser && config.platform.adminBypass) {
        console.log('[Maintenance Check] Admin bypass - user:', req.adminUser.email);
        return { blocked: false, reason: 'admin_bypass', config };
    }

    // 2. Explicitly allowed IPs
    if (config.platform.allowedIps.length > 0) {
        for (const allowedIp of config.platform.allowedIps) {
            if (clientIP.includes(allowedIp) || allowedIp.includes(clientIP)) {
                console.log('[Maintenance Check] IP bypass - allowed IP:', allowedIp);
                return { blocked: false, reason: 'allowed_ip', config };
            }
        }
    }

    // 3. Localhost bypass (only if applyLocalhost is false)
    const isLocalhost = isLocalhostIP(clientIP);
    console.log('[Maintenance Check] IP:', clientIP, '| isLocalhost:', isLocalhost, '| applyLocalhost:', config.platform.applyLocalhost);
    if (isLocalhost && !config.platform.applyLocalhost) {
        console.log('[Maintenance Check] Localhost bypass - maintenance does not apply to localhost');
        return { blocked: false, reason: 'localhost_bypass', config };
    }

    // No bypass applies - block the request
    console.log('[Maintenance Check] BLOCKING request from', clientIP);
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
        
        console.log('[Maintenance Middleware] REQUEST:', req.method, fullPath);
        
        // Skip certain paths
        if (shouldSkipPath(fullPath)) {
            console.log('[Maintenance Middleware] Skipping path:', fullPath);
            return next();
        }

        try {
            const config = await getMaintenanceConfig();
            console.log('[Maintenance Middleware] Checking path:', fullPath, '| Platform enabled:', config.platform.enabled, '| Bot enabled:', config.bot.enabled);
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
