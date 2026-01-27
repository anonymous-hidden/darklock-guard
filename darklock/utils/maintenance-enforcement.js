/**
 * Darklock Maintenance Enforcement Middleware
 * 
 * Server-side maintenance mode enforcement that:
 * - Blocks all requests when maintenance is enabled
 * - Cannot be bypassed by direct URL access
 * - Cannot be bypassed by cached sessions
 * - Cannot be bypassed by direct API calls
 * - Admin bypass available (configurable per scope)
 * - Returns 503 for API routes, renders page for web routes
 */

const path = require('path');

// Database
const db = require('../utils/database');

// Scope mapping for URL paths
const SCOPE_PATH_MAP = {
    'website': ['/'],
    'platform': ['/platform', '/dashboard'],
    'bot_dashboard': ['/bot', '/discord'],
    'api': ['/api', '/v1', '/v2', '/v3']
};

// Paths that should NEVER be blocked
const ALWAYS_ALLOWED = [
    '/signin',
    '/login',
    '/auth',
    '/api/maintenance/status',
    '/api/maintenance/all',
    '/api/health',
    '/maintenance',
    '/favicon.ico',
    '/static',
    '/assets',
    '/_next'
];

// Cache maintenance state (refresh every 5 seconds)
let maintenanceCache = {};
let cacheLastUpdated = 0;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Refresh the maintenance cache from database
 */
async function refreshMaintenanceCache() {
    try {
        const now = Date.now();
        if (now - cacheLastUpdated < CACHE_TTL) {
            return maintenanceCache;
        }

        const states = await db.all(`
            SELECT * FROM maintenance_state WHERE enabled = 1
        `).catch(() => []);

        maintenanceCache = {};
        for (const state of states) {
            maintenanceCache[state.scope] = {
                enabled: true,
                message: state.message,
                title: state.title,
                subtitle: state.subtitle,
                scheduledEnd: state.scheduled_end,
                adminBypass: !!state.admin_bypass,
                bypassIps: state.bypass_ips ? JSON.parse(state.bypass_ips) : []
            };
        }
        cacheLastUpdated = now;

        return maintenanceCache;
    } catch (err) {
        console.error('[Maintenance] Cache refresh error:', err);
        return maintenanceCache;
    }
}

/**
 * Determine which scope a request path belongs to
 */
function getScopeForPath(requestPath) {
    const normalizedPath = requestPath.toLowerCase();
    
    for (const [scope, paths] of Object.entries(SCOPE_PATH_MAP)) {
        for (const prefix of paths) {
            if (normalizedPath === prefix || normalizedPath.startsWith(prefix + '/')) {
                return scope;
            }
        }
    }
    
    // Default to website for root-level paths
    return 'website';
}

/**
 * Check if a path should always be allowed
 */
function isAlwaysAllowed(requestPath) {
    const normalizedPath = requestPath.toLowerCase();
    
    for (const allowed of ALWAYS_ALLOWED) {
        if (normalizedPath === allowed || normalizedPath.startsWith(allowed + '/') || normalizedPath.startsWith(allowed + '?')) {
            return true;
        }
    }
    
    return false;
}

/**
 * Check if the request is from an admin with bypass permission
 */
async function hasAdminBypass(req, maintenanceState) {
    // If admin bypass is disabled for this scope, no one bypasses
    if (!maintenanceState.adminBypass) {
        return false;
    }

    try {
        // Check for admin token cookie
        const token = req.cookies?.admin_token;
        if (!token) {
            return false;
        }

        // Verify admin session exists and is active
        const session = await db.get(`
            SELECT s.*, a.id as admin_id, au.role_id
            FROM admin_sessions s
            JOIN admins a ON s.admin_id = a.id
            JOIN admin_users au ON au.admin_id = a.id
            JOIN roles r ON au.role_id = r.id
            WHERE s.token = ? AND s.is_active = 1
            AND r.rank_level >= 70
        `, [token]).catch(() => null);

        if (session) {
            return true;
        }
    } catch (err) {
        console.error('[Maintenance] Admin bypass check error:', err);
    }

    return false;
}

/**
 * Check if IP is in bypass list
 */
function isIPBypassed(req, maintenanceState) {
    if (!maintenanceState.bypassIps || maintenanceState.bypassIps.length === 0) {
        return false;
    }

    const clientIP = req.ip || 
                     req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                     req.headers['x-real-ip'] ||
                     req.connection?.remoteAddress ||
                     '127.0.0.1';

    return maintenanceState.bypassIps.includes(clientIP);
}

/**
 * Get client IP for logging
 */
function getClientIP(req) {
    return req.ip || 
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           'unknown';
}

/**
 * Main enforcement middleware
 */
function enforceMaintenanceMode(options = {}) {
    const {
        defaultScope = 'platform',
        apiPrefix = '/api',
        maintenanceViewPath = null
    } = options;

    return async (req, res, next) => {
        try {
            // Always allow certain paths
            if (isAlwaysAllowed(req.path)) {
                return next();
            }

            // Refresh cache and check maintenance state
            const cache = await refreshMaintenanceCache();
            
            // If no active maintenance, continue
            if (Object.keys(cache).length === 0) {
                return next();
            }

            // Determine scope for this request
            const scope = getScopeForPath(req.path);
            const maintenanceState = cache[scope];

            // If this scope is not in maintenance, continue
            if (!maintenanceState || !maintenanceState.enabled) {
                return next();
            }

            // Check for admin bypass
            if (await hasAdminBypass(req, maintenanceState)) {
                // Set header to indicate maintenance mode is active but bypassed
                res.setHeader('X-Maintenance-Bypassed', 'true');
                return next();
            }

            // Check for IP bypass
            if (isIPBypassed(req, maintenanceState)) {
                res.setHeader('X-Maintenance-Bypassed', 'ip');
                return next();
            }

            // Log blocked request
            console.log(`[Maintenance] Blocked request: ${req.method} ${req.path} from ${getClientIP(req)} (scope: ${scope})`);

            // Determine response type based on request
            const isApiRequest = req.path.startsWith(apiPrefix) || 
                                 req.headers['accept']?.includes('application/json') ||
                                 req.xhr;

            if (isApiRequest) {
                // Return JSON 503 for API requests
                res.status(503).json({
                    success: false,
                    error: 'Service Unavailable',
                    maintenance: {
                        enabled: true,
                        scope: scope,
                        message: maintenanceState.message || 'Service is under maintenance',
                        scheduledEnd: maintenanceState.scheduledEnd
                    },
                    retryAfter: maintenanceState.scheduledEnd ? 
                        Math.max(1, Math.ceil((new Date(maintenanceState.scheduledEnd) - new Date()) / 1000)) : 
                        3600
                });
                return;
            }

            // For web requests, redirect to maintenance page
            const maintenanceUrl = `/maintenance?scope=${scope}`;
            
            // If already on maintenance page, serve it
            if (req.path === '/maintenance') {
                if (maintenanceViewPath) {
                    return res.sendFile(maintenanceViewPath);
                }
                return res.sendFile(path.join(__dirname, '../views/maintenance.html'));
            }

            // Redirect to maintenance page
            res.redirect(302, maintenanceUrl);

        } catch (err) {
            console.error('[Maintenance] Enforcement error:', err);
            // On error, allow request through to avoid complete lockout
            next();
        }
    };
}

/**
 * Check specific scope maintenance (for use in route handlers)
 */
async function checkScopeMaintenance(scope) {
    const cache = await refreshMaintenanceCache();
    return cache[scope] || { enabled: false };
}

/**
 * Manually set maintenance state (for use in admin API)
 */
function invalidateMaintenanceCache() {
    cacheLastUpdated = 0;
}

/**
 * Create middleware for specific scope only
 */
function enforceScope(scope) {
    return async (req, res, next) => {
        try {
            if (isAlwaysAllowed(req.path)) {
                return next();
            }

            const cache = await refreshMaintenanceCache();
            const maintenanceState = cache[scope];

            if (!maintenanceState || !maintenanceState.enabled) {
                return next();
            }

            if (await hasAdminBypass(req, maintenanceState)) {
                res.setHeader('X-Maintenance-Bypassed', 'true');
                return next();
            }

            if (isIPBypassed(req, maintenanceState)) {
                res.setHeader('X-Maintenance-Bypassed', 'ip');
                return next();
            }

            const isApiRequest = req.headers['accept']?.includes('application/json') || req.xhr;

            if (isApiRequest) {
                return res.status(503).json({
                    success: false,
                    error: 'Service Unavailable',
                    maintenance: {
                        enabled: true,
                        scope: scope,
                        message: maintenanceState.message
                    }
                });
            }

            return res.redirect(302, `/maintenance?scope=${scope}`);

        } catch (err) {
            console.error(`[Maintenance] Scope ${scope} check error:`, err);
            next();
        }
    };
}

module.exports = {
    enforceMaintenanceMode,
    enforceScope,
    checkScopeMaintenance,
    invalidateMaintenanceCache,
    getScopeForPath,
    refreshMaintenanceCache
};
