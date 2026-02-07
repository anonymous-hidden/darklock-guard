/**
 * Darklock Admin RBAC Middleware
 * 
 * Security Middleware for Role-Based Access Control
 * 
 * IMPORTANT:
 * - Owner/Co-Owner pages return 404 (not 403) to prevent discovery
 * - All access attempts are logged
 * - Rate limiting on sensitive actions
 */

const rateLimit = require('express-rate-limit');
const rbacSchema = require('./rbac-schema');
const db = require('./database');
const crypto = require('crypto');

/**
 * Get client IP
 */
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.ip ||
           'unknown';
}

/**
 * Generate request ID for tracing
 */
function generateRequestId() {
    return `req_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Log admin action to audit trail
 */
async function logAuditAction(req, action, details = {}) {
    try {
        const adminUser = req.adminUser || req.admin;
        await db.run(`
            INSERT INTO admin_audit_log_v2 (
                id, admin_user_id, admin_email, action, scope, target_type, target_id,
                before_value, after_value, ip_address, user_agent, request_id, severity
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            crypto.randomUUID(),
            adminUser?.id || null,
            adminUser?.email || null,
            action,
            details.scope || null,
            details.targetType || null,
            details.targetId || null,
            details.before ? JSON.stringify(details.before) : null,
            details.after ? JSON.stringify(details.after) : null,
            getClientIP(req),
            req.headers['user-agent'] || 'unknown',
            req.requestId || generateRequestId(),
            details.severity || 'info'
        ]);
    } catch (err) {
        console.error('[RBAC Middleware] Audit log error:', err.message);
    }
}

/**
 * Log security event
 */
async function logSecurityEvent(eventType, severity, ip, userAgent, adminId, details) {
    try {
        await db.run(`
            INSERT INTO security_events (id, event_type, severity, ip_address, user_agent, admin_id, details)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            crypto.randomUUID(),
            eventType,
            severity,
            ip,
            userAgent,
            adminId,
            JSON.stringify(details)
        ]);
    } catch (err) {
        console.error('[RBAC Middleware] Security event log error:', err.message);
    }
}

/**
 * Middleware: Add request ID for tracing
 */
function addRequestId(req, res, next) {
    req.requestId = generateRequestId();
    res.setHeader('X-Request-Id', req.requestId);
    next();
}

/**
 * Middleware: Load admin user with RBAC info
 * Must be called after requireAdminAuth
 */
async function loadAdminUser(req, res, next) {
    if (!req.admin || !req.admin.id) {
        return next();
    }

    try {
        // Get or create admin user in RBAC system
        let adminUser = await rbacSchema.getAdminUserWithRole(req.admin.id);

        if (!adminUser) {
            // First time admin - link to RBAC with default role
            // Check if this is the first/only admin (make them owner)
            const adminCount = await db.get(`SELECT COUNT(*) as count FROM admin_users`);
            const defaultRole = adminCount?.count === 0 ? 'owner' : 'admin';
            
            await rbacSchema.linkAdminToRBAC(req.admin.id, defaultRole);
            adminUser = await rbacSchema.getAdminUserWithRole(req.admin.id);
        }

        req.adminUser = adminUser;
        next();
    } catch (err) {
        console.error('[RBAC Middleware] Load admin user error:', err);
        next();
    }
}

/**
 * Middleware: Require minimum role level
 * @param {number} minLevel - Minimum role level required
 */
function requireRoleMin(minLevel) {
    return async (req, res, next) => {
        if (!req.adminUser) {
            await logSecurityEvent('ACCESS_DENIED', 'medium', getClientIP(req), 
                req.headers['user-agent'], null, { reason: 'no_admin_user', path: req.path });
            
            if (req.accepts('html')) {
                return res.redirect('/signin');
            }
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        if (req.adminUser.rank_level < minLevel) {
            await logAuditAction(req, 'ACCESS_DENIED', {
                scope: 'rbac',
                targetType: 'route',
                targetId: req.path,
                severity: 'warning'
            });

            // Return 403 for API, redirect for pages
            if (req.accepts('html')) {
                return res.status(403).render ? 
                    res.status(403).send('Access Denied') : 
                    res.status(403).json({ success: false, error: 'Insufficient permissions' });
            }
            return res.status(403).json({ success: false, error: 'Insufficient permissions' });
        }

        next();
    };
}

/**
 * Middleware: Require specific permission
 * @param {string} permissionKey - Permission key to check
 */
function requirePermission(permissionKey) {
    return async (req, res, next) => {
        if (!req.adminUser) {
            if (req.accepts('html')) {
                return res.redirect('/signin');
            }
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const hasPermission = await rbacSchema.hasPermission(req.admin.id, permissionKey);

        if (!hasPermission) {
            await logAuditAction(req, 'PERMISSION_DENIED', {
                scope: 'rbac',
                targetType: 'permission',
                targetId: permissionKey,
                severity: 'warning'
            });

            return res.status(403).json({ 
                success: false, 
                error: 'Permission denied',
                required: permissionKey
            });
        }

        next();
    };
}

/**
 * Middleware: Owner or Co-Owner only
 * CRITICAL: Returns 404 (not 403) to prevent discovery
 */
function ownerOrCoOwnerOnly(req, res, next) {
    if (!req.adminUser) {
        // Return 404 to prevent discovery
        return res.status(404).json({ success: false, error: 'Not found' });
    }

    const isPrivileged = req.adminUser.rank_level >= rbacSchema.ROLE_LEVELS['co-owner'];

    if (!isPrivileged) {
        // Log the access attempt
        logAuditAction(req, 'HIDDEN_PAGE_ACCESS_ATTEMPT', {
            scope: 'security',
            targetType: 'route',
            targetId: req.path,
            severity: 'warning'
        });

        logSecurityEvent('HIDDEN_PAGE_ACCESS', 'medium', getClientIP(req),
            req.headers['user-agent'], req.admin?.id, { path: req.path });

        // Return 404 (NOT 403) to prevent discovery
        return res.status(404).json({ success: false, error: 'Not found' });
    }

    next();
}

/**
 * Middleware: Owner only (for most sensitive operations)
 * Returns 404 to prevent discovery
 */
function ownerOnly(req, res, next) {
    if (!req.adminUser || req.adminUser.role_name !== 'owner') {
        logSecurityEvent('OWNER_ONLY_ACCESS', 'high', getClientIP(req),
            req.headers['user-agent'], req.admin?.id, { path: req.path });
        
        return res.status(404).json({ success: false, error: 'Not found' });
    }
    next();
}

/**
 * Middleware: Check if admin's status is active
 */
function requireActiveStatus(req, res, next) {
    if (!req.adminUser) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (req.adminUser.status !== 'active') {
        logSecurityEvent('SUSPENDED_ADMIN_ACCESS', 'high', getClientIP(req),
            req.headers['user-agent'], req.admin?.id, { status: req.adminUser.status });
        
        return res.status(403).json({ 
            success: false, 
            error: 'Account suspended',
            status: req.adminUser.status
        });
    }

    next();
}

/**
 * Middleware: Check allowed scopes
 * @param {string} scope - The scope to check (e.g., 'bot', 'api', 'site')
 */
function requireScope(scope) {
    return (req, res, next) => {
        if (!req.adminUser) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const allowedScopes = JSON.parse(req.adminUser.allowed_scopes || '["*"]');
        
        if (allowedScopes.includes('*') || allowedScopes.includes(scope)) {
            return next();
        }

        logAuditAction(req, 'SCOPE_DENIED', {
            scope: 'rbac',
            targetType: 'scope',
            targetId: scope,
            severity: 'warning'
        });

        return res.status(403).json({ 
            success: false, 
            error: 'Access to this scope is restricted',
            requiredScope: scope
        });
    };
}

/**
 * Middleware: Require 2FA for sensitive operations
 */
function require2FA(req, res, next) {
    if (!req.adminUser) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // For now, check if 2FA is enforced for this user
    if (req.adminUser.requires_2fa && !req.admin.twoFactorVerified) {
        return res.status(403).json({
            success: false,
            error: '2FA verification required',
            requires2FA: true
        });
    }

    next();
}

/**
 * Middleware: IP allowlist check
 */
function checkIPAllowlist(req, res, next) {
    if (!req.adminUser || !req.adminUser.ip_allowlist) {
        return next();
    }

    const clientIP = getClientIP(req);
    const allowlist = JSON.parse(req.adminUser.ip_allowlist);

    if (allowlist.length > 0 && !allowlist.includes(clientIP)) {
        logSecurityEvent('IP_NOT_ALLOWED', 'high', clientIP,
            req.headers['user-agent'], req.admin?.id, { 
                allowlist,
                attempted_ip: clientIP
            });
        
        return res.status(403).json({
            success: false,
            error: 'Access denied from this IP address'
        });
    }

    next();
}

/**
 * Rate limiter for sensitive admin actions
 */
const sensitiveActionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 sensitive actions per hour
    message: { success: false, error: 'Too many sensitive actions. Please wait.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.admin?.id || getClientIP(req)
});

/**
 * Rate limiter for admin API calls
 */
const adminApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per 15 minutes (plenty for dashboard usage)
    message: { success: false, error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.admin?.id || getClientIP(req),
    skip: (req) => {
        // Skip rate limiting for frequently accessed read-only endpoints
        // Check both with and without /api prefix
        const skipPaths = ['shell', 'overview', 'status', 'alerts'];
        return skipPaths.some(path => req.path.includes(path));
    }
});

/**
 * Middleware: Log all admin actions
 */
function auditAllActions(req, res, next) {
    // Skip GET requests for non-sensitive endpoints
    if (req.method === 'GET' && !req.path.includes('/users') && !req.path.includes('/permissions')) {
        return next();
    }

    // Log the action
    const originalSend = res.send;
    res.send = function(body) {
        // Log after response
        const action = `${req.method} ${req.path}`;
        logAuditAction(req, action, {
            scope: req.baseUrl?.split('/')[2] || 'admin',
            targetType: 'api',
            targetId: req.path
        }).catch(() => {}); // Don't block on audit

        return originalSend.call(this, body);
    };

    next();
}

/**
 * Middleware: Check maintenance mode
 * @param {string} scope - The scope to check
 */
function checkMaintenance(scope) {
    return async (req, res, next) => {
        try {
            const maintenance = await db.get(`
                SELECT * FROM maintenance_state WHERE scope = ? AND enabled = 1
            `, [scope]);

            if (!maintenance) {
                return next();
            }

            // Check if scheduled maintenance has started
            if (maintenance.scheduled_start) {
                const startTime = new Date(maintenance.scheduled_start);
                if (startTime > new Date()) {
                    return next(); // Not started yet
                }
            }

            // Check if maintenance has ended
            if (maintenance.scheduled_end) {
                const endTime = new Date(maintenance.scheduled_end);
                if (endTime < new Date()) {
                    // Auto-disable maintenance
                    await db.run(`UPDATE maintenance_state SET enabled = 0 WHERE scope = ?`, [scope]);
                    return next();
                }
            }

            // Check admin bypass
            if (maintenance.admin_bypass && req.adminUser) {
                return next();
            }

            // Check IP bypass
            if (maintenance.bypass_ips) {
                const bypassIPs = JSON.parse(maintenance.bypass_ips);
                if (bypassIPs.includes(getClientIP(req))) {
                    return next();
                }
            }

            // Block access
            return res.status(503).json({
                success: false,
                error: 'Service under maintenance',
                message: maintenance.message || 'We are currently performing maintenance. Please try again later.',
                scope,
                estimatedEnd: maintenance.scheduled_end
            });

        } catch (err) {
            console.error('[RBAC Middleware] Maintenance check error:', err);
            next();
        }
    };
}

/**
 * Get visible tabs/pages for current admin based on role
 */
function getVisibleTabs(adminUser) {
    const allTabs = [
        { id: 'overview', name: 'Overview', icon: 'chart-line', minLevel: 0 },
        { id: 'status', name: 'Status & Monitoring', icon: 'heartbeat', minLevel: 30 },
        { id: 'maintenance', name: 'Maintenance Mode', icon: 'wrench', minLevel: 50 },
        { id: 'users', name: 'Users & Roles', icon: 'users-cog', minLevel: 90, hidden: true },
        { id: 'permissions', name: 'Permissions', icon: 'shield-alt', minLevel: 90, hidden: true },
        { id: 'bot', name: 'Discord Bot Control', icon: 'robot', minLevel: 50 },
        { id: 'platform', name: 'Platform Control', icon: 'server', minLevel: 50 },
        { id: 'updates', name: 'Updates', icon: 'rocket', minLevel: 50 },
        { id: 'dashboards', name: 'External Dashboards', icon: 'external-link-alt', minLevel: 0 },
        { id: 'themes', name: 'Theme Manager', icon: 'palette', minLevel: 50 },
        { id: 'logs', name: 'Logs', icon: 'scroll', minLevel: 30 },
        { id: 'audit', name: 'Audit Trail', icon: 'clipboard-list', minLevel: 50 },
        { id: 'security', name: 'Security Center', icon: 'shield-halved', minLevel: 70 },
        { id: 'bug-reports', name: 'Bug Reports', icon: 'bug', minLevel: 30 },
        { id: 'profile', name: 'Profile & Security', icon: 'user-lock', minLevel: 0 },
        { id: 'integrations', name: 'Integrations', icon: 'plug', minLevel: 70 },
        { id: 'settings', name: 'Settings', icon: 'cog', minLevel: 50 }
    ];

    if (!adminUser) return [];

    return allTabs.filter(tab => {
        // Hidden tabs only visible to owner/co-owner
        if (tab.hidden && adminUser.rank_level < 90) {
            return false;
        }
        return adminUser.rank_level >= tab.minLevel;
    });
}

module.exports = {
    addRequestId,
    loadAdminUser,
    requireRoleMin,
    requirePermission,
    ownerOrCoOwnerOnly,
    ownerOnly,
    requireActiveStatus,
    requireScope,
    require2FA,
    checkIPAllowlist,
    sensitiveActionLimiter,
    adminApiLimiter,
    auditAllActions,
    checkMaintenance,
    getVisibleTabs,
    logAuditAction,
    logSecurityEvent,
    getClientIP,
    ROLE_LEVELS: rbacSchema.ROLE_LEVELS
};
