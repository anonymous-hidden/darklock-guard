/**
 * Session Cleanup Scheduler
 * Prevents unbounded growth of session store
 */

const { sessionStore } = require('./security-utils');

// Session expiry time (24 hours)
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

// Cleanup interval (15 minutes)
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

let cleanupInterval = null;

/**
 * Clean expired sessions from the store
 * @returns {number} Number of sessions cleaned
 */
function cleanExpiredSessions() {
    if (!sessionStore || typeof sessionStore.entries !== 'function') {
        return 0;
    }

    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of sessionStore.entries()) {
        // Check if session is expired or revoked
        const isExpired = session.createdAt && (now - session.createdAt > SESSION_EXPIRY_MS);
        const isRevoked = session.revoked === true;
        const isExplicitlyExpired = session.expiresAt && new Date(session.expiresAt) < new Date();

        if (isExpired || isRevoked || isExplicitlyExpired) {
            sessionStore.delete(sessionId);
            cleaned++;
        }
    }

    return cleaned;
}

/**
 * Start the cleanup scheduler
 * @param {Object} logger - Logger instance
 */
function startCleanupScheduler(logger = console) {
    if (cleanupInterval) {
        return; // Already running
    }

    // Run initial cleanup
    const initialCleaned = cleanExpiredSessions();
    if (initialCleaned > 0) {
        logger.info?.(`Session cleanup: removed ${initialCleaned} expired session(s)`);
    }

    // Schedule periodic cleanup
    cleanupInterval = setInterval(() => {
        const cleaned = cleanExpiredSessions();
        if (cleaned > 0) {
            logger.debug?.(`Session cleanup: removed ${cleaned} expired session(s)`);
        }
    }, CLEANUP_INTERVAL_MS);

    // Don't prevent process exit
    cleanupInterval.unref();

    logger.info?.('✅ Session cleanup scheduler started');
}

/**
 * Stop the cleanup scheduler
 */
function stopCleanupScheduler() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}

/**
 * Get session store statistics
 */
function getSessionStats() {
    if (!sessionStore) {
        return { total: 0, active: 0, revoked: 0 };
    }

    let active = 0;
    let revoked = 0;

    for (const session of sessionStore.values()) {
        if (session.revoked) {
            revoked++;
        } else {
            active++;
        }
    }

    return {
        total: sessionStore.size,
        active,
        revoked
    };
}

module.exports = {
    cleanExpiredSessions,
    startCleanupScheduler,
    stopCleanupScheduler,
    getSessionStats,
    SESSION_EXPIRY_MS,
    CLEANUP_INTERVAL_MS
};
