/**
 * Services Index
 * Aggregates all service modules for the dashboard
 */

const AnalyticsService = require('./AnalyticsService');
const AuditLogService = require('./AuditLogService');

/**
 * Initialize all services
 * @param {Object} bot - Discord bot client
 * @param {Object} db - Database connection
 * @returns {Object} Initialized services
 */
async function initializeServices(bot, db) {
    const services = {
        analytics: new AnalyticsService(bot, db),
        auditLog: new AuditLogService(bot, db)
    };

    // Initialize services that need setup
    await services.auditLog.initialize();

    bot.logger?.info('✅ Dashboard services initialized');

    return services;
}

module.exports = {
    initializeServices,
    AnalyticsService,
    AuditLogService
};
