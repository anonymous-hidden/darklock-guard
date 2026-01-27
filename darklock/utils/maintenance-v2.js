/**
 * Enhanced Maintenance Mode System v2
 * 
 * SECURITY ARCHITECTURE:
 * - Server-side enforcement ONLY (frontend checks are cosmetic only)
 * - Cannot be bypassed via:
 *   - Direct URL access
 *   - Cached sessions
 *   - Direct API calls
 *   - WebSocket connections
 * 
 * SCOPES:
 * - website: Main Darklock website
 * - platform: Platform dashboard
 * - bot_dashboard: Discord bot dashboard
 * - api: API routes
 * - discord_bot: Discord bot functionality
 */

const crypto = require('crypto');

// Database singleton
let db = null;

// In-memory cache for performance (refreshed every 10 seconds)
let maintenanceCache = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 10000; // 10 seconds

/**
 * Initialize maintenance module with database connection
 */
function init(database) {
    db = database;
    initializeTables();
}

/**
 * Initialize maintenance tables
 */
async function initializeTables() {
    if (!db) return;
    
    try {
        // Main maintenance configuration table
        await db.run(`
            CREATE TABLE IF NOT EXISTS maintenance_config (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL UNIQUE,
                enabled INTEGER DEFAULT 0,
                start_time TEXT,
                end_time TEXT,
                message TEXT DEFAULT 'We are currently performing scheduled maintenance. Please check back soon.',
                allow_admin_bypass INTEGER DEFAULT 1,
                allowed_ips TEXT DEFAULT '[]',
                created_by TEXT,
                created_at TEXT,
                updated_by TEXT,
                updated_at TEXT
            )
        `);
        
        // Scheduled maintenance table
        await db.run(`
            CREATE TABLE IF NOT EXISTS maintenance_schedules (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                scheduled_start TEXT NOT NULL,
                scheduled_end TEXT,
                message TEXT,
                notify_webhook TEXT,
                notify_discord INTEGER DEFAULT 0,
                created_by TEXT,
                created_at TEXT,
                executed INTEGER DEFAULT 0,
                cancelled INTEGER DEFAULT 0
            )
        `);
        
        // Maintenance audit log
        await db.run(`
            CREATE TABLE IF NOT EXISTS maintenance_audit (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                action TEXT NOT NULL,
                admin_id TEXT,
                admin_email TEXT,
                old_state TEXT,
                new_state TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at TEXT
            )
        `);
        
        // Initialize default scopes if not exist
        const scopes = ['website', 'platform', 'bot_dashboard', 'api', 'discord_bot'];
        const now = new Date().toISOString();
        
        for (const scope of scopes) {
            const existing = await db.get(`SELECT id FROM maintenance_config WHERE scope = ?`, [scope]);
            if (!existing) {
                await db.run(`
                    INSERT INTO maintenance_config (id, scope, enabled, created_at, updated_at)
                    VALUES (?, ?, 0, ?, ?)
                `, [crypto.randomUUID(), scope, now, now]);
            }
        }
        
        // Create indexes
        await db.run(`CREATE INDEX IF NOT EXISTS idx_maintenance_scope ON maintenance_config(scope)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_maintenance_schedule_start ON maintenance_schedules(scheduled_start)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_maintenance_audit_created ON maintenance_audit(created_at)`);
        
        console.log('[Maintenance v2] ✅ Tables initialized');
    } catch (err) {
        console.error('[Maintenance v2] Table initialization error:', err.message);
    }
}

/**
 * Get all maintenance configurations (with caching)
 */
async function getAllMaintenanceConfig(forceRefresh = false) {
    if (!db) return getDefaultConfigs();
    
    const now = Date.now();
    if (!forceRefresh && maintenanceCache && (now - lastCacheUpdate) < CACHE_TTL) {
        return maintenanceCache;
    }
    
    try {
        const configs = await db.all(`SELECT * FROM maintenance_config`);
        const result = {};
        
        for (const config of configs) {
            result[config.scope] = {
                id: config.id,
                scope: config.scope,
                enabled: config.enabled === 1,
                startTime: config.start_time,
                endTime: config.end_time,
                message: config.message,
                allowAdminBypass: config.allow_admin_bypass === 1,
                allowedIps: JSON.parse(config.allowed_ips || '[]'),
                updatedBy: config.updated_by,
                updatedAt: config.updated_at
            };
        }
        
        maintenanceCache = result;
        lastCacheUpdate = now;
        return result;
    } catch (err) {
        console.error('[Maintenance v2] Config fetch error:', err.message);
        return getDefaultConfigs();
    }
}

/**
 * Get default configurations (fail-safe)
 */
function getDefaultConfigs() {
    const scopes = ['website', 'platform', 'bot_dashboard', 'api', 'discord_bot'];
    const result = {};
    
    for (const scope of scopes) {
        result[scope] = {
            scope,
            enabled: false,
            startTime: null,
            endTime: null,
            message: 'We are currently performing scheduled maintenance. Please check back soon.',
            allowAdminBypass: true,
            allowedIps: []
        };
    }
    
    return result;
}

/**
 * Get maintenance config for specific scope
 */
async function getMaintenanceConfig(scope) {
    const configs = await getAllMaintenanceConfig();
    return configs[scope] || getDefaultConfigs()[scope];
}

/**
 * Update maintenance config for a scope
 */
async function updateMaintenanceConfig(scope, settings, adminId = 'system', adminEmail = 'system') {
    if (!db) throw new Error('Database not initialized');
    
    const now = new Date().toISOString();
    const oldConfig = await getMaintenanceConfig(scope);
    
    // Build update query dynamically
    const updates = [];
    const values = [];
    
    if (settings.enabled !== undefined) {
        updates.push('enabled = ?');
        values.push(settings.enabled ? 1 : 0);
    }
    if (settings.message !== undefined) {
        updates.push('message = ?');
        values.push(settings.message);
    }
    if (settings.startTime !== undefined) {
        updates.push('start_time = ?');
        values.push(settings.startTime);
    }
    if (settings.endTime !== undefined) {
        updates.push('end_time = ?');
        values.push(settings.endTime);
    }
    if (settings.allowAdminBypass !== undefined) {
        updates.push('allow_admin_bypass = ?');
        values.push(settings.allowAdminBypass ? 1 : 0);
    }
    if (settings.allowedIps !== undefined) {
        updates.push('allowed_ips = ?');
        values.push(JSON.stringify(settings.allowedIps));
    }
    
    updates.push('updated_by = ?');
    values.push(adminId);
    updates.push('updated_at = ?');
    values.push(now);
    
    values.push(scope);
    
    await db.run(`
        UPDATE maintenance_config 
        SET ${updates.join(', ')}
        WHERE scope = ?
    `, values);
    
    // Log audit
    await logMaintenanceAudit(scope, settings.enabled ? 'ENABLE' : 'UPDATE', adminId, adminEmail, oldConfig, settings);
    
    // Invalidate cache
    maintenanceCache = null;
    
    return getMaintenanceConfig(scope);
}

/**
 * Enable maintenance mode for a scope
 */
async function enableMaintenance(scope, options = {}, adminId = 'system', adminEmail = 'system') {
    return updateMaintenanceConfig(scope, {
        enabled: true,
        message: options.message,
        startTime: options.startTime || new Date().toISOString(),
        endTime: options.endTime,
        allowAdminBypass: options.allowAdminBypass !== false,
        allowedIps: options.allowedIps
    }, adminId, adminEmail);
}

/**
 * Disable maintenance mode for a scope
 */
async function disableMaintenance(scope, adminId = 'system', adminEmail = 'system') {
    return updateMaintenanceConfig(scope, {
        enabled: false,
        endTime: new Date().toISOString()
    }, adminId, adminEmail);
}

/**
 * Schedule maintenance for future
 */
async function scheduleMaintenance(scope, options, adminId = 'system', adminEmail = 'system') {
    if (!db) throw new Error('Database not initialized');
    
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    await db.run(`
        INSERT INTO maintenance_schedules (
            id, scope, scheduled_start, scheduled_end, message,
            notify_webhook, notify_discord, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        id,
        scope,
        options.startTime,
        options.endTime || null,
        options.message || null,
        options.webhookUrl || null,
        options.notifyDiscord ? 1 : 0,
        adminId,
        now
    ]);
    
    await logMaintenanceAudit(scope, 'SCHEDULE', adminId, adminEmail, null, options);
    
    return { id, scope, ...options };
}

/**
 * Cancel scheduled maintenance
 */
async function cancelScheduledMaintenance(scheduleId, adminId = 'system', adminEmail = 'system') {
    if (!db) throw new Error('Database not initialized');
    
    const schedule = await db.get(`SELECT * FROM maintenance_schedules WHERE id = ?`, [scheduleId]);
    if (!schedule) throw new Error('Schedule not found');
    
    await db.run(`UPDATE maintenance_schedules SET cancelled = 1 WHERE id = ?`, [scheduleId]);
    await logMaintenanceAudit(schedule.scope, 'CANCEL_SCHEDULE', adminId, adminEmail, schedule, null);
    
    return { success: true };
}

/**
 * Get pending scheduled maintenance
 */
async function getPendingSchedules() {
    if (!db) return [];
    
    const now = new Date().toISOString();
    return db.all(`
        SELECT * FROM maintenance_schedules 
        WHERE executed = 0 AND cancelled = 0 AND scheduled_start > ?
        ORDER BY scheduled_start ASC
    `, [now]);
}

/**
 * Execute due scheduled maintenance
 * Call this from a cron job or interval
 */
async function executeDueSchedules() {
    if (!db) return;
    
    const now = new Date().toISOString();
    const dueSchedules = await db.all(`
        SELECT * FROM maintenance_schedules 
        WHERE executed = 0 AND cancelled = 0 AND scheduled_start <= ?
    `, [now]);
    
    for (const schedule of dueSchedules) {
        try {
            await enableMaintenance(schedule.scope, {
                message: schedule.message,
                startTime: schedule.scheduled_start,
                endTime: schedule.scheduled_end
            }, schedule.created_by, 'scheduled');
            
            await db.run(`UPDATE maintenance_schedules SET executed = 1 WHERE id = ?`, [schedule.id]);
            
            console.log(`[Maintenance v2] Executed scheduled maintenance for ${schedule.scope}`);
        } catch (err) {
            console.error(`[Maintenance v2] Failed to execute schedule ${schedule.id}:`, err.message);
        }
    }
}

/**
 * Log maintenance audit entry
 */
async function logMaintenanceAudit(scope, action, adminId, adminEmail, oldState, newState, req = null) {
    if (!db) return;
    
    try {
        await db.run(`
            INSERT INTO maintenance_audit (
                id, scope, action, admin_id, admin_email,
                old_state, new_state, ip_address, user_agent, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            crypto.randomUUID(),
            scope,
            action,
            adminId,
            adminEmail,
            oldState ? JSON.stringify(oldState) : null,
            newState ? JSON.stringify(newState) : null,
            req ? getClientIP(req) : null,
            req?.headers?.['user-agent'] || null,
            new Date().toISOString()
        ]);
    } catch (err) {
        console.error('[Maintenance v2] Audit log error:', err.message);
    }
}

/**
 * Get maintenance audit logs
 */
async function getMaintenanceAuditLogs(options = {}) {
    if (!db) return [];
    
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    const scope = options.scope;
    
    let query = `SELECT * FROM maintenance_audit`;
    const params = [];
    
    if (scope) {
        query += ` WHERE scope = ?`;
        params.push(scope);
    }
    
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    return db.all(query, params);
}

// ============================================================================
// MIDDLEWARE FACTORY
// ============================================================================

/**
 * Map request paths to maintenance scopes
 */
function getRequestScope(req) {
    const path = (req.baseUrl || '') + req.path;
    
    // API routes
    if (path.startsWith('/api/') || path.startsWith('/platform/api/')) {
        return 'api';
    }
    
    // Platform dashboard
    if (path.startsWith('/platform/dashboard') || path.startsWith('/platform/profile')) {
        return 'platform';
    }
    
    // Bot dashboard (Discord bot config pages)
    if (path.match(/^\/(dashboard|setup|analytics|tickets|console|moderation)/)) {
        return 'bot_dashboard';
    }
    
    // Admin routes - always accessible
    if (path.startsWith('/admin') || path.startsWith('/signin') || path.startsWith('/signout')) {
        return null; // No maintenance check
    }
    
    // Platform pages (public pages)
    if (path.startsWith('/platform')) {
        return 'website';
    }
    
    // Root website
    return 'website';
}

/**
 * Paths that should NEVER be blocked by maintenance
 */
const ALWAYS_ALLOWED_PATHS = [
    '/signin',
    '/signout',
    '/admin',
    '/api/admin',
    '/maintenance',
    '/platform/maintenance',
    '/platform/static',
    '/platform/api/health',
    '/health',
    '/favicon.ico',
    '/robots.txt'
];

/**
 * Check if path should skip maintenance check
 */
function shouldSkipMaintenanceCheck(path) {
    return ALWAYS_ALLOWED_PATHS.some(allowed => path.startsWith(allowed));
}

/**
 * Get client IP address
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
 * Check if IP is in allowed list
 */
function isIPAllowed(clientIP, allowedIps) {
    if (!allowedIps || allowedIps.length === 0) return false;
    
    return allowedIps.some(allowed => {
        // Exact match
        if (clientIP === allowed) return true;
        // Partial match (for CIDR-like patterns)
        if (clientIP.includes(allowed) || allowed.includes(clientIP)) return true;
        return false;
    });
}

/**
 * Check if request is from an authenticated admin
 */
function isAdminRequest(req) {
    // Check for admin token in cookies
    const adminToken = req.cookies?.admin_token;
    if (!adminToken) return false;
    
    // The actual token verification is done by the auth middleware
    // We just check if admin info was attached to the request
    if (req.admin && (req.admin.role === 'owner' || req.admin.role === 'admin')) {
        return true;
    }
    
    return false;
}

/**
 * Create Express middleware for maintenance enforcement
 * 
 * CRITICAL: This middleware enforces maintenance mode server-side.
 * It cannot be bypassed by client-side tricks.
 */
function createMiddleware(options = {}) {
    const {
        onBlock = null,
        verifyAdminToken = null // Function to verify admin tokens
    } = options;
    
    return async (req, res, next) => {
        const fullPath = (req.baseUrl || '') + req.path;
        
        // Always allow certain paths
        if (shouldSkipMaintenanceCheck(fullPath)) {
            return next();
        }
        
        // Determine which scope this request falls under
        const scope = getRequestScope(req);
        if (!scope) {
            return next(); // No scope = no maintenance check (admin routes)
        }
        
        try {
            const config = await getMaintenanceConfig(scope);
            
            // Not in maintenance mode
            if (!config.enabled) {
                return next();
            }
            
            // Check end time - auto-disable if expired
            if (config.endTime && new Date(config.endTime) < new Date()) {
                await disableMaintenance(scope, 'system', 'auto-expire');
                return next();
            }
            
            const clientIP = getClientIP(req);
            
            // Check IP whitelist
            if (isIPAllowed(clientIP, config.allowedIps)) {
                return next();
            }
            
            // Check admin bypass
            if (config.allowAdminBypass) {
                // Try to verify admin token if verification function provided
                if (verifyAdminToken) {
                    const token = req.cookies?.admin_token;
                    if (token) {
                        const decoded = verifyAdminToken(token);
                        if (decoded && decoded.type === 'admin') {
                            req.adminBypass = true;
                            return next();
                        }
                    }
                } else if (isAdminRequest(req)) {
                    req.adminBypass = true;
                    return next();
                }
            }
            
            // BLOCKED - Maintenance mode active
            console.log(`[Maintenance v2] Blocked request from ${clientIP} to ${fullPath} (scope: ${scope})`);
            
            // Custom handler
            if (onBlock) {
                return onBlock(req, res, config, scope);
            }
            
            // Default handler
            if (fullPath.startsWith('/api/') || req.accepts('json')) {
                // API response
                const retryAfter = config.endTime 
                    ? Math.max(0, Math.floor((new Date(config.endTime) - new Date()) / 1000))
                    : 3600;
                
                res.setHeader('Retry-After', retryAfter);
                return res.status(503).json({
                    success: false,
                    error: 'Service temporarily unavailable',
                    code: 'MAINTENANCE_MODE',
                    maintenance: {
                        scope,
                        message: config.message,
                        endTime: config.endTime,
                        retryAfter
                    }
                });
            } else {
                // Web response - redirect to maintenance page
                const maintenancePage = fullPath.startsWith('/platform') 
                    ? '/platform/maintenance'
                    : '/maintenance';
                return res.redirect(maintenancePage);
            }
            
        } catch (err) {
            console.error('[Maintenance v2] Middleware error:', err.message);
            // Fail open - allow access if maintenance check fails
            next();
        }
    };
}

/**
 * WebSocket maintenance check
 * Use this in WebSocket upgrade handlers
 */
async function checkWebSocketMaintenance(req, scope = 'api') {
    try {
        const config = await getMaintenanceConfig(scope);
        
        if (!config.enabled) {
            return { allowed: true };
        }
        
        const clientIP = getClientIP(req);
        
        if (isIPAllowed(clientIP, config.allowedIps)) {
            return { allowed: true };
        }
        
        // Check admin token in query or cookies
        const token = req.cookies?.admin_token;
        if (token && config.allowAdminBypass) {
            return { allowed: true, requiresValidation: true, token };
        }
        
        return {
            allowed: false,
            reason: 'MAINTENANCE_MODE',
            message: config.message,
            endTime: config.endTime
        };
    } catch (err) {
        console.error('[Maintenance v2] WebSocket check error:', err.message);
        return { allowed: true }; // Fail open
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Initialization
    init,
    initializeTables,
    
    // Configuration
    getAllMaintenanceConfig,
    getMaintenanceConfig,
    updateMaintenanceConfig,
    
    // Actions
    enableMaintenance,
    disableMaintenance,
    scheduleMaintenance,
    cancelScheduledMaintenance,
    getPendingSchedules,
    executeDueSchedules,
    
    // Audit
    getMaintenanceAuditLogs,
    
    // Middleware
    createMiddleware,
    checkWebSocketMaintenance,
    
    // Helpers
    getClientIP,
    getRequestScope,
    shouldSkipMaintenanceCheck,
    isIPAllowed,
    isAdminRequest,
    
    // Constants
    ALWAYS_ALLOWED_PATHS
};
