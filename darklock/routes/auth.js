/**
 * Darklock Platform - Authentication Routes
 * Handles user registration, login, logout, and session management
 * Uses bcrypt for password hashing and JWT for session tokens
 * 
 * UPDATED: Now uses SQLite database instead of JSON files for persistence
 * 
 * Security Features:
 * - JWT with jti (JWT ID) for session invalidation
 * - Persistent SQLite storage on /data volume
 * - Rate limiting on sensitive endpoints
 * - Session tracking with IP/device info
 * - All sessions invalidated on password change
 * - FAIL-FAST: App exits if JWT_SECRET is missing or weak
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const speakeasy = require('speakeasy');
const axios = require('axios');

// Fail-fast environment validation
const { getJwtSecret } = require('../utils/env-validator');

// Database (SQLite)
const db = require('../utils/database');

// Email service
const emailService = require('../utils/email');

// Security utilities
const {
    rateLimitMiddleware,
    generateJti
} = require('../utils/security');

/**
 * Generate a secure JWT token with jti for invalidation
 * @param {object} user - User object
 * @param {string} secret - JWT secret
 * @param {string} jti - JWT ID for session tracking
 * @param {boolean} twoFactorVerified - Whether 2FA was completed for this session
 * @param {string} expiresIn - Token expiration time
 */
function generateToken(user, secret, jti, twoFactorVerified = false, expiresIn = '7d') {
    return jwt.sign(
        {
            userId: user.id,
            username: user.username,
            email: user.email,
            role: user.role || 'user',
            twoFactorVerified, // CRITICAL: Track 2FA completion for device linking
            jti // JWT ID for session tracking/invalidation
        },
        secret,
        { expiresIn }
    );
}

/**
 * Create a new session record with jti
 */
async function createSessionRecord(userId, jti, req) {
    // Generate session ID
    const sessionId = crypto.randomBytes(16).toString('hex');
    
    // Database automatically cleans up expired sessions
    const session = await db.createSession({
        id: sessionId,
        jti,
        userId,
        ip: getClientIP(req),
        userAgent: req.headers['user-agent'] || 'unknown',
        device: parseUserAgent(req.headers['user-agent'])
    });
    return session;
}

/**
 * Get client IP address (handles proxies)
 */
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.ip ||
           req.connection?.remoteAddress ||
           'unknown';
}

/**
 * Parse user agent for device info
 */
function parseUserAgent(ua) {
    if (!ua) return 'Unknown Device';
    
    // Browser detection
    let browser = 'Unknown Browser';
    if (ua.includes('Firefox/')) browser = 'Firefox';
    else if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Chrome/')) browser = 'Chrome';
    else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';
    
    // OS detection
    if (ua.includes('Windows NT 10')) return `Windows • ${browser}`;
    if (ua.includes('Windows')) return `Windows • ${browser}`;
    if (ua.includes('Mac OS X')) return `macOS • ${browser}`;
    if (ua.includes('Linux')) return `Linux • ${browser}`;
    if (ua.includes('iPhone')) return 'iPhone • Safari';
    if (ua.includes('iPad')) return 'iPad • Safari';
    if (ua.includes('Android')) return `Android • ${browser}`;
    
    return `Unknown Device • ${browser}`;
}

/**
 * Validate password strength
 */
function validatePassword(password) {
    const errors = [];
    
    if (password.length < 8) {
        errors.push('Password must be at least 8 characters long');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }
    
    return errors;
}

/**
 * Validate email format
 */
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validate username
 */
function validateUsername(username) {
    const errors = [];
    
    if (username.length < 3) {
        errors.push('Username must be at least 3 characters long');
    }
    if (username.length > 20) {
        errors.push('Username must be 20 characters or less');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        errors.push('Username can only contain letters, numbers, underscores, and hyphens');
    }
    
    return errors;
}

/**
 * Verify JWT token silently (no cookie clearing) and check database session
 */
async function verifyTokenSilent(token, secret) {
    try {
        const decoded = jwt.verify(token, secret);
        
        // Check if session is still valid (not revoked) in database
        const session = await db.getSessionByJti(decoded.jti);
        if (!session || session.revokedAt) {
            return null; // Session was revoked
        }
        
        return decoded;
    } catch (err) {
        return null;
    }
}

/**
 * Verify JWT token (with cookie clearing on failure)
 * This is used by routes and exported for other modules
 */
async function verifyToken(token, secret) {
    return await verifyTokenSilent(token, secret);
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /auth/login - Serve login page
 */
router.get('/login', async (req, res) => {
    const token = req.cookies?.darklock_token;
    if (token) {
        const secret = getJwtSecret();
        const decoded = await verifyToken(token, secret);
        if (decoded) {
            return res.redirect('/platform/dashboard');
        }
        res.clearCookie('darklock_token');
    }
    const { resolveView } = require('../utils/theme-resolver');
    res.sendFile(resolveView('login.html'));
});

/**
 * GET /auth/signup - Serve signup page
 */
router.get('/signup', async (req, res) => {
    const token = req.cookies?.darklock_token;
    if (token) {
        const secret = getJwtSecret();
        const decoded = await verifyToken(token, secret);
        if (decoded) {
            return res.redirect('/platform/dashboard');
        }
        res.clearCookie('darklock_token');
    }
    const { resolveView } = require('../utils/theme-resolver');
    res.sendFile(resolveView('signup.html'));
});

/**
 * POST /auth/signup - Handle user registration
 * Rate limited: 3 attempts per hour per IP
 */
router.post('/signup', rateLimitMiddleware('signup'), async (req, res) => {
    try {
        const { username, email, password, confirmPassword, emailUpdatesOptIn } = req.body;
        
        // Validate all fields present
        if (!username || !email || !password || !confirmPassword) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'All fields are required'
            });
        }
        
        // Validate username
        const usernameErrors = validateUsername(username);
        if (usernameErrors.length > 0) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: usernameErrors[0]
            });
        }
        
        // Validate email
        if (!validateEmail(email)) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Please enter a valid email address'
            });
        }
        
        // Validate password
        const passwordErrors = validatePassword(password);
        if (passwordErrors.length > 0) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: passwordErrors[0]
            });
        }
        
        // Check password confirmation
        if (password !== confirmPassword) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Passwords do not match'
            });
        }
        
        // Check for existing username (case-insensitive)
        const existingUsername = await db.getUserByUsername(username);
        const existingEmail = await db.getUserByEmail(email);
        if (existingUsername || existingEmail) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Account creation failed. An account with this email or username may already exist.'
            });
        }
        
        // Hash password with bcrypt (cost factor 12)
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Generate user ID
        const userId = crypto.randomBytes(16).toString('hex');
        
        // Create new user in database
        const newUser = await db.createUser({
            id: userId,
            username: username.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: 'user',
            lastLoginIp: getClientIP(req),
            settings: {
                emailUpdatesOptIn: emailUpdatesOptIn === true || emailUpdatesOptIn === 'true'
            }
        });
        
        // Also update the email_updates_opt_in field directly
        if (emailUpdatesOptIn === true || emailUpdatesOptIn === 'true') {
            await db.run(`
                UPDATE users 
                SET email_updates_opt_in = 1 
                WHERE id = ?
            `, [userId]);
        }
        
        if (!newUser) {
            return res.status(500).json({
                success: false,
                error: 'Failed to create account. Please try again.'
            });
        }
        
        // Generate JWT with jti (new users have no 2FA, so twoFactorVerified = false)
        const secret = getJwtSecret();
        const jti = generateJti();
        const token = generateToken(newUser, secret, jti, false);
        
        // Create session record
        await createSessionRecord(newUser.id, jti, req);
        
        // Set secure cookie
        res.cookie('darklock_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        
        req.recordAttempt(true);
        console.log(`[Darklock Auth] New user registered: ${username}`);
        
        // Send welcome email (non-blocking)
        emailService.sendWelcomeEmail(newUser.email, newUser.username)
            .catch(err => console.error('[Email] Failed to send welcome email:', err));
        
        res.json({
            success: true,
            message: 'Account created successfully',
            redirect: '/platform/dashboard'
        });
        
    } catch (err) {
        console.error('[Darklock Auth] Signup error:', err);
        res.status(500).json({
            success: false,
            error: 'An unexpected error occurred. Please try again.'
        });
    }
});

/**
 * POST /auth/login - Handle user login
 * Rate limited: 5 attempts per 15 minutes per IP
 */
router.post('/login', rateLimitMiddleware('login'), async (req, res) => {
    try {
        const { username, password, totpCode } = req.body;
        
        // Validate required fields
        if (!username || !password) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }
        
        // Find user by username or email (case-insensitive)
        let user = await db.getUserByUsername(username);
        if (!user) {
            user = await db.getUserByEmail(username);
        }
        
        if (!user) {
            req.recordAttempt(false);
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }
        
        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            req.recordAttempt(false);
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }
        
        // Track 2FA verification status for this login session
        // CRITICAL: This determines if device linking is allowed
        let twoFactorVerified = false;
        
        // Check 2FA if enabled
        if (user.twoFactorEnabled) {
            if (!totpCode) {
                return res.status(200).json({
                    success: false,
                    requires2FA: true,
                    message: 'Two-factor authentication code required'
                });
            }
            
            // Verify TOTP code
            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: totpCode.toString().replace(/\s/g, ''),
                window: 1
            });
            
            if (!verified) {
                req.recordAttempt(false);
                return res.status(401).json({
                    success: false,
                    error: 'Invalid authentication code'
                });
            }
            
            // 2FA was successfully verified
            twoFactorVerified = true;
        } else {
            // User doesn't have 2FA enabled, so they're "verified" by default
            twoFactorVerified = true;
        }
        
        // Generate JWT with jti and 2FA verification status
        const secret = getJwtSecret();
        const jti = generateJti();
        const token = generateToken(user, secret, jti, twoFactorVerified);
        
        // Create session record
        await createSessionRecord(user.id, jti, req);
        
        // Update last login info in database
        await db.updateUserLastLogin(user.id, getClientIP(req));
        
        // Set secure cookie
        res.cookie('darklock_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        
        req.recordAttempt(true);
        console.log(`[Darklock Auth] User logged in: ${user.username}`);
        
        res.json({
            success: true,
            message: 'Login successful',
            redirect: '/platform/dashboard'
        });
        
    } catch (err) {
        console.error('[Darklock Auth] Login error:', err);
        res.status(500).json({
            success: false,
            error: 'An unexpected error occurred. Please try again.'
        });
    }
});

/**
 * POST /auth/api/login - API endpoint for programmatic login (desktop app)
 * Returns JWT token in response body instead of cookie
 */
router.post('/api/login', rateLimitMiddleware('login'), async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }
        
        // Find user by email
        const user = await db.getUserByEmail(email);
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        // Check if 2FA is enabled — require TOTP code for desktop app login
        if (user.twoFactorEnabled) {
            const { totpCode } = req.body;
            if (!totpCode) {
                return res.status(403).json({
                    success: false,
                    requires2FA: true,
                    error: '2FA verification required. Please provide your authenticator code.'
                });
            }
            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret || user.two_factor_secret,
                encoding: 'base32',
                token: totpCode.toString().replace(/\s/g, ''),
                window: 1
            });
            if (!verified) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid 2FA code'
                });
            }
        }
        
        // Generate JWT with jti
        const secret = getJwtSecret();
        const jti = generateJti();
        const token = generateToken(user, secret, jti, true);
        
        // Create session record
        await createSessionRecord(user.id, jti, req);
        
        // Update last login
        await db.updateUserLastLogin(user.id, getClientIP(req));
        
        console.log(`[Darklock Auth] Desktop app login: ${user.username}`);
        
        // Set token as httpOnly cookie instead of exposing in response body
        res.cookie('darklock_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({
            success: true,
            user: {
                username: user.username,
                email: user.email,
                role: user.role || 'user'
            }
        });
        
    } catch (err) {
        console.error('[Darklock Auth] API login error:', err);
        res.status(500).json({
            success: false,
            error: 'An unexpected error occurred. Please try again.'
        });
    }
});

/**
 * POST /auth/logout - Handle user logout
 * Properly invalidates the session (not just cookie)
 */
router.post('/logout', async (req, res) => {
    try {
        const token = req.cookies?.darklock_token;
        
        if (token) {
            const secret = getJwtSecret();
            try {
                const decoded = jwt.verify(token, secret);
                
                // Revoke the session by jti in database
                await db.revokeSession(decoded.jti);
            } catch (err) {
                // Token invalid, just clear cookie
            }
        }
        
        // Clear the cookie
        res.clearCookie('darklock_token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });
        
        res.json({
            success: true,
            message: 'Logged out successfully',
            redirect: '/platform'
        });
        
    } catch (err) {
        console.error('[Darklock Auth] Logout error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to logout'
        });
    }
});

/**
 * GET /auth/me - Get current user info
 * Validates session via jti
 */
router.get('/me', async (req, res) => {
    try {
        const token = req.cookies?.darklock_token;
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated'
            });
        }
        
        const secret = getJwtSecret();
        const decoded = await verifyToken(token, secret);
        
        if (!decoded) {
            res.clearCookie('darklock_token');
            return res.status(401).json({
                success: false,
                error: 'Session expired or invalid'
            });
        }
        
        // Get full user data
        const user = await db.getUserById(decoded.userId);
        
        if (!user) {
            res.clearCookie('darklock_token');
            return res.status(401).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Update session last active in database
        await db.updateSessionActivity(decoded.jti);
        
        // Return user data without sensitive fields
        // FIXED: Include all fields needed by profile/settings pages
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                avatar: user.avatar,
                banner: user.banner || null,
                displayName: user.displayName || null,
                timezone: user.timezone || 'UTC',
                language: user.language || 'en',
                createdAt: user.createdAt,
                lastLogin: user.lastLogin,
                lastLoginIp: user.lastLoginIp,
                twoFactorEnabled: user.twoFactorEnabled,
                preferences: user.preferences || {},
                notifications: user.notifications || {},
                settings: user.settings || {}
            }
        });
        
    } catch (err) {
        console.error('[Darklock Auth] Get user error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get user info'
        });
    }
});

/**
 * GET /auth/sessions - Get user's active sessions
 */
router.get('/sessions', async (req, res) => {
    try {
        const token = req.cookies?.darklock_token;
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated'
            });
        }
        
        const secret = getJwtSecret();
        const decoded = await verifyToken(token, secret);
        
        if (!decoded) {
            res.clearCookie('darklock_token');
            return res.status(401).json({
                success: false,
                error: 'Session expired'
            });
        }
        
        // Get user's active sessions from database
        const userSessions = await db.getUserSessions(decoded.userId);
        
        // Format sessions for response
        const formattedSessions = userSessions.map(s => ({
            id: s.id,
            device: s.device,
            ip: s.ip,
            lastActive: s.lastActive,
            createdAt: s.createdAt,
            current: s.jti === decoded.jti
        })).sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
        
        res.json({
            success: true,
            sessions: userSessions
        });
        
    } catch (err) {
        console.error('[Darklock Auth] Get sessions error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get sessions'
        });
    }
});

/**
 * DELETE /auth/sessions/:sessionId - Revoke a specific session
 */
router.delete('/sessions/:sessionId', async (req, res) => {
    try {
        const token = req.cookies?.darklock_token;
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated'
            });
        }
        
        const secret = getJwtSecret();
        const decoded = await verifyToken(token, secret);
        
        if (!decoded) {
            return res.status(401).json({
                success: false,
                error: 'Session expired'
            });
        }
        
        const { sessionId } = req.params;
        
        // Get the session from database (only if it belongs to the user)
        const session = await db.getSessionById(sessionId);
        
        if (!session || session.userId !== decoded.userId || session.revokedAt) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
        
        // Revoke the session in database
        await db.revokeSessionById(sessionId);
        
        res.json({
            success: true,
            message: 'Session revoked successfully'
        });
        
    } catch (err) {
        console.error('[Darklock Auth] Revoke session error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to revoke session'
        });
    }
});

/**
 * POST /auth/sessions/revoke-all - Revoke all other sessions
 */
router.post('/sessions/revoke-all', async (req, res) => {
    try {
        const token = req.cookies?.darklock_token;
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated'
            });
        }
        
        const secret = getJwtSecret();
        const decoded = await verifyToken(token, secret);
        
        if (!decoded) {
            return res.status(401).json({
                success: false,
                error: 'Session expired'
            });
        }
        
        // Revoke all sessions except current in database
        await db.revokeUserSessionsExcept(decoded.userId, decoded.jti);
        
        res.json({
            success: true,
            message: 'All other sessions revoked'
        });
        
    } catch (err) {
        console.error('[Darklock Auth] Revoke all sessions error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to revoke sessions'
        });
    }
});

// ============================================================================
// DISCORD OAUTH
// ============================================================================

const PLATFORM_DISCORD_REDIRECT_URI = process.env.PLATFORM_DISCORD_REDIRECT_URI ||
    'https://darklock.net/platform/auth/discord/callback';

/**
 * GET /auth/discord - Begin Discord OAuth flow
 */
router.get('/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) {
        return res.redirect('/platform/auth/login?error=' + encodeURIComponent('Discord login is not configured'));
    }

    // Generate and sign a state token to prevent CSRF
    const statePayload = crypto.randomBytes(32).toString('hex');
    const stateToken = jwt.sign(
        { state: statePayload, iat: Math.floor(Date.now() / 1000) },
        process.env.OAUTH_STATE_SECRET || getJwtSecret(),
        { expiresIn: '10m' }
    );

    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('platform_oauth_state', stateToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
        ...(isProd ? { domain: '.darklock.net' } : {})
    });

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: PLATFORM_DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify email',
        state: statePayload
    });

    res.redirect('https://discord.com/oauth2/authorize?' + params.toString());
});

/**
 * GET /auth/discord/callback - Handle Discord OAuth callback
 */
router.get('/discord/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;

        if (error) {
            return res.redirect('/platform/auth/login?error=' + encodeURIComponent('Discord login was cancelled'));
        }

        // Verify state
        const stateCookie = req.cookies?.platform_oauth_state;
        if (!stateCookie || !state) {
            return res.redirect('/platform/auth/login?error=' + encodeURIComponent('Invalid OAuth state'));
        }
        try {
            const decoded = jwt.verify(stateCookie, process.env.OAUTH_STATE_SECRET || getJwtSecret());
            if (decoded.state !== state) throw new Error('State mismatch');
        } catch {
            return res.redirect('/platform/auth/login?error=' + encodeURIComponent('OAuth session expired, please try again'));
        }
        res.clearCookie('platform_oauth_state', process.env.NODE_ENV === 'production' ? { domain: '.darklock.net' } : {});

        // Exchange code for token
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: PLATFORM_DISCORD_REDIRECT_URI
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const accessToken = tokenRes.data.access_token;

        // Fetch Discord user info
        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const dUser = userRes.data;

        const oauthProvider = 'discord';
        const oauthId = String(dUser.id);

        // Find or create platform user
        let user = await db.getUserByOAuth(oauthProvider, oauthId);

        if (!user) {
            // Try to link by email if account already exists
            const email = dUser.email || null;
            if (email) {
                const existing = await db.getUserByEmail(email);
                if (existing) {
                    // Link OAuth to existing account
                    await db.updateUser(existing.id, {
                        oauth_provider: oauthProvider,
                        oauth_id: oauthId
                    });
                    user = await db.getUserById(existing.id);
                }
            }

            if (!user) {
                // Create new user for this Discord account
                const baseUsername = (dUser.username || `discord_${oauthId}`)
                    .replace(/[^a-zA-Z0-9_-]/g, '_')
                    .slice(0, 18);
                let username = baseUsername;
                let suffix = 0;
                while (await db.getUserByUsername(username)) {
                    suffix++;
                    username = `${baseUsername}_${suffix}`;
                }
                const avatar = dUser.avatar
                    ? `https://cdn.discordapp.com/avatars/${dUser.id}/${dUser.avatar}.png?size=128`
                    : null;
                user = await db.createUser({
                    id: crypto.randomUUID(),
                    username,
                    email: email || `discord_${oauthId}@oauth.darklock.net`,
                    password: `OAUTH:discord:${oauthId}`,
                    displayName: dUser.global_name || dUser.username,
                    role: 'user'
                });
                // Set oauth fields and avatar
                await db.updateUser(user.id, {
                    oauth_provider: oauthProvider,
                    oauth_id: oauthId,
                    avatar
                });
                user = await db.getUserById(user.id);
            }
        }

        // Issue JWT + session (same as password login)
        const secret = getJwtSecret();
        const jti = generateJti();
        const token = generateToken(user, secret, jti, true);
        await createSessionRecord(user.id, jti, req);
        await db.updateUserLastLogin(user.id, getClientIP(req));

        res.cookie('darklock_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        console.log(`[Darklock Auth] Discord OAuth login: ${user.username}`);
        res.redirect('/platform/dashboard');

    } catch (err) {
        console.error('[Darklock Auth] Discord OAuth error:', err.response?.data || err.message);
        res.redirect('/platform/auth/login?error=' + encodeURIComponent('Discord login failed, please try again'));
    }
});

// ============================================================================
// GOOGLE OAUTH
// ============================================================================

const PLATFORM_GOOGLE_REDIRECT_URI = process.env.PLATFORM_GOOGLE_REDIRECT_URI ||
    'https://darklock.net/platform/auth/google/callback';

/**
 * GET /auth/google - Begin Google OAuth flow
 */
router.get('/google', (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return res.redirect('/platform/auth/login?error=' + encodeURIComponent('Google login is not configured'));
    }

    const statePayload = crypto.randomBytes(32).toString('hex');
    const stateToken = jwt.sign(
        { state: statePayload, iat: Math.floor(Date.now() / 1000) },
        process.env.OAUTH_STATE_SECRET || getJwtSecret(),
        { expiresIn: '10m' }
    );

    const isProdGoogle = process.env.NODE_ENV === 'production';
    res.cookie('platform_oauth_state', stateToken, {
        httpOnly: true,
        secure: isProdGoogle,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
        ...(isProdGoogle ? { domain: '.darklock.net' } : {})
    });

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: PLATFORM_GOOGLE_REDIRECT_URI,
        response_type: 'code',
        scope: 'openid email profile',
        state: statePayload,
        access_type: 'online',
        prompt: 'select_account'
    });

    res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

/**
 * GET /auth/google/callback - Handle Google OAuth callback
 */
router.get('/google/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;

        if (error) {
            return res.redirect('/platform/auth/login?error=' + encodeURIComponent('Google login was cancelled'));
        }

        // Verify state
        const stateCookie = req.cookies?.platform_oauth_state;
        if (!stateCookie || !state) {
            return res.redirect('/platform/auth/login?error=' + encodeURIComponent('Invalid OAuth state'));
        }
        try {
            const decoded = jwt.verify(stateCookie, process.env.OAUTH_STATE_SECRET || getJwtSecret());
            if (decoded.state !== state) throw new Error('State mismatch');
        } catch {
            return res.redirect('/platform/auth/login?error=' + encodeURIComponent('OAuth session expired, please try again'));
        }
        res.clearCookie('platform_oauth_state', process.env.NODE_ENV === 'production' ? { domain: '.darklock.net' } : {});

        // Exchange code for token
        const tokenRes = await axios.post('https://oauth2.googleapis.com/token',
            new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: PLATFORM_GOOGLE_REDIRECT_URI
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const accessToken = tokenRes.data.access_token;

        // Fetch Google user info
        const userRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const gUser = userRes.data;

        if (!gUser.email_verified) {
            return res.redirect('/platform/auth/login?error=' + encodeURIComponent('Google account email is not verified'));
        }

        const oauthProvider = 'google';
        const oauthId = String(gUser.sub);

        // Find or create platform user
        let user = await db.getUserByOAuth(oauthProvider, oauthId);

        if (!user) {
            // Try to link by email if account already exists
            const existing = await db.getUserByEmail(gUser.email);
            if (existing) {
                await db.updateUser(existing.id, {
                    oauth_provider: oauthProvider,
                    oauth_id: oauthId
                });
                user = await db.getUserById(existing.id);
            }

            if (!user) {
                const baseName = (gUser.name || gUser.email.split('@')[0])
                    .replace(/[^a-zA-Z0-9_-]/g, '_')
                    .slice(0, 18);
                let username = baseName;
                let suffix = 0;
                while (await db.getUserByUsername(username)) {
                    suffix++;
                    username = `${baseName}_${suffix}`;
                }
                user = await db.createUser({
                    id: crypto.randomUUID(),
                    username,
                    email: gUser.email,
                    password: `OAUTH:google:${oauthId}`,
                    displayName: gUser.name || username,
                    role: 'user'
                });
                await db.updateUser(user.id, {
                    oauth_provider: oauthProvider,
                    oauth_id: oauthId,
                    avatar: gUser.picture || null
                });
                user = await db.getUserById(user.id);
            }
        }

        // Issue JWT + session
        const secret = getJwtSecret();
        const jti = generateJti();
        const token = generateToken(user, secret, jti, true);
        await createSessionRecord(user.id, jti, req);
        await db.updateUserLastLogin(user.id, getClientIP(req));

        res.cookie('darklock_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        console.log(`[Darklock Auth] Google OAuth login: ${user.username}`);
        res.redirect('/platform/dashboard');

    } catch (err) {
        console.error('[Darklock Auth] Google OAuth error:', err.response?.data || err.message);
        res.redirect('/platform/auth/login?error=' + encodeURIComponent('Google login failed, please try again'));
    }
});

// Export helpers for other modules
module.exports = router;
module.exports.verifyToken = verifyToken;
module.exports.getClientIP = getClientIP;
