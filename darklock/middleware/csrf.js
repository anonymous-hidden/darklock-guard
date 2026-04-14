/**
 * CSRF Protection Middleware for Darklock Platform
 * 
 * Uses double-submit cookie pattern:
 * - Server generates a random token and sets it as a cookie
 * - Client reads the cookie and sends it in X-CSRF-Token header
 * - Server validates that cookie value matches header value
 * 
 * This is stateless (no server-side session needed) and works
 * with the existing cookie-parser middleware.
 */

'use strict';

const crypto = require('crypto');

const CSRF_COOKIE_NAME = '_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generate a cryptographically secure CSRF token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware: Set CSRF cookie on every response if not already present.
 * Must run AFTER cookie-parser.
 */
function csrfCookie(req, res, next) {
    if (!req.cookies[CSRF_COOKIE_NAME]) {
        const token = generateToken();
        res.cookie(CSRF_COOKIE_NAME, token, {
            httpOnly: false,  // Client JS needs to read this to send in header
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        // Also expose on request for template rendering
        req.csrfToken = token;
    } else {
        req.csrfToken = req.cookies[CSRF_COOKIE_NAME];
    }
    next();
}

/**
 * Middleware: Validate CSRF token on state-changing requests (POST, PUT, DELETE, PATCH).
 * Skips GET, HEAD, OPTIONS.
 */
function csrfProtection(req, res, next) {
    // Skip safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const cookieToken = req.cookies[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME] || req.body?._csrf;

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({
            success: false,
            error: 'CSRF token validation failed. Please refresh and try again.'
        });
    }

    next();
}

/**
 * Combined middleware that sets cookie + validates on mutations.
 * Use this on route groups that need full CSRF protection.
 */
function csrf() {
    return [csrfCookie, csrfProtection];
}

module.exports = {
    csrfCookie,
    csrfProtection,
    csrf,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME
};
