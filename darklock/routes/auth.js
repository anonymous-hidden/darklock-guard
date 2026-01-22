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
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const speakeasy = require('speakeasy');

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
        const secret = process.env.JWT_SECRET || 'darklock-secret-key-change-in-production';
        const decoded = await verifyToken(token, secret);
        if (decoded) {
            return res.redirect('/platform/dashboard');
        }
        res.clearCookie('darklock_token');
    }
    res.sendFile(path.join(__dirname, '../views/login.html'));
});

/**
 * GET /auth/signup - Serve signup page
 */
router.get('/signup', async (req, res) => {
    const token = req.cookies?.darklock_token;
    if (token) {
        const secret = process.env.JWT_SECRET || 'darklock-secret-key-change-in-production';
        const decoded = await verifyToken(token, secret);
        if (decoded) {
            return res.redirect('/platform/dashboard');
        }
        res.clearCookie('darklock_token');
    }
    res.sendFile(path.join(__dirname, '../views/signup.html'));
});

/**
 * POST /auth/signup - Handle user registration
 * Rate limited: 3 attempts per hour per IP
 */
router.post('/signup', rateLimitMiddleware('signup'), async (req, res) => {
    try {
        const { username, email, password, confirmPassword } = req.body;
        
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
        if (existingUsername) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Username is already taken'
            });
        }
        
        // Check for existing email (case-insensitive)
        const existingEmail = await db.getUserByEmail(email);
        if (existingEmail) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Email is already registered'
            });
        }
        
        // Hash password with bcrypt (cost factor 12)
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Check if this is the first user (make them admin)
        const allUsers = await db.getAllUsers();
        const isFirstUser = allUsers.length === 0;
        
        // Generate user ID
        const userId = crypto.randomBytes(16).toString('hex');
        
        // Create new user in database
        const newUser = await db.createUser({
            id: userId,
            username: username.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: isFirstUser ? 'admin' : 'user',
            lastLoginIp: getClientIP(req)
        });
        
        if (!newUser) {
            return res.status(500).json({
                success: false,
                error: 'Failed to create account. Please try again.'
            });
        }
        
        // Generate JWT with jti (new users have no 2FA, so twoFactorVerified = false)
        const secret = process.env.JWT_SECRET || 'darklock-secret-key-change-in-production';
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
        const secret = process.env.JWT_SECRET || 'darklock-secret-key-change-in-production';
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
        
        // Check if 2FA is enabled
        if (user.twoFactorEnabled) {
            return res.status(403).json({
                success: false,
                error: '2FA not supported in desktop app yet. Please disable 2FA on web first.'
            });
        }
        
        // Generate JWT with jti
        const secret = process.env.JWT_SECRET || 'darklock-secret-key-change-in-production';
        const jti = generateJti();
        const token = generateToken(user, secret, jti, true);
        
        // Create session record
        await createSessionRecord(user.id, jti, req);
        
        // Update last login
        await db.updateUserLastLogin(user.id, getClientIP(req));
        
        console.log(`[Darklock Auth] Desktop app login: ${user.username}`);
        
        // Return token in response
        res.json({
            success: true,
            token,
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
            const secret = process.env.JWT_SECRET || 'darklock-secret-key-change-in-production';
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
        
        const secret = process.env.JWT_SECRET || 'darklock-secret-key-change-in-production';
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
        
        const secret = process.env.JWT_SECRET || 'darklock-secret-key-change-in-production';
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
        
        const secret = process.env.JWT_SECRET || 'darklock-secret-key-change-in-production';
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
        
        const secret = process.env.JWT_SECRET || 'darklock-secret-key-change-in-production';
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

// Export helpers for other modules
module.exports = router;
module.exports.verifyToken = verifyToken;
module.exports.getClientIP = getClientIP;
