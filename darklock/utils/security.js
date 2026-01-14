/**
 * Darklock Platform - Security Utilities
 * Handles atomic file writes, file locking, rate limiting, and session management
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// FILE LOCKING & ATOMIC WRITES
// ============================================================================

// In-memory write queue for preventing concurrent writes
const writeQueues = new Map();
const fileLocks = new Map();

/**
 * Acquire a lock for a file
 * @param {string} filePath - Path to the file
 * @param {number} timeout - Max time to wait for lock (ms)
 * @returns {Promise<Function>} - Release function
 */
async function acquireLock(filePath, timeout = 5000) {
    const startTime = Date.now();
    
    while (fileLocks.get(filePath)) {
        if (Date.now() - startTime > timeout) {
            throw new Error(`Lock timeout for file: ${filePath}`);
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    fileLocks.set(filePath, true);
    
    return () => {
        fileLocks.delete(filePath);
    };
}

/**
 * Atomically write data to a JSON file
 * Uses write-to-temp + rename pattern for crash safety
 * @param {string} filePath - Path to the file
 * @param {object} data - Data to write
 */
async function atomicWriteJSON(filePath, data) {
    const release = await acquireLock(filePath);
    
    try {
        const tempPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
        const content = JSON.stringify(data, null, 2);
        
        // Write to temp file first
        await fs.promises.writeFile(tempPath, content, 'utf8');
        
        // Rename temp to target (atomic on most filesystems)
        await fs.promises.rename(tempPath, filePath);
        
        return true;
    } catch (err) {
        console.error('[Darklock Security] Atomic write failed:', err.message);
        throw err;
    } finally {
        release();
    }
}

/**
 * Safely read a JSON file with error handling
 * @param {string} filePath - Path to the file
 * @param {object} defaultValue - Default value if file doesn't exist
 */
async function safeReadJSON(filePath, defaultValue = {}) {
    try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return defaultValue;
        }
        console.error('[Darklock Security] Read failed:', err.message);
        return defaultValue;
    }
}

// ============================================================================
// RATE LIMITING
// ============================================================================

// In-memory rate limit store (per-IP)
const rateLimitStore = new Map();

// Clean up old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of rateLimitStore.entries()) {
        if (now - data.windowStart > data.windowMs * 2) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * Rate limiter configuration
 */
const rateLimitConfigs = {
    login: { windowMs: 15 * 60 * 1000, maxAttempts: 5, blockDuration: 15 * 60 * 1000 },
    signup: { windowMs: 60 * 60 * 1000, maxAttempts: 3, blockDuration: 60 * 60 * 1000 },
    '2fa': { windowMs: 15 * 60 * 1000, maxAttempts: 5, blockDuration: 15 * 60 * 1000 },
    passwordChange: { windowMs: 60 * 60 * 1000, maxAttempts: 3, blockDuration: 60 * 60 * 1000 }
};

/**
 * Check if IP is rate limited for an action
 * @param {string} ip - Client IP
 * @param {string} action - Action type (login, signup, 2fa, passwordChange)
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
function checkRateLimit(ip, action) {
    const config = rateLimitConfigs[action];
    if (!config) return { allowed: true, remaining: Infinity, retryAfter: 0 };
    
    const key = `${action}:${ip}`;
    const now = Date.now();
    let data = rateLimitStore.get(key);
    
    // Initialize or reset window
    if (!data || now - data.windowStart > config.windowMs) {
        data = {
            windowStart: now,
            windowMs: config.windowMs,
            attempts: 0,
            blockedUntil: data?.blockedUntil || 0
        };
    }
    
    // Check if blocked
    if (data.blockedUntil > now) {
        const retryAfter = Math.ceil((data.blockedUntil - now) / 1000);
        return {
            allowed: false,
            remaining: 0,
            retryAfter
        };
    }
    
    const remaining = config.maxAttempts - data.attempts;
    
    return {
        allowed: remaining > 0,
        remaining: Math.max(0, remaining),
        retryAfter: remaining <= 0 ? Math.ceil(config.blockDuration / 1000) : 0
    };
}

/**
 * Record an attempt for rate limiting
 * @param {string} ip - Client IP
 * @param {string} action - Action type
 * @param {boolean} success - Whether the attempt succeeded
 */
function recordAttempt(ip, action, success = false) {
    const config = rateLimitConfigs[action];
    if (!config) return;
    
    const key = `${action}:${ip}`;
    const now = Date.now();
    let data = rateLimitStore.get(key);
    
    if (!data || now - data.windowStart > config.windowMs) {
        data = {
            windowStart: now,
            windowMs: config.windowMs,
            attempts: 0,
            blockedUntil: 0
        };
    }
    
    // Only increment on failure, reset on success
    if (success) {
        data.attempts = 0;
        data.blockedUntil = 0;
    } else {
        data.attempts++;
        
        // Block if too many attempts
        if (data.attempts >= config.maxAttempts) {
            data.blockedUntil = now + config.blockDuration;
        }
    }
    
    rateLimitStore.set(key, data);
}

/**
 * Express middleware factory for rate limiting
 */
function rateLimitMiddleware(action) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const result = checkRateLimit(ip, action);
        
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        
        if (!result.allowed) {
            res.setHeader('Retry-After', result.retryAfter);
            return res.status(429).json({
                success: false,
                error: `Too many attempts. Please try again in ${Math.ceil(result.retryAfter / 60)} minutes.`,
                retryAfter: result.retryAfter
            });
        }
        
        // Attach helper to record result
        req.recordAttempt = (success) => recordAttempt(ip, action, success);
        
        next();
    };
}

// ============================================================================
// SESSION MANAGEMENT WITH JWT ID (jti)
// ============================================================================

/**
 * Generate a unique JWT ID (jti)
 */
function generateJti() {
    return crypto.randomUUID();
}

/**
 * Validate a session by its jti
 * @param {string} jti - JWT ID
 * @param {string} userId - User ID
 * @param {object} sessions - Sessions data object
 * @returns {boolean}
 */
function isSessionValid(jti, userId, sessions) {
    if (!jti || !userId || !sessions?.sessions) return false;
    
    const session = sessions.sessions.find(s => s.jti === jti && s.userId === userId);
    
    if (!session) return false;
    if (session.revokedAt) return false;
    
    return true;
}

/**
 * Revoke all sessions for a user
 * @param {string} userId - User ID
 * @param {object} sessions - Sessions data object
 * @param {string} exceptJti - Optional jti to keep active
 * @returns {object} - Updated sessions object
 */
function revokeUserSessions(userId, sessions, exceptJti = null) {
    if (!sessions?.sessions) return sessions;
    
    sessions.sessions = sessions.sessions.map(s => {
        if (s.userId === userId && s.jti !== exceptJti && !s.revokedAt) {
            return { ...s, revokedAt: new Date().toISOString() };
        }
        return s;
    });
    
    return sessions;
}

/**
 * Clean up expired/revoked sessions (run periodically)
 * @param {object} sessions - Sessions data object
 * @param {number} maxAge - Max age in ms (default 30 days)
 * @returns {object} - Cleaned sessions object
 */
function cleanupSessions(sessions, maxAge = 30 * 24 * 60 * 60 * 1000) {
    if (!sessions?.sessions) return sessions;
    
    const cutoff = Date.now() - maxAge;
    
    sessions.sessions = sessions.sessions.filter(s => {
        const createdAt = new Date(s.createdAt).getTime();
        // Keep if not too old and not revoked
        return createdAt > cutoff && !s.revokedAt;
    });
    
    return sessions;
}

// ============================================================================
// 2FA VERIFICATION REQUIREMENT
// ============================================================================

// Store for pending 2FA verifications for sensitive actions
const pendingVerifications = new Map();

/**
 * Require 2FA verification for sensitive action
 * @param {string} userId - User ID
 * @param {string} action - Action type
 * @returns {string} - Verification token
 */
function requireFreshVerification(userId, action) {
    const token = crypto.randomBytes(32).toString('hex');
    const key = `${userId}:${action}`;
    
    pendingVerifications.set(key, {
        token,
        createdAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
    });
    
    return token;
}

/**
 * Validate a fresh 2FA verification
 * @param {string} userId - User ID
 * @param {string} action - Action type
 * @param {string} token - Verification token
 * @returns {boolean}
 */
function validateFreshVerification(userId, action, token) {
    const key = `${userId}:${action}`;
    const verification = pendingVerifications.get(key);
    
    if (!verification) return false;
    if (verification.token !== token) return false;
    if (Date.now() > verification.expiresAt) {
        pendingVerifications.delete(key);
        return false;
    }
    
    // One-time use
    pendingVerifications.delete(key);
    return true;
}

/**
 * Mark action as verified with 2FA (valid for short period)
 * @param {string} userId - User ID  
 * @param {string} action - Action type
 */
function markVerified(userId, action) {
    const key = `${userId}:${action}`;
    pendingVerifications.set(key, {
        verified: true,
        createdAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000 // Valid for 5 minutes
    });
}

/**
 * Check if action was recently verified with 2FA
 * @param {string} userId - User ID
 * @param {string} action - Action type
 * @returns {boolean}
 */
function isRecentlyVerified(userId, action) {
    const key = `${userId}:${action}`;
    const verification = pendingVerifications.get(key);
    
    if (!verification?.verified) return false;
    if (Date.now() > verification.expiresAt) {
        pendingVerifications.delete(key);
        return false;
    }
    
    return true;
}

// Clean up expired verifications every minute
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of pendingVerifications.entries()) {
        if (now > data.expiresAt) {
            pendingVerifications.delete(key);
        }
    }
}, 60 * 1000);

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // File operations
    atomicWriteJSON,
    safeReadJSON,
    acquireLock,
    
    // Rate limiting
    checkRateLimit,
    recordAttempt,
    rateLimitMiddleware,
    rateLimitConfigs,
    
    // Session management
    generateJti,
    isSessionValid,
    revokeUserSessions,
    cleanupSessions,
    
    // 2FA verification
    requireFreshVerification,
    validateFreshVerification,
    markVerified,
    isRecentlyVerified
};
