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
const https = require('https');
const http = require('http');
const fs = require('fs');

// Database initialization
const db = require('./utils/database');

// Centralized maintenance module
const maintenance = require('./utils/maintenance');

// Debug logger
const debugLogger = require('./utils/debug-logger');

// Import routes
const authRoutes = require('./routes/auth');
const { requireAuth } = require('./admin-v4/middleware');
const profileRoutes = require('./routes/profile');
const { router: platformRoutes, setDiscordBot: setPlatformDiscordBot } = require('./routes/platform');
const { 
    router: adminAuthRoutes, 
    initializeAdminTables, 
    requireAdminAuth 
} = require('./routes/admin-auth');

// CSRF Protection
const { csrfCookie, csrfProtection } = require('./middleware/csrf');

// Admin dashboard
const { initializeAdminSchema } = require('./utils/admin-schema');
// Team Management routes
const { router: teamManagementRoutes, initializeTeamSchema } = require('./routes/team-management');
// Public API routes (maintenance status, health checks)
const publicApiRoutes = require('./routes/public-api');
// RBAC schema initialization
const rbacSchema = require('./utils/rbac-schema');
const { initializeDefaultAdmins } = require('./default-admin');
// Admin v4 - Enterprise RBAC Dashboard
const adminV4Routes = require('./admin-v4/routes');
const { initializeV4Schema } = require('./admin-v4/db/schema');

class DarklockPlatform {
    constructor(options = {}) {
        this.app = express();
        this.port = options.port || process.env.DARKLOCK_PORT || 3002;
        this.existingApp = options.existingApp || null;
        this.discordBot = options.bot || null;
        
        // If bot is provided, set it for platform routes
        if (this.discordBot) {
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
        setPlatformDiscordBot?.(bot);
        debugLogger.log('[Darklock Platform] Discord bot reference set');
    }
    
    /**
     * Configure Express middleware with comprehensive security
     */
    setupMiddleware() {
        // Trust proxy for secure cookies behind reverse proxy
        this.app.set('trust proxy', 1);
        
        // Determine if we're on a secure connection
        // Check for SSL certificates in addition to environment variables
        const sslKeyPath = path.join(__dirname, 'ssl', 'key.pem');
        const sslCertPath = path.join(__dirname, 'ssl', 'cert.pem');
        const hasSslCerts = fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath);
        const isSecure = process.env.NODE_ENV === 'production' || process.env.FORCE_HTTPS === 'true' || hasSslCerts;
        
        // Comprehensive security headers
        this.app.use(helmet({
            // Content Security Policy
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'", "'wasm-unsafe-eval'", "https://static.cloudflareinsights.com"], // 'wasm-unsafe-eval' required for WebAssembly (libsodium) used by Darklock Notes
                    scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"], // Allow inline event handlers (onclick, etc.)
                    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
                    fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'"],
                    frameSrc: ["'none'"],
                    objectSrc: ["'none'"],
                    baseUri: ["'self'"],
                    formAction: ["'self'"],
                    upgradeInsecureRequests: isSecure ? [] : null
                }
            },
            // HTTP Strict Transport Security (HTTPS only)
            hsts: isSecure ? {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            } : false,
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
            hidePoweredBy: true,
            // Disable COOP/COEP headers on HTTP to avoid browser warnings
            crossOriginOpenerPolicy: isSecure ? { policy: 'same-origin' } : false,
            crossOriginEmbedderPolicy: false,
            crossOriginResourcePolicy: false,
            originAgentCluster: false
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
                ? [
                    'https://darklock.net',
                    'https://www.darklock.net',
                    'https://platform.darklock.net',
                    'https://admin.darklock.net',
                    'tauri://localhost',       // Tauri production app
                    'http://tauri.localhost',  // Tauri alternative
                    'http://localhost:5173',   // Vite dev (tauri dev)
                    'http://localhost:5174',   // Vite dev alt port (tauri dev)
                    'http://localhost:1420',   // Tauri default dev port
                  ]
                : [
                    'http://localhost:3000', 
                    'http://127.0.0.1:3000',
                    'http://localhost:3002',  // Darklock server itself
                    'http://127.0.0.1:3002',
                    'http://localhost:5173',  // Vite dev server
                    'http://localhost:5174',  // Vite dev alt port
                    'http://localhost:1420',  // Tauri default dev port
                    'tauri://localhost',      // Tauri app
                    'http://tauri.localhost'  // Tauri alternative
                  ]);
        
        this.app.use(cors({
            origin: function(origin, callback) {
                // Allow requests with no origin (same-origin, Postman, mobile apps, Tauri)
                if (!origin) return callback(null, true);
                
                // Allow Tauri origins
                if (origin.startsWith('tauri://')) return callback(null, true);
                
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
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token']
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
        
        // CSRF protection: set token cookie on all responses, validate on state-changing requests
        this.app.use('/platform', csrfCookie);
        this.app.use('/platform/auth', csrfProtection);
        this.app.use('/platform/profile', csrfProtection);
        this.app.use('/platform/premium', csrfProtection);
        this.app.use('/admin', csrfProtection);
        
        // UTF-8 charset for HTML responses
        this.app.use((req, res, next) => {
            // Don't override Content-Type for static assets
            if (!req.path.includes('/static/') && 
                !req.path.startsWith('/site/css/') && 
                !req.path.startsWith('/site/js/') && 
                !req.path.startsWith('/site/images/') && 
                !req.path.startsWith('/js/') &&
                !req.path.startsWith('/platform/notes/assets/') &&
                !req.path.startsWith('/platform/notes/manifest') &&
                !req.path.startsWith('/platform/notes/favicon')) {
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
     * Setup API routes for Darklock Guard Desktop onboarding
     */
    setupGuardApiRoutes() {
        const crypto = require('crypto');
        const bcrypt = require('bcrypt');
        const jwt = require('jsonwebtoken');
        const { getJwtSecret } = require('./utils/env-validator');
        const { rateLimitMiddleware, generateJti } = require('./utils/security');
        
        // Login endpoint for Guard desktop app
        this.app.post('/api/auth/login', rateLimitMiddleware('login'), async (req, res) => {
            try {
                const { email, password } = req.body;
                
                if (!email || !password) {
                    return res.status(400).json({ error: 'Email and password required' });
                }
                
                // Get user from database
                const user = await db.getUserByEmail(email);
                if (!user) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }
                
                // Verify password
                const validPassword = await bcrypt.compare(password, user.password);
                if (!validPassword) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }
                
                // Generate JWT token
                const jwtSecret = getJwtSecret();
                const jti = generateJti();
                const token = jwt.sign(
                    { 
                        userId: user.id, 
                        username: user.username,
                        email: user.email,
                        jti 
                    },
                    jwtSecret,
                    { expiresIn: '30d' }
                );
                
                // Store session
                await db.createSession({
                    id: crypto.randomUUID(),
                    userId: user.id,
                    jti,
                    ip: req.ip,
                    userAgent: req.headers['user-agent'] || 'Unknown'
                });
                
                res.json({
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        display_name: user.display_name
                    }
                });
            } catch (err) {
                console.error('[API Auth] Login error:', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        
        // Register endpoint for Guard desktop app
        this.app.post('/api/auth/register', rateLimitMiddleware('signup'), async (req, res) => {
            try {
                const { username, email, password } = req.body;
                
                // Validation
                if (!username || !email || !password) {
                    return res.status(400).json({ error: 'Username, email, and password required' });
                }
                
                if (password.length < 12) {
                    return res.status(400).json({ error: 'Password must be at least 12 characters' });
                }
                
                // Check if user already exists
                const existingUser = await db.getUserByEmail(email);
                if (existingUser) {
                    return res.status(409).json({ error: 'Email already registered' });
                }
                
                const existingUsername = await db.getUserByUsername(username);
                if (existingUsername) {
                    return res.status(409).json({ error: 'Username already taken' });
                }
                
                // Hash password
                const hashedPassword = await bcrypt.hash(password, 10);
                
                // Create user
                const userId = crypto.randomUUID();
                const user = await db.createUser({
                    id: userId,
                    username,
                    email,
                    password: hashedPassword,
                    displayName: username,
                    role: 'user'
                });
                
                if (!user || !user.id) {
                    console.error('[API Auth] createUser returned:', user);
                    throw new Error('Failed to create user');
                }
                
                // Generate JWT token
                const jwtSecret = getJwtSecret();
                const jti = generateJti();
                const token = jwt.sign(
                    { 
                        userId: user.id, 
                        username: user.username,
                        email: user.email,
                        jti 
                    },
                    jwtSecret,
                    { expiresIn: '30d' }
                );
                
                // Store session
                await db.createSession({
                    id: crypto.randomUUID(),
                    userId: user.id,
                    jti,
                    ip: req.ip,
                    userAgent: req.headers['user-agent'] || 'Unknown'
                });
                
                res.status(201).json({
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        display_name: user.display_name
                    }
                });
            } catch (err) {
                console.error('[API Auth] Register error:', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        
        // Device registration endpoint (placeholder - can be enhanced later)
        this.app.post('/api/devices/register', async (req, res) => {
            try {
                const authHeader = req.headers.authorization;
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return res.status(401).json({ error: 'Unauthorized' });
                }
                
                const token = authHeader.split(' ')[1];
                const jwtSecret = getJwtSecret();
                const decoded = jwt.verify(token, jwtSecret);
                
                const { device_id, public_key, name, platform } = req.body;
                
                if (!device_id || !public_key || !name) {
                    return res.status(400).json({ error: 'device_id, public_key, and name required' });
                }
                
                // Store device registration (simple logging for now)
                console.log('[Guard API] Device registered:', {
                    user_id: decoded.userId,
                    device_id,
                    name,
                    platform: platform || 'unknown'
                });
                
                res.json({
                    success: true,
                    device: {
                        id: device_id,
                        name,
                        registered_at: new Date().toISOString()
                    }
                });
            } catch (err) {
                console.error('[API Devices] Register error:', err);
                if (err.name === 'JsonWebTokenError') {
                    return res.status(401).json({ error: 'Invalid token' });
                }
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    }
    
    /**
     * Configure routes
     */
    setupRoutes() {
        // Darklock Guard Desktop API routes (for onboarding)
        // Favicon (prevent 404)
        this.app.get("/favicon.ico", (req, res) => res.status(204).send());
        
        this.setupGuardApiRoutes();
        
        // Static files
        this.app.use('/platform/static', express.static(path.join(__dirname, 'public')));
        
        // Dashboard public assets (chart-builder, widget-system, secure-auth, etc.)
        const dashboardPublicDir = path.join(__dirname, '..', 'src', 'dashboard', 'public');
        this.app.use('/js', express.static(path.join(dashboardPublicDir, 'js')));
        this.app.use('/css', express.static(path.join(dashboardPublicDir, 'css')));

        // Site static assets
        const siteAssetsDir = path.join(__dirname, '..', 'website');
        this.app.use('/site/css', express.static(path.join(siteAssetsDir, 'css')));
        this.app.use('/site/js', express.static(path.join(siteAssetsDir, 'js')));
        this.app.use('/site/images', express.static(path.join(siteAssetsDir, 'images')));
        this.app.use('/js', express.static(path.join(siteAssetsDir, 'js'))); // Backwards compatibility (website-only files)
        
        // Downloads folder for installers
        this.app.use('/platform/downloads/files', express.static(path.join(__dirname, 'downloads')));
        
        // Secure Channel PWA (mobile web app)
        this.app.use('/app/secure-channel', express.static(path.join(__dirname, 'pwa/secure-channel')));
        // SPA fallback — serve index.html for all sub-routes
        this.app.get('/app/secure-channel/*', (req, res) => {
            res.sendFile(path.join(__dirname, 'pwa/secure-channel/index.html'));
        });
        
        // Avatars folder for user avatars
        const avatarsPath = path.join(process.env.DATA_PATH || path.join(__dirname, 'data'), 'avatars');
        this.app.use('/platform/avatars', express.static(avatarsPath));
        
        // Banners folder for user profile banners
        const bannersPath = path.join(process.env.DATA_PATH || path.join(__dirname, 'data'), 'banners');
        this.app.use('/platform/banners', express.static(bannersPath));
        
        // Dashboard redirect → bot dashboard or login
        this.app.get('/dashboard', (req, res) => {
            const hasDashToken = req.cookies?.dashboardToken;
            if (hasDashToken) {
                res.sendFile(path.join(__dirname, '../src/dashboard/views/index-modern.html'));
            } else {
                res.redirect('/login');
            }
        });
        this.app.get('/signin', (req, res) => {
            res.redirect(302, 'https://admin.darklock.net/signin');
        });

        // Login page — serves the bot dashboard login UI
        this.app.get('/login', (req, res) => {
            const loginPage = path.join(__dirname, '../src/dashboard/views/login.html');
            res.sendFile(loginPage, (err) => {
                if (err) res.redirect('/platform/auth/login');
            });
        });

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
            const { resolveView } = require('./utils/theme-resolver');
            const htmlPath = resolveView('home.html');
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
        
        // Secure Channel - Public download page
        this.app.get('/platform/download/secure-channel', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/secure-channel-download.html'));
        });
        
        // Darklock Guard - Installer download (new Tauri build + legacy fallback)
        this.app.get('/platform/api/download/darklock-guard-installer', (req, res) => {
            const format = (req.query.format || 'deb').toLowerCase();
            const fs = require('fs');
            const latestVersion = '2.0.0-beta.3';
            const bundleBase = path.join(__dirname, `../guard-v2/target/release/bundle`);

            console.log(`[Darklock] Download request for format: ${format} from IP: ${req.ip}`);

            // Try multiple file locations in order of preference
            const fileLocations = {
                deb: [
                    path.join(bundleBase, `deb/Darklock Guard_${latestVersion}_amd64.deb`),
                    path.join(__dirname, `downloads/darklock-guard_${latestVersion}_amd64.deb`),
                    path.join(__dirname, 'downloads/darklock-guard_2.0.0-beta.3_amd64.deb'),
                    path.join(__dirname, 'downloads/darklock-guard_0.1.0_amd64.deb'),
                    path.join(bundleBase, 'deb/Darklock Guard_0.1.0_amd64.deb'),
                    path.join(__dirname, 'downloads/darklock-guard-installer.deb')
                ],
                appimage: [
                    path.join(bundleBase, `appimage/darklock-guard_${latestVersion}_amd64.AppImage`),
                    path.join(bundleBase, `appimage/Darklock Guard_${latestVersion}_amd64.AppImage`),
                    path.join(__dirname, `downloads/darklock-guard_${latestVersion}_amd64.AppImage`),
                    path.join(__dirname, 'downloads/darklock-guard.AppImage')
                ],
                tar: [
                    path.join(__dirname, 'downloads/darklock-guard-linux-portable.tar.gz'),
                    path.join(bundleBase, 'DarklockGuard-linux-portable.tar.gz')
                ],
                exe: [
                    path.join(bundleBase, `nsis/Darklock Guard_${latestVersion}_x64-setup.exe`),
                    path.join(__dirname, `downloads/darklock-guard_${latestVersion}_x64-setup.exe`),
                    path.join(__dirname, 'downloads/darklock-guard-setup.exe'),
                    path.join(__dirname, 'downloads/darklocksetup.exe')
                ],
                msi: [
                    path.join(bundleBase, `msi/Darklock Guard_${latestVersion}_x64_en-US.msi`),
                    path.join(__dirname, `downloads/darklock-guard_${latestVersion}_x64_en-US.msi`),
                    path.join(__dirname, 'downloads/darklock-guard-setup.msi'),
                    path.join(__dirname, 'downloads/darklock-guard-installer.msi')
                ]
            };

            // Determine which format key to look for
            let searchFormats = [];
            if (format === 'deb' || format === 'linux') {
                searchFormats = ['deb'];
            } else if (format === 'appimage') {
                searchFormats = ['appimage'];
            } else if (format === 'tar' || format === 'portable') {
                searchFormats = ['tar'];
            } else if (format === 'exe' || format === 'windows') {
                searchFormats = ['exe'];
            } else if (format === 'msi') {
                searchFormats = ['msi'];
            } else {
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

            // Log available files for debugging
            console.error(`[Darklock] Installer not found for format: ${format}`);
            const downloadsDir = path.join(__dirname, 'downloads');
            if (fs.existsSync(downloadsDir)) {
                const files = fs.readdirSync(downloadsDir);
                console.log('[Darklock] Available files in downloads:', files);
            }
            if (fs.existsSync(path.join(bundleBase, 'deb'))) {
                console.log('[Darklock] Available in bundle/deb:', fs.readdirSync(path.join(bundleBase, 'deb')));
            }

            // Return themed helper page
            return res.status(404).send(`
                <html>
                    <head>
                        <title>Installer Not Available</title>
                        <link rel="stylesheet" href="/platform/static/css/main.css">
                        <style>
                            body { background: #0a0a0f; color: #f8fafc; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
                            .card { background: #111827; border: 1px solid rgba(124,77,255,0.35); padding:32px; border-radius:12px; max-width:560px; text-align:center; box-shadow: 0 20px 60px rgba(0,0,0,0.45); }
                            h1 { margin:0 0 12px; }
                            p { color: #94a3b8; line-height:1.6; margin:10px 0; }
                            code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; }
                            a.btn { display:inline-block; margin-top:16px; padding:12px 20px; border-radius:8px; background: linear-gradient(135deg,#7c4dff,#00d4ff); color:white; text-decoration:none; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <h1>Installer Not Available</h1>
                            <p>The <strong>${format}</strong> installer is not yet available.</p>
                            <p>Build it with: <code>cd guard-v2/desktop && npx tauri build --bundles deb,appimage</code></p>
                            <a class="btn" href="/platform/download/darklock-guard">Back to downloads</a>
                        </div>
                    </body>
                </html>
            `);
        });

        // Darklock Secure Channel - Download page
        this.app.get('/platform/download/secure-channel', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/secure-channel-download.html'));
        });

        // Darklock Secure Channel - Installer download
        this.app.get('/platform/api/download/secure-channel-installer', (req, res) => {
            const format = (req.query.format || 'deb').toLowerCase();
            const fs = require('fs');
            const version = '1.1.0';

            console.log(`[SecureChannel] Download request for format: ${format} from IP: ${req.ip}`);

            const electronRelease = path.join(__dirname, '../secure-channel/apps/dl-secure-channel/release');

            const fileLocations = {
                deb: [
                    path.join(__dirname, `downloads/DarklockSecureChannel-${version}-linux-amd64.deb`),
                    path.join(electronRelease, `DarklockSecureChannel-${version}-linux-amd64.deb`),
                    path.join(__dirname, 'downloads/DarklockSecureChannel-1.0.0-linux-amd64.deb'),
                    path.join(electronRelease, 'DarklockSecureChannel-1.0.0-linux-amd64.deb')
                ],
                appimage: [
                    path.join(__dirname, `downloads/DarklockSecureChannel-${version}-linux-x86_64.AppImage`),
                    path.join(electronRelease, `DarklockSecureChannel-${version}-linux-x86_64.AppImage`),
                    path.join(__dirname, 'downloads/DarklockSecureChannel-1.0.0-linux-x86_64.AppImage'),
                    path.join(electronRelease, 'DarklockSecureChannel-1.0.0-linux-x86_64.AppImage')
                ],
                exe: [
                    path.join(__dirname, `downloads/DarklockSecureChannel-${version}-win-x64.exe`),
                    path.join(electronRelease, `DarklockSecureChannel-${version}-win-x64.exe`),
                    path.join(__dirname, 'downloads/DarklockSecureChannel-1.0.0-win-x64.exe'),
                    path.join(electronRelease, 'DarklockSecureChannel-1.0.0-win-x64.exe')
                ]
            };

            let searchFormats = [];
            if (format === 'deb' || format === 'linux') {
                searchFormats = ['deb'];
            } else if (format === 'appimage') {
                searchFormats = ['appimage'];
            } else if (format === 'exe' || format === 'windows') {
                searchFormats = ['exe'];
            } else {
                searchFormats = ['deb'];
            }

            for (const fmt of searchFormats) {
                const locations = fileLocations[fmt] || [];
                for (const filePath of locations) {
                    if (fs.existsSync(filePath)) {
                        const fileName = path.basename(filePath);
                        console.log(`[SecureChannel] Serving installer: ${fileName}`);
                        return res.download(filePath, fileName);
                    }
                }
            }

            console.error(`[SecureChannel] Installer not found for format: ${format}`);
            return res.status(404).send(`
                <html>
                    <head>
                        <title>Installer Not Available</title>
                        <style>
                            body { background: #0a0a0f; color: #f8fafc; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; font-family: system-ui; }
                            .card { background: #111827; border: 1px solid rgba(0,212,255,0.35); padding:32px; border-radius:12px; max-width:560px; text-align:center; }
                            h1 { margin:0 0 12px; }
                            p { color: #94a3b8; line-height:1.6; }
                            a.btn { display:inline-block; margin-top:16px; padding:12px 20px; border-radius:8px; background: linear-gradient(135deg,#00d4ff,#7c4dff); color:white; text-decoration:none; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <h1>Installer Not Available</h1>
                            <p>The <strong>${format}</strong> installer for Darklock Secure Channel is not available at this time.</p>
                            <a class="btn" href="/platform/download/secure-channel">Back to downloads</a>
                        </div>
                    </body>
                </html>
            `);
        });

        // Darklock Secure Notes - Web App (PWA, installable on iOS/Android)
        const notesWebDist = path.join(__dirname, '../darklock-notes/apps/web/dist');
        this.app.use('/platform/notes', express.static(notesWebDist));
        this.app.get('/platform/notes/*', (req, res) => {
            res.sendFile(path.join(notesWebDist, 'index.html'));
        });

        // Darklock Secure Notes - Notes server API proxy (/api/notes/* → localhost:3003/api/*)
        // The Notes PWA is built with VITE_NOTES_API_URL=/api/notes so all its API calls
        // come here; we forward them to the Notes server running on port 3003.
        this.app.all('/api/notes/*', (req, res) => {
            const notesServerPort = parseInt(process.env.NOTES_SERVER_PORT || '3003', 10);
            const targetPath = req.originalUrl.replace('/api/notes', '/api');
            const body = req.body ? JSON.stringify(req.body) : undefined;
            const reqHeaders = { ...req.headers, host: `localhost:${notesServerPort}` };
            // Strip browser Origin/Referer — this is a server-side proxy; CORS doesn't apply
            delete reqHeaders['origin'];
            delete reqHeaders['referer'];
            if (body) {
                reqHeaders['content-type'] = 'application/json';
                reqHeaders['content-length'] = String(Buffer.byteLength(body));
            }
            const options = {
                hostname: 'localhost',
                port: notesServerPort,
                path: targetPath,
                method: req.method,
                headers: reqHeaders,
            };
            const proxyReq = http.request(options, (proxyRes) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res, { end: true });
            });
            proxyReq.on('error', () => {
                if (!res.headersSent) res.status(502).json({ success: false, error: 'Notes server unavailable' });
            });
            if (body) proxyReq.write(body);
            proxyReq.end();
        });

        // Darklock Secure Notes - Download page (URL exists, not linked from site nav)
        this.app.get('/platform/download/darklock-notes', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/darklock-notes-download.html'));
        });

        // Darklock Secure Notes - Web Monitor
        this.app.get('/platform/monitor/darklock-notes', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/notes-monitor.html'));
        });

        // Darklock Secure Notes - Monitor status API (instances push data here)
        this.app.get('/platform/api/notes/monitor/status', (req, res) => {
            res.json({ instances: [], events: [], lastSync: null });
        });

        // Darklock Secure Notes - Installer download
        this.app.get('/platform/api/download/darklock-notes-installer', (req, res) => {
            const format = (req.query.format || 'deb').toLowerCase();
            const fs = require('fs');
            const version = '1.0.0';
            const bundleBase = path.join(__dirname, '../darklock-notes/apps/desktop/src-tauri/target/release/bundle');
            const electronRelease = path.join(__dirname, '../darklock-notes/apps/desktop/release');

            console.log(`[DarklockNotes] Download request for format: ${format} from IP: ${req.ip}`);

            const fileLocations = {
                deb: [
                    path.join(electronRelease, `DarklockSecureNotes-${version}-linux-amd64.deb`),
                    path.join(__dirname, `downloads/DarklockSecureNotes-${version}-linux-amd64.deb`),
                    path.join(bundleBase, `deb/Darklock Notes_${version}_amd64.deb`),
                    path.join(bundleBase, `deb/darklock-notes_${version}_amd64.deb`),
                    path.join(__dirname, `downloads/darklock-notes_${version}_amd64.deb`)
                ],
                appimage: [
                    path.join(electronRelease, `DarklockSecureNotes-${version}-linux-x86_64.AppImage`),
                    path.join(__dirname, `downloads/DarklockSecureNotes-${version}-linux-x86_64.AppImage`),
                    path.join(bundleBase, `appimage/Darklock Notes_${version}_amd64.AppImage`),
                    path.join(bundleBase, `appimage/darklock-notes_${version}_amd64.AppImage`),
                    path.join(__dirname, `downloads/darklock-notes_${version}_amd64.AppImage`)
                ],
                ipa: [
                    path.join(__dirname, `downloads/darklock-notes_${version}.ipa`),
                    path.join(__dirname, 'downloads/darklock-notes.ipa')
                ],
                testflight: [] // Redirect to TestFlight invite link (update when available)
            };

            // TestFlight redirect — update TESTFLIGHT_NOTES_URL env var when the beta invite is live
            if (format === 'testflight') {
                const tfUrl = process.env.TESTFLIGHT_NOTES_URL || null;
                if (tfUrl) return res.redirect(302, tfUrl);
                return res.status(404).send(`
                    <html>
                        <head><title>TestFlight Beta</title>
                        <style>
                            body { background:#0b0f1a; color:#f8fafc; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; font-family:system-ui; }
                            .card { background:#111827; border:1px solid rgba(99,102,241,0.35); padding:32px; border-radius:12px; max-width:500px; text-align:center; }
                            h2 { color:#a5b4fc; margin:0 0 12px; }
                            p { color:#94a3b8; line-height:1.6; }
                            a.btn { display:inline-block; margin-top:16px; padding:12px 24px; border-radius:8px; background:linear-gradient(135deg,#6366f1,#00d4ff); color:#fff; text-decoration:none; font-weight:600; }
                        </style></head>
                        <body>
                            <div class="card">
                                <h2>TestFlight Beta Coming Soon</h2>
                                <p>The iOS beta invite link isn't live yet. Check back soon or download the IPA for sideloading.</p>
                                <a class="btn" href="/platform/download/darklock-notes">Back to Downloads</a>
                            </div>
                        </body>
                    </html>
                `);
            }

            let searchFormats = [];
            if (format === 'deb' || format === 'linux') {
                searchFormats = ['deb'];
            } else if (format === 'appimage') {
                searchFormats = ['appimage'];
            } else if (format === 'ipa' || format === 'ios') {
                searchFormats = ['ipa'];
            } else {
                searchFormats = ['deb'];
            }

            for (const fmt of searchFormats) {
                const locations = fileLocations[fmt] || [];
                for (const filePath of locations) {
                    if (fs.existsSync(filePath)) {
                        const fileName = path.basename(filePath);
                        console.log(`[DarklockNotes] Serving installer: ${fileName}`);
                        return res.download(filePath, fileName);
                    }
                }
            }

            console.error(`[DarklockNotes] Installer not found for format: ${format}`);
            return res.status(404).send(`
                <html>
                    <head>
                        <title>Installer Not Available</title>
                        <style>
                            body { background:#0b0f1a; color:#f8fafc; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; font-family:system-ui; }
                            .card { background:#111827; border:1px solid rgba(99,102,241,0.35); padding:32px; border-radius:12px; max-width:560px; text-align:center; }
                            h1 { margin:0 0 12px; }
                            p { color:#94a3b8; line-height:1.6; }
                            code { background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px; }
                            a.btn { display:inline-block; margin-top:16px; padding:12px 20px; border-radius:8px; background:linear-gradient(135deg,#6366f1,#00d4ff); color:#fff; text-decoration:none; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <h1>Installer Not Available</h1>
                            <p>The <strong>${format}</strong> installer has not been built yet.</p>
                            <p>Build it with: <code>cd darklock-notes && npm run build:desktop</code></p>
                            <a class="btn" href="/platform/download/darklock-notes">Back to Downloads</a>
                        </div>
                    </body>
                </html>
            `);
        });

        // Darklock Guard - Public updates page (NO auth required)
        this.app.get('/platform/updates', async (req, res) => {
            const Q = require('./admin-v4/db/queries');
            const os = require('os');

            // Channel filter from query param (default: show all)
            const channelFilter = req.query.channel || 'all';

            let updates = [];
            try {
                updates = await Q.getAppUpdates({ limit: 50 });
            } catch {}

            // Enrich with file listings
            const enriched = updates.map(u => {
                const vDir = path.join(__dirname, 'downloads/updates', u.version);
                let files = [];
                if (fs.existsSync(vDir)) {
                    files = fs.readdirSync(vDir).map(f => {
                        const stat = fs.statSync(path.join(vDir, f));
                        return { name: f, size: stat.size };
                    });
                }
                return { ...u, files, channel: u.channel || 'stable' };
            });

            // Apply channel filter
            const filtered = channelFilter === 'all' ? enriched : enriched.filter(u => u.channel === channelFilter);
            const latest = filtered[0];
            const history = filtered.slice(1);

            // Get LAN IP for sharing
            const lanIp = (() => {
                try {
                    const ifaces = os.networkInterfaces();
                    for (const name of Object.keys(ifaces)) {
                        for (const iface of ifaces[name]) {
                            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
                        }
                    }
                } catch {}
                return null;
            })();
            const port = this.port || 3002;
            const shareUrl = lanIp ? `http://${lanIp}:${port}/platform/updates` : null;

            const stableCount = enriched.filter(u => u.channel === 'stable').length;
            const betaCount = enriched.filter(u => u.channel === 'beta').length;

            const fmtSize = bytes => {
                if (!bytes) return '0 B';
                const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
            };

            const platformIcon = name => {
                if (name.endsWith('.exe') || name.endsWith('.msi')) return '🪟';
                if (name.endsWith('.deb') || name.endsWith('.AppImage') || name.endsWith('.tar.gz')) return '🐧';
                if (name.endsWith('.dmg')) return '🍎';
                return '📦';
            };

            const osInstallNote = name => {
                if (name.endsWith('.exe')) return 'Run the .exe installer and follow the prompts.';
                if (name.endsWith('.msi')) return 'Double-click the .msi file to install.';
                if (name.endsWith('.deb')) return 'Run: <code>sudo dpkg -i ' + name + '</code>';
                if (name.endsWith('.AppImage')) return 'Run: <code>chmod +x ' + name + ' &amp;&amp; ./' + name + '</code>';
                if (name.endsWith('.tar.gz')) return 'Extract and run: <code>tar -xzf ' + name + '</code>';
                if (name.endsWith('.dmg')) return 'Open the .dmg and drag Darklock Guard to Applications.';
                return 'Run the installer file.';
            };

            const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Darklock Guard — Downloads</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#070711;color:#e2e8f0;min-height:100vh}
  header{background:linear-gradient(135deg,#0d0d1a,#12121f);border-bottom:1px solid rgba(124,77,255,.2);padding:18px 32px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
  .logo{width:38px;height:38px;background:linear-gradient(135deg,#7c4dff,#00d4ff);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
  .header-left{display:flex;align-items:center;gap:14px}
  header h1{font-size:1.15rem;font-weight:700}
  header p{color:#64748b;font-size:.8rem;margin-top:2px}
  .share-box{background:rgba(124,77,255,.08);border:1px solid rgba(124,77,255,.25);border-radius:10px;padding:8px 14px;display:flex;align-items:center;gap:10px;font-size:.78rem}
  .share-box span{color:#94a3b8}
  .share-url{font-family:monospace;color:#a78bfa;font-size:.82rem;cursor:pointer;user-select:all}
  .copy-btn{background:rgba(124,77,255,.2);border:none;color:#a78bfa;border-radius:6px;padding:4px 10px;font-size:.72rem;cursor:pointer;font-weight:600;transition:background .15s}
  .copy-btn:hover{background:rgba(124,77,255,.4)}
  .container{max-width:880px;margin:0 auto;padding:36px 24px}
  .tabs{display:flex;gap:4px;margin-bottom:28px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:4px}
  .tab{flex:1;padding:8px 0;border:none;border-radius:8px;background:transparent;color:#64748b;font-size:.85rem;font-weight:600;cursor:pointer;transition:all .15s;text-decoration:none;text-align:center;display:block}
  .tab.active{background:rgba(124,77,255,.2);color:#a78bfa}
  .tab:hover:not(.active){background:rgba(255,255,255,.05);color:#94a3b8}
  .tab .count{background:rgba(255,255,255,.08);border-radius:20px;padding:1px 8px;font-size:.7rem;margin-left:6px}
  .tab.active .count{background:rgba(124,77,255,.3)}
  .latest-card{background:linear-gradient(135deg,rgba(124,77,255,.08),rgba(0,212,255,.04));border:1px solid rgba(124,77,255,.3);border-radius:16px;padding:28px;margin-bottom:32px}
  .latest-header{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:12px}
  .latest-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(124,77,255,.2);color:#a78bfa;border-radius:20px;padding:3px 10px;font-size:.72rem;font-weight:600;margin-bottom:8px}
  .beta-badge{background:rgba(168,85,247,.2);color:#c084fc}
  .ver{font-size:1.9rem;font-weight:800;font-family:monospace;line-height:1}
  .ver span{color:#a78bfa}
  .sub{color:#64748b;font-size:.83rem;margin-top:5px}
  .force-badge{background:rgba(239,68,68,.15);color:#f87171;border-radius:6px;padding:2px 8px;font-size:.68rem;font-weight:700;margin-left:8px;vertical-align:middle}
  .channel-tag{border-radius:6px;padding:2px 8px;font-size:.68rem;font-weight:700;margin-left:4px;vertical-align:middle}
  .channel-stable{background:rgba(34,197,94,.12);color:#4ade80}
  .channel-beta{background:rgba(168,85,247,.15);color:#c084fc}
  .changelog{margin:16px 0;background:rgba(255,255,255,.03);border-radius:10px;padding:16px;border:1px solid rgba(255,255,255,.05);white-space:pre-wrap;color:#94a3b8;font-size:.85rem;line-height:1.65}
  .files-section{margin-top:20px}
  .files-label{font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#475569;margin-bottom:10px}
  .files-grid{display:flex;flex-wrap:wrap;gap:10px}
  .dl-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;background:linear-gradient(135deg,#7c4dff,#5b21b6);color:#fff;text-decoration:none;font-size:.875rem;font-weight:600;transition:opacity .15s;border:none;cursor:pointer}
  .dl-btn:hover{opacity:.85}
  .dl-btn .size{font-size:.72rem;font-weight:400;opacity:.65}
  .no-files{color:#475569;font-size:.875rem;font-style:italic}
  .install-note{margin-top:8px;font-size:.75rem;color:#64748b;display:flex;align-items:center;gap:6px}
  .install-note code{background:rgba(255,255,255,.07);border-radius:4px;padding:1px 6px;font-family:monospace;color:#94a3b8;font-size:.72rem}
  h3{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#475569;margin-bottom:16px;margin-top:36px}
  .history{display:flex;flex-direction:column;gap:10px}
  .history-item{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);border-radius:12px;padding:16px 20px;transition:border-color .15s}
  .history-item:hover{border-color:rgba(124,77,255,.2)}
  .history-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .h-ver{font-family:monospace;font-weight:700;font-size:.95rem}
  .h-title{color:#94a3b8;font-size:.85rem}
  .h-date{color:#475569;font-size:.72rem;margin-left:auto}
  .hfiles{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .hfile{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);color:#94a3b8;text-decoration:none;font-size:.78rem;transition:background .15s}
  .hfile:hover{background:rgba(124,77,255,.12);color:#c4b5fd}
  .empty{text-align:center;padding:60px 20px;color:#475569}
  .empty .icon{font-size:3rem;margin-bottom:12px}
  .howto{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:20px 24px;margin-top:40px}
  .howto h4{font-size:.8rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#475569;margin-bottom:14px}
  .steps{display:flex;flex-direction:column;gap:10px}
  .step{display:flex;align-items:flex-start;gap:12px;font-size:.83rem;color:#94a3b8}
  .step-num{min-width:22px;height:22px;background:rgba(124,77,255,.2);color:#a78bfa;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;flex-shrink:0;margin-top:1px}
  .step code{background:rgba(255,255,255,.07);border-radius:4px;padding:1px 7px;font-family:monospace;color:#a78bfa;font-size:.78rem}
</style>
</head>
<body>
<header>
  <div class="header-left">
    <div class="logo">🛡️</div>
    <div>
      <h1>Darklock Guard</h1>
      <p>Software Downloads &amp; Releases</p>
    </div>
  </div>
  ${shareUrl ? `
  <div class="share-box">
    <span>Share this page:</span>
    <span class="share-url" id="shareUrl">${shareUrl}</span>
    <button class="copy-btn" onclick="copyUrl()">Copy</button>
  </div>` : ''}
</header>

<div class="container">
  <!-- Channel tabs -->
  <div class="tabs">
    <a class="tab ${channelFilter === 'all' ? 'active' : ''}" href="/platform/updates">All Releases<span class="count">${enriched.length}</span></a>
    <a class="tab ${channelFilter === 'stable' ? 'active' : ''}" href="/platform/updates?channel=stable">Stable<span class="count">${stableCount}</span></a>
    <a class="tab ${channelFilter === 'beta' ? 'active' : ''}" href="/platform/updates?channel=beta">Beta<span class="count">${betaCount}</span></a>
  </div>

  ${latest ? `
  <!-- Latest release -->
  <div class="latest-card">
    <div>
      <div class="latest-badge ${latest.channel === 'beta' ? 'beta-badge' : ''}">⬆ Latest ${latest.channel === 'beta' ? 'Beta' : 'Stable'} Release</div>
      <div class="latest-header">
        <div>
          <div class="ver"><span>v</span>${latest.version}${latest.force_update ? '<span class="force-badge">REQUIRED UPDATE</span>' : ''}<span class="channel-tag ${latest.channel === 'beta' ? 'channel-beta' : 'channel-stable'}">${latest.channel || 'stable'}</span></div>
          <div class="sub">${latest.title || ''}${latest.published_at ? ' &nbsp;·&nbsp; Released ' + new Date(latest.published_at).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}) : ''}</div>
        </div>
      </div>
      ${latest.changelog ? `<div class="changelog">${latest.changelog.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : ''}
      <div class="files-section">
        <div class="files-label">Download Installers</div>
        ${latest.files.length > 0 ? `
        <div class="files-grid">
          ${latest.files.map(f => `
          <div>
            <a class="dl-btn" href="/platform/api/updates/download/${latest.version}?file=${encodeURIComponent(f.name)}">
              ${platformIcon(f.name)} ${f.name} <span class="size">${fmtSize(f.size)}</span>
            </a>
            <div class="install-note">ℹ️ ${osInstallNote(f.name)}</div>
          </div>`).join('')}
        </div>` : latest.download_url ? `
        <div class="files-grid">
          <a class="dl-btn" href="${latest.download_url}">⬇ Download v${latest.version}</a>
        </div>` : `<span class="no-files">No installer files uploaded yet.</span>`}
      </div>
    </div>
  </div>

  <!-- How to install -->
  <div class="howto">
    <h4>How to Install</h4>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><div>Download the installer for your operating system above.</div></div>
      <div class="step"><div class="step-num">2</div><div><strong>Linux:</strong> Run <code>sudo dpkg -i darklock-guard-*.deb</code> or <code>chmod +x *.AppImage &amp;&amp; ./darklock-guard.AppImage</code></div></div>
      <div class="step"><div class="step-num">2</div><div><strong>Windows:</strong> Double-click the <code>.exe</code> or <code>.msi</code> installer and follow the prompts.</div></div>
      <div class="step"><div class="step-num">2</div><div><strong>macOS:</strong> Open the <code>.dmg</code> and drag Darklock Guard to your Applications folder.</div></div>
      <div class="step"><div class="step-num">3</div><div>Launch Darklock Guard. It will automatically connect to the guard service on first run.</div></div>
    </div>
  </div>` : `
  <div class="empty">
    <div class="icon">📭</div>
    <p>No releases published yet${channelFilter !== 'all' ? ' for the <strong>' + channelFilter + '</strong> channel' : ''}.</p>
    ${channelFilter !== 'all' ? '<p style="margin-top:8px"><a href="/platform/updates" style="color:#a78bfa;font-size:.85rem">View all channels →</a></p>' : ''}
  </div>`}

  ${history.length > 0 ? `
  <h3>Version History</h3>
  <div class="history">
    ${history.map(u => `
    <div class="history-item">
      <div class="history-meta">
        <span class="h-ver">v${u.version}</span>
        <span class="channel-tag ${u.channel === 'beta' ? 'channel-beta' : 'channel-stable'}">${u.channel || 'stable'}</span>
        <span class="h-title">${u.title || ''}</span>
        ${u.force_update ? '<span class="force-badge">REQUIRED</span>' : ''}
        <span class="h-date">${u.published_at ? new Date(u.published_at).toLocaleDateString() : ''}</span>
      </div>
      ${u.files.length > 0 ? `<div class="hfiles">${u.files.map(f=>`<a class="hfile" href="/platform/api/updates/download/${u.version}?file=${encodeURIComponent(f.name)}">${platformIcon(f.name)} ${f.name} <span style="opacity:.5">${fmtSize(f.size)}</span></a>`).join('')}</div>` : ''}
    </div>`).join('')}
  </div>` : ''}
</div>
<script>
  function copyUrl() {
    const url = document.getElementById('shareUrl')?.textContent;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.querySelector('.copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    });
  }
</script>
</body>
</html>`;
            res.send(html);
        });

        // Darklock Guard - Download update files for a specific version
        this.app.get('/platform/api/updates/download/:version', (req, res) => {
            const { version } = req.params;
            const platform = req.query.platform || (process.platform === 'win32' ? 'windows' : 'linux');
            const requestedFile = req.query.file; // direct file name from public page links
            const updatesDir = path.join(__dirname, 'downloads/updates', version);

            if (!fs.existsSync(updatesDir)) {
                return res.status(404).json({ error: 'No files for this version' });
            }

            const files = fs.readdirSync(updatesDir);
            if (files.length === 0) {
                return res.status(404).json({ error: 'No files available' });
            }

            // If a specific file was requested (from public page), serve it directly
            if (requestedFile) {
                const safe = path.basename(requestedFile); // strip any path traversal
                if (files.includes(safe)) {
                    return res.download(path.join(updatesDir, safe), safe);
                }
                return res.status(404).json({ error: 'File not found' });
            }

            // Find platform-appropriate file
            let targetFile;
            if (platform === 'windows') {
                targetFile = files.find(f => f.endsWith('.exe') || f.endsWith('.msi'));
            } else if (platform === 'linux') {
                targetFile = files.find(f => f.endsWith('.deb') || f.endsWith('.AppImage') || f.endsWith('.tar.gz'));
            } else if (platform === 'macos') {
                targetFile = files.find(f => f.endsWith('.dmg'));
            }
            // Fallback to first file
            if (!targetFile) targetFile = files[0];

            res.download(path.join(updatesDir, targetFile), targetFile);
        });

        // Darklock Guard - List available files for a version (public)
        this.app.get('/platform/api/updates/files/:version', (req, res) => {
            const { version } = req.params;
            const updatesDir = path.join(__dirname, 'downloads/updates', version);

            if (!fs.existsSync(updatesDir)) {
                return res.json({ files: [] });
            }

            const files = fs.readdirSync(updatesDir).map(f => {
                const stat = fs.statSync(path.join(updatesDir, f));
                return {
                    name: f,
                    size: stat.size,
                    url: `/platform/api/updates/download/${version}?file=${encodeURIComponent(f)}`,
                };
            });
            res.json({ files });
        });
        
        // Darklock Guard - Update check endpoint (used by desktop app)
        this.app.get('/platform/api/updates/:target/:version', async (req, res) => {
            const { target, version: currentVersion } = req.params;
            const channel = req.query.channel === 'beta' ? 'beta' : 'stable';

            try {
                // Read latest from database (channel-aware)
                const Q = require('./admin-v4/db/queries');
                const latest = await Q.getLatestAppUpdate(channel);
                
                if (!latest) {
                    return res.status(204).send(); // No updates at all
                }

                const latestVersion = latest.version;

                // Compare versions (semver)
                const cur = currentVersion.split('.').map(Number);
                const lat = latestVersion.split('.').map(Number);
                const isNewer = lat[0] > cur[0] || (lat[0] === cur[0] && lat[1] > cur[1]) || (lat[0] === cur[0] && lat[1] === cur[1] && lat[2] > cur[2]);

                if (!isNewer) {
                    return res.status(204).send(); // Already on latest
                }

                // Check if we have uploaded files for this version
                const updatesDir = path.join(__dirname, 'downloads/updates', latestVersion);
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                
                // Build platform-specific URLs
                const platforms = {};
                if (fs.existsSync(updatesDir)) {
                    const files = fs.readdirSync(updatesDir);
                    const winFile = files.find(f => f.endsWith('.exe') || f.endsWith('.msi'));
                    const linuxFile = files.find(f => f.endsWith('.deb') || f.endsWith('.AppImage') || f.endsWith('.tar.gz'));
                    const macFile = files.find(f => f.endsWith('.dmg'));

                    if (winFile) {
                        platforms['windows-x86_64'] = { signature: '', url: `${baseUrl}/platform/api/updates/download/${latestVersion}?platform=windows` };
                    }
                    if (linuxFile) {
                        platforms['linux-x86_64'] = { signature: '', url: `${baseUrl}/platform/api/updates/download/${latestVersion}?platform=linux` };
                    }
                    if (macFile) {
                        platforms['darwin-x86_64'] = { signature: '', url: `${baseUrl}/platform/api/updates/download/${latestVersion}?platform=macos` };
                    }
                }

                // Fallback: use download_url from the update record
                if (Object.keys(platforms).length === 0 && latest.download_url) {
                    platforms[target || 'linux-x86_64'] = { signature: '', url: latest.download_url };
                }

                const updateManifest = {
                    version: latestVersion,
                    notes: latest.changelog || latest.title,
                    pub_date: latest.published_at || new Date().toISOString(),
                    force: !!latest.force_update,
                    min_version: latest.min_version,
                    channel: latest.channel || 'stable',
                    platforms,
                };

                res.json(updateManifest);
            } catch (err) {
                console.error('[Darklock] Update check error:', err);
                res.status(500).json({ error: 'Internal server error' });
            }
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
        
        // Darklock Guard - Web monitor (requires platform user authentication)
        this.app.get('/platform/monitor/darklock-guard', (req, res) => {
            const token = req.cookies?.darklock_token;
            if (!token) return res.redirect('/platform/auth/login');
            try {
                const jwt = require('jsonwebtoken');
                const { requireEnv } = require('./utils/env-validator');
                jwt.verify(token, requireEnv('JWT_SECRET'));
            } catch {
                res.clearCookie('darklock_token');
                return res.redirect('/platform/auth/login');
            }
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
                    SELECT id, title, content, type, scope, app_id
                    FROM announcements
                    WHERE is_active = 1 
                    AND (start_at IS NULL OR start_at <= ?)
                    AND (end_at IS NULL OR end_at >= ?)
                    ORDER BY type = 'critical' DESC, created_at DESC
                    LIMIT 5
                `, [now, now]).catch(async () => {
                    // Fallback: try rbac-schema column names
                    return db.all(`
                        SELECT id, title, content, type,
                               CASE WHEN is_global = 1 THEN 'global' ELSE 'platform' END as scope,
                               NULL as app_id
                        FROM announcements
                        ORDER BY type = 'critical' DESC, created_at DESC
                        LIMIT 5
                    `).catch(() => []);
                }) || [];
                
                // Get service statuses
                const services = await db.all(`
                    SELECT service_name, display_name, status, status_message,
                           last_checked as last_check
                    FROM service_status
                    WHERE is_visible = 1
                    ORDER BY sort_order ASC
                `).catch(async () => {
                    // Fallback: try rbac-schema column names
                    return db.all(`
                        SELECT service_name, display_name, status,
                               NULL as status_message, last_check
                        FROM service_status
                        ORDER BY service_name ASC
                    `).catch(() => []);
                }) || [];
                
                res.json({
                    maintenance: maintenanceSetting?.value === 'true',
                    maintenanceMessage: maintenanceMsgSetting?.value || null,
                    announcements: announcements.map(a => ({
                        ...a,
                        is_global: a.scope === 'global' || !a.scope,
                        target_app: a.app_id || null
                    })),
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
        
        // Platform maintenance page (public)
        this.app.get('/platform/maintenance', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/maintenance.html'));
        });
        
        // Public maintenance status API (for maintenance page)
        this.app.get('/platform/maintenance/status', async (req, res) => {
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
        
        // Downloads page
        this.app.get('/platform/downloads', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/downloads.html'));
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

        // Public stats endpoint for /site/ landing page (live bot metrics)
        this.app.get('/api/stats', (req, res) => {
            try {
                const client = this.discordBot?.client;
                const guilds = client?.guilds?.cache;
                const servers = guilds ? guilds.size : 0;
                let users = 0;
                if (guilds) {
                    guilds.forEach(g => { users += g.memberCount || 0; });
                }
                const uptimeSeconds = client?.uptime ? Math.floor(client.uptime / 1000) : 0;
                const uptimePercent = uptimeSeconds > 0 ? '99.9%' : 'N/A';
                res.json({
                    servers,
                    users,
                    uptime: uptimePercent,
                    botUptime: uptimeSeconds,
                    timestamp: new Date().toISOString()
                });
            } catch (err) {
                console.error('[API] Stats error:', err.message);
                res.json({ servers: 0, users: 0, uptime: 'N/A' });
            }
        });

        // Simple root health for platform/Render probes + Pico watchdog
        this.app.get('/health', (req, res) => {
            const monitorToken = process.env.PICO_MONITOR_TOKEN;
            if (monitorToken) {
                const provided = req.headers['x-monitor-token'];
                if (!provided || provided !== monitorToken) {
                    return res.status(401).json({ error: 'Unauthorized' });
                }
            }
            res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
        });
        
        // Auth routes
        this.app.use('/platform/auth', authRoutes);
        
        // Admin auth routes (/signin, /signout)
        this.app.use('/', adminAuthRoutes);
        
        // Public API routes (maintenance status, health, RFID - no auth required)  
        // MUST be mounted BEFORE protected admin routes
        this.app.use('/api', publicApiRoutes);
        
        // Admin v4 public bug report submission (must be before requireAdminAuth middleware)
        this.app.post('/api/v4/admin/bug-reports/submit', async (req, res) => {
            try {
                const queries = require('./admin-v4/db/queries');
                const middleware = require('./admin-v4/middleware');
                const { source, reporter, email, title, description, severity, app_version, environment, logs } = req.body;
                if (!title || !description) {
                    return res.status(400).json({ success: false, error: 'Title and description are required' });
                }
                const report = await queries.createBugReport({
                    source: source || 'site',
                    reporter, email, title, description,
                    severity: severity || 'medium',
                    app_version, environment, logs,
                    user_agent: req.headers['user-agent'],
                    ip_address: middleware.getClientIP(req),
                });
                res.json({ success: true, report });
            } catch (err) {
                console.error('[Admin v4] Bug report submit error:', err);
                res.status(500).json({ success: false, error: 'Failed to submit report' });
            }
        });
        
        // Team Management API routes (under /api/admin for consistency with other admin APIs)
        this.app.use('/api/admin/team', teamManagementRoutes);
        
        // Admin v4 API routes (Enterprise RBAC dashboard)
        this.app.use('/api/v4/admin', adminV4Routes);

        // Backward-compat redirect: old V3 theme CSS path → V4
        this.app.get('/api/v3/theme/css', (req, res) => res.redirect(301, '/api/v4/admin/theme/css'));
        
        // Admin dashboard v4 - Serve the new SPA
        this.app.get('/admin', requireAdminAuth, (req, res) => {
            res.sendFile(path.join(__dirname, 'admin-v4', 'views', 'dashboard.html'));
        });
        
        // Admin dashboard v3 - same message
        this.app.get('/admin/v3', requireAdminAuth, (req, res) => {
            res.redirect('/admin');
        });
        
        // Admin SPA catch-all - same message
        this.app.get('/admin/*', requireAdminAuth, (req, res) => {
            res.redirect('/admin');
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
        
        // Dashboard routes disabled - SecurityDashboard manages its own routes
        
        // Profile API routes
        this.app.use('/platform/profile', profileRoutes);
        
        // Premium payment routes
        const premiumRoutes = require('./routes/premium-api');
        this.app.use('/platform/premium', premiumRoutes);
        
        // Web verification routes
        // GET route to serve the verification page HTML
        this.app.get('/verify/:token', (req, res) => {
            res.sendFile(path.join(__dirname, '../src/dashboard/views/web-verify.html'));
        });
        
        // POST routes for verification API
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
        this.app.get('/site/', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'index.html'));
        });
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
        this.app.get('/site/bug-reports', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'bug-reports.html'));
        });
        this.app.get('/site/documentation', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'documentation.html'));
        });
        this.app.get('/site/support', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'support.html'));
        });
        this.app.get('/site/sitemap', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'sitemap.html'));
        });
        this.app.get('/site/features', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'features.html'));
        });
        this.app.get('/site/pricing', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'pricing.html'));
        });
        this.app.get('/site/updates', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'updates.html'));
        });
        this.app.get('/site/add-bot', (req, res) => {
            res.sendFile(path.join(siteViewsDir, 'add-bot.html'));
        });
        
        // Redirect root to platform
        this.app.get('/', (req, res) => {
            res.redirect('/platform');
        });
        
        // Platform dashboard auth helper
        const dashAuth = async (req, res, next) => {
            const token = req.cookies?.darklock_token;
            if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });
            try {
                const jwt = require('jsonwebtoken');
                const { requireEnv } = require('./utils/env-validator');
                const decoded = jwt.verify(token, requireEnv('JWT_SECRET'));
                req.platformUser = decoded;
                next();
            } catch (err) {
                res.clearCookie('darklock_token');
                return res.status(401).json({ success: false, error: 'Session expired' });
            }
        };

        // Dashboard API - Stats (active apps, sessions)
        this.app.get('/platform/dashboard/api/stats', dashAuth, async (req, res) => {
            try {
                res.json({ success: true, stats: { activeApps: 1 } });
            } catch (err) {
                res.status(500).json({ success: false, error: 'Failed to load stats' });
            }
        });

        // Dashboard API - Recent activity
        this.app.get('/platform/dashboard/api/activity', dashAuth, async (req, res) => {
            try {
                const db = require('./utils/database');
                const user = await db.getUserById(req.platformUser.userId);
                const activity = [];
                if (user?.last_login) {
                    activity.push({ action: 'Logged in to platform', timestamp: user.last_login });
                }
                if (user?.created_at) {
                    activity.push({ action: 'Account created', timestamp: user.created_at });
                }
                if (user?.password_changed_at) {
                    activity.push({ action: 'Password changed', timestamp: user.password_changed_at });
                }
                if (user?.two_factor_enabled_at) {
                    activity.push({ action: '2FA enabled', timestamp: user.two_factor_enabled_at });
                }
                activity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                res.json({ success: true, activity });
            } catch (err) {
                console.error('[Dashboard API] activity error:', err);
                res.status(500).json({ success: false, error: 'Failed to load activity' });
            }
        });

        // Dashboard API - Get current user
        this.app.get('/platform/dashboard/api/me', dashAuth, async (req, res) => {
            try {
                const db = require('./utils/database');
                const user = await db.getUserById(req.platformUser.userId);
                if (!user) return res.status(404).json({ success: false, error: 'User not found' });
                const settings = user.settings || {};
                res.json({
                    success: true,
                    user: {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        role: user.role,
                        avatar: user.avatar || null,
                        banner: user.banner || null,
                        displayName: user.display_name || user.username,
                        twoFactorEnabled: !!user.two_factor_enabled,
                        oauthProvider: user.oauth_provider || null,
                        createdAt: user.created_at,
                        lastLogin: user.last_login,
                        language: settings.language || 'en',
                        timezone: settings.timezone || 'UTC',
                        settings: settings
                    }
                });
            } catch (err) {
                console.error('[Dashboard API] /me error:', err);
                res.status(500).json({ success: false, error: 'Failed to load user data' });
            }
        });

        // Dashboard API - Get/Save settings
        this.app.get('/platform/dashboard/api/settings', dashAuth, async (req, res) => {
            try {
                const db = require('./utils/database');
                const user = await db.getUserById(req.platformUser.userId);
                res.json({ success: true, settings: user?.settings || {} });
            } catch (err) {
                res.status(500).json({ success: false, error: 'Failed to load settings' });
            }
        });

        this.app.post('/platform/dashboard/api/settings', express.json(), dashAuth, async (req, res) => {
            try {
                const db = require('./utils/database');
                const user = await db.getUserById(req.platformUser.userId);
                if (!user) return res.status(404).json({ success: false, error: 'User not found' });
                const merged = { ...(user.settings || {}), ...req.body };
                await db.run('UPDATE users SET settings = ? WHERE id = ?', [JSON.stringify(merged), user.id]);
                res.json({ success: true });
            } catch (err) {
                console.error('[Dashboard API] settings save error:', err);
                res.status(500).json({ success: false, error: 'Failed to save settings' });
            }
        });

        // Platform dashboard — serve dashboard or redirect to platform sign-in
        this.app.get('/platform/dashboard', async (req, res) => {
            const token = req.cookies?.darklock_token;
            if (!token) return res.redirect('/platform/auth/login');
            try {
                const jwt = require('jsonwebtoken');
                const { requireEnv } = require('./utils/env-validator');
                jwt.verify(token, requireEnv('JWT_SECRET'));
                const { resolveView } = require('./utils/theme-resolver');
                return res.sendFile(resolveView('dashboard.html'));
            } catch (err) {
                res.clearCookie('darklock_token');
                return res.redirect('/platform/auth/login');
            }
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
            setPlatformDiscordBot?.(bot);
            console.log('[Darklock Platform] Discord bot reference set for admin API');
        }
        
        // Initialize database and admin tables before mounting routes
        try {
            await db.initialize();
            await initializeAdminTables();
            await initializeAdminSchema();
            // Team schema initialized manually via setup-team-db.js
            // await initializeTeamSchema();
            
            // Initialize RBAC schema (roles, permissions, maintenance state, etc.)
            console.log('[Darklock Platform] Initializing RBAC schema...');
            // Fix legacy role_permissions table schema conflict
            const rpCols1 = await db.all(`PRAGMA table_info(role_permissions)`);
            if (rpCols1.length > 0 && !rpCols1.some(c => c.name === 'role_id')) {
                console.log('[Darklock Platform] Migrating legacy role_permissions table...');
                await db.run(`DROP TABLE IF EXISTS role_permissions`);
            }
            await rbacSchema.initializeRBACSchema();
            
            await initializeDefaultAdmins();
            
            // Initialize Admin v4 schema (announcements, app_updates, bug_reports_v2, etc.)
            console.log('[Darklock Platform] Initializing Admin v4 schema...');
            await initializeV4Schema();
            
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
        existingApp.use('/platform/downloads/files', express.static(path.join(__dirname, 'downloads')));
        
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
            const { resolveView } = require('./utils/theme-resolver');
            const htmlPath = resolveView('home.html');
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

        // Darklock Secure Channel - Download page (existingApp integration)
        existingApp.get('/platform/download/secure-channel', (req, res) => {
            const scPage = path.join(__dirname, 'views', 'secure-channel-download.html');
            res.sendFile(scPage, (err) => {
                if (err) {
                    console.error('[SecureChannel] sendFile error:', err.message, scPage);
                    if (!res.headersSent) res.status(500).send('Error loading page');
                }
            });
        });

        // Darklock Secure Notes - Web App (PWA, installable on iOS/Android)
        const notesWebDist = path.join(__dirname, '../darklock-notes/apps/web/dist');
        existingApp.use('/platform/notes', express.static(notesWebDist));
        existingApp.get('/platform/notes/*', (req, res) => {
            res.sendFile(path.join(notesWebDist, 'index.html'));
        });

        // Darklock Secure Notes - Notes server API proxy (/api/notes/* → localhost:3003/api/*)
        existingApp.all('/api/notes/*', (req, res) => {
            const notesServerPort = parseInt(process.env.NOTES_SERVER_PORT || '3003', 10);
            const targetPath = req.originalUrl.replace('/api/notes', '/api');
            const body = req.body ? JSON.stringify(req.body) : undefined;
            const reqHeaders = { ...req.headers, host: `localhost:${notesServerPort}` };
            // Strip browser Origin/Referer — this is a server-side proxy; CORS doesn't apply
            delete reqHeaders['origin'];
            delete reqHeaders['referer'];
            if (body) {
                reqHeaders['content-type'] = 'application/json';
                reqHeaders['content-length'] = String(Buffer.byteLength(body));
            }
            const options = {
                hostname: 'localhost',
                port: notesServerPort,
                path: targetPath,
                method: req.method,
                headers: reqHeaders,
            };
            const proxyReq = http.request(options, (proxyRes) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res, { end: true });
            });
            proxyReq.on('error', () => {
                if (!res.headersSent) res.status(502).json({ success: false, error: 'Notes server unavailable' });
            });
            if (body) proxyReq.write(body);
            proxyReq.end();
        });

        // Darklock Secure Notes - Download page (URL accessible, not linked from nav)
        existingApp.get('/platform/download/darklock-notes', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/darklock-notes-download.html'));
        });

        // Darklock Secure Notes - Web Monitor
        existingApp.get('/platform/monitor/darklock-notes', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/notes-monitor.html'));
        });

        // Darklock Secure Notes - Monitor status API (instances push data here)
        existingApp.get('/platform/api/notes/monitor/status', (req, res) => {
            res.json({ instances: [], events: [], lastSync: null });
        });

        // Darklock Secure Notes - Installer download (existingApp integration)
        existingApp.get('/platform/api/download/darklock-notes-installer', (req, res) => {
            const format = (req.query.format || 'deb').toLowerCase();
            const fs = require('fs');
            const version = '1.0.0';
            const bundleBase = path.join(__dirname, '../darklock-notes/apps/desktop/src-tauri/target/release/bundle');
            const electronRelease = path.join(__dirname, '../darklock-notes/apps/desktop/release');

            console.log(`[DarklockNotes] Download request for format: ${format} from IP: ${req.ip}`);

            // TestFlight redirect
            if (format === 'testflight') {
                const tfUrl = process.env.TESTFLIGHT_NOTES_URL || null;
                if (tfUrl) return res.redirect(302, tfUrl);
                return res.redirect('/platform/download/darklock-notes');
            }

            const fileLocations = {
                deb: [
                    path.join(electronRelease, `DarklockSecureNotes-${version}-linux-amd64.deb`),
                    path.join(__dirname, `downloads/DarklockSecureNotes-${version}-linux-amd64.deb`),
                    path.join(bundleBase, `deb/Darklock Notes_${version}_amd64.deb`),
                    path.join(bundleBase, `deb/darklock-notes_${version}_amd64.deb`),
                    path.join(__dirname, `downloads/darklock-notes_${version}_amd64.deb`)
                ],
                appimage: [
                    path.join(electronRelease, `DarklockSecureNotes-${version}-linux-x86_64.AppImage`),
                    path.join(__dirname, `downloads/DarklockSecureNotes-${version}-linux-x86_64.AppImage`),
                    path.join(bundleBase, `appimage/Darklock Notes_${version}_amd64.AppImage`),
                    path.join(bundleBase, `appimage/darklock-notes_${version}_amd64.AppImage`),
                    path.join(__dirname, `downloads/darklock-notes_${version}_amd64.AppImage`)
                ],
                ipa: [
                    path.join(__dirname, `downloads/darklock-notes_${version}.ipa`),
                    path.join(__dirname, 'downloads/darklock-notes.ipa')
                ]
            };

            let searchFormats = [];
            if (format === 'deb' || format === 'linux') searchFormats = ['deb'];
            else if (format === 'appimage') searchFormats = ['appimage'];
            else if (format === 'ipa' || format === 'ios') searchFormats = ['ipa'];
            else searchFormats = ['deb'];

            for (const fmt of searchFormats) {
                for (const filePath of (fileLocations[fmt] || [])) {
                    if (fs.existsSync(filePath)) {
                        console.log(`[DarklockNotes] Serving installer: ${path.basename(filePath)}`);
                        return res.download(filePath, path.basename(filePath));
                    }
                }
            }

            console.error(`[DarklockNotes] Installer not found for format: ${format}`);
            return res.status(404).send(`
                <html>
                    <head><title>Installer Not Available</title>
                    <style>body{background:#0b0f1a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:system-ui}.card{background:#111827;border:1px solid rgba(99,102,241,.35);padding:32px;border-radius:12px;max-width:560px;text-align:center}h1{margin:0 0 12px}p{color:#94a3b8;line-height:1.6}code{background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px}a.btn{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#00d4ff);color:#fff;text-decoration:none}</style>
                    </head>
                    <body>
                        <div class="card">
                            <h1>Installer Not Available</h1>
                            <p>The <strong>${format}</strong> installer has not been built yet.</p>
                            <p>Build it with: <code>cd darklock-notes && npm run build:desktop</code></p>
                            <a class="btn" href="/platform/download/darklock-notes">Back to Downloads</a>
                        </div>
                    </body>
                </html>
            `);
        });

        // Darklock Guard - Actual installer download (existingApp integration)
        existingApp.get('/platform/api/download/darklock-guard-installer', (req, res) => {
            const format = (req.query.format || 'deb').toLowerCase();
            const fs = require('fs');
            const latestVersion = '2.0.0-beta.3';

            // New Tauri bundle locations
            const bundleBase = path.join(__dirname, '../guard-v2/target/release/bundle');
            const debPath = path.join(bundleBase, `deb/Darklock Guard_${latestVersion}_amd64.deb`);
            const debPathDownloads = path.join(__dirname, `downloads/darklock-guard_${latestVersion}_amd64.deb`);
            const debPathLegacy = path.join(__dirname, 'downloads/darklock-guard_0.1.0_amd64.deb');
            const portablePath = path.join(bundleBase, 'DarklockGuard-linux-portable.tar.gz');
            const portablePathDownloads = path.join(__dirname, 'downloads/darklock-guard-linux-portable.tar.gz');

            // Legacy Windows installers (until new signed builds are produced on Windows)
            const legacyNsis = path.join(__dirname, 'downloads/darklock-guard-setup.exe');
            const legacyMsi = path.join(__dirname, 'downloads/darklock-guard-setup.msi');

            console.log(`[Darklock] (existingApp) Download request for format: ${format} from IP: ${req.ip}`);

            // Linux packages (new app) - try multiple locations
            if (format === 'deb' || format === 'linux') {
                if (fs.existsSync(debPathDownloads)) {
                    console.log('[Darklock] Serving Debian package from downloads');
                    return res.download(debPathDownloads, `darklock-guard_${latestVersion}_amd64.deb`);
                }
                if (fs.existsSync(debPath)) {
                    console.log('[Darklock] Serving Debian package from bundle');
                    return res.download(debPath, `darklock-guard_${latestVersion}_amd64.deb`);
                }
                if (fs.existsSync(debPathLegacy)) {
                    console.log('[Darklock] Serving legacy Debian package');
                    return res.download(debPathLegacy, 'darklock-guard_0.1.0_amd64.deb');
                }
            }

            if (format === 'tar' || format === 'portable') {
                if (fs.existsSync(portablePathDownloads)) {
                    console.log('[Darklock] Serving portable tarball from downloads');
                    return res.download(portablePathDownloads, 'darklock-guard-linux-portable.tar.gz');
                }
                if (fs.existsSync(portablePath)) {
                    console.log('[Darklock] Serving portable tarball from bundle');
                    return res.download(portablePath, 'darklock-guard-linux-portable.tar.gz');
                }
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
        
        // Darklock Secure Channel - Installer download (existingApp integration)
        existingApp.get('/platform/api/download/secure-channel-installer', (req, res) => {
            const format = (req.query.format || 'deb').toLowerCase();
            const fs = require('fs');
            const version = '1.1.0';

            console.log(`[SecureChannel] (existingApp) Download request for format: ${format} from IP: ${req.ip}`);

            const electronRelease = path.join(__dirname, '../secure-channel/apps/dl-secure-channel/release');

            const fileLocations = {
                deb: [
                    path.join(__dirname, `downloads/DarklockSecureChannel-${version}-linux-amd64.deb`),
                    path.join(electronRelease, `DarklockSecureChannel-${version}-linux-amd64.deb`),
                    path.join(__dirname, 'downloads/DarklockSecureChannel-1.0.0-linux-amd64.deb'),
                    path.join(electronRelease, 'DarklockSecureChannel-1.0.0-linux-amd64.deb')
                ],
                appimage: [
                    path.join(__dirname, `downloads/DarklockSecureChannel-${version}-linux-x86_64.AppImage`),
                    path.join(electronRelease, `DarklockSecureChannel-${version}-linux-x86_64.AppImage`),
                    path.join(__dirname, 'downloads/DarklockSecureChannel-1.0.0-linux-x86_64.AppImage'),
                    path.join(electronRelease, 'DarklockSecureChannel-1.0.0-linux-x86_64.AppImage')
                ],
                exe: [
                    path.join(__dirname, `downloads/DarklockSecureChannel-${version}-win-x64.exe`),
                    path.join(electronRelease, `DarklockSecureChannel-${version}-win-x64.exe`),
                    path.join(__dirname, 'downloads/DarklockSecureChannel-1.0.0-win-x64.exe'),
                    path.join(electronRelease, 'DarklockSecureChannel-1.0.0-win-x64.exe')
                ]
            };

            const fmtKey = format === 'appimage' ? 'appimage' : format === 'exe' || format === 'windows' ? 'exe' : 'deb';
            for (const filePath of (fileLocations[fmtKey] || [])) {
                if (fs.existsSync(filePath)) {
                    return res.download(filePath, path.basename(filePath));
                }
            }

            return res.status(404).send(`
                <html>
                    <head><title>Installer Not Available</title>
                    <style>body{background:#0a0a0f;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:system-ui}.card{background:#111827;border:1px solid rgba(0,212,255,.35);padding:32px;border-radius:12px;max-width:560px;text-align:center}p{color:#94a3b8}a.btn{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:8px;background:linear-gradient(135deg,#00d4ff,#7c4dff);color:#fff;text-decoration:none}</style></head>
                    <body><div class="card"><h1>Installer Not Available</h1>
                    <p>The <strong>${format}</strong> installer for Darklock Secure Channel is not available at this time.</p>
                    <a class="btn" href="/platform/download/secure-channel">Back to downloads</a></div></body>
                </html>
            `);
        });
        
        // Darklock Guard - Web Monitor (requires platform user authentication)
        existingApp.get('/platform/monitor/darklock-guard', (req, res) => {
            const token = req.cookies?.darklock_token;
            if (!token) return res.redirect('/platform/auth/login');
            try {
                const jwt = require('jsonwebtoken');
                const { requireEnv } = require('./utils/env-validator');
                jwt.verify(token, requireEnv('JWT_SECRET'));
            } catch {
                res.clearCookie('darklock_token');
                return res.redirect('/platform/auth/login');
            }
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
        
        // Downloads page
        existingApp.get('/platform/downloads', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/downloads.html'));
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
        
        // Simple root health when mounted on existing app + Pico watchdog
        existingApp.get('/health', (req, res) => {
            const monitorToken = process.env.PICO_MONITOR_TOKEN;
            if (monitorToken) {
                const provided = req.headers['x-monitor-token'];
                if (!provided || provided !== monitorToken) {
                    return res.status(401).json({ error: 'Unauthorized' });
                }
            }
            res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
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
        
        // Public API routes (maintenance status, health, RFID - no auth required)
        // MUST be mounted BEFORE protected admin routes
        console.log('[Darklock Platform] Registering public API routes at /api');
        existingApp.use('/api', publicApiRoutes);
        
        // Team Management API routes
        console.log('[Darklock Platform] Registering team management routes at /api/admin/team');
        existingApp.use('/api/admin/team', teamManagementRoutes);
        
// Admin v4 API routes (Enterprise RBAC dashboard)
        existingApp.use('/api/v4/admin', adminV4Routes);

        // Admin v4 public bug report submission (must be before requireAdminAuth middleware)
        existingApp.post('/api/v4/admin/bug-reports/submit', async (req, res) => {
            try {
                const queries = require('./admin-v4/db/queries');
                const middleware = require('./admin-v4/middleware');
                await middleware.validateBugReport(req, res, async () => {
                    const result = await queries.createBugReport(req.body);
                    res.json({ success: true, id: result.id });
                });
            } catch (err) {
                console.error('[Admin v4] Bug report submit error:', err);
                res.status(500).json({ error: 'Failed to submit bug report' });
            }
        });

        // Backward-compat redirect: old V3 theme CSS path → V4
        existingApp.get('/api/v3/theme/css', (req, res) => res.redirect(301, '/api/v4/admin/theme/css'));

        // Admin v4 dashboard (main admin dashboard)
        existingApp.get('/admin', requireAdminAuth, (req, res) => {
            res.sendFile(path.join(__dirname, 'admin-v4', 'views', 'dashboard.html'));
        });
        existingApp.get('/admin/v3', requireAdminAuth, (req, res) => res.redirect('/admin'));
        existingApp.get('/admin/dashboard', requireAdminAuth, (req, res) => res.redirect('/admin'));
        existingApp.get('/admin/*', requireAdminAuth, (req, res) => res.redirect('/admin'));
        
        // Dashboard routes disabled - SecurityDashboard manages its own routes
        
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
        
        // Platform dashboard auth helper
        const dashAuth = async (req, res, next) => {
            const token = req.cookies?.darklock_token;
            if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });
            try {
                const jwt = require('jsonwebtoken');
                const { requireEnv } = require('./utils/env-validator');
                const decoded = jwt.verify(token, requireEnv('JWT_SECRET'));
                req.platformUser = decoded;
                next();
            } catch (err) {
                res.clearCookie('darklock_token');
                return res.status(401).json({ success: false, error: 'Session expired' });
            }
        };

        // Dashboard API - Stats (active apps, sessions)
        existingApp.get('/platform/dashboard/api/stats', dashAuth, async (req, res) => {
            try {
                res.json({ success: true, stats: { activeApps: 1 } });
            } catch (err) {
                res.status(500).json({ success: false, error: 'Failed to load stats' });
            }
        });

        // Dashboard API - Recent activity
        existingApp.get('/platform/dashboard/api/activity', dashAuth, async (req, res) => {
            try {
                const db = require('./utils/database');
                const user = await db.getUserById(req.platformUser.userId);
                const activity = [];
                if (user?.last_login) {
                    activity.push({ action: 'Logged in to platform', timestamp: user.last_login });
                }
                if (user?.created_at) {
                    activity.push({ action: 'Account created', timestamp: user.created_at });
                }
                if (user?.password_changed_at) {
                    activity.push({ action: 'Password changed', timestamp: user.password_changed_at });
                }
                if (user?.two_factor_enabled_at) {
                    activity.push({ action: '2FA enabled', timestamp: user.two_factor_enabled_at });
                }
                activity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                res.json({ success: true, activity });
            } catch (err) {
                console.error('[Dashboard API] activity error:', err);
                res.status(500).json({ success: false, error: 'Failed to load activity' });
            }
        });

        // Dashboard API - Get current user
        existingApp.get('/platform/dashboard/api/me', dashAuth, async (req, res) => {
            try {
                const db = require('./utils/database');
                const user = await db.getUserById(req.platformUser.userId);
                if (!user) return res.status(404).json({ success: false, error: 'User not found' });
                const settings = user.settings || {};
                res.json({
                    success: true,
                    user: {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        role: user.role,
                        avatar: user.avatar || null,
                        banner: user.banner || null,
                        displayName: user.display_name || user.username,
                        twoFactorEnabled: !!user.two_factor_enabled,
                        oauthProvider: user.oauth_provider || null,
                        createdAt: user.created_at,
                        lastLogin: user.last_login,
                        language: settings.language || 'en',
                        timezone: settings.timezone || 'UTC',
                        settings: settings
                    }
                });
            } catch (err) {
                console.error('[Dashboard API] /me error:', err);
                res.status(500).json({ success: false, error: 'Failed to load user data' });
            }
        });

        // Dashboard API - Get/Save settings
        existingApp.get('/platform/dashboard/api/settings', dashAuth, async (req, res) => {
            try {
                const db = require('./utils/database');
                const user = await db.getUserById(req.platformUser.userId);
                res.json({ success: true, settings: user?.settings || {} });
            } catch (err) {
                res.status(500).json({ success: false, error: 'Failed to load settings' });
            }
        });

        existingApp.post('/platform/dashboard/api/settings', express.json(), dashAuth, async (req, res) => {
            try {
                const db = require('./utils/database');
                const user = await db.getUserById(req.platformUser.userId);
                if (!user) return res.status(404).json({ success: false, error: 'User not found' });
                const merged = { ...(user.settings || {}), ...req.body };
                await db.run('UPDATE users SET settings = ? WHERE id = ?', [JSON.stringify(merged), user.id]);
                res.json({ success: true });
            } catch (err) {
                console.error('[Dashboard API] settings save error:', err);
                res.status(500).json({ success: false, error: 'Failed to save settings' });
            }
        });

        // Platform dashboard — serve dashboard or redirect to platform sign-in
        existingApp.get('/platform/dashboard', async (req, res) => {
            const token = req.cookies?.darklock_token;
            if (!token) return res.redirect('/platform/auth/login');
            try {
                const jwt = require('jsonwebtoken');
                const { requireEnv } = require('./utils/env-validator');
                jwt.verify(token, requireEnv('JWT_SECRET'));
                const { resolveView } = require('./utils/theme-resolver');
                return res.sendFile(resolveView('dashboard.html'));
            } catch (err) {
                res.clearCookie('darklock_token');
                return res.redirect('/platform/auth/login');
            }
        });

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
                
                // Initialize team management schema
                console.log('[Darklock Platform] Initializing team management schema...');
                await initializeTeamSchema();
                
                // Initialize RBAC schema (roles, permissions, etc.)
                console.log('[Darklock Platform] Initializing RBAC schema...');
                // Fix legacy role_permissions table schema conflict
                const rpCols = await db.all(`PRAGMA table_info(role_permissions)`);
                if (rpCols.length > 0 && !rpCols.some(c => c.name === 'role_id')) {
                    console.log('[Darklock Platform] Migrating legacy role_permissions table...');
                    await db.run(`DROP TABLE IF EXISTS role_permissions`);
                }
                await rbacSchema.initializeRBACSchema();
                
                // Initialize default admin accounts (only if no admins exist)
                console.log('[Darklock Platform] Checking for default admin accounts...');
                await initializeDefaultAdmins();
                
                // Initialize Admin v4 schema
                console.log('[Darklock Platform] Initializing Admin v4 schema...');
                await initializeV4Schema();
                
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
                
                // Check for SSL certificates and use HTTPS if available
                const sslKeyPath = path.join(__dirname, 'ssl', 'key.pem');
                const sslCertPath = path.join(__dirname, 'ssl', 'cert.pem');
                
                if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
                    // HTTPS mode
                    const httpsOptions = {
                        key: fs.readFileSync(sslKeyPath),
                        cert: fs.readFileSync(sslCertPath)
                    };
                    
                    this.server = https.createServer(httpsOptions, this.app).listen(this.port, '0.0.0.0', () => {
                        console.log(`[Darklock Platform] ✅ HTTPS server running on port ${this.port}`);
                        console.log(`[Darklock Platform] Homepage: https://0.0.0.0:${this.port}/platform`);
                        console.log(`[Darklock Platform] ⚠ Using self-signed certificate - accept security warning in browser`);
                        resolve(this.server);
                    });
                } else {
                    // HTTP mode
                    this.server = http.createServer(this.app).listen(this.port, '0.0.0.0', () => {
                        console.log(`[Darklock Platform] ✅ HTTP server running on port ${this.port}`);
                        console.log(`[Darklock Platform] Homepage: http://0.0.0.0:${this.port}/platform`);
                        console.log(`[Darklock Platform] ℹ To enable HTTPS, run: ./darklock/generate-ssl-cert.sh`);
                        resolve(this.server);
                    });
                }
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

// Auto-start server when run directly
if (require.main === module) {
    (async () => {
        console.log('[Darklock Platform] Starting standalone server...');
        const platform = new DarklockPlatform({ port: 3002 });
        await platform.start();
    })().catch(err => {
        console.error('[Darklock Platform] Failed to start:', err);
        process.exit(1);
    });
}
