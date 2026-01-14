/**
 * Routes Index
 * Aggregates all route modules for the dashboard
 */

const AuthRoutes = require('./auth');
const GuildRoutes = require('./guild');
const ModerationRoutes = require('./moderation');
const TicketsRoutes = require('./tickets');
const AnalyticsRoutes = require('./analytics');
const SettingsRoutes = require('./settings');
const BillingRoutes = require('./billing');
const createBackupRoutes = require('./backups');

/**
 * Helper function to get router from class or function
 * @param {Function|Class} RouteModule - Route module (class or factory function)
 * @param {Object} dashboard - Dashboard instance
 * @returns {Router} Express router
 */
function getRouter(RouteModule, dashboard) {
    // If it's a class with getRouter method
    if (RouteModule.prototype && RouteModule.prototype.getRouter) {
        const instance = new RouteModule(dashboard);
        return instance.getRouter();
    }
    // If it's a factory function that returns a router
    return RouteModule(dashboard);
}

/**
 * Register all routes with the Express app
 * @param {Express} app - Express application
 * @param {Object} dashboard - Dashboard instance with bot, db, and middleware
 */
function registerRoutes(app, dashboard) {
    // Import security utils for brute force check
    const { checkBruteForce, recordFailedLogin, recordSuccessfulLogin } = require('../security-utils');
    const { createAuthMiddleware } = require('../middleware/auth');
    
    // Ensure middleware is attached to dashboard
    if (!dashboard.middleware) {
        const authMiddleware = createAuthMiddleware(dashboard);
        dashboard.middleware = {
            ...authMiddleware,
            checkBruteForce: (req, res, next) => {
                const identifier = req.ip || req.body?.username || 'unknown';
                const bruteCheck = checkBruteForce(identifier);
                if (bruteCheck.blocked) {
                    return res.status(429).json({ 
                        error: 'Too many failed attempts. Please try again later.',
                        retryAfter: bruteCheck.remainingTime
                    });
                }
                // Attach helpers to request for use in login handler
                req.bruteForce = {
                    recordFailed: () => recordFailedLogin(identifier),
                    recordSuccess: () => recordSuccessfulLogin(identifier)
                };
                next();
            }
        };
    }

    // Legacy middleware references for backwards compatibility
    if (!dashboard.authMiddleware) {
        dashboard.authMiddleware = dashboard.middleware.authenticateToken;
        dashboard.requireGuildAccess = dashboard.middleware.requireGuildAdmin;
        dashboard.validateCSRF = dashboard.middleware.validateCSRF;
    }

    // Ensure db reference is available
    if (!dashboard.db && dashboard.bot?.database?.db) {
        dashboard.db = dashboard.bot.database.db;
        
        // Add async wrappers if not present
        if (!dashboard.db.runAsync) {
            const util = require('util');
            dashboard.db.runAsync = util.promisify(dashboard.db.run.bind(dashboard.db));
            dashboard.db.getAsync = util.promisify(dashboard.db.get.bind(dashboard.db));
            dashboard.db.allAsync = util.promisify(dashboard.db.all.bind(dashboard.db));
        }
    }

    // Authentication routes (login, logout, OAuth)
    app.use('/api', getRouter(AuthRoutes, dashboard));
    
    // Guild configuration and settings
    app.use('/api', getRouter(GuildRoutes, dashboard));
    
    // Moderation endpoints (warnings, bans, logs)
    app.use('/api', getRouter(ModerationRoutes, dashboard));
    
    // Ticket system endpoints
    app.use('/api', getRouter(TicketsRoutes, dashboard));
    
    // Analytics and statistics
    app.use('/api', getRouter(AnalyticsRoutes, dashboard));
    
    // Settings and feature toggles (new)
    app.use('/api', getRouter(SettingsRoutes, dashboard));
    
    // Billing and subscriptions (new)
    app.use('/api', getRouter(BillingRoutes, dashboard));
    
    // Server backups management (factory function)
    app.use('/api', createBackupRoutes(dashboard));

    dashboard.bot.logger?.info('✅ All API routes registered');
}

module.exports = {
    registerRoutes,
    AuthRoutes,
    GuildRoutes,
    ModerationRoutes,
    TicketsRoutes,
    AnalyticsRoutes,
    SettingsRoutes,
    BillingRoutes,
    createBackupRoutes
};
