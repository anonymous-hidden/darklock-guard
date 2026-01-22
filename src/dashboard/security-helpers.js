/**
 * Centralized Security Helpers
 * 
 * CRITICAL SECURITY MODULE - DO NOT MODIFY WITHOUT SECURITY REVIEW
 * 
 * This module provides:
 * - Environment secret validation (fail-fast on missing/weak secrets)
 * - Guild access authorization (IDOR protection)
 * - Session-bound CSRF token management
 * - Secure rate limiting helpers
 */

const crypto = require('crypto');

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_JWT_SECRET_LENGTH = 32;
const MIN_OAUTH_STATE_SECRET_LENGTH = 32;
const MIN_INTERNAL_API_KEY_LENGTH = 32;
const CSRF_TOKEN_BYTES = 32;
const CSRF_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Weak/placeholder patterns that MUST be rejected
const WEAK_SECRET_PATTERNS = [
    'change-this',
    'change_me',
    'your_',
    'placeholder',
    'example',
    'default',
    'secret123',
    'password',
    'changeme',
    'replace_this',
    'todo',
    'fixme',
    'darklock-secret-key'
];

// ============================================================================
// SECRET VALIDATION
// ============================================================================

/**
 * Validate that an environment secret exists and meets security requirements.
 * FAILS HARD if secret is missing or weak - application will not start.
 * 
 * @param {string} name - Environment variable name
 * @param {number} minLength - Minimum required length
 * @param {boolean} exitOnFailure - Whether to exit process on failure (default: true)
 * @returns {string} The validated secret value
 * @throws {Error} If secret is missing or weak
 */
function requireEnvSecret(name, minLength = 32, exitOnFailure = true) {
    const value = process.env[name];
    
    // Check existence
    if (!value || value.trim() === '') {
        const msg = `[SECURITY FATAL] Required secret ${name} is not set. Application cannot start securely.`;
        console.error(msg);
        if (exitOnFailure) {
            process.exit(1);
        }
        throw new Error(msg);
    }
    
    // Check length
    if (value.length < minLength) {
        const msg = `[SECURITY FATAL] Secret ${name} is too short (${value.length} chars, minimum ${minLength}). Application cannot start securely.`;
        console.error(msg);
        if (exitOnFailure) {
            process.exit(1);
        }
        throw new Error(msg);
    }
    
    // Check for weak/placeholder values
    const lowerValue = value.toLowerCase();
    for (const pattern of WEAK_SECRET_PATTERNS) {
        if (lowerValue.includes(pattern)) {
            const msg = `[SECURITY FATAL] Secret ${name} contains weak/placeholder pattern "${pattern}". Replace with a secure random value.`;
            console.error(msg);
            if (exitOnFailure) {
                process.exit(1);
            }
            throw new Error(msg);
        }
    }
    
    // Check entropy (basic check - ensure not all same character)
    const uniqueChars = new Set(value).size;
    if (uniqueChars < 10) {
        const msg = `[SECURITY FATAL] Secret ${name} has insufficient entropy (only ${uniqueChars} unique characters). Use a cryptographically random value.`;
        console.error(msg);
        if (exitOnFailure) {
            process.exit(1);
        }
        throw new Error(msg);
    }
    
    return value;
}

/**
 * Validate all required secrets at application startup.
 * Call this ONCE during initialization - exits process on failure.
 * 
 * @returns {object} Object containing validated secrets
 */
function validateAllSecrets() {
    console.log('[Security] Validating required secrets...');
    
    const secrets = {
        JWT_SECRET: requireEnvSecret('JWT_SECRET', MIN_JWT_SECRET_LENGTH),
        OAUTH_STATE_SECRET: requireEnvSecret('OAUTH_STATE_SECRET', MIN_OAUTH_STATE_SECRET_LENGTH),
        INTERNAL_API_KEY: requireEnvSecret('INTERNAL_API_KEY', MIN_INTERNAL_API_KEY_LENGTH),
        DISCORD_TOKEN: requireEnvSecret('DISCORD_TOKEN', 50), // Discord tokens are ~70 chars
        DISCORD_CLIENT_SECRET: requireEnvSecret('DISCORD_CLIENT_SECRET', 20)
    };
    
    console.log('[Security] ✅ All required secrets validated successfully');
    return secrets;
}

// ============================================================================
// GUILD ACCESS AUTHORIZATION (IDOR PROTECTION)
// ============================================================================

/**
 * Check if a user has access to a specific guild.
 * This is the SINGLE SOURCE OF TRUTH for guild authorization.
 * 
 * @param {object} bot - Bot instance with client and database
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Guild ID to check access for
 * @param {boolean} requireManage - Whether to require manage permissions (default: true)
 * @returns {Promise<{authorized: boolean, reason?: string, accessType?: string}>}
 */
async function requireGuildAccess(bot, userId, guildId, requireManage = true) {
    // Validate inputs
    if (!userId || typeof userId !== 'string') {
        return { authorized: false, reason: 'Invalid user ID' };
    }
    
    if (!guildId || typeof guildId !== 'string' || !/^\d{17,19}$/.test(guildId)) {
        return { authorized: false, reason: 'Invalid guild ID format' };
    }
    
    // Special case: admin bypass (only for password-authenticated admins)
    if (userId === 'admin') {
        return { authorized: true, accessType: 'admin_bypass' };
    }
    
    // Get guild from bot cache
    const guild = bot.client?.guilds?.cache?.get(guildId);
    if (!guild) {
        // SECURITY: Don't reveal whether guild exists - use generic message
        return { authorized: false, reason: 'Access denied' };
    }
    
    // Check 1: Server owner always has access
    if (guild.ownerId === userId) {
        return { authorized: true, accessType: 'owner' };
    }
    
    // Check 2: Explicit database access grant
    try {
        const explicitAccess = await bot.database.get(
            'SELECT permission_level FROM dashboard_access WHERE guild_id = ? AND user_id = ?',
            [guildId, userId]
        );
        
        if (explicitAccess) {
            return { authorized: true, accessType: 'explicit_grant', level: explicitAccess.permission_level };
        }
    } catch (e) {
        // Database error - fail secure
        console.error('[Security] Guild access DB check failed:', e.message);
    }
    
    // Check 3: Discord permissions
    let member;
    try {
        member = await guild.members.fetch(userId);
    } catch (e) {
        // User not in guild - use generic message
        return { authorized: false, reason: 'Access denied' };
    }
    
    if (!member) {
        return { authorized: false, reason: 'Access denied' };
    }
    
    // Check Discord admin/manage permissions
    if (requireManage) {
        const hasAdminPerms = member.permissions.has('Administrator') || 
                             member.permissions.has('ManageGuild');
        
        if (hasAdminPerms) {
            return { authorized: true, accessType: 'discord_permissions' };
        }
    }
    
    // Check 4: Role-based access
    try {
        const roleAccess = await bot.database.all(
            'SELECT role_id FROM dashboard_role_access WHERE guild_id = ?',
            [guildId]
        );
        
        if (roleAccess && roleAccess.length > 0) {
            const grantedRoleIds = roleAccess.map(r => r.role_id);
            const userRoleIds = Array.from(member.roles.cache.keys());
            const hasGrantedRole = grantedRoleIds.some(rid => userRoleIds.includes(rid));
            
            if (hasGrantedRole) {
                return { authorized: true, accessType: 'role_grant' };
            }
        }
    } catch (e) {
        console.error('[Security] Role access check failed:', e.message);
    }
    
    // No access found - SECURITY: Use generic message
    return { authorized: false, reason: 'Access denied' };
}

/**
 * Express middleware factory for guild access validation.
 * Extracts guildId from params, query, or body and validates access.
 * 
 * @param {object} bot - Bot instance
 * @param {boolean} requireManage - Whether to require manage permissions
 * @returns {Function} Express middleware
 */
function guildAccessMiddleware(bot, requireManage = true) {
    return async (req, res, next) => {
        const userId = req.user?.userId;
        const guildId = req.params.guildId || req.query.guildId || req.body?.guildId;
        
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        if (!guildId) {
            return res.status(400).json({ error: 'Guild ID required' });
        }
        
        const access = await requireGuildAccess(bot, userId, guildId, requireManage);
        
        if (!access.authorized) {
            // Log unauthorized access attempt
            console.warn(`[Security] Unauthorized guild access attempt: user=${userId} guild=${guildId}`);
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Attach access info to request for downstream use
        req.guildAccess = access;
        req.validatedGuildId = guildId;
        
        next();
    };
}

// ============================================================================
// SESSION-BOUND CSRF PROTECTION
// ============================================================================

// In-memory CSRF token store (use Redis in production)
// Structure: Map<sessionId, { token: string, createdAt: number, userId: string }>
const csrfTokenStore = new Map();

/**
 * Generate a new CSRF token bound to a session.
 * 
 * @param {string} sessionId - Session identifier
 * @param {string} userId - User ID (for additional binding)
 * @returns {string} Generated CSRF token
 */
function generateSessionCSRFToken(sessionId, userId) {
    if (!sessionId) {
        throw new Error('Session ID required for CSRF token generation');
    }
    
    const token = crypto.randomBytes(CSRF_TOKEN_BYTES).toString('hex');
    
    csrfTokenStore.set(sessionId, {
        token,
        createdAt: Date.now(),
        userId: userId || null
    });
    
    return token;
}

/**
 * Validate a CSRF token against a session.
 * 
 * @param {string} sessionId - Session identifier
 * @param {string} token - Token to validate
 * @param {string} userId - User ID for additional verification
 * @returns {{valid: boolean, reason?: string}}
 */
function validateSessionCSRFToken(sessionId, token, userId) {
    if (!sessionId || !token) {
        return { valid: false, reason: 'Missing session or token' };
    }
    
    const stored = csrfTokenStore.get(sessionId);
    
    if (!stored) {
        return { valid: false, reason: 'No CSRF token found for session' };
    }
    
    // Check expiry
    if (Date.now() - stored.createdAt > CSRF_TOKEN_EXPIRY_MS) {
        csrfTokenStore.delete(sessionId);
        return { valid: false, reason: 'CSRF token expired' };
    }
    
    // Timing-safe comparison
    const tokenBuffer = Buffer.from(token);
    const storedBuffer = Buffer.from(stored.token);
    
    if (tokenBuffer.length !== storedBuffer.length) {
        return { valid: false, reason: 'Invalid token' };
    }
    
    if (!crypto.timingSafeEqual(tokenBuffer, storedBuffer)) {
        return { valid: false, reason: 'Invalid token' };
    }
    
    // Verify user binding if provided
    if (stored.userId && userId && stored.userId !== userId) {
        return { valid: false, reason: 'Token not bound to user' };
    }
    
    return { valid: true };
}

/**
 * Invalidate CSRF token for a session (call on logout).
 * 
 * @param {string} sessionId - Session identifier
 */
function invalidateSessionCSRFToken(sessionId) {
    csrfTokenStore.delete(sessionId);
}

/**
 * Rotate CSRF token for a session (call on login).
 * 
 * @param {string} sessionId - Session identifier
 * @param {string} userId - User ID
 * @returns {string} New CSRF token
 */
function rotateSessionCSRFToken(sessionId, userId) {
    invalidateSessionCSRFToken(sessionId);
    return generateSessionCSRFToken(sessionId, userId);
}

// Cleanup expired CSRF tokens every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, data] of csrfTokenStore.entries()) {
        if (now - data.createdAt > CSRF_TOKEN_EXPIRY_MS) {
            csrfTokenStore.delete(sessionId);
        }
    }
}, 5 * 60 * 1000);

// ============================================================================
// RATE LIMITING HELPERS
// ============================================================================

// Known proxy IP ranges (update for your infrastructure)
const TRUSTED_PROXY_RANGES = [
    '127.0.0.1',
    '::1',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    // Add Cloudflare, Render, or other known proxy IPs here
];

/**
 * Get the real client IP address, only trusting known proxies.
 * 
 * @param {object} req - Express request object
 * @returns {string} Client IP address
 */
function getRealClientIP(req) {
    // If we're not behind a trusted proxy, use direct IP
    const directIP = req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
    
    // Only trust X-Forwarded-For if direct connection is from trusted proxy
    if (!isIPInTrustedRange(directIP)) {
        return directIP;
    }
    
    // Get forwarded IP
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        // Take the first (leftmost) IP - this is the original client
        const ips = forwardedFor.split(',').map(ip => ip.trim());
        const clientIP = ips[0];
        
        // Validate it looks like an IP
        if (isValidIP(clientIP)) {
            return clientIP;
        }
    }
    
    // Fallback to X-Real-IP
    const realIP = req.headers['x-real-ip'];
    if (realIP && isValidIP(realIP)) {
        return realIP;
    }
    
    return directIP;
}

/**
 * Check if an IP is in trusted proxy ranges.
 */
function isIPInTrustedRange(ip) {
    if (!ip) return false;
    
    // Simple check for localhost
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        return true;
    }
    
    // For production, implement proper CIDR matching
    // This is a simplified version
    for (const range of TRUSTED_PROXY_RANGES) {
        if (ip.startsWith(range.split('/')[0].split('.').slice(0, 2).join('.'))) {
            return true;
        }
    }
    
    return false;
}

/**
 * Basic IP validation.
 */
function isValidIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    
    // IPv4
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
        const parts = ip.split('.').map(Number);
        return parts.every(p => p >= 0 && p <= 255);
    }
    
    // IPv6 (simplified check)
    if (ip.includes(':')) {
        return /^[0-9a-fA-F:]+$/.test(ip);
    }
    
    return false;
}

/**
 * Create a rate limit key generator that uses real client IP.
 * 
 * @returns {Function} Key generator function for express-rate-limit
 */
function createRateLimitKeyGenerator() {
    return (req) => {
        // Prefer authenticated user ID for rate limiting
        if (req.user?.userId) {
            return `user:${req.user.userId}`;
        }
        
        // Fall back to real client IP
        return `ip:${getRealClientIP(req)}`;
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Secret validation
    requireEnvSecret,
    validateAllSecrets,
    MIN_JWT_SECRET_LENGTH,
    MIN_OAUTH_STATE_SECRET_LENGTH,
    
    // Guild access
    requireGuildAccess,
    guildAccessMiddleware,
    
    // CSRF protection
    generateSessionCSRFToken,
    validateSessionCSRFToken,
    invalidateSessionCSRFToken,
    rotateSessionCSRFToken,
    
    // Rate limiting
    getRealClientIP,
    createRateLimitKeyGenerator,
    TRUSTED_PROXY_RANGES
};
