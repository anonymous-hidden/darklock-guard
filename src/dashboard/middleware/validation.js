/**
 * Input Validation Helpers for Dashboard
 * 
 * ARCHITECTURE DECISION (Phase 5 Decomposition):
 * Extracted from monolithic dashboard.js to improve maintainability.
 * Centralized input validation and sanitization.
 */

/**
 * Validate Discord Guild ID format
 * @param {string} guildId - Guild ID to validate
 * @returns {string} Validated guild ID
 * @throws {Error} If invalid format
 */
function validateGuildId(guildId) {
    if (!guildId || typeof guildId !== 'string' || !/^\d{17,19}$/.test(guildId)) {
        throw new Error('Invalid guild ID format');
    }
    return guildId;
}

/**
 * Validate Discord User ID format
 * @param {string} userId - User ID to validate
 * @returns {string} Validated user ID
 * @throws {Error} If invalid format
 */
function validateUserId(userId) {
    if (!userId || typeof userId !== 'string' || !/^\d{17,19}$/.test(userId)) {
        throw new Error('Invalid user ID format');
    }
    return userId;
}

/**
 * Validate Discord Channel ID format
 * @param {string} channelId - Channel ID to validate
 * @returns {string} Validated channel ID
 * @throws {Error} If invalid format
 */
function validateChannelId(channelId) {
    if (!channelId || typeof channelId !== 'string' || !/^\d{17,19}$/.test(channelId)) {
        throw new Error('Invalid channel ID format');
    }
    return channelId;
}

/**
 * Validate and constrain a limit parameter
 * @param {*} limit - Input limit value
 * @param {number} max - Maximum allowed value
 * @returns {number} Validated limit
 */
function validateLimit(limit, max = 1000) {
    const parsed = parseInt(limit);
    if (isNaN(parsed) || parsed < 1 || parsed > max) {
        return Math.min(100, max);
    }
    return parsed;
}

/**
 * Validate pagination offset
 * @param {*} offset - Input offset value
 * @returns {number} Validated offset
 */
function validateOffset(offset) {
    const parsed = parseInt(offset);
    if (isNaN(parsed) || parsed < 0) {
        return 0;
    }
    return parsed;
}

/**
 * Sanitize string input (remove dangerous chars, limit length)
 * @param {*} str - Input string
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized string
 */
function sanitizeString(str, maxLength = 2000) {
    if (typeof str !== 'string') return '';
    return str.slice(0, maxLength).replace(/[<>]/g, '');
}

/**
 * Sanitize string for HTML output
 * @param {*} str - Input string
 * @returns {string} HTML-safe string
 */
function sanitizeHTML(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Safe JSON parse with fallback
 * @param {string} str - JSON string to parse
 * @param {*} fallback - Fallback value on parse failure
 * @returns {*} Parsed value or fallback
 */
function safeJsonParse(str, fallback = null) {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

/**
 * Validate ISO date string
 * @param {string} dateStr - Date string to validate
 * @returns {Date|null} Parsed Date or null if invalid
 */
function validateDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
}

/**
 * Validate Stripe session ID format
 * @param {string} sessionId - Stripe session ID
 * @returns {boolean} True if valid format
 */
function validateStripeSessionId(sessionId) {
    return sessionId && /^cs_[a-zA-Z0-9_-]+$/.test(sessionId);
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid format
 */
function validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Express middleware for validating guildId in params
 */
function requireValidGuildId(req, res, next) {
    try {
        const guildId = req.params.guildId || req.query.guildId || req.body?.guildId;
        validateGuildId(guildId);
        req.validatedGuildId = guildId;
        next();
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
}

/**
 * Express middleware for validating userId in params
 */
function requireValidUserId(req, res, next) {
    try {
        const userId = req.params.userId || req.query.userId || req.body?.userId;
        validateUserId(userId);
        req.validatedUserId = userId;
        next();
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
}

module.exports = {
    validateGuildId,
    validateUserId,
    validateChannelId,
    validateLimit,
    validateOffset,
    sanitizeString,
    sanitizeHTML,
    safeJsonParse,
    validateDate,
    validateStripeSessionId,
    validateEmail,
    requireValidGuildId,
    requireValidUserId
};
