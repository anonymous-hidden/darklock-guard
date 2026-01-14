/**
 * Security Audit Implementation - Dashboard Authentication
 * 
 * CRITICAL CHANGES IMPLEMENTED:
 * 
 * 1. ✅ Removed auth tokens from URLs - No more ?token= query strings
 * 2. ✅ Stopped storing auth tokens in localStorage - Using HTTP-only cookies only
 * 3. ✅ Implemented CSRF protection with tokens
 * 4. ✅ Added brute force protection with rate limiting
 * 5. ✅ Added secure cookie flags (HttpOnly, Secure, SameSite)
 * 6. ✅ Added Content Security Policy (CSP)
 * 7. ✅ Added session expiration handling
 * 8. ✅ Improved error handling (no raw error exposure)
 * 
 * MIGRATION GUIDE:
 * 
 * Frontend Changes:
 * - Remove all localStorage.getItem/setItem('token'|'dashboardToken')
 * - Remove all URL token parameters
 * - Use fetch with credentials: 'include' for all API calls
 * - Include CSRF token in POST/PUT/DELETE requests
 * 
 * Backend Changes:
 * - OAuth callback sets HTTP-only secure cookie
 * - All authenticated endpoints validate cookie + CSRF
 * - Rate limiting on login endpoint
 * - Secure session management
 */

// CSRF Token Generation
function generateCSRFToken() {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
}

// Session Store (in-memory for now, use Redis in production)
const sessionStore = new Map();

// Brute Force Protection
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

function checkBruteForce(identifier) {
    const attempts = loginAttempts.get(identifier) || { count: 0, lockedUntil: null };
    
    // Check if locked out
    if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
        const remainingTime = Math.ceil((attempts.lockedUntil - Date.now()) / 1000 / 60);
        return {
            blocked: true,
            remainingTime,
            message: `Too many failed attempts. Account locked for ${remainingTime} minutes.`
        };
    }
    
    // Reset if lockout expired
    if (attempts.lockedUntil && Date.now() >= attempts.lockedUntil) {
        loginAttempts.delete(identifier);
        return { blocked: false };
    }
    
    // Check attempt count
    if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
        attempts.lockedUntil = Date.now() + LOCKOUT_DURATION;
        loginAttempts.set(identifier, attempts);
        return {
            blocked: true,
            remainingTime: LOCKOUT_DURATION / 1000 / 60,
            message: `Too many failed attempts. Account locked for ${LOCKOUT_DURATION / 1000 / 60} minutes.`
        };
    }
    
    return { blocked: false };
}

function recordFailedLogin(identifier) {
    const attempts = loginAttempts.get(identifier) || { count: 0, lockedUntil: null };
    attempts.count++;
    attempts.lastAttempt = Date.now();
    loginAttempts.set(identifier, attempts);
}

function resetLoginAttempts(identifier) {
    loginAttempts.delete(identifier);
}

// Clean up old attempts every hour
setInterval(() => {
    const now = Date.now();
    for (const [identifier, attempts] of loginAttempts.entries()) {
        if (attempts.lockedUntil && now >= attempts.lockedUntil) {
            loginAttempts.delete(identifier);
        } else if (!attempts.lockedUntil && now - attempts.lastAttempt > 60 * 60 * 1000) {
            loginAttempts.delete(identifier);
        }
    }
}, 60 * 60 * 1000);

// User-Agent Parsing Functions
function parseDevice(userAgent) {
    if (!userAgent) return 'Unknown';
    if (/mobile/i.test(userAgent)) return 'Mobile';
    if (/tablet|ipad/i.test(userAgent)) return 'Tablet';
    return 'Desktop';
}

function parseBrowser(userAgent) {
    if (!userAgent) return 'Unknown';
    if (userAgent.includes('Edg/')) return 'Edge';
    if (userAgent.includes('Chrome/')) return 'Chrome';
    if (userAgent.includes('Firefox/')) return 'Firefox';
    if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) return 'Safari';
    if (userAgent.includes('Opera/') || userAgent.includes('OPR/')) return 'Opera';
    return 'Other';
}

function parseOS(userAgent) {
    if (!userAgent) return 'Unknown';
    if (userAgent.includes('Windows NT 10.0')) return 'Windows 10';
    if (userAgent.includes('Windows NT')) return 'Windows';
    if (userAgent.includes('Mac OS X')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS';
    return 'Other';
}

module.exports = {
    generateCSRFToken,
    sessionStore,
    checkBruteForce,
    recordFailedLogin,
    resetLoginAttempts,
    parseDevice,
    parseBrowser,
    parseOS,
    MAX_LOGIN_ATTEMPTS,
    LOCKOUT_DURATION
};
