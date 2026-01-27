/**
 * Debug Logger Utility
 * Conditionally logs based on debug mode setting from admin panel
 */

const db = require('./database');

let debugModeCache = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 5000; // 5 seconds cache

/**
 * Get debug mode setting (cached for performance)
 */
async function isDebugEnabled() {
    const now = Date.now();
    
    // Return cached value if still fresh
    if (debugModeCache !== null && (now - lastCacheUpdate) < CACHE_TTL) {
        return debugModeCache;
    }
    
    try {
        const setting = await db.get(`SELECT value FROM admin_settings WHERE key = 'debug_mode'`);
        debugModeCache = setting?.value === 'true';
        lastCacheUpdate = now;
        return debugModeCache;
    } catch (err) {
        // If we can't check the setting, default to disabled
        return false;
    }
}

/**
 * Clear the debug mode cache (call this when settings are updated)
 */
function clearDebugCache() {
    debugModeCache = null;
    lastCacheUpdate = 0;
}

/**
 * Debug log - only shows when debug mode is enabled
 */
async function debugLog(...args) {
    if (await isDebugEnabled()) {
        console.log('[DEBUG]', ...args);
    }
}

/**
 * Info log - only shows when debug mode is enabled
 */
async function debugInfo(...args) {
    if (await isDebugEnabled()) {
        console.info('[INFO]', ...args);
    }
}

/**
 * Warn log - always shows (important warnings)
 */
function debugWarn(...args) {
    console.warn('[WARN]', ...args);
}

/**
 * Error log - always shows (critical errors)
 */
function debugError(...args) {
    console.error('[ERROR]', ...args);
}

/**
 * Synchronous check (uses cache only, doesn't wait for DB)
 * Use this in performance-critical paths
 */
function isDebugEnabledSync() {
    return debugModeCache === true;
}

/**
 * Conditional log wrapper for existing console.log statements
 * Usage: Replace console.log with debugLogger.log
 */
const logger = {
    log: debugLog,
    info: debugInfo,
    warn: debugWarn,
    error: debugError,
    debug: debugLog,
    isEnabled: isDebugEnabled,
    isEnabledSync: isDebugEnabledSync,
    clearCache: clearDebugCache
};

module.exports = logger;
