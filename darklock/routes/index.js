/**
 * Darklock Platform - Route Index
 * Exports all platform routes for easy importing
 */

const authRoutes = require('./auth');
const { router: dashboardRoutes, requireAuth } = require('./dashboard');
const profileRoutes = require('./profile');

module.exports = {
    authRoutes,
    dashboardRoutes,
    profileRoutes,
    requireAuth
};
