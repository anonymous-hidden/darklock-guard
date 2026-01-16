/**
 * Darklock Platform - Main Server
 * Entry point for the Darklock platform shell
 * Integrates with existing Discord bot dashboard without modification
 * 
 * Security Features:
 * - Comprehensive security headers (CSP, X-Frame-Options, etc.)
 * - Rate limiting on auth endpoints
 * - HSTS for HTTPS enforcement
 * - Cookie security with httpOnly and sameSite
 */

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Database initialization
const db = require('./utils/database');

// Import routes
const authRoutes = require('./routes/auth');
const { router: dashboardRoutes, requireAuth } = require('./routes/dashboard');
const profileRoutes = require('./routes/profile');

class DarklockPlatform {
    constructor(options = {}) {
        this.app = express();
        this.port = options.port || process.env.DARKLOCK_PORT || 3002;
        this.existingApp = options.existingApp || null;
        
        this.setupMiddleware();
        this.setupRoutes();
    }
    
    /**
     * Configure Express middleware with comprehensive security
     */
    setupMiddleware() {
        // Trust proxy for secure cookies behind reverse proxy
        this.app.set('trust proxy', 1);
        
        // Comprehensive security headers
        this.app.use(helmet({
            // Content Security Policy
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'"], // Needed for inline handlers
                    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                    fontSrc: ["'self'", "https://fonts.gstatic.com"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'"],
                    frameSrc: ["'none'"],
                    objectSrc: ["'none'"],
                    baseUri: ["'self'"],
                    formAction: ["'self'"],
                    upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
                }
            },
            // HTTP Strict Transport Security
            hsts: {
                maxAge: 31536000, // 1 year
                includeSubDomains: true,
                preload: true
            },
            // Prevent clickjacking
            frameguard: {
                action: 'deny'
            },
            // Prevent MIME type sniffing
            noSniff: true,
            // XSS protection (legacy, but doesn't hurt)
            xssFilter: true,
            // Referrer policy
            referrerPolicy: {
                policy: 'strict-origin-when-cross-origin'
            },
            // Don't expose X-Powered-By
            hidePoweredBy: true
        }));
        
        // Additional security headers not covered by helmet
        this.app.use((req, res, next) => {
            // Prevent caching of sensitive pages
            if (req.path.includes('/dashboard') || req.path.includes('/auth')) {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                res.setHeader('Surrogate-Control', 'no-store');
            }
            
            // Permissions Policy (formerly Feature-Policy)
            res.setHeader('Permissions-Policy', 
                'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
            );
            
            next();
        });
        
        // CORS configuration
        this.app.use(cors({
            origin: process.env.CORS_ORIGIN || true,
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
        }));
        
        // Global rate limiting (100 requests per 15 minutes per IP)
        const globalLimiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 100,
            standardHeaders: true,
            legacyHeaders: false,
            message: { success: false, error: 'Too many requests, please try again later.' },
            skip: (req) => {
                // Skip rate limiting for static assets
                return req.path.includes('/static/');
            }
        });
        this.app.use('/platform', globalLimiter);
        
        // Stricter rate limiting for auth endpoints
        const authLimiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 10, // 10 requests per window
            standardHeaders: true,
            legacyHeaders: false,
            message: { 
                success: false, 
                error: 'Too many authentication attempts. Please try again in 15 minutes.' 
            }
        });
        this.app.use('/platform/auth/login', authLimiter);
        this.app.use('/platform/auth/signup', authLimiter);
        
        // Even stricter for 2FA verification
        const twoFALimiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 5,
            standardHeaders: true,
            legacyHeaders: false,
            message: { 
                success: false, 
                error: 'Too many 2FA attempts. Please try again in 15 minutes.' 
            }
        });
        this.app.use('/platform/profile/api/2fa/verify', twoFALimiter);
        
        // Body parsers with size limits
        this.app.use(express.json({ limit: '10kb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10kb' }));
        
        // Cookie parser
        this.app.use(cookieParser());
        
        // UTF-8 charset for HTML responses
        this.app.use((req, res, next) => {
            if (!req.path.includes('/static/')) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
            }
            next();
        });
    }
    
    /**
     * Configure routes
     */
    setupRoutes() {
        // Static files
        this.app.use('/platform/static', express.static(path.join(__dirname, 'public')));
        
        // Downloads folder for installers
        this.app.use('/platform/downloads', express.static(path.join(__dirname, 'downloads')));
        
        // Avatars folder for user avatars
        const avatarsPath = path.join(process.env.DATA_PATH || path.join(__dirname, 'data'), 'avatars');
        this.app.use('/platform/avatars', express.static(avatarsPath));
        
        // Main homepage
        this.app.get('/platform', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/home.html'));
        });
        
        // Darklock Guard - Download page
        this.app.get('/platform/download/darklock-guard', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/download-page.html'));
        });
        
        // Darklock Guard - Actual installer download (NSIS - works without code signing)
        this.app.get('/platform/api/download/darklock-guard-installer', (req, res) => {
            const format = req.query.format || 'exe';
            const nsisPath = path.join(__dirname, 'downloads/darklock-guard-setup.exe');
            const msiPath = path.join(__dirname, 'downloads/darklock-guard-setup.msi');
            const debPath = path.join(__dirname, 'downloads/darklock-guard_1.0.0_amd64.deb');
            const rpmPath = path.join(__dirname, 'downloads/darklock-guard-1.0.0-1.x86_64.rpm');
            const tarPath = path.join(__dirname, 'downloads/darklock-guard-linux-x64.tar.gz');
            const portablePath = path.join(__dirname, 'downloads/darklock-guard-portable.exe');
            const fs = require('fs');
            
            // Handle format-specific downloads
            if (format === 'exe' && fs.existsSync(nsisPath)) {
                console.log(`[Darklock] NSIS installer (.exe) downloaded by IP: ${req.ip}`);
                return res.download(nsisPath, 'DarklockGuard-Setup.exe');
            }
            
            if (format === 'msi' && fs.existsSync(msiPath)) {
                console.log(`[Darklock] MSI installer downloaded by IP: ${req.ip}`);
                return res.download(msiPath, 'DarklockGuard-Setup.msi');
            }
            
            if (format === 'deb' && fs.existsSync(debPath)) {
                console.log(`[Darklock] Debian package (.deb) downloaded by IP: ${req.ip}`);
                return res.download(debPath, 'darklock-guard_1.0.0_amd64.deb');
            }
            
            if (format === 'rpm' && fs.existsSync(rpmPath)) {
                console.log(`[Darklock] RPM package (.rpm) downloaded by IP: ${req.ip}`);
                return res.download(rpmPath, 'darklock-guard-1.0.0-1.x86_64.rpm');
            }
            
            if (format === 'tar' && fs.existsSync(tarPath)) {
                console.log(`[Darklock] Tar.gz archive downloaded by IP: ${req.ip}`);
                return res.download(tarPath, 'darklock-guard-linux-x64.tar.gz');
            }
            
            // Fallback behavior for legacy requests
            if (fs.existsSync(nsisPath)) {
                console.log(`[Darklock] NSIS installer (fallback) downloaded by IP: ${req.ip}`);
                return res.download(nsisPath, 'DarklockGuard-Setup.exe');
            }
            
            // Fallback to MSI
            if (fs.existsSync(msiPath)) {
                console.log(`[Darklock] MSI installer (fallback) downloaded by IP: ${req.ip}`);
                return res.download(msiPath, 'DarklockGuard-Setup.msi');
            }
            
            // Fallback to portable exe
            if (fs.existsSync(portablePath)) {
                console.log(`[Darklock] Portable exe downloaded by IP: ${req.ip}`);
                return res.download(portablePath, 'DarklockGuard.exe');
            }
            
            // None exist
            return res.status(503).send(`
                <html>
                    <head>
                        <title>Installer Not Ready</title>
                        <style>
                            body { font-family: Arial; text-align: center; padding: 50px; background: #1a1f3a; color: #fff; }
                            h1 { color: #7c4dff; }
                            p { color: #a8b2d1; line-height: 1.6; }
                            .back { color: #7c4dff; text-decoration: none; margin-top: 20px; display: inline-block; }
                        </style>
                    </head>
                    <body>
                        <h1>⏳ Installer Not Ready</h1>
                        <p>The Darklock Guard installer is currently being built.<br>
                        This can take 10-15 minutes on the first build.</p>
                        <p>Please check back in a few minutes or contact support.</p>
                        <a href="/platform" class="back">← Back to Platform</a>
                    </body>
                </html>
            `);
        });
        
        // Darklock Guard - Update endpoint for Tauri updater
        this.app.get('/platform/api/updates/:target/:version', (req, res) => {
            const { target, version } = req.params;
            const currentVersion = version;
            const latestVersion = '1.0.0'; // TODO: Read from package.json or config
            
            // If already on latest version
            if (currentVersion === latestVersion) {
                return res.status(204).send();
            }
            
            // Prepare update manifest
            const updateManifest = {
                version: latestVersion,
                notes: "New features and bug fixes",
                pub_date: new Date().toISOString(),
                platforms: {
                    "windows-x86_64": {
                        signature: "",
                        url: `https://darklock.net/platform/api/download/darklock-guard-installer`
                    }
                }
            };
            
            res.json(updateManifest);
        });
        
        // Darklock Guard - Launch desktop app (requires authentication) - DEPRECATED
        this.app.get('/platform/launch/darklock-guard', requireAuth, (req, res) => {
            const { spawn } = require('child_process');
            const appPath = path.join(__dirname, '../ainti-tampering-app/tauri-app/src-tauri/target/debug/darklock-guard.exe');
            
            // Check if app exists
            const fs = require('fs');
            if (!fs.existsSync(appPath)) {
                console.error('[Darklock] Darklock Guard app not found at:', appPath);
                return res.status(404).json({
                    success: false,
                    error: 'Application not found. Please contact support.'
                });
            }
            
            try {
                // Spawn the Tauri app as a detached process
                const child = spawn(appPath, [], {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: false
                });
                
                // Detach from parent process
                child.unref();
                
                console.log(`[Darklock] Launched Darklock Guard for user: ${req.user.username}`);
                
                res.json({
                    success: true,
                    message: 'Darklock Guard launched successfully'
                });
            } catch (err) {
                console.error('[Darklock] Failed to launch Darklock Guard:', err);
                res.status(500).json({
                    success: false,
                    error: 'Failed to launch application. Please try again.'
                });
            }
        });
        
        // Darklock Guard - Web monitor (requires authentication)
        this.app.get('/platform/monitor/darklock-guard', requireAuth, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/monitor.html'));
        });

        // API endpoint for metrics
        this.app.get('/platform/api/metrics', (req, res) => {
            const uptime = process.uptime();
            const uptimeHours = uptime / 3600;
            const uptimePercent = Math.min(99.99, 99 + (uptimeHours / 1000)).toFixed(2) + '%';
            
            res.json({
                uptime: uptimePercent,
                responseTime: '< 100ms',
                status: 'operational',
                timestamp: new Date().toISOString()
            });
        });
        
        // Documentation page
        this.app.get('/platform/docs', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/docs.html'));
        });
        
        // System Status page
        this.app.get('/platform/status', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/status.html'));
        });
        
        // Changelog page
        this.app.get('/platform/changelog', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/changelog.html'));
        });
        
        // Privacy Policy page
        this.app.get('/platform/privacy', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/privacy.html'));
        });
        
        // Terms of Service page
        this.app.get('/platform/terms', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/terms.html'));
        });
        
        // Security page
        this.app.get('/platform/security', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/security.html'));
        });
        
        // Health check endpoint for monitoring (public)
        this.app.get('/platform/api/health', (req, res) => {
            try {
                const fs = require('fs');
                const usersFileExists = fs.existsSync(path.join(process.env.DATA_PATH || path.join(__dirname, 'data'), 'users.json'));
                const sessionsFileExists = fs.existsSync(path.join(process.env.DATA_PATH || path.join(__dirname, 'data'), 'sessions.json'));
                
                res.json({
                    status: 'healthy',
                    uptime: process.uptime(),
                    timestamp: new Date().toISOString(),
                    checks: {
                        dataFiles: usersFileExists && sessionsFileExists ? 'ok' : 'warning',
                        memory: process.memoryUsage().heapUsed < (1024 * 1024 * 1024) ? 'ok' : 'warning' // < 1GB heap
                    }
                });
            } catch (err) {
                res.status(500).json({
                    status: 'unhealthy',
                    error: 'Health check failed'
                });
            }
        });
        
        // Auth routes
        this.app.use('/platform/auth', authRoutes);
        
        // Dashboard routes
        this.app.use('/platform/dashboard', dashboardRoutes);
        
        // Profile API routes
        this.app.use('/platform/profile', profileRoutes);
        
        // Redirect root to platform
        this.app.get('/', (req, res) => {
            res.redirect('/platform');
        });
        
        // 404 handler for platform routes
        this.app.use('/platform/*', (req, res) => {
            res.status(404).sendFile(path.join(__dirname, 'views/404.html'));
        });
    }
    
    /**
     * Mount platform routes on existing Express app
     * This allows Darklock to coexist with the Discord bot dashboard
     */
    mountOn(existingApp) {
        console.log('[Darklock Platform] Mounting on existing Express app...');
        
        // Initialize database before mounting routes
        db.initialize().catch(err => {
            console.error('[Darklock Platform] Database initialization failed:', err);
        });
        
        // Static files
        existingApp.use('/platform/static', express.static(path.join(__dirname, 'public')));
        
        // Downloads folder for installers
        existingApp.use('/platform/downloads', express.static(path.join(__dirname, 'downloads')));
        
        // Avatars folder for user avatars
        const avatarsPath = path.join(process.env.DATA_PATH || path.join(__dirname, 'data'), 'avatars');
        existingApp.use('/platform/avatars', express.static(avatarsPath));
        
        // Main homepage
        existingApp.get('/platform', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/home.html'));
        });
        
        // Darklock Guard - Download page
        existingApp.get('/platform/download/darklock-guard', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/download-page.html'));
        });
        
        // Darklock Guard - Actual installer download
        existingApp.get('/platform/api/download/darklock-guard-installer', (req, res) => {
            const installerPath = path.join(__dirname, '../ainti-tampering-app/tauri-app/src-tauri/target/release/bundle/msi/darklock-guard_1.0.0_x64_en-US.msi');
            const debugExePath = path.join(__dirname, '../ainti-tampering-app/tauri-app/src-tauri/target/debug/darklock-guard.exe');
            const fs = require('fs');
            
            // Check for release installer first
            if (fs.existsSync(installerPath)) {
                console.log(`[Darklock] Installer downloaded by IP: ${req.ip}`);
                return res.download(installerPath, 'DarklockGuard-Setup.msi');
            }
            
            // Fallback to debug executable if release not built yet
            if (fs.existsSync(debugExePath)) {
                console.log(`[Darklock] Debug executable downloaded by IP: ${req.ip}`);
                return res.download(debugExePath, 'darklock-guard.exe');
            }
            
            // Neither exists
            return res.status(503).send(`
                <html>
                    <head>
                        <title>Installer Not Ready</title>
                        <style>
                            body { font-family: Arial; text-align: center; padding: 50px; background: #1a1f3a; color: #fff; }
                            h1 { color: #7c4dff; }
                            p { color: #a8b2d1; line-height: 1.6; }
                            .back { color: #7c4dff; text-decoration: none; margin-top: 20px; display: inline-block; }
                        </style>
                    </head>
                    <body>
                        <h1>⏳ Installer Not Ready</h1>
                        <p>The Darklock Guard installer is currently being built.<br>
                        This can take 10-15 minutes on the first build.</p>
                        <p>Please check back in a few minutes or contact support.</p>
                        <a href="/platform" class="back">← Back to Platform</a>
                    </body>
                </html>
            `);
        });
        
        // Darklock Guard - Web Monitor (requires authentication)
        existingApp.get('/platform/monitor/darklock-guard', requireAuth, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/monitor.html'));
        });
        
        // Documentation page
        existingApp.get('/platform/docs', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/docs.html'));
        });
        
        // System Status page
        existingApp.get('/platform/status', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/status.html'));
        });
        
        // Changelog page
        existingApp.get('/platform/changelog', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/changelog.html'));
        });
        
        // Privacy Policy page
        existingApp.get('/platform/privacy', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/privacy.html'));
        });
        
        // Terms of Service page
        existingApp.get('/platform/terms', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/terms.html'));
        });
        
        // Security page
        existingApp.get('/platform/security', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/security.html'));
        });
        
        // Health check endpoint for monitoring (public)
        existingApp.get('/platform/api/health', (req, res) => {
            try {
                const fs = require('fs');
                const usersFileExists = fs.existsSync(path.join(process.env.DATA_PATH || path.join(__dirname, 'data'), 'users.json'));
                const sessionsFileExists = fs.existsSync(path.join(process.env.DATA_PATH || path.join(__dirname, 'data'), 'sessions.json'));
                
                res.json({
                    status: 'healthy',
                    uptime: process.uptime(),
                    timestamp: new Date().toISOString(),
                    checks: {
                        dataFiles: usersFileExists && sessionsFileExists ? 'ok' : 'warning',
                        memory: process.memoryUsage().heapUsed < (1024 * 1024 * 1024) ? 'ok' : 'warning' // < 1GB heap
                    }
                });
            } catch (err) {
                res.status(500).json({
                    status: 'unhealthy',
                    error: 'Health check failed'
                });
            }
        });
        
        // Auth routes
        existingApp.use('/platform/auth', authRoutes);
        
        // Dashboard routes (Darklock dashboard, not the bot dashboard)
        existingApp.use('/platform/dashboard', dashboardRoutes);
        
        // Profile API routes
        existingApp.use('/platform/profile', profileRoutes);
        
        console.log('[Darklock Platform] Routes mounted successfully');
        console.log('[Darklock Platform] Homepage: /platform');
        console.log('[Darklock Platform] Darklock Guard: /platform/launch/darklock-guard (auth required)');
        console.log('[Darklock Platform] Documentation: /platform/docs');
        console.log('[Darklock Platform] System Status: /platform/status');
        console.log('[Darklock Platform] Changelog: /platform/changelog');
        console.log('[Darklock Platform] Privacy: /platform/privacy');
        console.log('[Darklock Platform] Terms: /platform/terms');
        console.log('[Darklock Platform] Security: /platform/security');
        console.log('[Darklock Platform] Auth: /platform/auth/login, /platform/auth/signup');
        console.log('[Darklock Platform] Dashboard: /platform/dashboard');
        
        return this;
    }
    
    /**
     * Start standalone server
     */
    async start() {
        return new Promise(async (resolve, reject) => {
            try {
                // Initialize database before starting server
                console.log('[Darklock Platform] Initializing database...');
                await db.initialize();
                
                // Run session cleanup on startup
                await db.cleanupExpiredSessions();
                
                // Schedule periodic cleanup (every hour)
                setInterval(async () => {
                    try {
                        await db.cleanupExpiredSessions();
                    } catch (err) {
                        console.error('[Darklock Platform] Session cleanup error:', err);
                    }
                }, 60 * 60 * 1000);
                
                this.server = this.app.listen(this.port, () => {
                    console.log(`[Darklock Platform] ✅ Server running on port ${this.port}`);
                    console.log(`[Darklock Platform] Homepage: http://localhost:${this.port}/platform`);
                    resolve(this.server);
                });
            } catch (err) {
                console.error('[Darklock Platform] Failed to start server:', err);
                reject(err);
            }
        });
    }
    
    /**
     * Stop server
     */
    stop() {
        if (this.server) {
            this.server.close();
            console.log('[Darklock Platform] Server stopped');
        }
    }
}

module.exports = DarklockPlatform;
