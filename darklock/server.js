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

// Centralized maintenance module
const maintenance = require('./utils/maintenance');

// Debug logger
const debugLogger = require('./utils/debug-logger');

// Import routes
const authRoutes = require('./routes/auth');
const { router: dashboardRoutes, requireAuth } = require('./routes/dashboard');
const profileRoutes = require('./routes/profile');
const { router: platformRoutes, setDiscordBot: setPlatformDiscordBot } = require('./routes/platform');
const { 
    router: adminAuthRoutes, 
    initializeAdminTables, 
    requireAdminAuth 
} = require('./routes/admin-auth');

// Admin dashboard
const { initializeAdminSchema } = require('./utils/admin-schema');
const adminApiRoutes = require('./routes/admin-api');
const { setDiscordBot } = require('./routes/admin-api');
// v2 Admin API with enhanced features
const adminApiV2Routes = require('./routes/admin-api-v2');
const { setDiscordBot: setDiscordBotV2 } = require('./routes/admin-api-v2');
// v3 Admin API - Full RBAC dashboard with 12 tabs
const adminApiV3Routes = require('./routes/admin-api-v3');
const { setDiscordBot: setDiscordBotV3 } = require('./routes/admin-api-v3');
// Public API routes (maintenance status, health checks)
const publicApiRoutes = require('./routes/public-api');
// RBAC schema initialization
const rbacSchema = require('./utils/rbac-schema');
const { initializeDefaultAdmins } = require('./default-admin');

class DarklockPlatform {
    constructor(options = {}) {
        this.app = express();
        this.port = options.port || process.env.DARKLOCK_PORT || 3002;
        this.existingApp = options.existingApp || null;
        this.discordBot = options.bot || null;
        
        // If bot is provided, set it for admin API routes
        if (this.discordBot) {
            setDiscordBot(this.discordBot);
            setDiscordBotV2(this.discordBot);
            setDiscordBotV3(this.discordBot);
            setPlatformDiscordBot?.(this.discordBot);
        }
        
        this.setupMiddleware();
        this.setupRoutes();
    }
    
    /**
     * Set the Discord bot reference (can be called after initialization)
     * @param {Object} bot - The Discord bot instance
     */
    setBot(bot) {
        this.discordBot = bot;
        setDiscordBot(bot);
        setDiscordBotV2(bot);
        setDiscordBotV3(bot);
        setPlatformDiscordBot?.(bot);
        debugLogger.log('[Darklock Platform] Discord bot reference set');
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
                    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'"], // Needed for inline handlers
                    scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"], // Allow inline event handlers (onclick, etc.)
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
        
        // CORS configuration - SECURE: Explicit allowlist, no reflected origins
        const allowedOrigins = process.env.CORS_ORIGINS 
            ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
            : (process.env.NODE_ENV === 'production' 
                ? ['https://darklock.net', 'https://www.darklock.net'] 
                : ['http://localhost:3000', 'http://127.0.0.1:3000']);
        
        this.app.use(cors({
            origin: function(origin, callback) {
                // Allow requests with no origin (same-origin, Postman, mobile apps)
                if (!origin) return callback(null, true);
                
                // Check against explicit allowlist
                if (allowedOrigins.includes(origin)) {
                    return callback(null, true);
                }
                
                // Reject unknown origins
                console.warn(`[CORS] Blocked request from origin: ${origin}`);
                return callback(new Error('CORS policy: Origin not allowed'), false);
            },
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
        }));
        
        // Global rate limiting (500 requests per 15 minutes per IP - generous for admin dashboard)
        const globalLimiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 500,
            standardHeaders: true,
            legacyHeaders: false,
            message: { success: false, error: 'Too many requests, please try again later.' },
            skip: (req) => {
                // Skip rate limiting only for static assets
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
        
        // Stripe webhook needs raw body - must be before express.json()
        // (premium-success page uses normal JSON parsing)
        this.app.use('/platform/premium/webhook', express.raw({ type: 'application/json' }));
        
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
        
        // Initialize maintenance module with database
        maintenance.init(db);
        
        // Global maintenance mode enforcement - runs BEFORE all routes
        // Uses centralized maintenance configuration
        this.app.use(maintenance.createMiddleware({
            onBlock: (req, res, config) => {
                const fullPath = (req.baseUrl || '') + req.path;
                // For API requests, return 503 JSON
                if (fullPath.startsWith('/api/') || fullPath.startsWith('/platform/api/')) {
                    return res.status(503).json({
                        success: false,
                        error: 'Service temporarily unavailable',
                        maintenance: {
                            enabled: true,
                            message: config.platform.message || config.bot.reason,
                            endTime: config.platform.endTime || config.bot.endTime
                        }
                    });
                }
                // For all other requests, redirect to maintenance page
                const maintenancePath = fullPath.startsWith('/platform') ? '/platform/maintenance' : '/maintenance';
                return res.redirect(maintenancePath);
            }
        }));
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
        
        // Main homepage (with user state)
        this.app.get('/platform', async (req, res) => {
            const token = req.cookies?.darklock_token;
            let userData = null;
            
            if (token) {
                try {
                    const jwt = require('jsonwebtoken');
                    const { requireEnv } = require('./utils/env-validator');
                    const secret = requireEnv('JWT_SECRET');
                    const decoded = jwt.verify(token, secret);
                    
                    // Get user from database
                    const db = require('./utils/database');
                    const user = await db.getUserById(decoded.userId);
                    if (user) {
                        userData = {
                            id: user.id,
                            username: user.username,
                            email: user.email,
                            role: user.role,
                            displayName: user.display_name
                        };
                    }
                } catch (err) {
                    // Token invalid, clear it
                    res.clearCookie('darklock_token');
                }
            }
            
            // Read HTML file and inject user data
            const fs = require('fs');
            const htmlPath = path.join(__dirname, 'views/home.html');
            let html = fs.readFileSync(htmlPath, 'utf8');
            
            // Inject user data into script
            const userScript = `<script>window.DARKLOCK_USER = ${JSON.stringify(userData)};</script>`;
            html = html.replace('</head>', `${userScript}</head>`);
            
            res.send(html);
        });
        
        // Darklock Guard - Download page (Tauri app)
        this.app.get('/platform/download/darklock-guard', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/download-page.html'));
        });
        
        // Darklock Guard - Installer download (new Tauri build + legacy fallback)
        this.app.get('/platform/api/download/darklock-guard-installer', (req, res) => {
            const format = (req.query.format || 'deb').toLowerCase();
            const fs = require('fs');
            const latestVersion = '0.1.0';

            console.log(`[Darklock] Download request for format: ${format} from IP: ${req.ip}`);

            // Try multiple file locations in order of preference
            const fileLocations = {
                deb: [
                    path.join(__dirname, 'downloads/darklock-guard_0.1.0_amd64.deb'),
                    path.join(__dirname, '../guard-v2/target/release/bundle/deb/Darklock Guard_0.1.0_amd64.deb'),
                    path.join(__dirname, 'downloads/darklock-guard-installer.deb')
                ],
                tar: [
                    path.join(__dirname, 'downloads/darklock-guard-linux-portable.tar.gz'),
                    path.join(__dirname, '../guard-v2/target/release/bundle/DarklockGuard-linux-portable.tar.gz')
                ],
                exe: [
                    path.join(__dirname, 'downloads/darklock-guard-setup.exe'),
                    path.join(__dirname, 'downloads/darklocksetup.exe')
                ],
                msi: [
                    path.join(__dirname, 'downloads/darklock-guard-setup.msi'),
                    path.join(__dirname, 'downloads/darklock-guard-installer.msi')
                ]
            };

            // Determine which file type to look for
            let searchFormats = [];
            if (format === 'deb' || format === 'linux') {
                searchFormats = ['deb'];
            } else if (format === 'tar' || format === 'portable') {
                searchFormats = ['tar'];
            } else if (format === 'exe' || format === 'windows') {
                searchFormats = ['exe'];
            } else if (format === 'msi') {
                searchFormats = ['msi'];
            } else {
                // Default to deb
                searchFormats = ['deb'];
            }

            // Try each location for the requested format
            for (const fmt of searchFormats) {
                const locations = fileLocations[fmt] || [];
                for (const filePath of locations) {
                    if (fs.existsSync(filePath)) {
                        const fileName = path.basename(filePath);
                        console.log(`[Darklock] Serving installer: ${fileName}`);
                        return res.download(filePath, fileName);
                    }
                }
            }

            // If installer not found, log available files and return error
            console.error(`[Darklock] Installer not found for format: ${format}`);
            const downloadsDir = path.join(__dirname, 'downloads');
            if (fs.existsSync(downloadsDir)) {
                const files = fs.readdirSync(downloadsDir);
                console.log('[Darklock] Available files in downloads:', files);
            }

            // Return themed helper page
            return res.status(404).send(`
                <html>
                    <head>
                        <title>Installer Not Available</title>
                        <link rel="stylesheet" href="/platform/static/css/main.css">
                        <style>
                            body { background: var(--bg-primary, #0a0a0f); color: var(--text-primary, #f8fafc); display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
                            .card { background: var(--bg-elevated, #111827); border: 1px solid rgba(124,77,255,0.35); padding:32px; border-radius:12px; max-width:560px; text-align:center; box-shadow: 0 20px 60px rgba(0,0,0,0.45); }
                            h1 { margin:0 0 12px; }
                            p { color: var(--text-secondary, #94a3b8); line-height:1.6; margin:10px 0; }
                            code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; }
                            a.btn { display:inline-block; margin-top:16px; padding:12px 20px; border-radius:8px; background: linear-gradient(135deg,#7c4dff,#00d4ff); color:white; text-decoration:none; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <h1>Installer Not Available</h1>
                            <p>The requested installer format is not built yet.</p>
                            <p>Run <code>cd guard-v2/desktop && npx tauri build --bundles deb</code> to generate the latest Linux package, or build Windows installers on a Windows runner.</p>
                            <a class="btn" href="/platform/download/darklock-guard">Back to downloads</a>
                        </div>
                    </body>
                </html>
            `);
        });
        
        // Darklock Guard - Update endpoint for Tauri updater
        this.app.get('/platform/api/updates/:target/:version', (req, res) => {
            const { target, version } = req.params;
            const currentVersion = version;
            const latestVersion = '0.1.0'; // TODO: Read from package.json or config
            
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
        
        // Tauri App - Download page for the new Darklock Guard Tauri application
        this.app.get('/platform/download/darklock-guard-app', (req, res) => {
            const format = req.query.format || 'windows';
            const fs = require('fs');
            
            // Define paths for Tauri app installers
            const tauriBasePath = path.join(__dirname, '../ainti-tampering-app/tauri-app/src-tauri/target/release/bundle');
            
            // Windows installers
            const tauriMsiPath = path.join(tauriBasePath, 'msi/Darklock Guard_1.0.0_x64_en-US.msi');
            const tauriNsisPath = path.join(tauriBasePath, 'nsis/Darklock Guard_1.0.0_x64-setup.exe');
            
            // Linux installers
            const tauriDebPath = path.join(tauriBasePath, 'deb/darklock-guard_1.0.0_amd64.deb');
            const tauriAppImagePath = path.join(tauriBasePath, 'appimage/darklock-guard_1.0.0_amd64.AppImage');
            
            console.log(`[Darklock] Tauri app download request for format: ${format} from IP: ${req.ip}`);
            
            // Handle Windows downloads
            if (format === 'windows' || format === 'msi') {
                if (fs.existsSync(tauriMsiPath)) {
                    console.log(`[Darklock] Tauri MSI installer downloaded by IP: ${req.ip}`);
                    return res.download(tauriMsiPath, 'DarklockGuard-Setup.msi');
                }
                if (fs.existsSync(tauriNsisPath)) {
                    console.log(`[Darklock] Tauri NSIS installer downloaded by IP: ${req.ip}`);
                    return res.download(tauriNsisPath, 'DarklockGuard-Setup.exe');
                }
            }
            
            // Handle Linux downloads
            if (format === 'linux' || format === 'deb') {
                if (fs.existsSync(tauriDebPath)) {
                    console.log(`[Darklock] Tauri Debian package downloaded by IP: ${req.ip}`);
                    return res.download(tauriDebPath, 'darklock-guard_1.0.0_amd64.deb');
                }
                if (fs.existsSync(tauriAppImagePath)) {
                    console.log(`[Darklock] Tauri AppImage downloaded by IP: ${req.ip}`);
                    return res.download(tauriAppImagePath, 'DarklockGuard.AppImage');
                }
            }
            
            // If installer not found, return helpful error page
            return res.status(503).send(`
                <html>
                    <head>
                        <title>Build Required</title>
                        <style>
                            body { 
                                font-family: 'Segoe UI', Arial, sans-serif; 
                                text-align: center; 
                                padding: 50px; 
                                background: linear-gradient(135deg, #1a1f3a 0%, #2d1b4e 100%); 
                                color: #fff;
                                margin: 0;
                                min-height: 100vh;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            }
                            .container {
                                max-width: 600px;
                                background: rgba(255,255,255,0.05);
                                padding: 40px;
                                border-radius: 12px;
                                backdrop-filter: blur(10px);
                            }
                            h1 { color: #7c4dff; margin-bottom: 20px; }
                            p { color: #a8b2d1; line-height: 1.8; margin-bottom: 15px; }
                            .back { 
                                color: #fff; 
                                background: #7c4dff;
                                text-decoration: none; 
                                padding: 12px 24px;
                                margin-top: 20px; 
                                display: inline-block;
                                border-radius: 6px;
                                transition: all 0.3s ease;
                            }
                            .back:hover {
                                background: #6a3ee8;
                                transform: translateY(-2px);
                            }
                            code {
                                background: rgba(0,0,0,0.3);
                                padding: 2px 6px;
                                border-radius: 3px;
                                color: #00d4ff;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>🔨 App Not Built Yet</h1>
                            <p>The Darklock Guard desktop application needs to be built first.</p>
                            <p>To build the app, run:</p>
                            <p><code>cd ainti-tampering-app/tauri-app && npm run build</code></p>
                            <p>The build process may take a few minutes.</p>
                            <a href="/" class="back">← Back to Home</a>
                        </div>
                    </body>
                </html>
            `);
        });
        
        // Darklock Guard - Launch desktop app (requires authentication)
        this.app.get('/platform/launch/darklock-guard', requireAuth, (req, res) => {
            const { spawn, exec } = require('child_process');
            const fs = require('fs');
            const os = require('os');
            
            // Define possible installation paths based on OS
            let possiblePaths = [];
            const platform = os.platform();
            
            if (platform === 'win32') {
                // Windows paths
                possiblePaths = [
                    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Darklock Guard', 'darklock-guard.exe'),
                    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Darklock Guard', 'darklock-guard.exe'),
                    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Darklock Guard', 'darklock-guard.exe'),
                    path.join(__dirname, '../ainti-tampering-app/tauri-app/src-tauri/target/debug/darklock-guard.exe'),
                    path.join(__dirname, '../ainti-tampering-app/tauri-app/src-tauri/target/release/darklock-guard.exe')
                ];
            } else if (platform === 'linux') {
                // Linux paths
                possiblePaths = [
                    '/usr/bin/darklock-guard',
                    '/usr/local/bin/darklock-guard',
                    path.join(os.homedir(), '.local', 'bin', 'darklock-guard'),
                    '/opt/darklock-guard/darklock-guard',
                    path.join(__dirname, '../ainti-tampering-app/tauri-app/src-tauri/target/debug/darklock-guard'),
                    path.join(__dirname, '../ainti-tampering-app/tauri-app/src-tauri/target/release/darklock-guard')
                ];
            } else if (platform === 'darwin') {
                // macOS paths
                possiblePaths = [
                    '/Applications/Darklock Guard.app/Contents/MacOS/darklock-guard',
                    path.join(os.homedir(), 'Applications', 'Darklock Guard.app', 'Contents', 'MacOS', 'darklock-guard')
                ];
            }
            
            // Find the first existing path
            let appPath = null;
            for (const possiblePath of possiblePaths) {
                if (fs.existsSync(possiblePath)) {
                    appPath = possiblePath;
                    break;
                }
            }
            
            // If app not found, return 404 to prompt download
            if (!appPath) {
                console.log(`[Darklock] Darklock Guard not installed. Searched paths:`, possiblePaths);
                return res.status(404).json({
                    success: false,
                    error: 'Application not installed. Please download and install Darklock Guard first.',
                    needsDownload: true
                });
            }
            
            try {
                console.log(`[Darklock] Found Darklock Guard at: ${appPath}`);
                
                // Spawn the app as a detached process
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
                    error: 'Failed to launch application. Please try again or reinstall.'
                });
            }
        });
        
        // Darklock Guard - Web monitor (requires authentication)
        this.app.get('/platform/monitor/darklock-guard', requireAuth, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/monitor.html'));
        });

        // API endpoint for metrics
        // No-op here; bot reference injection handled in constructor/setBot
        
        // Public Status API - for status page
        this.app.get('/api/public/status', async (req, res) => {
            try {
                // Get platform settings (maintenance mode)
                const maintenanceSetting = await db.get(`
                    SELECT value FROM platform_settings WHERE key = 'maintenance_mode'
                `);
                const maintenanceMsgSetting = await db.get(`
                    SELECT value FROM platform_settings WHERE key = 'maintenance_message'
                `);
                
                // Get active announcements (global, not expired)
                const now = new Date().toISOString();
                const announcements = await db.all(`
                    SELECT id, title, content, type, is_global, target_app
                    FROM announcements
                    WHERE is_active = 1 
                    AND (starts_at IS NULL OR starts_at <= ?)
                    AND (ends_at IS NULL OR ends_at >= ?)
                    ORDER BY type = 'critical' DESC, created_at DESC
                    LIMIT 5
                `, [now, now]) || [];
                
                // Get service statuses
                const services = await db.all(`
                    SELECT service_name, display_name, status, status_message, last_check
                    FROM service_status
                    ORDER BY display_order ASC
                `) || [];
                
                res.json({
                    maintenance: maintenanceSetting?.value === 'true',
                    maintenanceMessage: maintenanceMsgSetting?.value || null,
                    announcements,
                    services
                });
            } catch (err) {
                console.error('[Public API] Status error:', err);
                res.json({
                    maintenance: false,
                    announcements: [],
                    services: [
                        { service_name: 'api', display_name: 'API', status: 'online' },
                        { service_name: 'dashboard', display_name: 'Dashboard', status: 'online' }
                    ]
                });
            }
        });
        
        // Public Maintenance API - for maintenance page countdown
        // Uses centralized maintenance module
        this.app.get('/api/public/maintenance-status', async (req, res) => {
            try {
                const config = await maintenance.getMaintenanceConfig();
                
                const platformMaintenance = config.platform.enabled;
                const isBotMaintenance = config.bot.enabled;
                
                // Determine which maintenance is active
                let maintenanceMessage = config.platform.message;
                let maintenanceEndTime = config.platform.endTime;
                
                if (isBotMaintenance && !platformMaintenance) {
                    maintenanceMessage = config.bot.reason || 'The Discord bot is currently undergoing maintenance.';
                    maintenanceEndTime = config.bot.endTime;
                }
                
                res.json({
                    success: true,
                    maintenance: {
                        enabled: platformMaintenance || isBotMaintenance,
                        message: maintenanceMessage,
                        endTime: maintenanceEndTime,
                        type: platformMaintenance ? 'platform' : (isBotMaintenance ? 'bot' : 'none')
                    }
                });
            } catch (err) {
                console.error('[Public API] Maintenance status error:', err);
                res.json({
                    success: true,
                    maintenance: {
                        enabled: false,
                        message: '',
                        endTime: null,
                        type: 'none'
                    }
                });
            }
        });
        
        // Documentation page
        this.app.get('/platform/docs', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/docs.html'));
        });
        
        // System Status page
        this.app.get('/platform/status', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/status.html'));
        });
        
        // Maintenance page (public)
        this.app.get('/maintenance', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/maintenance.html'));
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

        // Simple root health for platform/Render probes
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', uptime: process.uptime() });
        });
        
        // Auth routes
        this.app.use('/platform/auth', authRoutes);
        
        // Admin auth routes (/signin, /signout)
        this.app.use('/', adminAuthRoutes);
        
        // Admin API routes (protected) - Note: Frontend uses /api/admin/*
        this.app.use('/api/admin', adminApiRoutes);
        
        // Admin API v2 routes (enhanced with live data, maintenance scopes, etc.)
        this.app.use('/api/admin', adminApiV2Routes.router);
        
        // Admin API v3 routes (Full RBAC dashboard with 12 tabs)
        this.app.use('/api', adminApiV3Routes.router);
        
        // Public API routes (maintenance status, health - no auth required)
        this.app.use('/api', publicApiRoutes);
        
        // Admin dashboard - New modern dashboard v3 (default)
        this.app.get('/admin', requireAdminAuth, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/admin-v3.html'));
        });
        
        // Admin dashboard v2 (legacy)
        this.app.get('/admin/v2', requireAdminAuth, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/admin-v2.html'));
        });
        
        // Admin SPA catch-all - handles /admin/users etc
        this.app.get('/admin/*', requireAdminAuth, (req, res) => {
            // Skip if it's /admin/v2
            if (req.path === '/admin/v2') return;
            res.sendFile(path.join(__dirname, 'views/admin-v3.html'));
        });
        
        // Admin dashboard legacy route redirect
        this.app.get('/admin/dashboard', requireAdminAuth, (req, res) => {
            res.redirect('/admin');
        });
        
        // Admin API - Dashboard data (protected) - LEGACY - now use /api/admin/dashboard
        this.app.get('/api/admin/legacy/dashboard', requireAdminAuth, async (req, res) => {
            try {
                const today = new Date().toISOString().split('T')[0];
                
                // Get stats from audit log
                const loginsToday = await db.get(`
                    SELECT COUNT(*) as count FROM admin_audit_log 
                    WHERE event_type = 'LOGIN_SUCCESS' AND created_at >= ?
                `, [today]) || { count: 0 };
                
                const failedToday = await db.get(`
                    SELECT COUNT(*) as count FROM admin_audit_log 
                    WHERE event_type = 'LOGIN_FAILED' AND created_at >= ?
                `, [today]) || { count: 0 };
                
                const activeAdmins = await db.get(`
                    SELECT COUNT(*) as count FROM admins WHERE active = 1
                `) || { count: 0 };
                
                // Get recent audit logs
                const auditLog = await db.all(`
                    SELECT * FROM admin_audit_log 
                    ORDER BY created_at DESC LIMIT 20
                `) || [];
                
                res.json({
                    success: true,
                    admin: req.admin,
                    stats: {
                        loginsToday: loginsToday.count,
                        failedToday: failedToday.count,
                        activeAdmins: activeAdmins.count
                    },
                    auditLog
                });
            } catch (err) {
                console.error('[Admin API] Dashboard error:', err);
                res.status(500).json({ success: false, error: 'Failed to load dashboard data' });
            }
        });
        
        // Dashboard routes
        this.app.use('/platform/dashboard', dashboardRoutes);
        
        // Profile API routes
        this.app.use('/platform/profile', profileRoutes);
        
        // Premium payment routes
        const premiumRoutes = require('./routes/premium-api');
        this.app.use('/platform/premium', premiumRoutes);
        
        // Web verification routes
        this.app.post('/api/web-verify/init', this.handleWebVerifyInit.bind(this));
        this.app.post('/api/web-verify/submit', this.handleWebVerifySubmit.bind(this));
        this.app.post('/api/web-verify/refresh', this.handleWebVerifyRefresh.bind(this));
        
        // Updates routes (public + admin)
        const updatesRoutes = require('./routes/platform/updates');
        const adminUpdatesRoutes = require('./routes/platform/admin-updates');
        this.app.use('/platform/update', updatesRoutes);
        this.app.use('/api', adminUpdatesRoutes);
        
        // Platform portal routes (Connected Mode)
        this.app.use('/platform', platformRoutes);
        
        // Site routes (public pages)
        const siteViewsDir = path.join(__dirname, '../src/dashboard/views/site');
        this.app.get('/site/privacy', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'privacy.html'));
        });
        this.app.get('/site/terms', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'terms.html'));
        });
        this.app.get('/site/security', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'security.html'));
        });
        this.app.get('/site/docs', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'documentation.html'));
        });
        this.app.get('/site/status', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'status.html'));
        });
        this.app.get('/site/bug-report', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'bug-reports.html'));
        });
        
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
     * @param {Object} existingApp - Express app instance
     * @param {Object} bot - Optional Discord bot instance for bot management features
     */
    async mountOn(existingApp, bot = null) {
        console.log('[Darklock Platform] Mounting on existing Express app...');
        
        // Store and set bot reference if provided
        if (bot) {
            this.discordBot = bot;
            setDiscordBot(bot);
            setDiscordBotV2(bot);
            setDiscordBotV3(bot);
            setPlatformDiscordBot?.(bot);
            console.log('[Darklock Platform] Discord bot reference set for admin API');
        }
        
        // Initialize database and admin tables before mounting routes
        try {
            await db.initialize();
            await initializeAdminTables();
            await initializeAdminSchema();
            
            // Initialize RBAC schema (roles, permissions, maintenance state, etc.)
            console.log('[Darklock Platform] Initializing RBAC schema...');
            await rbacSchema.initializeRBACSchema();
            
            await initializeDefaultAdmins();
            console.log('[Darklock Platform] ✅ Database and admin tables initialized');
        } catch (err) {
            console.error('[Darklock Platform] Database initialization failed:', err);
        }
        
        // Initialize maintenance module with database
        maintenance.init(db);
        console.log('[Darklock Platform] Maintenance module initialized');
        
        // Add maintenance middleware for /platform routes
        // This runs BEFORE all /platform routes to enforce maintenance mode
        existingApp.use('/platform', maintenance.createMiddleware({
            onBlock: (req, res, config) => {
                const fullPath = (req.baseUrl || '') + req.path;
                console.log('[Darklock Platform] Maintenance blocking request to:', fullPath);
                // For API requests, return 503 JSON
                if (fullPath.startsWith('/platform/api/')) {
                    return res.status(503).json({
                        success: false,
                        error: 'Service temporarily unavailable',
                        maintenance: {
                            enabled: true,
                            message: config.platform.message,
                            endTime: config.platform.endTime
                        }
                    });
                }
                // For all other requests, redirect to maintenance page
                return res.redirect('/platform/maintenance');
            }
        }));
        console.log('[Darklock Platform] Maintenance middleware added for /platform routes');
        
        // Static files
        existingApp.use('/platform/static', express.static(path.join(__dirname, 'public')));
        
        // Downloads folder for installers
        existingApp.use('/platform/downloads', express.static(path.join(__dirname, 'downloads')));
        
        // Avatars folder for user avatars
        const avatarsPath = path.join(process.env.DATA_PATH || path.join(__dirname, 'data'), 'avatars');
        existingApp.use('/platform/avatars', express.static(avatarsPath));
        
        // Main homepage (with user state)
        existingApp.get('/platform', async (req, res) => {
            const token = req.cookies?.darklock_token;
            let userData = null;
            
            if (token) {
                try {
                    const jwt = require('jsonwebtoken');
                    const { requireEnv } = require('./utils/env-validator');
                    const secret = requireEnv('JWT_SECRET');
                    const decoded = jwt.verify(token, secret);
                    
                    // Get user from database
                    const db = require('./utils/database');
                    const user = await db.getUserById(decoded.userId);
                    if (user) {
                        userData = {
                            id: user.id,
                            username: user.username,
                            email: user.email,
                            role: user.role,
                            displayName: user.display_name
                        };
                    }
                } catch (err) {
                    // Token invalid, clear it
                    res.clearCookie('darklock_token');
                }
            }
            
            // Read HTML file and inject user data
            const fs = require('fs');
            const htmlPath = path.join(__dirname, 'views/home.html');
            let html = fs.readFileSync(htmlPath, 'utf8');
            
            // Inject user data into script
            const userScript = `<script>window.DARKLOCK_USER = ${JSON.stringify(userData)};</script>`;
            html = html.replace('</head>', `${userScript}</head>`);
            
            res.send(html);
        });
        
        // Darklock Guard - Download page
        existingApp.get('/platform/download/darklock-guard', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/download-page.html'));
        });
        
        // Darklock Guard - Actual installer download (existingApp integration)
        existingApp.get('/platform/api/download/darklock-guard-installer', (req, res) => {
            const format = (req.query.format || 'deb').toLowerCase();
            const fs = require('fs');
            const latestVersion = '0.1.0';

            // New Tauri bundle locations
            const bundleBase = path.join(__dirname, '../guard-v2/target/release/bundle');
            const debPath = path.join(bundleBase, `deb/Darklock Guard_${latestVersion}_amd64.deb`);
            const portablePath = path.join(bundleBase, 'DarklockGuard-linux-portable.tar.gz');

            // Legacy Windows installers (until new signed builds are produced on Windows)
            const legacyNsis = path.join(__dirname, 'downloads/darklock-guard-setup.exe');
            const legacyMsi = path.join(__dirname, 'downloads/darklock-guard-setup.msi');

            console.log(`[Darklock] (existingApp) Download request for format: ${format} from IP: ${req.ip}`);

            // Linux packages (new app)
            if ((format === 'deb' || format === 'linux') && fs.existsSync(debPath)) {
                console.log('[Darklock] Serving Debian package');
                return res.download(debPath, `darklock-guard_${latestVersion}_amd64.deb`);
            }

            if ((format === 'tar' || format === 'portable') && fs.existsSync(portablePath)) {
                console.log('[Darklock] Serving portable tarball');
                return res.download(portablePath, 'darklock-guard-linux-portable.tar.gz');
            }

            // Windows (legacy)
            if ((format === 'exe' || format === 'windows') && fs.existsSync(legacyNsis)) {
                console.log('[Darklock] Serving legacy Windows NSIS installer');
                return res.download(legacyNsis, 'DarklockGuard-Setup.exe');
            }

            if (format === 'msi' && fs.existsSync(legacyMsi)) {
                console.log('[Darklock] Serving legacy Windows MSI installer');
                return res.download(legacyMsi, 'DarklockGuard-Setup.msi');
            }

            // If installer not found, return themed helper page
            return res.status(503).send(`
                <html>
                    <head>
                        <title>Installer Not Available</title>
                        <link rel="stylesheet" href="/platform/static/css/main.css">
                        <style>
                            body { background: var(--bg-primary, #0a0a0f); color: var(--text-primary, #f8fafc); display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
                            .card { background: var(--bg-elevated, #111827); border: 1px solid rgba(124,77,255,0.35); padding:32px; border-radius:12px; max-width:560px; text-align:center; box-shadow: 0 20px 60px rgba(0,0,0,0.45); }
                            h1 { margin:0 0 12px; }
                            p { color: var(--text-secondary, #94a3b8); line-height:1.6; margin:10px 0; }
                            code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; }
                            a.btn { display:inline-block; margin-top:16px; padding:12px 20px; border-radius:8px; background: linear-gradient(135deg,#7c4dff,#00d4ff); color:white; text-decoration:none; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <h1>Installer Not Available</h1>
                            <p>The requested installer format is not built yet.</p>
                            <p>Run <code>cd guard-v2/desktop && npx tauri build --bundles deb</code> to generate the latest Linux package, or build Windows installers on a Windows runner.</p>
                            <a class="btn" href="/platform/download/darklock-guard">Back to downloads</a>
                        </div>
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
            try{
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
        
        // Simple root health when mounted on existing app
        existingApp.get('/health', (req, res) => {
            res.json({ status: 'ok', uptime: process.uptime() });
        });
        
        // Maintenance page (public, no auth required)
        existingApp.get('/platform/maintenance', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/maintenance.html'));
        });
        
        // Public maintenance status API (for maintenance page) - /status endpoint
        existingApp.get('/platform/maintenance/status', async (req, res) => {
            try {
                const scope = req.query.scope || 'platform';
                const config = await maintenance.getMaintenanceConfig();
                
                let maintenanceData;
                if (scope === 'platform') {
                    maintenanceData = {
                        enabled: config.platform.enabled,
                        type: 'platform',
                        message: config.platform.message,
                        endTime: config.platform.endTime
                    };
                } else if (scope === 'bot') {
                    maintenanceData = {
                        enabled: config.bot.enabled,
                        type: 'bot',
                        message: config.bot.reason,
                        endTime: config.bot.endTime
                    };
                } else {
                    maintenanceData = {
                        enabled: config.platform.enabled || config.bot.enabled,
                        type: config.platform.enabled ? 'platform' : 'bot',
                        message: config.platform.message || config.bot.reason,
                        endTime: config.platform.endTime || config.bot.endTime
                    };
                }
                
                res.json({
                    success: true,
                    maintenance: maintenanceData
                });
            } catch (err) {
                console.error('[Maintenance Status API] Error:', err);
                res.json({
                    success: true,
                    maintenance: {
                        enabled: false
                    }
                });
            }
        });
        
        // Public maintenance status API (for maintenance page) - legacy endpoint
        existingApp.get('/platform/api/public/maintenance-status', async (req, res) => {
            try {
                const config = await maintenance.getMaintenanceConfig();
                res.json({
                    success: true,
                    maintenance: {
                        enabled: config.platform.enabled || config.bot.enabled,
                        type: config.platform.enabled ? 'platform' : 'bot',
                        message: config.platform.message || config.bot.reason,
                        endTime: config.platform.endTime || config.bot.endTime
                    }
                });
            } catch (err) {
                console.error('[Maintenance API] Error:', err);
                res.json({
                    success: true,
                    maintenance: {
                        enabled: false
                    }
                });
            }
        });
        
        // Auth routes
        existingApp.use('/platform/auth', authRoutes);
        
        // Admin auth routes (/signin, /signout, /admin)
        console.log('[Darklock Platform] Registering admin auth routes at /');
        existingApp.use('/', adminAuthRoutes);
        
        // Admin API routes (protected) - Frontend uses /api/admin/*
        console.log('[Darklock Platform] Registering admin API routes at /api/admin');
        existingApp.use('/api/admin', adminApiRoutes);
        existingApp.use('/api/admin', adminApiV2Routes.router);
        
        // Admin API v3 routes (Full RBAC dashboard with 12 tabs)
        console.log('[Darklock Platform] Registering admin API v3 routes at /api');
        existingApp.use('/api', adminApiV3Routes.router);
        
        // Public API routes (maintenance status, health - no auth required)
        console.log('[Darklock Platform] Registering public API routes at /api');
        existingApp.use('/api', publicApiRoutes);
        
        // Admin dashboard - New modern dashboard v3 (default)
        existingApp.get('/admin', requireAdminAuth, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/admin-v3.html'));
        });
        
        // Admin dashboard v2 (legacy)
        existingApp.get('/admin/v2', requireAdminAuth, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/admin-v2.html'));
        });
        
        // Admin dashboard legacy route redirect
        existingApp.get('/admin/dashboard', requireAdminAuth, (req, res) => {
            res.redirect('/admin');
        });
        
        // Dashboard routes (Darklock dashboard, not the bot dashboard)
        existingApp.use('/platform/dashboard', dashboardRoutes);
        
        // Profile API routes
        existingApp.use('/platform/profile', profileRoutes);
        
        // Updates routes (public + admin)
        console.log('[Darklock Platform] Loading updates routes...');
        const updatesRoutes = require('./routes/platform/updates');
        const adminUpdatesRoutes = require('./routes/platform/admin-updates');
        console.log('[Darklock Platform] Registering updates routes at /platform/update and /api');
        existingApp.use('/platform/update', updatesRoutes);
        existingApp.use('/api', adminUpdatesRoutes);
        console.log('[Darklock Platform] Updates routes mounted successfully');
        
        // Platform portal routes (Connected Mode)
        existingApp.use('/platform', platformRoutes);
        
        console.log('[Darklock Platform] Routes mounted successfully');
        console.log('[Darklock Platform] Homepage: /platform');
        console.log('[Darklock Platform] Admin Login: /signin');
        console.log('[Darklock Platform] Admin Dashboard: /admin');
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
                
                // Initialize admin authentication tables
                console.log('[Darklock Platform] Initializing admin auth...');
                await initializeAdminTables();
                
                // Initialize admin dashboard schema
                console.log('[Darklock Platform] Initializing admin dashboard schema...');
                await initializeAdminSchema();
                
                // Initialize RBAC schema (roles, permissions, etc.)
                console.log('[Darklock Platform] Initializing RBAC schema...');
                await rbacSchema.initializeRBACSchema();
                
                // Initialize default admin accounts (only if no admins exist)
                console.log('[Darklock Platform] Checking for default admin accounts...');
                await initializeDefaultAdmins();
                
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
     * Web Verification Routes
     */
    async handleWebVerifyInit(req, res) {
        try {
            const { token, guildId, userId } = req.body;

            if (!this.discordBot?.database) {
                return res.status(503).json({ error: 'Bot database not available' });
            }

            // Lookup by token first
            if (token) {
                const session = await this.discordBot.database.get(
                    `SELECT * FROM verification_sessions WHERE token = ? AND status = 'pending'`,
                    [token]
                );

                if (!session) {
                    return res.status(404).json({ error: 'Invalid or expired verification link' });
                }

                // Check expiry
                if (session.expires_at && new Date(session.expires_at) < new Date()) {
                    await this.discordBot.database.run(
                        `UPDATE verification_sessions SET status = 'expired' WHERE id = ?`,
                        [session.id]
                    );
                    return res.status(410).json({ error: 'Verification link expired. Please request a new one.' });
                }

                const guild = this.discordBot.client?.guilds.cache.get(session.guild_id);

                // If method needs a visible code, generate a fresh one and update the session
                let captchaCode = null;
                if (session.method === 'captcha') {
                    const crypto = require('crypto');
                    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                    captchaCode = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
                    const codeHash = crypto.createHash('sha256').update(captchaCode.toLowerCase()).digest('hex');
                    const newExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
                    await this.discordBot.database.run(
                        `UPDATE verification_sessions SET code_hash = ?, expires_at = ?, attempts = 0 WHERE id = ?`,
                        [codeHash, newExpiry, session.id]
                    );
                }

                return res.json({
                    success: true,
                    guildId: session.guild_id,
                    userId: session.user_id,
                    guildName: guild?.name || 'Unknown Server',
                    guildIcon: guild?.iconURL() || null,
                    method: session.method,
                    riskScore: session.risk_score,
                    captchaCode,
                    maxAttempts: 5,
                    attempts: session.attempts || 0
                });
            }

            // Legacy: lookup by guildId/userId
            if (guildId && userId) {
                const session = await this.discordBot.database.get(
                    `SELECT * FROM verification_sessions 
                     WHERE guild_id = ? AND user_id = ? AND status = 'pending'
                     ORDER BY created_at DESC LIMIT 1`,
                    [guildId, userId]
                );

                if (session) {
                    const guild = this.discordBot.client?.guilds.cache.get(guildId);
                    return res.json({
                        success: true,
                        guildId,
                        userId,
                        guildName: guild?.name || 'Unknown Server',
                        guildIcon: guild?.iconURL() || null,
                        method: session.method,
                        riskScore: session.risk_score,
                        captchaCode: null,
                        maxAttempts: 5,
                        attempts: session.attempts || 0
                    });
                }
            }

            return res.status(404).json({ error: 'No pending verification found' });
        } catch (error) {
            debugLogger.error('[WebVerify] Init error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }

    async handleWebVerifySubmit(req, res) {
        try {
            const { token, code, challenge, guildId, userId } = req.body;
            
            if (!this.discordBot?.database) {
                return res.status(503).json({ error: 'Bot database not available' });
            }

            // Allow legacy fallback when token is missing but guild/user provided
            let session = null;
            if (token) {
                session = await this.discordBot.database.get(
                    `SELECT * FROM verification_sessions WHERE token = ? AND status = 'pending'`,
                    [token]
                );
            } else if (guildId && userId) {
                session = await this.discordBot.database.get(
                    `SELECT * FROM verification_sessions WHERE guild_id = ? AND user_id = ? AND status = 'pending'
                     ORDER BY created_at DESC LIMIT 1`,
                    [guildId, userId]
                );
            } else {
                return res.status(400).json({ error: 'Token or guild/user IDs required' });
            }

            if (!session) {
                return res.status(404).json({ error: 'Invalid or expired session' });
            }

            // Check expiry
            if (session.expires_at && new Date(session.expires_at) < new Date()) {
                await this.discordBot.database.run(
                    `UPDATE verification_sessions SET status = 'expired' WHERE id = ?`,
                    [session.id]
                );
                return res.status(410).json({ error: 'Session expired' });
            }

            // Simple challenge verification (for web method - no code needed)
            if (session.method === 'web') {
                await this.completeWebVerification(session);
                return res.json({ success: true, message: 'Verification complete!' });
            }

            // Captcha/code verification
            if (code) {
                const crypto = require('crypto');
                const codeHash = crypto.createHash('sha256').update(code.toLowerCase()).digest('hex');
                
                if (codeHash !== session.code_hash) {
                    // Increment attempts
                    await this.discordBot.database.run(
                        `UPDATE verification_sessions SET attempts = attempts + 1 WHERE id = ?`,
                        [session.id]
                    );
                    
                    const updated = await this.discordBot.database.get(
                        `SELECT attempts FROM verification_sessions WHERE id = ?`, 
                        [session.id]
                    );
                    
                    if (updated?.attempts >= 5) {
                        await this.discordBot.database.run(
                            `UPDATE verification_sessions SET status = 'failed' WHERE id = ?`,
                            [session.id]
                        );
                        return res.status(403).json({ error: 'Too many failed attempts. Please contact staff.' });
                    }
                    
                    return res.status(400).json({ 
                        error: 'Incorrect code',
                        remaining: 5 - (updated?.attempts || 0)
                    });
                }

                // Code correct
                await this.completeWebVerification(session);
                return res.json({ success: true, message: 'Verification complete!' });
            }

            return res.status(400).json({ error: 'Verification submission incomplete' });
        } catch (error) {
            debugLogger.error('[WebVerify] Submit error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }

    async handleWebVerifyRefresh(req, res) {
        try {
            const { token } = req.body;

            if (!this.discordBot?.database) {
                return res.status(503).json({ error: 'Bot database not available' });
            }

            if (!token) {
                return res.status(400).json({ error: 'Token required' });
            }

            const session = await this.discordBot.database.get(
                `SELECT * FROM verification_sessions WHERE token = ?`,
                [token]
            );

            if (!session || session.status !== 'pending') {
                return res.status(404).json({ error: 'Invalid session' });
            }

            // Generate new code
            const crypto = require('crypto');
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 6; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            const codeHash = crypto.createHash('sha256').update(code.toLowerCase()).digest('hex');

            // Update session
            const newExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            await this.discordBot.database.run(
                `UPDATE verification_sessions SET code_hash = ?, expires_at = ?, attempts = 0 WHERE id = ?`,
                [codeHash, newExpiry, session.id]
            );

            // Try to DM new code to user
            try {
                const guild = this.discordBot.client?.guilds.cache.get(session.guild_id);
                const member = await guild?.members.fetch(session.user_id);
                if (member) {
                    await member.send({
                        embeds: [{
                            title: '🔄 New Verification Code',
                            description: `Your new verification code for **${guild.name}** is:\n\n**\`${code}\`**`,
                            color: 0x00d4ff
                        }]
                    });
                }
            } catch (dmError) {
                // DM failed - code still available via API response
            }

            return res.json({ 
                success: true, 
                message: 'New code sent to your DMs',
                expiresAt: newExpiry,
                captchaCode: code
            });
        } catch (error) {
            debugLogger.error('[WebVerify] Refresh error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }

    async completeWebVerification(session) {
        const guild = this.discordBot.client?.guilds.cache.get(session.guild_id);
        if (!guild) throw new Error('Guild not found');

        const member = await guild.members.fetch(session.user_id).catch(() => null);
        if (!member) throw new Error('Member not found');

        const config = await this.discordBot.database?.getGuildConfig(session.guild_id);

        // Add verified role
        if (config?.verified_role_id) {
            const role = guild.roles.cache.get(config.verified_role_id);
            if (role) {
                await member.roles.add(role).catch(() => {});
            }
        }

        // Remove unverified role
        if (config?.unverified_role_id) {
            const role = guild.roles.cache.get(config.unverified_role_id);
            if (role) {
                await member.roles.remove(role).catch(() => {});
            }
        }

        // Delete any old sessions for this user
        await this.discordBot.database.run(
            `DELETE FROM verification_sessions 
             WHERE guild_id = ? AND user_id = ? AND id != ?`,
            [session.guild_id, session.user_id, session.id]
        );

        // Update session status
        await this.discordBot.database.run(
            `UPDATE verification_sessions 
             SET status = 'completed', completed_at = CURRENT_TIMESTAMP, completed_by = ?
             WHERE id = ?`,
            ['web', session.id]
        );

        // Log to forensics
        if (this.discordBot.forensicsManager) {
            await this.discordBot.forensicsManager.logAuditEvent({
                guildId: session.guild_id,
                eventType: 'verification_complete',
                eventCategory: 'verification',
                executor: { id: session.user_id },
                target: { id: session.user_id, type: 'user' },
                metadata: { method: 'web', via: 'dashboard' }
            });
        }

        debugLogger.log(`[WebVerify] Verified ${session.user_id} in ${session.guild_id}`);
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
