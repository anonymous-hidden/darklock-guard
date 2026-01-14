/**
 * Security Middleware for Dashboard
 * 
 * ARCHITECTURE DECISION (Phase 5 Decomposition):
 * Extracted from monolithic dashboard.js to improve maintainability.
 * This module handles:
 * - Security header configuration (CSP, HSTS, etc.)
 * - Cache prevention for authenticated routes
 * - UTF-8 charset enforcement
 * - Secrets validation
 */

const helmet = require('helmet');

/**
 * Create security middleware factory
 * @param {Object} options - Configuration options
 * @param {Object} options.bot - Bot instance for logging
 */
function createSecurityMiddleware(options = {}) {
    const { bot } = options;
    const logger = bot?.logger || console;

    /**
     * UTF-8 charset middleware for all HTML responses
     * FIXES: Emoji encoding issues (mojibake)
     */
    function utf8Charset(req, res, next) {
        if (req.path.endsWith('.html') || !req.path.includes('.') || req.path === '/') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
        next();
    }

    /**
     * Dynamic CSP middleware with WebSocket support
     */
    function dynamicCSP(req, res, next) {
        // Build dynamic WebSocket URL based on current host
        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
        const host = req.get('host') || 'localhost:3000';
        const wsUrl = `${protocol}://${host}`;
        
        const cspDirectives = {
            'default-src': ["'self'"],
            'script-src': ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://cdn.jsdelivr.net", "'unsafe-hashes'"],
            'script-src-attr': ["'unsafe-inline'"],
            'frame-src': ["https://js.stripe.com", "https://hooks.stripe.com"],
            'connect-src': ["'self'", "https://api.stripe.com", "https://cdn.jsdelivr.net", wsUrl],
            'img-src': ["'self'", "data:", "https:"],
            'style-src': ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            'style-src-elem': ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            'font-src': ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"]
        };
        
        res.setHeader('Content-Security-Policy', 
            Object.entries(cspDirectives)
                .map(([key, values]) => `${key} ${values.join(' ')}`)
                .join('; ')
        );
        next();
    }

    /**
     * Get configured helmet middleware (without CSP - handled separately)
     */
    function getHelmetMiddleware() {
        return helmet({
            contentSecurityPolicy: false, // Handled by dynamicCSP
            permissionsPolicy: {
                features: {
                    camera: ["'none'"],
                    microphone: ["'none'"],
                    geolocation: ["'none'"]
                }
            },
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            }
        });
    }

    /**
     * Cache prevention for authenticated routes
     * CRITICAL: Prevents Back button from showing cached dashboard after logout
     */
    function noCacheAuthenticated(req, res, next) {
        const protectedPaths = [
            '/admin', '/dashboard', '/api/', '/setup',
            '/analytics', '/tickets', '/help', '/console'
        ];
        
        if (protectedPaths.some(p => req.path.startsWith(p))) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
        }
        next();
    }

    /**
     * CSRF token injection middleware
     */
    function csrfTokenSetup(generateCSRFToken) {
        return (req, res, next) => {
            if (!req.session) req.session = {};
            if (!req.session.csrfToken) {
                req.session.csrfToken = generateCSRFToken();
            }
            next();
        };
    }

    /**
     * Validate required secrets at startup
     * @throws {Error} If critical secrets are missing or weak
     */
    function validateSecrets() {
        const requiredSecrets = [
            'JWT_SECRET',
            'DISCORD_TOKEN',
            'DISCORD_CLIENT_SECRET',
            'INTERNAL_API_KEY'
        ];

        // Stripe secrets required only if billing is enabled
        if (process.env.STRIPE_SECRET || process.env.STRIPE_PRO_PRICE_ID || process.env.STRIPE_ENTERPRISE_PRICE_ID) {
            requiredSecrets.push('STRIPE_SECRET');
        }

        // Warn about missing OAUTH_STATE_SECRET
        if (!process.env.OAUTH_STATE_SECRET) {
            const msg = '[Security Warning] OAUTH_STATE_SECRET is not set. OAuth state parameter will not be strongly bound.';
            logger.warn?.(msg) || console.warn(msg);
        }

        const missingSecrets = [];
        const weakSecrets = [];

        for (const secret of requiredSecrets) {
            const value = process.env[secret];
            
            if (!value) {
                missingSecrets.push(secret);
                continue;
            }

            // Check for default/placeholder values
            if (value.includes('change-this-key') || 
                value.includes('your_') || 
                value === 'change_me' ||
                value.includes('placeholder')) {
                weakSecrets.push(secret);
            }

            // Check JWT_SECRET length
            if (secret === 'JWT_SECRET' && value.length < 64) {
                const msg = `[Security Warning] JWT_SECRET is too short (${value.length} chars). Minimum recommended: 64 characters.`;
                if (process.env.NODE_ENV === 'production') {
                    throw new Error(msg);
                }
                logger.warn?.(msg) || console.warn(msg);
            }
        }

        if (missingSecrets.length > 0) {
            const msg = `CRITICAL: Missing required secrets: ${missingSecrets.join(', ')}. Please set environment variables.`;
            throw new Error(msg);
        }

        if (weakSecrets.length > 0) {
            const msg = `[Security Warning] Weak/default secrets detected: ${weakSecrets.join(', ')}. Replace with secure values!`;
            logger.warn?.(msg) || console.warn(msg);
            throw new Error(msg);
        }

        logger.info?.('[Security] ✓ All required secrets validated') || 
            console.log('[Security] ✓ All required secrets validated');
    }

    return {
        utf8Charset,
        dynamicCSP,
        getHelmetMiddleware,
        noCacheAuthenticated,
        csrfTokenSetup,
        validateSecrets
    };
}

module.exports = { createSecurityMiddleware };
