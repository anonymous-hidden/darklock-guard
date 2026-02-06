/**
 * Dashboard Middleware Index
 * Exports all middleware functions for dashboard bootstrap
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { sessionStore, generateCSRFToken } = require('./security-utils');

// ═══════════════════════════════════════════════════════════════════
// SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════

/**
 * Dynamic CSP with WebSocket URL based on request
 */
function dynamicCSP() {
    return (req, res, next) => {
        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
        const host = req.get('host') || 'localhost:3000';
        const wsUrl = `${protocol}://${host}`;

        const cspDirectives = {
            'default-src': ["'self'"],
            'script-src': ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://cdn.jsdelivr.net"],
            'script-src-attr': ["'unsafe-inline'"],
            'frame-src': ["https://js.stripe.com", "https://hooks.stripe.com"],
            'connect-src': ["'self'", "https://api.stripe.com", "https://cdn.jsdelivr.net", wsUrl],
            'img-src': ["'self'", "data:", "https:"],
            'style-src': ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            'font-src': ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"]
        };

        res.setHeader('Content-Security-Policy',
            Object.entries(cspDirectives)
                .map(([key, values]) => `${key} ${values.join(' ')}`)
                .join('; ')
        );
        next();
    };
}

/**
 * UTF-8 charset for HTML responses
 */
function utf8Charset() {
    return (req, res, next) => {
        if (req.path.endsWith('.html') || !req.path.includes('.') || req.path === '/') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
        next();
    };
}

/**
 * No-cache headers for protected routes
 */
function noCacheProtected() {
    const protectedPaths = ['/admin', '/dashboard', '/api/', '/setup', '/analytics', '/tickets', '/console'];
    
    return (req, res, next) => {
        if (protectedPaths.some(p => req.path.startsWith(p))) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
        }
        next();
    };
}

/**
 * Request ID for tracing
 */
function requestId() {
    return (req, res, next) => {
        req.id = crypto.randomUUID();
        res.setHeader('X-Request-ID', req.id);
        next();
    };
}

// ═══════════════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════════════

/**
 * API rate limiter
 */
function apiRateLimit() {
    return rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 500, // 500 requests per minute (generous for dashboard)
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests, please try again later' },
        keyGenerator: (req) => req.user?.userId || req.ip,
        skip: (req) => {
            // Skip rate limiting for theme/static endpoints
            return req.path.includes('theme') ||
                   req.path.includes('csrf') ||
                   req.path.includes('current-theme') ||
                   req.path.startsWith('/static/') ||
                   req.path.endsWith('.css') ||
                   req.path.endsWith('.js');
        }
    });
}

/**
 * Auth endpoints rate limiter (stricter)
 */
function authRateLimit() {
    return rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many authentication attempts' },
        keyGenerator: (req) => req.ip
    });
}

// ═══════════════════════════════════════════════════════════════════
// AUTHENTICATION MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════

/**
 * JWT token authentication middleware factory
 * @param {Object} dashboard - Dashboard instance
 */
function authenticateToken(dashboard) {
    return async (req, res, next) => {
        // Extract token from Authorization header or cookie
        let token = null;
        const authHeader = req.headers['authorization'];
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7);
        } else if (req.cookies?.authToken) {
            token = req.cookies.authToken;
        }

        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Validate session if sessionId exists
            if (decoded.sessionId && sessionStore) {
                const session = sessionStore.get(decoded.sessionId);
                if (!session || session.revoked) {
                    return res.status(401).json({ error: 'Session expired or revoked' });
                }
            }

            req.user = decoded;
            req.dashboard = dashboard;
            next();
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Token expired' });
            }
            return res.status(403).json({ error: 'Invalid token' });
        }
    };
}

/**
 * Guild access verification middleware factory
 * @param {Object} dashboard - Dashboard instance
 */
function requireGuildAccess(dashboard) {
    return async (req, res, next) => {
        const guildId = req.params.guildId || req.body?.guildId || req.query?.guildId;
        
        if (!guildId) {
            return res.status(400).json({ error: 'Guild ID required' });
        }

        try {
            const access = await dashboard.checkGuildAccess(req.user.userId, guildId);
            
            if (!access?.authorized) {
                return res.status(403).json({ error: 'No access to this guild' });
            }

            req.guildAccess = access;
            next();
        } catch (err) {
            dashboard.bot.logger?.error('Guild access check failed:', err);
            return res.status(500).json({ error: 'Failed to verify guild access' });
        }
    };
}

/**
 * CSRF validation middleware
 */
function validateCSRF() {
    return (req, res, next) => {
        // Skip for GET, HEAD, OPTIONS
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return next();
        }

        const csrfToken = req.headers['x-csrf-token'] || req.body?._csrf;
        const sessionToken = req.session?.csrfToken;

        if (!csrfToken || csrfToken !== sessionToken) {
            return res.status(403).json({ error: 'Invalid CSRF token' });
        }

        next();
    };
}

/**
 * Admin-only middleware factory
 * @param {Object} dashboard - Dashboard instance
 */
function requireAdmin(dashboard) {
    return async (req, res, next) => {
        try {
            const isAdmin = await dashboard.isAdmin(req.user.userId);
            if (!isAdmin) {
                return res.status(403).json({ error: 'Admin access required' });
            }
            next();
        } catch (err) {
            return res.status(500).json({ error: 'Failed to verify admin status' });
        }
    };
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

module.exports = {
    // Security
    dynamicCSP,
    utf8Charset,
    noCacheProtected,
    requestId,
    
    // Rate limiting
    apiRateLimit,
    authRateLimit,
    
    // Authentication
    authenticateToken,
    requireGuildAccess,
    validateCSRF,
    requireAdmin,
    
    // Re-export existing middleware
    ...require('./middleware/index')
};
