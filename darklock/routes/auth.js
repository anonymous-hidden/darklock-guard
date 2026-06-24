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
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} = require('@simplewebauthn/server');

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
// PASSKEY / WEBAUTHN HELPERS
// ============================================================================

const PASSKEY_CEREMONY_TTL_MS = 5 * 60 * 1000;
const passkeyCeremonies = new Map();

function toBase64Url(value) {
    return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value) {
    return Buffer.from(value, 'base64url');
}

function getPasskeyEncryptionKey() {
    // Keep passkey credential material encrypted at rest even if no dedicated key is set.
    const source = process.env.PASSKEY_ENCRYPTION_KEY || getJwtSecret();
    return crypto.createHash('sha256').update(String(source)).digest();
}

function encryptPasskeyField(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getPasskeyEncryptionKey(), iv);

    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ]);

    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decryptPasskeyField(payload) {
    if (!payload || typeof payload !== 'string') {
        return null;
    }

    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') {
        throw new Error('Invalid encrypted passkey payload format');
    }

    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');

    const decipher = crypto.createDecipheriv('aes-256-gcm', getPasskeyEncryptionKey(), iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
    ]);

    return plaintext.toString('utf8');
}

function parseJson(value, fallback = null) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function hashCredentialId(credentialId) {
    return crypto.createHash('sha256').update(String(credentialId)).digest('hex');
}

function getForwardedValue(headerValue) {
    if (!headerValue || typeof headerValue !== 'string') {
        return '';
    }
    return headerValue.split(',')[0].trim();
}

function getRequestHost(req) {
    return getForwardedValue(req.headers['x-forwarded-host']) || req.get('host') || '';
}

function getRequestProtocol(req) {
    return getForwardedValue(req.headers['x-forwarded-proto']) || req.protocol || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
}

function isTrustedAuthHost(hostname) {
    if (!hostname) {
        return false;
    }

    return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === 'darklock.net'
        || hostname.endsWith('.darklock.net');
}

function getAuthCookieDomain(req) {
    if (process.env.NODE_ENV !== 'production') {
        return undefined;
    }

    const hostHeader = getRequestHost(req);
    const hostname = hostHeader.split(':')[0].trim().toLowerCase();

    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
        return undefined;
    }

    if (hostname === 'darklock.net' || hostname.endsWith('.darklock.net')) {
        return '.darklock.net';
    }

    return undefined;
}

function buildAuthCookieOptions(req, overrides = {}) {
    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        ...overrides
    };

    const domain = getAuthCookieDomain(req);
    if (domain) {
        options.domain = domain;
    }

    return options;
}

function setAuthCookie(res, req, token, overrides = {}) {
    res.cookie('darklock_token', token, buildAuthCookieOptions(req, overrides));
}

function clearAuthCookie(res, req) {
    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    };

    const domain = getAuthCookieDomain(req);
    if (domain) {
        options.domain = domain;
    }

    res.clearCookie('darklock_token', options);
}

const POST_AUTH_NEXT_COOKIE = 'platform_auth_next';
const POST_AUTH_NEXT_MAX_AGE_MS = 15 * 60 * 1000;
const DEFAULT_POST_AUTH_REDIRECT = '/platform/dashboard';

function sanitizeRelativeRedirectPath(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith('/')) {
        return null;
    }

    if (trimmed.startsWith('//') || trimmed.includes('\n') || trimmed.includes('\r')) {
        return null;
    }

    return trimmed;
}

function setPostAuthNextCookie(res, req, nextPath) {
    const safeNext = sanitizeRelativeRedirectPath(nextPath);
    if (!safeNext) {
        return null;
    }

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: POST_AUTH_NEXT_MAX_AGE_MS
    };

    const domain = getAuthCookieDomain(req);
    if (domain) {
        options.domain = domain;
    }

    res.cookie(POST_AUTH_NEXT_COOKIE, safeNext, options);
    return safeNext;
}

function clearPostAuthNextCookie(res, req) {
    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
    };

    const domain = getAuthCookieDomain(req);
    if (domain) {
        options.domain = domain;
    }

    res.clearCookie(POST_AUTH_NEXT_COOKIE, options);
}

function getRequestedPostAuthRedirect(req) {
    const bodyNext = sanitizeRelativeRedirectPath(req.body?.next);
    if (bodyNext) {
        return bodyNext;
    }

    const queryNext = sanitizeRelativeRedirectPath(req.query?.next);
    if (queryNext) {
        return queryNext;
    }

    return sanitizeRelativeRedirectPath(req.cookies?.[POST_AUTH_NEXT_COOKIE]);
}

function consumePostAuthRedirect(req, res, fallback = DEFAULT_POST_AUTH_REDIRECT) {
    const requested = getRequestedPostAuthRedirect(req);
    clearPostAuthNextCookie(res, req);
    return requested || fallback;
}

function getProviderRedirectUri(req, provider, configuredValue) {
    const configured = (configuredValue || '').trim();
    if (configured) {
        return configured;
    }

    const hostHeader = getRequestHost(req);
    const hostname = hostHeader.split(':')[0].trim().toLowerCase();
    const protocol = getRequestProtocol(req);

    if (isTrustedAuthHost(hostname) && hostHeader) {
        return `${protocol}://${hostHeader}/platform/auth/${provider}/callback`;
    }

    return `https://platform.darklock.net/platform/auth/${provider}/callback`;
}

function getDiscordRedirectUri(req) {
    return getProviderRedirectUri(req, 'discord', process.env.PLATFORM_DISCORD_REDIRECT_URI);
}

function getGoogleRedirectUri(req) {
    return getProviderRedirectUri(req, 'google', process.env.PLATFORM_GOOGLE_REDIRECT_URI);
}

function getPasskeyHost(req) {
    return getRequestHost(req);
}

function getPasskeyRpId(req) {
    const configured = (process.env.PASSKEY_RP_ID || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);

    if (configured.length > 0) {
        return configured[0];
    }

    const host = getPasskeyHost(req).toLowerCase();
    return host.includes(':') ? host.split(':')[0] : host;
}

function getPasskeyExpectedOrigin(req) {
    const configuredOrigins = (process.env.PASSKEY_ORIGIN || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);

    if (configuredOrigins.length === 1) {
        return configuredOrigins[0];
    }
    if (configuredOrigins.length > 1) {
        return configuredOrigins;
    }

    const proto = getForwardedValue(req.headers['x-forwarded-proto']) || req.protocol || 'https';
    const host = getPasskeyHost(req);
    return `${proto}://${host}`;
}

function createPasskeyCeremony(payload) {
    const now = Date.now();

    // Opportunistic cleanup to avoid unbounded ceremony growth.
    for (const [id, ceremony] of passkeyCeremonies.entries()) {
        if (!ceremony || ceremony.expiresAt <= now) {
            passkeyCeremonies.delete(id);
        }
    }

    const ceremonyId = crypto.randomUUID();
    passkeyCeremonies.set(ceremonyId, {
        ...payload,
        createdAt: now,
        expiresAt: now + PASSKEY_CEREMONY_TTL_MS
    });

    return ceremonyId;
}

function consumePasskeyCeremony(ceremonyId, expectedType) {
    const ceremony = passkeyCeremonies.get(ceremonyId);
    passkeyCeremonies.delete(ceremonyId);

    if (!ceremony) {
        return null;
    }

    if (ceremony.expiresAt <= Date.now()) {
        return null;
    }

    if (expectedType && ceremony.type !== expectedType) {
        return null;
    }

    return ceremony;
}

async function getAuthenticatedUser(req, res) {
    const token = req.cookies?.darklock_token;
    if (!token) {
        return null;
    }

    const secret = getJwtSecret();
    const decoded = await verifyToken(token, secret);
    if (!decoded) {
        clearAuthCookie(res, req);
        return null;
    }

    const user = await db.getUserById(decoded.userId);
    if (!user) {
        clearAuthCookie(res, req);
        return null;
    }

    return { decoded, user };
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /auth/login - Serve login page
 */
router.get('/login', async (req, res) => {
    const requestedNext = sanitizeRelativeRedirectPath(req.query?.next);
    if (requestedNext) {
        setPostAuthNextCookie(res, req, requestedNext);
    } else {
        clearPostAuthNextCookie(res, req);
    }

    const token = req.cookies?.darklock_token;
    if (token) {
        const secret = getJwtSecret();
        const decoded = await verifyToken(token, secret);
        if (decoded) {
            clearPostAuthNextCookie(res, req);
            return res.redirect(requestedNext || DEFAULT_POST_AUTH_REDIRECT);
        }
        clearAuthCookie(res, req);
    }
    const { resolveView } = require('../utils/theme-resolver');
    res.sendFile(resolveView('login.html'));
});

/**
 * GET /auth/signup - Serve signup page
 */
router.get('/signup', async (req, res) => {
    const requestedNext = sanitizeRelativeRedirectPath(req.query?.next);
    if (requestedNext) {
        setPostAuthNextCookie(res, req, requestedNext);
    } else {
        clearPostAuthNextCookie(res, req);
    }

    const token = req.cookies?.darklock_token;
    if (token) {
        const secret = getJwtSecret();
        const decoded = await verifyToken(token, secret);
        if (decoded) {
            clearPostAuthNextCookie(res, req);
            return res.redirect(requestedNext || DEFAULT_POST_AUTH_REDIRECT);
        }
        clearAuthCookie(res, req);
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
        setAuthCookie(res, req, token);
        
        req.recordAttempt(true);
        console.log(`[Darklock Auth] New user registered: ${username}`);
        
        // Send welcome email (non-blocking)
        emailService.sendWelcomeEmail(newUser.email, newUser.username)
            .catch(err => console.error('[Email] Failed to send welcome email:', err));
        
        res.json({
            success: true,
            message: 'Account created successfully',
            redirect: consumePostAuthRedirect(req, res)
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
        const { username, email, identifier, password, totpCode } = req.body || {};
        const loginIdentifier = String(identifier || username || email || '').trim();
        
        // Validate required fields
        if (!loginIdentifier || !password) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Username/email and password are required'
            });
        }
        
        // Find user by username or email (case-insensitive)
        let user = await db.getUserByUsername(loginIdentifier);
        if (!user) {
            user = await db.getUserByEmail(loginIdentifier.toLowerCase());
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
        setAuthCookie(res, req, token);
        
        req.recordAttempt(true);
        console.log(`[Darklock Auth] User logged in: ${user.username}`);
        
        res.json({
            success: true,
            message: 'Login successful',
            redirect: consumePostAuthRedirect(req, res)
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
        setAuthCookie(res, req, token, { sameSite: 'strict' });

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
        clearAuthCookie(res, req);
        
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
            clearAuthCookie(res, req);
            return res.status(401).json({
                success: false,
                error: 'Session expired or invalid'
            });
        }
        
        // Get full user data
        const user = await db.getUserById(decoded.userId);
        
        if (!user) {
            clearAuthCookie(res, req);
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
            clearAuthCookie(res, req);
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
            lastActive: s.lastActive || s.last_active,
            createdAt: s.createdAt || s.created_at,
            current: s.jti === decoded.jti
        })).sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
        
        res.json({
            success: true,
            sessions: formattedSessions
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
        const sessionUserId = session?.userId || session?.user_id;
        const sessionRevokedAt = session?.revokedAt || session?.revoked_at;
        
        if (!session || sessionUserId !== decoded.userId || sessionRevokedAt) {
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
// PASSKEY / WEBAUTHN ROUTES
// ============================================================================

router.post('/passkeys/register/options', async (req, res) => {
    try {
        const auth = await getAuthenticatedUser(req, res);
        if (!auth) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated'
            });
        }

        const rpID = getPasskeyRpId(req);
        const expectedOrigin = getPasskeyExpectedOrigin(req);

        const existingCredentials = await db.getPasskeyCredentialsByUser(auth.user.id);
        const excludeCredentials = [];

        for (const stored of existingCredentials) {
            try {
                const credentialId = decryptPasskeyField(stored.credentialIdEnc);
                const transports = parseJson(decryptPasskeyField(stored.transportsEnc), []);

                if (credentialId) {
                    excludeCredentials.push({
                        id: credentialId,
                        transports: Array.isArray(transports) ? transports : undefined
                    });
                }
            } catch (decryptErr) {
                console.warn('[Darklock Auth] Skipping malformed stored passkey credential:', decryptErr.message);
            }
        }

        const options = await generateRegistrationOptions({
            rpName: process.env.PASSKEY_RP_NAME || 'Darklock',
            rpID,
            userName: auth.user.email || auth.user.username,
            userDisplayName: auth.user.display_name || auth.user.displayName || auth.user.username,
            userID: Buffer.from(String(auth.user.id), 'utf8'),
            attestationType: 'none',
            timeout: 60000,
            excludeCredentials,
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred'
            },
            supportedAlgorithmIDs: [-7, -257]
        });

        const ceremonyId = createPasskeyCeremony({
            type: 'registration',
            userId: auth.user.id,
            challenge: options.challenge,
            rpID,
            expectedOrigin
        });

        res.json({
            success: true,
            ceremonyId,
            options
        });
    } catch (err) {
        console.error('[Darklock Auth] Passkey registration options error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to prepare passkey registration'
        });
    }
});

router.post('/passkeys/register/verify', async (req, res) => {
    try {
        const { ceremonyId, response, deviceLabel } = req.body || {};

        if (!ceremonyId || !response) {
            return res.status(400).json({
                success: false,
                error: 'Missing passkey registration payload'
            });
        }

        const auth = await getAuthenticatedUser(req, res);
        if (!auth) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated'
            });
        }

        const ceremony = consumePasskeyCeremony(ceremonyId, 'registration');
        if (!ceremony || ceremony.userId !== auth.user.id) {
            return res.status(400).json({
                success: false,
                error: 'Passkey registration session expired. Please try again.'
            });
        }

        const verification = await verifyRegistrationResponse({
            response,
            expectedChallenge: ceremony.challenge,
            expectedOrigin: ceremony.expectedOrigin,
            expectedRPID: ceremony.rpID,
            requireUserVerification: true
        });

        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({
                success: false,
                error: 'Passkey registration could not be verified'
            });
        }

        const credential = verification.registrationInfo.credential;
        const credentialId = credential.id;
        const credentialIdHash = hashCredentialId(credentialId);
        const publicKeyB64Url = toBase64Url(credential.publicKey);
        const counter = Number(credential.counter || 0);
        const transports = Array.isArray(response?.response?.transports)
            ? response.response.transports
            : (Array.isArray(credential.transports) ? credential.transports : []);

        await db.createPasskeyCredential({
            userId: auth.user.id,
            credentialIdHash,
            credentialIdEnc: encryptPasskeyField(credentialId),
            publicKeyEnc: encryptPasskeyField(publicKeyB64Url),
            counterEnc: encryptPasskeyField(String(counter)),
            transportsEnc: encryptPasskeyField(JSON.stringify(transports)),
            deviceTypeEnc: encryptPasskeyField(verification.registrationInfo.credentialDeviceType || ''),
            backedUpEnc: encryptPasskeyField(verification.registrationInfo.credentialBackedUp ? '1' : '0'),
            aaguidEnc: encryptPasskeyField(verification.registrationInfo.aaguid || ''),
            metadataEnc: encryptPasskeyField(JSON.stringify({
                deviceLabel: deviceLabel || null,
                createdVia: 'web'
            }))
        });

        res.json({
            success: true,
            message: 'Passkey registered successfully'
        });
    } catch (err) {
        console.error('[Darklock Auth] Passkey registration verification error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to verify passkey registration'
        });
    }
});

router.post('/passkeys/login/options', rateLimitMiddleware('login'), async (req, res) => {
    try {
        const identifier = String(
            req.body?.identifier || req.body?.username || req.body?.email || ''
        ).trim();

        const rpID = getPasskeyRpId(req);
        const expectedOrigin = getPasskeyExpectedOrigin(req);

        let targetUser = null;
        let allowCredentials;

        if (identifier) {
            targetUser = await db.getUserByUsername(identifier);
            if (!targetUser) {
                targetUser = await db.getUserByEmail(identifier);
            }

            if (!targetUser) {
                req.recordAttempt(false);
                return res.status(404).json({
                    success: false,
                    error: 'No account found for that identifier'
                });
            }

            const storedCredentials = await db.getPasskeyCredentialsByUser(targetUser.id);
            if (!storedCredentials || storedCredentials.length === 0) {
                req.recordAttempt(false);
                return res.status(404).json({
                    success: false,
                    error: 'No passkeys are registered for this account'
                });
            }

            allowCredentials = storedCredentials
                .map(stored => {
                    try {
                        const credentialId = decryptPasskeyField(stored.credentialIdEnc);
                        const transports = parseJson(decryptPasskeyField(stored.transportsEnc), []);

                        if (!credentialId) {
                            return null;
                        }

                        return {
                            id: credentialId,
                            transports: Array.isArray(transports) ? transports : undefined
                        };
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean);

            if (allowCredentials.length === 0) {
                req.recordAttempt(false);
                return res.status(404).json({
                    success: false,
                    error: 'No valid passkeys are available for this account'
                });
            }
        }

        const options = await generateAuthenticationOptions({
            rpID,
            allowCredentials,
            userVerification: 'preferred',
            timeout: 60000
        });

        const ceremonyId = createPasskeyCeremony({
            type: 'authentication',
            userId: targetUser?.id || null,
            challenge: options.challenge,
            rpID,
            expectedOrigin
        });

        res.json({
            success: true,
            ceremonyId,
            options
        });
    } catch (err) {
        console.error('[Darklock Auth] Passkey authentication options error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to prepare passkey authentication'
        });
    }
});

router.post('/passkeys/login/verify', rateLimitMiddleware('login'), async (req, res) => {
    try {
        const { ceremonyId, response } = req.body || {};

        if (!ceremonyId || !response) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Missing passkey authentication payload'
            });
        }

        const ceremony = consumePasskeyCeremony(ceremonyId, 'authentication');
        if (!ceremony) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Passkey authentication session expired. Please try again.'
            });
        }

        const credentialId = String(response.id || response.rawId || '');
        if (!credentialId) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Missing credential identifier'
            });
        }

        const credentialIdHash = hashCredentialId(credentialId);
        const storedCredential = await db.getPasskeyCredentialByHash(credentialIdHash);
        if (!storedCredential || storedCredential.revokedAt) {
            req.recordAttempt(false);
            return res.status(401).json({
                success: false,
                error: 'Passkey not recognized'
            });
        }

        if (ceremony.userId && ceremony.userId !== storedCredential.userId) {
            req.recordAttempt(false);
            return res.status(401).json({
                success: false,
                error: 'Passkey does not match the selected account'
            });
        }

        const storedCredentialId = decryptPasskeyField(storedCredential.credentialIdEnc);
        const storedPublicKey = decryptPasskeyField(storedCredential.publicKeyEnc);
        const storedCounterRaw = decryptPasskeyField(storedCredential.counterEnc);
        const storedTransports = parseJson(decryptPasskeyField(storedCredential.transportsEnc), undefined);

        if (!storedCredentialId || !storedPublicKey) {
            req.recordAttempt(false);
            return res.status(401).json({
                success: false,
                error: 'Stored passkey material is invalid'
            });
        }

        const authenticator = {
            id: storedCredentialId,
            publicKey: fromBase64Url(storedPublicKey),
            counter: Number(storedCounterRaw || 0),
            transports: Array.isArray(storedTransports) ? storedTransports : undefined
        };

        const verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: ceremony.challenge,
            expectedOrigin: ceremony.expectedOrigin,
            expectedRPID: ceremony.rpID,
            credential: authenticator,
            requireUserVerification: true
        });

        if (!verification.verified) {
            req.recordAttempt(false);
            return res.status(401).json({
                success: false,
                error: 'Passkey authentication failed'
            });
        }

        const user = await db.getUserById(storedCredential.userId);
        if (!user) {
            req.recordAttempt(false);
            return res.status(401).json({
                success: false,
                error: 'Account no longer exists'
            });
        }

        await db.updatePasskeyCredentialUsage(
            credentialIdHash,
            encryptPasskeyField(String(verification.authenticationInfo.newCounter)),
            encryptPasskeyField(verification.authenticationInfo.credentialBackedUp ? '1' : '0')
        );

        const secret = getJwtSecret();
        const jti = generateJti();
        const token = generateToken(user, secret, jti, true);

        await createSessionRecord(user.id, jti, req);
        await db.updateUserLastLogin(user.id, getClientIP(req));

        setAuthCookie(res, req, token);

        req.recordAttempt(true);
        console.log(`[Darklock Auth] Passkey login: ${user.username}`);

        res.json({
            success: true,
            message: 'Login successful',
            redirect: consumePostAuthRedirect(req, res)
        });
    } catch (err) {
        console.error('[Darklock Auth] Passkey authentication verification error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to verify passkey authentication'
        });
    }
});

// ============================================================================
// DISCORD OAUTH
// ============================================================================

/**
 * GET /auth/discord - Begin Discord OAuth flow
 */
router.get('/discord', (req, res) => {
    const requestedNext = sanitizeRelativeRedirectPath(req.query?.next);
    if (requestedNext) {
        setPostAuthNextCookie(res, req, requestedNext);
    }

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
    const redirectUri = getDiscordRedirectUri(req);
    res.cookie('platform_oauth_state', stateToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
        ...(isProd ? { domain: '.darklock.net' } : {})
    });

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify email guilds',
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
        const redirectUri = getDiscordRedirectUri(req);

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
                redirect_uri: redirectUri
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

        // Cache the user's Discord guild list so /api/servers/list can return it
        try {
            const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const discordGuilds = guildsRes.data.map(g => ({
                id: g.id,
                name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
                isOwner: g.owner === true,
                permissions: g.permissions || '0', // bitmask string from Discord API
            }));
            // getUserById pre-parses settings to an object — use it directly
            const existingSettings = (typeof user.settings === 'object' && user.settings) ? user.settings : {};
            await db.updateUser(user.id, {
                settings: JSON.stringify({ ...existingSettings, discord_guilds: discordGuilds, discord_guilds_updated: Date.now() })
            });
            console.log(`[Darklock Auth] Cached ${discordGuilds.length} guilds for ${user.username}`);
        } catch (guildErr) {
            console.warn('[Darklock Auth] Failed to cache Discord guilds:', guildErr.message);
        }

        setAuthCookie(res, req, token);

        console.log(`[Darklock Auth] Discord OAuth login: ${user.username}`);
        const redirectTarget = consumePostAuthRedirect(req, res);
        res.redirect(redirectTarget);

    } catch (err) {
        console.error('[Darklock Auth] Discord OAuth error:', err.response?.data || err.message);
        res.redirect('/platform/auth/login?error=' + encodeURIComponent('Discord login failed, please try again'));
    }
});

// ============================================================================
// GOOGLE OAUTH
// ============================================================================

/**
 * GET /auth/google - Begin Google OAuth flow
 */
router.get('/google', (req, res) => {
    const requestedNext = sanitizeRelativeRedirectPath(req.query?.next);
    if (requestedNext) {
        setPostAuthNextCookie(res, req, requestedNext);
    }

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
    const redirectUri = getGoogleRedirectUri(req);
    res.cookie('platform_oauth_state', stateToken, {
        httpOnly: true,
        secure: isProdGoogle,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
        ...(isProdGoogle ? { domain: '.darklock.net' } : {})
    });

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
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
        const redirectUri = getGoogleRedirectUri(req);

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
                redirect_uri: redirectUri
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

        setAuthCookie(res, req, token);

        console.log(`[Darklock Auth] Google OAuth login: ${user.username}`);
        const redirectTarget = consumePostAuthRedirect(req, res);
        res.redirect(redirectTarget);

    } catch (err) {
        console.error('[Darklock Auth] Google OAuth error:', err.response?.data || err.message);
        res.redirect('/platform/auth/login?error=' + encodeURIComponent('Google login failed, please try again'));
    }
});

// Export helpers for other modules
module.exports = router;
module.exports.verifyToken = verifyToken;
module.exports.getClientIP = getClientIP;
