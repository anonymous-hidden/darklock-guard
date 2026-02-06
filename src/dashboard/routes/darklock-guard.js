/**
 * Darklock Guard API Routes
 * Server-side endpoints for desktop app integration
 * 
 * These routes handle:
 * - Device linking (6-digit code flow)
 * - Event synchronization (metadata only)
 * - Policy distribution
 * - Heartbeat/status monitoring
 * 
 * Security: Desktop app is authoritative. Server receives metadata only.
 * Server never executes file operations or requires desktop to be online.
 * 
 * CRITICAL: 2FA ENFORCEMENT
 * - 2FA status is stored ONLY in server DB
 * - Desktop app NEVER handles 2FA codes
 * - Device linking requires 2FA completion if enabled
 * - Admin/Owner accounts MUST have 2FA enabled
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// ============================================================================
// CONFIGURATION
// ============================================================================

// Link code expiry (10 minutes)
const LINK_CODE_EXPIRY_MS = 10 * 60 * 1000;

// Event sync limits
const MAX_EVENTS_PER_BATCH = 100;           // Max events in single request
const MAX_EVENTS_PER_MINUTE = 500;          // Rate limit per device
const EVENT_RATE_WINDOW_MS = 60 * 1000;     // 1 minute window

// Device token settings
const DEVICE_TOKEN_BYTES = 32;              // 256-bit tokens

// API Version & Capabilities
const API_VERSION = '1.1.0';
const CAPABILITIES = {
    event_sync: true,
    policy_sync: true,
    heartbeat: true,
    device_management: true,
    two_factor_enforcement: true,           // 2FA is server-enforced
    admin_mode: true,                       // Admin mode support
    alerts: false,                          // Future feature
    remote_actions: false                   // Never - desktop is authoritative
};

// Error codes for client handling
const ERROR_CODES = {
    TWO_FA_REQUIRED: '2FA_REQUIRED',
    TWO_FA_NOT_COMPLETED: '2FA_NOT_COMPLETED',
    ADMIN_REQUIRES_2FA: 'ADMIN_REQUIRES_2FA',
    INVALID_SESSION: 'INVALID_SESSION',
    DEVICE_REVOKED: 'DEVICE_REVOKED',
    INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE'
};

// Pending link codes (in-memory, short-lived)
const pendingLinkCodes = new Map();

// Device rate limiting (in-memory, keyed by device_id)
const deviceRateLimits = new Map();

// Clean up expired codes and rate limits every minute
setInterval(() => {
    const now = Date.now();
    
    // Clean expired link codes
    for (const [code, data] of pendingLinkCodes.entries()) {
        if (now > data.expiresAt) {
            pendingLinkCodes.delete(code);
        }
    }
    
    // Clean old rate limit entries
    for (const [deviceId, data] of deviceRateLimits.entries()) {
        if (now - data.windowStart > EVENT_RATE_WINDOW_MS * 2) {
            deviceRateLimits.delete(deviceId);
        }
    }
}, 60000);

/**
 * Check and update rate limit for a device
 * @returns {object} { allowed: boolean, remaining: number, resetIn: number }
 */
function checkDeviceRateLimit(deviceId, eventCount) {
    const now = Date.now();
    let limit = deviceRateLimits.get(deviceId);
    
    // Initialize or reset window
    if (!limit || now - limit.windowStart > EVENT_RATE_WINDOW_MS) {
        limit = { windowStart: now, count: 0 };
        deviceRateLimits.set(deviceId, limit);
    }
    
    const remaining = MAX_EVENTS_PER_MINUTE - limit.count;
    const resetIn = Math.max(0, EVENT_RATE_WINDOW_MS - (now - limit.windowStart));
    
    if (limit.count + eventCount > MAX_EVENTS_PER_MINUTE) {
        return { allowed: false, remaining, resetIn };
    }
    
    limit.count += eventCount;
    return { allowed: true, remaining: MAX_EVENTS_PER_MINUTE - limit.count, resetIn };
}

/**
 * Initialize database schema for Darklock Guard
 * Called once when routes are mounted
 */
async function initializeSchema(db) {
    if (!db) return;
    
    try {
        // Linked devices table
        await db.run(`CREATE TABLE IF NOT EXISTS darklock_devices (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            device_name TEXT NOT NULL,
            device_token_hash TEXT NOT NULL,
            platform TEXT DEFAULT 'unknown',
            last_seen_at DATETIME,
            last_ip TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            revoked_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
        
        // Synced events table (metadata only)
        await db.run(`CREATE TABLE IF NOT EXISTS darklock_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            severity TEXT NOT NULL,
            action TEXT NOT NULL,
            path_hash TEXT,
            details_json TEXT,
            synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(device_id, event_id),
            FOREIGN KEY (device_id) REFERENCES darklock_devices(id)
        )`);
        
        // Protection policies table
        await db.run(`CREATE TABLE IF NOT EXISTS darklock_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            rules_json TEXT NOT NULL,
            priority INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
        
        // Indexes for performance
        await db.run(`CREATE INDEX IF NOT EXISTS idx_darklock_devices_user ON darklock_devices(user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_darklock_events_device ON darklock_events(device_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_darklock_events_timestamp ON darklock_events(timestamp DESC)`);
        
        // Admin audit logs table
        await db.run(`CREATE TABLE IF NOT EXISTS darklock_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_user_id TEXT NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT,
            target_id TEXT,
            details_json TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (admin_user_id) REFERENCES users(id)
        )`);
        
        await db.run(`CREATE INDEX IF NOT EXISTS idx_darklock_audit_admin ON darklock_audit_logs(admin_user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_darklock_audit_timestamp ON darklock_audit_logs(created_at DESC)`);
        
        console.log('[Darklock Guard] Database schema initialized');
    } catch (err) {
        console.error('[Darklock Guard] Schema initialization error:', err.message);
    }
}

/**
 * Load users from Darklock platform data
 */
function loadUsersFromPlatform() {
    const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, '../../../darklock/data');
    const USERS_FILE = path.join(DATA_DIR, 'users.json');
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('[Darklock Guard] Failed to load users:', err.message);
    }
    return { users: [] };
}

/**
 * Get user by ID from platform data
 */
function getUserById(userId) {
    const usersData = loadUsersFromPlatform();
    return usersData.users.find(u => u.id === userId);
}

/**
 * CRITICAL: Check if user has completed 2FA (if required)
 * This is the source of truth for 2FA enforcement.
 * 
 * @param {object} user - User object from database
 * @param {object} session - Current session (must include 2FA completion status)
 * @returns {object} { passed: boolean, reason?: string, code?: string }
 */
function verify2FACompletion(user, session) {
    // If user doesn't have 2FA enabled, they pass
    if (!user.twoFactorEnabled) {
        return { passed: true };
    }
    
    // If 2FA is enabled, check if session has completed 2FA
    // The session should have been marked during web login
    if (!session || !session.twoFactorVerified) {
        return {
            passed: false,
            reason: 'Two-factor authentication required but not completed',
            code: ERROR_CODES.TWO_FA_NOT_COMPLETED
        };
    }
    
    return { passed: true };
}

/**
 * CRITICAL: Verify admin/owner can access admin mode
 * Admin and Owner accounts MUST have 2FA enabled and verified.
 * 
 * @param {object} user - User object
 * @param {object} session - Current session
 * @returns {object} { allowed: boolean, reason?: string, code?: string }
 */
function verifyAdminAccess(user, session) {
    // Check role first
    if (!user.role || !['admin', 'owner'].includes(user.role)) {
        return {
            allowed: false,
            reason: 'Insufficient privileges for admin mode',
            code: ERROR_CODES.INSUFFICIENT_ROLE
        };
    }
    
    // Admin/Owner MUST have 2FA enabled
    if (!user.twoFactorEnabled) {
        return {
            allowed: false,
            reason: 'Admin and Owner accounts must have 2FA enabled',
            code: ERROR_CODES.ADMIN_REQUIRES_2FA
        };
    }
    
    // Admin/Owner MUST have completed 2FA for this session
    const twoFACheck = verify2FACompletion(user, session);
    if (!twoFACheck.passed) {
        return {
            allowed: false,
            reason: twoFACheck.reason,
            code: twoFACheck.code
        };
    }
    
    return { allowed: true };
}

/**
 * Log an admin action for audit trail
 */
async function logAdminAction(db, adminUserId, action, targetType, targetId, details, ipAddress) {
    try {
        await db.run(
            `INSERT INTO darklock_audit_logs (admin_user_id, action, target_type, target_id, details_json, ip_address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [adminUserId, action, targetType, targetId, JSON.stringify(details), ipAddress]
        );
    } catch (err) {
        console.error('[Darklock Guard] Failed to log admin action:', err.message);
    }
}

/**
 * Generate a cryptographically secure 6-digit link code
 */
function generateLinkCode() {
    return crypto.randomInt(100000, 999999).toString();
}

/**
 * Hash a device token for storage
 */
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a secure device token
 * Token is opaque - device_id is stored separately, not embedded in token.
 * This ensures:
 * - Token revocation is instant (just mark device as revoked)
 * - Token cannot be decoded to access other devices
 * - No expiry management needed (revocation handles invalidation)
 */
function generateDeviceToken() {
    return crypto.randomBytes(DEVICE_TOKEN_BYTES).toString('hex');
}

/**
 * Middleware to authenticate device token
 */
function authenticateDevice(db) {
    return async (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing device token' });
        }
        
        const token = authHeader.substring(7);
        const tokenHash = hashToken(token);
        
        try {
            const device = await db.get(
                `SELECT * FROM darklock_devices WHERE device_token_hash = ? AND revoked_at IS NULL`,
                [tokenHash]
            );
            
            if (!device) {
                return res.status(401).json({ error: 'Invalid or revoked device token' });
            }
            
            // SECURITY: Validate device is not revoked (belt + suspenders)
            if (device.revoked_at) {
                return res.status(401).json({ error: 'Device has been revoked' });
            }
            
            // SECURITY: Device can only access its own user's data
            // This is enforced by storing user_id on device and checking ownership
            // in all data-access queries (see events, policies endpoints)
            
            // Update last seen
            await db.run(
                `UPDATE darklock_devices SET last_seen_at = CURRENT_TIMESTAMP, last_ip = ? WHERE id = ?`,
                [req.ip || req.connection?.remoteAddress || 'unknown', device.id]
            );
            
            req.device = device;
            next();
        } catch (err) {
            console.error('[Darklock Guard] Auth error:', err.message);
            return res.status(500).json({ error: 'Authentication failed' });
        }
    };
}

/**
 * Create routes with bot/database context
 */
function createRoutes(bot, db) {
    // Initialize schema on first load
    initializeSchema(db);
    
    // =========================================================================
    // POST /api/darklock/link/start
    // Desktop app requests a link code to display to user
    // =========================================================================
    router.post('/link/start', async (req, res) => {
        try {
            const { device_name, platform } = req.body;
            
            if (!device_name) {
                return res.status(400).json({ error: 'device_name required' });
            }
            
            // Generate link code
            let code;
            let attempts = 0;
            do {
                code = generateLinkCode();
                attempts++;
            } while (pendingLinkCodes.has(code) && attempts < 10);
            
            if (pendingLinkCodes.has(code)) {
                return res.status(503).json({ error: 'Unable to generate unique code, try again' });
            }
            
            const expiresAt = Date.now() + LINK_CODE_EXPIRY_MS;
            
            pendingLinkCodes.set(code, {
                deviceName: device_name,
                platform: platform || 'unknown',
                expiresAt,
                confirmedBy: null,
                deviceToken: null
            });
            
            res.json({
                code,
                expires_at: new Date(expiresAt).toISOString(),
                expires_in_seconds: Math.floor(LINK_CODE_EXPIRY_MS / 1000)
            });
            
            console.log(`[Darklock Guard] Link code generated for device: ${device_name}`);
        } catch (err) {
            console.error('[Darklock Guard] Link start error:', err.message);
            res.status(500).json({ error: 'Failed to generate link code' });
        }
    });
    
    // =========================================================================
    // POST /api/darklock/link/confirm
    // Two modes:
    //   1. User confirms from web dashboard (with JWT auth) - provides code
    //   2. Desktop app polls to check if confirmed - provides code
    // 
    // CRITICAL: 2FA ENFORCEMENT
    // - If user has 2FA enabled, linking is REJECTED unless 2FA was completed
    // - Desktop app NEVER handles 2FA - it's done on the web login
    // =========================================================================
    router.post('/link/confirm', async (req, res) => {
        try {
            const { code, mode } = req.body;
            
            if (!code) {
                return res.status(400).json({ error: 'code required' });
            }
            
            const linkData = pendingLinkCodes.get(code);
            
            if (!linkData) {
                return res.status(404).json({ error: 'Invalid or expired link code' });
            }
            
            if (Date.now() > linkData.expiresAt) {
                pendingLinkCodes.delete(code);
                return res.status(410).json({ error: 'Link code expired' });
            }
            
            // Mode: user_confirm - Web user confirms the link
            if (mode === 'user_confirm') {
                // Authenticate user via JWT cookie
                const token = req.cookies?.token || req.cookies?.darklock_token || req.headers.authorization?.replace('Bearer ', '');
                if (!token) {
                    return res.status(401).json({ 
                        error: 'Authentication required',
                        code: ERROR_CODES.INVALID_SESSION
                    });
                }
                
                let decoded;
                try {
                    if (!process.env.JWT_SECRET) {
                        return res.status(500).json({ error: 'Server misconfigured', code: ERROR_CODES.INVALID_SESSION });
                    }
                    decoded = jwt.verify(token, process.env.JWT_SECRET);
                } catch (e) {
                    return res.status(401).json({ 
                        error: 'Invalid token',
                        code: ERROR_CODES.INVALID_SESSION
                    });
                }
                
                const userId = decoded.userId || decoded.id || decoded.sub;
                if (!userId) {
                    return res.status(401).json({ 
                        error: 'Invalid user session',
                        code: ERROR_CODES.INVALID_SESSION
                    });
                }
                
                // =========================================================
                // CRITICAL: 2FA ENFORCEMENT
                // Get full user data to check 2FA status
                // =========================================================
                const user = getUserById(userId);
                if (!user) {
                    return res.status(401).json({ 
                        error: 'User not found',
                        code: ERROR_CODES.INVALID_SESSION
                    });
                }
                
                // Check 2FA requirement
                // The decoded JWT should contain twoFactorVerified if 2FA was completed during login
                const session = {
                    twoFactorVerified: decoded.twoFactorVerified || false
                };
                
                const twoFACheck = verify2FACompletion(user, session);
                if (!twoFACheck.passed) {
                    console.log(`[Darklock Guard] Device linking rejected for user ${userId}: ${twoFACheck.reason}`);
                    return res.status(403).json({
                        error: twoFACheck.reason,
                        code: twoFACheck.code,
                        two_factor_required: true,
                        message: 'Please complete two-factor authentication on the website before linking devices.'
                    });
                }
                
                // Generate device token and ID
                const deviceId = crypto.randomUUID();
                const deviceToken = generateDeviceToken();
                const tokenHash = hashToken(deviceToken);
                
                // Store device in database
                await db.run(
                    `INSERT INTO darklock_devices (id, user_id, device_name, device_token_hash, platform, last_seen_at)
                     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                    [deviceId, userId, linkData.deviceName, tokenHash, linkData.platform]
                );
                
                // Update link data for desktop to retrieve
                linkData.confirmedBy = userId;
                linkData.deviceToken = deviceToken;
                linkData.deviceId = deviceId;
                linkData.userRole = user.role || 'user';
                
                // Log the device linking for audit
                await logAdminAction(db, userId, 'device_link', 'device', deviceId, {
                    device_name: linkData.deviceName,
                    platform: linkData.platform
                }, req.ip || 'unknown');
                
                res.json({
                    success: true,
                    message: 'Device linked successfully',
                    device_id: deviceId,
                    device_name: linkData.deviceName
                });
                
                console.log(`[Darklock Guard] Device ${linkData.deviceName} linked to user ${userId} (2FA verified)`);
                return;
            }
            
            // Mode: device_poll - Desktop app checking if confirmed
            if (mode === 'device_poll' || !mode) {
                if (linkData.confirmedBy && linkData.deviceToken) {
                    // Link was confirmed, return token to desktop
                    const response = {
                        confirmed: true,
                        device_token: linkData.deviceToken,
                        device_id: linkData.deviceId,
                        user_id: linkData.confirmedBy,
                        user_role: linkData.userRole || 'user'
                    };
                    
                    // Clear the link code
                    pendingLinkCodes.delete(code);
                    
                    res.json(response);
                    console.log(`[Darklock Guard] Device token delivered to ${linkData.deviceName}`);
                } else {
                    // Not yet confirmed
                    res.json({
                        confirmed: false,
                        expires_in_seconds: Math.floor((linkData.expiresAt - Date.now()) / 1000)
                    });
                }
                return;
            }
            
            res.status(400).json({ error: 'Invalid mode' });
        } catch (err) {
            console.error('[Darklock Guard] Link confirm error:', err.message);
            res.status(500).json({ error: 'Failed to process link confirmation' });
        }
    });
    
    // =========================================================================
    // POST /api/darklock/events
    // Desktop app syncs event metadata to server (batch upload)
    // 
    // Security:
    // - Device can only sync events to its own record
    // - Rate limited per device (MAX_EVENTS_PER_MINUTE)
    // - Batch size limited (MAX_EVENTS_PER_BATCH)
    // - Graceful partial failures (returns synced count)
    // =========================================================================
    router.post('/events', authenticateDevice(db), async (req, res) => {
        try {
            const { events } = req.body;
            const deviceId = req.device.id;
            
            if (!Array.isArray(events)) {
                return res.status(400).json({ error: 'events must be an array' });
            }
            
            if (events.length === 0) {
                return res.json({ synced: 0, remaining: 0 });
            }
            
            // Check rate limit BEFORE processing
            const rateCheck = checkDeviceRateLimit(deviceId, Math.min(events.length, MAX_EVENTS_PER_BATCH));
            if (!rateCheck.allowed) {
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    remaining: rateCheck.remaining,
                    reset_in_ms: rateCheck.resetIn,
                    retry_after: Math.ceil(rateCheck.resetIn / 1000)
                });
            }
            
            // Limit batch size
            const toSync = events.slice(0, MAX_EVENTS_PER_BATCH);
            
            let synced = 0;
            for (const event of toSync) {
                try {
                    // Hash the path for privacy (server never sees actual paths)
                    const pathHash = event.path 
                        ? crypto.createHash('sha256').update(event.path).digest('hex').substring(0, 16)
                        : null;
                    
                    await db.run(
                        `INSERT OR IGNORE INTO darklock_events 
                         (device_id, event_id, timestamp, severity, action, path_hash, details_json)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            deviceId,
                            event.id || crypto.randomUUID(),
                            event.timestamp || new Date().toISOString(),
                            event.severity || 'info',
                            event.action || 'unknown',
                            pathHash,
                            event.details ? JSON.stringify(event.details) : null
                        ]
                    );
                    synced++;
                } catch (e) {
                    // Skip duplicates or invalid events
                }
            }
            
            // Get updated rate limit info
            const updatedRateCheck = checkDeviceRateLimit(deviceId, 0);
            
            res.json({
                synced,
                failed: toSync.length - synced,
                remaining: events.length - toSync.length,  // Events not processed (batch limit)
                rate_limit: {
                    remaining: updatedRateCheck.remaining,
                    reset_in_ms: updatedRateCheck.resetIn
                }
            });
            
            if (synced > 0) {
                console.log(`[Darklock Guard] Synced ${synced}/${toSync.length} events from device ${deviceId}`);
            }
        } catch (err) {
            console.error('[Darklock Guard] Events sync error:', err.message);
            res.status(500).json({ error: 'Failed to sync events', partial_synced: 0 });
        }
    });
    
    // =========================================================================
    // GET /api/darklock/policies
    // Desktop app fetches protection policies for the linked user
    // =========================================================================
    router.get('/policies', authenticateDevice(db), async (req, res) => {
        try {
            const userId = req.device.user_id;
            
            const policies = await db.all(
                `SELECT id, name, rules_json, priority, enabled, updated_at
                 FROM darklock_policies 
                 WHERE user_id = ? AND enabled = 1
                 ORDER BY priority DESC`,
                [userId]
            );
            
            // Parse rules JSON
            const parsed = policies.map(p => ({
                id: p.id,
                name: p.name,
                rules: JSON.parse(p.rules_json || '{}'),
                priority: p.priority,
                updated_at: p.updated_at
            }));
            
            res.json({
                policies: parsed,
                count: parsed.length,
                // Capability flags for client feature detection
                capabilities: CAPABILITIES,
                api_version: API_VERSION
            });
        } catch (err) {
            console.error('[Darklock Guard] Policies fetch error:', err.message);
            res.status(500).json({ error: 'Failed to fetch policies' });
        }
    });
    
    // =========================================================================
    // POST /api/darklock/heartbeat
    // Desktop app sends periodic heartbeat with status summary
    // =========================================================================
    router.post('/heartbeat', authenticateDevice(db), async (req, res) => {
        try {
            const deviceId = req.device.id;
            const { 
                status,           // 'healthy', 'warning', 'critical'
                protected_count,  // Number of protected items
                last_verified,    // ISO timestamp of last verification
                monitor_running,  // Boolean
                pending_events    // Number of events waiting to sync
            } = req.body;
            
            // Update device status
            await db.run(
                `UPDATE darklock_devices 
                 SET last_seen_at = CURRENT_TIMESTAMP, last_ip = ?
                 WHERE id = ?`,
                [req.ip || 'unknown', deviceId]
            );
            
            // Check for any pending commands/policies
            const userId = req.device.user_id;
            const pendingPolicies = await db.get(
                `SELECT COUNT(*) as count FROM darklock_policies 
                 WHERE user_id = ? AND enabled = 1 AND updated_at > ?`,
                [userId, req.device.last_seen_at || '1970-01-01']
            );
            
            res.json({
                ack: true,
                server_time: new Date().toISOString(),
                sync_policies: (pendingPolicies?.count || 0) > 0,
                message: null // Reserved for server-to-device messages
            });
        } catch (err) {
            console.error('[Darklock Guard] Heartbeat error:', err.message);
            res.status(500).json({ error: 'Heartbeat failed' });
        }
    });
    
    // =========================================================================
    // GET /api/darklock/devices
    // Web dashboard lists user's linked devices (requires JWT auth)
    // =========================================================================
    router.get('/devices', async (req, res) => {
        try {
            // Authenticate via JWT
            const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
            if (!token) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            
            let decoded;
            try {
                decoded = jwt.verify(token, process.env.JWT_SECRET);
            } catch (e) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            const userId = decoded.userId || decoded.id || decoded.sub;
            
            const devices = await db.all(
                `SELECT id, device_name, platform, last_seen_at, created_at, revoked_at
                 FROM darklock_devices 
                 WHERE user_id = ?
                 ORDER BY last_seen_at DESC`,
                [userId]
            );
            
            res.json({
                devices: devices.map(d => ({
                    ...d,
                    is_online: d.last_seen_at && 
                        (Date.now() - new Date(d.last_seen_at).getTime()) < 5 * 60 * 1000,
                    is_revoked: !!d.revoked_at
                })),
                count: devices.length
            });
        } catch (err) {
            console.error('[Darklock Guard] Devices list error:', err.message);
            res.status(500).json({ error: 'Failed to list devices' });
        }
    });
    
    // =========================================================================
    // DELETE /api/darklock/devices/:deviceId
    // Web dashboard revokes a device (requires JWT auth)
    // =========================================================================
    router.delete('/devices/:deviceId', async (req, res) => {
        try {
            const { deviceId } = req.params;
            
            // Authenticate via JWT
            const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
            if (!token) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            
            let decoded;
            try {
                decoded = jwt.verify(token, process.env.JWT_SECRET);
            } catch (e) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            const userId = decoded.userId || decoded.id || decoded.sub;
            
            // Verify device belongs to user
            const device = await db.get(
                `SELECT * FROM darklock_devices WHERE id = ? AND user_id = ?`,
                [deviceId, userId]
            );
            
            if (!device) {
                return res.status(404).json({ error: 'Device not found' });
            }
            
            // Revoke device
            await db.run(
                `UPDATE darklock_devices SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [deviceId]
            );
            
            res.json({
                success: true,
                message: 'Device revoked successfully'
            });
            
            console.log(`[Darklock Guard] Device ${deviceId} revoked by user ${userId}`);
        } catch (err) {
            console.error('[Darklock Guard] Device revoke error:', err.message);
            res.status(500).json({ error: 'Failed to revoke device' });
        }
    });
    
    // =========================================================================
    // GET /api/darklock/admin/verify
    // Desktop app verifies admin access
    // CRITICAL: Requires valid device token AND admin/owner role AND 2FA
    // =========================================================================
    router.get('/admin/verify', authenticateDevice(db), async (req, res) => {
        try {
            const userId = req.device.user_id;
            const user = getUserById(userId);
            
            if (!user) {
                return res.status(401).json({
                    error: 'User not found',
                    code: ERROR_CODES.INVALID_SESSION
                });
            }
            
            // For admin verification, we need to check if the original login had 2FA
            // Since the device token was only issued after 2FA verification,
            // we can trust that 2FA was completed. But we still need to verify:
            // 1. User has admin/owner role
            // 2. User has 2FA enabled (required for admin accounts)
            
            if (!user.role || !['admin', 'owner'].includes(user.role)) {
                return res.status(403).json({
                    allowed: false,
                    error: 'Insufficient privileges for admin mode',
                    code: ERROR_CODES.INSUFFICIENT_ROLE
                });
            }
            
            if (!user.twoFactorEnabled) {
                return res.status(403).json({
                    allowed: false,
                    error: 'Admin accounts must have 2FA enabled',
                    code: ERROR_CODES.ADMIN_REQUIRES_2FA
                });
            }
            
            // Log admin mode access
            await logAdminAction(db, userId, 'admin_mode_verify', 'session', req.device.id, {
                device_name: req.device.device_name
            }, req.ip || 'unknown');
            
            res.json({
                allowed: true,
                role: user.role,
                user_id: userId,
                username: user.username,
                two_factor_enabled: true
            });
            
            console.log(`[Darklock Guard] Admin mode verified for user ${userId} (${user.role})`);
        } catch (err) {
            console.error('[Darklock Guard] Admin verify error:', err.message);
            res.status(500).json({ error: 'Failed to verify admin access' });
        }
    });
    
    // =========================================================================
    // GET /api/darklock/admin/devices
    // Admin view of all devices (admin/owner only)
    // =========================================================================
    router.get('/admin/devices', authenticateDevice(db), async (req, res) => {
        try {
            const userId = req.device.user_id;
            const user = getUserById(userId);
            
            // Verify admin access
            if (!user || !['admin', 'owner'].includes(user.role)) {
                return res.status(403).json({
                    error: 'Admin access required',
                    code: ERROR_CODES.INSUFFICIENT_ROLE
                });
            }
            
            if (!user.twoFactorEnabled) {
                return res.status(403).json({
                    error: 'Admin accounts must have 2FA enabled',
                    code: ERROR_CODES.ADMIN_REQUIRES_2FA
                });
            }
            
            // Get all devices (aggregated, no sensitive paths)
            const devices = await db.all(`
                SELECT 
                    d.id,
                    d.user_id,
                    d.device_name,
                    d.platform,
                    d.last_seen_at,
                    d.created_at,
                    d.revoked_at,
                    (SELECT COUNT(*) FROM darklock_events WHERE device_id = d.id) as event_count
                FROM darklock_devices d
                ORDER BY d.last_seen_at DESC
            `);
            
            // Log admin action
            await logAdminAction(db, userId, 'admin_view_devices', 'devices', null, {
                device_count: devices.length
            }, req.ip || 'unknown');
            
            res.json({
                devices: devices.map(d => ({
                    ...d,
                    is_online: d.last_seen_at && 
                        (Date.now() - new Date(d.last_seen_at).getTime()) < 5 * 60 * 1000,
                    is_revoked: !!d.revoked_at
                })),
                count: devices.length
            });
        } catch (err) {
            console.error('[Darklock Guard] Admin devices error:', err.message);
            res.status(500).json({ error: 'Failed to list devices' });
        }
    });
    
    // =========================================================================
    // DELETE /api/darklock/admin/devices/:deviceId
    // Admin revokes any device (admin/owner only)
    // =========================================================================
    router.delete('/admin/devices/:deviceId', authenticateDevice(db), async (req, res) => {
        try {
            const { deviceId } = req.params;
            const userId = req.device.user_id;
            const user = getUserById(userId);
            
            // Verify admin access
            if (!user || !['admin', 'owner'].includes(user.role)) {
                return res.status(403).json({
                    error: 'Admin access required',
                    code: ERROR_CODES.INSUFFICIENT_ROLE
                });
            }
            
            if (!user.twoFactorEnabled) {
                return res.status(403).json({
                    error: 'Admin accounts must have 2FA enabled',
                    code: ERROR_CODES.ADMIN_REQUIRES_2FA
                });
            }
            
            // Get device info for logging
            const device = await db.get(
                `SELECT * FROM darklock_devices WHERE id = ?`,
                [deviceId]
            );
            
            if (!device) {
                return res.status(404).json({ error: 'Device not found' });
            }
            
            // Revoke device
            await db.run(
                `UPDATE darklock_devices SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [deviceId]
            );
            
            // Log admin action
            await logAdminAction(db, userId, 'admin_revoke_device', 'device', deviceId, {
                device_name: device.device_name,
                target_user_id: device.user_id
            }, req.ip || 'unknown');
            
            res.json({
                success: true,
                message: 'Device revoked successfully'
            });
            
            console.log(`[Darklock Guard] Device ${deviceId} revoked by admin ${userId}`);
        } catch (err) {
            console.error('[Darklock Guard] Admin device revoke error:', err.message);
            res.status(500).json({ error: 'Failed to revoke device' });
        }
    });
    
    // =========================================================================
    // GET /api/darklock/admin/audit
    // Admin audit logs (admin/owner only)
    // =========================================================================
    router.get('/admin/audit', authenticateDevice(db), async (req, res) => {
        try {
            const userId = req.device.user_id;
            const user = getUserById(userId);
            
            // Verify admin access
            if (!user || !['admin', 'owner'].includes(user.role)) {
                return res.status(403).json({
                    error: 'Admin access required',
                    code: ERROR_CODES.INSUFFICIENT_ROLE
                });
            }
            
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            
            const logs = await db.all(`
                SELECT * FROM darklock_audit_logs
                ORDER BY created_at DESC
                LIMIT ?
            `, [limit]);
            
            res.json({
                logs: logs.map(l => ({
                    ...l,
                    details: l.details_json ? JSON.parse(l.details_json) : null
                })),
                count: logs.length
            });
        } catch (err) {
            console.error('[Darklock Guard] Admin audit error:', err.message);
            res.status(500).json({ error: 'Failed to fetch audit logs' });
        }
    });
    
    // =========================================================================
    // GET /api/darklock/admin/stats
    // Admin statistics (admin/owner only)
    // =========================================================================
    router.get('/admin/stats', authenticateDevice(db), async (req, res) => {
        try {
            const userId = req.device.user_id;
            const user = getUserById(userId);
            
            // Verify admin access
            if (!user || !['admin', 'owner'].includes(user.role)) {
                return res.status(403).json({
                    error: 'Admin access required',
                    code: ERROR_CODES.INSUFFICIENT_ROLE
                });
            }
            
            // Aggregated statistics only - no personal data
            const stats = {
                total_devices: 0,
                active_devices: 0,
                revoked_devices: 0,
                total_events: 0,
                events_today: 0,
                events_this_week: 0
            };
            
            const deviceStats = await db.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) as revoked
                FROM darklock_devices
            `);
            
            if (deviceStats) {
                stats.total_devices = deviceStats.total || 0;
                stats.active_devices = deviceStats.active || 0;
                stats.revoked_devices = deviceStats.revoked || 0;
            }
            
            const eventStats = await db.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN timestamp > datetime('now', '-1 day') THEN 1 ELSE 0 END) as today,
                    SUM(CASE WHEN timestamp > datetime('now', '-7 days') THEN 1 ELSE 0 END) as week
                FROM darklock_events
            `);
            
            if (eventStats) {
                stats.total_events = eventStats.total || 0;
                stats.events_today = eventStats.today || 0;
                stats.events_this_week = eventStats.week || 0;
            }
            
            res.json({ stats });
        } catch (err) {
            console.error('[Darklock Guard] Admin stats error:', err.message);
            res.status(500).json({ error: 'Failed to fetch statistics' });
        }
    });
    
    // =========================================================================
    // GET /api/darklock/admin/policies
    // Get current policies (admin only)
    // =========================================================================
    router.get('/admin/policies', authenticateDevice(db), async (req, res) => {
        try {
            // Verify admin access
            const adminCheck = await verifyAdminAccess(req, db);
            if (adminCheck.error) {
                return res.status(adminCheck.status).json({ 
                    error: adminCheck.error,
                    code: adminCheck.code
                });
            }
            
            // Get policies from settings table
            const policies = await db.all(`
                SELECT key, value FROM settings 
                WHERE key LIKE 'darklock_policy_%'
            `);
            
            // Convert to object with defaults
            const policyObj = {
                auto_protect: true,
                sync_events: true,
                require_pin: false,
                max_devices: 5,
                event_retention_days: 30
            };
            
            for (const row of policies) {
                const key = row.key.replace('darklock_policy_', '');
                try {
                    policyObj[key] = JSON.parse(row.value);
                } catch {
                    policyObj[key] = row.value;
                }
            }
            
            res.json({ policies: policyObj });
        } catch (err) {
            console.error('[Darklock Guard] Get policies error:', err.message);
            res.status(500).json({ error: 'Failed to fetch policies' });
        }
    });
    
    // =========================================================================
    // PUT /api/darklock/admin/policies
    // Update policies (admin only)
    // =========================================================================
    router.put('/admin/policies', authenticateDevice(db), async (req, res) => {
        try {
            // Verify admin access
            const adminCheck = await verifyAdminAccess(req, db);
            if (adminCheck.error) {
                return res.status(adminCheck.status).json({ 
                    error: adminCheck.error,
                    code: adminCheck.code
                });
            }
            
            const { policies } = req.body;
            
            if (!policies || typeof policies !== 'object') {
                return res.status(400).json({ error: 'Invalid policies data' });
            }
            
            // Validate and save each policy
            const validPolicies = ['auto_protect', 'sync_events', 'require_pin', 'max_devices', 'event_retention_days'];
            const updated = [];
            
            for (const [key, value] of Object.entries(policies)) {
                if (!validPolicies.includes(key)) {
                    continue;
                }
                
                // Type validation
                if (key === 'max_devices' || key === 'event_retention_days') {
                    if (typeof value !== 'number' || value < 1) {
                        return res.status(400).json({ error: `Invalid value for ${key}` });
                    }
                } else if (typeof value !== 'boolean') {
                    return res.status(400).json({ error: `Invalid value for ${key}` });
                }
                
                await db.run(`
                    INSERT OR REPLACE INTO settings (key, value, updated_at)
                    VALUES (?, ?, datetime('now'))
                `, [`darklock_policy_${key}`, JSON.stringify(value)]);
                
                updated.push(key);
            }
            
            // Log admin action
            await logAdminAction(db, req.deviceUserId, 'POLICY_CHANGE', {
                policies: updated,
                device_id: req.deviceId
            });
            
            res.json({ 
                success: true,
                updated: updated
            });
        } catch (err) {
            console.error('[Darklock Guard] Update policies error:', err.message);
            res.status(500).json({ error: 'Failed to update policies' });
        }
    });
    
    // =========================================================================
    // GET /api/darklock/status
    // Public health check endpoint with capability discovery
    // Desktop app calls this on startup to check connectivity and features
    // =========================================================================
    router.get('/status', (req, res) => {
        res.json({
            service: 'darklock-guard',
            status: 'online',
            version: API_VERSION,
            timestamp: new Date().toISOString(),
            // Capability flags for client feature detection
            capabilities: CAPABILITIES,
            // Rate limit info for clients to adapt
            limits: {
                max_events_per_batch: MAX_EVENTS_PER_BATCH,
                max_events_per_minute: MAX_EVENTS_PER_MINUTE
            },
            // Error codes for client handling
            error_codes: ERROR_CODES
        });
    });
    
    return router;
}

module.exports = { createRoutes, initializeSchema, ERROR_CODES };
