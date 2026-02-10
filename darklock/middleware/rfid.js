/**
 * DARKLOCK ADMIN RFID MIDDLEWARE
 * 
 * Enforces RFID presence verification for admin panel access.
 * Works alongside password authentication as a second layer.
 * 
 * SECURITY MODEL:
 * 1. User enters password (standard auth)
 * 2. Password verified → request RFID
 * 3. RFID verified → grant admin session
 * 4. Session expires OR RFID removed → logout
 * 
 * USAGE:
 *   const { requireRFIDPresence, checkRFIDMiddleware } = require('./middleware/rfid');
 *   
 *   // Protect admin routes
 *   router.post('/admin/dangerous-action', requireRFIDPresence, async (req, res) => {
 *       // Action only executes if RFID present
 *   });
 */

const axios = require('axios');

// Configuration
const HARDWARE_API_URL = process.env.HARDWARE_API_URL || 'http://localhost:5555';
const RFID_CHECK_ENABLED = process.env.RFID_CHECK_ENABLED === 'true';
const RFID_TIMEOUT_MS = 5000; // Max time for RFID check

/**
 * Query hardware gate status
 * @returns {Promise<Object>} Hardware gate status
 */
async function getHardwareStatus() {
    try {
        const response = await axios.get(`${HARDWARE_API_URL}/hardware/status`, {
            timeout: 2000
        });
        return response.data;
    } catch (error) {
        console.error('[RFID] Failed to get hardware status:', error.message);
        return { enabled: false, available: false, error: error.message };
    }
}

/**
 * Check RFID presence for specific operation
 * @param {string} operation - Operation name
 * @returns {Promise<Object>} { allowed: bool, message: string, uid_hash: string }
 */
async function checkRFIDPresence(operation = 'admin_access') {
    if (!RFID_CHECK_ENABLED) {
        return { allowed: true, message: 'RFID check disabled', bypass: true };
    }

    try {
        const response = await axios.post(
            `${HARDWARE_API_URL}/hardware/check-presence`,
            { operation },
            { timeout: RFID_TIMEOUT_MS }
        );
        return response.data;
    } catch (error) {
        console.error('[RFID] Presence check failed:', error.message);
        // FAIL CLOSED: If service unavailable, deny access
        return {
            allowed: false,
            message: 'RFID verification service unavailable (FAIL CLOSED)',
            error: error.message
        };
    }
}

/**
 * Middleware: Require RFID presence for route access
 * Use this on routes that need hardware verification
 */
async function requireRFIDPresence(req, res, next) {
    // Skip check if disabled
    if (!RFID_CHECK_ENABLED) {
        return next();
    }

    const operation = req.body?.operation || req.query?.operation || 'admin_action';

    try {
        const check = await checkRFIDPresence(operation);

        if (!check.allowed) {
            console.warn(`[RFID] Access denied for ${req.user?.email || 'unknown'}: ${check.message}`);
            
            return res.status(403).json({
                success: false,
                error: 'Physical presence required',
                rfidRequired: true,
                message: check.message,
                instructions: [
                    'Locate your authorized RFID card',
                    'Hold the card near the RFID reader',
                    'Wait for confirmation',
                    'Retry your action'
                ]
            });
        }

        // RFID verified - attach to request for audit logging
        req.rfidVerified = true;
        req.rfidUidHash = check.uid_hash;
        
        console.info(`[RFID] ✅ Presence verified for ${req.user?.email || 'unknown'} (UID: ${check.uid_hash})`);
        
        next();

    } catch (error) {
        console.error('[RFID] Middleware error:', error);
        return res.status(500).json({
            success: false,
            error: 'RFID verification failed',
            details: error.message
        });
    }
}

/**
 * Middleware: Check RFID and add status to request
 * Does not block request, only adds info
 */
async function checkRFIDMiddleware(req, res, next) {
    if (!RFID_CHECK_ENABLED) {
        req.rfidStatus = { enabled: false };
        return next();
    }

    try {
        const status = await getHardwareStatus();
        req.rfidStatus = status;
        next();
    } catch (error) {
        req.rfidStatus = { enabled: false, error: error.message };
        next();
    }
}

/**
 * Enhanced login handler with RFID verification
 * Call this after password validation
 */
async function verifyRFIDForLogin(username, passwordVerified = false) {
    if (!passwordVerified) {
        throw new Error('Password must be verified before RFID check');
    }

    if (!RFID_CHECK_ENABLED) {
        return {
            success: true,
            rfidVerified: false,
            message: 'RFID disabled'
        };
    }

    try {
        const response = await axios.post(
            `${HARDWARE_API_URL}/hardware/admin-unlock`,
            {
                username,
                verified_2fa: passwordVerified
            },
            { timeout: RFID_TIMEOUT_MS }
        );

        return {
            success: response.data.success,
            rfidVerified: response.data.rfid_verified,
            message: response.data.message,
            uidHash: response.data.uid_hash,
            instructions: response.data.instructions
        };

    } catch (error) {
        if (error.response?.status === 403) {
            // RFID not present
            return {
                success: false,
                rfidVerified: false,
                message: error.response.data.message,
                instructions: error.response.data.instructions
            };
        }

        // Service error - fail closed
        return {
            success: false,
            rfidVerified: false,
            message: 'RFID verification service unavailable',
            error: error.message
        };
    }
}

/**
 * Session monitor: Continuously check RFID presence
 * If RFID removed, invalidate session
 */
class RFIDSessionMonitor {
    constructor() {
        this.activeSessions = new Map(); // sessionId -> { userId, lastCheck, uidHash }
        this.checkInterval = 3000; // Check every 3 seconds
        this.running = false;
    }

    start() {
        if (this.running || !RFID_CHECK_ENABLED) return;

        this.running = true;
        this.monitorLoop();
        console.info('[RFID] Session monitor started');
    }

    stop() {
        this.running = false;
        console.info('[RFID] Session monitor stopped');
    }

    registerSession(sessionId, userId, uidHash) {
        this.activeSessions.set(sessionId, {
            userId,
            uidHash,
            registeredAt: Date.now(),
            lastCheck: Date.now()
        });
        console.info(`[RFID] Session registered: ${sessionId} (user: ${userId})`);
    }

    unregisterSession(sessionId) {
        this.activeSessions.delete(sessionId);
        console.info(`[RFID] Session unregistered: ${sessionId}`);
    }

    async monitorLoop() {
        while (this.running) {
            try {
                await this.checkAllSessions();
            } catch (error) {
                console.error('[RFID] Monitor loop error:', error);
            }
            await this.sleep(this.checkInterval);
        }
    }

    async checkAllSessions() {
        if (this.activeSessions.size === 0) return;

        const status = await getHardwareStatus();

        for (const [sessionId, session] of this.activeSessions.entries()) {
            // If RFID not present, mark session for invalidation
            if (!status.present) {
                console.warn(`[RFID] Session ${sessionId} invalidated - RFID removed`);
                session.invalid = true;
                session.invalidReason = 'RFID_REMOVED';
            }

            session.lastCheck = Date.now();
        }
    }

    isSessionValid(sessionId) {
        const session = this.activeSessions.get(sessionId);
        return session && !session.invalid;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Global session monitor instance
const sessionMonitor = new RFIDSessionMonitor();

// Start monitor if enabled
if (RFID_CHECK_ENABLED) {
    sessionMonitor.start();
}

/**
 * Middleware: Validate session has valid RFID
 */
function requireValidRFIDSession(req, res, next) {
    if (!RFID_CHECK_ENABLED) {
        return next();
    }

    const sessionId = req.sessionID || req.session?.id;

    if (!sessionId) {
        return res.status(401).json({
            success: false,
            error: 'No session found'
        });
    }

    if (!sessionMonitor.isSessionValid(sessionId)) {
        return res.status(403).json({
            success: false,
            error: 'Session invalidated - RFID removed',
            rfidRequired: true,
            message: 'Your RFID card has been removed. Please re-authenticate.'
        });
    }

    next();
}

module.exports = {
    // Core functions
    getHardwareStatus,
    checkRFIDPresence,
    verifyRFIDForLogin,

    // Middleware
    requireRFIDPresence,
    checkRFIDMiddleware,
    requireValidRFIDSession,

    // Session management
    sessionMonitor,

    // Config
    RFID_CHECK_ENABLED
};
