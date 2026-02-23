/**
 * Darklock Platform - Secure Admin Authentication
 * 
 * SECURITY ARCHITECTURE:
 * - Admin-only access (roles: owner, admin)
 * - Bcrypt password hashing (12 rounds minimum)
 * - JWT tokens in httpOnly secure cookies
 * - Rate limiting on signin endpoint
 * - Generic error messages to prevent user enumeration
 * - Audit logging for all authentication events
 * - Environment variables for all secrets (fail-fast if missing)
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');

// Database
const db = require('../utils/database');

// Environment validator - fail-fast if secrets missing
const { requireEnv } = require('../utils/env-validator');

// ============================================================================
// ENVIRONMENT VALIDATION - Fail hard if secrets are missing
// ============================================================================

// SECURITY: Admin JWT must use a DIFFERENT secret than user JWT
const ADMIN_JWT_SECRET = requireEnv('ADMIN_JWT_SECRET');
const BCRYPT_ROUNDS = 12; // Minimum 12 rounds for admin passwords

// ============================================================================
// RATE LIMITING - Prevent brute force attacks
// ============================================================================

const signinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: { success: false, error: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get client IP address, handling proxies
 */
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.ip ||
           'unknown';
}

/**
 * Generate secure random ID
 */
function generateId() {
    return crypto.randomUUID();
}

/**
 * Log admin authentication events for audit trail
 */
async function logAdminAudit(eventType, adminId, details, req) {
    try {
        const ip = getClientIP(req);
        const userAgent = req.headers['user-agent'] || 'unknown';
        const now = new Date().toISOString();

        await db.run(`
            INSERT INTO admin_audit_log (
                id, event_type, admin_id, ip_address, user_agent, details, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            generateId(),
            eventType,
            adminId,
            ip,
            userAgent,
            JSON.stringify(details),
            now
        ]);
    } catch (err) {
        // Log but don't fail the request - audit is secondary to auth
        console.error('[Admin Auth] Audit log error:', err.message);
    }
}

// ============================================================================
// DATABASE SCHEMA - Admin tables
// ============================================================================

/**
 * Initialize admin tables in database
 * Called during server startup
 */
async function initializeAdminTables() {
    // Admins table - separate from regular users for security isolation
    await db.run(`
        CREATE TABLE IF NOT EXISTS admins (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            username TEXT,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('owner', 'admin')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login TEXT,
            last_login_ip TEXT,
            active INTEGER DEFAULT 1
        )
    `);

    // Migration: add username column to existing tables
    try {
        await db.run(`ALTER TABLE admins ADD COLUMN username TEXT`);
        console.log('[Admin Auth] \u2705 Migrated admins table: added username column');
    } catch (_) { /* column already exists */ }

    // Audit log for all admin authentication events
    await db.run(`
        CREATE TABLE IF NOT EXISTS admin_audit_log (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            admin_id TEXT,
            ip_address TEXT,
            user_agent TEXT,
            details TEXT,
            created_at TEXT NOT NULL
        )
    `);

    // Indexes for performance
    await db.run(`CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email)`);    await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_username ON admins(username) WHERE username IS NOT NULL`);    await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_id ON admin_audit_log(admin_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at)`);

    console.log('[Admin Auth] ✅ Admin tables initialized');
}

// ============================================================================
// ADMIN CRUD OPERATIONS
// ============================================================================

/**
 * Create a new admin (used by CLI or owner)
 * @param {string} email - Admin email
 * @param {string} password - Plain text password (will be hashed)
 * @param {string} role - 'owner' or 'admin'
 */
async function createAdmin(email, password, role = 'admin') {
    // Validate role
    if (!['owner', 'admin'].includes(role)) {
        throw new Error('Invalid role. Must be "owner" or "admin"');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new Error('Invalid email format');
    }

    // Validate password strength
    if (password.length < 12) {
        throw new Error('Password must be at least 12 characters');
    }

    // Hash password with bcrypt (12+ rounds)
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const now = new Date().toISOString();
    const id = generateId();

    await db.run(`
        INSERT INTO admins (id, email, password_hash, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [id, email.toLowerCase(), passwordHash, role, now, now]);

    console.log(`[Admin Auth] Created admin: ${email} (${role})`);
    return { id, email: email.toLowerCase(), role };
}

/**
 * Get admin by email or username (case-insensitive)
 */
async function getAdminByEmail(identifier) {
    const lower = identifier.toLowerCase();
    return db.get(
        `SELECT * FROM admins WHERE (email = ? OR username = ?) AND active = 1`,
        [lower, lower]
    );
}

/**
 * Get admin by ID
 */
async function getAdminById(id) {
    return db.get(`SELECT * FROM admins WHERE id = ? AND active = 1`, [id]);
}

/**
 * Update admin's last login timestamp
 */
async function updateLastLogin(adminId, ip) {
    const now = new Date().toISOString();
    await db.run(`
        UPDATE admins SET last_login = ?, last_login_ip = ?, updated_at = ?
        WHERE id = ?
    `, [now, ip, now, adminId]);
}

// ============================================================================
// JWT TOKEN MANAGEMENT
// ============================================================================

/**
 * Generate JWT token for authenticated admin
 * Short-lived (1 hour) for security
 */
function generateAdminToken(admin) {
    return jwt.sign(
        {
            adminId: admin.id,
            email: admin.email,
            role: admin.role,
            type: 'admin' // Distinguishes from regular user tokens
        },
        ADMIN_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

/**
 * Verify and decode admin JWT token
 */
function verifyAdminToken(token) {
    try {
        const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
        
        // Ensure this is an admin token, not a regular user token
        if (decoded.type !== 'admin') {
            return null;
        }
        
        return decoded;
    } catch (err) {
        return null;
    }
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

/**
 * Middleware to protect admin-only routes
 * Validates JWT from httpOnly cookie
 * Rejects non-admin tokens
 */
async function requireAdminAuth(req, res, next) {
    const token = req.cookies?.admin_token;

    console.log('[Admin Auth] Checking auth for:', req.path);
    console.log('[Admin Auth] Cookies present:', Object.keys(req.cookies || {}));
    console.log('[Admin Auth] admin_token exists:', !!token);

    if (!token) {
        console.log('[Admin Auth] No admin_token cookie found');
        // Redirect to signin for page requests, 401 for API
        if (req.accepts('html')) {
            return res.redirect('/signin');
        }
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const decoded = verifyAdminToken(token);

    if (!decoded) {
        console.log('[Admin Auth] Invalid or expired token');
        // Clear invalid cookie
        res.clearCookie('admin_token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/'
        });

        if (req.accepts('html')) {
            return res.redirect('/signin');
        }
        return res.status(401).json({ success: false, error: 'Invalid or expired session' });
    }

    // Verify admin still exists and is active
    const admin = await getAdminById(decoded.adminId);
    if (!admin) {
        console.log('[Admin Auth] Admin not found:', decoded.adminId);
        res.clearCookie('admin_token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/'
        });

        if (req.accepts('html')) {
            return res.redirect('/signin');
        }
        return res.status(401).json({ success: false, error: 'Account not found' });
    }

    // Attach admin to request for downstream use
    req.admin = {
        id: admin.id,
        email: admin.email,
        role: admin.role
    };

    next();
}

/**
 * Middleware to require owner role
 */
function requireOwner(req, res, next) {
    if (req.admin?.role !== 'owner') {
        return res.status(403).json({ success: false, error: 'Owner access required' });
    }
    next();
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /signin - Serve admin signin page
 */
router.get('/signin', (req, res) => {
    // If already authenticated, redirect to admin dashboard
    const token = req.cookies?.admin_token;
    if (token && verifyAdminToken(token)) {
        return res.redirect('/admin');
    }

    res.sendFile(path.join(__dirname, '../views/signin.html'));
});

/**
 * POST /signin/rfid - Handle RFID card authentication
 * Rate limited: 5 attempts per 15 minutes per IP
 */
router.post('/signin/rfid', signinLimiter, async (req, res) => {
    try {
        // Try to load RFID client
        let rfidClient;
        try {
            rfidClient = require('../../hardware/rfid_client');
        } catch (err) {
            console.error('[Admin Auth] RFID client not available:', err.message);
            return res.status(503).json({
                success: false,
                error: 'RFID authentication not available'
            });
        }

        // Request card scan
        const scanResult = await rfidClient.scanAdmin();

        if (!scanResult.allowed) {
            await logAdminAudit('LOGIN_FAILED', null, { 
                method: 'rfid',
                reason: 'card_not_authorized'
            }, req);

            return res.status(401).json({
                success: false,
                error: scanResult.reason || 'Card not authorized'
            });
        }

        // Card authorized - map to admin account
        // For now, we'll look up by checking if an admin exists
        // In production, you might want to store rfid_card_name in admins table
        const admins = await db.all('SELECT * FROM admins WHERE active = 1');
        
        if (admins.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'No active admin accounts'
            });
        }

        // Use the first active admin (owner)
        // TODO: Add rfid_card_name column to admins table for proper mapping
        const admin = admins.find(a => a.role === 'owner') || admins[0];

        // Authentication successful
        const ip = getClientIP(req);
        
        // Update last login
        await updateLastLogin(admin.id, ip);

        // Generate JWT token
        const token = generateAdminToken(admin);

        // Set httpOnly secure cookie
        res.cookie('admin_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 1000, // 1 hour
            path: '/'
        });

        // Log successful login
        await logAdminAudit('LOGIN_SUCCESS', admin.id, { 
            method: 'rfid',
            card_name: scanResult.user,
            ip 
        }, req);

        console.log(`[Admin Auth] Admin logged in via RFID: ${admin.email} (card: ${scanResult.user}) from ${ip}`);

        res.json({
            success: true,
            redirect: '/admin'
        });

    } catch (err) {
        console.error('[Admin Auth] RFID signin error:', err);
        
        res.status(500).json({
            success: false,
            error: 'An error occurred. Please try again.'
        });
    }
});

/**
 * POST /signin - Handle admin authentication
 * Rate limited: 5 attempts per 15 minutes per IP+email
 */
router.post('/signin', signinLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input presence
        if (!email || !password) {
            // Log failed attempt (missing credentials)
            await logAdminAudit('LOGIN_FAILED', null, { reason: 'missing_credentials' }, req);
            
            // Generic error - don't reveal which field is missing
            return res.status(400).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Look up admin by email
        const admin = await getAdminByEmail(email);

        // SECURITY: Always run bcrypt.compare even if user not found
        // This prevents timing attacks that could enumerate valid emails
        const dummyHash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.V1VqOG0iM1f9Oe';
        const passwordToCheck = admin?.password_hash || dummyHash;
        
        const isValid = await bcrypt.compare(password, passwordToCheck);

        // Check both conditions together to prevent timing attacks
        if (!admin || !isValid) {
            await logAdminAudit('LOGIN_FAILED', admin?.id || null, { 
                email: email.toLowerCase(),
                reason: !admin ? 'user_not_found' : 'invalid_password'
            }, req);

            // Generic error - don't reveal if email exists
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Authentication successful
        const ip = getClientIP(req);
        
        // Update last login
        await updateLastLogin(admin.id, ip);

        // Generate JWT token
        const token = generateAdminToken(admin);

        // Set httpOnly secure cookie
        res.cookie('admin_token', token, {
            httpOnly: true, // Prevents XSS access to cookie
            secure: process.env.NODE_ENV === 'production', // HTTPS only in production
            sameSite: 'lax', // Use 'lax' to allow cookies in same-site navigations and API calls
            maxAge: 60 * 60 * 1000, // 1 hour (matches JWT expiry)
            path: '/'
        });

        // Log successful login
        await logAdminAudit('LOGIN_SUCCESS', admin.id, { ip }, req);

        console.log(`[Admin Auth] Admin logged in: ${admin.email} from ${ip}`);

        res.json({
            success: true,
            redirect: '/admin'
        });

    } catch (err) {
        console.error('[Admin Auth] Signin error:', err);
        
        // Generic error - don't leak internal details
        res.status(500).json({
            success: false,
            error: 'An error occurred. Please try again.'
        });
    }
});

/**
 * POST /signout - Clear admin session
 */
router.post('/signout', async (req, res) => {
    const token = req.cookies?.admin_token;
    
    if (token) {
        const decoded = verifyAdminToken(token);
        if (decoded) {
            await logAdminAudit('LOGOUT', decoded.adminId, {}, req);
        }
    }

    // Clear the cookie
    res.clearCookie('admin_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
    });

    res.json({ success: true, message: 'Signed out successfully' });
});

/**
 * GET /signout - Handle GET request for signout (for links)
 */
router.get('/signout', async (req, res) => {
    const token = req.cookies?.admin_token;
    
    if (token) {
        const decoded = verifyAdminToken(token);
        if (decoded) {
            await logAdminAudit('LOGOUT', decoded.adminId, {}, req);
        }
    }

    res.clearCookie('admin_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
    });

    res.redirect('/signin');
});

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    router,
    initializeAdminTables,
    createAdmin,
    getAdminByEmail,
    getAdminById,
    requireAdminAuth,
    requireOwner,
    verifyAdminToken,
    BCRYPT_ROUNDS
};
