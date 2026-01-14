/**
 * Dashboard Bootstrap - Final Express Wiring
 * This module initializes and wires all dashboard components
 */

const express = require('express');
const http = require('http');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');

// Modular components
const { registerRoutes } = require('./routes');
const { initializeServices } = require('./services');
const WebSocketHandler = require('./websocket/handler');
const middleware = require('./middleware');

/**
 * Bootstrap the dashboard with all components wired
 * @param {SecurityDashboard} dashboard - The main dashboard instance
 */
async function bootstrap(dashboard) {
    const { app, bot } = dashboard;
    const logger = bot.logger || console;

    // ═══════════════════════════════════════════════════════════════════
    // 1. MIDDLEWARE ORDER (Critical - Order Matters!)
    // ═══════════════════════════════════════════════════════════════════

    // 1.1 Trust proxy (required for Render/Heroku/etc)
    app.set('trust proxy', 1);

    // 1.2 Raw body for Stripe webhooks (MUST be before JSON parser)
    app.post('/webhooks/stripe', express.raw({ type: 'application/json' }));

    // 1.3 Security headers via Helmet
    app.use(helmet({
        contentSecurityPolicy: false, // Handled separately for dynamic WSS
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
    }));

    // 1.4 Dynamic CSP with WebSocket URL
    app.use(middleware.dynamicCSP());

    // 1.5 CORS
    const corsOrigin = process.env.DASHBOARD_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3001';
    app.use(cors({
        origin: corsOrigin,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token']
    }));

    // 1.6 Cookie parser
    app.use(cookieParser());

    // 1.7 JSON body parser (skip webhooks)
    app.use((req, res, next) => {
        if (req.path.startsWith('/webhooks/')) return next();
        if (req.path.startsWith('/api/upload/')) return next();
        return express.json({ limit: '256kb' })(req, res, next);
    });

    // 1.8 URL encoded bodies
    app.use(express.urlencoded({ extended: true, limit: '256kb' }));

    // 1.9 UTF-8 charset enforcement
    app.use(middleware.utf8Charset());

    // 1.10 Cache prevention for protected routes
    app.use(middleware.noCacheProtected());

    // 1.11 Request ID and timing
    app.use(middleware.requestId());

    // 1.12 Rate limiting
    app.use('/api/', middleware.apiRateLimit());
    app.use('/auth/', middleware.authRateLimit());

    // ═══════════════════════════════════════════════════════════════════
    // 2. SERVICES INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════

    try {
        dashboard.services = await initializeServices(bot, bot.database);
        logger.info('✅ Dashboard services initialized');
    } catch (err) {
        logger.error('Failed to initialize services:', err);
        dashboard.services = {};
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3. ROUTE REGISTRATION
    // ═══════════════════════════════════════════════════════════════════

    // Attach shared context to dashboard for routes
    dashboard.authMiddleware = middleware.authenticateToken(dashboard);
    dashboard.requireGuildAccess = middleware.requireGuildAccess(dashboard);
    dashboard.validateCSRF = middleware.validateCSRF();

    // Register all modular routes
    registerRoutes(app, dashboard);
    logger.info('✅ API routes registered');

    // ═══════════════════════════════════════════════════════════════════
    // 4. STATIC FILES
    // ═══════════════════════════════════════════════════════════════════

    const websitePath = path.join(__dirname, '../../website');
    app.use(express.static(websitePath, {
        maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
        etag: true
    }));

    // Uploads directory
    app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

    // ═══════════════════════════════════════════════════════════════════
    // 5. ERROR HANDLING
    // ═══════════════════════════════════════════════════════════════════

    // 404 handler
    app.use((req, res, next) => {
        if (req.path.startsWith('/api/')) {
            return res.status(404).json({ error: 'Endpoint not found' });
        }
        next();
    });

    // Global error handler
    app.use((err, req, res, next) => {
        logger.error('Express error:', err);

        // Don't leak stack traces in production
        const isDev = process.env.NODE_ENV !== 'production';
        
        res.status(err.status || 500).json({
            error: err.message || 'Internal server error',
            ...(isDev && { stack: err.stack })
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // 6. HTTP SERVER + WEBSOCKET
    // ═══════════════════════════════════════════════════════════════════

    const server = http.createServer(app);
    dashboard.server = server;

    // Initialize WebSocket handler
    dashboard.wsHandler = new WebSocketHandler(dashboard);
    dashboard.wsHandler.initialize(server);
    logger.info('✅ WebSocket server attached');

    return server;
}

/**
 * Start the dashboard server
 * @param {SecurityDashboard} dashboard
 * @param {number} port
 */
async function startServer(dashboard, port) {
    const server = await bootstrap(dashboard);
    
    return new Promise((resolve, reject) => {
        server.listen(port, () => {
            dashboard.bot.logger?.info(`✅ Dashboard running on port ${port}`);
            resolve(server);
        });

        server.on('error', (err) => {
            dashboard.bot.logger?.error('Server error:', err);
            reject(err);
        });
    });
}

module.exports = { bootstrap, startServer };
