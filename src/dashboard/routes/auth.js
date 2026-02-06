/**
 * Authentication Routes
 * Handles login, logout, OAuth callbacks, and session management
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const axios = require('axios');
const { sessionStore, generateCSRFToken, recordFailedLogin, resetLoginAttempts, parseDevice, parseBrowser, parseOS } = require('../security-utils');
const { t } = require('../../../locale');

class AuthRoutes {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.bot = dashboard.bot;
        this.router = express.Router();
        this.discordTokenCache = new Map();
        
        this.setupRoutes();
    }

    setupRoutes() {
        // Discord OAuth login initiation
        this.router.get('/discord', this.discordLogin.bind(this));
        
        // Discord OAuth callback
        this.router.get('/discord/callback', this.discordCallback.bind(this));
        
        // Traditional login (username/password)
        this.router.post('/login', 
            this.dashboard.middleware.checkBruteForce.bind(this.dashboard.middleware),
            this.login.bind(this)
        );
        
        // Logout
        this.router.post('/logout', this.logout.bind(this));
        
        // Session status check
        this.router.get('/me', 
            this.dashboard.middleware.authenticateToken.bind(this.dashboard.middleware),
            this.getMe.bind(this)
        );
        
        // Refresh token
        this.router.post('/refresh', this.refreshToken.bind(this));
        
        // Get CSRF token
        this.router.get('/csrf', this.getCSRFToken.bind(this));
    }

    /**
     * Initiate Discord OAuth flow
     */
    async discordLogin(req, res) {
        const { clientId, redirectUri, scope } = this.dashboard.discordConfig;
        
        if (!clientId) {
            return res.status(500).json({ error: 'Discord OAuth not configured' });
        }

        // Generate state for CSRF protection
        const state = require('crypto').randomBytes(16).toString('hex');
        
        // Store state in session
        if (!req.session) req.session = {};
        req.session.oauthState = state;

        const authUrl = `https://discord.com/api/oauth2/authorize?` +
            `client_id=${clientId}&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent(scope)}&` +
            `state=${state}`;

        res.redirect(authUrl);
    }

    /**
     * Handle Discord OAuth callback
     */
    async discordCallback(req, res) {
        const { code, state, error } = req.query;
        const redirectUrl = process.env.DASHBOARD_ORIGIN || 'http://localhost:3001';

        if (error) {
            return res.redirect(`${redirectUrl}/login.html?error=${encodeURIComponent(error)}`);
        }

        if (!code) {
            return res.redirect(`${redirectUrl}/login.html?error=no_code`);
        }

        // CSRF Protection: Validate OAuth state parameter
        const expectedState = req.session?.oauthState;
        if (!state || !expectedState || state !== expectedState) {
            console.error('[OAuth] State mismatch - possible CSRF attack');
            console.error(`[OAuth] Expected: ${expectedState}, Received: ${state}`);
            // Clear the state to prevent replay
            if (req.session) delete req.session.oauthState;
            return res.redirect(`${redirectUrl}/login.html?error=invalid_state`);
        }
        
        // Clear the state - one-time use only
        delete req.session.oauthState;

        try {
            const { clientId, clientSecret, redirectUri } = this.dashboard.discordConfig;

            // Exchange code for tokens
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
                new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirectUri
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const { access_token, refresh_token, expires_in } = tokenResponse.data;

            // Fetch user info
            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${access_token}` }
            });

            const discordUser = userResponse.data;

            // Fetch user's guilds
            const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
                headers: { Authorization: `Bearer ${access_token}` }
            });

            // Check if user has admin access to any guild the bot is in
            const userGuilds = guildsResponse.data;
            const botGuilds = this.bot.client.guilds.cache;
            
            const managableGuilds = userGuilds.filter(g => {
                const hasManageGuild = (parseInt(g.permissions) & 0x20) === 0x20;
                const isOwner = g.owner;
                const botInGuild = botGuilds.has(g.id);
                return botInGuild && (hasManageGuild || isOwner);
            });

            // Determine role
            let role = 'user';
            const isOwner = process.env.BOT_OWNER_IDS?.split(',').includes(discordUser.id);
            if (isOwner) {
                role = 'owner';
            } else if (managableGuilds.length > 0) {
                role = 'admin';
            }

            // Check if user has 2FA enabled
            const has2FA = await this.dashboard.twoFactorAuth?.isDiscordUser2FAEnabled(discordUser.id);
            
            if (has2FA) {
                // Create pending session for 2FA verification
                const pendingSessionId = require('crypto').randomBytes(32).toString('hex');
                
                // Store pending session (expires in 5 minutes)
                if (!this.pending2FASessions) {
                    this.pending2FASessions = new Map();
                }
                
                this.pending2FASessions.set(pendingSessionId, {
                    userId: discordUser.id,
                    username: discordUser.username,
                    globalName: discordUser.global_name,
                    discriminator: discordUser.discriminator,
                    avatar: discordUser.avatar,
                    email: discordUser.email,
                    role,
                    guilds: managableGuilds.map(g => g.id),
                    accessToken: access_token,
                    refreshToken: refresh_token,
                    tokenExpiresIn: expires_in,
                    createdAt: Date.now(),
                    expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
                });
                
                // Clean up old pending sessions
                for (const [id, session] of this.pending2FASessions.entries()) {
                    if (Date.now() > session.expiresAt) {
                        this.pending2FASessions.delete(id);
                    }
                }
                
                // Redirect to 2FA verification page
                return res.redirect(`${redirectUrl}/verify-2fa?session=${pendingSessionId}`);
            }

            // No 2FA - proceed normally
            // Create session
            const sessionId = require('crypto').randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

            // Parse user-agent for device/browser/OS
            const userAgent = req.headers['user-agent'] || '';
            const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
            const device = parseDevice(userAgent);
            const browser = parseBrowser(userAgent);
            const os = parseOS(userAgent);

            sessionStore.set(sessionId, {
                userId: discordUser.id,
                username: discordUser.username,
                discriminator: discordUser.discriminator,
                avatar: discordUser.avatar,
                email: discordUser.email,
                role,
                guilds: managableGuilds.map(g => g.id),
                expiresAt,
                createdAt: new Date()
            });

            // Save session to database for persistence
            try {
                await this.bot.database.run(`
                    INSERT INTO user_sessions (session_id, user_id, device, browser, os, ip_address, created_at, last_active, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)
                `, [sessionId, discordUser.id, device, browser, os, ipAddress, expiresAt.toISOString()]);
            } catch (dbError) {
                this.bot.logger?.error('Failed to save session to database:', dbError);
                // Continue anyway - session still in memory
            }

            // Store Discord tokens for API calls
            this.discordTokenCache.set(discordUser.id, {
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresAt: new Date(Date.now() + expires_in * 1000)
            });

            // Generate JWT
            const token = jwt.sign({
                sessionId,
                userId: discordUser.id,
                username: discordUser.username,
                role,
                isAdmin: role === 'admin' || role === 'owner'
            }, process.env.JWT_SECRET, { expiresIn: '24h' });

            // Set cookie and redirect
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000
            });

            // Discord OAuth ALWAYS redirects to user dashboard
            // Admin dashboard is ONLY accessible via username/password login
            this.bot.logger?.info(`Discord OAuth: Redirecting user ${discordUser.username} to user dashboard (role: ${role})`);
            res.redirect(`${redirectUrl}/dashboard.html`);

        } catch (error) {
            this.bot.logger?.error('Discord OAuth error:', error);
            res.redirect(`${redirectUrl}/login.html?error=oauth_failed`);
        }
    }

    /**
     * Traditional username/password login
     */
    async login(req, res) {
        const { username, password, twoFactorCode } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: t('en', 'errors.login.missing_credentials') || 'Username and password required' });
        }

        try {
            // Find admin user
            const admin = await this.bot.database.get(
                'SELECT * FROM dashboard_admins WHERE username = ?',
                [username]
            );

            if (!admin) {
                recordFailedLogin(req.ip);
                return res.status(401).json({ error: t('en', 'errors.login.invalid_credentials') || 'Invalid credentials' });
            }

            // Verify password
            const validPassword = await bcrypt.compare(password, admin.password_hash);
            if (!validPassword) {
                recordFailedLogin(req.ip);
                return res.status(401).json({ error: t('en', 'errors.login.invalid_credentials') || 'Invalid credentials' });
            }

            // Check 2FA if enabled
            if (admin.two_factor_enabled) {
                if (!twoFactorCode) {
                    return res.status(200).json({ requires2FA: true });
                }

                const validCode = await this.dashboard.twoFactorAuth.verifyToken(admin.id, twoFactorCode);
                if (!validCode) {
                    return res.status(401).json({ error: t('en', 'errors.login.invalid_2fa') || 'Invalid 2FA code' });
                }
            }

            // Reset brute force counter on successful login
            resetLoginAttempts(req.ip);

            // Create session
            const sessionId = require('crypto').randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            sessionStore.set(sessionId, {
                userId: admin.discord_id || admin.id,
                username: admin.username,
                role: admin.role || 'admin',
                expiresAt,
                createdAt: new Date()
            });

            // Generate JWT
            const token = jwt.sign({
                sessionId,
                userId: admin.discord_id || admin.id,
                username: admin.username,
                role: admin.role,
                isAdmin: true
            }, process.env.JWT_SECRET, { expiresIn: '24h' });

            // Update last login
            await this.bot.database.run(
                'UPDATE dashboard_admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
                [admin.id]
            );

            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000
            });

            res.json({ 
                success: true, 
                user: {
                    username: admin.username,
                    role: admin.role
                }
            });

        } catch (error) {
            this.bot.logger?.error('Login error:', error);
            res.status(500).json({ error: 'Login failed' });
        }
    }

    /**
     * Logout and revoke session
     */
    async logout(req, res) {
        try {
            // Get token from cookie or header
            const token = req.cookies?.auth_token || req.headers['authorization']?.replace('Bearer ', '');
            
            if (token) {
                try {
                    const decoded = jwt.verify(token, process.env.JWT_SECRET);
                    
                    // Revoke session
                    const session = sessionStore.get(decoded.sessionId);
                    if (session) {
                        session.revoked = true;
                        session.revokedAt = new Date();
                        sessionStore.set(decoded.sessionId, session);
                    }
                } catch (e) {
                    // Token invalid, continue with logout
                }
            }

            // Clear cookie
            res.clearCookie('auth_token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax'
            });

            res.json({ success: true });

        } catch (error) {
            res.status(500).json({ error: 'Logout failed' });
        }
    }

    /**
     * Get current user info
     */
    async getMe(req, res) {
        try {
            const session = sessionStore.get(req.user.sessionId);
            
            res.json({
                userId: req.user.userId,
                username: req.user.username,
                role: req.user.role,
                isAdmin: req.user.isAdmin,
                guilds: session?.guilds || [],
                avatar: session?.avatar
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to get user info' });
        }
    }

    /**
     * Refresh JWT token
     */
    async refreshToken(req, res) {
        const token = req.cookies?.auth_token;
        
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
            const session = sessionStore.get(decoded.sessionId);

            if (!session || session.revoked) {
                return res.status(401).json({ error: 'Session invalid' });
            }

            // Enforce maximum refresh window: 7 days from session creation
            const MAX_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
            const sessionAge = Date.now() - new Date(session.createdAt).getTime();
            if (sessionAge > MAX_REFRESH_WINDOW_MS) {
                session.revoked = true;
                session.revokedAt = new Date();
                sessionStore.set(decoded.sessionId, session);
                return res.status(401).json({ error: 'Session expired. Please log in again.' });
            }

            // Extend session
            session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            sessionStore.set(decoded.sessionId, session);

            // Generate new token
            const newToken = jwt.sign({
                sessionId: decoded.sessionId,
                userId: decoded.userId,
                username: decoded.username,
                role: decoded.role,
                isAdmin: decoded.isAdmin
            }, process.env.JWT_SECRET, { expiresIn: '24h' });

            res.cookie('auth_token', newToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000
            });

            res.json({ success: true });

        } catch (error) {
            res.status(401).json({ error: 'Token refresh failed' });
        }
    }

    /**
     * Get CSRF token for forms
     */
    getCSRFToken(req, res) {
        if (!req.session) req.session = {};
        if (!req.session.csrfToken) {
            req.session.csrfToken = generateCSRFToken();
        }
        res.json({ csrfToken: req.session.csrfToken });
    }

    getRouter() {
        return this.router;
    }
}

module.exports = AuthRoutes;
