/**
 * Authentication Middleware for Dashboard
 * 
 * ARCHITECTURE DECISION (Phase 5 Decomposition):
 * Extracted from monolithic dashboard.js to improve maintainability.
 * This module handles:
 * - JWT token verification for API requests
 * - HTML page authentication (redirect-based)
 * - CSRF token validation
 * - Pro/Premium gating
 * 
 * All middleware functions are designed to be attached to any Express router.
 */

const jwt = require('jsonwebtoken');

/**
 * Create authentication middleware factory
 * @param {Object} options - Configuration options
 * @param {Object} options.bot - Bot instance for database access
 * @param {Function} options.logger - Logging function
 */
function createAuthMiddleware(options = {}) {
    const { bot, logger = console } = options;

    /**
     * Authenticate JWT token for API requests
     * Checks cookies first, then Authorization header
     * Returns 401/403 JSON on failure
     */
    async function authenticateToken(req, res, next) {
        // Check for token in cookies first, then Authorization header
        let token = req.cookies?.dashboardToken;
        
        if (!token) {
            const authHeader = req.headers['authorization'];
            token = authHeader && authHeader.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ error: 'Access token required' });
        }

        try {
            if (!process.env.JWT_SECRET) {
                throw new Error('JWT_SECRET not configured');
            }
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            next();
        } catch (error) {
            logger.error?.('[Auth] Token verification failed:', error.message) || 
                console.error('[Auth] Token verification failed:', error.message);
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
    }

    /**
     * Authenticate token for HTML pages
     * Redirects to login on failure instead of returning JSON
     */
    async function authenticateTokenHTML(req, res, next) {
        let token = req.cookies?.dashboardToken;
        
        if (!token) {
            const authHeader = req.headers['authorization'];
            token = authHeader && authHeader.split(' ')[1];
        }

        if (!token) {
            return res.redirect('/login.html?error=auth_required');
        }

        try {
            if (!process.env.JWT_SECRET) {
                throw new Error('JWT_SECRET not configured');
            }
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            
            // Set anti-cache headers for authenticated pages
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
            
            next();
        } catch (error) {
            return res.redirect('/login.html?error=invalid_session');
        }
    }

    /**
     * CSRF validation for state-changing operations
     */
    function validateCSRF(req, res, next) {
        const token = req.headers['x-csrf-token'];
        const sessionToken = req.session?.csrfToken;
        
        if (!token || token !== sessionToken) {
            logger.warn?.(`[Security] CSRF token validation failed for ${req.ip}`) ||
                console.warn(`[Security] CSRF token validation failed for ${req.ip}`);
            return res.status(403).json({ error: 'Invalid CSRF token' });
        }
        
        next();
    }

    /**
     * Require Pro subscription middleware
     * Must be used AFTER authenticateToken
     */
    async function requirePro(req, res, next) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized - valid JWT required' });
            }
            
            const row = await bot.database.get(`SELECT is_pro FROM users WHERE id = ?`, [userId]);
            if (!row || !row.is_pro) {
                return res.status(403).json({ error: 'Pro subscription required' });
            }
            next();
        } catch (e) { 
            logger.error?.('[Security] Pro gating error:', e) ||
                console.error('[Security] Pro gating error:', e);
            return res.status(500).json({ error: 'Authentication error' }); 
        }
    }

    /**
     * Require Pro or active trial
     * Must be used AFTER authenticateToken
     */
    async function requireProOrTrial(req, res, next) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized - valid JWT required' });
            }
            
            const row = await bot.database.get(`SELECT is_pro, trial_expires FROM users WHERE id = ?`, [userId]);
            if (!row) {
                return res.status(403).json({ error: 'Pro subscription required' });
            }
            
            // Check if Pro or valid trial
            if (row.is_pro) {
                return next();
            }
            
            if (row.trial_expires && new Date(row.trial_expires) > new Date()) {
                req.user.isTrial = true;
                return next();
            }
            
            return res.status(403).json({ error: 'Pro subscription or active trial required' });
        } catch (e) { 
            logger.error?.('[Security] Pro/Trial gating error:', e) ||
                console.error('[Security] Pro/Trial gating error:', e);
            return res.status(500).json({ error: 'Authentication error' }); 
        }
    }

    /**
     * Check if user has admin access to a specific guild
     * Attaches guild info to req.guild if authorized
     */
    async function requireGuildAdmin(req, res, next) {
        try {
            const userId = req.user?.userId;
            const guildId = req.params.guildId || req.query.guildId || req.body?.guildId;
            
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            if (!guildId || !/^\d{17,19}$/.test(guildId)) {
                return res.status(400).json({ error: 'Invalid guild ID' });
            }
            
            // Check guild access via bot
            const guild = bot.client?.guilds?.cache?.get(guildId);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found or bot not in guild' });
            }
            
            // Check if user has admin permissions in guild
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                return res.status(403).json({ error: 'You are not a member of this guild' });
            }
            
            if (!member.permissions.has('Administrator') && !member.permissions.has('ManageGuild')) {
                return res.status(403).json({ error: 'You need Administrator or Manage Server permission' });
            }
            
            req.guild = guild;
            req.guildMember = member;
            next();
        } catch (e) {
            logger.error?.('[Security] Guild admin check error:', e) ||
                console.error('[Security] Guild admin check error:', e);
            return res.status(500).json({ error: 'Authorization check failed' });
        }
    }

    return {
        authenticateToken,
        authenticateTokenHTML,
        validateCSRF,
        requirePro,
        requireProOrTrial,
        requireGuildAdmin
    };
}

module.exports = { createAuthMiddleware };
