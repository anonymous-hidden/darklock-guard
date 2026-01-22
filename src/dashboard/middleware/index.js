/**
 * Dashboard Middleware Index
 * 
 * ARCHITECTURE DECISION (Phase 5 Decomposition):
 * Central export point for all dashboard middleware.
 * 
 * Usage:
 *   const { createAuthMiddleware, createSecurityMiddleware } = require('./middleware');
 *   const auth = createAuthMiddleware({ bot });
 *   app.use('/api', auth.authenticateToken, ...);
 */

const { createAuthMiddleware } = require('./auth');
const { createRateLimitMiddleware } = require('./rateLimit');
const { createSecurityMiddleware } = require('./security');
const validation = require('./validation');

module.exports = {
    createAuthMiddleware,
    createRateLimitMiddleware,
    createSecurityMiddleware,
    validation,
    // Re-export validation helpers directly for convenience
    ...validation
};
