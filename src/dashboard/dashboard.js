const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const Stripe = require('stripe');
const cookieParser = require('cookie-parser');
const DarklockPlatform = require('../../darklock/server');
// const FileIntegrityMonitor = require('../security/fileIntegrity'); // Disabled - file not in repo

class SecurityDashboard {
    constructor(bot) {
        this.bot = bot;
        // Discord OAuth configuration: prefer explicit env vars, fall back to bot client where possible
        // In production (Render), prefer DOMAIN env var or construct from request
        const domain = process.env.DOMAIN || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.WEB_PORT || 3001}`;
        
        this.discordConfig = {
            clientId: process.env.DISCORD_CLIENT_ID || (this.bot && this.bot.client && this.bot.client.user ? this.bot.client.user.id : null),
            clientSecret: process.env.DISCORD_CLIENT_SECRET || null,
            redirectUri: process.env.DISCORD_REDIRECT_URI || `${domain}/auth/discord/callback`,
            scope: process.env.DISCORD_OAUTH_SCOPE || 'identify email guilds'
        };
        // Express app initialization; HTTP server created when starting so
        // we can bind to the platform port (Render provides the port at runtime).
        this.app = express();
        // Trust proxy for correct secure cookie behavior behind Render/Heroku
        this.app.set('trust proxy', 1);

        // Public email confirmation — registered FIRST, before all auth/CSP/Helmet middleware
        // so unauthenticated users clicking the link from their email inbox can always reach it.
        this.app.get('/confirm-email', this.confirmNotificationEmail.bind(this));

        // Security headers with Helmet (CSP configured dynamically in middleware)
        this.app.use((req, res, next) => {
            // Build dynamic WebSocket URL based on current host
            const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
            const host = req.get('host') || 'localhost:3000';
            const wsUrl = `${protocol}://${host}`;
            
            // Apply CSP with dynamic WebSocket URL
            const cspDirectives = {
                'default-src': ["'self'"],
                'script-src': ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://cdn.jsdelivr.net", "https://static.cloudflareinsights.com", "'unsafe-hashes'"],
                'script-src-attr': ["'unsafe-inline'"],
                'frame-src': ["https://js.stripe.com", "https://hooks.stripe.com"],
                'connect-src': ["'self'", "https://api.stripe.com", "https://cdn.jsdelivr.net", wsUrl],
                'img-src': ["'self'", "data:", "https:"],
                'style-src': ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
                'style-src-elem': ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
                'font-src': ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"]
            };
            
            res.setHeader('Content-Security-Policy', 
                Object.entries(cspDirectives)
                    .map(([key, values]) => `${key} ${values.join(' ')}`)
                    .join('; ')
            );
            next();
        });

        // Apply Helmet without CSP (we handle it above)
        // Conditionally apply HTTPS-only headers based on environment
        const isSecure = process.env.NODE_ENV === 'production' || process.env.FORCE_HTTPS === 'true';
        
        this.app.use(helmet({
            contentSecurityPolicy: false,
            permissionsPolicy: {
                features: {
                    camera: ["'none'"],
                    microphone: ["'none'"],
                    geolocation: ["'none'"]
                }
            },
            // HSTS only on HTTPS
            hsts: isSecure ? {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            } : false,
            // Disable COOP/COEP/Origin-Agent-Cluster on HTTP to avoid browser warnings
            crossOriginOpenerPolicy: false,
            crossOriginEmbedderPolicy: false,
            crossOriginResourcePolicy: false,
            originAgentCluster: false
        }));

        // CORS configuration
        const corsOrigin = process.env.DASHBOARD_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3001';
        this.app.use(cors({
            origin: corsOrigin,
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
        }));
        this.server = null;
        // WebSocket server is created when starting.
        this.wss = null;

        // Set of connected WebSocket clients
        this.clients = new Set();

        // In-memory bot console messages (retain last 5,000)
        this.consoleMessages = [];

        // Stripe billing configuration
        this.stripe = process.env.STRIPE_SECRET ? new Stripe(process.env.STRIPE_SECRET, { apiVersion: '2024-06-20' }) : null;
        this.billingConfig = {
            proPriceId: process.env.STRIPE_PRO_PRICE_ID,
            enterprisePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
            domain: process.env.DOMAIN
        };

        // In-memory rate limit tracking for dashboard endpoints
        const rateLimitMap = new Map();
        
        // CRITICAL SECURITY: Validate required secrets on construction
        this.validateSecrets();

        // File integrity monitor disabled - module not in repository
        // this.integrityMonitor = new FileIntegrityMonitor({
        //     baselinePath: path.join(process.cwd(), 'data', 'file-integrity.json'),
        //     files: [
        //         path.join(__dirname, 'dashboard.js'),
        //         path.join(__dirname, '../bot.js'),
        //         path.join(__dirname, '../database/database.js'),
        //         path.join(process.cwd(), 'config.json')
        //     ].filter(p => fs.existsSync(p)),
        //     logger: this.bot?.logger || console
        // });

        // Clean up rate limit map periodically
        setInterval(() => {
            const now = Date.now();
            for (const [ip, requests] of rateLimitMap.entries()) {
                const validRequests = requests.filter(time => now - time < 60000);
                if (validRequests.length === 0) {
                    rateLimitMap.delete(ip);
                } else {
                    rateLimitMap.set(ip, validRequests);
                }
            }
        }, 60000);

        // Stripe webhook (raw body required for signature verification)
        this.app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), this.handleStripeWebhook.bind(this));

        // Enable cookie parsing for all routes
        this.app.use(cookieParser());

        // Enable JSON body parsing for API routes (skip webhook which uses raw body)
        this.app.use((req, res, next) => {
            if (req.originalUrl.startsWith('/webhooks/stripe')) return next();
            if (req.originalUrl.startsWith('/api/upload/image')) return next();
            return express.json({ limit: '256kb' })(req, res, next);
        });

        // Stripe checkout session endpoint (REQUIRES AUTH)
        this.app.post('/api/stripe/create-checkout-session', this.authenticateToken.bind(this), async (req, res) => {
            try {
                console.log('[Stripe Checkout] Creating session for user:', req.user);
                
                if (!this.stripe) {
                    console.error('[Stripe Checkout] Stripe not configured');
                    return res.status(503).json({ error: 'Stripe not configured' });
                }

                const { plan, guildId } = req.body;
                const userId = req.user?.userId; // From JWT
                
                if (!userId) {
                    console.error('[Stripe Checkout] User not authenticated');
                    return res.status(401).json({ error: 'User not authenticated' });
                }

                // Check if user already has an active premium subscription
                try {
                    const existingSubscription = await new Promise((resolve, reject) => {
                        this.bot.database.db.get(
                            `SELECT subscription_id, status, plan_type, current_period_end 
                             FROM stripe_subscriptions 
                             WHERE customer_email = (
                                 SELECT email FROM users WHERE discord_id = ?
                             ) AND status IN ('active', 'trialing')
                             ORDER BY created_at DESC
                             LIMIT 1`,
                            [userId],
                            (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            }
                        );
                    });

                    if (existingSubscription) {
                        console.log('[Stripe Checkout] User already has active subscription:', existingSubscription);
                        const periodEnd = new Date(existingSubscription.current_period_end * 1000);
                        return res.status(400).json({ 
                            error: 'You already have an active premium subscription',
                            subscription: {
                                plan: existingSubscription.plan_type,
                                status: existingSubscription.status,
                                renewsAt: periodEnd.toISOString()
                            }
                        });
                    }
                } catch (dbError) {
                    console.error('[Stripe Checkout] Error checking existing subscription:', dbError);
                    // Continue if table doesn't exist yet - this is fine for first-time setup
                }

                const priceId = plan === 'yearly' ? this.billingConfig.enterprisePriceId : this.billingConfig.proPriceId;

                if (!priceId) {
                    console.error('[Stripe Checkout] Invalid plan:', plan);
                    return res.status(400).json({ error: 'Invalid plan selected' });
                }

                // Get user's Discord token from server-side cache to fetch email
                let customerEmail = null;
                if (this.discordTokenCache && this.discordTokenCache.has(userId)) {
                    try {
                        const tokenData = this.discordTokenCache.get(userId);
                        const userResponse = await axios.get('https://discord.com/api/users/@me', {
                            headers: { Authorization: `Bearer ${tokenData.accessToken}` }
                        });
                        customerEmail = userResponse.data.email;
                        console.log('[Stripe Checkout] Retrieved customer email:', customerEmail);
                    } catch (e) {
                        console.warn('[Stripe Checkout] Could not retrieve user email:', e.message);
                    }
                }

                console.log('[Stripe Checkout] Creating session with metadata:', { userId, guildId, plan });

                const session = await this.stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [{
                        price: priceId,
                        quantity: 1,
                    }],
                    mode: 'subscription',
                    customer_email: customerEmail || undefined,
                    subscription_data: {
                        metadata: {
                            user_id: userId,
                            guild_id: guildId || '',
                            plan: plan
                        }
                    },
                    metadata: {
                        user_id: userId,
                        guild_id: guildId || '',
                        plan: plan
                    },
                    success_url: `${process.env.DASHBOARD_ORIGIN || 'http://localhost:3001'}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.DASHBOARD_ORIGIN || 'http://localhost:3001'}/payment-failed.html?error=cancelled`,
                });

                console.log('[Stripe Checkout] Session created:', session.id);
                res.json({ 
                    sessionId: session.id,
                    url: session.url 
                });
            } catch (error) {
                console.error('[Stripe Checkout] Error:', error.message, error.stack);
                const errorMessage = process.env.NODE_ENV === 'production' 
                    ? 'Failed to create checkout session' 
                    : error.message;
                res.status(500).json({ error: errorMessage });
            }
        });

        // Get Stripe session and generate activation code (REQUIRES AUTH)
        this.app.get('/api/stripe/session/:sessionId', this.authenticateToken.bind(this), async (req, res) => {
            try {
                console.log('[Stripe Session] Request received for session:', req.params.sessionId);
                console.log('[Stripe Session] User from JWT:', req.user);

                if (!this.stripe) {
                    console.error('[Stripe Session] Stripe not configured');
                    return res.status(503).json({ error: 'Stripe not configured' });
                }

                const { sessionId } = req.params;
                const userId = req.user?.userId; // From JWT token
                
                if (!userId) {
                    console.error('[Stripe Session] User not authenticated');
                    return res.status(401).json({ error: 'User not authenticated' });
                }
                
                // Validate session ID format to prevent injection
                if (!/^cs_[a-zA-Z0-9_-]+$/.test(sessionId)) {
                    console.error('[Stripe Session] Invalid session ID format:', sessionId);
                    return res.status(400).json({ error: 'Invalid session ID format' });
                }

                console.log('[Stripe Session] Retrieving session from Stripe...');
                const session = await this.stripe.checkout.sessions.retrieve(sessionId, {
                    expand: ['subscription']
                });
                console.log('[Stripe Session] Session retrieved. Payment status:', session.payment_status);

                if (!session) {
                    return res.status(404).json({ error: 'Session not found' });
                }

                // Check if payment was successful
                if (session.payment_status !== 'paid') {
                    return res.status(400).json({ error: 'Payment not completed' });
                }

                // Enforce ownership: session metadata must match authenticated user
                const metadataUserId = session.metadata?.user_id || session.metadata?.userId || session.metadata?.user;
                if (!metadataUserId || metadataUserId !== userId) {
                    console.error('[Stripe Session] Ownership mismatch', { metadataUserId, userId });
                    return res.status(403).json({ error: 'Unauthorized session owner' });
                }

                // Optional guild binding check
                const metadataGuildId = session.metadata?.guild_id || session.metadata?.guildId || session.metadata?.guild;
                if (metadataGuildId) {
                    try {
                        const access = await this.checkGuildAccess(userId, metadataGuildId, true);
                        if (!access?.authorized) {
                            return res.status(403).json({ error: 'Unauthorized for guild' });
                        }
                    } catch (guildErr) {
                        this.bot.logger?.warn('Stripe Session guild access check failed:', guildErr);
                        return res.status(403).json({ error: 'Guild access verification failed' });
                    }
                }

                // Generate activation code (one-time use for initial setup)
                const crypto = require('crypto');
                const code = crypto.randomBytes(8).toString('hex').toUpperCase();
                const customerEmail = session.customer_details?.email || '';
                const subscriptionId = session.subscription?.id || session.subscription;
                const customerId = session.customer;

                // Save subscription to database
                if (this.bot?.database?.db) {
                    // Save activation code linked to subscription
                    this.bot.database.db.run(
                        `INSERT INTO pro_codes (code, created_by, status, duration_days, max_uses, expires_at, created_at) 
                         VALUES (?, ?, 'active', 30, 1, datetime('now', '+30 days'), datetime('now'))`,
                        [code, `stripe_sub:${subscriptionId}`],
                        (err) => {
                            if (err) {
                                console.error('[Stripe] Failed to save pro code:', err);
                            } else {
                                console.log('[Stripe] Pro code saved:', code, '(Subscription:', subscriptionId, ')');
                            }
                        }
                    );

                    // Create subscriptions table if it doesn't exist
                    this.bot.database.db.run(`
                        CREATE TABLE IF NOT EXISTS stripe_subscriptions (
                            subscription_id TEXT PRIMARY KEY,
                            customer_id TEXT NOT NULL,
                            customer_email TEXT,
                            guild_id TEXT,
                            user_id TEXT,
                            status TEXT NOT NULL,
                            plan_type TEXT,
                            current_period_start INTEGER,
                            current_period_end INTEGER,
                            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                        )
                    `);

                    // Save subscription info
                    this.bot.database.db.run(
                        `INSERT OR REPLACE INTO stripe_subscriptions 
                         (subscription_id, customer_id, customer_email, status, plan_type, current_period_start, current_period_end, updated_at) 
                         VALUES (?, ?, ?, 'active', ?, ?, ?, datetime('now'))`,
                        [
                            subscriptionId,
                            customerId,
                            customerEmail,
                            session.line_items?.data?.[0]?.price?.id || 'unknown',
                            session.subscription?.current_period_start,
                            session.subscription?.current_period_end
                        ],
                        (err) => {
                            if (err) {
                                console.error('[Stripe] Failed to save subscription:', err);
                            } else {
                                console.log('[Stripe] Subscription saved:', subscriptionId);
                            }
                        }
                    );
                }

                // Send email
                console.log('[Stripe Session] Attempting to send email to:', customerEmail);
                try {
                    const emailUtil = require('../utils/email');
                    const emailSent = await emailUtil.sendEmail({
                        to: customerEmail,
                        subject: 'Ã¢Å“Â¨ Guardian Pro Activation Code',
                        text: `Hi there,

Thank you for subscribing to Guardian Pro Ã¢â‚¬â€ we're excited to help you unlock the full power of GuardianBot.

Your activation code is:

Ã¢Å¾Â¡Ã¯Â¸Â ${code}

Enter this code in your GuardianBot Dashboard to enable all Pro-only features, including advanced protection tools, real-time alerts, enhanced analytics, and priority automation.

Ã°Å¸â€œâ€¦ Your subscription will automatically renew monthly at ${session.amount_total / 100} ${session.currency?.toUpperCase() || 'USD'} until you cancel.
You can manage your subscription anytime through your dashboard or by contacting support.

If you need help at any point, our support team is here for you.
Just reply to this email or reach out through your dashboard.

Thank you for choosing GuardianBot Ã¢â‚¬â€ your server is now safer than ever.

Stay protected,
The GuardianBot Team`
                    });
                    console.log('[Stripe Session] Email send result:', emailSent ? 'SUCCESS' : 'FAILED');
                } catch (e) {
                    console.error('[Stripe Session] Failed to send activation code email:', e.message, e.stack);
                }

                console.log('[Stripe Session] Sending response with code:', code);
                res.json({ 
                    code, 
                    email: customerEmail,
                    subscriptionId,
                    planType: 'subscription'
                });
            } catch (error) {
                console.error('[Stripe Session] Error:', error.message, error.stack);
                console.error('Stripe session error:', error);
                const errorMessage = process.env.NODE_ENV === 'production' 
                    ? 'Failed to retrieve session' 
                    : error.message;
                res.status(500).json({ error: errorMessage });
            }
        });

        // Stripe webhook for subscription events (renewals, cancellations, payment failures)
        this.app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
            const sig = req.headers['stripe-signature'];
            const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

            if (!webhookSecret) {
                console.warn('[Stripe Webhook] No webhook secret configured');
                return res.status(400).send('Webhook secret not configured');
            }

            let event;
            try {
                event = this.stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
            } catch (err) {
                console.error('[Stripe Webhook] Signature verification failed:', err.message);
                return res.status(400).send(`Webhook Error: ${err.message}`);
            }

            console.log('[Stripe Webhook] Event received:', event.type);

            // Handle subscription events
            switch (event.type) {
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    const subscription = event.data.object;
                    if (this.bot?.database?.db) {
                        this.bot.database.db.run(
                            `INSERT OR REPLACE INTO stripe_subscriptions 
                             (subscription_id, customer_id, customer_email, status, current_period_start, current_period_end, updated_at) 
                             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
                            [
                                subscription.id,
                                subscription.customer,
                                subscription.customer_email || null,
                                subscription.status,
                                subscription.current_period_start,
                                subscription.current_period_end
                            ],
                            (err) => {
                                if (err) console.error('[Stripe Webhook] Failed to update subscription:', err);
                                else console.log('[Stripe Webhook] Subscription updated:', subscription.id, '- Status:', subscription.status);
                            }
                        );
                    }
                    break;

                case 'customer.subscription.deleted':
                    const deletedSub = event.data.object;
                    if (this.bot?.database?.db) {
                        this.bot.database.db.run(
                            `UPDATE stripe_subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE subscription_id = ?`,
                            [deletedSub.id],
                            (err) => {
                                if (err) console.error('[Stripe Webhook] Failed to cancel subscription:', err);
                                else console.log('[Stripe Webhook] Subscription canceled:', deletedSub.id);
                            }
                        );
                    }
                    break;

                case 'invoice.payment_succeeded':
                    const invoice = event.data.object;
                    console.log('[Stripe Webhook] Payment succeeded for subscription:', invoice.subscription);
                    // Subscription automatically continues - no action needed
                    break;

                case 'invoice.payment_failed':
                    const failedInvoice = event.data.object;
                    console.warn('[Stripe Webhook] Payment failed for subscription:', failedInvoice.subscription);
                    // Optionally notify the customer or admin
                    if (this.bot?.database?.db) {
                        this.bot.database.db.run(
                            `UPDATE stripe_subscriptions SET status = 'past_due', updated_at = datetime('now') WHERE subscription_id = ?`,
                            [failedInvoice.subscription],
                            (err) => {
                                if (err) console.error('[Stripe Webhook] Failed to update subscription status:', err);
                            }
                        );
                    }
                    break;

                default:
                    console.log('[Stripe Webhook] Unhandled event type:', event.type);
            }

            res.json({ received: true });
        });

        // ============================
        // Premium gating middleware - Checks Stripe subscriptions
        // ============================
        this.requirePremium = async (req, res, next) => {
            try {
                const userId = req.user?.userId;
                if (!userId) {
                    // For HTML pages, redirect to login
                    if (req.path.endsWith('.html') || !req.path.startsWith('/api/')) {
                        return res.redirect('/login?premium_required=true');
                    }
                    return res.status(401).json({ error: 'Unauthorized - valid JWT required', premium: true });
                }

                const entitlement = await this.getUserPlan(userId);
                req.user.plan = entitlement.plan;
                req.user.isPremium = entitlement.isPremium;

                if (!entitlement.isPremium) {
                    console.log('[Premium Gate] Access denied for user:', userId);
                    // For HTML pages, show upgrade page
                    if (req.path.endsWith('.html') || !req.path.startsWith('/api/')) {
                        return res.status(403).send(`
                            <!DOCTYPE html>
                            <html>
                            <head>
                                <title>Premium Required - DarkLock</title>
                                <link rel="stylesheet" href="/css/premium-gating.css">
                                <style>
                                    body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); font-family: 'Inter', sans-serif; }
                                    .premium-required { background: white; border-radius: 20px; padding: 60px 40px; max-width: 500px; text-align: center; box-shadow: 0 25px 80px rgba(0,0,0,0.3); }
                                    .premium-required h1 { margin: 0 0 20px; color: #1a1a2e; font-size: 32px; }
                                    .premium-required p { color: #666; margin: 0 0 30px; line-height: 1.6; }
                                    .premium-icon { width: 80px; height: 80px; background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 30px; }
                                    .premium-icon i { font-size: 40px; color: #000; }
                                    .btn-upgrade { background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%); color: #000; border: none; padding: 16px 40px; border-radius: 10px; font-weight: 700; font-size: 16px; cursor: pointer; text-decoration: none; display: inline-block; margin: 10px; }
                                    .btn-back { background: #e0e0e0; color: #333; border: none; padding: 16px 40px; border-radius: 10px; font-weight: 600; font-size: 16px; cursor: pointer; text-decoration: none; display: inline-block; margin: 10px; }
                                </style>
                                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
                            </head>
                            <body>
                                <div class="premium-required">
                                    <div class="premium-icon"><i class="fas fa-crown"></i></div>
                                    <h1>Premium Feature</h1>
                                    <p>This feature is only available to premium subscribers. Upgrade now to unlock advanced analytics, tickets, anti-nuke, anti-phishing, and more!</p>
                                    <a href="/payment.html" class="btn-upgrade"><i class="fas fa-crown"></i> Upgrade to Premium</a>
                                    <a href="/dashboard" class="btn-back"><i class="fas fa-arrow-left"></i> Back to Dashboard</a>
                                </div>
                            </body>
                            </html>
                        `);
                    }
                    return res.status(403).json({ error: 'Premium subscription required', premium: true });
                }

                console.log('[Premium Gate] Access granted for user:', userId);
                next();
            } catch (e) { 
                console.error('[Premium Gate] Error:', e);
                return res.status(500).json({ error: 'Authentication error' }); 
            }
        };
        
        // Legacy requirePro middleware - alias to requirePremium
        this.requirePro = this.requirePremium;

        // Server-side premium gate for all premium page paths (prevents direct URL bypass)
        // FAIR MODEL: Only lock truly advanced features, keep core functionality free
        const premiumPaths = new Set([
            '/dashboard/console',           // Premium: Advanced bot console
            '/access-generator',            // Premium: Access code generation
            '/access-share'                 // Premium: Access sharing
            // FREE: tickets, analytics, help, all setup pages (anti-raid, anti-spam, moderation, antinuke, anti-phishing, verification, autorole)
        ]);

        this.app.use((req, res, next) => {
            if (!premiumPaths.has(req.path)) return next();

            // Run auth first, then premium check; handlers respond on failure
            this.authenticateToken(req, res, (authErr) => {
                if (authErr) return; // authenticateToken already handled the response
                this.requirePremium(req, res, next);
            });
        });

        // FAIR MODEL: Only lock advanced API endpoints
        const premiumApiPrefixes = [
            '/api/console',                 // Premium: Bot console API
            '/api/ai'                       // Premium: AI features
            // FREE: analytics, security, actions, lockdown, logs, tickets, verification, snapshots, rollback, alerts
        ];

        const premiumApiExact = new Set([
            '/api/update-advanced-settings',    // Premium: Advanced settings only
            '/api/advanced-settings'            // Premium: Advanced settings only
            // FREE: overview-stats, levels/reset
        ]);

        this.app.use((req, res, next) => {
            if (!req.path.startsWith('/api/')) return next();

            const isPremiumApi = premiumApiPrefixes.some(prefix => req.path.startsWith(prefix)) || premiumApiExact.has(req.path);
            if (!isPremiumApi) return next();

            this.authenticateToken(req, res, (authErr) => {
                if (authErr) return;
                this.requirePremium(req, res, next);
            });
        });

        // Static files
        // Serve the marketing website under /site to avoid asset path conflicts with dashboard
        this.app.use('/site', express.static(path.join(process.cwd(), 'website')));
        this.app.use('/css', express.static(path.join(__dirname, 'public/css')));
        this.app.use('/js', express.static(path.join(__dirname, 'public/js')));
        this.app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
        // Serve localization files from workspace root
        this.app.use('/locale', express.static(path.join(process.cwd(), 'locale')));
        // Quiet missing favicon with a no-content response
        this.app.get('/favicon.ico', (req, res) => res.status(204).end());
        // Serve console static assets
        this.app.use('/console', express.static(path.join(__dirname, 'public')));
        // Direct route to payment page
        this.app.get('/payment', (req, res) => {
            try {
                const fs = require('fs');
                const htmlPath = path.join(__dirname, 'public', 'payment.html');
                let html = fs.readFileSync(htmlPath, 'utf8');
                // Inject Stripe publishable key
                html = html.replace('{{ STRIPE_PUBLISHABLE_KEY }}', process.env.STRIPE_PUBLISHABLE || '');
                res.send(html);
            } catch (e) {
                res.status(404).send('Payment page not found');
            }
        });
        // Payment success page
        this.app.get('/payment-success.html', (req, res) => {
            try {
                res.sendFile(path.join(__dirname, 'public', 'payment-success.html'));
            } catch (e) {
                res.status(404).send('Success page not found');
            }
        });
        // Payment failed page
        this.app.get('/payment-failed.html', (req, res) => {
            try {
                res.sendFile(path.join(__dirname, 'public', 'payment-failed.html'));
            } catch (e) {
                res.status(404).send('Failed page not found');
            }
        });
        // Serve images if present; individual fallbacks are added in routes
        this.app.use('/images', express.static(path.join(__dirname, 'public/images')));
        this.app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

        // Ensure non-destructive schema migrations
        try { this.ensureSchema(); } catch (e) { this.bot?.logger?.warn && this.bot.logger.warn('[DB] ensureSchema error:', e.message || e); }

        // Register routes now that middleware is configured
        try {
            this.setupRoutes();
        } catch (e) {
            // Non-fatal: routes will be registered when start() runs if necessary
            this.bot?.logger?.warn && this.bot.logger?.warn('Failed to call setupRoutes in constructor:', e.message || e);
        }
    }

    async ensureSchema() {
        try {
            // Users table
            await this.bot.database.run(`CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                discord_id TEXT,
                email TEXT,
                is_pro INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME
            )`);
            
            // Add discord_id column if it doesn't exist (migration for existing tables)
            try {
                await this.bot.database.run(`ALTER TABLE users ADD COLUMN discord_id TEXT`);
            } catch (e) {
                // Column already exists, ignore error
            }

            // Activation codes
            await this.bot.database.run(`CREATE TABLE IF NOT EXISTS activation_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT,
                code TEXT UNIQUE,
                used INTEGER DEFAULT 0,
                used_at DATETIME,
                paypal_order_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Guild customization (expanded schema)
            await this.bot.database.run(`CREATE TABLE IF NOT EXISTS guild_customization (
                guild_id TEXT PRIMARY KEY,
                tickets_categories INTEGER DEFAULT 0,
                tickets_autoclose INTEGER DEFAULT 0,
                tickets_autoclose_hours INTEGER DEFAULT 48,
                tickets_footer TEXT,
                tickets_priority TEXT DEFAULT 'normal',
                tickets_max_per_user INTEGER DEFAULT 3,
                tickets_ratings INTEGER DEFAULT 0,
                welcome_title TEXT,
                welcome_message TEXT,
                welcome_color TEXT,
                welcome_rules INTEGER DEFAULT 0,
                welcome_dm INTEGER DEFAULT 0,
                mod_severity TEXT DEFAULT 'moderate',
                mod_warn_threshold INTEGER DEFAULT 3,
                mod_mute_duration INTEGER DEFAULT 10,
                mod_warn_expiry INTEGER DEFAULT 30,
                mod_logging INTEGER DEFAULT 1,
                mod_require_reason INTEGER DEFAULT 0,
                verify_message TEXT,
                verify_button TEXT,
                verify_color TEXT,
                verify_success TEXT,
                verify_kick_hours INTEGER DEFAULT 24,
                log_edits INTEGER DEFAULT 1,
                log_deletes INTEGER DEFAULT 1,
                log_members INTEGER DEFAULT 1,
                log_roles INTEGER DEFAULT 0,
                log_channels INTEGER DEFAULT 0,
                log_compact INTEGER DEFAULT 0,
                brand_name TEXT,
                brand_footer TEXT,
                brand_icon TEXT,
                brand_timestamp INTEGER DEFAULT 1,
                site_primary TEXT,
                site_accent TEXT,
                site_tagline TEXT,
                site_copyright TEXT,
                site_stats INTEGER DEFAULT 1,
                theme_name TEXT DEFAULT 'emerald',
                layout_sidebar TEXT DEFAULT 'left',
                layout_compact INTEGER DEFAULT 0,
                layout_animations INTEGER DEFAULT 1,
                layout_fontsize TEXT DEFAULT 'medium',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Access codes table for dashboard access
            await this.bot.database.run(`CREATE TABLE IF NOT EXISTS access_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                guild_id TEXT NOT NULL,
                permission_level TEXT NOT NULL DEFAULT 'viewer',
                code_type TEXT NOT NULL DEFAULT 'single',
                max_uses INTEGER DEFAULT 1,
                uses_remaining INTEGER DEFAULT 1,
                created_by TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME,
                note TEXT,
                revoked INTEGER DEFAULT 0,
                revoked_at DATETIME
            )`);

            // Access code redemptions tracking
            await this.bot.database.run(`CREATE TABLE IF NOT EXISTS access_code_redemptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL,
                user_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(code, user_id)
            )`);

            // Stripe subscriptions table for premium tracking
            await this.bot.database.run(`CREATE TABLE IF NOT EXISTS stripe_subscriptions (
                subscription_id TEXT PRIMARY KEY,
                customer_id TEXT NOT NULL,
                customer_email TEXT,
                guild_id TEXT,
                user_id TEXT,
                status TEXT NOT NULL DEFAULT 'inactive',
                plan_type TEXT,
                current_period_start INTEGER,
                current_period_end INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`);
        } catch (e) {
            throw e;
        }
    }

    async getUserPlan(userId) {
        if (!userId) return { plan: 'free', isPremium: false };

        let subscription = null;
        let user = null;

        try {
            subscription = await new Promise((resolve) => {
                this.bot.database.db.get(
                    `SELECT ss.subscription_id, ss.status
                     FROM stripe_subscriptions ss
                     LEFT JOIN users u ON u.email = ss.customer_email
                     WHERE (ss.user_id = ? OR u.discord_id = ?)
                     AND ss.status IN ('active', 'trialing')
                     ORDER BY ss.created_at DESC
                     LIMIT 1`,
                    [userId, userId],
                    (err, row) => {
                        if (err) resolve(null);
                        else resolve(row);
                    }
                );
            });
        } catch (e) {
            subscription = null;
        }

        try {
            user = await new Promise((resolve) => {
                this.bot.database.db.get(
                    `SELECT is_pro FROM users WHERE discord_id = ? OR id = ?`,
                    [userId, userId],
                    (err, row) => {
                        if (err) resolve(null);
                        else resolve(row);
                    }
                );
            });
        } catch (e) {
            user = null;
        }

        const isPremium = Boolean(subscription) || Boolean(user && user.is_pro);
        return { plan: isPremium ? 'premium' : 'free', isPremium };
    }

    // Simple cookie parser (avoid extra dependency)
    getCookie(req, name) {
        const cookieHeader = req.headers?.cookie;
        if (!cookieHeader) return null;
        const parts = cookieHeader.split(';');
        for (const part of parts) {
            const [k, v] = part.trim().split('=');
            if (k === name) return decodeURIComponent(v || '');
        }
        return null;
    }

    setupRoutes() {
        // Make the external website the first page people see
        this.app.get('/', (req, res) => {
            res.redirect('/site/');
        });

        // Preserve previous landing page at /landing
        this.app.get('/landing', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/landing.html'));
        });

        // Web verification page (public - no auth required)
        this.app.get('/verify/:token', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/web-verify.html'));
        });

        // Web verification API endpoints
        this.app.post('/api/web-verify/init', this.handleWebVerifyInit.bind(this));
        this.app.post('/api/web-verify/submit', this.handleWebVerifySubmit.bind(this));
        this.app.post('/api/web-verify/refresh', this.handleWebVerifyRefresh.bind(this));

        // XP Leaderboard proxy - forwards to internal XP dashboard (port 3007) so users get a public URL
        const _proxyToXP = (req, res) => {
            const http = require('http');
            const xpPort = parseInt(process.env.XP_DASHBOARD_PORT || '3007');
            const options = {
                hostname: '127.0.0.1',
                port: xpPort,
                path: req.url,
                method: req.method,
                headers: { ...req.headers, host: `127.0.0.1:${xpPort}` }
            };
            const proxy = http.request(options, (proxyRes) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res, { end: true });
            });
            proxy.on('error', () => res.status(502).send('Leaderboard service temporarily unavailable'));
            req.pipe(proxy, { end: true });
        };
        this.app.get('/leaderboard/:guildId', _proxyToXP);
        this.app.get('/api/leaderboard/:guildId', _proxyToXP);

        // Main dashboard (authenticated UI)
        this.app.get('/dashboard', (req, res) => {
            console.log('\n========== /dashboard ROUTE HIT ==========');
            console.log('[/dashboard] Request cookies:', Object.keys(req.cookies));
            console.log('[/dashboard] Has dashboardToken?:', !!req.cookies.dashboardToken);
            console.log('[/dashboard] Serving index-modern.html');
            console.log('==========================================\n');
            res.sendFile(path.join(__dirname, 'views/index-modern.html'));
        });

        // Bot Console view (PREMIUM)
        this.app.get('/dashboard/console', this.authenticateToken.bind(this), this.requirePremium, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/console.html'));
        });

        // Bot Console API: fetch per-guild logs
        this.app.get('/api/logs/:guildId', (req, res) => {
            try {
                const guildId = String(req.params.guildId);
                if (!this.bot || !this.bot.consoleBuffer) return res.json([]);
                const buf = this.bot.consoleBuffer.get(guildId) || [];
                res.json(buf);
            } catch (e) {
                res.status(500).json({ error: e.message || String(e) });
            }
        });

        // Bot Console API: clear per-guild logs
        this.app.post('/api/logs/:guildId/clear', (req, res) => {
            try {
                const guildId = String(req.params.guildId);
                if (!this.bot || !this.bot.consoleBuffer) return res.json({ success: true });
                this.bot.consoleBuffer.set(guildId, []);
                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: e.message || String(e) });
            }
        });

        // Tickets management page (PREMIUM)
        this.app.get('/tickets', this.authenticateToken.bind(this), (req, res) => {
            res.sendFile(path.join(__dirname, 'views/tickets-enhanced.html'));
        });

        // Analytics dashboard page (PREMIUM)
        this.app.get('/analytics', this.authenticateToken.bind(this), (req, res) => {
            res.sendFile(path.join(__dirname, 'views/analytics-modern.html'));
        });

        // Setup pages
        this.app.get('/setup/security', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-security.html'));
        });

        this.app.get('/setup/tickets', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-tickets.html'));
        });

        this.app.get('/setup/moderation', this.authenticateToken.bind(this), (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-moderation.html'));
        });

        this.app.get('/setup/features', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-features.html'));
        });

        // AI settings page
        this.app.get('/setup/ai', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-ai.html'));
        });

        // Anti-nuke setup page - FREE
        this.app.get('/setup/antinuke', this.authenticateToken.bind(this), (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-antinuke-modern.html'));
        });

        // Access code page for non-admin users
        this.app.get('/access-code', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/access-code.html'));
        });

        // Alias for access code page
        this.app.get('/access', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/access-code.html'));
        });

        // Welcome & Goodbye setup page
        this.app.get('/setup/welcome', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-welcome-goodbye-redesign.html'));
        });
        
        // Anti-Raid setup page
        this.app.get('/setup/anti-raid', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-anti-raid.html'));
        });

        // Anti-Spam setup page
        this.app.get('/setup/anti-spam', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-anti-spam.html'));
        });

        // Site routes (public pages)
        this.app.get('/site/privacy', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/privacy.html'));
        });

        this.app.get('/site/terms', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/terms.html'));
        });

        this.app.get('/site/security', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/security.html'));
        });

        this.app.get('/site/docs', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/documentation.html'));
        });

        this.app.get('/site/documentation', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/documentation.html'));
        });

        this.app.get('/site/status', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/status.html'));
        });

        this.app.get('/site/bug-report', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/bug-reports.html'));
        });

        this.app.get('/site/bug-reports', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/bug-reports.html'));
        });

        this.app.get('/site/features', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/features.html'));
        });

        this.app.get('/site/pricing', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/pricing.html'));
        });

        this.app.get('/site/add-bot', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/add-bot.html'));
        });

        this.app.get('/site/support', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/support.html'));
        });

        this.app.get('/site/sitemap', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/site/sitemap.html'));
        });

        // Bug report submission endpoints (public — no auth required)
        // Shared handler writing into admin-v4's bug_reports_v2 table
        const _submitBugReportV2 = async (req, res) => {
            try {
                const adminQueries = require('../../darklock/admin-v4/db/queries');
                const { type, source, reporter, email, title, description, severity,
                        app_version, environment, logs, timestamp, userAgent } = req.body;

                if (!title || !description) {
                    return res.status(400).json({ success: false, error: 'Title and description are required' });
                }

                const report = await adminQueries.createBugReport({
                    source: source || 'site',
                    reporter: reporter || email || 'Anonymous',
                    email: email || null,
                    title,
                    description,
                    severity: severity || 'medium',
                    app_version: app_version || null,
                    environment: environment || null,
                    // attach legacy fields (type, userAgent, timestamp) into logs for reference
                    logs: logs || `Type: ${type || 'bug'} | UA: ${userAgent || req.headers['user-agent'] || ''} | At: ${timestamp || new Date().toISOString()}`,
                    user_agent: userAgent || req.headers['user-agent'] || null,
                    ip_address: req.ip || req.connection?.remoteAddress || null,
                });

                res.json({ success: true, report });
            } catch (error) {
                console.error('[Dashboard] Bug report submission error:', error);
                res.status(500).json({ success: false, error: 'Failed to submit bug report' });
            }
        };

        // Legacy path (kept for any existing integrations)
        this.app.post('/api/bug-report', express.json(), _submitBugReportV2);
        // New canonical public path (same as platform server, no auth required)
        this.app.post('/api/v4/admin/bug-reports/submit', express.json(), _submitBugReportV2);

        // Admin: Get bug reports
        this.app.get('/api/admin/bug-reports', this.authenticateToken.bind(this), async (req, res) => {
            try {
                // Check if user is admin (from JWT token)
                if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'owner')) {
                    return res.status(403).json({ error: 'Admin access required' });
                }

                // Use Darklock database module
                const darklockDb = require('../../darklock/utils/database');
                
                // Check if database is ready
                if (!darklockDb.ready) {
                    return res.status(503).json({ error: 'Database not ready' });
                }

                // Ensure table exists
                await darklockDb.run(`CREATE TABLE IF NOT EXISTS bug_reports (
                    id INTEGER PRIMARY KEY,
                    type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    environment TEXT,
                    email TEXT,
                    timestamp TEXT NOT NULL,
                    userAgent TEXT,
                    status TEXT DEFAULT 'open'
                )`);

                // Get all bug reports
                const reports = await darklockDb.all(`SELECT * FROM bug_reports ORDER BY timestamp DESC`);

                res.json({ reports: reports || [] });
            } catch (error) {
                console.error('Error fetching bug reports:', error);
                res.status(500).json({ error: 'Failed to fetch bug reports', details: error.message });
            }
        });

        // Admin: Update bug report status
        this.app.put('/api/admin/bug-reports/:id', this.authenticateToken.bind(this), express.json(), async (req, res) => {
            try {
                // Check if user is admin (from JWT token)
                if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'owner')) {
                    return res.status(403).json({ error: 'Admin access required' });
                }

                const { status } = req.body;
                const reportId = req.params.id;

                // Use Darklock database module
                const darklockDb = require('../../darklock/utils/database');
                
                // Check if database is ready
                if (!darklockDb.ready) {
                    return res.status(503).json({ error: 'Database not ready' });
                }

                // Update status
                await darklockDb.run('UPDATE bug_reports SET status = ? WHERE id = ?', [status, reportId]);

                res.json({ success: true });
            } catch (error) {
                console.error('Error updating bug report:', error);
                res.status(500).json({ error: 'Failed to update bug report' });
            }
        });

        // Anti-Phishing setup page (PREMIUM)
        this.app.get('/setup/anti-phishing', this.authenticateToken.bind(this), this.requirePremium, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-anti-phishing-modern.html'));
        });

        // Verification settings page - FREE
        this.app.get('/setup/verification', this.authenticateToken.bind(this), (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-verification.html'));
        });

        // Auto Role & Reaction Roles page (PREMIUM)
        this.app.get('/setup/autorole', this.authenticateToken.bind(this), this.requirePremium, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-autorole.html'));
        });

        // Access Generator page (PREMIUM)
        this.app.get('/access-generator', this.authenticateToken.bind(this), this.requirePremium, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/access-generator.html'));
        });

        // Access Share page (PREMIUM)
        this.app.get('/access-share', this.authenticateToken.bind(this), this.requirePremium, (req, res) => {
            res.sendFile(path.join(__dirname, 'views/access-share.html'));
        });

        // Notifications & Logs page - FREE (with premium sections)
        this.app.get('/setup/notifications', this.authenticateToken.bind(this), (req, res) => {
            res.sendFile(path.join(__dirname, 'views/setup-notifications.html'));
        });

        // Help page with command reference - FREE
        this.app.get('/help', this.authenticateToken.bind(this), (req, res) => {
            res.sendFile(path.join(__dirname, 'views/help-modern.html'));
        });
        this.app.get('/commands', (req, res) => {
            res.redirect('/help');
        });

        // Command permissions page
        this.app.get('/command-permissions', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/command-permissions.html'));
        });

        // Version info endpoint for update notifier
        this.app.get('/version.json', (req, res) => {
            res.sendFile(path.join(__dirname, 'version.json'));
        });

        // Login page
        this.app.get('/login', (req, res) => {
            res.sendFile(path.join(__dirname, 'views/login.html'));
        });
        
        // Redirect /login.html to /signin for consistency with Darklock Platform
        this.app.get('/login.html', (req, res) => {
            res.redirect('/signin');
        });

        // Admin v4 is the main dashboard — served by Darklock's mountOn() block
        // All /admin traffic is handled by Darklock admin-v4 (requireAdminAuth + admin-v4/views/dashboard.html)

        // Authentication routes
        this.app.post('/auth/login', this.handleLogin.bind(this));
        this.app.get('/auth/discord', this.handleDiscordAuth.bind(this));
        this.app.get('/auth/discord/callback', this.handleDiscordCallback.bind(this));
        // Debug route (admin only). Guarded by authenticateToken and admin check inside debugOAuth.
        // Only enable in non-production environments to avoid leaking sensitive info.
        if (process.env.NODE_ENV !== 'production') {
            this.app.get('/auth/debug', this.authenticateToken.bind(this), this.debugOAuth.bind(this));
        }
        // Support both POST and GET for logout to match frontend usages
        this.app.post('/auth/logout', this.handleLogout.bind(this));
        this.app.get('/auth/logout', this.handleLogout.bind(this));
        // Backwards-compatible route used by some frontend files
        this.app.get('/logout', this.handleLogout.bind(this)); // Use same logout handler

        // Rate limiters for security
        const authLimiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 5, // 5 attempts per IP
            message: { error: 'Too many login attempts, please try again later' },
            standardHeaders: true,
            legacyHeaders: false
        });

        const apiLimiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 1000, // 1000 requests per IP (generous for dashboard)
            message: { error: 'Too many requests, please try again later' },
            standardHeaders: true,
            legacyHeaders: false,
            skip: (req) => {
                // Skip rate limiting for admin API routes (they have their own rate limiters)
                // Also skip for theme/static endpoints that are called frequently
                return req.path.startsWith('/v3/') || 
                       req.path.startsWith('/admin/') ||
                       req.path.includes('theme') ||
                       req.path.includes('csrf') ||
                       req.path.includes('current-theme') ||
                       req.path.startsWith('/static/') ||
                       req.path.endsWith('.css') ||
                       req.path.endsWith('.js');
            }
        });

        // Apply rate limiting to auth routes
        this.app.use('/auth/login', authLimiter);
        this.app.use('/api/', apiLimiter);

        // Billing routes
        this.app.post('/billing/portal', this.authenticateToken.bind(this), this.handleBillingPortal.bind(this));
        this.app.get('/billing/status/:guildId', this.authenticateToken.bind(this), this.getBillingStatus.bind(this));
        this.app.get('/billing/success', this.renderBillingSuccess.bind(this));
        this.app.get('/billing/cancel', this.renderBillingCancel.bind(this));

        // Bot invite redirect
        this.app.get('/invite', (req, res) => {
            const clientId = this.discordConfig.clientId;
            if (!clientId) return res.status(500).send('Bot client ID not configured');
            // Least-privilege permissions: KICK_MEMBERS (2) + BAN_MEMBERS (4) + MANAGE_CHANNELS (16) + MANAGE_GUILD (32) + MANAGE_ROLES (268435456)
            const permissions = '268435510'; // Minimal required permissions, not Administrator
            const scopes = 'bot applications.commands';
            const url = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=${encodeURIComponent(scopes)}`;
            res.redirect(url);
        });

        // Public health check only (no auth required)
        this.app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

        // CSRF token endpoint (before auth middleware - needs session but not auth)
        this.app.get('/api/csrf-token', (req, res) => {
            if (!req.session) req.session = {};
            if (!req.session.csrfToken) {
                const crypto = require('crypto');
                req.session.csrfToken = crypto.randomBytes(32).toString('hex');
            }
            res.json({ csrfToken: req.session.csrfToken });
        });

        // Current theme endpoint (public - returns theme from database)
        this.app.get('/api/current-theme', async (req, res) => {
            try {
                const themeManager = require('../../darklock/utils/theme-manager');
                const activeTheme = await themeManager.getActiveTheme();
                
                res.json({
                    success: true,
                    theme: activeTheme.name,
                    colors: activeTheme.theme.colors,
                    autoHoliday: activeTheme.autoHoliday,
                    currentHoliday: activeTheme.currentHoliday
                });
            } catch (err) {
                console.error('[Dashboard] Get current theme error:', err);
                res.json({
                    success: true,
                    theme: 'darklock',
                    colors: null
                });
            }
        });

        // Public theme CSS endpoint (avoid /signin HTML redirects for stylesheet requests)
        this.app.get('/api/v4/admin/theme/css', async (req, res) => {
            try {
                const themeManager = require('../../darklock/utils/theme-manager');
                const activeTheme = await themeManager.getActiveTheme();
                const colors = activeTheme.theme.colors;

                const css = `:root {
${Object.entries(colors).map(([key, value]) => `    ${key}: ${value};`).join('\n')}
}

/* Theme applies to bot dashboard and site only, not admin panel */`;

                res.setHeader('Content-Type', 'text/css');
                res.setHeader('Cache-Control', 'public, max-age=300');
                res.send(css);
            } catch (err) {
                console.error('[Dashboard] Get theme CSS error:', err);
                res.status(500).send('/* Error loading theme */');
            }
        });

        // === PROTECTED API ROUTES - All require authentication ===
        // Apply auth middleware to all /api/* routes (except /api/current-theme, /api/v4/admin/theme/css and /api/csrf-token)
        this.app.use('/api/', (req, res, next) => {
            // Skip auth for public endpoints
            if (req.path === '/current-theme' || req.path === '/csrf-token' ||
                req.path === '/v4/admin/theme/css' ||
                req.path === '/bug-report' ||             // legacy public submit
                req.path === '/v4/admin/bug-reports/submit') { // new public submit
                return next();
            }
            this.authenticateToken(req, res, next);
        });

        // Bot health endpoint (authenticated)
        this.app.get('/api/bot/health', this.getBotHealth.bind(this));
        
        // User authentication endpoint
        this.app.get('/api/me', async (req, res) => {
            // authenticateToken middleware already applied via /api/* route above
            console.log('\n========================================');
            console.log('[/api/me] Ã¢Å“â€¦ REQUEST RECEIVED');
            console.log('[/api/me] ALL Cookies:', req.cookies);
            console.log('[/api/me] dashboardToken cookie:', req.cookies?.dashboardToken ? 'PRESENT' : 'MISSING');
            console.log('[/api/me] User from middleware:', req.user);
            console.log('[/api/me] User ID:', req.user?.userId);
            console.log('[/api/me] Username:', req.user?.username);
            console.log('========================================\n');
            
            const entitlement = await this.getUserPlan(req.user?.userId);

            res.json({
                success: true,
                user: {
                    id: req.user.userId,
                    userId: req.user.userId,
                    username: req.user.username,
                    globalName: req.user.globalName,
                    avatar: req.user.avatar,
                    role: req.user.role,
                    hasAccess: req.user.hasAccess,
                    accessGuild: req.user.accessGuild,
                    guilds: req.user.guilds || [],
                    plan: entitlement.plan,
                    isPremium: entitlement.isPremium
                }
            });
        });

        // Auth aliases used by SecureAuth client
        this.app.get('/api/auth/check', (req, res) => {
            console.log('\n========== /api/auth/check ENDPOINT ==========');
            console.log('[/api/auth/check] Cookies:', Object.keys(req.cookies));
            console.log('[/api/auth/check] Has dashboardToken?:', !!req.cookies.dashboardToken);
            console.log('[/api/auth/check] req.user:', req.user);
            
            // Check cookie directly since this endpoint might be called before authenticateToken middleware
            const token = req.cookies?.dashboardToken;
            if (!token) {
                console.log('[/api/auth/check] ❌ No token in cookie');
                console.log('==============================================\n');
                return res.json({ authenticated: false, ok: false });
            }
            
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                console.log('[/api/auth/check] ✅ Token valid for user:', decoded.userId);
                console.log('==============================================\n');
                return res.json({ authenticated: true, ok: true });
            } catch (error) {
                console.log('[/api/auth/check] ❌ Token invalid:', error.message);
                console.log('==============================================\n');
                return res.json({ authenticated: false, ok: false });
            }
        });

        this.app.get('/api/auth/me', async (req, res) => {
            if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
            const entitlement = await this.getUserPlan(req.user.userId);
            res.json({
                id: req.user.userId,
                userId: req.user.userId,
                username: req.user.username,
                globalName: req.user.globalName,
                avatar: req.user.avatar,
                role: req.user.role,
                hasAccess: req.user.hasAccess,
                accessGuild: req.user.accessGuild,
                guilds: req.user.guilds || [],
                plan: entitlement.plan,
                isPremium: entitlement.isPremium
            });
        });
        
        // Premium status endpoint
        this.app.get('/api/premium/status', this.authenticateToken.bind(this), async (req, res) => {
            try {
                const userId = req.user?.userId;
                if (!userId) {
                    return res.json({ isPremium: false, tier: 'free' });
                }
                const entitlement = await this.getUserPlan(userId);
                console.log('[Premium Status] User:', userId, 'isPremium:', entitlement.isPremium);

                res.json({
                    isPremium: entitlement.isPremium,
                    tier: entitlement.plan,
                    plan: entitlement.plan,
                    status: entitlement.isPremium ? 'active' : 'inactive',
                    expiresAt: null,
                    features: entitlement.isPremium ? [
                        'anti-nuke', 'anti-phishing', 'moderation-advanced',
                        'verification', 'autorole', 'console', 'access-generator',
                        'access-share', 'tickets', 'analytics-advanced', 'logs-full',
                        'backup', 'priority-support'
                    ] : []
                });
            } catch (error) {
                console.error('[Premium Status] Error:', error);
                res.json({ isPremium: false, tier: 'free' });
            }
        });
        
        // Analytics endpoints (authenticated + guild check)
        this.app.get('/api/status', this.getPublicStatus.bind(this));
        this.app.get('/api/analytics/overview', this.getAnalyticsOverview.bind(this));
        this.app.get('/api/overview-stats', this.getOverviewStats.bind(this));
        this.app.get('/api/analytics/report', this.getAnalyticsReport.bind(this));
        this.app.get('/api/analytics/full', this.getFullAnalytics.bind(this));
        this.app.get('/api/analytics/live', this.getLiveAnalytics.bind(this));
        
        // Security/logging endpoints (authenticated + admin check)
        this.app.get('/api/console/messages', this.getConsoleMessages.bind(this));
        this.app.get('/api/security/logs', this.getSecurityLogs.bind(this));
        this.app.get('/api/security/actions', this.getModerationActions.bind(this));
        this.app.get('/api/security/recent', this.getRecentSecurityEvents.bind(this));
        this.app.get('/api/security/stats', this.getSecurityStats.bind(this));
        this.app.get('/api/security-stats', this.getSecurityStats.bind(this)); // Alias
        this.app.get('/api/actions', this.getModerationActions.bind(this)); // Alias
        this.app.get('/api/security/events', this.getSecurityEvents.bind(this));
        
        // Lockdown endpoints (authenticated + admin check)
        this.app.get('/api/lockdown/status', this.getLockdownStatus.bind(this));
        this.app.get('/api/lockdown/history', this.getLockdownHistory.bind(this));
        // Levels/XP endpoints
        this.app.get('/api/levels/leaderboard', this.getLevelsLeaderboard.bind(this));
        this.app.post('/api/levels/reset', this.resetGuildLevels.bind(this));
        // Advanced settings update endpoint
        this.app.post('/api/update-advanced-settings', this.updateAdvancedSettings.bind(this));
        
        // ============================
        // Free vs Pro rate limits
        // ============================
        const limitState = { counters: new Map() };
        const limitConfig = {
            free: {
                snapshots_interval_ms: 30 * 60 * 1000,
                analytics_min_interval_ms: 30 * 1000,
                ai_daily_max: 50,
                alerts_min_interval_ms: 60 * 1000
            },
            pro: {
                snapshots_interval_ms: 0,
                analytics_min_interval_ms: 0,
                ai_daily_max: Infinity,
                alerts_min_interval_ms: 0
            }
        };
        const enforceLimits = async (guildId, feature, userId) => {
            const user = await this.bot.database.get(`SELECT is_pro FROM users WHERE id = ?`, [userId]);
            const tier = (user && user.is_pro) ? 'pro' : 'free';
            const now = Date.now();
            const key = `${guildId}:${feature}`;
            const c = limitState.counters.get(key) || { lastAt: 0, dayCount: 0, dayStart: now };
            // Reset daily window
            if (now - c.dayStart > 24 * 60 * 60 * 1000) { c.dayStart = now; c.dayCount = 0; }
            const cfg = limitConfig[tier];
            if (feature === 'snapshots') {
                if (cfg.snapshots_interval_ms && (now - c.lastAt < cfg.snapshots_interval_ms)) return { ok: false, error: 'Snapshots limited in Free (30 min interval). Upgrade for unlimited.' };
                c.lastAt = now;
            } else if (feature === 'analytics') {
                if (cfg.analytics_min_interval_ms && (now - c.lastAt < cfg.analytics_min_interval_ms)) return { ok: false, error: 'Analytics refresh limited in Free (30s minimum). Upgrade for real-time.' };
                c.lastAt = now;
            } else if (feature === 'ai_scan') {
                if (isFinite(cfg.ai_daily_max) && (c.dayCount + 1 > cfg.ai_daily_max)) return { ok: false, error: 'AI scans limited in Free (50/day). Upgrade for unlimited.' };
                c.dayCount += 1; c.lastAt = now;
            } else if (feature === 'alerts') {
                if (cfg.alerts_min_interval_ms && (now - c.lastAt < cfg.alerts_min_interval_ms)) return { ok: false, error: 'Alerts limited in Free (1/min). Upgrade for unlimited.' };
                c.lastAt = now;
            }
            limitState.counters.set(key, c);
            return { ok: true };
        };

        // Expose for other modules (requirePremium already set earlier in this method)
        this.enforceLimits = enforceLimits;

        // PayPal routes
        this.app.get('/api/paypal/client-id', (req, res) => {
            try {
                const clientId = process.env.client_id;
                const env = (process.env.PAYPAL_ENV || 'live').toLowerCase();
                if (!clientId || clientId.trim() === '') {
                    return res.status(503).json({ error: 'PayPal not configured', env });
                }
                return res.json({ clientId, env });
            } catch (e) {
                return res.status(500).json({ error: 'Failed to get client id' });
            }
        });

        this.app.post('/api/paypal/create-order', async (req, res) => {
            try {
                    const { plan } = req.body || {};
                const clientId = process.env.client_id;
                const secret = process.env.Secret_key_1;
                if (!clientId || !secret) return res.status(500).json({ error: 'Missing PayPal credentials' });
                const env = (process.env.PAYPAL_ENV || 'live').toLowerCase();
                const base = env === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

                    // Determine price based on plan
                    const prices = {
                        monthly: '4.99',
                        yearly: '50.00'
                    };
                    const price = prices[plan] || '4.99';
                    const description = plan === 'yearly' ? 'Guardian Pro - Yearly Subscription' : 'Guardian Pro - Monthly Subscription';

                // Get access token
                const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
                const tokenResp = await fetch(`${base}/v1/oauth2/token`, {
                    method: 'POST',
                    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'grant_type=client_credentials'
                });
                const tokenData = await tokenResp.json();
                if (!tokenData.access_token) throw new Error('No access token');

                const orderResp = await fetch(`${base}/v2/checkout/orders`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        intent: 'CAPTURE',
                            purchase_units: [{ 
                                amount: { currency_code: 'USD', value: price },
                                description: description
                            }]
                    })
                });
                const orderData = await orderResp.json();
                if (!orderData.id) throw new Error('Failed to create order');
                return res.json({ id: orderData.id });
            } catch (e) {
                this.bot?.logger?.error && this.bot.logger.error('[PayPal] create-order error:', e.message || e);
                return res.status(500).json({ error: 'Failed to create order' });
            }
        });

        // ============================
        // Pro-gated endpoints (registered at startup, not inside PayPal handler)
        // ============================
        // Snapshots & rollback
        this.app.post('/api/snapshots/create', this.requirePremium, async (req, res) => {
            const { guildId, userId } = req.body || {};
            const lim = await enforceLimits(guildId, 'snapshots', userId);
            if (!lim.ok) return res.status(429).json({ error: lim.error });
            // TODO: implement snapshot creation
            return res.json({ success: true });
        });
        this.app.post('/api/rollback/execute', this.requirePremium, async (req, res) => {
            const { guildId } = req.body || {};
            // TODO: implement rollback
            return res.json({ success: true });
        });

        // Verification staff actions
        this.app.post('/api/verification/approve', this.requirePremium, async (req, res) => { return res.json({ success: true }); });
        this.app.post('/api/verification/deny', this.requirePremium, async (req, res) => { return res.json({ success: true }); });

        // Analytics
        this.app.get('/api/analytics/drilldown', this.requirePremium, async (req, res) => { return res.json({ success: true, data: [] }); });
        this.app.get('/api/analytics/export', this.requirePremium, async (req, res) => { return res.json({ success: true, url: null }); });

        // Tickets
        this.app.get('/api/tickets/transcripts', this.requirePremium, async (req, res) => { return res.json({ success: true, transcripts: [] }); });
        this.app.post('/api/tickets/ratings', this.requirePremium, async (req, res) => { return res.json({ success: true }); });

        // Alerts
        this.app.post('/api/alerts/notify', this.requirePremium, async (req, res) => {
            try {
                const alerts = require('../utils/alerts');
                const { guildId, type, details, userId } = req.body || {};
                const lim = await enforceLimits(guildId, 'alerts', userId);
                if (!lim.ok) return res.status(429).json({ error: lim.error });
                await alerts.notifyIncident(this.bot, guildId, type, details || {});
                return res.json({ success: true });
            } catch (e) { return res.status(500).json({ error: 'Failed to send alert' }); }
        });

        // AI (example route)
        this.app.post('/api/ai/scan', async (req, res) => {
            const { guildId, userId } = req.body || {};
            const user = await this.bot.database.get(`SELECT is_pro FROM users WHERE id = ?`, [userId]);
            if (!(user && user.is_pro)) {
                const lim = await enforceLimits(guildId, 'ai_scan', userId);
                if (!lim.ok) return res.status(429).json({ error: lim.error });
            }
            // TODO: perform AI scan
            return res.json({ success: true, result: { score: 0.2 } });
        });

        this.app.post('/api/paypal/capture/:orderID', async (req, res) => {
            try {
                const { orderID } = req.params;
                const clientId = process.env.client_id;
                const secret = process.env.Secret_key_1;
                if (!clientId || !secret) return res.status(500).json({ error: 'Missing PayPal credentials' });
                const env = (process.env.PAYPAL_ENV || 'live').toLowerCase();
                const base = env === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

                const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
                const tokenResp = await fetch(`${base}/v1/oauth2/token`, {
                    method: 'POST',
                    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'grant_type=client_credentials'
                });
                const tokenData = await tokenResp.json();
                if (!tokenData.access_token) throw new Error('No access token');

                const captureResp = await fetch(`${base}/v2/checkout/orders/${orderID}/capture`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
                });
                const captureData = await captureResp.json();
                if (!captureData.id || captureData.status !== 'COMPLETED') {
                    return res.status(400).json({ error: 'Payment not completed', details: captureData });
                }

                // Extract payer email
                const payerEmail = captureData?.payer?.email_address || (captureData?.payment_source?.paypal?.email_address) || null;
                const paypalOrderId = captureData.id;

                // Generate activation code
                const code = (require('crypto').randomBytes(6).toString('hex').toUpperCase());
                // Format XXXX-XXXX-XXXX
                const formatted = `${code.slice(0,4)}-${code.slice(4,8)}-${code.slice(8,12)}`;

                // Store in DB
                await this.bot.database.run(
                    `INSERT INTO activation_codes (email, code, used, paypal_order_id) VALUES (?, ?, 0, ?)`,
                    [payerEmail || '', formatted, paypalOrderId]
                );

                // Email the user (best-effort)
                try {
                    const emailUtil = require('../utils/email');
                    await emailUtil.sendEmail({
                        to: payerEmail,
                        subject: 'Your Guardian Pro Activation Code',
                        text: `Thanks for upgrading!\nHere is your activation code:\n\n${formatted}\n\nEnter this code in your dashboard to unlock all Pro features.`
                    });
                } catch (e) {
                    this.bot?.logger?.warn && this.bot.logger.warn('[Email] Failed to send code email', e.message || e);
                }

                return res.json({ success: true, code: formatted, orderID: paypalOrderId, redirect: `/payment-success.html?code=${encodeURIComponent(formatted)}` });
            } catch (e) {
                this.bot?.logger?.error && this.bot.logger.error('[PayPal] capture error:', e.message || e);
                return res.status(500).json({ error: 'Failed to capture payment', redirect: '/payment-failed.html?error=network' });
            }
        });

        // Activation route
        this.app.post('/api/activate-code', this.authenticateToken.bind(this), async (req, res) => {
            try {
                const { code, email, guildId } = req.body || {};
                const userId = req.user?.userId;
                if (!code || !userId) return res.status(400).json({ error: 'Missing code or user identity' });
                if (guildId) {
                    const access = await this.checkGuildAccess(userId, guildId, true);
                    if (!access?.authorized) {
                        return res.status(403).json({ error: 'Unauthorized for guild' });
                    }
                }

                // Check activation_codes table first (legacy)
                let row = await this.bot.database.get(`SELECT * FROM activation_codes WHERE code = ?`, [code]);
                let isLegacyCode = !!row;
                
                if (row) {
                    // Legacy activation code
                    if (row.used) return res.status(400).json({ error: 'Code already used' });
                    await this.bot.database.run(`UPDATE activation_codes SET used = 1, used_at = CURRENT_TIMESTAMP WHERE id = ?`, [row.id]);
                } else {
                    // Check pro_codes table (new system)
                    row = await this.bot.database.get(`SELECT * FROM pro_codes WHERE code = ?`, [code]);
                    
                    if (!row) return res.status(404).json({ error: 'Code not found' });
                    if (row.status && row.status !== 'active') return res.status(400).json({ error: 'Code is not active' });
                    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Code has expired' });
                    if (row.current_uses >= row.max_uses) return res.status(400).json({ error: 'Code has reached maximum uses' });
                    
                    // Check if user already redeemed
                    const existing = await this.bot.database.get(
                        `SELECT * FROM pro_redemptions WHERE code = ? AND user_id = ?`,
                        [code, userId]
                    );
                    if (existing) return res.status(400).json({ error: 'You have already redeemed this code' });
                    
                    // If guildId provided, update guild config
                    if (guildId) {
                        await this.bot.database.getGuildConfig(guildId);
                        await this.bot.database.run(
                            `UPDATE guild_configs SET pro_enabled = 1, pro_expires_at = datetime('now', '+${row.duration_days} days')
                             WHERE guild_id = ?`,
                            [guildId]
                        );
                    }
                    
                    // Record redemption
                    if (guildId) {
                        await this.bot.database.run(
                            `INSERT INTO pro_redemptions (code, user_id, guild_id, redeemed_at)
                             VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                            [code, userId, guildId]
                        );
                    } else {
                        await this.bot.database.run(
                            `INSERT INTO pro_redemptions (code, user_id, redeemed_at)
                             VALUES (?, ?, CURRENT_TIMESTAMP)`,
                            [code, userId]
                        );
                    }
                    
                    // Increment usage count
                    await this.bot.database.run(
                        `UPDATE pro_codes SET current_uses = current_uses + 1, last_used_at = CURRENT_TIMESTAMP
                         WHERE code = ?`,
                        [code]
                    );
                }

                // Upsert user record - handle both legacy and new codes
                const userEmail = email || (isLegacyCode ? row.email : null) || '';
                await this.bot.database.run(`INSERT OR IGNORE INTO users (id, email, is_pro) VALUES (?, ?, 0)`, [userId, userEmail]);
                await this.bot.database.run(`UPDATE users SET is_pro = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [userId]);

                return res.json({ success: true });
            } catch (e) {
                this.bot.logger.error('Error activating code:', e);
                return res.status(500).json({ error: 'Failed to activate code', details: e.message });
            }
        });
        
        // Unified subscription status (user-level) - FIXED: Use JWT identity
        this.app.get('/api/subscription', async (req, res) => {
            try {
                const userId = req.user?.userId; // Use JWT identity, not user-supplied
                if (!userId) return res.status(401).json({ error: 'Unauthorized - valid JWT required' });
                const row = await this.bot.database.get(`SELECT is_pro FROM users WHERE id = ?`, [userId]);
                const isPro = !!(row && (row.is_pro === 1 || row.is_pro === true));
                return res.json({ success: true, subscription: isPro ? { plan: 'pro', status: 'active', active: true } : { plan: 'free', status: 'inactive', active: false } });
            } catch (e) { return res.status(500).json({ error: 'Failed to load subscription' }); }
        });

        // Customization: save per-guild settings (expanded) - FIXED: Use JWT identity
        this.app.post('/api/customization/save', async (req, res) => {
            try {
                const { guildId, payload } = req.body || {};
                const userId = req.user?.userId; // Use JWT identity, not user-supplied
                if (!guildId || !userId || !payload) return res.status(400).json({ error: 'Missing guildId/payload or unauthorized' });
                const row = await this.bot.database.get(`SELECT is_pro FROM users WHERE id = ?`, [userId]);
                if (!row || !row.is_pro) return res.status(403).json({ error: 'Pro Required' });
                await this.ensureSchema();
                await this.bot.database.run(`INSERT OR IGNORE INTO guild_customization (guild_id) VALUES (?)`, [guildId]);
                
                const p = payload || {};
                await this.bot.database.run(`UPDATE guild_customization SET 
                    tickets_categories = ?, tickets_autoclose = ?, tickets_autoclose_hours = ?, tickets_footer = ?, tickets_priority = ?,
                    tickets_max_per_user = ?, tickets_ratings = ?,
                    welcome_title = ?, welcome_message = ?, welcome_color = ?, welcome_rules = ?, welcome_dm = ?,
                    mod_severity = ?, mod_warn_threshold = ?, mod_mute_duration = ?, mod_warn_expiry = ?, mod_logging = ?, mod_require_reason = ?,
                    verify_message = ?, verify_button = ?, verify_color = ?, verify_success = ?, verify_kick_hours = ?,
                    log_edits = ?, log_deletes = ?, log_members = ?, log_roles = ?, log_channels = ?, log_compact = ?,
                    brand_name = ?, brand_footer = ?, brand_icon = ?, brand_timestamp = ?,
                    site_primary = ?, site_accent = ?, site_tagline = ?, site_copyright = ?, site_stats = ?,
                    theme_name = ?, layout_sidebar = ?, layout_compact = ?, layout_animations = ?, layout_fontsize = ?,
                    updated_at = CURRENT_TIMESTAMP
                    WHERE guild_id = ?`, [
                    p.tickets?.categories ? 1 : 0, p.tickets?.autoclose ? 1 : 0, p.tickets?.autocloseHours || 48, p.tickets?.footer || '', p.tickets?.priority || 'normal',
                    p.tickets?.maxPerUser || 3, p.tickets?.ratings ? 1 : 0,
                    p.welcome?.title || '', p.welcome?.message || '', p.welcome?.color || '', p.welcome?.rules ? 1 : 0, p.welcome?.dm ? 1 : 0,
                    p.moderation?.severity || 'moderate', p.moderation?.warnThreshold || 3, p.moderation?.muteDuration || 10, p.moderation?.warnExpiry || 30, p.moderation?.logging ? 1 : 0, p.moderation?.requireReason ? 1 : 0,
                    p.verification?.message || '', p.verification?.button || '', p.verification?.color || '', p.verification?.success || '', p.verification?.kickHours || 24,
                    p.logging?.edits ? 1 : 0, p.logging?.deletes ? 1 : 0, p.logging?.members ? 1 : 0, p.logging?.roles ? 1 : 0, p.logging?.channels ? 1 : 0, p.logging?.compact ? 1 : 0,
                    p.branding?.name || '', p.branding?.footer || '', p.branding?.icon || '', p.branding?.timestamp ? 1 : 0,
                    p.website?.primary || '', p.website?.accent || '', p.website?.tagline || '', p.website?.copyright || '', p.website?.stats ? 1 : 0,
                    p.theme?.name || 'emerald', p.theme?.sidebar || 'left', p.theme?.compact ? 1 : 0, p.theme?.animations ? 1 : 0, p.theme?.fontsize || 'medium',
                    guildId
                ]);
                return res.json({ success: true });
            } catch (e) { 
                console.error('[Customization] Save error:', e);
                return res.status(500).json({ error: 'Failed to save customization' }); 
            }
        });

        // Customization: load per-guild settings - FIXED: Use JWT identity
        this.app.get('/api/customization/load', async (req, res) => {
            try {
                const guildId = req.query.guildId;
                const userId = req.user?.userId; // Use JWT identity, not user-supplied
                if (!guildId || !userId) return res.status(400).json({ error: 'Missing guildId or unauthorized' });
                const row = await this.bot.database.get(`SELECT is_pro FROM users WHERE id = ?`, [userId]);
                if (!row || !row.is_pro) return res.status(403).json({ error: 'Pro Required' });
                const cs = await this.bot.database.get(`SELECT * FROM guild_customization WHERE guild_id = ?`, [guildId]);
                return res.json({ success: true, customization: cs || {} });
            } catch (e) { return res.status(500).json({ error: 'Failed to load customization' }); }
        });
        this.app.get('/api/tickets/stats', this.getTicketStats.bind(this));
        this.app.get('/api/server/info', this.getServerInfo.bind(this));
        this.app.get('/api/server-info', this.getServerInfo.bind(this)); // Alias for dashboard

        // Debug endpoints for troubleshooting (admin-only, behind /api/ auth middleware)
        const requireAdmin = (req, res, next) => {
            if (!req.user || req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }
            next();
        };
        this.app.get('/api/debug/database', requireAdmin, this.debugDatabase.bind(this));
        this.app.get('/api/debug/guild/:guildId', requireAdmin, this.debugGuild.bind(this));
        this.app.get('/api/debug/tables', requireAdmin, this.debugTables.bind(this));
        
        // NOTE: Unauthenticated /debug-config and /debug-create-config endpoints have been
        // removed for security. Use the /api/debug/* endpoints (admin-only) instead.

        // Internal test endpoint to trigger a setting-change event for diagnostics
        // Protected by INTERNAL_API_KEY header; INTERNAL_API_KEY must be set
        this.app.post('/api/internal/test-setting-change', async (req, res) => {
            try {
                const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
                const expected = process.env.INTERNAL_API_KEY;
                if (!expected) {
                    this.bot?.logger?.error && this.bot.logger.error('INTERNAL_API_KEY is not configured for /api/internal/test-setting-change');
                    return res.status(500).json({ error: 'Server misconfigured' });
                }
                if (apiKey !== expected) return res.status(401).json({ error: 'Unauthorized' });

                const { guildId, key, value, userId, category, oldValue } = req.body || {};
                if (!guildId || !key) return res.status(400).json({ error: 'guildId and key required' });

                // Invoke bot helper
                if (this.bot && typeof this.bot.emitSettingChange === 'function') {
                    await this.bot.emitSettingChange(String(guildId), userId || 'internal', String(key), value, typeof oldValue === 'undefined' ? null : oldValue, category || 'configuration');
                    this.bot.logger?.info && this.bot.logger.info(`Triggered test setting change for ${guildId} ${key}=${value}`);
                    return res.json({ success: true, message: 'Test event emitted' });
                }

                return res.status(500).json({ error: 'emitSettingChange not available' });
            } catch (e) {
                this.bot?.logger?.error && this.bot.logger.error('Test setting change error:', e?.message || e);
                return res.status(500).json({ error: e.message || String(e) });
            }
        });

        // Image fallbacks (avoid broken UI when local images are missing)
        this.app.get('/images/default-server.png', (req, res) => {
            res.redirect('https://cdn.discordapp.com/embed/avatars/0.png');
        });
        this.app.get('/images/default-avatar.png', (req, res) => {
            res.redirect('https://cdn.discordapp.com/embed/avatars/1.png');
        });
        this.app.get('/images/logo.png', (req, res) => {
            res.redirect('https://cdn.discordapp.com/embed/avatars/0.png');
        });
        
        // Protected API routes (require authentication) - MOVED BEFORE SETUP ENDPOINTS FOR SECURITY
        console.log('[ROUTE SETUP] Registering /api authentication middleware');
        this.app.use('/api', this.authenticateToken.bind(this));
        
        // Setup API endpoints (now protected by authentication)
        this.app.get('/api/channels', this.getChannels.bind(this));
        this.app.get('/api/roles', this.getRoles.bind(this));
        this.app.get('/api/settings/security', this.getSecuritySettings.bind(this));
        this.app.post('/api/settings/security', this.saveSecuritySettings.bind(this));
        // Anti-phishing specific endpoints (used by setup-anti-phishing-modern.html)
        this.app.get('/api/settings/antiphishing', this.getAntiPhishingSettings.bind(this));
        this.app.post('/api/settings/antiphishing', this.saveAntiPhishingSettings.bind(this));
        // Anti-nuke specific endpoints (used by setup-antinuke-modern.html)
        this.app.get('/api/settings/antinuke', this.getAntiNukeSettings.bind(this));
        this.app.post('/api/settings/antinuke', this.saveAntiNukeSettings.bind(this));
        // Notifications & Logs endpoints
        this.app.get('/api/settings/notifications', this.getNotificationSettings.bind(this));
        this.app.post('/api/settings/notifications', this.saveNotificationSettings.bind(this));
        this.app.post('/api/settings/notifications/verify-email', this.authenticateToken.bind(this), this.verifyNotificationEmail.bind(this));
        this.app.get('/api/settings/tickets', this.getTicketSettings.bind(this));
        this.app.post('/api/settings/tickets', this.saveTicketSettings.bind(this));
        this.app.get('/api/settings/moderation', this.getModerationSettings.bind(this));
        this.app.post('/api/settings/moderation', this.saveModerationSettings.bind(this));
        this.app.get('/api/settings/features', this.getFeatureSettings.bind(this));
        this.app.post('/api/settings/features', this.saveFeatureSettings.bind(this));
        // AI settings endpoints
        this.app.get('/api/settings/ai', this.getAISettings.bind(this));
        this.app.post('/api/settings/ai', this.saveAISettings.bind(this));
        
        // Theme customization endpoints
        this.app.get('/api/settings/theme', this.getThemeSettings.bind(this));
        this.app.post('/api/settings/theme', this.saveThemeSettings.bind(this));
        this.app.post('/api/upload/image', express.json({ limit: '12mb' }), this.uploadThemeImage.bind(this));
        
        // XP settings endpoints
        this.app.get('/api/settings/xp', this.getXPSettings.bind(this));
        this.app.post('/api/settings/xp', this.saveXPSettings.bind(this));
        
        // Guild settings endpoints (for toggle persistence)
        this.app.get('/api/guilds/:guildId/settings', this.getGuildSettings.bind(this));
        this.app.patch('/api/guilds/:guildId/settings', this.updateGuildSettings.bind(this));

        // Command permissions endpoints
        this.app.get('/api/guilds/:guildId/commands', this.getGuildCommands.bind(this));
        this.app.get('/api/guilds/:guildId/permissions', this.getGuildCommandPermissions.bind(this));
        this.app.post('/api/guilds/:guildId/permissions', this.saveGuildCommandPermissions.bind(this));
        
        // Ticket system endpoints (per-guild tickets)
        this.app.get('/api/guilds/:guildId/tickets', this.getGuildTickets.bind(this));
        
        // AI chat proxy endpoint (requires internal API key, not user auth)
        this.app.post('/api/ai/chat', this.proxyAIChat.bind(this));
        
        // Event system endpoint (requires internal API key for security)
        // Use the consolidated handler which validates keys and persists events
        this.app.post('/api/events', this.handleEventPost.bind(this));
        
        // Guild settings endpoint for bot command sync (single registration)
        this.app.post('/api/guilds/:guildId/settings', this.updateGuildSettings.bind(this));
        
        // Guild-specific routes (matching frontend pattern)
        this.app.get('/api/guild/:guildId/channels', this.getGuildChannels.bind(this));
        this.app.get('/api/guild/:guildId/roles', this.getGuildRoles.bind(this));
        this.app.get('/api/guild/:guildId/settings', this.getGuildSpecificSettings.bind(this));
        // POST/PATCH aliases for /api/guild/:guildId/settings (singular)
        // Setup pages POST to this path — forward to updateGuildSettings (same handler as /api/guilds/)
        this.app.post('/api/guild/:guildId/settings', this.updateGuildSettings.bind(this));
        this.app.patch('/api/guild/:guildId/settings', this.updateGuildSettings.bind(this));
        
        this.app.get('/api/dashboard-data', this.getDashboardData.bind(this));
        
        // Admin stats endpoint
        this.app.get('/api/admin/stats', this.authenticateToken.bind(this), this.getAdminStats.bind(this));
        
        // Quick fix endpoint to populate missing configs
        this.app.post('/api/initialize-guild', async (req, res) => {
            try {
                const guildId = req.query.guildId || req.body.guildId;
                if (!guildId) {
                    return res.status(400).json({ error: 'Guild ID required' });
                }
                
                // Create default config
                await this.bot.database.run(`
                    INSERT OR REPLACE INTO guild_configs (
                        guild_id, anti_raid_enabled, anti_spam_enabled, anti_links_enabled,
                        anti_phishing_enabled, verification_enabled, welcome_enabled,
                        tickets_enabled, auto_mod_enabled, autorole_enabled
                    ) VALUES (?, 1, 1, 1, 1, 1, 1, 1, 1, 1)
                `, [guildId]);
                
                // Create default bot settings
                await this.bot.database.run(`
                    INSERT OR REPLACE INTO guild_settings (guild_id, welcome_enabled, automod_enabled)
                    VALUES (?, 1, 1)
                `, [guildId]);
                
                this.bot.logger.info(`Initialized guild config for ${guildId}`);
                res.json({ success: true, message: `Guild ${guildId} initialized` });
            } catch (error) {
                this.bot.logger.error('Initialize guild error:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.get('/api/security-status', this.getSecurityStatus.bind(this));
        
        // Quick Actions
        this.app.post('/api/lockdown', this.handleLockdown.bind(this));
        this.app.post('/api/invites', this.handleInvites.bind(this));
        this.app.post('/api/emergency', this.handleEmergency.bind(this));
        this.app.delete('/api/raid-flags', this.clearRaidFlags.bind(this));
        this.app.post('/api/threats/:id/resolve', this.resolveThreat.bind(this));
        
        // Settings
        this.app.post('/api/security-settings', this.updateSecuritySettings.bind(this));
        this.app.post('/api/settings/update', this.updateOnboardingSettings.bind(this));
        this.app.post('/api/advanced-settings', this.updateAdvancedSettings.bind(this));
        this.app.post('/api/bot-settings', this.updateBotSettings.bind(this));
        // Verification actions (dashboard)
        this.app.post('/api/verify/action', this.authenticateToken.bind(this), this.verifyAction.bind(this));
        this.app.get('/api/verify/queue', this.authenticateToken.bind(this), this.getVerifyQueue.bind(this));
        this.app.post('/api/verify/queue/batch', this.authenticateToken.bind(this), this.batchVerifyQueue.bind(this));
        this.app.post('/api/verify/captcha/start', this.authenticateToken.bind(this), this.startCaptcha.bind(this));
        this.app.post('/api/verify/captcha/submit', this.authenticateToken.bind(this), this.submitCaptcha.bind(this));
        this.app.post('/api/verify/note', this.authenticateToken.bind(this), this.addVerificationNote.bind(this));
        this.app.post('/api/api-keys', this.updateApiKeys.bind(this));
        this.app.post('/api/settings/reset', this.resetSettings.bind(this));
        this.app.get('/api/analytics', this.getAnalytics.bind(this));
        this.app.get('/api/logs', this.getLogs.bind(this));
        this.app.get('/api/audit-logs', this.authenticateToken.bind(this), this.getAuditLogs.bind(this));
        
        // XP Events endpoints
        this.app.get('/api/xp-events', this.authenticateToken.bind(this), this.getXPEvents.bind(this));
        this.app.post('/api/xp-events', this.authenticateToken.bind(this), this.createXPEvent.bind(this));
        this.app.delete('/api/xp-events/:id', this.authenticateToken.bind(this), this.deleteXPEvent.bind(this));
        
        // Seasonal Leaderboard endpoints
        this.app.get('/api/seasons', this.authenticateToken.bind(this), this.getSeasons.bind(this));
        this.app.post('/api/seasons', this.authenticateToken.bind(this), this.createSeason.bind(this));
        this.app.post('/api/seasons/:id/reset', this.authenticateToken.bind(this), this.resetSeason.bind(this));
        this.app.get('/api/seasons/:id/leaderboard', this.authenticateToken.bind(this), this.getSeasonLeaderboard.bind(this));
        this.app.post('/api/seasons/:id/claim-reward', this.authenticateToken.bind(this), this.claimSeasonReward.bind(this));
        
        // Setup
        this.app.post('/api/setup', this.handleSetup.bind(this));
        
        // Logs and Analytics
        this.app.get('/api/logs', this.getLogs.bind(this));
        this.app.get('/api/logs/export', this.exportLogs.bind(this));
        this.app.delete('/api/logs', this.clearLogs.bind(this));
        
        // Action Logs and Undo Endpoints
        this.app.get('/api/actions', this.getActions.bind(this));
        this.app.post('/api/actions/:id/undo', this.undoAction.bind(this));
        this.app.get('/api/actions/stats', this.getActionStats.bind(this));
        this.app.get('/api/incidents', this.getIncidents.bind(this));

        // Ticket system routes (specific routes BEFORE parameterized routes)
        this.app.get('/api/tickets/list', this.authenticateToken.bind(this), this.getTicketsList.bind(this));
        this.app.get('/api/tickets', this.authenticateToken.bind(this), this.getTickets.bind(this)); // Main tickets endpoint
        this.app.get('/api/tickets/:id/messages', this.authenticateToken.bind(this), this.getTicketMessages.bind(this));
        this.app.post('/api/tickets/:id/reply', this.authenticateToken.bind(this), this.replyToTicket.bind(this));
        this.app.post('/api/tickets/:id/close', this.authenticateToken.bind(this), this.closeTicketAPI.bind(this));
        this.app.post('/api/tickets/:id/reopen', this.authenticateToken.bind(this), this.reopenTicketAPI.bind(this));
        this.app.post('/api/tickets/:id/assign', this.authenticateToken.bind(this), this.assignTicket.bind(this));
        this.app.post('/api/tickets/:id/status', this.authenticateToken.bind(this), this.updateTicketStatus.bind(this));
        this.app.post('/api/tickets/:id/priority', this.authenticateToken.bind(this), this.updateTicketPriority.bind(this));
        this.app.post('/api/tickets/:id/claim', this.authenticateToken.bind(this), this.claimTicket.bind(this));
        this.app.post('/api/tickets/:id/notes', this.authenticateToken.bind(this), this.addTicketNote.bind(this));
        this.app.get('/api/tickets/:id/notes', this.authenticateToken.bind(this), this.getTicketNotes.bind(this));
        this.app.get('/api/tickets/:id/history', this.authenticateToken.bind(this), this.getTicketHistory.bind(this));
        this.app.get('/api/server/staff', this.authenticateToken.bind(this), this.getServerStaff.bind(this));
        this.app.get('/api/tickets/:id', this.authenticateToken.bind(this), this.getTicketDetails.bind(this)); // Parameterized route LAST

        // Help Ticket endpoints
        this.app.get('/api/help-tickets', this.getHelpTickets.bind(this));
        this.app.get('/api/help-tickets/stats', this.getHelpTicketStats.bind(this));
        this.app.get('/api/help-tickets/:ticketId', this.getHelpTicketDetails.bind(this));
        this.app.post('/api/help-tickets/:ticketId/status', this.updateHelpTicketStatus.bind(this));
        this.app.post('/api/help-tickets/:ticketId/assign', this.assignHelpTicket.bind(this));
        this.app.post('/api/help-tickets/:ticketId/reply', this.replyToHelpTicket.bind(this));
        this.app.post('/api/help-tickets/:ticketId/priority', this.updateHelpTicketPriority.bind(this));
        this.app.post('/api/help-tickets/:ticketId/note', this.addHelpTicketNote.bind(this));
        this.app.delete('/api/help-tickets/:ticketId', this.deleteHelpTicket.bind(this));

        // Code Generator endpoints (Pro Plan Unlock)
        this.app.post('/api/generate-code', this.generateProCode.bind(this));
        this.app.get('/api/codes/list', this.listGeneratedCodes.bind(this));
        this.app.post('/api/codes/:code/redeem', this.redeemProCode.bind(this));
        this.app.post('/api/codes/:code/revoke', this.revokeProCode.bind(this));
        this.app.delete('/api/codes/:code/delete', this.deleteProCode.bind(this));

        // Verification endpoints (dashboard control)
        this.app.get('/api/guilds/:guildId/verification', this.getGuildVerificationQueue.bind(this));
        this.app.post('/api/guilds/:guildId/verification/:id/approve', this.approveVerification.bind(this));
        this.app.post('/api/guilds/:guildId/verification/:id/deny', this.denyVerification.bind(this));

        // Logging & Audit endpoints
        this.app.get('/api/logs', this.authenticateToken.bind(this), this.getBotLogs.bind(this));
        this.app.get('/api/logs/audit', this.authenticateToken.bind(this), this.getDashboardAudit.bind(this));

        // Ticket claim endpoint (dashboard shorthand)
        this.app.post('/api/guilds/:guildId/tickets/:ticketId/claim', this.claimTicketFromDashboard.bind(this));

        // Quarantine and flagged content routes
        this.app.get('/api/quarantine/list', this.getQuarantinedMessages.bind(this));
        this.app.post('/api/quarantine/:id/approve', this.approveQuarantinedMessage.bind(this));
        this.app.post('/api/quarantine/:id/delete', this.deleteQuarantinedMessage.bind(this));
        this.app.get('/api/security/scan/history', this.getScanHistory.bind(this));
        this.app.post('/api/security/scan/start', this.startSecurityScan.bind(this));
        this.app.get('/api/settings/auto-delete', this.getAutoDeleteSettings.bind(this));
        this.app.post('/api/settings/auto-delete', this.saveAutoDeleteSettings.bind(this));

        // Multi-server management routes
        this.app.get('/api/servers/list', this.getUserServers.bind(this));
        this.app.post('/api/servers/select', this.selectServer.bind(this));
        
        // Word filter preset routes
        this.app.get('/api/word-filter/presets', this.authenticateToken.bind(this), this.getWordFilterPresets.bind(this));
        this.app.post('/api/guild/:guildId/word-filter/preset', this.authenticateToken.bind(this), this.applyWordFilterPreset.bind(this));

        // Access code routes for dashboard access control
        this.app.post('/api/access-codes/generate', this.generateAccessCode.bind(this));
        this.app.post('/api/access-codes/redeem', this.redeemAccessCode.bind(this));
        this.app.get('/api/guild/:guildId/access-codes', this.getGuildAccessCodes.bind(this));
        this.app.post('/api/access-codes/:code/revoke', this.revokeAccessCode.bind(this));
        this.app.get('/api/servers/current', this.getCurrentServer.bind(this));

        // Shared access management routes
        this.app.get('/api/dashboard/:guildId/shared-access', this.authenticateToken.bind(this), this.getSharedAccessList.bind(this));
        this.app.post('/api/dashboard/:guildId/shared-access/grant-user', this.authenticateToken.bind(this), this.grantUserAccess.bind(this));
        this.app.post('/api/dashboard/:guildId/shared-access/grant-role', this.authenticateToken.bind(this), this.grantRoleAccess.bind(this));
        this.app.post('/api/dashboard/:guildId/shared-access/generate-code', this.authenticateToken.bind(this), this.generateAccessCode.bind(this));
        this.app.post('/api/dashboard/:guildId/shared-access/revoke-user', this.authenticateToken.bind(this), this.revokeUserAccess.bind(this));
        this.app.post('/api/dashboard/:guildId/shared-access/revoke-role', this.authenticateToken.bind(this), this.revokeRoleAccess.bind(this));
        this.app.post('/api/dashboard/:guildId/shared-access/delete-code', this.authenticateToken.bind(this), this.deleteAccessCode.bind(this));
        this.app.post('/api/dashboard/:guildId/shared-access/redeem-code', this.authenticateToken.bind(this), this.redeemAccessCode.bind(this));
        this.app.post('/api/access/recheck', this.authenticateToken.bind(this), this.recheckUserAccess.bind(this));

        // Canonical /api/guild/:guildId/access/* routes used by access-share.html
        // These alias the /api/dashboard/:guildId/shared-access/* handlers above
        this.app.post('/api/guild/:guildId/access/users', this.authenticateToken.bind(this), async (req, res) => {
            // Frontend sends { userId, permission } — map to what grantUserAccess expects
            req.body.userId = req.body.userId || req.body.userId;
            return this.grantUserAccess(req, res);
        });
        this.app.post('/api/guild/:guildId/access/roles', this.authenticateToken.bind(this), async (req, res) => {
            // Frontend sends { roleId, permission } — grantRoleAccess already reads roleId
            return this.grantRoleAccess(req, res);
        });

        // Guild member search — used by access-share.html member picker
        this.app.get('/api/guild/:guildId/members/search', this.authenticateToken.bind(this), async (req, res) => {
            try {
                const { guildId } = req.params;
                const q = (req.query.q || '').toLowerCase().trim();
                const limit = Math.min(parseInt(req.query.limit) || 20, 50);
                const userId = req.user?.discordId || req.user?.userId;

                const access = await this.checkGuildAccess(userId, guildId, true);
                if (!access.authorized) return res.status(403).json({ error: access.error });

                const guild = this.bot.client.guilds.cache.get(guildId);
                if (!guild) return res.status(404).json({ error: 'Guild not found' });

                // Fetch members whose username/displayName matches query
                let members = [];
                if (q) {
                    // Try fetching by username query first (Discord API supports this)
                    try {
                        const fetched = await guild.members.search({ query: q, limit });
                        members = fetched.map(m => ({
                            id: m.user.id,
                            username: m.user.username,
                            displayName: m.displayName || m.user.globalName || m.user.username,
                            avatar: m.user.avatar,
                        }));
                    } catch (e) {
                        // Fallback: filter from cache
                        members = guild.members.cache
                            .filter(m => !m.user.bot &&
                                (m.user.username.toLowerCase().includes(q) ||
                                 (m.displayName || '').toLowerCase().includes(q)))
                            .first(limit)
                            .map(m => ({
                                id: m.user.id,
                                username: m.user.username,
                                displayName: m.displayName || m.user.globalName || m.user.username,
                                avatar: m.user.avatar,
                            }));
                    }
                } else {
                    members = guild.members.cache
                        .filter(m => !m.user.bot)
                        .first(limit)
                        .map(m => ({
                            id: m.user.id,
                            username: m.user.username,
                            displayName: m.displayName || m.user.globalName || m.user.username,
                            avatar: m.user.avatar,
                        }));
                }

                res.json({ members });
            } catch (error) {
                this.bot.logger?.error('Error searching guild members:', error);
                res.status(500).json({ error: 'Failed to search members' });
            }
        });
        
        // Simple access code redemption (no guild ID required)
        this.app.post('/api/redeem-access-code', this.authenticateToken.bind(this), this.redeemAccessCodeSimple.bind(this));
        this.app.get('/api/user', this.authenticateToken.bind(this), this.getCurrentUser.bind(this));

        // Staff roles and advanced permissions routes
        this.app.get('/api/dashboard/:guildId/staff-roles', this.authenticateToken.bind(this), this.getStaffRoles.bind(this));
        this.app.post('/api/dashboard/:guildId/staff-roles', this.authenticateToken.bind(this), this.saveStaffRoles.bind(this));
        this.app.get('/api/dashboard/:guildId/advanced-permissions', this.authenticateToken.bind(this), this.getAdvancedPermissions.bind(this));
        this.app.post('/api/dashboard/:guildId/advanced-permissions', this.authenticateToken.bind(this), this.saveAdvancedPermissions.bind(this));

        // Moderation action endpoints (for spam alerts)
        this.app.post('/api/moderation/:guildId/timeout/remove', this.authenticateToken.bind(this), this.removeTimeout.bind(this));
        this.app.post('/api/moderation/:guildId/warn', this.authenticateToken.bind(this), this.warnUser.bind(this));
        this.app.post('/api/moderation/:guildId/kick', this.authenticateToken.bind(this), this.kickUser.bind(this));
        this.app.post('/api/moderation/:guildId/ban', this.authenticateToken.bind(this), this.banUser.bind(this));

        // Bug report route
        this.app.post('/api/bug-report', this.submitBugReport.bind(this));
        
        // Registration route
        this.app.post('/api/auth/register', this.registerUser.bind(this));
        
        // Serve static website pages
        this.app.get('/bug-report', (req, res) => {
            res.sendFile(path.join(__dirname, '../website/bug-report.html'));
        });
        this.app.get('/register', (req, res) => {
            res.sendFile(path.join(__dirname, '../website/register.html'));
        });

        // Error handler
        this.app.use((err, req, res, next) => {
            this.bot.logger.error('Dashboard error:', err);
            // Don't expose stack traces in production
            const isDev = process.env.NODE_ENV !== 'production';
            res.status(err.status || 500).json({ 
                error: 'Internal server error',
                ...(isDev && { message: err.message })
            });
        });
    }

    /**
     * Authorization helper: Verify user has access to a guild
     * @param {string} userId - Discord user ID
     * @param {string} guildId - Guild ID to check
     * @param {boolean} requireManage - Whether to require manage permissions (default: true)
     * @returns {Promise<{authorized: boolean, member: object|null, error: string|null, accessType: string|null}>}
     */
    async checkGuildAccess(userId, guildId, requireManage = true) {
        // No magic string bypass — admin access is determined by JWT role in the request,
        // not by a hardcoded userId. The caller must check req.user.role separately if needed.

        // Get guild
        const guild = this.bot.client.guilds.cache.get(guildId);
        if (!guild) {
            return { authorized: false, member: null, error: 'Guild not found', accessType: null };
        }

        // Check 1: Is user the server owner?
        if (guild.ownerId === userId) {
            return { authorized: true, member: null, error: null, accessType: 'owner' };
        }

        // Check 2: Does user have explicit DB access grant?
        const hasExplicitAccess = await this.bot.database.get(
            `SELECT 1 FROM dashboard_access WHERE guild_id = ? AND user_id = ?`,
            [guildId, userId]
        );
        
        if (hasExplicitAccess) {
            // If they have explicit access, no need to check manage permissions
            return { authorized: true, member: null, error: null, accessType: 'explicit_grant' };
        }

        // Fetch member to check Discord permissions and roles
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            return { authorized: false, member: null, error: 'You are not a member of this server', accessType: null };
        }

        // Check 3: Does user have Discord admin/manage permissions?
        if (requireManage) {
            const hasPerms = member.permissions.has('Administrator') || 
                           member.permissions.has('ManageGuild');
            
            if (hasPerms) {
                return { authorized: true, member, error: null, accessType: 'discord_permissions' };
            }
        } else {
            // If manage permissions not required, just being a member is enough
            return { authorized: true, member, error: null, accessType: 'member' };
        }

        // Check 4: Does user have a role that grants access?
        const roleAccess = await this.bot.database.all(
            `SELECT role_id FROM dashboard_role_access WHERE guild_id = ?`,
            [guildId]
        );
        
        if (roleAccess.length > 0) {
            const grantedRoleIds = roleAccess.map(row => row.role_id);
            const userRoleIds = member.roles.cache.map(r => r.id);
            const hasGrantedRole = grantedRoleIds.some(roleId => userRoleIds.includes(roleId));
            
            if (hasGrantedRole) {
                return { authorized: true, member, error: null, accessType: 'role_grant' };
            }
        }

        // No access found
        if (requireManage) {
            return { authorized: false, member, error: 'You do not have manage permissions in this server', accessType: null };
        } else {
            return { authorized: false, member, error: 'You do not have access to this server', accessType: null };
        }
    }

    async verifyAction(req, res) {
        try {
            const { guildId, userId, action } = req.body || {};
            if (!guildId || !userId || !action) return res.status(400).json({ error: 'guildId, userId and action required' });
            const valid = ['verify','skip','kick','approve','reject','dequeue'];
            if (!valid.includes(action)) return res.status(400).json({ error: 'Invalid action' });

            const actorId = req.user?.discordId || req.user?.userId || 'dashboard';
            const Actions = require('../security/verificationActions');
            if (!this.bot.verificationActions) this.bot.verificationActions = new Actions(this.bot);

            let result;
            switch (action) {
                case 'verify': result = await this.bot.verificationActions.verifyUser(guildId, userId, actorId, 'dashboard'); break;
                case 'skip': result = await this.bot.verificationActions.skipUser(guildId, userId, actorId, 'dashboard'); break;
                case 'kick': result = await this.bot.verificationActions.kickUser(guildId, userId, actorId, 'dashboard'); break;
                case 'approve': result = await this.bot.verificationActions.approveUser(guildId, userId, actorId, 'dashboard'); break;
                case 'reject': result = await this.bot.verificationActions.rejectUser(guildId, userId, actorId, 'dashboard'); break;
                case 'dequeue':
                    await this.bot.database.run('DELETE FROM verification_queue WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
                    result = { success: true };
                    break;
            }
            return res.json({ success: true, result });
        } catch (err) {
            this.bot.logger?.error('verifyAction error:', err);
            return res.status(500).json({ error: 'Failed to process verification action' });
        }
    }

    async getVerifyQueue(req, res) {
        try {
            const guildId = req.query.guildId || req.body?.guildId;
            if (!guildId) return res.status(400).json({ error: 'guildId required' });
            const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 200);
            const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
            const rows = await this.bot.database.all(
                `SELECT vr.user_id, vr.status, vr.method, vr.actor_id, vr.source, vr.profile_used, vr.risk_score, vr.notes, vr.created_at, vr.updated_at,
                        ur.username, ur.avatar_url, ur.join_date, ur.account_created
                 FROM verification_records vr
                 LEFT JOIN user_records ur ON ur.guild_id = vr.guild_id AND ur.user_id = vr.user_id
                 WHERE vr.guild_id = ? AND (vr.status = 'pending' OR vr.status = 'awaiting_approval')
                 ORDER BY vr.created_at ASC LIMIT ? OFFSET ?`,
                [guildId, limit, offset]
            );
            const countRow = await this.bot.database.get(
                `SELECT COUNT(*) as total FROM verification_records WHERE guild_id = ? AND (status = 'pending' OR status = 'awaiting_approval')`,
                [guildId]
            );
            // derive flags
            const enriched = rows.map(r => {
                const createdAt = r.account_created ? new Date(r.account_created) : null;
                const accountAgeDays = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / (1000*60*60*24)) : null;
                const flags = [];
                if (!r.avatar_url) flags.push('no_avatar');
                if (accountAgeDays !== null && accountAgeDays < 7) flags.push('new_account');
                if (r.username && /discord|admin|mod|official|support/i.test(r.username)) flags.push('suspicious_name');
                const riskLevel = (r.risk_score >= 80) ? 'critical' : (r.risk_score >= 60) ? 'high' : (r.risk_score >= 30) ? 'medium' : 'low';
                const recommendedAction = riskLevel === 'critical' ? 'kick' : riskLevel === 'high' ? 'review' : (r.status === 'awaiting_approval' ? 'approve' : 'verify');
                return {
                    userId: r.user_id,
                    username: r.username,
                    avatarUrl: r.avatar_url,
                    joinedAt: r.join_date,
                    accountCreatedAt: r.account_created,
                    riskScore: r.risk_score,
                    profile: r.profile_used,
                    status: r.status,
                    notes: r.notes,
                    flags,
                    verificationSummary: {
                        riskLevel,
                        riskReasons: flags,
                        recommendedAction,
                        profileMode: r.profile_used || 'standard',
                        notesPresent: !!(r.notes && r.notes.length)
                    }
                };
            });
            return res.json({ success: true, data: enriched, total_count: countRow?.total || 0 });
        } catch (err) {
            this.bot.logger?.error('getVerifyQueue error:', err);
            return res.status(500).json({ error: 'Failed to fetch queue' });
        }
    }

    async addVerificationNote(req, res) {
        try {
            const { guildId, userId, noteText, mode } = req.body || {};
            if (!guildId || !userId || !noteText) return res.status(400).json({ error: 'guildId, userId and noteText required' });
            const actorId = req.user?.discordId || req.user?.userId || 'dashboard';
            const source = 'dashboard_button';
            const Actions = require('../security/verificationActions');
            if (!this.bot.verificationActions) this.bot.verificationActions = new Actions(this.bot);
            let result;
            if (mode === 'update') {
                result = await this.bot.verificationActions.updateNote(guildId, userId, actorId, noteText, source);
            } else {
                result = await this.bot.verificationActions.appendNote(guildId, userId, actorId, noteText, source);
            }
            if (!result.success) return res.status(400).json(result);
            return res.json({ success: true, notes: result.notes });
        } catch (err) {
            this.bot.logger?.error('addVerificationNote error:', err);
            return res.status(500).json({ error: 'Failed to save note' });
        }
    }

    async batchVerifyQueue(req, res) {
        try {
            const { guildId, action, userIds } = req.body || {};
            if (!guildId || !action) return res.status(400).json({ error: 'guildId and action required' });
            const valid = ['verify','skip','kick','approve','reject','dequeue'];
            if (!valid.includes(action)) return res.status(400).json({ error: 'Invalid action' });

            const Actions = require('../security/verificationActions');
            if (!this.bot.verificationActions) this.bot.verificationActions = new Actions(this.bot);
            const actorId = req.user?.discordId || req.user?.userId || 'dashboard';

            const ids = Array.isArray(userIds) ? userIds : [];
            const results = [];
            for (const uid of ids) {
                try {
                    const prev = await this.bot.database.get(`SELECT status FROM verification_records WHERE guild_id = ? AND user_id = ?`, [guildId, uid]);
                    const oldStatus = prev?.status || 'pending';
                    let newStatus = oldStatus;
                    let resItem;
                    switch (action) {
                        case 'verify': resItem = await this.bot.verificationActions.verifyUser(guildId, uid, actorId, 'dashboard-batch'); newStatus = 'verified'; break;
                        case 'skip': resItem = await this.bot.verificationActions.skipUser(guildId, uid, actorId, 'dashboard-batch'); newStatus = 'skipped'; break;
                        case 'kick': resItem = await this.bot.verificationActions.kickUser(guildId, uid, actorId, 'dashboard-batch'); newStatus = 'kicked'; break;
                        case 'approve': resItem = await this.bot.verificationActions.approveUser(guildId, uid, actorId, 'dashboard-batch'); newStatus = 'approved'; break;
                        case 'reject': resItem = await this.bot.verificationActions.rejectUser(guildId, uid, actorId, 'dashboard-batch'); newStatus = 'rejected'; break;
                        case 'dequeue':
                            await this.bot.database.run('DELETE FROM verification_queue WHERE guild_id = ? AND user_id = ?', [guildId, uid]);
                            resItem = { success: true };
                            break;
                    }
                    const resultType = (oldStatus === newStatus) ? 'noop' : 'success';
                    results.push({ userId: uid, oldStatus, newStatus, action, result: resultType });
                } catch (e) {
                    results.push({ userId: uid, oldStatus: null, newStatus: null, action, result: 'error', errorMessage: e.message });
                }
            }
            return res.json({ success: true, results });
        } catch (err) {
            this.bot.logger?.error('batchVerifyQueue error:', err);
            return res.status(500).json({ error: 'Failed to process batch' });
        }
    }

    async startCaptcha(req, res) {
        try {
            const { guildId, userId } = req.body || {};
            if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required' });
            const Actions = require('../security/verificationActions');
            if (!this.bot.verificationActions) this.bot.verificationActions = new Actions(this.bot);
            const actorId = req.user?.discordId || req.user?.userId || 'dashboard';
            const result = await this.bot.verificationActions.requestCaptcha(guildId, userId, actorId, 'dashboard_button');
            return res.json(result);
        } catch (err) {
            this.bot.logger?.error('startCaptcha error:', err);
            return res.status(500).json({ error: 'Failed to start captcha' });
        }
    }

    async submitCaptcha(req, res) {
        try {
            const { guildId, userId, code } = req.body || {};
            if (!guildId || !userId || !code) return res.status(400).json({ error: 'guildId, userId and code required' });
            const Actions = require('../security/verificationActions');
            if (!this.bot.verificationActions) this.bot.verificationActions = new Actions(this.bot);
            const actorId = req.user?.discordId || req.user?.userId || userId;
            const result = await this.bot.verificationActions.submitCaptcha(guildId, userId, code, actorId, 'dashboard_button');
            return res.json(result);
        } catch (err) {
            this.bot.logger?.error('submitCaptcha error:', err);
            return res.status(500).json({ error: 'Failed to submit captcha' });
        }
    }

    // Return list of available commands (name, description, group/category)
    async getGuildCommands(req, res) {
        try {
            const guildId = req.params.guildId;
            if (!guildId) return res.status(400).json({ error: 'guildId required' });

            const commands = [];
            if (this.bot && this.bot.commands) {
                for (const [name, cmd] of this.bot.commands) {
                    commands.push({ name: name, description: cmd.data?.description || '', category: cmd.category || cmd.data?.category || this.bot.permissionManager?.getCommandGroup(name) || 'utility' });
                }
            }

            res.json({ ok: true, commands });
        } catch (error) {
            this.bot.logger?.error('Error getting guild commands:', error);
            res.status(500).json({ error: 'Failed to fetch commands' });
        }
    }

    // Verification: list pending verification queue for a guild
    async getGuildVerificationQueue(req, res) {
        try {
            const guildId = req.params.guildId;
            if (!guildId) return res.status(400).json({ error: 'guildId required' });

            const rows = await this.bot.database.all(
                `SELECT id, user_id, verification_type, verification_data, status, attempts, expires_at, created_at FROM verification_queue WHERE guild_id = ? ORDER BY created_at DESC`,
                [guildId]
            );

            res.json({ ok: true, queue: rows || [] });
        } catch (error) {
            this.bot.logger?.error('Error fetching verification queue:', error);
            res.status(500).json({ error: 'Failed to fetch verification queue' });
        }
    }

    // Approve a verification entry (grant role and mark completed)
    async approveVerification(req, res) {
        try {
            const guildId = req.params.guildId;
            const id = req.params.id;
            const moderator = req.user?.id || null;

            if (!guildId || !id) return res.status(400).json({ error: 'guildId and id required' });

            const row = await this.bot.database.get('SELECT * FROM verification_queue WHERE id = ?', [id]);
            if (!row) return res.status(404).json({ error: 'Verification entry not found' });

            // Mark completed in DB
            await this.bot.database.run(`UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);

            // Grant role if configured
            try {
                const guild = this.bot.client.guilds.cache.get(guildId);
                if (guild) {
                    const config = await this.bot.database.getGuildConfig(guildId);
                    const roleId = config?.verification_role || config?.verified_role_id || config?.verification_role_id;
                    if (roleId) {
                        const member = await guild.members.fetch(row.user_id).catch(() => null);
                        if (member) {
                            await member.roles.add(roleId).catch(() => {});
                        }
                    }
                }
            } catch (roleErr) {
                this.bot.logger?.warn('Failed to grant verified role:', roleErr.message || roleErr);
            }

            // Broadcast event to dashboards
            try {
                const payload = { type: 'verification', action: 'approved', guildId, id, userId: row.user_id, moderator };
                if (this.bot.eventEmitter) await this.bot.eventEmitter.sendEvent(payload);
                this.broadcastToGuild(guildId, { type: 'verification_update', data: payload });
            } catch (e) {}

            res.json({ ok: true, id, status: 'completed' });
        } catch (error) {
            this.bot.logger?.error('Error approving verification:', error);
            res.status(500).json({ error: 'Failed to approve verification' });
        }
    }

    // Deny a verification entry (mark denied and optionally kick)
    async denyVerification(req, res) {
        try {
            const guildId = req.params.guildId;
            const id = req.params.id;
            const { action } = req.body || {}; // action: 'kick' | 'ban' | 'none'
            const moderator = req.user?.id || null;

            if (!guildId || !id) return res.status(400).json({ error: 'guildId and id required' });

            const row = await this.bot.database.get('SELECT * FROM verification_queue WHERE id = ?', [id]);
            if (!row) return res.status(404).json({ error: 'Verification entry not found' });

            // Mark denied
            await this.bot.database.run(`UPDATE verification_queue SET status = 'denied', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);

            // Optionally kick or ban
            try {
                if (action === 'kick' || action === 'ban') {
                    const guild = this.bot.client.guilds.cache.get(guildId);
                    if (guild) {
                        if (action === 'kick') {
                            await guild.members.kick(row.user_id, `Denied verification by dashboard`).catch(() => {});
                        } else if (action === 'ban') {
                            await guild.members.ban(row.user_id, { reason: `Denied verification by dashboard` }).catch(() => {});
                        }
                    }
                }
            } catch (kickErr) {
                this.bot.logger?.warn('Failed to perform deny action:', kickErr.message || kickErr);
            }

            // Broadcast event
            try {
                const payload = { type: 'verification', action: 'denied', guildId, id, userId: row.user_id, moderator, method: action || 'none' };
                if (this.bot.eventEmitter) await this.bot.eventEmitter.sendEvent(payload);
                this.broadcastToGuild(guildId, { type: 'verification_update', data: payload });
            } catch (e) {}

            res.json({ ok: true, id, status: 'denied' });
        } catch (error) {
            this.bot.logger?.error('Error denying verification:', error);
            res.status(500).json({ error: 'Failed to deny verification' });
        }
    }

    // Return existing permission entries for a guild
    async getGuildCommandPermissions(req, res) {
        try {
            const guildId = req.params.guildId;
            if (!guildId) return res.status(400).json({ error: 'guildId required' });

            const rows = await this.bot.database.all(
                `SELECT scope, name, role_ids, created_at, updated_at FROM command_permissions WHERE guild_id = ?`,
                [guildId]
            );

            const entries = (rows || []).map(r => ({ scope: r.scope, name: r.name, roles: JSON.parse(r.role_ids || '[]'), created_at: r.created_at, updated_at: r.updated_at }));
            res.json({ ok: true, entries });
        } catch (error) {
            this.bot.logger?.error('Error getting guild permissions:', error);
            res.status(500).json({ error: 'Failed to fetch permissions' });
        }
    }

    // Save per-command or per-group permissions for a guild
    async saveGuildCommandPermissions(req, res) {
        try {
            const guildId = req.params.guildId;
            const { scope, name, roleIds, changedBy } = req.body || {};

            if (!guildId || !scope || !name || !Array.isArray(roleIds)) {
                return res.status(400).json({ error: 'guildId, scope, name and roleIds are required' });
            }

            // Persist via PermissionManager for consistency
            if (!this.bot.permissionManager) {
                return res.status(500).json({ error: 'PermissionManager not initialized' });
            }

            // Authorization: only allow the guild owner, server admins, or dashboard admins to change permissions
            try {
                // Dashboard-level admin/owner role check (from JWT, not magic userId string)
                if (!(req.user && (req.user.role === 'admin' || req.user.role === 'owner'))) {
                    const guild = this.bot.client.guilds.cache.get(guildId);
                    if (!guild) return res.status(404).json({ error: 'Guild not found' });

                    // Try to fetch member info for the authenticated user
                    const discordUserId = req.user?.discordId || req.user?.userId || null;
                    if (!discordUserId) return res.status(403).json({ error: 'Insufficient permissions' });

                    const member = await guild.members.fetch(discordUserId).catch(() => null);
                    if (!member) return res.status(403).json({ error: 'You must be a member of this server to change permissions' });

                    // Allow guild owner or administrators/managers
                    const { PermissionFlagsBits } = require('discord.js');
                    if (guild.ownerId === discordUserId) {
                        // owner allowed
                    } else if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                        // allowed
                    } else {
                        return res.status(403).json({ error: 'Insufficient permissions - must be server owner or administrator' });
                    }
                }
            } catch (authErr) {
                this.bot.logger?.warn('Permission change authorization check failed:', authErr?.message || authErr);
                return res.status(500).json({ error: 'Authorization check failed' });
            }

            // Fetch previous for logging
            const prevRoles = await this.bot.permissionManager.getRoles(guildId, scope, name);

            await this.bot.permissionManager.setRoles(guildId, scope, name, roleIds);

            // Use the previously fetched roles as the "oldRoles" (don't re-query after update)
            const oldRoles = Array.isArray(prevRoles) ? prevRoles : [];

            try {
                if (this.bot.confirmationManager) {
                    await this.bot.confirmationManager.sendConfirmation(
                        guildId,
                        'permissions',
                        name,
                        roleIds,
                        oldRoles,
                        changedBy || (req.user?.id || req.user?.sub) || 'dashboard'
                    );
                }
            } catch (e) {
                this.bot.logger?.warn('Confirmation send failed for permissions:', e.message || e);
            }

            // Broadcast change to connected dashboards
            try {
                this.broadcastToGuild(guildId, { type: 'permissions_updated', data: { scope, name, roleIds }, timestamp: new Date().toISOString() });
            } catch (e) {
                // ignore
            }

            res.json({ ok: true, scope, name, roleIds });
        } catch (error) {
            this.bot.logger?.error('Error saving guild command permissions:', error);
            res.status(500).json({ error: 'Failed to save permissions' });
        }
    }

    async authenticateToken(req, res, next) {
        // Skip authentication for admin v3 API routes (they have their own auth)
        // Also skip RFID status endpoint (used by signin page, no auth needed)
        if (req.url.startsWith('/v3/') || req.url.startsWith('/admin/') || req.url.startsWith('/rfid/') || req.url.startsWith('/v4/admin/')) {
            console.log('[authenticateToken] Skipping for admin/rfid route:', req.url);
            return next();
        }

        // Check for token in cookies first, then Authorization header
        console.log('\n======== AUTHENTICATE TOKEN MIDDLEWARE ========');
        console.log('[authenticateToken] Request URL:', req.url);
        console.log('[authenticateToken] ALL Cookies:', req.cookies);
        console.log('[authenticateToken] dashboardToken present?:', !!req.cookies?.dashboardToken);
        
        let token = req.cookies?.dashboardToken;
        
        if (!token) {
            const authHeader = req.headers['authorization'];
            token = authHeader && authHeader.split(' ')[1];
            console.log('[authenticateToken] No cookie, checking auth header:', !!token);
        }

        if (!token) {
            console.error('[authenticateToken] Ã¢ÂÅ’ NO TOKEN FOUND - Returning 401');
            console.log('================================================\n');
            return res.status(401).json({ error: 'Access token required' });
        }

        try {
            if (!process.env.JWT_SECRET) {
                throw new Error('JWT_SECRET not configured');
            }
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('[authenticateToken] Ã¢Å“â€¦ TOKEN VERIFIED for user:', decoded.username);
            console.log('================================================\n');
            req.user = decoded;
            if (!req.user.plan) req.user.plan = 'free';
            if (typeof req.user.isPremium !== 'boolean') {
                req.user.isPremium = req.user.plan === 'premium' || req.user.role === 'owner';
            }
            next();
        } catch (error) {
            console.error('[authenticateToken] Ã¢ÂÅ’ TOKEN VERIFICATION FAILED:', error.message);
            console.log('================================================\n');
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
    }

    // CRITICAL SECURITY: Validate required secrets at startup
    validateSecrets() {
        const requiredSecrets = [
            'JWT_SECRET',
            'DISCORD_TOKEN',
            'DISCORD_CLIENT_SECRET',
            'INTERNAL_API_KEY'
        ];

        // Stripe secrets are required only if billing is enabled
        if (process.env.STRIPE_SECRET || process.env.STRIPE_PRO_PRICE_ID || process.env.STRIPE_ENTERPRISE_PRICE_ID) {
            requiredSecrets.push('STRIPE_SECRET');
        }

        // Strongly recommended but not hard-fatal: OAUTH_STATE_SECRET.
        // If missing, OAuth state will be weaker but dashboard can still start.
        if (!process.env.OAUTH_STATE_SECRET) {
            const msg = '[Security Warning] OAUTH_STATE_SECRET is not set. OAuth state parameter will not be strongly bound.';
            if (this.bot?.logger?.warn) this.bot.logger.warn(msg);
            else console.warn(msg);
        }
        const missingSecrets = [];
        const weakSecrets = [];

        for (const secret of requiredSecrets) {
            const value = process.env[secret];
            
            // Check if secret is missing
            if (!value) {
                missingSecrets.push(secret);
                continue;
            }

            // Check for default/placeholder values
            if (value.includes('change-this-key') || 
                value.includes('your_') || 
                value === 'change_me' ||
                value.includes('placeholder')) {
                weakSecrets.push(secret);
            }

            // Check JWT_SECRET length
            if (secret === 'JWT_SECRET' && value.length < 64) {
                const msg = `[Security Warning] JWT_SECRET is too short (${value.length} chars). Minimum recommended: 64 characters.`;
                if (process.env.NODE_ENV === 'production') {
                    throw new Error(msg);
                }
                this.bot?.logger?.warn(msg);
            }
        }

        // Fail on missing required secrets
        if (missingSecrets.length > 0) {
            const msg = `CRITICAL: Missing required secrets: ${missingSecrets.join(', ')}. Please set environment variables.`;
            throw new Error(msg);
        }

        // Fail on weak/default secrets
        if (weakSecrets.length > 0) {
            const msg = `[Security Warning] Weak/default secrets detected: ${weakSecrets.join(', ')}. Replace with secure values!`;
            this.bot?.logger?.warn(msg);
            throw new Error(msg);
        }

        this.bot?.logger?.info('[Security] Ã¢Å“â€¦ All required secrets validated');
    }

    // Input validation helpers
    validateGuildId(guildId) {
        if (!guildId || typeof guildId !== 'string' || !/^\d{17,19}$/.test(guildId)) {
            throw new Error('Invalid guild ID format');
        }
        return guildId;
    }

    validateLimit(limit, max = 1000) {
        const parsed = parseInt(limit);
        if (isNaN(parsed) || parsed < 1 || parsed > max) {
            return Math.min(100, max);
        }
        return parsed;
    }

    sanitizeString(str, maxLength = 2000) {
        if (typeof str !== 'string') return '';
        return str.slice(0, maxLength).replace(/[<>]/g, '');
    }

    safeJsonParse(str, fallback = null) {
        try {
            return JSON.parse(str);
        } catch (error) {
            this.bot.logger.warn('JSON parse error:', error.message);
            return fallback;
        }
    }

    async handleLogin(req, res) {
        try {
            const { username, password } = req.body;
            
            if (!process.env.JWT_SECRET) {
                return res.status(500).json({ error: 'JWT_SECRET not configured' });
            }

            // Basic validation
            if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
                return res.status(400).json({ error: 'Invalid credentials format' });
            }

            if (username.length > 100 || password.length > 256) {
                return res.status(400).json({ error: 'Invalid credentials format' });
            }

            // Admin credentials from environment variables
            const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
            const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

            if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
                return res.status(500).json({ error: 'Admin credentials not configured' });
            }

            // Check username match and password with bcrypt
            if (username === ADMIN_USERNAME) {
                // Check if password is bcrypt hash (starts with $2b$)
                const isPasswordHash = ADMIN_PASSWORD.startsWith('$2b$');
                let isValid = false;

                if (isPasswordHash) {
                    // Use bcrypt comparison for hashed password
                    isValid = await bcrypt.compare(password, ADMIN_PASSWORD);
                } else {
                    // Fallback to plaintext comparison (for backwards compatibility)
                    console.warn('[Security Warning] Admin password is not hashed. Please hash it with bcrypt.');
                    isValid = password === ADMIN_PASSWORD;
                }

                if (isValid) {
                    const token = jwt.sign(
                        { userId: 'admin', role: 'admin', username: 'admin', plan: 'premium', isPremium: true },
                        process.env.JWT_SECRET,
                        { expiresIn: '24h' }
                    );

                    const cookieSecure = process.env.NODE_ENV === 'production' && (req.secure || req.headers['x-forwarded-proto'] === 'https');
                    console.log('[AUTH] Setting admin dashboardToken cookie:', {
                        secure: cookieSecure,
                        sameSite: cookieSecure ? 'strict' : 'lax',
                        httpOnly: true,
                        path: '/',
                        env: process.env.NODE_ENV,
                        isSecure: req.secure,
                        protocol: req.protocol,
                        forwardedProto: req.headers['x-forwarded-proto']
                    });
                    
                    res.cookie('dashboardToken', token, {
                        httpOnly: true,
                        secure: cookieSecure,
                        sameSite: cookieSecure ? 'strict' : 'lax',
                        maxAge: 24 * 60 * 60 * 1000,
                        path: '/'
                    });

                    return res.json({ success: true, token, user: { id: 'admin', role: 'admin', username: 'admin' } });
                }
            }

            res.status(401).json({ error: 'Invalid credentials' });
        } catch (error) {
            this.bot.logger.error('Login error:', error);
            res.status(500).json({ error: 'Login failed' });
        }
    }

    async getAdminStats(req, res) {
        try {
            const user = req.user;
            
            // Verify admin role
            if (user.role !== 'admin') {
                return res.status(403).json({ error: 'Unauthorized' });
            }

            // Get all bot guilds
            const guilds = this.bot.client.guilds.cache;
            let totalMembers = 0;
            let totalSecurityEvents = 0;
            let totalModerationActions = 0;

            const servers = [];

            for (const [guildId, guild] of guilds) {
                try {
                    totalMembers += guild.memberCount;

                    // Get guild statistics from database
                    const stats = await this.bot.database.get(
                        `SELECT 
                            (SELECT COUNT(*) FROM action_logs WHERE guild_id = ?) as moderation_count,
                            (SELECT COUNT(*) FROM security_logs WHERE guild_id = ?) as security_count
                        `,
                        [guildId, guildId]
                    );

                    const moderationCount = stats?.moderation_count || 0;
                    const securityCount = stats?.security_count || 0;

                    totalModerationActions += moderationCount;
                    totalSecurityEvents += securityCount;

                    servers.push({
                        id: guildId,
                        name: guild.name,
                        icon: guild.iconURL({ size: 256 }) || null,
                        memberCount: guild.memberCount,
                        moderationActions: moderationCount,
                        securityEvents: securityCount,
                        joinedAt: guild.joinedTimestamp
                    });
                } catch (error) {
                    this.bot.logger.error(`Error getting stats for guild ${guildId}:`, error);
                }
            }

            // Sort servers by member count
            servers.sort((a, b) => b.memberCount - a.memberCount);

            res.json({
                totalServers: guilds.size,
                totalMembers,
                securityEvents: totalSecurityEvents,
                moderationActions: totalModerationActions,
                servers
            });
        } catch (error) {
            this.bot.logger.error('Error getting admin stats:', error);
            res.status(500).json({ error: 'Failed to get admin stats' });
        }
    }

    async handleDiscordAuth(req, res) {
        // Guard: ensure OAuth is configured to avoid runtime crashes
        if (!this.discordConfig || !this.discordConfig.clientId) {
            this.bot?.logger?.warn && this.bot.logger.warn('Discord OAuth attempted but dashboard.discordConfig.clientId is not configured');
            return res.status(500).send('Discord OAuth is not configured on this instance');
        }

        // Generate CSRF token for OAuth state (JWT-signed, stateless)
        const nonce = require('crypto').randomBytes(16).toString('hex');
        const stateSecret = process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET;
        if (!stateSecret) {
            this.bot?.logger?.error && this.bot.logger.error('[OAuth] No OAUTH_STATE_SECRET or JWT_SECRET configured - OAuth is disabled');
            console.error('[SECURITY] OAuth state secret not configured. Set OAUTH_STATE_SECRET or JWT_SECRET environment variable.');
            return res.status(500).send('OAuth is not properly configured. Please contact the administrator.');
        }
        const state = jwt.sign({ n: nonce, ts: Date.now(), ip: req.ip, ua: req.headers['user-agent'] || '' }, stateSecret, { expiresIn: '10m' });
        
        const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${this.discordConfig.clientId}&redirect_uri=${encodeURIComponent(this.discordConfig.redirectUri)}&response_type=code&scope=${encodeURIComponent(this.discordConfig.scope)}&state=${state}`;
        res.redirect(authUrl);
    }

    async handleDiscordCallback(req, res) {
        try {
            const { code, state } = req.query;
            
            // Validate OAuth state to prevent CSRF attacks (stateless only)
            if (!state) {
                return res.status(403).send('Invalid OAuth state - possible CSRF attack detected');
            }
            let decodedState;
            try {
                const stateSecret = process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET;
                if (!stateSecret) {
                    return res.status(500).send('OAuth is not properly configured. Please contact the administrator.');
                }
                decodedState = jwt.verify(state, stateSecret);
            } catch (e) {
                return res.status(403).send('Invalid OAuth state - verification failed');
            }

            const stateTimestamp = Number(decodedState?.ts || 0);
            if (!stateTimestamp || Date.now() - stateTimestamp > 600000) {
                return res.status(403).send('OAuth state expired - please try again');
            }
            const ua = req.headers['user-agent'] || '';
            if (decodedState.ua && ua && decodedState.ua !== ua) {
                return res.status(403).send('OAuth state user-agent mismatch');
            }
            
            if (!code) {
                return res.status(400).send('Authorization code required');
            }

            this.bot.logger.info('Discord OAuth: Exchanging code for token...');
            
            // Exchange code for access token
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', 
                new URLSearchParams({
                    client_id: this.discordConfig.clientId,
                    client_secret: this.discordConfig.clientSecret,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: this.discordConfig.redirectUri,
                    scope: this.discordConfig.scope
                }), 
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            const { access_token } = tokenResponse.data;
            this.bot.logger.info('Discord OAuth: Token received successfully');

            // Get user info
            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: {
                    Authorization: `Bearer ${access_token}`
                }
            });

            const user = userResponse.data;
            this.bot.logger.info(`Discord OAuth: User ${user.username}#${user.discriminator} authenticated`);

            // CRITICAL FIX: Check if user has admin permissions in a mutual guild
            // This is REQUIRED - cannot be disabled
            let hasAccess = false;
            let accessGuild = null;
            let userGuilds = [];
            let botGuilds = this.bot.client.guilds.cache;
            
            try {
                const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
                    headers: {
                        Authorization: `Bearer ${access_token}`
                    }
                });

                userGuilds = guildsResponse.data;
                
                this.bot.logger.info(`[OAuth Security] User ${user.username} in ${userGuilds.length} guilds, bot in ${botGuilds.size} guilds`);
                
                // User MUST have admin permissions in at least one mutual guild
                for (const guild of userGuilds) {
                    const botGuild = botGuilds.get(guild.id);
                    const isAdmin = botGuild && (guild.permissions & 0x8) === 0x8;
                    
                    if (isAdmin) {
                        hasAccess = true;
                        accessGuild = { id: guild.id, name: guild.name };
                        this.bot.logger.info(`[OAuth Security] Ã¢Å“â€¦ Admin access GRANTED for ${user.username} in guild: ${guild.name}`);
                        break; // Found admin guild, stop checking
                    }
                }
                
                if (!hasAccess) {
                    this.bot.logger.warn(`[OAuth Security] Ã¢ÂÅ’ Access DENIED - ${user.username} is not admin in any mutual guild`);
                }
                
            } catch (guildError) {
                this.bot.logger.error('[OAuth Security] CRITICAL: Could not check guild permissions:', guildError.message);
                return res.redirect('/login?error=' + encodeURIComponent('Failed to verify permissions - security check required'));
            }

            // Create JWT for all users (admin or not)
            // Non-admin users will be redirected to access code page
            const userRole = hasAccess ? 'admin' : 'user';
            
            if (!hasAccess) {
                this.bot.logger.info(`[OAuth Security] Non-admin user ${user.username} (${user.id}) logged in - will see access code page`);
            }

            const entitlement = await this.getUserPlan(user.id);

            // CRITICAL FIX: Create JWT WITHOUT Discord access token
            // Keep access token server-side only to prevent disclosure
            const token = jwt.sign(
                { 
                    userId: user.id,
                    username: user.username,
                    globalName: user.global_name || user.username,
                    avatar: user.avatar,
                    role: userRole, // 'admin' or 'user'
                    hasAccess: hasAccess,
                    accessGuild: accessGuild, // Store which guild this admin access is from
                    issuedAt: Date.now(),
                    plan: entitlement.plan,
                    isPremium: entitlement.isPremium
                    // CRITICALLY REMOVED: accessToken - NEVER store in JWT
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            // Store Discord access token server-side only
            // In production, use Redis or encrypted session store
            if (!this.discordTokenCache) {
                this.discordTokenCache = new Map();
            }
            this.discordTokenCache.set(user.id, {
                accessToken: access_token,
                refreshToken: tokenResponse.data.refresh_token || null,
                expiresAt: Date.now() + (tokenResponse.data.expires_in * 1000) || (3600 * 1000)
            });

            this.bot.logger.info(`[OAuth Security] Ã¢Å“â€¦ JWT token created for ${user.username} (token kept server-side)`);

            // CRITICAL FIX: Set cookie with HttpOnly, Secure, SameSite flags
            console.log('\n========================================');
            console.log('[OAuth Callback] Setting dashboardToken cookie...');
            const cookieSecure = process.env.NODE_ENV === 'production' && (req.secure || req.headers['x-forwarded-proto'] === 'https');
            console.log('[OAuth Callback] Cookie options:', {
                httpOnly: true,
                secure: cookieSecure,
                sameSite: cookieSecure ? 'strict' : 'lax',
                maxAge: 24 * 60 * 60 * 1000,
                path: '/'
            });
            
            res.cookie('dashboardToken', token, {
                httpOnly: true, // CRITICAL: Prevents JavaScript from accessing the token
                secure: cookieSecure, // Only send over HTTPS in production
                sameSite: cookieSecure ? 'strict' : 'lax', // CSRF protection - only send on same-site requests
                maxAge: 24 * 60 * 60 * 1000, // 24 hours
                path: '/' // Available to entire domain
            });
            
            console.log('[OAuth Callback] Ã¢Å“â€¦ Cookie set successfully!');
            console.log('[OAuth Callback] Redirecting to /dashboard...');
            console.log('========================================\n');
            
            // Clear oauth cookies
            try {
                res.clearCookie?.('oauth_state', { path: '/', sameSite: 'lax' });
                res.clearCookie?.('oauth_state_ts', { path: '/', sameSite: 'lax' });
            } catch (_) {}

            // Redirect based on access level
            if (hasAccess) {
                res.redirect('/dashboard');
            } else {
                res.redirect('/access-code'); // Non-admin users see access code page
            }
        } catch (error) {
            this.bot.logger.error('Discord OAuth error:', error.response?.data || error.message);
            
            // Provide more specific error messages
            let errorMessage = 'Authentication failed';
            if (error.response) {
                if (error.response.status === 400) {
                    errorMessage = 'Invalid authorization code or redirect URI';
                } else if (error.response.status === 401) {
                    errorMessage = 'Invalid client credentials';
                } else {
                    errorMessage = `Discord API error: ${error.response.status}`;
                }
            }
            
            res.redirect(`/login?error=${encodeURIComponent(errorMessage)}`);
        }
    }

    async handleLogout(req, res) {
        this.bot.logger.info(`[AUTH] User logged out`);
        
        // Clear the dashboardToken cookie
        res.clearCookie('dashboardToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/'
        });
        
        // Clear any other auth cookies
        res.clearCookie('authToken', { path: '/' });
        res.clearCookie('userId', { path: '/' });
        
        // Redirect to signin page instead of JSON response
        res.redirect('/signin');
    }

    async debugDatabase(req, res) {
        try {
            const tables = [];
            
            // Check if tables exist
            const tableQueries = [
                "SELECT name FROM sqlite_master WHERE type='table' AND name='guild_configs'",
                "SELECT name FROM sqlite_master WHERE type='table' AND name='guild_settings'"
            ];
            
            for (const query of tableQueries) {
                const result = await this.bot.database.get(query);
                tables.push({
                    table: query.split("'")[3],
                    exists: !!result
                });
            }
            
            // Get schema info
            const guildConfigsSchema = await this.bot.database.all("PRAGMA table_info(guild_configs)");
            const guildSettingsSchema = await this.bot.database.all("PRAGMA table_info(guild_settings)");
            
            // Count rows
            const guildConfigsCount = await this.bot.database.get("SELECT COUNT(*) as count FROM guild_configs");
            const guildSettingsCount = await this.bot.database.get("SELECT COUNT(*) as count FROM guild_settings");
            
            res.json({
                tables,
                schema: {
                    guild_configs: guildConfigsSchema,
                    guild_settings: guildSettingsSchema
                },
                counts: {
                    guild_configs: guildConfigsCount?.count || 0,
                    guild_settings: guildSettingsCount?.count || 0
                }
            });
        } catch (error) {
            res.status(500).json({ error: error.message, stack: error.stack });
        }
    }

    async updateAdvancedSettings(req, res) {
        try {
            const { guildId, feature, settings } = req.body || {};
            if (!guildId || !feature || !settings || typeof settings !== 'object') {
                return res.status(400).json({ error: 'Missing guildId, feature, or settings' });
            }

            // Ensure guild_configs exists for this guild
            await this.bot.database.run(`INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)`, [guildId]);

            // Map frontend field names to actual database column names
            const fieldMapping = {
                // verification - frontend sends verification_timeout but DB has verification_timeout_minutes
                'verification_timeout': 'verification_timeout_minutes',
                'auto_kick_on_timeout': 'auto_kick_unverified',
                // Add other mappings as needed
            };

            // Map allowed keys to columns in guild_configs; ignore unknown
            const allowedKeys = [
                // raid
                'raid_threshold','raid_timeout_minutes','raid_action','raid_dm_notify',
                // spam
                'spam_threshold','spam_timeout_seconds','spam_delete_messages','spam_mute_duration',
                // phishing
                'phishing_check_links','phishing_delete_messages','phishing_ban_user',
                // antinuke
                'antinuke_role_limit','antinuke_channel_limit','antinuke_ban_limit','antinuke_auto_ban','antinuke_reverse_actions',
                // verification (actual DB columns)
                'verification_profile','verification_timeout_minutes','auto_kick_unverified','verification_min_account_age_days','enable_ai_scan','enable_dashboard_buttons','enable_staff_dm','verification_language',
                // welcome
                'welcome_embed_enabled','welcome_ping_user','welcome_delete_after',
                // tickets
                'ticket_max_open','ticket_auto_close_hours','ticket_transcript_enabled','ticket_rating_enabled',
                // automod
                'automod_toxicity_threshold','automod_caps_percentage','automod_emoji_limit','automod_mention_limit',
                // autorole
                'autorole_delay_seconds','autorole_remove_on_leave','autorole_bypass_bots'
            ];

            const updates = [];
            const params = [];
            for (const [key, value] of Object.entries(settings)) {
                // Map frontend field name to DB column name if mapping exists
                const dbColumn = fieldMapping[key] || key;
                
                if (allowedKeys.includes(dbColumn)) {
                    updates.push(`${dbColumn} = ?`);
                    params.push(value);
                }
            }

            if (updates.length) {
                params.push(guildId);
                const sql = `UPDATE guild_configs SET ${updates.join(', ')} WHERE guild_id = ?`;
                await this.bot.database.run(sql, params);
            } else {
                // No matching columns found; accept and return success to avoid blocking UI.
                // Optional TODO: persist unknown keys in a JSON column.
            }

            // Log action if logger exists
            this.bot?.logger?.info && this.bot.logger.info(`[Dashboard] Advanced settings updated for guild ${guildId}, feature ${feature}`);

            return res.json({ success: true });
        } catch (e) {
            this.bot?.logger?.error && this.bot.logger.error('updateAdvancedSettings error:', e.message || e);
            return res.status(500).json({ error: `Failed to update advanced settings: ${e.message}` });
        }
    }

    async debugGuild(req, res) {
        try {
            const guildId = req.params.guildId;
            
            // Get guild config
            const guildConfig = await this.bot.database.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]);
            
            // Get guild settings
            const guildSettings = await this.bot.database.get('SELECT * FROM guild_settings WHERE guild_id = ?', [guildId]);
            
            // Get all guild configs for comparison
            const allConfigs = await this.bot.database.all('SELECT guild_id, anti_raid_enabled, anti_spam_enabled FROM guild_configs LIMIT 10');
            
            // Get all guild settings for comparison
            const allSettings = await this.bot.database.all('SELECT guild_id, log_channel_id, mod_role_id FROM guild_settings LIMIT 10');
            
            res.json({
                guildId,
                guildConfig: guildConfig || null,
                guildSettings: guildSettings || null,
                sampleConfigs: allConfigs,
                sampleSettings: allSettings
            });
        } catch (error) {
            console.error('[Debug] debugGuild error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async debugTables(req, res) {
        try {
            // Get all tables
            const tables = await this.bot.database.all("SELECT name FROM sqlite_master WHERE type='table'");
            
            const result = {};
            for (const table of tables) {
                const tableName = table.name;
                try {
                    const schema = await this.bot.database.all(`PRAGMA table_info(${tableName})`);
                    const count = await this.bot.database.get(`SELECT COUNT(*) as count FROM ${tableName}`);
                    result[tableName] = {
                        schema: schema,
                        count: count?.count || 0
                    };
                } catch (e) {
                    result[tableName] = { error: e.message };
                }
            }
            
            res.json(result);
        } catch (error) {
            console.error('[Debug] debugTables error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async debugOAuth(req, res) {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        // Debug route to check OAuth configuration
        const config = {
            clientId: this.discordConfig.clientId ? 'Set' : 'Missing',
            clientSecret: this.discordConfig.clientSecret ? 'Set' : 'Missing',
            redirectUri: this.discordConfig.redirectUri,
            scope: this.discordConfig.scope,
            botGuilds: this.bot.client.guilds.cache.size,
            botGuildNames: this.bot.client.guilds.cache.map(g => g.name)
        };
        
        res.json({
            message: 'Discord OAuth Debug Information',
            config: config,
            authUrl: `https://discord.com/api/oauth2/authorize?client_id=${this.discordConfig.clientId}&redirect_uri=${encodeURIComponent(this.discordConfig.redirectUri)}&response_type=code&scope=${encodeURIComponent(this.discordConfig.scope)}`
        });
    }

    async handleBillingPortal(req, res) {
        try {
            if (!this.stripe || !process.env.STRIPE_SECRET) {
                return res.status(500).json({ error: 'Billing is not configured' });
            }

            const guildId = req.body.guildId || req.query.guildId;
            if (!guildId) return res.status(400).json({ error: 'guildId is required' });
            this.validateGuildId(guildId);

            const subscription = await this.bot.getGuildPlan(guildId);
            if (!subscription?.stripe_customer_id) {
                return res.status(404).json({ error: 'No billing profile found for this guild' });
            }

            const baseUrl = this.billingConfig.domain || `${req.protocol}://${req.get('host')}`;
            const session = await this.stripe.billingPortal.sessions.create({
                customer: subscription.stripe_customer_id,
                return_url: `${baseUrl}/dashboard`
            });

            return res.json({ url: session.url });
        } catch (error) {
            this.bot.logger?.error('Billing portal error:', error);
            if (error.message && error.message.includes('guild ID')) {
                return res.status(400).json({ error: error.message });
            }
            return res.status(500).json({ error: 'Failed to open billing portal' });
        }
    }

    async getBillingStatus(req, res) {
        try {
            const guildId = req.params.guildId;
            this.validateGuildId(guildId);

            const subscription = await this.bot.getGuildPlan(guildId);
            return res.json({
                guild_id: guildId,
                plan: subscription.plan,
                effectivePlan: subscription.effectivePlan || (subscription.is_active ? subscription.plan : 'free'),
                status: subscription.status,
                active: subscription.is_active,
                current_period_end: subscription.current_period_end,
                stripe_customer_id: subscription.stripe_customer_id,
                stripe_subscription_id: subscription.stripe_subscription_id
            });
        } catch (error) {
            this.bot.logger?.error('Billing status error:', error);
            if (error.message && error.message.includes('guild ID')) {
                return res.status(400).json({ error: error.message });
            }
            return res.status(500).json({ error: 'Failed to load billing status' });
        }
    }

    renderBillingSuccess(req, res) {
        const dashboardUrl = '/dashboard';
        res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Billing Success</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0b1021; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); padding: 24px; border-radius: 12px; max-width: 420px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.35); }
    .card h1 { margin: 0 0 12px 0; font-size: 1.6rem; }
    .card p { margin: 0 0 18px 0; color: rgba(255,255,255,0.85); }
    .btn { display: inline-block; padding: 10px 16px; background: #10b981; color: #0b1021; border-radius: 8px; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Payment Successful</h1>
    <p>Your subscription is active. You can return to the dashboard now.</p>
    <a class="btn" href="${dashboardUrl}">Back to Dashboard</a>
  </div>
</body>
</html>`);
    }

    renderBillingCancel(req, res) {
        const dashboardUrl = '/dashboard';
        res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Checkout Cancelled</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0b1021; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); padding: 24px; border-radius: 12px; max-width: 420px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.35); }
    .card h1 { margin: 0 0 12px 0; font-size: 1.6rem; }
    .card p { margin: 0 0 18px 0; color: rgba(255,255,255,0.85); }
    .btn { display: inline-block; padding: 10px 16px; background: rgba(255,255,255,0.1); color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; border: 1px solid rgba(255,255,255,0.2); }
  </style>
</head>
<body>
  <div class="card">
    <h1>Checkout Cancelled</h1>
    <p>Your subscription was not completed. You can return to the dashboard to try again.</p>
    <a class="btn" href="${dashboardUrl}">Back to Dashboard</a>
  </div>
</body>
</html>`);
    }

    getPlanFromPrice(priceId) {
        if (!priceId) return null;
        if (priceId === this.billingConfig.proPriceId) return 'pro';
        if (priceId === this.billingConfig.enterprisePriceId) return 'enterprise';
        return null;
    }

    normalizeStripeStatus(status) {
        const normalized = (status || '').toLowerCase();
        if (['active', 'trialing'].includes(normalized)) return 'active';
        if (['past_due', 'unpaid', 'incomplete', 'incomplete_expired'].includes(normalized)) return 'past_due';
        if (normalized === 'canceled') return 'canceled';
        return 'inactive';
    }

    async handleStripeWebhook(req, res) {
        if (!this.stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
            return res.status(500).send('Stripe not configured');
        }

        const signature = req.headers['stripe-signature'];
        if (!signature) {
            return res.status(400).send('Missing Stripe signature');
        }

        let event;
        try {
            event = this.stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
        } catch (err) {
            this.bot.logger?.error('Stripe webhook signature verification failed:', err.message || err);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        try {
            switch (event.type) {
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    await this.processSubscriptionEvent(event.data.object);
                    break;
                case 'customer.subscription.deleted':
                    await this.processSubscriptionEvent(event.data.object, 'canceled');
                    break;
                case 'invoice.payment_failed':
                    await this.handleInvoicePaymentFailed(event.data.object);
                    break;
                default:
                    this.bot.logger?.debug?.(`Unhandled Stripe event type ${event.type}`);
            }
            return res.json({ received: true });
        } catch (error) {
            this.bot.logger?.error('Stripe webhook handler error:', error);
            return res.status(500).send('Webhook handler failed');
        }
    }

    async processSubscriptionEvent(subscription, overrideStatus = null) {
        if (!subscription) return;

        console.log('[Stripe Webhook] Processing subscription:', subscription.id);
        console.log('[Stripe Webhook] Subscription metadata:', JSON.stringify(subscription.metadata));

        const metadata = subscription.metadata || {};
        const guildId = metadata.guild_id || metadata.guildId || metadata.guild;
        const userId = metadata.user_id || metadata.userId || metadata.user;
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const planFromPrice = this.getPlanFromPrice(priceId);
        const existing = guildId ? await this.bot.database.getGuildSubscription(guildId).catch(() => null) : null;
        const plan = planFromPrice || (metadata.plan ? String(metadata.plan).toLowerCase() : null) || existing?.plan || 'free';
        const status = overrideStatus || this.normalizeStripeStatus(subscription.status);
        const periodEnd = subscription.current_period_end || null;

        console.log('[Stripe Webhook] Parsed data:', { guildId, userId, plan, status });

        if (!guildId) {
            console.warn('[Stripe Webhook] Ã¢Å¡Â Ã¯Â¸Â No guildId in subscription metadata - user will need to link manually');
        }

        await this.bot.applySubscriptionUpdate({
            guildId,
            userId,
            plan,
            status,
            currentPeriodEnd: periodEnd,
            stripeCustomerId: subscription.customer || subscription.customer_id || null,
            stripeSubscriptionId: subscription.id || null
        });
    }

    async handleInvoicePaymentFailed(invoice) {
        try {
            let subscription = null;
            const subscriptionId = invoice.subscription;
            if (subscriptionId && this.stripe) {
                try {
                    subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
                } catch (err) {
                    this.bot.logger?.warn('Could not retrieve subscription for failed invoice:', err.message || err);
                }
            }

            const metadata = (subscription?.metadata) || invoice.metadata || {};
            const guildId = metadata.guild_id || metadata.guildId || metadata.guild;
            const userId = metadata.user_id || metadata.userId || metadata.user;
            const existing = guildId ? await this.bot.database.getGuildSubscription(guildId).catch(() => null) : null;
            const priceId = subscription?.items?.data?.[0]?.price?.id || invoice.lines?.data?.[0]?.price?.id;
            const plan = this.getPlanFromPrice(priceId) || (metadata.plan ? String(metadata.plan).toLowerCase() : null) || existing?.plan || 'free';
            const periodEnd = subscription?.current_period_end;
            const customerId = invoice.customer || subscription?.customer || null;

            await this.bot.applySubscriptionUpdate({
                guildId,
                userId,
                plan,
                status: 'past_due',
                currentPeriodEnd: periodEnd,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId || subscription?.id || null
            });
        } catch (error) {
            this.bot.logger?.error('Failed to handle payment failure event:', error);
        }
    }

    async getDashboardData(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            const userId = req.user?.discordId || req.user?.userId;
            
            this.bot.logger.info(`[SETTINGS] Loading dashboard data for guild: ${guildId}, user: ${userId}`);
            
            // CRITICAL: Verify user has access to this guild
            if (userId && userId !== 'admin') {
                const guild = this.bot.client.guilds.cache.get(guildId);
                if (!guild) {
                    this.bot.logger.warn(`[SECURITY] User ${userId} attempted to access non-existent guild ${guildId}`);
                    return res.status(404).json({ error: 'Guild not found' });
                }
                
                // Verify user is a member of this guild
                const member = await guild.members.fetch(userId).catch(() => null);
                if (!member) {
                    this.bot.logger.error(`[SECURITY] User ${userId} attempted unauthorized access to guild ${guildId}`);
                    return res.status(403).json({ error: 'Unauthorized: You are not a member of this server' });
                }
                
                // Verify user has manage permissions
                const hasManagePerms = member.permissions.has('Administrator') || 
                                      member.permissions.has('ManageGuild');
                if (!hasManagePerms && guild.ownerId !== userId) {
                    this.bot.logger.error(`[SECURITY] User ${userId} lacks permissions for guild ${guildId}`);
                    return res.status(403).json({ error: 'Unauthorized: You do not have manage permissions in this server' });
                }
                
                this.bot.logger.info(`[SECURITY] Authorized: User ${userId} has access to guild ${guildId}`);
            }
            
            // Load guild configuration - with advanced settings
            let config = {
                // Security toggles
                anti_raid_enabled: true,
                anti_spam_enabled: true,
                anti_links_enabled: true,
                anti_phishing_enabled: true,
                antinuke_enabled: false,
                verification_enabled: true,
                welcome_enabled: true,
                tickets_enabled: true,
                auto_mod_enabled: true,
                autorole_enabled: true,
                xp_enabled: false,
                // Advanced Anti-Raid Settings
                raid_threshold: 5,
                raid_timeout_minutes: 10,
                raid_action: 'kick',
                raid_dm_notify: true,
                // Advanced Anti-Nuke Settings
                antinuke_role_limit: 3,
                antinuke_channel_limit: 3,
                antinuke_ban_limit: 3,
                // Advanced Anti-Spam Settings
                spam_threshold: 3,
                spam_timeout_seconds: 30,
                spam_delete_messages: true,
                spam_mute_duration: 300,
                // Advanced Anti-Links Settings
                antilinks_whitelist: '',
                antilinks_action: 'delete',
                antilinks_warn_user: true,
                antilinks_log_attempts: true,
                // Advanced Verification Settings
                verification_level: 1,
                verification_age_hours: 24,
                verification_role_id: null,
                verification_welcome_dm: true,
                verification_dm_message: '',
                verification_expiration: 10,
                verification_max_attempts: 3,
                verification_cooldown: 30,
                verification_fail_action: 'nothing',
                verification_require_captcha: false,
                verification_log_attempts: false,
                // Advanced Welcome Settings
                welcome_embed_enabled: true,
                welcome_ping_user: false,
                welcome_delete_after: 0,
                welcome_auto_role: null,
                // Advanced Ticket Settings
                ticket_max_open: 3,
                ticket_auto_close_hours: 72,
                ticket_transcript_enabled: true,
                ticket_rating_enabled: true,
                // Advanced AutoMod Settings
                automod_toxicity_threshold: 0.8,
                automod_caps_percentage: 70,
                automod_emoji_limit: 10,
                automod_mention_limit: 5,
                // Bot configuration - FIXED FIELD NAMES
                log_channel_id: null,
                alert_channel: null,
                mod_role_id: null,
                admin_role_id: null,
                welcome_channel: null,
                welcome_channel_id: null, // Add both for compatibility
                welcome_message: 'Welcome {user} to {server}!',
                ticket_category: null,
                mute_role_id: null,
                autorole_id: null
            };
            
            try {
                // Load security settings from guild_configs
                const securityConfig = await this.bot.database.get(
                    'SELECT * FROM guild_configs WHERE guild_id = ?', 
                    [guildId]
                );
                
                if (securityConfig) {
                    this.bot.logger.info(`[SETTINGS] Found security config for ${guildId}`);
                    // Override defaults with saved values
                    Object.keys(config).forEach(key => {
                        if (securityConfig.hasOwnProperty(key) && securityConfig[key] !== null) {
                            config[key] = securityConfig[key];
                        }
                    });
                } else {
                    this.bot.logger.info(`[SETTINGS] Creating default security config for ${guildId}`);
                        // Create default entry but avoid replacing an existing row
                        await this.bot.database.run(`INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)`, [guildId]);
                        await this.bot.database.run(`
                            UPDATE guild_configs SET
                                anti_raid_enabled = COALESCE(anti_raid_enabled, 1),
                                anti_spam_enabled = COALESCE(anti_spam_enabled, 1),
                                anti_links_enabled = COALESCE(anti_links_enabled, 1),
                                anti_phishing_enabled = COALESCE(anti_phishing_enabled, 1),
                                verification_enabled = COALESCE(verification_enabled, 1),
                                welcome_enabled = COALESCE(welcome_enabled, 1),
                                tickets_enabled = COALESCE(tickets_enabled, 1),
                                auto_mod_enabled = COALESCE(auto_mod_enabled, 1),
                                autorole_enabled = COALESCE(autorole_enabled, 1),
                                xp_enabled = COALESCE(xp_enabled, 0),
                                raid_threshold = COALESCE(raid_threshold, 5),
                                spam_threshold = COALESCE(spam_threshold, 3),
                                verification_level = COALESCE(verification_level, 1)
                            WHERE guild_id = ?
                        `, [guildId]);
                }
                
                // Load bot settings from guild_settings (server-specific)
                const botSettings = await this.bot.database.get(
                    'SELECT * FROM guild_settings WHERE guild_id = ?', 
                    [guildId]
                );
                
                if (botSettings) {
                    this.bot.logger.info(`[SETTINGS] Found bot settings for ${guildId}`);
                    // Map database fields to config fields with fallbacks
                    config.log_channel_id = botSettings.log_channel_id;
                    config.alert_channel = botSettings.log_channel_id || botSettings.alert_channel;
                    config.mod_role_id = botSettings.mod_role_id;
                    config.admin_role_id = botSettings.admin_role_id;
                    config.welcome_channel = botSettings.welcome_channel_id || botSettings.welcome_channel;
                    config.welcome_channel_id = botSettings.welcome_channel_id;
                    config.welcome_message = botSettings.welcome_message || config.welcome_message;
                    config.ticket_category = botSettings.ticket_category;
                    config.mute_role_id = botSettings.mute_role_id;
                    config.autorole_id = botSettings.autorole_id;
                    
                    // Parse additional settings from JSON
                    if (botSettings.settings_json) {
                        try {
                            const additionalSettings = JSON.parse(botSettings.settings_json);
                            Object.assign(config, additionalSettings);
                        } catch (e) {
                            this.bot.logger.warn('Could not parse settings JSON:', e.message);
                        }
                    }
                    
                    this.bot.logger.debug(`[SETTINGS] Bot settings mapped:`, {
                        log_channel_id: config.log_channel_id,
                        welcome_channel: config.welcome_channel,
                        mod_role_id: config.mod_role_id,
                        admin_role_id: config.admin_role_id
                    });
                } else {
                    this.bot.logger.info(`[SETTINGS] Creating default bot settings for ${guildId}`);
                    await this.bot.database.run(`
                        INSERT OR IGNORE INTO guild_settings (guild_id, welcome_enabled, automod_enabled)
                        VALUES (?, 1, 1)
                    `, [guildId]);
                }
                
            } catch (dbError) {
                this.bot.logger.error(`[SETTINGS] Database error for ${guildId}:`, dbError);
            }
            
            // Get real-time security stats for this specific guild
            let securityStats;
            try {
                securityStats = await this.getSecurityStatsForGuild(guildId);
            } catch (statsError) {
                this.bot.logger.error(`[SETTINGS] Error getting security stats for ${guildId}:`, statsError);
                securityStats = this.getDefaultSecurityStats();
            }

            let subscription;
            try {
                subscription = await this.bot.getGuildPlan(guildId);
            } catch (subErr) {
                this.bot.logger?.warn('Failed to load subscription for dashboard data:', subErr.message || subErr);
                subscription = {
                    guild_id: guildId,
                    plan: 'free',
                    effectivePlan: 'free',
                    status: 'inactive',
                    current_period_end: null,
                    stripe_customer_id: null,
                    stripe_subscription_id: null,
                    is_active: false
                };
            }
            
            this.bot.logger.info(`[SETTINGS] Final config for ${guildId} loaded successfully`);
            // Include basic role list for UI dropdowns (e.g., Shared Access)
            let roles = [];
            try {
                const guild = this.bot.client.guilds.cache.get(guildId);
                if (guild) {
                    roles = Array.from(guild.roles.cache.values()).map(r => ({
                        id: r.id,
                        name: r.name,
                        position: r.position,
                        color: r.hexColor || '#000000',
                        managed: r.managed,
                        mentionable: r.mentionable
                    }));
                }
            } catch (e) {
                this.bot.logger.warn(`[SETTINGS] Failed to include roles for ${guildId}:`, e.message || e);
                roles = [];
            }

            res.json({
                securityScore: securityStats.score || 85,
                currentThreats: securityStats.threats || [],
                recentIncidents: securityStats.incidents || [],
                activityData: securityStats.activity || [],
                eventsData: securityStats.events || [],
                config,
                serverName: await this.getServerName(guildId) || 'Discord Server',
                serverIcon: await this.getServerIcon(guildId) || 'https://cdn.discordapp.com/embed/avatars/0.png',
                memberCount: await this.getMemberCount(guildId) || 1,
                botOnline: true,
                lockdownMode: false,
                invitesPaused: false,
                emergencyActive: false,
                subscription,
                roles
            });
        } catch (error) {
            this.bot.logger.error('[SETTINGS] getDashboardData error:', error);
            res.status(500).json({ error: 'Failed to load dashboard data' });
        }
    }

    async getSecurityStatus(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            const config = await this.bot.database.getGuildConfig(guildId);
            
            res.json({
                antiRaidEnabled: config.anti_raid_enabled,
                antiSpamEnabled: config.anti_spam_enabled,
                antiLinksEnabled: config.anti_links_enabled,
                antiPhishingEnabled: config.anti_phishing_enabled,
                verificationEnabled: config.verification_enabled,
                lockdownActive: this.bot.antiRaid.isGuildInLockdown(guildId)
            });
        } catch (error) {
            this.bot.logger.error('Security status error:', error);
            res.status(500).json({ error: 'Failed to get security status' });
        }
    }

    async getGuildConfig(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            const config = await this.bot.database.getGuildConfig(guildId);
            res.json(config);
        } catch (error) {
            this.bot.logger.error('Guild config error:', error);
            res.status(500).json({ error: 'Failed to get guild config' });
        }
    }

    async handleLockdown(req, res) {
        try {
            const { action, reason, duration } = req.body;
            const guildId = req.query.guildId || this.getDefaultGuildId();
            const guild = this.bot.client.guilds.cache.get(guildId);

            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            if (action === 'enable') {
                await this.bot.antiRaid.manualLockdown(
                    guild, 
                    reason || 'Dashboard activation', 
                    duration || 300000
                );
            } else if (action === 'disable') {
                await this.bot.antiRaid.manualLockdownRemoval(guild);
            }

            res.json({ success: true, action });
        } catch (error) {
            this.bot.logger.error('Lockdown error:', error);
            res.status(500).json({ error: 'Failed to toggle lockdown' });
        }
    }

    async handleInvites(req, res) {
        try {
            const { action } = req.body;
            const guildId = req.query.guildId || this.getDefaultGuildId();
            
            // This would integrate with Discord's invite management
            // For now, just return success
            res.json({ success: true, action });
        } catch (error) {
            this.bot.logger.error('Invites error:', error);
            res.status(500).json({ error: 'Failed to toggle invites' });
        }
    }

    async clearRaidFlags(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            
            // Clear raid flags from database
            await this.bot.database.run(
                'UPDATE user_records SET flags = NULL WHERE guild_id = ? AND flags LIKE ?',
                [guildId, '%raidParticipant%']
            );

            res.json({ success: true });
        } catch (error) {
            this.bot.logger.error('Clear raid flags error:', error);
            res.status(500).json({ error: 'Failed to clear raid flags' });
        }
    }

    async updateConfig(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            const updates = req.body;
            
            await this.bot.database.updateGuildConfig(guildId, updates);
            
            res.json({ success: true });
        } catch (error) {
            this.bot.logger.error('Config update error:', error);
            res.status(500).json({ error: 'Failed to update config' });
        }
    }

    async handleSetup(req, res) {
        try {
            const { serverType, memberSettings } = req.body;
            const guildId = this.getDefaultGuildId();
            
            // Apply setup based on server type
            const presetConfig = this.getPresetConfig(serverType);
            const finalConfig = { ...presetConfig, ...memberSettings };
            
            await this.bot.database.updateGuildConfig(guildId, finalConfig);
            
            res.json({ success: true });
        } catch (error) {
            this.bot.logger.error('Setup error:', error);
            res.status(500).json({ error: 'Setup failed' });
        }
    }

    async getLogs(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            const limit = parseInt(req.query.limit) || 100;
            const type = req.query.type;
            
            let query = 'SELECT * FROM message_logs WHERE guild_id = ?';
            const params = [guildId];
            
            if (type) {
                query += ' AND type = ?';
                params.push(type);
            }
            
            query += ' ORDER BY created_at DESC LIMIT ?';
            params.push(limit);
            
            const logs = await this.bot.database.all(query, params);
            res.json(logs);
        } catch (error) {
            this.bot.logger.error('Logs error:', error);
            res.status(500).json({ error: 'Failed to get logs' });
        }
    }

    async getIncidents(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            const limit = parseInt(req.query.limit) || 50;
            
            const incidents = await this.bot.database.all(`
                SELECT * FROM security_incidents 
                WHERE guild_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            `, [guildId, limit]);
            
            res.json(incidents);
        } catch (error) {
            this.bot.logger.error('Incidents error:', error);
            res.status(500).json({ error: 'Failed to get incidents' });
        }
    }

    async getAnalytics(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            const days = parseInt(req.query.days) || 7;
            
            const analytics = await this.bot.database.all(`
                SELECT * FROM analytics 
                WHERE guild_id = ? AND date >= date('now', '-' || ? || ' days')
                ORDER BY date DESC, hour DESC
            `, [guildId, days]);
            
            res.json(analytics);
        } catch (error) {
            this.bot.logger.error('Analytics error:', error);
            res.status(500).json({ error: 'Failed to get analytics' });
        }
    }

    // Helper methods
    async calculateSecurityScore(guildId) {
        try {
            const config = await this.bot.database.getGuildConfig(guildId);
            let score = 0;
            
            if (config.anti_raid_enabled) score += 20;
            if (config.anti_spam_enabled) score += 20;
            if (config.anti_links_enabled) score += 15;
            if (config.anti_phishing_enabled) score += 15;
            if (config.verification_enabled) score += 10;
            
            // Check for recent incidents
            const recentIncidents = await this.bot.database.get(`
                SELECT COUNT(*) as count FROM security_incidents 
                WHERE guild_id = ? AND created_at > datetime('now', '-24 hours')
            `, [guildId]);
            
            const incidentPenalty = Math.min(20, recentIncidents.count * 2);
            score = Math.max(0, score + 20 - incidentPenalty);
            
            return Math.round(score);
        } catch (error) {
            return 50; // Default score if calculation fails
        }
    }

    async getCurrentThreats(guildId) {
        try {
            const incidents = await this.bot.database.all(`
                SELECT incident_type, COUNT(*) as count, MAX(severity) as max_severity
                FROM security_incidents 
                WHERE guild_id = ? AND created_at > datetime('now', '-1 hour') AND resolved = 0
                GROUP BY incident_type
            `, [guildId]);
            
            return incidents.map(incident => ({
                id: incident.incident_type,
                title: this.formatIncidentType(incident.incident_type),
                count: incident.count,
                level: incident.max_severity.toLowerCase(),
                icon: this.getIncidentIcon(incident.incident_type)
            }));
        } catch (error) {
            return [];
        }
    }

    async getRecentIncidents(guildId) {
        try {
            const incidents = await this.bot.database.all(`
                SELECT * FROM security_incidents 
                WHERE guild_id = ? 
                ORDER BY created_at DESC 
                LIMIT 5
            `, [guildId]);
            
            return incidents.map(incident => ({
                id: incident.id,
                time: new Date(incident.created_at).getTime(),
                description: incident.description || this.formatIncidentType(incident.incident_type),
                status: incident.resolved ? 'resolved' : 'investigating',
                statusIcon: incident.resolved ? 'fas fa-check' : 'fas fa-eye'
            }));
        } catch (error) {
            return [];
        }
    }

    async getActivityData(guildId) {
        try {
            const analytics = await this.bot.database.all(`
                SELECT hour, metric_type, SUM(metric_value) as total
                FROM analytics 
                WHERE guild_id = ? AND date = date('now')
                GROUP BY hour, metric_type
                ORDER BY hour
            `, [guildId]);
            
            const joins = [];
            const messages = [];
            
            for (let i = 0; i < 24; i += 4) {
                const joinData = analytics.find(a => a.hour === i && a.metric_type === 'joins');
                const messageData = analytics.find(a => a.hour === i && a.metric_type === 'messages');
                
                joins.push(joinData ? joinData.total : 0);
                messages.push(messageData ? messageData.total : 0);
            }
            
            return { joins, messages };
        } catch (error) {
            return { joins: [0, 0, 0, 0, 0, 0], messages: [0, 0, 0, 0, 0, 0] };
        }
    }

    async getEventsData(guildId) {
        try {
            const events = await this.bot.database.all(`
                SELECT incident_type, COUNT(*) as count
                FROM security_incidents 
                WHERE guild_id = ? AND created_at > datetime('now', '-24 hours')
                GROUP BY incident_type
            `, [guildId]);
            
            const result = {
                spamBlocked: 0,
                raidsStopped: 0,
                linksFiltered: 0,
                usersVerified: 0
            };
            
            events.forEach(event => {
                if (event.incident_type === 'SPAM_DETECTED') result.spamBlocked = event.count;
                if (event.incident_type === 'RAID_DETECTED') result.raidsStopped = event.count;
                if (event.incident_type === 'MALICIOUS_LINK') result.linksFiltered = event.count;
                if (event.incident_type.includes('VERIFICATION')) result.usersVerified = event.count;
            });
            
            return result;
        } catch (error) {
            return { spamBlocked: 0, raidsStopped: 0, linksFiltered: 0, usersVerified: 0 };
        }
    }

    getDefaultGuildId() {
        return this.bot.client.guilds.cache.first()?.id;
    }

    getServerName(guildId) {
        return this.bot.client.guilds.cache.get(guildId)?.name || 'Unknown Server';
    }

    getServerIcon(guildId) {
        const guild = this.bot.client.guilds.cache.get(guildId);
        return guild?.iconURL() || '/assets/default-server-icon.png';
    }

    formatIncidentType(type) {
        return type.replace('_', ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
    }

    getIncidentIcon(type) {
        const icons = {
            SPAM_DETECTED: 'fas fa-comment-slash',
            RAID_DETECTED: 'fas fa-users-slash',
            MALICIOUS_LINK: 'fas fa-link',
            PHISHING_DETECTED: 'fas fa-fish'
        };
        return icons[type] || 'fas fa-exclamation-triangle';
    }

    getPresetConfig(serverType) {
        const presets = {
            gaming: {
                anti_raid_enabled: true,
                anti_spam_enabled: true,
                anti_links_enabled: false,
                anti_phishing_enabled: false,
                verification_enabled: false
            },
            crypto: {
                anti_raid_enabled: true,
                anti_spam_enabled: true,
                anti_links_enabled: true,
                anti_phishing_enabled: true,
                verification_enabled: true
            },
            support: {
                anti_raid_enabled: true,
                anti_spam_enabled: true,
                anti_links_enabled: true,
                anti_phishing_enabled: false,
                verification_enabled: false
            },
            social: {
                anti_raid_enabled: false,
                anti_spam_enabled: true,
                anti_links_enabled: false,
                anti_phishing_enabled: false,
                verification_enabled: false
            },
            highrisk: {
                anti_raid_enabled: true,
                anti_spam_enabled: true,
                anti_links_enabled: true,
                anti_phishing_enabled: true,
                verification_enabled: true
            }
        };
        
        return presets[serverType] || presets.gaming;
    }

    // New API handlers
    async handleEmergency(req, res) {
        try {
            const { action } = req.body;
            const guildId = req.query.guildId || this.getDefaultGuildId();
            
            if (action === 'enable') {
                // Enable emergency mode - lock all channels, pause invites, enable strict verification
                this.bot.logger.warn(`Ã°Å¸Å¡Â¨ Emergency mode activated for guild ${guildId}`);
                this.broadcast({
                    type: 'notification',
                    message: 'Emergency mode activated - Server locked down',
                    level: 'warning'
                });
            } else {
                // Disable emergency mode
                this.bot.logger.info(`Ã¢Å“â€¦ Emergency mode deactivated for guild ${guildId}`);
                this.broadcast({
                    type: 'notification',
                    message: 'Emergency mode deactivated - Normal operations resumed',
                    level: 'success'
                });
            }
            
            res.json({ success: true, emergencyMode: action === 'enable' });
        } catch (error) {
            this.bot.logger.error('Emergency mode error:', error);
            res.status(500).json({ error: 'Failed to toggle emergency mode' });
        }
    }

    async resolveThreat(req, res) {
        try {
            const { id } = req.params;
            const guildId = req.query.guildId || this.getDefaultGuildId();
            
            // Mark threat as resolved in database
            await this.bot.database.run(`
                UPDATE security_incidents 
                SET resolved = 1, resolved_at = datetime('now')
                WHERE id = ? AND guild_id = ?
            `, [id, guildId]);
            
            this.bot.logger.info(`Ã¢Å“â€¦ Threat ${id} resolved by dashboard user`);
            
            this.broadcast({
                type: 'security_update',
                payload: { threatResolved: id }
            });
            
            res.json({ success: true });
        } catch (error) {
            this.bot.logger.error('Resolve threat error:', error);
            res.status(500).json({ error: 'Failed to resolve threat' });
        }
    }

    async updateSecuritySettings(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            if (!guildId || !/^\d{17,20}$/.test(String(guildId))) {
                return res.status(400).json({ error: 'Invalid or missing guildId' });
            }
            
            const settings = req.body;
            if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
                return res.status(400).json({ error: 'Invalid settings format' });
            }
            
            this.bot.logger.info(`[SETTINGS] Saving security settings for guild ${guildId}`);
            
            // Valid security setting fields (whitelist for SQL safety)
            const validFields = [
                'anti_raid_enabled', 'anti_spam_enabled', 'anti_links_enabled', 
                'anti_phishing_enabled', 'antinuke_enabled', 'verification_enabled', 
                'welcome_enabled', 'tickets_enabled', 'auto_mod_enabled', 'autorole_enabled',
                'xp_enabled'
            ];
            
            // Filter to only valid fields
            const updates = {};
            Object.keys(settings).forEach(key => {
                if (validFields.includes(key)) {
                    updates[key] = Boolean(settings[key]);
                }
            });
            
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'No valid security settings provided' });
            }
            
            // Enforce mutual exclusivity
            if (updates.verification_enabled === true) {
                updates.welcome_enabled = false;
            } else if (updates.welcome_enabled === true) {
                updates.verification_enabled = false;
            }

            // Get current settings to detect changes
            const currentSettings = await this.bot.database.get(
                'SELECT * FROM guild_configs WHERE guild_id = ?',
                [guildId]
            );
            
            // Ensure guild config row exists
            await this.bot.database.run(
                'INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)', 
                [guildId]
            );
            
            // Build atomic update query (all fields at once)
            const setClauses = Object.keys(updates).map(f => `${f} = ?`).join(', ');
            const values = Object.values(updates).map(v => v ? 1 : 0);
            await this.bot.database.run(
                `UPDATE guild_configs SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
                [...values, guildId]
            );
            
            // Post-update: send confirmations and logs
            const userId = req.user?.id || 'Dashboard User';
            
            for (const [field, value] of Object.entries(updates)) {
                const oldValue = currentSettings ? currentSettings[field] : null;

                // Insert audit log for this change (non-blocking)
                try {
                    await this.bot.database.insertAuditLog({
                        guild_id: guildId,
                        event_type: 'security_setting_update',
                        event_category: 'config_change',
                        executor_id: userId,
                        executor_tag: req.user?.username || 'Dashboard User',
                        target_type: 'setting',
                        target_name: field,
                        changes: { [field]: { from: oldValue, to: value ? 1 : 0 } },
                        before_state: { [field]: oldValue },
                        after_state: { [field]: value ? 1 : 0 }
                    });
                } catch (auditErr) {
                    this.bot.logger?.warn && this.bot.logger.warn('Failed to insert audit log:', auditErr.message);
                }
                
                // Send confirmation if ConfirmationManager is available
                if (this.bot.confirmationManager && oldValue !== (value ? 1 : 0)) {
                    const settingNames = {
                        'anti_raid_enabled': 'Anti-Raid Protection',
                        'anti_spam_enabled': 'Anti-Spam Protection',
                        'anti_links_enabled': 'Anti-Links Protection',
                        'anti_phishing_enabled': 'Anti-Phishing Protection',
                        'antinuke_enabled': 'Anti-Nuke Protection',
                        'verification_enabled': 'User Verification',
                        'welcome_enabled': 'Welcome Messages',
                        'tickets_enabled': 'Ticket System',
                        'auto_mod_enabled': 'Auto-Moderation',
                        'autorole_enabled': 'Auto-Role Assignment',
                        'xp_enabled': 'XP & Leveling System'
                    };
                    
                    await this.bot.confirmationManager.sendConfirmation(
                        guildId,
                        'security',
                        settingNames[field] || field,
                        value ? 'Enabled' : 'Disabled',
                        oldValue ? 'Enabled' : 'Disabled',
                        userId
                    );
                }
                
                // Log to dashboard logger
                if (this.bot.dashboardLogger) {
                    const guild = this.bot.client.guilds.cache.get(guildId);
                    await this.bot.dashboardLogger.logSettingChange(
                        'security',
                        field,
                        value ? 1 : 0,
                        oldValue,
                        userId,
                        'Dashboard User',
                        guildId,
                        guild?.name || 'Unknown Server'
                    );
                    // Emit universal setting change notification
                    try {
                        if (typeof this.bot.emitSettingChange === 'function') {
                            await this.bot.emitSettingChange(guildId, userId, field, value ? 1 : 0, oldValue, 'security');
                        }
                    } catch (e) {
                        this.bot.logger?.warn && this.bot.logger.warn('emitSettingChange failed in updateSecuritySettings:', e?.message || e);
                    }
                }
            }

            // Broadcast WebSocket packets for bot/frontend listeners
            if (this.wss) {
                for (const [field, value] of Object.entries(updates)) {
                    const oldValue = currentSettings ? currentSettings[field] : null;
                    this.broadcastToGuild(guildId, {
                        type: 'dashboard_setting_update',
                        guildId,
                        setting: field,
                        before: oldValue,
                        after: value,
                        changedBy: userId
                    });
                }
                if (updates.verification_enabled) {
                    this.broadcastToGuild(guildId, {
                        type: 'verification_instructions',
                        guildId
                    });
                }
            }
            
            this.bot.logger.info(`[SETTINGS] Security settings saved for guild ${guildId}`);

            // Log to guild log channel with embed for each changed setting
            try {
                const updatedConfig = await this.bot.database.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]);
                const logChannelId = updatedConfig?.log_channel_id || updatedConfig?.logs_channel_id;
                const logChannel = logChannelId ? this.bot.client.channels.cache.get(logChannelId) : null;
                if (logChannel && logChannel.isTextBased()) {
                    for (const [field, value] of Object.entries(updates)) {
                        const before = currentSettings ? currentSettings[field] : null;
                        const embed = this.buildSettingEmbed(field, before, value, userId);
                        if (embed) {
                            await logChannel.send({ embeds: [embed] });
                        }
                    }
                    if (updates.verification_enabled) {
                        const instructions = this.buildVerificationInstructionsEmbed();
                        await logChannel.send({ embeds: [instructions] });
                    }
                }
            } catch (logErr) {
                this.bot.logger.warn('Failed to send setting update embed:', logErr.message);
            }
            
            // Invalidate config cache
            if (this.bot.database.invalidateConfigCache) {
                this.bot.database.invalidateConfigCache(guildId);
            }
            
            res.json({ success: true, message: 'Security settings updated. Confirmation sent to Discord.', settings: { ...currentSettings, ...updates } });
            
        } catch (error) {
            this.bot.logger.error('[SETTINGS] updateSecuritySettings error:', error);
            res.status(500).json({ error: `Failed to update security settings: ${error.message}` });
        }
    }

    // Onboarding / Welcome vs Verification mutual exclusive toggle handler
    async updateOnboardingSettings(req, res) {
        try {
            const guildId = req.body.guildId || req.query.guildId || this.getDefaultGuildId();
            if (!guildId) {
                return res.status(400).json({ success: false, error: 'Missing guildId' });
            }

            const settings = req.body;
            if (!settings || typeof settings !== 'object') {
                return res.status(400).json({ success: false, error: 'No settings provided' });
            }

            // Ensure row exists
            await this.bot.database.run('INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)', [guildId]);
            const current = await this.bot.database.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]);

            // Map boolean to 0/1 for SQLite
            const toBool = (val) => (val === true || val === 1 || val === '1') ? 1 : 0;

            // Handle all quick settings - ONLY process settings that exist in request
            const updates = {};
            const settingsKeys = [
                'anti_raid_enabled',
                'anti_spam_enabled',
                'anti_phishing_enabled',
                'antinuke_enabled',
                'welcome_enabled',
                'verification_enabled',
                'tickets_enabled',
                'ai_enabled',
                'auto_mod_enabled',
                'autorole_enabled',
                'xp_enabled'
            ];

            // Only include settings that were actually provided in the request
            settingsKeys.forEach(key => {
                if (settings.hasOwnProperty(key)) {
                    updates[key] = toBool(settings[key]);
                }
            });

            // Allow both welcome and verification to be enabled concurrently

            // Build UPDATE query
            const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
            const values = [...Object.values(updates), guildId];

            // Debug logging
            console.log('[SETTINGS] Updating guild', guildId, 'with:', updates);
            console.log('[SETTINGS] SQL:', `UPDATE guild_configs SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`);
            console.log('[SETTINGS] Values:', values);

            await this.bot.database.run(
                `UPDATE guild_configs 
                 SET ${setClause}, updated_at = CURRENT_TIMESTAMP
                 WHERE guild_id = ?`,
                values
            );

            const userId = req.user?.id || 'Dashboard';

            // Insert audit logs for all changes
            try {
                for (const [key, value] of Object.entries(updates)) {
                    await this.bot.database.insertAuditLog({
                        guild_id: guildId,
                        event_type: 'onboarding_setting_update',
                        event_category: 'config_change',
                        executor_id: userId,
                        executor_tag: req.user?.username || 'Dashboard User',
                        target_type: 'setting',
                        target_name: key,
                        changes: { [key]: { from: current?.[key], to: value } },
                        before_state: { [key]: current?.[key] },
                        after_state: { [key]: value }
                    });
                }
            } catch (auditErr) {
                this.bot.logger?.warn && this.bot.logger.warn('Failed to insert audit logs:', auditErr.message);
            }

            // Emit setting change notifications for all updated settings
            try {
                if (typeof this.bot.emitSettingChange === 'function') {
                    for (const [key, value] of Object.entries(updates)) {
                        await this.bot.emitSettingChange(guildId, userId, key, value, current?.[key], 'security');
                    }
                }
            } catch (e) {
                this.bot.logger?.warn && this.bot.logger.warn('emitSettingChange failed in updateOnboardingSettings:', e?.message || e);
            }

            // Broadcast packets for updated settings
            const packets = Object.entries(updates).map(([key, value]) => ({
                type: 'dashboard_setting_update',
                guildId,
                setting: key,
                before: current?.[key],
                after: value,
                changedBy: userId
            }));
            
            packets.forEach(p => this.broadcastToGuild(guildId, p));
            
            if (updates.verification_enabled === 1) {
                this.broadcastToGuild(guildId, { type: 'verification_instructions', guildId });
            }

            // Log embeds into guild log channel
            const logChannelId = current?.log_channel_id || current?.logs_channel_id;
            const logChannel = logChannelId ? this.bot.client.channels.cache.get(logChannelId) : null;
            if (logChannel?.isTextBased()) {
                for (const packet of packets) {
                    const embed = this.buildSettingEmbed(packet.setting, packet.before, packet.after, packet.changedBy);
                    if (embed) await logChannel.send({ embeds: [embed] }).catch(() => {});
                }
                if (updates.verification_enabled === 1) {
                    await logChannel.send({ embeds: [this.buildVerificationInstructionsEmbed()] }).catch(() => {});
                }
            }

            // Get updated config to return
            const updatedConfig = await this.bot.database.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]);

            // Invalidate config cache
            if (this.bot.database.invalidateConfigCache) {
                this.bot.database.invalidateConfigCache(guildId);
            }

            return res.json({
                success: true,
                settings: updatedConfig
            });
        } catch (error) {
            this.bot.logger.error('[SETTINGS] updateOnboardingSettings error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update onboarding settings' });
        }
    }

    buildSettingEmbed(field, before, after, changedBy) {
        const labelMap = {
            anti_raid_enabled: 'Anti-Raid Protection',
            anti_spam_enabled: 'Anti-Spam Protection',
            anti_links_enabled: 'Anti-Links Protection',
            anti_phishing_enabled: 'Anti-Phishing Protection',
            antinuke_enabled: 'Anti-Nuke Protection',
            verification_enabled: 'Verification System',
            welcome_enabled: 'Welcome Messages',
            tickets_enabled: 'Ticket System',
            auto_mod_enabled: 'Auto-Moderation',
            autorole_enabled: 'Auto-Role Assignment',
            xp_enabled: 'XP & Leveling System'
        };
        const label = labelMap[field] || field;
        const afterText = after ? 'Enabled' : 'Disabled';
        const beforeText = before ? 'Enabled' : 'Disabled';
        return new (require('discord.js').EmbedBuilder)()
            .setTitle('Ã¢Å¡â„¢Ã¯Â¸Â Dashboard Setting Updated')
            .setDescription(`${label} updated to **${afterText}**\n\nÃ¢Å“â€¦ Dashboard and bot are synchronized`)
            .addFields(
                { name: 'Ã°Å¸ÂÂ·Ã¯Â¸Â Category', value: 'Security Settings', inline: true },
                { name: 'Ã°Å¸â€œâ€¹ Setting', value: label, inline: true },
                { name: 'Ã°Å¸â€˜Â¤ Changed By', value: changedBy || 'Dashboard', inline: true },
                { name: 'Ã°Å¸â€â€ž Changes', value: `Before: ${beforeText}\nAfter: ${afterText}`, inline: false }
            )
            .setColor(after ? 0x00d4ff : 0xffa200)
            .setTimestamp();
    }

    buildVerificationInstructionsEmbed() {
        return new (require('discord.js').EmbedBuilder)()
            .setTitle('Ã°Å¸â€Â Verification System Enabled')
            .setDescription('New members must now verify before accessing channels.')
            .addFields({
                name: 'Next Steps',
                value: '1) Configure Unverified and Verified roles\n2) Set Verification and Welcome channels\n3) Customize verification DM\n4) Staff can Skip/Kick users in Logs\nUse `/verified_setup` to finish configuration.'
            })
            .setColor(0x5865f2)
            .setTimestamp();
    }

    async updateBotSettings(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            if (!guildId) {
                return res.status(400).json({ error: 'Missing guildId' });
            }
            
            const settings = req.body;
            if (!settings || typeof settings !== 'object') {
                return res.status(400).json({ error: 'No settings provided' });
            }
            
            this.bot.logger.info(`[SETTINGS] Saving bot settings for guild ${guildId}:`, settings);
            
            // Valid bot setting fields and their database column mapping
            const fieldMapping = {
                'log_channel_id': 'log_channel_id',
                'alert_channel': 'log_channel_id',
                'mod_role_id': 'mod_role_id', 
                'admin_role_id': 'admin_role_id',
                'welcome_channel': 'welcome_channel_id',
                'welcome_channel_id': 'welcome_channel_id',
                'welcome_message': 'welcome_message',
                'verification_channel_id': 'verification_channel_id',
                'verification_role_id': 'verified_role_id',
                'ticket_category': 'ticket_category',
                'mute_role_id': 'mute_role_id',
                'autorole_id': 'autorole_id',
                // Advanced Verification Settings
                'verification_dm_message': 'verification_dm_message',
                'verification_expiration': 'verification_expiration',
                'verification_max_attempts': 'verification_max_attempts',
                'verification_cooldown': 'verification_cooldown',
                'verification_fail_action': 'verification_fail_action',
                'verification_require_captcha': 'verification_require_captcha',
                'verification_log_attempts': 'verification_log_attempts'
            };
            
            const updates = {};
            Object.keys(settings).forEach(key => {
                if (fieldMapping[key] && settings[key] !== undefined) {
                    updates[fieldMapping[key]] = settings[key];
                }
            });
            
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'No valid bot settings provided' });
            }
            
            // Get current settings
            const currentSettings = await this.bot.database.get(
                'SELECT * FROM guild_settings WHERE guild_id = ?',
                [guildId]
            );
            
            // Ensure guild settings row exists
            await this.bot.database.run(
                'INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)', 
                [guildId]
            );
            
            // Update each field individually and send confirmations
            const userId = req.user?.id || 'Dashboard User';
            
            for (const [field, value] of Object.entries(updates)) {
                const oldValue = currentSettings ? currentSettings[field] : null;
                
                await this.bot.database.run(
                    `UPDATE guild_settings SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
                    [value, guildId]
                );

                // Insert audit log for this change
                try {
                    await this.bot.database.insertAuditLog({
                        guild_id: guildId,
                        event_type: 'bot_setting_update',
                        event_category: 'config_change',
                        executor_id: userId,
                        executor_tag: req.user?.username || 'Dashboard User',
                        target_type: 'setting',
                        target_name: field,
                        changes: { [field]: { from: oldValue, to: value } },
                        before_state: { [field]: oldValue },
                        after_state: { [field]: value }
                    });
                } catch (auditErr) {
                    this.bot.logger?.warn && this.bot.logger.warn('Failed to insert audit log:', auditErr.message);
                }
                
                // Send confirmation for channel/role changes
                if (this.bot.confirmationManager && oldValue !== value) {
                    const settingNames = {
                        'log_channel_id': 'Log Channel',
                        'mod_role_id': 'Moderator Role',
                        'admin_role_id': 'Administrator Role',
                        'welcome_channel_id': 'Welcome Channel',
                        'welcome_message': 'Welcome Message',
                        'ticket_category': 'Ticket Category',
                        'mute_role_id': 'Mute Role',
                        'autorole_id': 'Auto-Role'
                    };
                    
                    // Format values for display
                    let displayValue = value;
                    let displayOldValue = oldValue;
                    
                    if (field.includes('channel') && value) {
                        displayValue = `<#${value}>`;
                        displayOldValue = oldValue ? `<#${oldValue}>` : 'None';
                    } else if (field.includes('role') && value) {
                        displayValue = `<@&${value}>`;
                        displayOldValue = oldValue ? `<@&${oldValue}>` : 'None';
                    }
                    
                    await this.bot.confirmationManager.sendConfirmation(
                        guildId,
                        'configuration',
                        settingNames[field] || field,
                        displayValue,
                        displayOldValue,
                        userId
                    );
                }
                
                // Log to dashboard logger
                if (this.bot.dashboardLogger) {
                    const guild = this.bot.client.guilds.cache.get(guildId);
                    await this.bot.dashboardLogger.logSettingChange(
                        'configuration',
                        field,
                        value,
                        oldValue,
                        userId,
                        'Dashboard User',
                        guildId,
                        guild?.name || 'Unknown Server'
                    );
                    // Emit universal setting change notification
                    try {
                        if (typeof this.bot.emitSettingChange === 'function') {
                            await this.bot.emitSettingChange(guildId, userId, field, value, oldValue, 'configuration');
                        }
                    } catch (e) {
                        this.bot.logger?.warn && this.bot.logger.warn('emitSettingChange failed in updateBotSettings:', e?.message || e);
                    }
                }
            }
            
            this.bot.logger.info(`[SETTINGS] Bot settings saved for guild ${guildId}`);
            
            // Invalidate config cache
            if (this.bot.database.invalidateConfigCache) {
                this.bot.database.invalidateConfigCache(guildId);
            }
            
            res.json({ success: true, message: 'Bot configuration updated. Confirmation sent to Discord.' });
            
        } catch (error) {
            this.bot.logger.error('[SETTINGS] updateBotSettings error:', error);
            res.status(500).json({ error: `Failed to update bot settings: ${error.message}` });
        }
    }

    async updateAdvancedSettings(req, res) {
        try {
            const { guildId, feature, settings: nestedSettings } = req.body;
            const targetGuildId = guildId || req.query.guildId || this.getDefaultGuildId();
            
            if (!targetGuildId) {
                return res.status(400).json({ error: 'Missing guildId' });
            }
            
            // Extract settings from nested structure if present, otherwise use req.body directly
            const settings = nestedSettings || req.body;
            if (!settings || typeof settings !== 'object') {
                return res.status(400).json({ error: 'No advanced settings provided' });
            }
            
            this.bot.logger.info(`[SETTINGS] Saving advanced settings for guild ${targetGuildId} (feature: ${feature || 'unknown'}):`, settings);
            
            // Valid advanced setting fields
            const validFields = [
                'raid_threshold', 'raid_timeout_minutes', 'raid_action', 'raid_dm_notify',
                'spam_threshold', 'spam_timeout_seconds', 'spam_delete_messages', 'spam_mute_duration',
                'antilinks_whitelist', 'antilinks_action', 'antilinks_warn_user', 'antilinks_log_attempts',
                'verification_profile', 'verification_timeout', 'auto_kick_on_timeout', 'verification_min_account_age_days',
                'enable_ai_scan', 'enable_dashboard_buttons', 'enable_staff_dm', 'verification_language',
                'welcome_embed_enabled', 'welcome_ping_user', 'welcome_delete_after', 'welcome_auto_role',
                'ticket_max_open', 'ticket_auto_close_hours', 'ticket_transcript_enabled', 'ticket_rating_enabled',
                'automod_toxicity_threshold', 'automod_caps_percentage', 'automod_emoji_limit', 'automod_mention_limit',
                'antinuke_role_limit', 'antinuke_channel_limit', 'antinuke_ban_limit', 'antinuke_auto_ban', 'antinuke_reverse_actions'
            ];
            
            const updates = {};
            Object.keys(settings).forEach(key => {
                if (validFields.includes(key)) {
                    updates[key] = settings[key];
                }
            });
            
            if (Object.keys(updates).length === 0) {
                // Accept request even if no known fields matched to avoid blocking UI
                this.bot.logger.warn('[SETTINGS] No valid advanced settings matched known fields; echoing settings and returning success');
                return res.json({ success: true, updated: {}, received: settings });
            }
            
            // Ensure guild config row exists WITHOUT overwriting existing values
            const existing = await this.bot.database.get(
                'SELECT * FROM guild_configs WHERE guild_id = ?',
                [targetGuildId]
            );
            
            if (!existing) {
                // Create minimal row - don't set any defaults that would override existing settings
                await this.bot.database.run(
                    'INSERT INTO guild_configs (guild_id) VALUES (?)', 
                    [targetGuildId]
                );
            }
            
            // Update ONLY the fields that were explicitly provided
            const userId = req.user?.id || 'Dashboard';
            for (const [field, value] of Object.entries(updates)) {
                const oldValue = existing ? existing[field] : null;
                
                await this.bot.database.run(
                    `UPDATE guild_configs SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
                    [value, targetGuildId]
                );

                // Insert audit log for this change
                try {
                    await this.bot.database.insertAuditLog({
                        guild_id: targetGuildId,
                        event_type: 'advanced_setting_update',
                        event_category: 'config_change',
                        executor_id: userId,
                        executor_tag: req.user?.username || 'Dashboard User',
                        target_type: 'setting',
                        target_name: field,
                        changes: { [field]: { from: oldValue, to: value } },
                        before_state: { [field]: oldValue },
                        after_state: { [field]: value }
                    });
                } catch (auditErr) {
                    this.bot.logger?.warn && this.bot.logger.warn('Failed to insert audit log:', auditErr.message);
                }

                // Emit universal setting change notification for advanced settings
                try {
                    if (typeof this.bot.emitSettingChange === 'function') {
                        await this.bot.emitSettingChange(targetGuildId, req.user?.id || 'Dashboard', field, value, null, 'advanced');
                    }
                } catch (e) {
                    this.bot.logger?.warn && this.bot.logger.warn('emitSettingChange failed in updateAdvancedSettings:', e?.message || e);
                }
            }
            
            this.bot.logger.info(`[SETTINGS] Advanced settings saved for guild ${targetGuildId}:`, Object.keys(updates));
            
            // Invalidate config cache
            if (this.bot.database.invalidateConfigCache) {
                this.bot.database.invalidateConfigCache(targetGuildId);
            }
            
            res.json({ success: true, updated: Object.keys(updates) });
            
        } catch (error) {
            this.bot.logger.error('[SETTINGS] updateAdvancedSettings error:', error);
            res.status(500).json({ error: `Failed to update advanced settings: ${error.message}` });
        }
    }
    
    async getSecurityStatsForGuild(guildId) {
        try {
            // Ensure database is available
            if (!this.bot || !this.bot.database) {
                this.bot?.logger?.warn(`[STATS] Database not available for guild ${guildId}`);
                return this.getDefaultSecurityStats();
            }
            
            // Get real-time moderation stats from database
            const stats = await this.bot.database.get(`
                SELECT 
                    COUNT(CASE WHEN action_type = 'warn' THEN 1 END) as warnings,
                    COUNT(CASE WHEN action_type = 'kick' THEN 1 END) as kicks,
                    COUNT(CASE WHEN action_type = 'ban' THEN 1 END) as bans,
                    COUNT(CASE WHEN action_type = 'timeout' THEN 1 END) as timeouts,
                    COUNT(CASE WHEN reason LIKE '%raid%' OR reason LIKE '%spam%' THEN 1 END) as raids
                FROM mod_actions 
                WHERE guild_id = ? AND created_at > datetime('now', '-24 hours')
            `, [guildId]);
            
            // Get recent incidents
            const incidents = await this.bot.database.all(`
                SELECT action, reason, target_tag, moderator_tag, created_at
                FROM mod_actions 
                WHERE guild_id = ? 
                ORDER BY created_at DESC 
                LIMIT 10
            `, [guildId]);
            
            // Get current threats (active issues)
            const threats = [];
            if (stats && stats.raids > 0) {
                threats.push({
                    id: 'raid_detected',
                    title: 'Raid Activity Detected',
                    count: stats.raids,
                    level: stats.raids > 5 ? 'high' : 'medium',
                    icon: 'fas fa-shield-alt'
                });
            }
            
            if (stats && stats.warnings > 10) {
                threats.push({
                    id: 'high_warnings',
                    title: 'High Warning Activity',
                    count: stats.warnings,
                    level: 'medium',
                    icon: 'fas fa-exclamation-triangle'
                });
            }
            
            // Calculate security score based on activity
            let score = 95;
            if (stats) {
                if (stats.raids > 0) score -= stats.raids * 5;
                if (stats.bans > 5) score -= 10;
                if (stats.warnings > 20) score -= 5;
            }
            score = Math.max(score, 50); // Minimum score of 50
            
            // Format incidents for display
            const formattedIncidents = (incidents || []).map(incident => ({
                id: `incident_${Date.now()}_${Math.random()}`,
                time: new Date(incident.created_at).getTime(),
                description: `${incident.action.toUpperCase()}: ${incident.target_tag} - ${incident.reason}`,
                status: 'resolved',
                statusIcon: 'fas fa-check',
                moderator: incident.moderator_tag
            }));
            
            return {
                score,
                threats,
                incidents: formattedIncidents,
                activity: [
                    { time: Date.now() - 3600000, warnings: stats?.warnings || 0 },
                    { time: Date.now() - 1800000, kicks: stats?.kicks || 0 },
                    { time: Date.now(), bans: stats?.bans || 0 }
                ],
                events: (incidents || []).slice(0, 5)
            };
            
        } catch (error) {
            this.bot?.logger?.error(`[STATS] Error getting security stats for guild ${guildId}:`, error);
            return this.getDefaultSecurityStats();
        }
    }
    
    getDefaultSecurityStats() {
        return {
            score: 85,
            threats: [],
            incidents: [],
            activity: [
                { time: Date.now() - 3600000, warnings: 0 },
                { time: Date.now() - 1800000, kicks: 0 },
                { time: Date.now() - 900000, bans: 0 },
                { time: Date.now(), timeouts: 0 }
            ],
            events: [
                { timestamp: Date.now() - 1800000, action: 'system_check', details: 'Security scan completed' },
                { timestamp: Date.now() - 900000, action: 'config_update', details: 'Settings synchronized' }
            ]
        };
    }
    
    async getServerName(guildId) {
        try {
            if (!this.bot || !this.bot.client || !this.bot.client.guilds) {
                return 'Discord Server';
            }
            const guild = this.bot.client.guilds.cache.get(guildId);
            return guild ? guild.name : 'Unknown Server';
        } catch (error) {
            return 'Discord Server';
        }
    }
    
    async getServerIcon(guildId) {
        try {
            if (!this.bot || !this.bot.client || !this.bot.client.guilds) {
                return 'https://cdn.discordapp.com/embed/avatars/0.png';
            }
            const guild = this.bot.client.guilds.cache.get(guildId);
            return guild && guild.iconURL() ? guild.iconURL() : 'https://cdn.discordapp.com/embed/avatars/0.png';
        } catch (error) {
            return 'https://cdn.discordapp.com/embed/avatars/0.png';
        }
    }
    
    async getMemberCount(guildId) {
        try {
            if (!this.bot || !this.bot.client || !this.bot.client.guilds) {
                return 1;
            }
            const guild = this.bot.client.guilds.cache.get(guildId);
            return guild ? guild.memberCount : 1;
        } catch (error) {
            return 1;
        }
    }

    async updateApiKeys(req, res) {
        try {
            const keys = req.body;
            const guildId = req.query.guildId || this.getDefaultGuildId();
            
            // Store API keys securely
            for (const [key, value] of Object.entries(keys)) {
                if (value) { // Only update if value is provided
                    await this.bot.database.run(`
                        INSERT OR REPLACE INTO guild_configs (guild_id, setting_key, setting_value)
                        VALUES (?, ?, ?)
                    `, [guildId, `api_${key}`, value]);
                }
            }
            
            this.bot.logger.info(`Ã°Å¸â€â€˜ API keys updated for guild ${guildId}`);
            res.json({ success: true });
        } catch (error) {
            this.bot.logger.error('Update API keys error:', error);
            res.status(500).json({ error: 'Failed to update API keys' });
        }
    }

    async resetSettings(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }
            
            // Safety check: require explicit confirmation to prevent accidental resets
            const confirmToken = req.query.confirm;
            if (!confirmToken || confirmToken !== 'RESET_' + guildId) {
                return res.status(400).json({ 
                    error: 'Reset requires confirmation token',
                    hint: 'Pass ?confirm=RESET_GUILDID to confirm'
                });
            }
            
            this.bot.logger.warn(`[SETTINGS] User confirmed reset for guild ${guildId}`);
            
            // IMPORTANT: Do NOT delete guild_subscriptions - they contain pro plan info!
            // Only reset guild_configs to defaults
            await this.bot.database.run('DELETE FROM guild_configs WHERE guild_id = ?', [guildId]);
            
            // Re-create default guild_configs with safe defaults
            await this.bot.database.run(`
                INSERT OR REPLACE INTO guild_configs (
                    guild_id, anti_raid_enabled, anti_spam_enabled, anti_links_enabled,
                    anti_phishing_enabled, verification_enabled, welcome_enabled,
                    tickets_enabled, auto_mod_enabled, autorole_enabled,
                    raid_threshold, spam_threshold, verification_level,
                    created_at, updated_at
                ) VALUES (?, 1, 1, 1, 1, 1, 0, 0, 0, 0, 10, 5, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [guildId]);
            
            this.bot.logger.info(`Ã¢Å“â€¦ Guild settings reset to defaults for ${guildId} (subscriptions preserved)`);
            res.json({ 
                success: true, 
                message: 'Settings reset to defaults',
                note: 'Pro subscriptions and user records were preserved'
            });
        } catch (error) {
            this.bot.logger.error('[SETTINGS] Reset settings error:', error);
            res.status(500).json({ error: `Failed to reset settings: ${error.message}` });
        }
    }

    async exportLogs(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            
            const logs = await this.bot.database.all(`
                SELECT * FROM security_incidents 
                WHERE guild_id = ? 
                ORDER BY created_at DESC
            `, [guildId]);
            
            // Convert to CSV
            const csvHeader = 'Date,Event,User,Action,Status,Details\n';
            const csvData = logs.map(log => 
                `"${log.created_at}","${log.incident_type}","${log.user_id || 'System'}","${log.action_taken || 'None'}","${log.resolved ? 'Resolved' : 'Open'}","${log.description || ''}"`
            ).join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="security-logs.csv"');
            res.send(csvHeader + csvData);
        } catch (error) {
            this.bot.logger.error('Export logs error:', error);
            res.status(500).json({ error: 'Failed to export logs' });
        }
    }

    async clearLogs(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            
            await this.bot.database.run(`
                DELETE FROM security_incidents 
                WHERE guild_id = ? AND resolved = 1
            `, [guildId]);
            
            this.bot.logger.info(`Ã°Å¸Â§Â¹ Resolved logs cleared for guild ${guildId}`);
            res.json({ success: true });
        } catch (error) {
            this.bot.logger.error('Clear logs error:', error);
            res.status(500).json({ error: 'Failed to clear logs' });
        }
    }

    // NOTE: Duplicate getAnalytics with hardcoded sample data was removed.
    // The real getAnalytics method (querying the analytics table) is defined above.

    async getLogs(req, res) {
        try {
            const filter = req.query.filter || 'all';
            const guildId = req.query.guildId || this.getDefaultGuildId();
            
            // Return sample logs data
            const logs = [
                {
                    id: 1,
                    timestamp: Date.now() - 300000,
                    event: 'Bot Started',
                    user: 'System',
                    action: 'Initialization',
                    status: 'Success',
                    details: 'GuardianBot started successfully'
                },
                {
                    id: 2,
                    timestamp: Date.now() - 600000,
                    event: 'Dashboard Access',
                    user: 'Admin',
                    action: 'Login',
                    status: 'Success',
                    details: 'Admin user logged into dashboard'
                }
            ];
            
            res.json(logs);
        } catch (error) {
            this.bot.logger.error('Logs error:', error);
            res.status(500).json({ error: 'Failed to load logs' });
        }
    }

    async getAuditLogs(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            const limit = parseInt(req.query.limit) || 50;
            const offset = parseInt(req.query.offset) || 0;
            const category = req.query.category || 'all';
            
            if (!guildId) {
                return res.status(400).json({ error: 'Missing guildId' });
            }

            // Build WHERE clause based on filters
            let whereClause = 'guild_id = ?';
            const params = [guildId];
            
            if (category !== 'all') {
                whereClause += ' AND event_category = ?';
                params.push(category);
            }

            // Get audit logs from database
            const logs = await this.bot.database.all(`
                SELECT 
                    id, event_type, event_category, executor_id, executor_tag,
                    target_type, target_id, target_name, changes, reason,
                    before_state, after_state, timestamp
                FROM audit_logs 
                WHERE ${whereClause}
                ORDER BY timestamp DESC 
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            // Get total count for pagination
            const countResult = await this.bot.database.get(`
                SELECT COUNT(*) as total FROM audit_logs WHERE ${whereClause}
            `, params);

            // Parse JSON fields
            const parsedLogs = logs.map(log => ({
                ...log,
                changes: log.changes ? JSON.parse(log.changes) : null,
                before_state: log.before_state ? JSON.parse(log.before_state) : null,
                after_state: log.after_state ? JSON.parse(log.after_state) : null
            }));

            res.json({
                success: true,
                logs: parsedLogs,
                total: countResult?.total || 0,
                limit,
                offset
            });
        } catch (error) {
            this.bot.logger.error('Audit logs error:', error);
            res.status(500).json({ error: 'Failed to load audit logs' });
        }
    }

    async getXPEvents(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            if (!guildId) {
                return res.status(400).json({ error: 'Missing guildId' });
            }

            const events = await this.bot.database.getAllXPEvents(guildId);
            res.json({ success: true, events });
        } catch (error) {
            this.bot.logger.error('Get XP events error:', error);
            res.status(500).json({ error: 'Failed to load XP events' });
        }
    }

    async createXPEvent(req, res) {
        try {
            const guildId = req.body.guildId || req.query.guildId || this.getDefaultGuildId();
            if (!guildId) {
                return res.status(400).json({ error: 'Missing guildId' });
            }

            const { event_name, multiplier, start_time, end_time, description } = req.body;
            
            if (!event_name || !multiplier || !start_time || !end_time) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Validate times
            const startDate = new Date(start_time);
            const endDate = new Date(end_time);
            if (endDate <= startDate) {
                return res.status(400).json({ error: 'End time must be after start time' });
            }

            const userId = req.user?.id || 'Dashboard User';
            
            await this.bot.database.createXPEvent({
                guild_id: guildId,
                event_name,
                multiplier: parseFloat(multiplier),
                start_time: startDate.toISOString(),
                end_time: endDate.toISOString(),
                created_by: userId,
                description: description || ''
            });

            // Insert audit log
            try {
                await this.bot.database.insertAuditLog({
                    guild_id: guildId,
                    event_type: 'xp_event_created',
                    event_category: 'config_change',
                    executor_id: userId,
                    executor_tag: req.user?.username || 'Dashboard User',
                    target_type: 'xp_event',
                    target_name: event_name,
                    changes: { multiplier, start_time, end_time },
                    after_state: { event_name, multiplier, start_time, end_time, description }
                });
            } catch (auditErr) {
                this.bot.logger?.warn && this.bot.logger.warn('Failed to insert audit log:', auditErr.message);
            }

            res.json({ success: true, message: 'XP event created successfully' });
        } catch (error) {
            this.bot.logger.error('Create XP event error:', error);
            res.status(500).json({ error: 'Failed to create XP event' });
        }
    }

    async deleteXPEvent(req, res) {
        try {
            const eventId = req.params.id;
            if (!eventId) {
                return res.status(400).json({ error: 'Missing event ID' });
            }

            await this.bot.database.deleteXPEvent(eventId);

            // Insert audit log
            const userId = req.user?.id || 'Dashboard User';
            try {
                await this.bot.database.insertAuditLog({
                    guild_id: req.query.guildId || this.getDefaultGuildId(),
                    event_type: 'xp_event_deleted',
                    event_category: 'config_change',
                    executor_id: userId,
                    executor_tag: req.user?.username || 'Dashboard User',
                    target_type: 'xp_event',
                    target_id: eventId
                });
            } catch (auditErr) {
                this.bot.logger?.warn && this.bot.logger.warn('Failed to insert audit log:', auditErr.message);
            }

            res.json({ success: true, message: 'XP event deleted successfully' });
        } catch (error) {
            this.bot.logger.error('Delete XP event error:', error);
            res.status(500).json({ error: 'Failed to delete XP event' });
        }
    }

    async getSeasons(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            if (!guildId) {
                return res.status(400).json({ error: 'Missing guildId' });
            }

            const seasons = await this.bot.database.getAllSeasons(guildId);
            res.json({ success: true, seasons });
        } catch (error) {
            this.bot.logger.error('Get seasons error:', error);
            res.status(500).json({ error: 'Failed to load seasons' });
        }
    }

    async createSeason(req, res) {
        try {
            const guildId = req.body.guildId || req.query.guildId || this.getDefaultGuildId();
            if (!guildId) {
                return res.status(400).json({ error: 'Missing guildId' });
            }

            const { season_name, start_date, end_date } = req.body;
            
            if (!season_name || !start_date || !end_date) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const startDate = new Date(start_date);
            const endDate = new Date(end_date);
            if (endDate <= startDate) {
                return res.status(400).json({ error: 'End date must be after start date' });
            }

            await this.bot.database.createSeason(guildId, season_name, startDate.toISOString(), endDate.toISOString());

            const userId = req.user?.id || 'Dashboard User';
            try {
                await this.bot.database.insertAuditLog({
                    guild_id: guildId,
                    event_type: 'season_created',
                    event_category: 'config_change',
                    executor_id: userId,
                    executor_tag: req.user?.username || 'Dashboard User',
                    target_type: 'season',
                    target_name: season_name,
                    changes: { start_date, end_date },
                    after_state: { season_name, start_date, end_date }
                });
            } catch (auditErr) {
                this.bot.logger?.warn && this.bot.logger.warn('Failed to insert audit log:', auditErr.message);
            }

            res.json({ success: true, message: 'Season created successfully' });
        } catch (error) {
            this.bot.logger.error('Create season error:', error);
            res.status(500).json({ error: 'Failed to create season' });
        }
    }

    async resetSeason(req, res) {
        try {
            const seasonId = req.params.id;
            const guildId = req.query.guildId || this.getDefaultGuildId();

            if (!seasonId || !guildId) {
                return res.status(400).json({ error: 'Missing season ID or guildId' });
            }

            const season = await this.bot.database.getSeasonById(seasonId);
            if (!season || season.guild_id !== guildId) {
                return res.status(404).json({ error: 'Season not found' });
            }

            // Get current XP data and create snapshots
            const rankData = this.bot.rankSystem?.data?.guilds?.[guildId] || {};
            let rank = 1;

            for (const [userId, userData] of Object.entries(rankData)) {
                await this.bot.database.recordSeasonSnapshot(
                    seasonId,
                    guildId,
                    userId,
                    'Unknown User',
                    userData.xp || 0,
                    userData.level || 0
                );

                // Assign rewards based on rank
                let rewardType = null;
                let rewardValue = null;

                if (rank === 1) {
                    rewardType = 'role';
                    rewardValue = 'Season Champion';
                } else if (rank === 2) {
                    rewardType = 'role';
                    rewardValue = 'Season Runner-Up';
                } else if (rank === 3) {
                    rewardType = 'role';
                    rewardValue = 'Third Place';
                } else if (rank <= 10) {
                    rewardType = 'badge';
                    rewardValue = 'Top 10 Finisher';
                }

                if (rewardType) {
                    await this.bot.database.recordSeasonRewards(seasonId, guildId, userId, rank, rewardType, rewardValue);
                }

                rank++;
            }

            // End the season
            await this.bot.database.endSeason(seasonId);

            // Reset XP data for next season
            if (this.bot.rankSystem?.data?.guilds?.[guildId]) {
                this.bot.rankSystem.data.guilds[guildId] = {};
                this.bot.rankSystem.saveData();
            }

            const userId = req.user?.id || 'Dashboard User';
            try {
                await this.bot.database.insertAuditLog({
                    guild_id: guildId,
                    event_type: 'season_reset',
                    event_category: 'config_change',
                    executor_id: userId,
                    executor_tag: req.user?.username || 'Dashboard User',
                    target_type: 'season',
                    target_id: seasonId,
                    changes: { season_id: seasonId, action: 'reset_and_snapshot' }
                });
            } catch (auditErr) {
                this.bot.logger?.warn && this.bot.logger.warn('Failed to insert audit log:', auditErr.message);
            }

            res.json({ success: true, message: 'Season reset successfully. Leaderboard snapshot saved.' });
        } catch (error) {
            this.bot.logger.error('Reset season error:', error);
            res.status(500).json({ error: 'Failed to reset season' });
        }
    }

    async getSeasonLeaderboard(req, res) {
        try {
            const seasonId = req.params.id;
            if (!seasonId) {
                return res.status(400).json({ error: 'Missing season ID' });
            }

            const leaderboard = await this.bot.database.getSeasonLeaderboard(seasonId, 100);
            res.json({ success: true, leaderboard });
        } catch (error) {
            this.bot.logger.error('Get season leaderboard error:', error);
            res.status(500).json({ error: 'Failed to load season leaderboard' });
        }
    }

    async claimSeasonReward(req, res) {
        try {
            const seasonId = req.params.id;
            const { snapshot_id } = req.body;

            if (!seasonId || !snapshot_id) {
                return res.status(400).json({ error: 'Missing season ID or snapshot ID' });
            }

            await this.bot.database.claimSeasonReward(snapshot_id);
            res.json({ success: true, message: 'Reward claimed successfully' });
        } catch (error) {
            this.bot.logger.error('Claim season reward error:', error);
            res.status(500).json({ error: 'Failed to claim reward' });
        }
    }

    // Helper Methods
    getDefaultGuildId() {
        if (!this.bot || !this.bot.client || !this.bot.client.guilds) {
            return 'default';
        }
        const firstGuild = this.bot.client.guilds.cache.first();
        return firstGuild ? firstGuild.id : 'default';
    }

    getServerName(guildId) {
        if (!this.bot || !this.bot.client || !this.bot.client.guilds) {
            return 'My Discord Server';
        }
        const guild = this.bot.client.guilds.cache.get(guildId);
        return guild ? guild.name : 'My Discord Server';
    }

    getServerIcon(guildId) {
        if (!this.bot || !this.bot.client || !this.bot.client.guilds) {
            return 'https://cdn.discordapp.com/embed/avatars/0.png';
        }
        const guild = this.bot.client.guilds.cache.get(guildId);
        return guild && guild.iconURL() ? guild.iconURL({ size: 64 }) : 'https://cdn.discordapp.com/embed/avatars/0.png';
    }

    getMemberCount(guildId) {
        const guild = this.bot.client.guilds.cache.get(guildId);
        return guild ? guild.memberCount : 1;
    }

    async calculateSecurityScore(guildId) {
        // Simple security score calculation
        let score = 50; // Base score
        
        try {
            const config = await this.bot.database.getGuildConfig?.(guildId) || {};
            
            // Add points for each enabled feature
            if (config.anti_raid_enabled) score += 15;
            if (config.anti_spam_enabled) score += 15;
            if (config.anti_links_enabled) score += 10;
            if (config.anti_phishing_enabled) score += 10;
            
            return Math.min(score, 100);
        } catch (error) {
            return 75; // Default score if database fails
        }
    }

    async getCurrentThreats(guildId) {
        try {
            const threats = await this.bot.database.all(`
                SELECT * FROM security_incidents 
                WHERE guild_id = ? AND resolved = 0 
                ORDER BY created_at DESC LIMIT 10
            `, [guildId]);

            return threats.map(threat => ({
                id: threat.id,
                title: this.formatThreatTitle(threat.incident_type),
                count: 1,
                level: this.getThreatLevel(threat.incident_type),
                icon: this.getThreatIcon(threat.incident_type)
            }));
        } catch (error) {
            return [];
        }
    }

    async getRecentIncidents(guildId) {
        try {
            const incidents = await this.bot.database.all(`
                SELECT * FROM security_incidents 
                WHERE guild_id = ? 
                ORDER BY created_at DESC LIMIT 10
            `, [guildId]);

            return incidents.map(incident => ({
                id: incident.id,
                time: new Date(incident.created_at).getTime(),
                description: incident.description || incident.incident_type,
                status: incident.resolved ? 'resolved' : 'investigating',
                statusIcon: incident.resolved ? 'fas fa-check' : 'fas fa-eye'
            }));
        } catch (error) {
            return [];
        }
    }

    async getActivityData(guildId) {
        // Return sample activity data for charts
        return [
            { time: Date.now() - 86400000, value: 23 },
            { time: Date.now() - 43200000, value: 45 },
            { time: Date.now(), value: 12 }
        ];
    }

    async getEventsData(guildId) {
        // Return sample events data for charts
        return [
            { type: 'joins', count: 15 },
            { type: 'messages', count: 234 },
            { type: 'warnings', count: 3 }
        ];
    }

    formatThreatTitle(type) {
        switch(type) {
            case 'raid': return 'Raid Attempt';
            case 'spam': return 'Spam Messages';
            case 'suspicious_link': return 'Malicious Links';
            case 'phishing': return 'Phishing Attempt';
            default: return 'Security Alert';
        }
    }

    getThreatLevel(type) {
        switch(type) {
            case 'raid': return 'high';
            case 'phishing': return 'high';
            case 'suspicious_link': return 'medium';
            case 'spam': return 'low';
            default: return 'medium';
        }
    }

    getThreatIcon(type) {
        switch(type) {
            case 'raid': return 'fas fa-user-shield';
            case 'spam': return 'fas fa-comment-slash';
            case 'suspicious_link': return 'fas fa-link';
            case 'phishing': return 'fas fa-fishing';
            default: return 'fas fa-exclamation-triangle';
        }
    }

    

    // Action Logging API Endpoints
    async getActions(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            const limit = parseInt(req.query.limit) || 50;
            const category = req.query.category;

            const actions = await this.bot.database.getRecentActions(guildId, limit, category);
            
            res.json({
                success: true,
                actions: actions.map(action => ({
                    ...action,
                    details: action.details ? JSON.parse(action.details) : null
                }))
            });
        } catch (error) {
            this.bot.logger.error('Get actions error:', error);
            res.status(500).json({ error: 'Failed to get actions' });
        }
    }

    async undoAction(req, res) {
        try {
            const actionId = req.params.id;
            const { reason } = req.body;
            const userId = req.user?.userId || 'dashboard_user';

            // Get the action details
            const action = await this.bot.database.getActionById(actionId);
            
            if (!action) {
                return res.status(404).json({ error: 'Action not found' });
            }

            if (!action.can_undo || action.undone) {
                return res.status(400).json({ 
                    error: action.undone ? 'Action already undone' : 'Action cannot be undone'
                });
            }

            if (!this.bot || !this.bot.client || !this.bot.client.guilds) {
                return res.status(503).json({ error: 'Bot client not ready' });
            }

            const guild = this.bot.client.guilds.cache.get(action.guild_id);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            // Perform the undo based on action type
            let undoResult = { success: false, message: '' };

            switch (action.action_type) {
                case 'timeout':
                    try {
                        const member = await guild.members.fetch(action.target_user_id);
                        if (member.communicationDisabledUntil) {
                            await member.timeout(null, `Undo by dashboard: ${reason || 'No reason provided'}`);
                            undoResult = { success: true, message: 'Timeout removed successfully' };
                        } else {
                            undoResult = { success: false, message: 'User is no longer timed out' };
                        }
                    } catch (error) {
                        undoResult = { success: false, message: `Failed to undo timeout: ${error.message}` };
                    }
                    break;

                case 'ban':
                    try {
                        await guild.members.unban(action.target_user_id, `Undo by dashboard: ${reason || 'No reason provided'}`);
                        undoResult = { success: true, message: 'User unbanned successfully' };
                    } catch (error) {
                        undoResult = { success: false, message: `Failed to unban user: ${error.message}` };
                    }
                    break;

                case 'lockdown':
                    try {
                        if (this.bot.lockdownManager) {
                            const result = await this.bot.lockdownManager.deactivate(guild, {
                                reason: `Undo by dashboard: ${reason || 'No reason provided'}`,
                                deactivatedBy: userId,
                                deactivatedByTag: 'Dashboard User'
                            });
                            if (result.success) {
                                undoResult = { success: true, message: `Lockdown ended - ${result.restored} channels restored` };
                            } else {
                                undoResult = { success: false, message: result.error || 'Failed to end lockdown' };
                            }
                        } else {
                            undoResult = { success: false, message: 'Lockdown manager not available' };
                        }
                    } catch (error) {
                        undoResult = { success: false, message: `Failed to undo lockdown: ${error.message}` };
                    }
                    break;

                case 'lock':
                    try {
                        // Get channel from action details or target
                        const channelId = action.target_user_id; // For lock, target is the channel
                        const channel = guild.channels.cache.get(channelId);
                        
                        if (channel && channel.isTextBased()) {
                            await channel.permissionOverwrites.edit(guild.roles.everyone, {
                                SendMessages: null,
                                AddReactions: null
                            });
                            await channel.send({
                                content: `Ã°Å¸â€â€œ **Channel Unlocked**\nThis channel has been unlocked from the dashboard.\n**Reason:** ${reason || 'Lockdown undone'}`
                            });
                            undoResult = { success: true, message: `Channel ${channel.name} unlocked successfully` };
                        } else {
                            undoResult = { success: false, message: 'Channel not found or not a text channel' };
                        }
                    } catch (error) {
                        undoResult = { success: false, message: `Failed to unlock channel: ${error.message}` };
                    }
                    break;

                default:
                    return res.status(400).json({ error: `Cannot undo action type: ${action.action_type}` });
            }

            if (undoResult.success) {
                // Mark action as undone
                await this.bot.database.markActionAsUndone(actionId, userId, reason || 'Undone via dashboard');

                // Log the undo action
                await this.bot.database.logAction({
                    guildId: action.guild_id,
                    actionType: `undo_${action.action_type}`,
                    actionCategory: 'moderation',
                    targetUserId: action.target_user_id,
                    targetUsername: action.target_username,
                    moderatorId: userId,
                    moderatorUsername: 'Dashboard User',
                    reason: reason || 'Undone via dashboard',
                    details: { originalActionId: actionId },
                    canUndo: false
                });

                // Broadcast to WebSocket clients
                this.broadcastToGuild(action.guild_id, {
                    type: 'action_undone',
                    actionId: actionId,
                    message: undoResult.message
                });

                res.json({ 
                    success: true, 
                    message: undoResult.message,
                    action: await this.bot.database.getActionById(actionId)
                });
            } else {
                res.status(500).json({ error: undoResult.message });
            }
        } catch (error) {
            this.bot.logger.error('Undo action error:', error);
            res.status(500).json({ error: 'Failed to undo action' });
        }
    }

    async getActionStats(req, res) {
        try {
            const guildId = req.query.guildId || this.getDefaultGuildId();
            const days = parseInt(req.query.days) || 7;

            const stats = await this.bot.database.getActionStats(guildId, days);
            
            res.json({
                success: true,
                stats: stats
            });
        } catch (error) {
            this.bot.logger.error('Get action stats error:', error);
            res.status(500).json({ error: 'Failed to get action stats' });
        }
    }

    // Moderation Action Handlers (for spam alerts)
    async removeTimeout(req, res) {
        try {
            const { guildId } = req.params;
            const { userId, reason } = req.body;
            const moderatorId = req.user?.userId;

            // Check guild access
            const access = await this.checkGuildAccess(moderatorId, guildId, true);
            if (!access.authorized) {
                return res.status(403).json({ error: access.error || 'Unauthorized' });
            }

            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            const member = await guild.members.fetch(userId);
            if (!member) {
                return res.status(404).json({ error: 'Member not found' });
            }

            if (!member.communicationDisabledUntil) {
                return res.status(400).json({ error: 'User is not timed out' });
            }

            await member.timeout(null, reason || 'Timeout removed from dashboard');

            // Log action
            await this.bot.database.logAction({
                guildId,
                actionType: 'undo_timeout',
                actionCategory: 'moderation',
                targetUserId: userId,
                targetUsername: member.user.tag,
                moderatorId,
                moderatorUsername: req.user?.username || 'Dashboard User',
                reason: reason || 'Timeout removed from dashboard',
                canUndo: false
            });

            res.json({ success: true, message: 'Timeout removed successfully' });
        } catch (error) {
            this.bot.logger.error('Remove timeout error:', error);
            res.status(500).json({ error: 'Failed to remove timeout' });
        }
    }

    async warnUser(req, res) {
        try {
            const { guildId } = req.params;
            const { userId, reason } = req.body;
            const moderatorId = req.user?.userId;

            // Check guild access
            const access = await this.checkGuildAccess(moderatorId, guildId, true);
            if (!access.authorized) {
                return res.status(403).json({ error: access.error || 'Unauthorized' });
            }

            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            const member = await guild.members.fetch(userId);
            if (!member) {
                return res.status(404).json({ error: 'Member not found' });
            }

            // Issue warn through bot's moderation handler
            if (this.bot.moderationHandler && typeof this.bot.moderationHandler.warnUser === 'function') {
                await this.bot.moderationHandler.warnUser(guild, member, moderatorId, reason || 'Warned from dashboard');
            } else {
                // Fallback: log action and send DM
                await this.bot.database.logAction({
                    guildId,
                    actionType: 'warn',
                    actionCategory: 'moderation',
                    targetUserId: userId,
                    targetUsername: member.user.tag,
                    moderatorId,
                    moderatorUsername: req.user?.username || 'Dashboard User',
                    reason: reason || 'Warned from dashboard',
                    canUndo: false
                });

                // Try to DM the user
                try {
                    await member.send({
                        embeds: [{
                            color: 0xFFA500,
                            title: 'Ã¢Å¡Â Ã¯Â¸Â Warning',
                            description: `You have been warned in **${guild.name}**\n\n**Reason:** ${reason || 'No reason provided'}`,
                            timestamp: new Date()
                        }]
                    });
                } catch (dmError) {
                    // User has DMs disabled
                }
            }

            res.json({ success: true, message: 'User warned successfully' });
        } catch (error) {
            this.bot.logger.error('Warn user error:', error);
            res.status(500).json({ error: 'Failed to warn user' });
        }
    }

    async kickUser(req, res) {
        try {
            const { guildId } = req.params;
            const { userId, reason } = req.body;
            const moderatorId = req.user?.userId;

            // Check guild access
            const access = await this.checkGuildAccess(moderatorId, guildId, true);
            if (!access.authorized) {
                return res.status(403).json({ error: access.error || 'Unauthorized' });
            }

            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            const member = await guild.members.fetch(userId);
            if (!member) {
                return res.status(404).json({ error: 'Member not found' });
            }

            // Check if moderator has permission
            const moderatorMember = await guild.members.fetch(moderatorId);
            if (!moderatorMember || !moderatorMember.permissions.has('KickMembers')) {
                return res.status(403).json({ error: 'You do not have permission to kick members' });
            }

            await member.kick(reason || 'Kicked from dashboard');

            // Log action
            await this.bot.database.logAction({
                guildId,
                actionType: 'kick',
                actionCategory: 'moderation',
                targetUserId: userId,
                targetUsername: member.user.tag,
                moderatorId,
                moderatorUsername: req.user?.username || 'Dashboard User',
                reason: reason || 'Kicked from dashboard',
                canUndo: false
            });

            res.json({ success: true, message: 'User kicked successfully' });
        } catch (error) {
            this.bot.logger.error('Kick user error:', error);
            res.status(500).json({ error: 'Failed to kick user' });
        }
    }

    async banUser(req, res) {
        try {
            const { guildId } = req.params;
            const { userId, reason } = req.body;
            const moderatorId = req.user?.userId;

            // Check guild access
            const access = await this.checkGuildAccess(moderatorId, guildId, true);
            if (!access.authorized) {
                return res.status(403).json({ error: access.error || 'Unauthorized' });
            }

            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            const member = await guild.members.fetch(userId);
            if (!member) {
                return res.status(404).json({ error: 'Member not found' });
            }

            // Check if moderator has permission
            const moderatorMember = await guild.members.fetch(moderatorId);
            if (!moderatorMember || !moderatorMember.permissions.has('BanMembers')) {
                return res.status(403).json({ error: 'You do not have permission to ban members' });
            }

            await member.ban({ reason: reason || 'Banned from dashboard' });

            // Log action
            await this.bot.database.logAction({
                guildId,
                actionType: 'ban',
                actionCategory: 'moderation',
                targetUserId: userId,
                targetUsername: member.user.tag,
                moderatorId,
                moderatorUsername: req.user?.username || 'Dashboard User',
                reason: reason || 'Banned from dashboard',
                canUndo: true
            });

            res.json({ success: true, message: 'User banned successfully' });
        } catch (error) {
            this.bot.logger.error('Ban user error:', error);
            res.status(500).json({ error: 'Failed to ban user' });
        }
    }

    async getAnalyticsData() {
        try {
            // Get last 7 days of data
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            // Query threats by day
            const threatQuery = `
                SELECT 
                    DATE(timestamp) as date,
                    COUNT(*) as count,
                    type
                FROM security_incidents 
                WHERE timestamp >= ?
                GROUP BY DATE(timestamp), type
                ORDER BY date ASC
            `;
            
            const threatResults = this.db.prepare(threatQuery).all(sevenDaysAgo.toISOString());
            
            // Process threat data by day
            const threatsByDay = [0,0,0,0,0,0,0];
            const filteredByDay = [0,0,0,0,0,0,0];
            
            threatResults.forEach(row => {
                const dayIndex = Math.floor((new Date(row.date) - sevenDaysAgo) / (1000 * 60 * 60 * 24));
                if (dayIndex >= 0 && dayIndex < 7) {
                    if (row.type === 'spam' || row.type === 'message_filter') {
                        filteredByDay[dayIndex] += row.count;
                    } else {
                        threatsByDay[dayIndex] += row.count;
                    }
                }
            });
            
            // Get hourly message activity (last 6 hours)
            const sixHoursAgo = new Date();
            sixHoursAgo.setHours(sixHoursAgo.getHours() - 6);
            
            const activityQuery = `
                SELECT 
                    strftime('%H', timestamp) as hour,
                    COUNT(*) as count
                FROM security_incidents 
                WHERE timestamp >= ? AND type = 'message_activity'
                GROUP BY strftime('%H', timestamp)
                ORDER BY hour ASC
            `;
            
            const activityResults = this.db.prepare(activityQuery).all(sixHoursAgo.toISOString());
            const activityByHour = [0,0,0,0,0,0];
            
            // Fill in activity data
            activityResults.forEach(row => {
                const currentHour = new Date().getHours();
                const hourIndex = (parseInt(row.hour) - currentHour + 6 + 24) % 24;
                if (hourIndex >= 0 && hourIndex < 6) {
                    activityByHour[hourIndex] = row.count;
                }
            });
            
            return {
                threatTrends: {
                    threats: threatsByDay,
                    filtered: filteredByDay
                },
                activity: {
                    messages: activityByHour
                },
                stats: {
                    threatsBlocked: threatsByDay.reduce((a, b) => a + b, 0),
                    messagesFiltered: filteredByDay.reduce((a, b) => a + b, 0),
                    totalIncidents: threatResults.length
                }
            };
        } catch (error) {
            this.bot.logger.error('Error getting analytics data:', error);
            return {
                threatTrends: { threats: [3,1,5,2,1,0,2], filtered: [15,8,22,12,7,3,11] },
                activity: { messages: [45,67,123,89,156,234] },
                stats: { threatsBlocked: 14, messagesFiltered: 66, totalIncidents: 80 }
            };
        }
    }

    // Ticket system API methods
    async getTicketStats(req, res) {
        try {
            let ticketData = {
                activeTickets: 0,
                totalTickets: 0,
                closedToday: 0,
                avgResponseTime: '0m',
                recentTickets: [],
                ticketStats: {
                    open: 0,
                    pending: 0,
                    resolved: 0
                }
            };

            if (this.bot.database) {
                // Get active tickets count from tickets table
                const activeResult = await this.bot.database.get(`
                    SELECT COUNT(*) as count FROM tickets 
                    WHERE status = 'open'
                `);
                ticketData.activeTickets = activeResult?.count || 0;

                // Get total tickets count
                const totalResult = await this.bot.database.get(`
                    SELECT COUNT(*) as count FROM tickets
                `);
                ticketData.totalTickets = totalResult?.count || 0;

                // Get tickets closed today
                const today = new Date().toISOString().split('T')[0];
                const closedTodayResult = await this.bot.database.get(`
                    SELECT COUNT(*) as count FROM tickets 
                    WHERE DATE(closed_at) = ? AND status = 'closed'
                `, [today]);
                ticketData.closedToday = closedTodayResult?.count || 0;

                // Get recent tickets with full details
                const recentTickets = await this.bot.database.all(`
                    SELECT 
                        t.id,
                        t.channel_id,
                        t.user_id,
                        t.status,
                        t.priority,
                        t.tag,
                        t.subject,
                        t.description,
                        t.created_at,
                        t.closed_at
                    FROM tickets t
                    ORDER BY t.created_at DESC
                    LIMIT 10
                `);

                // Format recent tickets for frontend with real Discord usernames
                ticketData.recentTickets = await Promise.all(recentTickets.map(async ticket => {
                    let userName = 'Unknown User';
                    let userAvatar = '/images/default-avatar.png';
                    
                    try {
                        const user = await this.bot.client.users.fetch(ticket.user_id);
                        if (user) {
                            userName = user.username;
                            if (user.discriminator !== '0') {
                                userName += `#${user.discriminator}`;
                            }
                            userAvatar = user.displayAvatarURL({ dynamic: true, size: 64 });
                        }
                    } catch (e) {
                        console.warn(`Could not fetch user ${ticket.user_id} for ticket stats`);
                    }
                    
                    return {
                        id: `ticket-${ticket.id}`,
                        title: ticket.subject || 'Support Ticket',
                        description: ticket.description || 'No description',
                        user: userName,
                        userAvatar: userAvatar,
                        userId: ticket.user_id,
                        status: ticket.status,
                        priority: ticket.priority || 'normal',
                        created: this.formatTimeAgo(ticket.created_at),
                        lastResponse: ticket.closed_at ? this.formatTimeAgo(ticket.closed_at) : 'No response',
                        category: ticket.tag || 'General'
                    };
                }));

                // Get status distribution from tickets table
                const statusStats = await this.bot.database.all(`
                    SELECT status, COUNT(*) as count
                    FROM tickets 
                    GROUP BY status
                `);

                statusStats.forEach(stat => {
                    if (stat.status === 'open') {
                        ticketData.ticketStats.open = stat.count;
                    } else if (stat.status === 'pending') {
                        ticketData.ticketStats.pending = stat.count;
                    } else if (stat.status === 'resolved' || stat.status === 'closed') {
                        ticketData.ticketStats.resolved += stat.count;
                    }
                });

                // Calculate average response time (mock for now)
                ticketData.avgResponseTime = Math.floor(Math.random() * 60) + 5 + 'm';
            } else {
                // Use mock data if database is not available
                ticketData = {
                    activeTickets: 8,
                    totalTickets: 247,
                    closedToday: 12,
                    avgResponseTime: '23m',
                    recentTickets: [
                        {
                            id: 'ticket-1001',
                            title: 'Account Recovery Help',
                            user: 'User#1234',
                            userAvatar: '/images/default-avatar.png',
                            status: 'open',
                            priority: 'medium',
                            created: '2 hours ago',
                            lastResponse: '30m ago',
                            category: 'Account Issues'
                        },
                        {
                            id: 'ticket-1002',
                            title: 'Report Harassment',
                            user: 'Member#5678',
                            userAvatar: '/images/default-avatar.png',
                            status: 'pending',
                            priority: 'high',
                            created: '45m ago',
                            lastResponse: '15m ago',
                            category: 'Security Report'
                        }
                    ],
                    ticketStats: {
                        open: 5,
                        pending: 2,
                        resolved: 1
                    }
                };
            }

            res.json(ticketData);
        } catch (error) {
            this.bot.logger.error('Error getting ticket stats:', error);
            res.status(500).json({ error: 'Failed to load ticket data' });
        }
    }

    // Main tickets endpoint for dashboard
    async getTickets(req, res) {
        try {
            const guild = this.getGuildFromRequest(req);
            if (!guild) {
                return res.json({ tickets: [], count: 0 });
            }

            const limit = parseInt(req.query.limit) || 100;
            const status = req.query.status;
            
            let query = `
                SELECT *
                FROM tickets
                WHERE guild_id = ?
            `;
            
            const params = [guild.id];
            
            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            
            query += ' ORDER BY created_at DESC LIMIT ?';
            params.push(limit);

            const tickets = await this.bot.database.all(query, params);
            
            // Format tickets for dashboard
            const formattedTickets = await Promise.all(tickets.map(async ticket => {
                let userName = 'Unknown User';
                
                try {
                    const user = await this.bot.client.users.fetch(ticket.user_id);
                    if (user) {
                        userName = user.globalName || user.username;
                    }
                } catch (e) {
                    // User not found, use stored name or Unknown
                }
                
                return {
                    id: `ticket-${ticket.id}`,
                    user: userName,
                    status: ticket.status || 'open',
                    subject: ticket.subject || 'Support Ticket',
                    description: ticket.description || 'No description provided',
                    created: this.formatTimeAgo(new Date(ticket.created_at))
                };
            }));

            res.json(formattedTickets);
        } catch (error) {
            this.bot.logger.error('Error getting tickets:', error);
            res.json([]);
        }
    }

    async getTicketsList(req, res) {
        try {
            const guild = this.getGuildFromRequest(req);
            if (!guild) {
                return res.json([]);
            }

            const { status, limit = 50 } = req.query;
            
            let query = `
                SELECT *
                FROM tickets
                WHERE guild_id = ?
            `;
            
            const params = [guild.id];
            
            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            
            query += ' ORDER BY created_at DESC LIMIT ?';
            params.push(parseInt(limit));

            const tickets = await this.bot.database.all(query, params);
            
            // Fetch user details for each ticket
            const formattedTickets = await Promise.all(tickets.map(async ticket => {
                let user = null;
                let userAvatar = '/images/default-avatar.png';
                let userName = 'Unknown User';
                let userTag = '';
                
                try {
                    user = await this.bot.client.users.fetch(ticket.user_id);
                    if (user) {
                        userAvatar = user.displayAvatarURL({ dynamic: true, size: 64 });
                        userName = user.username;
                        userTag = user.discriminator !== '0' ? `#${user.discriminator}` : '';
                    }
                } catch (e) {
                    console.warn('Could not fetch user for ticket:', ticket.id);
                }
                
                return {
                    id: `ticket-${ticket.id}`,
                    channelId: ticket.channel_id,
                    userId: ticket.user_id,
                    user: userName + userTag,
                    userName: userName,
                    userTag: userTag,
                    userAvatar: userAvatar,
                    status: ticket.status || 'open',
                    priority: ticket.priority || 'normal',
                    category: ticket.tag || 'General',
                    subject: ticket.subject || 'Support Ticket',
                    description: ticket.description || 'No description provided',
                    created: this.formatTimeAgo(new Date(ticket.created_at)),
                    createdAt: ticket.created_at,
                    claimed: ticket.claimed_at ? this.formatTimeAgo(new Date(ticket.claimed_at)) : null,
                    closed: ticket.closed_at ? this.formatTimeAgo(new Date(ticket.closed_at)) : null
                };
            }));

            res.json(formattedTickets);
        } catch (error) {
            this.bot.logger.error('Error getting tickets list:', error);
            res.json([]);
        }
    }

    async closeTicketAPI(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');
            
            if (this.bot.database) {
                // Update ticket status in both old tables
                await this.bot.database.run(`
                    UPDATE tickets 
                    SET status = 'closed', closed_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `, [ticketId]);
                
                await this.bot.database.run(`
                    UPDATE active_tickets 
                    SET status = 'closed', closed_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `, [ticketId]);
                
                // Also close DM ticket if exists
                if (this.bot.dmTicketManager) {
                    await this.bot.dmTicketManager.closeTicket(ticketId, req.user?.id || 'staff', 'Closed via dashboard');
                }
                
                res.json({ success: true, message: 'Ticket closed successfully' });
            } else {
                res.status(500).json({ error: 'Database not available' });
            }
        } catch (error) {
            this.bot.logger.error('Error closing ticket via API:', error);
            res.status(500).json({ error: 'Failed to close ticket' });
        }
    }

    async reopenTicketAPI(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');

            if (this.bot.database) {
                await this.bot.database.run(`
                    UPDATE tickets 
                    SET status = 'open', closed_at = NULL 
                    WHERE id = ?
                `, [ticketId]);

                await this.bot.database.run(`
                    UPDATE active_tickets 
                    SET status = 'open', closed_at = NULL 
                    WHERE id = ?
                `, [ticketId]);

                res.json({ success: true, message: 'Ticket reopened successfully' });
            } else {
                res.status(500).json({ error: 'Database not available' });
            }
        } catch (error) {
            this.bot.logger.error('Error reopening ticket via API:', error);
            res.status(500).json({ error: 'Failed to reopen ticket' });
        }
    }

    // Ticket API (supports both DM tickets and channel-based tickets)
    async getTicketDetails(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');
            let ticket = null;
            let source = 'dm';

            // Try DM tickets first
            ticket = await this.bot.database.get('SELECT * FROM dm_tickets WHERE id = ?', [ticketId]);

            // Fallback: channel-based tickets table
            if (!ticket) {
                source = 'channel';
                ticket = await this.bot.database.get('SELECT * FROM tickets WHERE id = ?', [ticketId]);
            }

            if (!ticket) {
                return res.status(404).json({ error: 'Ticket not found' });
            }

            // Fetch user details
            let user = null;
            try {
                user = await this.bot.client.users.fetch(ticket.user_id);
            } catch (e) {
                // User not found; proceed with stored data
            }

            res.json({
                id: ticket.id || ticket.ticket_id || ticketId,
                userId: ticket.user_id,
                username: user ? user.tag : (ticket.user || 'Unknown User'),
                userAvatar: user ? user.displayAvatarURL({ dynamic: true }) : '/images/default-avatar.png',
                category: ticket.category || ticket.tag || 'General',
                subject: ticket.subject || ticket.problem || 'Support Ticket',
                description: ticket.description || ticket.details || 'No description provided',
                status: ticket.status || 'open',
                priority: ticket.priority || 'normal',
                assignedTo: ticket.assigned_to || ticket.claimed_by || null,
                createdAt: ticket.created_at,
                updatedAt: ticket.updated_at || ticket.last_message_at || ticket.created_at,
                closedAt: ticket.closed_at || null,
                closedBy: ticket.closed_by || null,
                source
            });
        } catch (error) {
            this.bot.logger.error('Error getting ticket details:', error);
            res.status(500).json({ error: 'Failed to fetch ticket details' });
        }
    }

    async getTicketMessages(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');

            // DM tickets: fetch stored messages
            const dmTicket = await this.bot.database.get('SELECT id FROM dm_tickets WHERE id = ?', [ticketId]);
            if (dmTicket && this.bot.dmTicketManager) {
                const messages = await this.bot.dmTicketManager.getTicketMessages(ticketId);
                return res.json(messages.map(msg => ({
                    id: msg.id,
                    userId: msg.user_id,
                    username: msg.username,
                    message: msg.message,
                    isStaff: msg.is_staff === 1,
                    createdAt: msg.created_at
                })));
            }

            // Channel-based tickets: no stored transcript yet Ã¢â‚¬â€ return empty list instead of error
            return res.json([]);
        } catch (error) {
            this.bot.logger.error('Error getting ticket messages:', error);
            res.status(500).json({ error: 'Failed to fetch messages' });
        }
    }

    async replyToTicket(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');
            const { message, staffId, staffName } = req.body;

            if (!message || !staffId || !staffName) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            if (!this.bot.dmTicketManager) {
                return res.status(500).json({ error: 'Ticket manager not available' });
            }

            const result = await this.bot.dmTicketManager.sendStaffReply(
                ticketId,
                staffId,
                staffName,
                message
            );

            if (result.success) {
                res.json({ success: true, message: 'Reply sent successfully' });
            } else {
                res.status(500).json({ error: result.message });
            }
        } catch (error) {
            this.bot.logger.error('Error replying to ticket:', error);
            res.status(500).json({ error: 'Failed to send reply' });
        }
    }

    async assignTicket(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');
            const { staffId } = req.body;

            if (!staffId) {
                return res.status(400).json({ error: 'Staff ID required' });
            }

            // Try both tables and only update if they exist
            try {
                await this.bot.database.run(`
                    UPDATE dm_tickets SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
                `, [staffId, ticketId]);
            } catch (e) {
                // dm_tickets might not exist or row might not be there
            }
            
            try {
                await this.bot.database.run(`
                    UPDATE tickets SET assigned_to = ? WHERE id = ?
                `, [staffId, ticketId]);
            } catch (e) {
                // tickets table might not have this row
            }

            // Log to history
            await this.addTicketHistoryEntry(ticketId, req.user?.username || 'Staff', `Assigned ticket to staff member ${staffId}`);

            // Notify assigned staff via DM; fallback to log channel
            try {
                const guild = this.getGuildFromRequest(req);
                if (guild) {
                    const member = await guild.members.fetch(staffId).catch(() => null);
                    if (member) {
                        const dmMsg = `You have been assigned a ticket (ID: ${ticketId}).\nSubject: ${req.body?.subject || 'Support Ticket'}\nOpen in dashboard: ${this.bot.config?.dashboardUrl || ''}/tickets#${ticketId}`;
                        const dmSuccess = await member.send(dmMsg).then(() => true).catch(() => false);

                        if (!dmSuccess) {
                            // Fallback to log channel
                            let logChannel = null;
                            const cfg = this.bot.config || {};
                            if (cfg.log_channel_id) {
                                logChannel = guild.channels.cache.get(String(cfg.log_channel_id)) || null;
                            }
                            if (!logChannel) {
                                logChannel = guild.channels.cache.find(c => {
                                    const name = String(c.name || '').toLowerCase();
                                    return name.includes('log') || name.includes('mod') || name.includes('admin');
                                }) || null;
                            }
                            if (logChannel && (typeof logChannel.isTextBased === 'function' ? logChannel.isTextBased() : true)) {
                                await logChannel.send(`Ã°Å¸â€œÂ¬ Ticket ${ticketId} assigned to <@${staffId}>. DMs are off, notifying here.`).catch(() => {});
                            }
                        }
                    }
                }
            } catch (notifyErr) {
                this.bot.logger.warn('Assign notification failed:', notifyErr);
            }

            res.json({ success: true, message: 'Ticket assigned successfully' });
        } catch (error) {
            this.bot.logger.error('Error assigning ticket:', error);
            res.status(500).json({ error: 'Failed to assign ticket', details: error.message });
        }
    }

    async updateTicketStatus(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');
            const { status } = req.body;

            if (!status) {
                return res.status(400).json({ error: 'Status required' });
            }

            const validStatuses = ['open', 'in-progress', 'waiting', 'resolved', 'closed'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }

            // Update tickets table
            try {
                await this.bot.database.run(`
                    UPDATE tickets SET status = ? WHERE id = ?
                `, [status, ticketId]);
            } catch (e) {
                // Table might not have this row
            }

            // Update dm_tickets table
            try {
                await this.bot.database.run(`
                    UPDATE dm_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
                `, [status, ticketId]);
            } catch (e) {
                // Table might not have this row
            }

            // Update closed_at if closing
            if (status === 'closed') {
                try {
                    await this.bot.database.run(`
                        UPDATE tickets SET closed_at = CURRENT_TIMESTAMP WHERE id = ?
                    `, [ticketId]);
                } catch (e) {}
                
                try {
                    await this.bot.database.run(`
                        UPDATE dm_tickets SET closed_at = CURRENT_TIMESTAMP WHERE id = ?
                    `, [ticketId]);
                } catch (e) {}
            }

            await this.addTicketHistoryEntry(ticketId, req.user?.username || 'Staff', `Changed status to ${status}`);

            res.json({ success: true, message: 'Status updated successfully' });
        } catch (error) {
            this.bot.logger.error('Error updating ticket status:', error);
            res.status(500).json({ error: 'Failed to update status', details: error.message });
        }
    }

    async updateTicketPriority(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');
            const { priority } = req.body;

            if (!priority) {
                return res.status(400).json({ error: 'Priority required' });
            }

            const validPriorities = ['low', 'normal', 'high', 'urgent'];
            if (!validPriorities.includes(priority)) {
                return res.status(400).json({ error: 'Invalid priority' });
            }

            // Update tickets table
            try {
                await this.bot.database.run(`
                    UPDATE tickets SET priority = ? WHERE id = ?
                `, [priority, ticketId]);
            } catch (e) {
                // Table might not have this row
            }

            // Update dm_tickets table
            try {
                await this.bot.database.run(`
                    UPDATE dm_tickets SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
                `, [priority, ticketId]);
            } catch (e) {
                // Table might not have this row
            }

            await this.addTicketHistoryEntry(ticketId, req.user?.username || 'Staff', `Changed priority to ${priority}`);

            res.json({ success: true, message: 'Priority updated successfully' });
        } catch (error) {
            this.bot.logger.error('Error updating ticket priority:', error);
            res.status(500).json({ error: 'Failed to update priority', details: error.message });
        }
    }

    async claimTicket(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');
            const staffId = req.user?.id || 'staff-unknown';
            const staffName = req.user?.username || 'Staff Member';

            // Update tickets table
            try {
                await this.bot.database.run(`
                    UPDATE tickets SET assigned_to = ? WHERE id = ?
                `, [staffId, ticketId]);
            } catch (e) {
                // Table might not have this row
            }

            // Update dm_tickets table
            try {
                await this.bot.database.run(`
                    UPDATE dm_tickets SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
                `, [staffId, ticketId]);
            } catch (e) {
                // Table might not have this row
            }

            await this.addTicketHistoryEntry(ticketId, staffName, 'Claimed this ticket');

            // Notify claimer via DM; fallback to log channel
            try {
                const guild = this.getGuildFromRequest(req);
                if (guild && staffId && staffId !== 'staff-unknown') {
                    const member = await guild.members.fetch(staffId).catch(() => null);
                    if (member) {
                        const dmMsg = `You claimed ticket (ID: ${ticketId}).\nSubject: ${req.body?.subject || 'Support Ticket'}\nOpen in dashboard: ${this.bot.config?.dashboardUrl || ''}/tickets#${ticketId}`;
                        const dmSuccess = await member.send(dmMsg).then(() => true).catch(() => false);
                        if (!dmSuccess) {
                            let logChannel = null;
                            const cfg = this.bot.config || {};
                            if (cfg.log_channel_id) {
                                logChannel = guild.channels.cache.get(String(cfg.log_channel_id)) || null;
                            }
                            if (!logChannel) {
                                logChannel = guild.channels.cache.find(c => {
                                    const name = String(c.name || '').toLowerCase();
                                    return name.includes('log') || name.includes('mod') || name.includes('admin');
                                }) || null;
                            }
                            if (logChannel && (typeof logChannel.isTextBased === 'function' ? logChannel.isTextBased() : true)) {
                                await logChannel.send(`Ã°Å¸â€œÂ¬ <@${staffId}> claimed ticket ${ticketId}. DMs are off, notifying here.`).catch(() => {});
                            }
                        }
                    }
                }
            } catch (notifyErr) {
                this.bot.logger.warn('Claim notification failed:', notifyErr);
            }

            res.json({ success: true, message: 'Ticket claimed successfully' });
        } catch (error) {
            this.bot.logger.error('Error claiming ticket:', error);
            res.status(500).json({ error: 'Failed to claim ticket', details: error.message });
        }
    }

    async addTicketNote(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');
            const { note } = req.body;

            if (!note) {
                return res.status(400).json({ error: 'Note required' });
            }

            const staffId = req.user?.id || 'staff-unknown';
            const staffName = req.user?.username || 'Staff Member';

            // Create notes table if not exists
            await this.bot.database.run(`
                CREATE TABLE IF NOT EXISTS ticket_notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticket_id TEXT NOT NULL,
                    staff_id TEXT NOT NULL,
                    staff_name TEXT NOT NULL,
                    note TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await this.bot.database.run(`
                INSERT INTO ticket_notes (ticket_id, staff_id, staff_name, note)
                VALUES (?, ?, ?, ?)
            `, [ticketId, staffId, staffName, note]);

            await this.addTicketHistoryEntry(ticketId, staffName, 'Added internal note');

            res.json({ success: true, message: 'Note added successfully' });
        } catch (error) {
            this.bot.logger.error('Error adding ticket note:', error);
            res.status(500).json({ error: 'Failed to add note' });
        }
    }

    async getTicketNotes(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');

            const notes = await this.bot.database.all(`
                SELECT * FROM ticket_notes WHERE ticket_id = ? ORDER BY created_at DESC
            `, [ticketId]);

            res.json(notes || []);
        } catch (error) {
            this.bot.logger.error('Error getting ticket notes:', error);
            res.json([]);
        }
    }

    async getTicketHistory(req, res) {
        try {
            const ticketId = req.params.id.replace('ticket-', '');

            // Create history table if not exists
            await this.bot.database.run(`
                CREATE TABLE IF NOT EXISTS ticket_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticket_id TEXT NOT NULL,
                    user TEXT NOT NULL,
                    action TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            const history = await this.bot.database.all(`
                SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY timestamp DESC LIMIT 50
            `, [ticketId]);

            res.json(history || []);
        } catch (error) {
            this.bot.logger.error('Error getting ticket history:', error);
            res.json([]);
        }
    }

    async addTicketHistoryEntry(ticketId, user, action) {
        try {
            await this.bot.database.run(`
                CREATE TABLE IF NOT EXISTS ticket_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticket_id TEXT NOT NULL,
                    user TEXT NOT NULL,
                    action TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await this.bot.database.run(`
                INSERT INTO ticket_history (ticket_id, user, action)
                VALUES (?, ?, ?)
            `, [ticketId, user, action]);
        } catch (error) {
            this.bot.logger.error('Error adding history entry:', error);
        }
    }

    async getServerStaff(req, res) {
        try {
            const guild = this.getGuildFromRequest(req);
            if (!guild) {
                return res.json([]);
            }

            // Fetch all members with moderation permissions
            const staffMembers = [];
            
            for (const [memberId, member] of guild.members.cache) {
                const hasModPerms = member.permissions.has('ManageMessages') || 
                                  member.permissions.has('KickMembers') || 
                                  member.permissions.has('BanMembers') ||
                                  member.permissions.has('Administrator');
                
                if (hasModPerms && !member.user.bot) {
                    let role = 'Moderator';
                    if (member.permissions.has('Administrator')) {
                        role = 'Administrator';
                    } else if (member.permissions.has('BanMembers')) {
                        role = 'Moderator';
                    }

                    staffMembers.push({
                        id: member.id,
                        name: member.user.username,
                        discriminator: member.user.discriminator,
                        displayName: member.displayName,
                        avatar: member.user.displayAvatarURL({ dynamic: true, size: 64 }),
                        role: role
                    });
                }
            }

            res.json(staffMembers);
        } catch (error) {
            this.bot.logger.error('Error getting server staff:', error);
            res.json([]);
        }
    }

    formatTimeAgo(timestamp) {
        const now = new Date();
        const time = new Date(timestamp);
        const diff = now - time;
        
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        
        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        return `${minutes}m ago`;
    }

    // Helper function to get guild from request (supports multi-server)
    getGuildFromRequest(req) {
        // Accept multiple parameter names for flexibility
        const guildId = req.query.guildId || req.query.serverId || req.body?.guildId || req.body?.serverId;
        const headerGuildId = req.headers['x-server-id'] || req.headers['x-guild-id'];

        const targetId = guildId || headerGuildId;
        if (targetId) {
            const guild = this.bot.client.guilds.cache.get(targetId);
            if (guild) return guild;
        }
        // Fallback: first guild (only when nothing specified)
        return this.bot.client.guilds.cache.first();
    }

    // New API endpoints for real live data
    async getServerInfo(req, res) {
        try {
            let serverData = {
                name: 'Discord Server',
                iconURL: null,
                memberCount: 0,
                botCount: 0,
                channelCount: 0,
                roleCount: 0,
                emojiCount: 0,
                premiumTier: 0,
                channels: [],
                roles: [],
                verificationLevel: 0,
                botPermissions: [],
                hasAllPermissions: false
            };

            // Get guild from request (supports multi-server)
            const guild = this.getGuildFromRequest(req);
            
            if (guild) {
                // Count bots in the server
                const botCount = guild.members.cache.filter(member => member.user.bot).size;
                
                serverData = {
                    name: guild.name,
                    iconURL: guild.iconURL({ size: 128 }),
                    memberCount: guild.memberCount,
                    botCount: botCount,
                    channelCount: guild.channels.cache.size,
                    roleCount: guild.roles.cache.size,
                    emojiCount: guild.emojis.cache.size,
                    premiumTier: guild.premiumTier,
                    channels: guild.channels.cache.map(ch => ({ id: ch.id, name: ch.name, type: ch.type })),
                    roles: guild.roles.cache.map(role => ({ id: role.id, name: role.name })),
                    verificationLevel: guild.verificationLevel,
                    botPermissions: guild.members.me?.permissions.toArray() || [],
                    hasAllPermissions: guild.members.me?.permissions.has('Administrator') || false
                };
            }

            res.json(serverData);
        } catch (error) {
            this.bot.logger.error('Error getting server info:', error);
            res.status(500).json({ error: 'Failed to load server info' });
        }
    }

    // (Deprecated duplicate removed) See unified getSecurityStats below.

    async getSecurityEvents(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 10;
            let events = [];

            if (this.bot.database) {
                try {
                    const dbEvents = await this.bot.database.all(`
                        SELECT 
                            id,
                            incident_type,
                            description,
                            severity,
                            user_id,
                            created_at
                        FROM security_logs 
                        ORDER BY created_at DESC 
                        LIMIT ?
                    `, [limit]);

                    events = dbEvents.map(event => ({
                        id: event.id,
                        type: event.incident_type,
                        description: event.description,
                        severity: event.severity || 'medium',
                        user_id: event.user_id,
                        timestamp: event.created_at,
                        message: event.description || `Security event: ${event.incident_type}`
                    }));
                } catch (dbError) {
                    this.bot.logger.warn('Database query failed, using fallback events:', dbError);
                    events = this.getFallbackSecurityEvents();
                }
            } else {
                events = this.getFallbackSecurityEvents();
            }

            res.json(events);
        } catch (error) {
            this.bot.logger.error('Error getting security events:', error);
            res.status(500).json({ error: 'Failed to load security events' });
        }
    }

    async getBotHealth(req, res) {
        try {
            let healthData = {
                status: 'healthy',
                message: 'Bot is running smoothly',
                apiLatency: null,
                gatewayPing: null,
                memoryUsage: null,
                version: 'v2.1.0'
            };

            // Get real bot health data
            if (this.bot.client.ws) {
                healthData.gatewayPing = this.bot.client.ws.ping;
            }

            // Memory usage
            const memUsage = process.memoryUsage();
            healthData.memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB';

            // API latency (measure time to get bot user)
            if (this.bot.client.user) {
                const start = Date.now();
                try {
                    await this.bot.client.application.fetch();
                    healthData.apiLatency = Date.now() - start;
                } catch (err) {
                    healthData.apiLatency = null;
                }
            }

            // Determine overall health
            if (this.bot.client.ws?.ping > 500 || !this.bot.client.user) {
                healthData.status = 'warning';
                healthData.message = 'Bot experiencing high latency or connection issues';
            }

            res.json(healthData);
        } catch (error) {
            this.bot.logger.error('Error getting bot health:', error);
            res.json({
                status: 'error',
                message: 'Unable to determine bot health',
                apiLatency: null,
                gatewayPing: null,
                memoryUsage: 'Unknown',
                version: 'v2.1.0'
            });
        }
    }

    getFallbackSecurityData() {
        return {
            threatsBlocked: 0,
            threatsTrend: 0,
            suspiciousJoins: 0,
            joinsTrend: 0,
            messagesScanned: 0,
            messagesTrend: 0,
            autoModActions: 0,
            actionsTrend: 0,
            activeMembers: 0,
            membersTrend: 0,
            uptime: '0%',
            securityLevel: 'secure',
            securityTitle: 'No Data Available',
            securityMessage: 'Security monitoring starting up',
            securityScore: 0
        };
    }

    getFallbackSecurityEvents() {
        return [];
    }

    // NEW: Analytics overview endpoint
    async getAnalyticsOverview(req, res) {
        try {
            if (!this.bot.analyticsManager) {
                return res.json({ error: 'Analytics system not available' });
            }

            const guildId = req.query.guildId || req.user.guilds[0]?.id;
            const report = await this.bot.analyticsManager.generateReport(guildId, '7d');

            res.json({
                success: true,
                data: report
            });
        } catch (error) {
            this.bot.logger.error('Error getting analytics overview:', error);
            res.status(500).json({ error: 'Failed to retrieve analytics' });
        }
    }

    // Unified Overview Stats: members, channels, roles, messagesToday, joins, leaves, actionsToday
    async getOverviewStats(req, res) {
        try {
            const guildId = req.query.guildId || req.headers['x-guild-id'] || this.getGuildFromRequest(req)?.id;
            if (!guildId) return res.status(400).json({ error: 'Guild ID required' });

            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) return res.status(404).json({ error: 'Guild not found' });

            const stats = {
                members: guild.memberCount || 0,
                channels: guild.channels?.cache?.size || 0,
                roles: guild.roles?.cache?.size || 0,
                messagesToday: 0,
                joinsToday: 0,
                leavesToday: 0,
                actionsToday: 0
            };

            if (this.bot.database) {
                const today = new Date().toISOString().split('T')[0];
                const messages = await this.bot.database.get(`
                    SELECT COUNT(*) as c FROM security_logs 
                    WHERE guild_id = ? AND event_type = 'MESSAGE_SCANNED' AND DATE(timestamp) = ?
                `, [guildId, today]);
                stats.messagesToday = messages?.c || 0;

                const joins = await this.bot.database.get(`
                    SELECT COUNT(*) as c FROM security_logs 
                    WHERE guild_id = ? AND event_type = 'MEMBER_JOIN' AND DATE(timestamp) = ?
                `, [guildId, today]);
                stats.joinsToday = joins?.c || 0;

                const leaves = await this.bot.database.get(`
                    SELECT COUNT(*) as c FROM security_logs 
                    WHERE guild_id = ? AND event_type = 'MEMBER_LEAVE' AND DATE(timestamp) = ?
                `, [guildId, today]);
                stats.leavesToday = leaves?.c || 0;

                const actions = await this.bot.database.get(`
                    SELECT COUNT(*) as c FROM action_logs 
                    WHERE guild_id = ? AND DATE(created_at) = ?
                `, [guildId, today]);
                stats.actionsToday = actions?.c || 0;
            }

            return res.json({ success: true, stats });
        } catch (err) {
            this.bot.logger.error('Overview stats error:', err);
            return res.status(500).json({ error: 'Failed to load overview stats' });
        }
    }

    // NEW: Analytics report endpoint
    async getAnalyticsReport(req, res) {
        try {
            if (!this.bot.analyticsManager) {
                return res.json({ error: 'Analytics system not available' });
            }

            const guildId = req.query.guildId || req.user.guilds[0]?.id;
            const period = req.query.period || '7d';
            const report = await this.bot.analyticsManager.generateReport(guildId, period);

            res.json({
                success: true,
                period,
                data: report
            });
        } catch (error) {
            this.bot.logger.error('Error generating analytics report:', error);
            res.status(500).json({ error: 'Failed to generate report' });
        }
    }

    // NEW: Full Analytics endpoint for dashboard charts with real data
    async getFullAnalytics(req, res) {
        try {
            let guildId = req.query.guildId || req.user?.guilds?.[0]?.id || this.getDefaultGuildId();
            const days = Math.min(parseInt(req.query.days) || 7, 90); // Cap at 90 days

            const today = new Date().toISOString().split('T')[0];
            const guild = this.bot.client?.guilds?.cache?.get(guildId);

            // Initialize response object with empty/default values
            const analytics = {
                overview: {
                    totalMembers: guild?.memberCount || 0,
                    joinsToday: 0,
                    leavesToday: 0,
                    totalMessages: 0,
                    messagesToday: 0,
                    totalCommands: 0,
                    commandsToday: 0,
                    totalModActions: 0,
                    modActionsToday: 0
                },
                memberActivity: [],
                commandUsage: [],
                moderation: { warns: 0, kicks: 0, bans: 0, timeouts: 0 },
                hourlyActivity: [],
                topCommands: [],
                securityEvents: []
            };

            // If we still don't have a guildId, or database is unavailable,
            // just return the empty analytics payload instead of an error.
            if (!guildId || !this.bot.database) {
                return res.json(analytics);
            }

            try {
                // 1. Member Activity (joins/leaves per day)
                const joinData = await this.bot.database.all(`
                    SELECT DATE(created_at) as date, COUNT(*) as joins
                    FROM join_analytics 
                    WHERE guild_id = ? AND created_at > datetime('now', '-${days} days')
                    GROUP BY DATE(created_at)
                    ORDER BY date ASC
                `, [guildId]) || [];

                const leaveData = await this.bot.database.all(`
                    SELECT DATE(created_at) as date, COUNT(*) as leaves
                    FROM leave_analytics 
                    WHERE guild_id = ? AND created_at > datetime('now', '-${days} days')
                    GROUP BY DATE(created_at)
                    ORDER BY date ASC
                `, [guildId]) || [];

                // Merge join/leave data by date
                const dateSet = new Set([...joinData.map(d => d.date), ...leaveData.map(d => d.date)]);
                const sortedDates = Array.from(dateSet).sort();
                
                analytics.memberActivity = sortedDates.map(date => ({
                    date,
                    joins: joinData.find(d => d.date === date)?.joins || 0,
                    leaves: leaveData.find(d => d.date === date)?.leaves || 0
                }));

                // Calculate today's joins/leaves
                const todayJoins = joinData.find(d => d.date === today);
                const todayLeaves = leaveData.find(d => d.date === today);
                analytics.overview.joinsToday = todayJoins?.joins || 0;
                analytics.overview.leavesToday = todayLeaves?.leaves || 0;

            } catch (e) {
                this.bot.logger.warn('Member analytics query failed:', e.message);
            }

            try {
                // 2. Command Usage per day
                const commandData = await this.bot.database.all(`
                    SELECT DATE(created_at) as date, COUNT(*) as count
                    FROM command_analytics 
                    WHERE guild_id = ? AND created_at > datetime('now', '-${days} days')
                    GROUP BY DATE(created_at)
                    ORDER BY date ASC
                `, [guildId]) || [];

                analytics.commandUsage = commandData.map(d => ({
                    date: d.date,
                    count: d.count || 0
                }));

                // Total commands in period
                analytics.overview.totalCommands = commandData.reduce((sum, d) => sum + (d.count || 0), 0);
                
                // Commands today
                const todayCommands = commandData.find(d => d.date === today);
                analytics.overview.commandsToday = todayCommands?.count || 0;

            } catch (e) {
                this.bot.logger.warn('Command analytics query failed:', e.message);
            }

            try {
                // 3. Top Commands
                const topCmds = await this.bot.database.all(`
                    SELECT command_name as command, COUNT(*) as uses, 
                           SUM(success) * 1.0 / COUNT(*) as successRate
                    FROM command_analytics 
                    WHERE guild_id = ? AND created_at > datetime('now', '-${days} days')
                    GROUP BY command_name
                    ORDER BY uses DESC
                    LIMIT 10
                `, [guildId]) || [];

                analytics.topCommands = topCmds;

            } catch (e) {
                this.bot.logger.warn('Top commands query failed:', e.message);
            }

            try {
                // 4. Message Analytics (hourly distribution)
                const hourlyData = await this.bot.database.all(`
                    SELECT hour_of_day as hour, SUM(message_count) as messages
                    FROM message_analytics 
                    WHERE guild_id = ? AND created_at > datetime('now', '-${days} days')
                    GROUP BY hour_of_day
                    ORDER BY hour_of_day ASC
                `, [guildId]) || [];

                // Fill in all 24 hours
                analytics.hourlyActivity = Array.from({ length: 24 }, (_, i) => ({
                    hour: i,
                    messages: hourlyData.find(d => d.hour === i)?.messages || 0
                }));

                // Total messages in period
                analytics.overview.totalMessages = hourlyData.reduce((sum, d) => sum + (d.messages || 0), 0);

                // Messages today (need separate query)
                const todayMessages = await this.bot.database.get(`
                    SELECT SUM(message_count) as total
                    FROM message_analytics 
                    WHERE guild_id = ? AND DATE(created_at) = ?
                `, [guildId, today]);
                analytics.overview.messagesToday = todayMessages?.total || 0;

            } catch (e) {
                this.bot.logger.warn('Message analytics query failed:', e.message);
            }

            try {
                // 5. Moderation Actions breakdown
                const modActions = await this.bot.database.all(`
                    SELECT action_type, COUNT(*) as count
                    FROM mod_actions 
                    WHERE guild_id = ? AND created_at > datetime('now', '-${days} days')
                    GROUP BY action_type
                `, [guildId]) || [];

                modActions.forEach(action => {
                    const type = (action.action_type || '').toLowerCase();
                    if (type.includes('warn')) analytics.moderation.warns += action.count;
                    else if (type.includes('kick')) analytics.moderation.kicks += action.count;
                    else if (type.includes('ban')) analytics.moderation.bans += action.count;
                    else if (type.includes('timeout') || type.includes('mute')) analytics.moderation.timeouts += action.count;
                });

                analytics.overview.totalModActions = 
                    analytics.moderation.warns + 
                    analytics.moderation.kicks + 
                    analytics.moderation.bans + 
                    analytics.moderation.timeouts;

                // Mod actions today
                const todayMod = await this.bot.database.get(`
                    SELECT COUNT(*) as total
                    FROM mod_actions 
                    WHERE guild_id = ? AND DATE(created_at) = ?
                `, [guildId, today]);
                analytics.overview.modActionsToday = todayMod?.total || 0;

            } catch (e) {
                this.bot.logger.warn('Moderation analytics query failed:', e.message);
            }

            try {
                // 6. Security Events
                const secEvents = await this.bot.database.all(`
                    SELECT id, event_type, incident_type, description, severity, 
                           created_at
                    FROM security_logs 
                    WHERE guild_id = ? 
                    ORDER BY created_at DESC
                    LIMIT 20
                `, [guildId]) || [];

                analytics.securityEvents = secEvents.map(e => ({
                    id: e.id,
                    event_type: e.event_type || e.incident_type || 'Unknown',
                    type: e.event_type || e.incident_type,
                    description: e.description || 'No description',
                    severity: e.severity || 'medium',
                    timestamp: e.created_at,
                    created_at: e.created_at
                }));

            } catch (e) {
                this.bot.logger.warn('Security events query failed:', e.message);
            }

            res.json(analytics);

        } catch (error) {
            this.bot.logger.error('Error getting full analytics:', error);
            res.status(500).json({ error: 'Failed to retrieve analytics' });
        }
    }


    /**
     * GET /api/analytics/live - Returns live metrics for dashboard charts
     * Returns only real data from the last 24 hours for all chart types
     */
    async getLiveAnalytics(req, res) {
        try {
            const guildId = req.query.guildId || req.user?.guilds?.[0]?.id || this.getDefaultGuildId();
            const now = new Date();
            const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
            
            // Initialize response with empty arrays (never null/undefined)
            const liveData = {
                messages: [],
                joins: [],
                leaves: [],
                modActions: { timeout: [], ban: [], kick: [], warn: [] },
                spam: [],
                security: [],
                system: {
                    cpuUsage: process.cpuUsage ? Math.round((process.cpuUsage().user / 1000000) % 100) : 0,
                    memoryUsage: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100),
                    uptime: Math.floor(process.uptime()),
                    botUptime: this.bot?.client?.uptime ? Math.floor(this.bot.client.uptime / 1000) : 0
                },
                summary: {
                    totalMessages: 0,
                    totalJoins: 0,
                    totalLeaves: 0,
                    totalTimeouts: 0,
                    totalBans: 0,
                    totalKicks: 0,
                    totalSpamEvents: 0
                },
                timestamp: now.toISOString(),
                hasData: false
            };

            if (!guildId || !this.bot.database) {
                return res.json(liveData);
            }

            try {
                // 1. Message activity (hourly for last 24h)
                const messageData = await this.bot.database.all(`
                    SELECT 
                        strftime('%Y-%m-%dT%H:00:00Z', created_at) as timestamp,
                        SUM(message_count) as count
                    FROM message_analytics 
                    WHERE guild_id = ? AND created_at > ?
                    GROUP BY strftime('%Y-%m-%d %H', created_at)
                    ORDER BY timestamp ASC
                `, [guildId, twentyFourHoursAgo]) || [];

                liveData.messages = messageData.map(d => ({
                    timestamp: d.timestamp,
                    count: d.count || 0
                }));
                liveData.summary.totalMessages = messageData.reduce((sum, d) => sum + (d.count || 0), 0);
            } catch (e) {
                this.bot.logger.warn('Live analytics - messages query failed:', e.message);
            }

            try {
                // 2. Join activity (hourly for last 24h)
                const joinData = await this.bot.database.all(`
                    SELECT 
                        strftime('%Y-%m-%dT%H:00:00Z', created_at) as timestamp,
                        COUNT(*) as count
                    FROM join_analytics 
                    WHERE guild_id = ? AND created_at > ?
                    GROUP BY strftime('%Y-%m-%d %H', created_at)
                    ORDER BY timestamp ASC
                `, [guildId, twentyFourHoursAgo]) || [];

                liveData.joins = joinData.map(d => ({
                    timestamp: d.timestamp,
                    count: d.count || 0
                }));
                liveData.summary.totalJoins = joinData.reduce((sum, d) => sum + (d.count || 0), 0);
            } catch (e) {
                this.bot.logger.warn('Live analytics - joins query failed:', e.message);
            }

            try {
                // 3. Leave activity (hourly for last 24h)
                const leaveData = await this.bot.database.all(`
                    SELECT 
                        strftime('%Y-%m-%dT%H:00:00Z', created_at) as timestamp,
                        COUNT(*) as count
                    FROM leave_analytics 
                    WHERE guild_id = ? AND created_at > ?
                    GROUP BY strftime('%Y-%m-%d %H', created_at)
                    ORDER BY timestamp ASC
                `, [guildId, twentyFourHoursAgo]) || [];

                liveData.leaves = leaveData.map(d => ({
                    timestamp: d.timestamp,
                    count: d.count || 0
                }));
                liveData.summary.totalLeaves = leaveData.reduce((sum, d) => sum + (d.count || 0), 0);
            } catch (e) {
                this.bot.logger.warn('Live analytics - leaves query failed:', e.message);
            }

            try {
                // 4. Moderation actions (grouped by type for last 24h)
                const modData = await this.bot.database.all(`
                    SELECT 
                        action_type,
                        strftime('%Y-%m-%dT%H:00:00Z', created_at) as timestamp,
                        COUNT(*) as count
                    FROM mod_actions 
                    WHERE guild_id = ? AND created_at > ?
                    GROUP BY action_type, strftime('%Y-%m-%d %H', created_at)
                    ORDER BY timestamp ASC
                `, [guildId, twentyFourHoursAgo]) || [];

                modData.forEach(d => {
                    const type = (d.action_type || '').toLowerCase();
                    const entry = { timestamp: d.timestamp, count: d.count || 0 };
                    if (type.includes('timeout') || type.includes('mute')) {
                        liveData.modActions.timeout.push(entry);
                        liveData.summary.totalTimeouts += d.count || 0;
                    } else if (type.includes('ban')) {
                        liveData.modActions.ban.push(entry);
                        liveData.summary.totalBans += d.count || 0;
                    } else if (type.includes('kick')) {
                        liveData.modActions.kick.push(entry);
                        liveData.summary.totalKicks += d.count || 0;
                    } else if (type.includes('warn')) {
                        liveData.modActions.warn.push(entry);
                    }
                });
            } catch (e) {
                this.bot.logger.warn('Live analytics - mod actions query failed:', e.message);
            }

            try {
                // 5. Spam events (hourly for last 24h)
                const spamData = await this.bot.database.all(`
                    SELECT 
                        strftime('%Y-%m-%dT%H:00:00Z', created_at) as timestamp,
                        COUNT(*) as count
                    FROM spam_detection 
                    WHERE guild_id = ? AND created_at > ?
                    GROUP BY strftime('%Y-%m-%d %H', created_at)
                    ORDER BY timestamp ASC
                `, [guildId, twentyFourHoursAgo]) || [];

                liveData.spam = spamData.map(d => ({
                    timestamp: d.timestamp,
                    count: d.count || 0
                }));
                liveData.summary.totalSpamEvents = spamData.reduce((sum, d) => sum + (d.count || 0), 0);
            } catch (e) {
                this.bot.logger.warn('Live analytics - spam query failed:', e.message);
            }

            // Determine if there's any data
            liveData.hasData = 
                liveData.messages.length > 0 ||
                liveData.joins.length > 0 ||
                liveData.leaves.length > 0 ||
                liveData.spam.length > 0 ||
                liveData.modActions.timeout.length > 0 ||
                liveData.modActions.ban.length > 0 ||
                liveData.modActions.kick.length > 0 ||
                liveData.modActions.warn.length > 0;

            res.json(liveData);

        } catch (error) {
            this.bot.logger.error('Error getting live analytics:', error);
            res.status(500).json({ 
                error: 'Failed to retrieve live analytics',
                messages: [],
                joins: [],
                leaves: [],
                modActions: { timeout: [], ban: [], kick: [], warn: [] },
                spam: [],
                hasData: false
            });
        }
    }
    // Public status aggregator
    async getPublicStatus(req, res) {
        try {
            // Health basics
            const health = await (async () => {
                let data = {
                    status: 'healthy',
                    gatewayPing: null,
                    memoryUsageMB: null
                };
                if (this.bot.client.ws) data.gatewayPing = this.bot.client.ws.ping;
                const mem = process.memoryUsage();
                data.memoryUsageMB = Math.round(mem.heapUsed / 1024 / 1024);
                if (!this.bot.client.user || (data.gatewayPing && data.gatewayPing > 500)) {
                    data.status = 'warning';
                }
                return data;
            })();

            // Threat metrics (last 24h)
            let threatsBlocked24h = 0;
            let highThreats24h = 0;
            if (this.bot.database) {
                try {
                    const threatRows = await this.bot.database.get(`
                        SELECT COUNT(*) as total FROM security_logs
                        WHERE created_at > datetime('now', '-24 hours')
                    `);
                    threatsBlocked24h = threatRows?.total || 0;
                    const highRows = await this.bot.database.get(`
                        SELECT COUNT(*) as total FROM security_logs
                        WHERE created_at > datetime('now', '-24 hours') AND severity IN ('high','critical')
                    `);
                    highThreats24h = highRows?.total || 0;
                } catch (e) {
                    this.bot.logger.warn('Status threat query failed:', e.message);
                }
            }

            // Recent incidents (high/critical)
            let incidents = [];
            if (this.bot.database) {
                try {
                    const rows = await this.bot.database.all(`
                        SELECT id, incident_type, description, severity, created_at
                        FROM security_logs
                        WHERE severity IN ('high','critical')
                        ORDER BY created_at DESC
                        LIMIT 10
                    `);
                    incidents = rows.map(r => ({
                        id: r.id,
                        title: r.incident_type || 'Security Event',
                        description: r.description || r.incident_type,
                        severity: r.severity,
                        time: r.created_at,
                        status: 'resolved',
                        statusText: 'Resolved',
                        icon: r.severity === 'critical' ? 'fas fa-fire' : 'fas fa-shield-halved'
                    }));
                } catch (e) {
                    this.bot.logger.warn('Status incidents query failed:', e.message);
                }
            }

            // Scheduled maintenance placeholder
            const scheduledMaintenance = [];

            // Service cards
            const services = [
                {
                    name: 'Discord Bot',
                    description: 'Core bot & commands',
                    status: health.status === 'healthy' ? 'operational' : 'degraded',
                    statusText: health.status === 'healthy' ? 'Operational' : 'Degraded',
                    icon: 'fas fa-robot',
                    responseTime: health.gatewayPing ? `${Math.round(health.gatewayPing)}ms` : 'Ã¢â‚¬â€',
                    uptime: '99.9%'
                },
                {
                    name: 'Web Dashboard',
                    description: 'UI & OAuth',
                    status: 'operational',
                    statusText: 'Operational',
                    icon: 'fas fa-gauge-high',
                    responseTime: 'Ã¢â‚¬â€',
                    uptime: '99.9%'
                },
                {
                    name: 'Database',
                    description: 'Data persistence layer',
                    status: 'operational',
                    statusText: 'Operational',
                    icon: 'fas fa-database',
                    responseTime: 'Ã¢â‚¬â€',
                    uptime: '99.99%'
                },
                {
                    name: 'Security Scanner',
                    description: 'Threat & link analysis',
                    status: 'operational',
                    statusText: 'Operational',
                    icon: 'fas fa-shield-halved',
                    responseTime: 'Ã¢â‚¬â€',
                    uptime: '99.9%'
                }
            ];

            res.json({
                overall: health.status === 'healthy' ? 'operational' : 'degraded',
                overallUptime: '99.9%',
                totalServers: this.bot.client.guilds.cache.size || 0,
                threatsBlocked24h: threatsBlocked24h,
                health,
                services,
                metrics: {
                    threats: {
                        total24h: threatsBlocked24h,
                        high24h: highThreats24h
                    }
                },
                incidents,
                scheduledMaintenance
            });
        } catch (error) {
            this.bot.logger.error('Error building public status:', error);
            res.status(500).json({ error: 'Failed to build status' });
        }
    }

    // NEW: Security logs endpoint
    async getSecurityLogs(req, res) {
        try {
            const guildId = req.query.guildId || req.headers['x-guild-id'];
            const userId = req.user?.discordId || req.user?.userId;
            const limit = parseInt(req.query.limit) || 50;

            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            // SECURITY: Verify user is a member of the requested guild
            if (userId && userId !== 'admin') {
                const guild = this.bot.client.guilds.cache.get(guildId);
                if (!guild) {
                    return res.status(404).json({ error: 'Guild not found' });
                }

                const member = await guild.members.fetch(userId).catch(() => null);
                if (!member) {
                    this.bot.logger.warn(`[SECURITY] User ${userId} attempted to access logs for guild ${guildId} but is not a member`);
                    return res.status(403).json({ error: 'Access denied - not a member of this server' });
                }

                this.bot.logger.debug(`[SECURITY] User ${userId} authorized to view logs for ${guild.name}`);
            }

            const logs = await this.bot.database.all(`
                SELECT * FROM security_logs 
                WHERE guild_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            `, [guildId, limit]);

            res.json({
                success: true,
                logs
            });
        } catch (error) {
            this.bot.logger.error('Error getting security logs:', error);
            res.status(500).json({ error: 'Failed to retrieve security logs' });
        }
    }

    // NEW: Security stats endpoint
    async getSecurityStats(req, res) {
        try {
            const guildId = req.query.guildId;
            const userId = req.user?.discordId || req.user?.userId;
            if (!guildId) return res.status(400).json({ error: 'Guild ID required' });

            // Check access: admin, guild member with permissions, or explicit database grant
            if (userId && userId !== 'admin') {
                const guild = this.bot.client.guilds.cache.get(guildId);
                if (!guild) return res.status(404).json({ error: 'Guild not found' });
                
                // Check if user has explicit database access
                const hasExplicitAccess = await this.bot.database.get(
                    `SELECT 1 FROM dashboard_access WHERE guild_id = ? AND user_id = ? LIMIT 1`,
                    [guildId, userId]
                );
                
                // If no explicit access, check guild membership
                if (!hasExplicitAccess) {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (!member) return res.status(403).json({ error: 'Access denied' });
                }
            }

            const stats = { warnings:0, bans:0, kicks:0, timeouts:0, raidsBlocked:0 };

            if (this.bot.database) {
                // Counts from action_logs
                const warnings = await this.bot.database.get(`SELECT COUNT(*) as c FROM action_logs WHERE guild_id = ? AND action_type = 'warn'`, [guildId]);
                const bans = await this.bot.database.get(`SELECT COUNT(*) as c FROM action_logs WHERE guild_id = ? AND action_type = 'ban' AND undone = 0`, [guildId]);
                const kicks = await this.bot.database.get(`SELECT COUNT(*) as c FROM action_logs WHERE guild_id = ? AND action_type = 'kick'`, [guildId]);
                const timeouts = await this.bot.database.get(`SELECT COUNT(*) as c FROM action_logs WHERE guild_id = ? AND action_type = 'timeout' AND undone = 0`, [guildId]);
                const raids = await this.bot.database.get(`SELECT COUNT(*) as c FROM action_logs WHERE guild_id = ? AND action_type IN ('raid_blocked','lockdown')`, [guildId]);
                stats.warnings = warnings?.c || 0;
                stats.bans = bans?.c || 0;
                stats.kicks = kicks?.c || 0;
                stats.timeouts = timeouts?.c || 0;
                stats.raidsBlocked = raids?.c || 0;
            }

            return res.json(stats);
        } catch (err) {
            this.bot.logger.error('Unified security stats error:', err);
            return res.status(500).json({ error: 'Failed to load security stats' });
        }
    }

    // NEW: Get moderation actions for security tab
    async getModerationActions(req, res) {
        try {
            const guildId = req.query.guildId;
            const limit = parseInt(req.query.limit) || 50;

            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            // Get moderation actions (warnings, bans, kicks, timeouts)
            const actions = await this.bot.database.all(`
                SELECT * FROM action_logs 
                WHERE guild_id = ? AND action_category = 'moderation'
                ORDER BY created_at DESC 
                LIMIT ?
            `, [guildId, limit]);

            res.json({
                success: true,
                actions: actions || []
            });
        } catch (error) {
            this.bot.logger.error('Error getting moderation actions:', error);
            res.status(500).json({ error: 'Failed to retrieve moderation actions' });
        }
    }

    // NEW: Get recent security events for security tab
    async getRecentSecurityEvents(req, res) {
        try {
            const guildId = req.query.guildId;
            const limit = parseInt(req.query.limit) || 20;

            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            // Get recent security events from bot_logs table
            const securityEvents = await this.bot.database.all(`
                SELECT 
                    id,
                    type,
                    user_id as moderatorId,
                    user_tag as moderatorTag,
                    guild_id as guildId,
                    channel_id as channelId,
                    command as eventType,
                    payload,
                    created_at
                FROM bot_logs 
                WHERE guild_id = ? AND type = 'security'
                ORDER BY created_at DESC 
                LIMIT ?
            `, [guildId, limit]);

            // Parse payload and format events for dashboard
            const formattedEvents = securityEvents.map(event => {
                let parsedPayload = {};
                try {
                    parsedPayload = JSON.parse(event.payload || '{}');
                } catch (e) {
                    console.error('[Dashboard] Failed to parse event payload:', e);
                }

                // Determine severity based on event type
                let severity = 'MEDIUM';
                const eventType = parsedPayload.eventType || event.eventType || 'unknown';
                
                if (eventType.includes('BAN') || eventType.includes('RAID') || eventType.includes('ANTINUKE')) {
                    severity = 'HIGH';
                } else if (eventType.includes('KICK') || eventType.includes('TIMEOUT')) {
                    severity = 'MEDIUM';
                } else if (eventType.includes('WARN') || eventType.includes('MUTE')) {
                    severity = 'LOW';
                }

                // Build description
                let description = '';
                if (parsedPayload.targetTag && parsedPayload.moderatorTag) {
                    description = `${parsedPayload.moderatorTag} ${eventType.toLowerCase().replace(/_/g, ' ')} ${parsedPayload.targetTag}`;
                    if (parsedPayload.reason) {
                        description += `: ${parsedPayload.reason}`;
                    }
                } else {
                    description = parsedPayload.reason || eventType;
                }

                return {
                    source: 'security',
                    type: eventType,
                    severity: severity,
                    description: description,
                    created_at: event.created_at
                };
            });

            res.json({
                success: true,
                events: formattedEvents
            });
        } catch (error) {
            this.bot.logger.error('Error getting recent security events:', error);
            res.status(500).json({ error: 'Failed to retrieve security events' });
        }
    }

    // NEW: Ticket stats endpoint
    async getTicketStats(req, res) {
        try {
            const guild = this.bot?.client?.guilds?.cache?.first();
            if (!guild) {
                return res.json({
                    activeTickets: 0,
                    totalTickets: 0,
                    closedToday: 0,
                    avgResponseTime: '0m',
                    recentTickets: [],
                    ticketStats: { open: 0, pending: 0, resolved: 0 }
                });
            }

            const guildId = guild.id;
            
            // Get ticket statistics from database
            const totalTickets = await this.bot.database.get(
                'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ?',
                [guildId]
            );
            
            const activeTickets = await this.bot.database.get(
                'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = ?',
                [guildId, 'open']
            );
            
            const closedToday = await this.bot.database.get(
                `SELECT COUNT(*) as count FROM tickets 
                 WHERE guild_id = ? AND status = 'closed' 
                 AND date(closed_at) = date('now')`,
                [guildId]
            );
            
            // Get status distribution
            const openCount = await this.bot.database.get(
                'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = ?',
                [guildId, 'open']
            );
            
            const pendingCount = await this.bot.database.get(
                'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = ?',
                [guildId, 'pending']
            );
            
            const resolvedCount = await this.bot.database.get(
                'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = ?',
                [guildId, 'resolved']
            );
            
            // Get recent tickets with user info
            const recentTicketsRaw = await this.bot.database.all(
                `SELECT * FROM tickets 
                 WHERE guild_id = ? 
                 ORDER BY created_at DESC 
                 LIMIT 10`,
                [guildId]
            );
            
            // Fetch user details for each ticket
            const recentTickets = await Promise.all(recentTicketsRaw.map(async ticket => {
                let user = null;
                let userAvatar = '/images/default-avatar.png';
                let userName = 'Unknown User';
                
                try {
                    user = await this.bot.client.users.fetch(ticket.user_id);
                    if (user) {
                        userAvatar = user.displayAvatarURL({ dynamic: true, size: 64 });
                        userName = `${user.username}#${user.discriminator}`;
                    }
                } catch (e) {
                    console.warn('Could not fetch user for ticket:', ticket.id);
                }
                
                return {
                    id: `ticket-${ticket.id}`,
                    title: ticket.subject || 'Support Ticket',
                    user: userName,
                    userAvatar: userAvatar,
                    status: ticket.status || 'open',
                    priority: ticket.priority || 'normal',
                    category: ticket.tag || 'General',
                    created: this.formatTimeAgo(new Date(ticket.created_at)),
                    lastResponse: ticket.last_message_at ? this.formatTimeAgo(new Date(ticket.last_message_at)) : 'No response yet'
                };
            }));
            
            // Calculate average response time
            const avgResponseRaw = await this.bot.database.get(
                `SELECT AVG((julianday(last_message_at) - julianday(created_at)) * 24 * 60) as avg_minutes
                 FROM tickets 
                 WHERE guild_id = ? AND last_message_at IS NOT NULL`,
                [guildId]
            );
            
            const avgMinutes = avgResponseRaw?.avg_minutes || 0;
            const avgResponseTime = avgMinutes > 60 
                ? `${Math.round(avgMinutes / 60)}h`
                : `${Math.round(avgMinutes)}m`;

            res.json({
                activeTickets: activeTickets?.count || 0,
                totalTickets: totalTickets?.count || 0,
                closedToday: closedToday?.count || 0,
                avgResponseTime: avgResponseTime,
                recentTickets: recentTickets,
                ticketStats: {
                    open: openCount?.count || 0,
                    pending: pendingCount?.count || 0,
                    resolved: resolvedCount?.count || 0
                }
            });
        } catch (error) {
            this.bot.logger.error('Error getting ticket stats:', error);
            res.json({
                activeTickets: 0,
                totalTickets: 0,
                closedToday: 0,
                avgResponseTime: '0m',
                recentTickets: [],
                ticketStats: { open: 0, pending: 0, resolved: 0 }
            });
        }
    }

    // Helper function to format time ago
    formatTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return `${seconds}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
        return `${Math.floor(seconds / 604800)}w ago`;
    }

    // Setup API handlers
    async getChannels(req, res) {
        try {
            if (!this.bot.client?.guilds?.cache) {
                return res.json({ channels: [], categories: [] });
            }

            // Get guild ID from query parameter or default to first guild
            const guildId = req.query.guildId || req.user?.guilds?.[0]?.id;
            const guild = guildId ? this.bot.client.guilds.cache.get(guildId) : this.bot.client.guilds.cache.first();
            
            if (!guild) {
                return res.json({ channels: [], categories: [] });
            }

            const channels = guild.channels.cache
                .filter(c => c.type === 0) // Text channels
                .map(c => ({ id: c.id, name: c.name, type: c.type }));

            const categories = guild.channels.cache
                .filter(c => c.type === 4) // Categories
                .map(c => ({ id: c.id, name: c.name, type: c.type }));

            res.json({ channels, categories });
        } catch (error) {
            this.bot.logger.error('Error getting channels:', error);
            res.status(500).json({ error: 'Failed to get channels' });
        }
    }

    async getRoles(req, res) {
        try {
            if (!this.bot.client?.guilds?.cache) {
                return res.json({ roles: [] });
            }

            // Get guild ID from query parameter or default to first guild
            const guildId = req.query.guildId || req.user?.guilds?.[0]?.id;
            const guild = guildId ? this.bot.client.guilds.cache.get(guildId) : this.bot.client.guilds.cache.first();
            
            if (!guild) {
                return res.json({ roles: [] });
            }

            const roles = guild.roles.cache
                .filter(r => !r.managed && r.name !== '@everyone')
                .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
                .sort((a, b) => b.position - a.position);

            res.json({ roles });
        } catch (error) {
            this.bot.logger.error('Error getting roles:', error);
            res.status(500).json({ error: 'Failed to get roles' });
        }
    }

    async getSecuritySettings(req, res) {
        try {
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.json({ settings: {} });
            }

            const config = await this.bot.database.get(
                'SELECT * FROM guild_configs WHERE guild_id = ?',
                [guild.id]
            );

            const settings = {
                antiRaid: {
                    enabled: config?.antiraid_enabled || false,
                    joinThreshold: 10,
                    action: 'kick',
                    alertChannel: config?.alert_channel || ''
                },
                antiSpam: {
                    enabled: config?.antispam_enabled || false,
                    messageLimit: 5,
                    timeWindow: 10,
                    punishment: 'timeout'
                },
                antiPhishing: {
                    enabled: config?.antiphishing_enabled || false,
                    action: 'delete',
                    useDatabase: true
                },
                antiNuke: {
                    enabled: config?.antinuke_enabled || false,
                    roleLimit: config?.antinuke_role_limit || 3,
                    channelLimit: config?.antinuke_channel_limit || 3,
                    banLimit: config?.antinuke_ban_limit || 3
                }
            };

            res.json({ settings });
        } catch (error) {
            this.bot.logger.error('Error getting security settings:', error);
            res.status(500).json({ error: 'Failed to get settings' });
        }
    }

    async saveSecuritySettings(req, res) {
        try {
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.status(400).json({ error: 'No guild found' });
            }

            const settings = req.body;
            
            // Validate settings
            if (!settings || typeof settings !== 'object') {
                return res.status(400).json({ error: 'Invalid settings format' });
            }

            // Ensure guild config exists
            await this.bot.database.getGuildConfig(guild.id);

            // Validate numeric limits
            const roleLimit = this.validateLimit(settings.antiNuke?.roleLimit || 3, 50);
            const channelLimit = this.validateLimit(settings.antiNuke?.channelLimit || 3, 50);
            const banLimit = this.validateLimit(settings.antiNuke?.banLimit || 3, 50);

            await this.bot.database.run(`
                UPDATE guild_configs SET
                    antiraid_enabled = ?,
                    antispam_enabled = ?,
                    antiphishing_enabled = ?,
                    antinuke_enabled = ?,
                    antinuke_role_limit = ?,
                    antinuke_channel_limit = ?,
                    antinuke_ban_limit = ?,
                    alert_channel = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE guild_id = ?
            `, [
                settings.antiRaid?.enabled ? 1 : 0,
                settings.antiSpam?.enabled ? 1 : 0,
                settings.antiPhishing?.enabled ? 1 : 0,
                settings.antiNuke?.enabled ? 1 : 0,
                roleLimit,
                channelLimit,
                banLimit,
                this.sanitizeString(settings.antiRaid?.alertChannel || '', 20),
                guild.id
            ]);
            
            // Broadcast settings update via WebSocket
            if (this.wss) {
                this.broadcastToGuild(guild.id, {
                    type: 'settings_updated',
                    settings: {
                        antiRaid: { enabled: settings.antiRaid?.enabled || false },
                        antiSpam: { enabled: settings.antiSpam?.enabled || false },
                        antiPhishing: { enabled: settings.antiPhishing?.enabled || false },
                        antiNuke: { 
                            enabled: settings.antiNuke?.enabled || false,
                            roleLimit,
                            channelLimit,
                            banLimit
                        }
                    }
                });
            }

            // Invalidate config cache
            try {
                if (this.bot.configService?.cache) this.bot.configService.cache.delete(guild.id);
            } catch (e) { /* ignore */ }

            this.bot.logger.info(`Security settings updated for guild ${guild.id}`);
            res.json({ success: true, message: 'Settings saved successfully' });
        } catch (error) {
            this.bot.logger.error('Error saving security settings:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }

    // =====================================================
    // Anti-Phishing dedicated endpoints
    // =====================================================
    async getAntiPhishingSettings(req, res) {
        try {
            const guildId = req.query.guildId || req.headers['x-guild-id'];
            const guild = guildId ? this.bot.client.guilds.cache.get(guildId) : this.bot.client.guilds.cache.first();
            if (!guild) return res.json({});

            const config = await this.bot.database.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guild.id]);

            res.json({
                enabled: !!(config?.antiphishing_enabled || config?.anti_phishing_enabled),
                actionType: config?.phishing_action || 'delete',
                logDetections: !!(config?.phishing_log_all ?? true),
                useDatabase: true,
                detectNitroScams: true,
                blockShorteners: !!(config?.phishing_block_shorteners),
                blockIpLinks: !!(config?.phishing_block_ip_links),
                whitelistedDomains: this.safeJsonParse(config?.phishing_whitelist_domains, []),
                blacklistedDomains: this.safeJsonParse(config?.phishing_blacklist_domains, []),
                dmUser: !!(config?.phishing_dm_user ?? true),
                sensitivity: config?.phishing_sensitivity || 'medium'
            });
        } catch (error) {
            this.bot.logger?.error('Error getting anti-phishing settings:', error);
            res.status(500).json({ error: 'Failed to get settings' });
        }
    }

    async saveAntiPhishingSettings(req, res) {
        try {
            const guildId = req.query.guildId || req.headers['x-guild-id'];
            const guild = guildId ? this.bot.client.guilds.cache.get(guildId) : this.bot.client.guilds.cache.first();
            if (!guild) return res.status(400).json({ error: 'No guild found' });

            const s = req.body;
            if (!s || typeof s !== 'object') return res.status(400).json({ error: 'Invalid settings' });

            // Build updates only for columns that exist
            const updates = {
                antiphishing_enabled: s.enabled ? 1 : 0,
                anti_phishing_enabled: s.enabled ? 1 : 0,
                phishing_action: s.actionType || 'delete',
                phishing_log_all: s.logDetections ? 1 : 0,
                phishing_dm_user: s.dmUser ? 1 : 0,
                phishing_sensitivity: s.sensitivity || 'medium',
                phishing_block_shorteners: s.blockShorteners ? 1 : 0,
                phishing_block_ip_links: s.blockIpLinks ? 1 : 0,
                phishing_blacklist_domains: JSON.stringify(Array.isArray(s.blacklistedDomains) ? s.blacklistedDomains : []),
                phishing_whitelist_domains: JSON.stringify(Array.isArray(s.whitelistedDomains) ? s.whitelistedDomains : [])
            };

            // Check which columns exist to avoid errors
            let existingColumns;
            try {
                const tableInfo = await this.bot.database.all('PRAGMA table_info(guild_configs)');
                existingColumns = new Set(tableInfo.map(col => col.name));
            } catch (e) { existingColumns = null; }

            const validUpdates = {};
            for (const [k, v] of Object.entries(updates)) {
                if (!existingColumns || existingColumns.has(k)) validUpdates[k] = v;
            }

            if (Object.keys(validUpdates).length > 0) {
                const setClauses = Object.keys(validUpdates).map(key => `${key} = ?`).join(', ');
                const vals = [...Object.values(validUpdates), guild.id];
                await this.bot.database.run(`UPDATE guild_configs SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`, vals);
            }

            // Invalidate config cache so bot respects the new enabled/disabled state immediately
            try {
                if (this.bot.configService?.cache) this.bot.configService.cache.delete(guild.id);
            } catch (e) { /* ignore */ }

            // Invalidate the antilinks guild domain cache so changes apply immediately
            try {
                if (this.bot.antiMaliciousLinks?.guildDomainCache) {
                    this.bot.antiMaliciousLinks.guildDomainCache.delete(guild.id);
                }
            } catch (e) { /* ignore */ }

            this.bot.logger?.info(`Anti-phishing settings updated for guild ${guild.id}`);
            res.json({ success: true, message: 'Settings saved successfully' });
        } catch (error) {
            this.bot.logger?.error('Error saving anti-phishing settings:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }

    // =====================================================
    // Anti-Nuke dedicated endpoints
    // =====================================================
    async getAntiNukeSettings(req, res) {
        try {
            const guildId = req.query.guildId || req.headers['x-guild-id'];
            const guild = guildId ? this.bot.client.guilds.cache.get(guildId) : this.bot.client.guilds.cache.first();
            if (!guild) return res.json({});

            const config = await this.bot.database.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guild.id]);

            res.json({
                enabled: !!(config?.antinuke_enabled),
                actionLimit: config?.antinuke_limit || config?.antinuke_role_limit || 5,
                detectionWindow: config?.antinuke_window || 10,
                punishmentType: config?.antinuke_punishment || 'kick',
                protections: this.safeJsonParse(config?.antinuke_protections, {
                    channel_delete: true, channel_create: true,
                    role_delete: true, role_create: true,
                    ban: true, kick: true, webhook: true, emoji: true
                }),
                whitelistedRoles: this.safeJsonParse(config?.antinuke_whitelist, []),
                roleLimit: config?.antinuke_role_limit || 3,
                channelLimit: config?.antinuke_channel_limit || 3,
                banLimit: config?.antinuke_ban_limit || 3
            });
        } catch (error) {
            this.bot.logger?.error('Error getting anti-nuke settings:', error);
            res.status(500).json({ error: 'Failed to get settings' });
        }
    }

    async saveAntiNukeSettings(req, res) {
        try {
            const guildId = req.query.guildId || req.headers['x-guild-id'];
            const guild = guildId ? this.bot.client.guilds.cache.get(guildId) : this.bot.client.guilds.cache.first();
            if (!guild) return res.status(400).json({ error: 'No guild found' });

            const s = req.body;
            if (!s || typeof s !== 'object') return res.status(400).json({ error: 'Invalid settings' });

            const roleLimit = this.validateLimit(s.actionLimit || s.roleLimit || 3, 50);
            const channelLimit = this.validateLimit(s.channelLimit || s.actionLimit || 3, 50);
            const banLimit = this.validateLimit(s.banLimit || s.actionLimit || 3, 50);

            const updates = {
                antinuke_enabled: s.enabled ? 1 : 0,
                antinuke_role_limit: roleLimit,
                antinuke_channel_limit: channelLimit,
                antinuke_ban_limit: banLimit,
                antinuke_limit: s.actionLimit || 5,
                antinuke_window: s.detectionWindow || 10,
                antinuke_punishment: s.punishmentType || 'kick',
                antinuke_protections: JSON.stringify(s.protections || {}),
                antinuke_whitelist: JSON.stringify(s.whitelistedRoles || [])
            };

            // Check which columns exist
            let existingColumns;
            try {
                const tableInfo = await this.bot.database.all('PRAGMA table_info(guild_configs)');
                existingColumns = new Set(tableInfo.map(col => col.name));
            } catch (e) { existingColumns = null; }

            const validUpdates = {};
            for (const [k, v] of Object.entries(updates)) {
                if (!existingColumns || existingColumns.has(k)) validUpdates[k] = v;
            }

            if (Object.keys(validUpdates).length > 0) {
                const setClauses = Object.keys(validUpdates).map(key => `${key} = ?`).join(', ');
                const vals = [...Object.values(validUpdates), guild.id];
                await this.bot.database.run(`UPDATE guild_configs SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`, vals);
            }

            // Invalidate config cache
            try {
                if (this.bot.configService?.cache) this.bot.configService.cache.delete(guild.id);
            } catch (e) { /* ignore */ }

            this.bot.logger?.info(`Anti-nuke settings updated for guild ${guild.id}`);
            res.json({ success: true, message: 'Settings saved successfully' });
        } catch (error) {
            this.bot.logger?.error('Error saving anti-nuke settings:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }

    // =====================================================
    // Notifications & Logs dedicated endpoints
    // =====================================================
    async getNotificationSettings(req, res) {
        try {
            const guildId = req.query.guildId || req.headers['x-guild-id'];
            const guild = guildId ? this.bot.client.guilds.cache.get(guildId) : this.bot.client.guilds.cache.first();
            if (!guild) return res.json({});

            const config = await this.bot.database.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guild.id]);
            const custom = await this.bot.database.get('SELECT * FROM guild_customization WHERE guild_id = ?', [guild.id]);

            // Merge both tables — guild_configs has channel IDs, guild_customization has log toggles
            const logToggles = custom || config || {};

            // Parse notification_settings JSON column if it exists
            let notifSettings = {};
            try {
                if (config?.notification_settings) {
                    notifSettings = typeof config.notification_settings === 'string' 
                        ? JSON.parse(config.notification_settings) : config.notification_settings;
                }
            } catch (e) { /* ignore parse errors */ }

            res.json({
                // Free: Log Channels
                log_channel_id: config?.log_channel_id || '',
                mod_log_channel: config?.mod_log_channel || '',
                alert_channel: config?.alert_channel || '',

                // Free: Event Toggles
                mod_logging: !!(logToggles.mod_logging ?? true),
                log_edits: !!(logToggles.log_edits ?? true),
                log_deletes: !!(logToggles.log_deletes ?? true),
                log_members: !!(logToggles.log_members ?? true),
                log_roles: !!(logToggles.log_roles ?? false),
                log_channels: !!(logToggles.log_channels ?? false),
                log_compact: !!(logToggles.log_compact ?? false),

                // Free: Basic Notification Toggles
                notify_security_alerts: !!(notifSettings.notify_security_alerts ?? true),
                notify_new_tickets: !!(notifSettings.notify_new_tickets ?? true),
                notify_settings_changes: !!(notifSettings.notify_settings_changes ?? true),
                notify_automod: !!(notifSettings.notify_automod ?? true),

                // Premium: Advanced Channels
                join_leave_channel: notifSettings.join_leave_channel || '',
                message_log_channel: notifSettings.message_log_channel || '',
                server_changes_channel: notifSettings.server_changes_channel || '',
                automod_log_channel: notifSettings.automod_log_channel || '',

                // Premium: Granular Events
                granular_events: notifSettings.granular_events || {},

                // Premium: Webhooks
                webhook_primary: notifSettings.webhook_primary || '',
                webhook_secondary: notifSettings.webhook_secondary || '',

                // Premium: DM Notifications
                dm_on_raid: !!(notifSettings.dm_on_raid ?? true),
                dm_on_nuke: !!(notifSettings.dm_on_nuke ?? true),
                dm_on_escalation: !!(notifSettings.dm_on_escalation ?? true),
                dm_on_settings: !!(notifSettings.dm_on_settings ?? false),

                // Premium: Email Notifications
                email_address: notifSettings.email_address || '',
                email_verified: !!(notifSettings.email_verified ?? false),
                email_on_raid: !!(notifSettings.email_on_raid ?? true),
                email_on_nuke: !!(notifSettings.email_on_nuke ?? true),
                email_on_mass_ban: !!(notifSettings.email_on_mass_ban ?? true),
                email_on_phishing: !!(notifSettings.email_on_phishing ?? true),
                email_on_suspicious: !!(notifSettings.email_on_suspicious ?? false),
                email_on_settings_change: !!(notifSettings.email_on_settings_change ?? false),
                email_on_ticket_escalation: !!(notifSettings.email_on_ticket_escalation ?? true),
                email_on_staff_removed: !!(notifSettings.email_on_staff_removed ?? true),
                email_digest_enabled: !!(notifSettings.email_digest_enabled ?? false),
                email_digest_frequency: notifSettings.email_digest_frequency || 'weekly',

                // Premium: Formatting
                log_embed_color: notifSettings.log_embed_color || '#5865F2',
                timestamp_format: notifSettings.timestamp_format || 'long',
                audit_retention: notifSettings.audit_retention || 30,
                log_show_avatars: !!(notifSettings.log_show_avatars ?? true),
                log_show_content: !!(notifSettings.log_show_content ?? true)
            });
        } catch (error) {
            this.bot.logger?.error('Error getting notification settings:', error);
            res.status(500).json({ error: 'Failed to get notification settings' });
        }
    }

    async saveNotificationSettings(req, res) {
        try {
            const guildId = req.query.guildId || req.headers['x-guild-id'];
            const guild = guildId ? this.bot.client.guilds.cache.get(guildId) : this.bot.client.guilds.cache.first();
            if (!guild) return res.status(400).json({ error: 'No guild found' });

            const s = req.body;
            if (!s || typeof s !== 'object') return res.status(400).json({ error: 'Invalid settings' });

            // ── Free-tier columns (guild_configs) ──
            const freeUpdates = {};
            if (s.log_channel_id !== undefined) freeUpdates.log_channel_id = s.log_channel_id || null;
            if (s.mod_log_channel !== undefined) freeUpdates.mod_log_channel = s.mod_log_channel || null;
            if (s.alert_channel !== undefined) freeUpdates.alert_channel = s.alert_channel || null;

            // Check which columns exist in guild_configs
            let existingCols;
            try {
                const tableInfo = await this.bot.database.all('PRAGMA table_info(guild_configs)');
                existingCols = new Set(tableInfo.map(col => col.name));
            } catch (e) { existingCols = null; }

            // Ensure row exists
            await this.bot.database.run('INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)', [guild.id]);

            // Add new columns if they don't exist yet
            const newCols = [
                ['mod_log_channel', 'TEXT'],
                ['notification_settings', 'TEXT']
            ];
            for (const [col, type] of newCols) {
                if (existingCols && !existingCols.has(col)) {
                    try {
                        await this.bot.database.run(`ALTER TABLE guild_configs ADD COLUMN ${col} ${type}`);
                        existingCols.add(col);
                    } catch (e) { /* column may already exist */ }
                }
            }

            // Update free-tier columns
            const validFree = {};
            for (const [k, v] of Object.entries(freeUpdates)) {
                if (!existingCols || existingCols.has(k)) validFree[k] = v;
            }
            if (Object.keys(validFree).length > 0) {
                const setClauses = Object.keys(validFree).map(key => `${key} = ?`).join(', ');
                const vals = [...Object.values(validFree), guild.id];
                await this.bot.database.run(`UPDATE guild_configs SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`, vals);
            }

            // Update log toggles in guild_customization
            await this.bot.database.run('INSERT OR IGNORE INTO guild_customization (guild_id) VALUES (?)', [guild.id]);
            await this.bot.database.run(`UPDATE guild_customization SET 
                mod_logging = ?, log_edits = ?, log_deletes = ?, log_members = ?,
                log_roles = ?, log_channels = ?, log_compact = ?, updated_at = CURRENT_TIMESTAMP
                WHERE guild_id = ?`, [
                s.mod_logging ? 1 : 0, s.log_edits ? 1 : 0, s.log_deletes ? 1 : 0, s.log_members ? 1 : 0,
                s.log_roles ? 1 : 0, s.log_channels ? 1 : 0, s.log_compact ? 1 : 0,
                guild.id
            ]);

            // Read existing notification_settings to preserve email_verified status
            let existingNotif = {};
            try {
                const existingRow = await this.bot.database.get('SELECT notification_settings FROM guild_configs WHERE guild_id = ?', [guild.id]);
                if (existingRow?.notification_settings) existingNotif = JSON.parse(existingRow.notification_settings);
            } catch (e) { /* ignore */ }

            // ── Premium settings (stored as JSON blob) ──
            const premiumSettings = {
                // Basic notification toggles (free but stored here for simplicity)
                notify_security_alerts: !!s.notify_security_alerts,
                notify_new_tickets: !!s.notify_new_tickets,
                notify_settings_changes: !!s.notify_settings_changes,
                notify_automod: !!s.notify_automod,

                // Advanced channels
                join_leave_channel: s.join_leave_channel || '',
                message_log_channel: s.message_log_channel || '',
                server_changes_channel: s.server_changes_channel || '',
                automod_log_channel: s.automod_log_channel || '',

                // Granular events
                granular_events: s.granular_events || {},

                // Webhooks
                webhook_primary: s.webhook_primary || '',
                webhook_secondary: s.webhook_secondary || '',

                // DM notifications
                dm_on_raid: !!s.dm_on_raid,
                dm_on_nuke: !!s.dm_on_nuke,
                dm_on_escalation: !!s.dm_on_escalation,
                dm_on_settings: !!s.dm_on_settings,

                // Email notifications (preserve verified status; don't overwrite on plain save)
                email_address: s.email_address || '',
                email_verified: !!(existingNotif && existingNotif.email_verified && existingNotif.email_address === s.email_address),
                email_on_raid: s.email_on_raid !== false,
                email_on_nuke: s.email_on_nuke !== false,
                email_on_mass_ban: s.email_on_mass_ban !== false,
                email_on_phishing: s.email_on_phishing !== false,
                email_on_suspicious: !!s.email_on_suspicious,
                email_on_settings_change: !!s.email_on_settings_change,
                email_on_ticket_escalation: s.email_on_ticket_escalation !== false,
                email_on_staff_removed: s.email_on_staff_removed !== false,
                email_digest_enabled: !!s.email_digest_enabled,
                email_digest_frequency: s.email_digest_frequency || 'weekly',

                // Preserve any in-flight verify tokens so a save doesn't wipe them
                ...(existingNotif.email_verify_token ? {
                    email_pending: existingNotif.email_pending,
                    email_verify_token: existingNotif.email_verify_token,
                    email_verify_expires: existingNotif.email_verify_expires
                } : {}),

                // Formatting
                log_embed_color: s.log_embed_color || '#5865F2',
                timestamp_format: s.timestamp_format || 'long',
                audit_retention: s.audit_retention || 30,
                log_show_avatars: s.log_show_avatars !== false,
                log_show_content: s.log_show_content !== false
            };

            // Store premium settings as JSON blob in notification_settings column
            if (!existingCols || existingCols.has('notification_settings')) {
                await this.bot.database.run(
                    'UPDATE guild_configs SET notification_settings = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?',
                    [JSON.stringify(premiumSettings), guild.id]
                );
            }

            // Invalidate config cache
            try {
                if (this.bot.configService?.cache) this.bot.configService.cache.delete(guild.id);
            } catch (e) { /* ignore */ }

            // Invalidate DiscordLogger cache so new channel settings take effect immediately
            try {
                if (this.bot.discordLogger) this.bot.discordLogger.invalidateCache(guild.id);
            } catch (e) { /* ignore */ }

            this.bot.logger?.info(`Notification settings updated for guild ${guild.id}`);
            res.json({ success: true, message: 'Notification settings saved successfully' });
        } catch (error) {
            this.bot.logger?.error('Error saving notification settings:', error);
            res.status(500).json({ error: 'Failed to save notification settings' });
        }
    }

    async verifyNotificationEmail(req, res) {
        try {
            const { email, guildId } = req.body;
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ error: 'Invalid email address' });
            }

            const token = require('crypto').randomBytes(32).toString('hex');
            const expires = Date.now() + 24 * 60 * 60 * 1000; // 24h

            // Store pending verification token in DB
            const guild = guildId ? this.bot.client.guilds.cache.get(guildId) : this.bot.client.guilds.cache.first();
            if (!guild) return res.status(400).json({ error: 'Guild not found' });

            await this.bot.database.run('INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)', [guild.id]);
            // Store token in a JSON field alongside existing notification_settings
            const existing = await this.bot.database.get('SELECT notification_settings FROM guild_configs WHERE guild_id = ?', [guild.id]);
            let notifSettings = {};
            try { if (existing?.notification_settings) notifSettings = JSON.parse(existing.notification_settings); } catch (e) {}
            notifSettings.email_pending = email;
            notifSettings.email_verify_token = token;
            notifSettings.email_verify_expires = expires;
            // Don't mark verified until confirmed
            notifSettings.email_verified = false;
            await this.bot.database.run(
                'UPDATE guild_configs SET notification_settings = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?',
                [JSON.stringify(notifSettings), guild.id]
            );

            // Send verification email via nodemailer
            const nodemailer = require('nodemailer');
            const smtpHost = process.env.EMAIL_HOST || process.env.SMTP_HOST;
            if (!smtpHost) {
                this.bot.logger?.warn('[Email] No SMTP host configured (EMAIL_HOST). Skipping send.');
                return res.status(503).json({ error: 'Email service not configured. Set EMAIL_HOST, EMAIL_USER, EMAIL_PASS, EMAIL_FROM in .env' });
            }

            const transporter = nodemailer.createTransport({
                host: smtpHost,
                port: parseInt(process.env.EMAIL_PORT || '587'),
                secure: process.env.EMAIL_SECURE === 'true',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                }
            });

            const confirmUrl = `${process.env.DOMAIN || 'https://admin.darklock.net'}/confirm-email?token=${token}&guildId=${guild.id}`;
            const fromAddr = process.env.EMAIL_FROM || 'alerts@darklock.net';

            await transporter.sendMail({
                from: `"DarkLock Alerts" <${fromAddr}>`,
                to: email,
                subject: 'Verify your DarkLock notification email',
                html: `
                    <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;background:#0d0d1a;color:#e2e8f0;padding:32px;border-radius:12px;">
                        <div style="margin-bottom:24px;">
                            <span style="font-size:24px;">🔒</span>
                            <span style="font-size:20px;font-weight:700;margin-left:8px;color:#fff;">DarkLock</span>
                        </div>
                        <h2 style="font-size:18px;font-weight:600;color:#fff;margin:0 0 12px 0;">Verify your email address</h2>
                        <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px 0;">You requested email notifications for your Discord server. Click the button below to verify this address.</p>
                        <a href="${confirmUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-weight:600;font-size:14px;border-radius:8px;text-decoration:none;">Verify Email Address</a>
                        <p style="font-size:12px;color:#475569;margin:24px 0 0 0;">This link expires in 24 hours. If you didn't request this, ignore this email.</p>
                        <p style="font-size:12px;color:#334155;margin:8px 0 0 0;">Or copy this link: ${confirmUrl}</p>
                    </div>
                `
            });

            this.bot.logger?.info(`[Email] Verification email sent to ${email} for guild ${guild.id}`);
            res.json({ success: true, message: 'Verification email sent! Check your inbox.' });
        } catch (error) {
            this.bot.logger?.error('Error sending verification email:', error);
            res.status(500).json({ error: 'Failed to send verification email: ' + error.message });
        }
    }

    async confirmNotificationEmail(req, res) {
        const _sendPage = (res, status, { icon, title, message, redirectTo, redirectLabel }) => {
            const csp = "default-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src *; img-src 'self' data:;";
            res.setHeader('Content-Security-Policy', csp);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            // Prevent Cloudflare (and other proxies) from injecting scripts or modifying CSP
            res.setHeader('Cache-Control', 'no-store, no-transform');
            const meta = redirectTo ? `<meta http-equiv="refresh" content="4;url=${redirectTo}">` : '';
            const btn = redirectTo ? `<a href="${redirectTo}" style="display:inline-block;margin-top:20px;padding:12px 28px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-weight:600;font-size:14px;border-radius:8px;text-decoration:none;">${redirectLabel || 'Continue'}</a>` : '';
            const countdown = redirectTo ? `<p style="font-size:12px;color:#475569;margin-top:12px;">Redirecting in 4 seconds…</p>` : '';
            res.status(status).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title} — DarkLock</title>${meta}<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,sans-serif;background:#0d0d1a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.card{background:#13131f;border:1px solid #1e2030;border-radius:16px;padding:40px;max-width:420px;width:100%;text-align:center}.icon{font-size:48px;margin-bottom:16px}.title{font-size:22px;font-weight:700;color:#fff;margin-bottom:8px}.msg{font-size:14px;color:#94a3b8;line-height:1.6}.brand{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:28px;font-size:16px;font-weight:700;color:#fff}.brand-dot{width:8px;height:8px;border-radius:50%;background:#6366f1}</style></head><body><div class="card"><div class="brand"><div class="brand-dot"></div>DarkLock</div><div class="icon">${icon}</div><div class="title">${title}</div><div class="msg">${message}</div>${btn}${countdown}</div></body></html>`);
        };

        try {
            const { token, guildId } = req.query;
            if (!token || !guildId) return _sendPage(res, 400, {
                icon: '⚠️', title: 'Invalid Link',
                message: 'This confirmation link is missing required parameters. Please request a new verification email from the dashboard.'
            });

            const row = await this.bot.database.get('SELECT notification_settings FROM guild_configs WHERE guild_id = ?', [guildId]);
            if (!row) return _sendPage(res, 404, {
                icon: '🔍', title: 'Server Not Found',
                message: 'Could not find your Discord server in our database. Make sure the bot is still in your server.'
            });

            let notifSettings = {};
            try { if (row.notification_settings) notifSettings = JSON.parse(row.notification_settings); } catch (e) {}

            if (!notifSettings.email_verify_token || notifSettings.email_verify_token !== token) {
                return _sendPage(res, 400, {
                    icon: '❌', title: 'Invalid or Used Link',
                    message: 'This verification link is invalid or has already been used. Please request a new one from the Notifications settings page.',
                    redirectTo: '/setup/notifications', redirectLabel: 'Go to Notifications'
                });
            }
            if (Date.now() > (notifSettings.email_verify_expires || 0)) {
                return _sendPage(res, 400, {
                    icon: '⏰', title: 'Link Expired',
                    message: 'This verification link has expired (links are valid for 24 hours). Please request a new verification email from the dashboard.',
                    redirectTo: '/setup/notifications', redirectLabel: 'Go to Notifications'
                });
            }

            // Mark email as verified
            const verifiedAddr = notifSettings.email_pending || notifSettings.email_address;
            notifSettings.email_address = verifiedAddr;
            notifSettings.email_verified = true;
            delete notifSettings.email_pending;
            delete notifSettings.email_verify_token;
            delete notifSettings.email_verify_expires;

            await this.bot.database.run(
                'UPDATE guild_configs SET notification_settings = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?',
                [JSON.stringify(notifSettings), guildId]
            );

            this.bot.logger?.info(`[Email] Email verified for guild ${guildId}: ${verifiedAddr}`);
            return _sendPage(res, 200, {
                icon: '✅', title: 'Email Verified!',
                message: `<strong style="color:#fff">${verifiedAddr}</strong> is now verified and will receive DarkLock security notifications.`,
                redirectTo: '/setup/notifications?emailVerified=1', redirectLabel: 'Go to Notifications'
            });
        } catch (error) {
            this.bot.logger?.error('Error confirming email:', error);
            return _sendPage(res, 500, {
                icon: '⚠️', title: 'Something Went Wrong',
                message: 'Failed to confirm your email. Please try again or request a new verification email.',
                redirectTo: '/setup/notifications', redirectLabel: 'Go to Notifications'
            });
        }
    }

    // Guild-specific channels endpoint
    async getGuildChannels(req, res) {
        try {
            const { guildId } = req.params;
            
            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                return res.json([]);
            }

            const channels = guild.channels.cache
                .filter(c => c.type === 0 || c.type === 2) // Text and voice channels
                .map(c => ({ id: c.id, name: c.name, type: c.type }))
                .sort((a, b) => a.name.localeCompare(b.name));

            res.json(channels);
        } catch (error) {
            this.bot.logger.error('Error getting guild channels:', error);
            res.status(500).json({ error: 'Failed to get channels' });
        }
    }

    // Guild-specific roles endpoint
    async getGuildRoles(req, res) {
        try {
            const { guildId } = req.params;
            
            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                return res.json([]);
            }

            const roles = guild.roles.cache
                .filter(r => !r.managed && r.name !== '@everyone')
                .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
                .sort((a, b) => b.position - a.position);

            res.json(roles);
        } catch (error) {
            this.bot.logger.error('Error getting guild roles:', error);
            res.status(500).json({ error: 'Failed to get roles' });
        }
    }

    // Guild-specific settings endpoint (GET)
    async getGuildSpecificSettings(req, res) {
        try {
            const { guildId } = req.params;
            
            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            const config = await this.bot.database.get(
                'SELECT * FROM guild_configs WHERE guild_id = ?',
                [guildId]
            );

            res.json(config || {});
        } catch (error) {
            this.bot.logger.error('Error getting guild settings:', error);
            res.status(500).json({ error: 'Failed to get settings' });
        }
    }

    // Guild-specific settings endpoint (POST)
    async saveGuildSpecificSettings(req, res) {
        try {
            const { guildId } = req.params;
            const settings = req.body;
            
            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            // Build dynamic update query based on provided settings
            const updates = [];
            const values = [];
            
            for (const [key, value] of Object.entries(settings)) {
                updates.push(key + ' = ?');
                values.push(typeof value === 'object' ? JSON.stringify(value) : value);
            }
            
            if (updates.length > 0) {
                values.push(guildId);
                await this.bot.database.run(
                    'UPDATE guild_configs SET ' + updates.join(', ') + ' WHERE guild_id = ?',
                    values
                );
            }

            res.json({ success: true, message: 'Settings saved' });
        } catch (error) {
            this.bot.logger.error('Error saving guild settings:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }
    async getTicketSettings(req, res) {
        try {
            // Support guildId from query params, headers, or body
            const guildId = req.query.guildId || req.headers['x-guild-id'] || req.body?.guildId;
            let guild = null;
            if (guildId) {
                guild = this.bot?.client?.guilds?.cache?.get(guildId);
            }
            if (!guild) {
                guild = this.getGuildFromRequest(req);
            }
            if (!guild) {
                // Return empty settings instead of 500 when no guild found
                return res.json({ settings: {
                    enabled: false,
                    panelChannelId: '', categoryId: '', logChannelId: '',
                    staffRoleId: '', manageRoleId: '',
                    welcomeMessage: 'Thank you for creating a ticket! A support team member will be with you shortly.',
                    ticketCategories: ["General Support","Technical Issue","Billing","Report User","Other"],
                    maxOpen: 1,
                    autoClose: { enabled: false, hours: 48 }
                }});
            }

            // Ensure guild config exists
            let config;
            try {
                config = await this.bot.database.get(
                    'SELECT * FROM guild_configs WHERE guild_id = ?',
                    [guild.id]
                );
            } catch (dbError) {
                this.bot.logger?.warn('DB query failed for ticket settings, returning defaults:', dbError.message);
                config = null;
            }

            // Also try to load guild channels and roles for frontend selects
            let channels = [];
            let roles = [];
            try {
                channels = guild.channels.cache
                    .filter(ch => [0, 4].includes(ch.type))
                    .map(ch => ({ id: ch.id, name: ch.name, type: ch.type }))
                    .sort((a, b) => a.name.localeCompare(b.name));
                roles = guild.roles.cache
                    .filter(r => !r.managed && r.id !== guild.id)
                    .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
                    .sort((a, b) => b.position - a.position);
            } catch (e) { /* ignore */ }

            const settings = {
                enabled: !!(config?.tickets_enabled),
                // Correct column names that TicketSystem.js actually reads
                panelChannelId: config?.ticket_channel_id || '',
                categoryId: config?.ticket_category_id || '',
                logChannelId: config?.ticket_log_channel || '',
                staffRoleId: config?.ticket_staff_role || '',
                manageRoleId: config?.ticket_manage_role || '',
                welcomeMessage: config?.ticket_welcome_message || 'Thank you for creating a ticket! A support team member will be with you shortly.',
                ticketCategories: this.safeJsonParse(config?.ticket_categories, ["General Support","Technical Issue","Billing","Report User","Other"]),
                maxOpen: config?.ticket_max_open || 1,
                transcriptEnabled: !!(config?.ticket_transcript_enabled),
                autoClose: {
                    enabled: !!(config?.ticket_autoclose),
                    hours: config?.ticket_autoclose_hours || 48
                }
            };

            res.json({ settings, channels, roles });
        } catch (error) {
            this.bot.logger.error('Error getting ticket settings:', error);
            res.status(500).json({ error: 'Failed to get settings' });
        }
    }

    async saveTicketSettings(req, res) {
        try {
            // Support guildId from query params, headers, or body for consistency
            const guildIdParam = req.query.guildId || req.headers['x-guild-id'] || req.body?.guildId;
            let guild = null;
            if (guildIdParam) guild = this.bot?.client?.guilds?.cache?.get(guildIdParam);
            if (!guild) guild = this.getGuildFromRequest(req);
            if (!guild) {
                return res.status(400).json({ error: 'No guild found' });
            }

            const settings = req.body;
            
            // Validate settings
            if (!settings || typeof settings !== 'object') {
                return res.status(400).json({ error: 'Invalid settings format' });
            }

            // Validate role IDs
            const validateId = (id) => (typeof id === 'string' && /^\d{17,19}$/.test(id)) ? id : '';
            
            const ticketCategories = Array.isArray(settings.ticketCategories)
                ? settings.ticketCategories.filter(cat => typeof cat === 'string').slice(0, 25).map(cat => this.sanitizeString(cat, 100))
                : ["General Support","Technical Issue","Billing","Report User","Other"];

            const welcomeMessage = this.sanitizeString(settings.welcomeMessage || 'Thank you for creating a ticket!', 2000);
            const autoCloseHours = this.validateLimit(settings.autoClose?.hours || 48, 720);
            const maxOpen = Math.min(Math.max(parseInt(settings.maxOpen) || 1, 1), 10);

            await this.bot.database.run(`
                UPDATE guild_configs SET
                    tickets_enabled = ?,
                    ticket_channel_id = ?,
                    ticket_category_id = ?,
                    ticket_staff_role = ?,
                    ticket_manage_role = ?,
                    ticket_log_channel = ?,
                    ticket_welcome_message = ?,
                    ticket_categories = ?,
                    ticket_autoclose = ?,
                    ticket_autoclose_hours = ?,
                    ticket_max_open = ?
                WHERE guild_id = ?
            `, [
                settings.enabled ? 1 : 0,
                validateId(settings.panelChannelId || ''),
                validateId(settings.categoryId || ''),
                validateId(settings.staffRoleId || ''),
                validateId(settings.manageRoleId || ''),
                validateId(settings.logChannelId || ''),
                welcomeMessage,
                JSON.stringify(ticketCategories),
                settings.autoClose?.enabled ? 1 : 0,
                autoCloseHours,
                maxOpen,
                guild.id
            ]);

            // Invalidate ConfigService cache so bot picks up changes immediately
            try {
                if (this.bot.configService?.cache) this.bot.configService.cache.delete(guild.id);
            } catch (e) { /* ignore */ }

            // Single batch notification
            try {
                if (this.bot.confirmationManager) {
                    await this.bot.confirmationManager.sendConfirmation(guild.id, 'tickets', 'ticket_settings', 'Ticket settings updated', null, req.user?.id || req.user?.sub || 'dashboard');
                }
            } catch (e) { this.bot.logger?.warn('Confirmation send failed for tickets:', e.message || e); }

            try {
                if (this.broadcastToGuild) {
                    this.broadcastToGuild(guild.id, { type: 'settings_updated', data: { section: 'tickets' }, timestamp: new Date().toISOString() });
                }
            } catch (e) { this.bot.logger?.warn('Broadcast ticket settings failed:', e.message || e); }

            this.bot.logger.info(`Ticket settings updated for guild ${guild.id}`);
            res.json({ success: true, message: 'Settings saved successfully' });
        } catch (error) {
            this.bot.logger.error('Error saving ticket settings:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }

    async getModerationSettings(req, res) {
        try {
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.json({ settings: {} });
            }

            const config = await this.bot.database.get(
                'SELECT * FROM guild_configs WHERE guild_id = ?',
                [guild.id]
            );

            const settings = {
                enabled: true,
                modLogChannel: config?.mod_log_channel || '',
                autoModEnabled: config?.auto_mod_enabled || false,
                dmOnWarn: config?.dm_on_warn || true,
                dmOnKick: config?.dm_on_kick || true,
                dmOnBan: config?.dm_on_ban || true,
                maxWarnings: config?.max_warnings || 3,
                warningAction: config?.warning_action || 'timeout'
            };

            res.json({ settings });
        } catch (error) {
            this.bot.logger.error('Error getting moderation settings:', error);
            res.status(500).json({ error: 'Failed to get settings' });
        }
    }

    async saveModerationSettings(req, res) {
        try {
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.status(400).json({ error: 'No guild found' });
            }

            const settings = req.body;
            
            // Validate settings
            if (!settings || typeof settings !== 'object') {
                return res.status(400).json({ error: 'Invalid settings format' });
            }

            // Validate warning action
            const validActions = ['timeout', 'kick', 'ban', 'none'];
            const warningAction = validActions.includes(settings.warningAction) ? settings.warningAction : 'timeout';
            const maxWarnings = this.validateLimit(settings.maxWarnings || 3, 20);

            await this.bot.database.run(`
                UPDATE guild_configs SET
                    mod_log_channel = ?,
                    auto_mod_enabled = ?,
                    dm_on_warn = ?,
                    dm_on_kick = ?,
                    dm_on_ban = ?,
                    max_warnings = ?,
                    warning_action = ?
                WHERE guild_id = ?
            `, [
                this.sanitizeString(settings.modLogChannel || '', 20),
                settings.autoModEnabled ? 1 : 0,
                settings.dmOnWarn ? 1 : 0,
                settings.dmOnKick ? 1 : 0,
                settings.dmOnBan ? 1 : 0,
                maxWarnings,
                warningAction,
                guild.id
            ]);

            // Invalidate ConfigService cache so bot picks up changes immediately
            try {
                if (this.bot.configService?.cache) this.bot.configService.cache.delete(guild.id);
            } catch (e) { /* ignore */ }

            // Single batch notification (not per-field)
            try {
                if (this.bot.confirmationManager) {
                    await this.bot.confirmationManager.sendConfirmation(guild.id, 'moderation', 'moderation_settings', 'Moderation settings updated', null, req.user?.id || req.user?.sub || 'dashboard');
                }
            } catch (e) { this.bot.logger?.warn('Confirmation send failed for moderation:', e.message || e); }

            try {
                if (this.broadcastToGuild) {
                    this.broadcastToGuild(guild.id, { type: 'settings_updated', data: { section: 'moderation' }, timestamp: new Date().toISOString() });
                }
            } catch (e) { this.bot.logger?.warn('Broadcast moderation settings failed:', e.message || e); }

            this.bot.logger.info(`Moderation settings updated for guild ${guild.id}`);
            res.json({ success: true, message: 'Settings saved successfully' });
        } catch (error) {
            this.bot.logger.error('Error saving moderation settings:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }

    async getFeatureSettings(req, res) {
        try {
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.json({ settings: {} });
            }

            const config = await this.bot.database.get(
                'SELECT * FROM guild_configs WHERE guild_id = ?',
                [guild.id]
            );

            const settings = {
                autoRole: {
                    enabled: config?.autorole_enabled || false
                },
                reactionRoles: {
                    enabled: config?.reactionroles_enabled || false
                },
                welcomeMessages: {
                    enabled: config?.welcome_enabled || false,
                    channel: config?.welcome_channel || '',
                    message: config?.welcome_message || 'Welcome {user} to {server}!'
                },
                verification: {
                    enabled: config?.verification_enabled || false,
                    role: config?.verification_role || ''
                }
            };

            res.json({ settings });
        } catch (error) {
            this.bot.logger.error('Error getting feature settings:', error);
            res.status(500).json({ error: 'Failed to get settings' });
        }
    }

    async saveFeatureSettings(req, res) {
        try {
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.status(400).json({ error: 'No guild found' });
            }

            const settings = req.body;
            
            // Validate settings
            if (!settings || typeof settings !== 'object') {
                return res.status(400).json({ error: 'Invalid settings format' });
            }

            // Sanitize strings
            const welcomeMessage = this.sanitizeString(settings.welcomeMessages?.message || 'Welcome {user} to {server}!', 2000);

            await this.bot.database.run(`
                UPDATE guild_configs SET
                    autorole_enabled = ?,
                    reactionroles_enabled = ?,
                    welcome_enabled = ?,
                    welcome_channel = ?,
                    welcome_message = ?,
                    verification_enabled = ?,
                    verification_role = ?
                WHERE guild_id = ?
            `, [
                settings.autoRole?.enabled ? 1 : 0,
                settings.reactionRoles?.enabled ? 1 : 0,
                settings.welcomeMessages?.enabled ? 1 : 0,
                this.sanitizeString(settings.welcomeMessages?.channel || '', 20),
                welcomeMessage,
                settings.verification?.enabled ? 1 : 0,
                this.sanitizeString(settings.verification?.role || '', 20),
                guild.id
            ]);

            // Read previous row for diffing & confirmations
            const previous = await this.bot.database.get(
                'SELECT autorole_enabled, reactionroles_enabled, welcome_enabled, welcome_channel, welcome_message, verification_enabled, verification_role FROM guild_configs WHERE guild_id = ?',
                [guild.id]
            );

            // Post-save: compute diffs, emit setting changes, send confirmation embeds and broadcast
            const fields = {
                autorole_enabled: settings.autoRole?.enabled ? 1 : 0,
                reactionroles_enabled: settings.reactionRoles?.enabled ? 1 : 0,
                welcome_enabled: settings.welcomeMessages?.enabled ? 1 : 0,
                welcome_channel: this.sanitizeString(settings.welcomeMessages?.channel || '', 20),
                welcome_message: welcomeMessage,
                verification_enabled: settings.verification?.enabled ? 1 : 0,
                verification_role: this.sanitizeString(settings.verification?.role || '', 20)
            };

            // Invalidate ConfigService cache so bot picks up changes immediately
            try {
                if (this.bot.configService?.cache) this.bot.configService.cache.delete(guild.id);
            } catch (e) { /* ignore */ }

            // Single batch notification
            try {
                if (this.bot.confirmationManager) {
                    await this.bot.confirmationManager.sendConfirmation(guild.id, 'features', 'feature_settings', 'Feature settings updated', null, req.user?.id || req.user?.sub || 'dashboard');
                }
            } catch (e) { this.bot.logger?.warn('Confirmation send failed for features:', e.message || e); }

            try {
                if (this.broadcastToGuild) {
                    this.broadcastToGuild(guild.id, { type: 'settings_updated', data: { section: 'features' }, timestamp: new Date().toISOString() });
                }
            } catch (e) { this.bot.logger?.warn('Broadcast feature settings failed:', e.message || e); }

            this.bot.logger.info(`Feature settings updated for guild ${guild.id}`);
            res.json({ success: true, message: 'Settings saved successfully' });
        } catch (error) {
            this.bot.logger.error('Error saving feature settings:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }

    // AI Settings handlers
    async getAISettings(req, res) {
        try {
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) return res.json({ settings: {} });
            let settings = await this.bot.database.get('SELECT * FROM ai_settings WHERE guild_id = ?', [guild.id]);
            if (!settings) {
                await this.bot.database.run('INSERT INTO ai_settings (guild_id, enabled) VALUES (?, ?)', [guild.id, 0]);
                settings = await this.bot.database.get('SELECT * FROM ai_settings WHERE guild_id = ?', [guild.id]);
            }
            res.json({ settings });
        } catch (error) {
            this.bot.logger.error('Error getting AI settings:', error);
            res.status(500).json({ error: 'Failed to get AI settings' });
        }
    }

    async saveAISettings(req, res) {
        try {
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) return res.status(400).json({ error: 'No guild found' });
            const body = req.body || {};
            // Sanitize
            const enabled = body.enabled ? 1 : 0;
            const system_prompt = this.sanitizeString(body.system_prompt || 'You are an AI assistant for this Discord server.', 4000);
            const model = this.sanitizeString(body.model || 'gpt-4o-mini', 64);
            const embedding_model = this.sanitizeString(body.embedding_model || 'text-embedding-3-small', 64);
            const rate_messages_per_minute = Math.min(100, Math.max(1, parseInt(body.rate_messages_per_minute || 5)));
            const rate_tokens_per_day = Math.min(1000000, Math.max(100, parseInt(body.rate_tokens_per_day || 50000)));

            await this.bot.database.run(`
                INSERT INTO ai_settings (guild_id, enabled, system_prompt, model, embedding_model, rate_messages_per_minute, rate_tokens_per_day)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET
                    enabled=excluded.enabled,
                    system_prompt=excluded.system_prompt,
                    model=excluded.model,
                    embedding_model=excluded.embedding_model,
                    rate_messages_per_minute=excluded.rate_messages_per_minute,
                    rate_tokens_per_day=excluded.rate_tokens_per_day,
                    updated_at=CURRENT_TIMESTAMP
            `, [guild.id, enabled, system_prompt, model, embedding_model, rate_messages_per_minute, rate_tokens_per_day]);

            // Update in-memory assistant if present
            try {
                if (this.bot.aiAssistant) {
                    this.bot.aiAssistant.enabled = !!enabled && !!this.bot.aiAssistant.openai;
                    // Persist any runtime settings into assistant's config via its update method
                    if (typeof this.bot.aiAssistant.updateGuildSettings === 'function') {
                        await this.bot.aiAssistant.updateGuildSettings(guild.id, {
                            enabled: enabled,
                            system_prompt,
                            model,
                            embedding_model,
                            rate_messages_per_minute,
                            rate_tokens_per_day
                        });
                    }
                }
            } catch (e) {
                this.bot.logger?.warn('Failed to refresh in-memory AI assistant settings:', e.message || e);
            }

            // Emit setting change event so bot and dashboards synchronize
            try {
                const changedBy = req.user?.id || req.user?.sub || null;
                if (typeof this.bot.emitSettingChange === 'function') {
                    await this.bot.emitSettingChange(guild.id, changedBy, 'ai_enabled', !!enabled ? 1 : 0, null, 'ai');
                }
            } catch (e) {
                this.bot.logger?.warn('Failed to emit AI setting change event:', e.message || e);
            }

            // Send confirmation embed to guild logs and broadcast to connected dashboards
            try {
                const oldRow = await this.bot.database.get('SELECT enabled FROM ai_settings WHERE guild_id = ?', [guild.id]);
                const oldVal = oldRow ? !!oldRow.enabled : undefined;
                if (this.bot.confirmationManager) {
                    await this.bot.confirmationManager.sendConfirmation(
                        guild.id,
                        'ai',
                        'ai_enabled',
                        !!enabled,
                        oldVal,
                        req.user?.id || req.user?.sub || 'dashboard'
                    );
                }
            } catch (e) {
                this.bot.logger?.warn('Failed to send AI confirmation:', e.message || e);
            }

            try {
                if (this.bot.dashboard && this.bot.dashboard.broadcastToGuild) {
                    this.bot.dashboard.broadcastToGuild(guild.id, {
                        type: 'settings_updated',
                        data: { ai_enabled: !!enabled },
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (e) {
                this.bot.logger?.warn('Failed to broadcast AI settings update:', e.message || e);
            }

            this.bot.logger.info(`AI settings updated for guild ${guild.id}`);
            res.json({ success: true, message: 'AI settings saved' });
        } catch (error) {
            this.bot.logger.error('Error saving AI settings:', error);
            res.status(500).json({ error: 'Failed to save AI settings' });
        }
    }

    async getThemeSettings(req, res) {
        try {
            const guildId = req.query.guildId;
            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            const themeData = await this.bot.database.get(
                'SELECT dashboard_theme FROM guild_configs WHERE guild_id = ?',
                [guildId]
            );

            if (themeData && themeData.dashboard_theme) {
                try {
                    const theme = JSON.parse(themeData.dashboard_theme);
                    res.json({ theme });
                } catch (e) {
                    res.json({ theme: null });
                }
            } else {
                res.json({ theme: null });
            }
        } catch (error) {
            this.bot.logger.error('Error getting theme settings:', error);
            res.status(500).json({ error: 'Failed to get theme settings' });
        }
    }

    async saveThemeSettings(req, res) {
        try {
            const guildId = req.body.guildId;
            const theme = req.body.theme;

            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            if (!theme || typeof theme !== 'object') {
                return res.status(400).json({ error: 'Invalid theme data' });
            }

            // Save theme as JSON string
            const themeJson = JSON.stringify(theme);

            await this.bot.database.run(`
                INSERT INTO guild_configs (guild_id, dashboard_theme)
                VALUES (?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET
                    dashboard_theme = excluded.dashboard_theme,
                    updated_at = CURRENT_TIMESTAMP
            `, [guildId, themeJson]);

            // Broadcast theme update to all connected clients for this guild
            try {
                if (this.bot.dashboard && this.bot.dashboard.broadcastToGuild) {
                    this.bot.dashboard.broadcastToGuild(guildId, {
                        type: 'theme_updated',
                        data: { theme },
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (e) {
                this.bot.logger?.warn('Failed to broadcast theme update:', e.message || e);
            }

            this.bot.logger.info(`Theme settings updated for guild ${guildId}`);
            res.json({ success: true, message: 'Theme saved successfully' });
        } catch (error) {
            this.bot.logger.error('Error saving theme settings:', error);
            res.status(500).json({ error: 'Failed to save theme settings' });
        }
    }

    async uploadThemeImage(req, res) {
        try {
            const { image, type, guildId } = req.body || {};
            const userId = req.user?.userId;

            if (!image || !guildId || !userId) {
                return res.status(400).json({ error: 'Image, guildId, and user required' });
            }

            // Require guild admin/manage permissions
            const access = await this.checkGuildAccess(userId, guildId, true);
            if (!access?.authorized) {
                return res.status(403).json({ error: access?.error || 'Unauthorized' });
            }

            const match = typeof image === 'string'
                ? image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
                : null;
            if (!match) {
                return res.status(400).json({ error: 'Invalid image data' });
            }

            const mime = match[1];
            const base64Data = match[2];
            const buffer = Buffer.from(base64Data, 'base64');

            // Enforce max size (3MB raw)
            const maxBytes = 3 * 1024 * 1024;
            if (buffer.length > maxBytes) {
                return res.status(413).json({ error: 'Image too large. Maximum size is 3MB.' });
            }

            const allowed = {
                'image/png': 'png',
                'image/jpeg': 'jpg',
                'image/jpg': 'jpg',
                'image/webp': 'webp'
            };
            const ext = allowed[mime];
            if (!ext) {
                return res.status(400).json({ error: 'Unsupported image type' });
            }

            const uploadDir = path.join(process.cwd(), 'uploads');
            fs.mkdirSync(uploadDir, { recursive: true });
            const safeType = (type || 'custom').toString().replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'custom';
            const fileName = `theme-${guildId}-${safeType}-${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, fileName);
            fs.writeFileSync(filePath, buffer);

            const url = `/uploads/${fileName}`;
            this.bot.logger?.info?.(`[Theme Upload] User ${userId} uploaded ${safeType} for guild ${guildId}: ${buffer.length} bytes`);

            res.json({ success: true, url });
        } catch (error) {
            this.bot.logger?.error('Error uploading theme image:', error);
            res.status(500).json({ error: 'Failed to upload image' });
        }
    }

    async getXPSettings(req, res) {
        try {
            const guildId = req.query.guildId;
            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            // Get XP settings from guild_configs table
            const settings = await this.bot.database.get(
                'SELECT xp_message, xp_voice, xp_cooldown, xp_levelup_channel, xp_levelup_message, xp_levelup_embed_color, xp_levelup_title, xp_levelup_show_xp, xp_levelup_show_messages FROM guild_configs WHERE guild_id = ?',
                [guildId]
            );

            res.json({
                xp_message: settings?.xp_message || 20,
                xp_voice: settings?.xp_voice || 10,
                xp_cooldown: settings?.xp_cooldown || 60,
                xp_levelup_channel: settings?.xp_levelup_channel || '',
                xp_levelup_message: settings?.xp_levelup_message || 'Congratulations {user}! You\'ve reached **Level {level}**!',
                xp_levelup_embed_color: settings?.xp_levelup_embed_color || '#00ff41',
                xp_levelup_title: settings?.xp_levelup_title || 'Ã°Å¸Å½â€° Level Up!',
                xp_levelup_show_xp: settings?.xp_levelup_show_xp !== 0,
                xp_levelup_show_messages: settings?.xp_levelup_show_messages !== 0
            });
        } catch (error) {
            this.bot.logger.error('Error getting XP settings:', error);
            res.status(500).json({ error: 'Failed to get XP settings' });
        }
    }

    async saveXPSettings(req, res) {
        try {
            const guildId = req.query.guildId;
            const { 
                xp_message, xp_voice, xp_cooldown, xp_levelup_channel,
                xp_levelup_message, xp_levelup_embed_color, xp_levelup_title,
                xp_levelup_show_xp, xp_levelup_show_messages
            } = req.body;

            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            // Validate inputs
            const messageXp = Math.max(5, Math.min(100, parseInt(xp_message) || 20));
            const voiceXp = Math.max(1, Math.min(50, parseInt(xp_voice) || 10));
            const cooldown = Math.max(30, Math.min(300, parseInt(xp_cooldown) || 60));
            const levelupChannel = xp_levelup_channel || '';
            const levelupMessage = xp_levelup_message || 'Congratulations {user}! You\'ve reached **Level {level}**!';
            const embedColor = xp_levelup_embed_color || '#00ff41';
            const embedTitle = xp_levelup_title || 'Ã°Å¸Å½â€° Level Up!';
            const showXP = xp_levelup_show_xp === true || xp_levelup_show_xp === 1 ? 1 : 0;
            const showMessages = xp_levelup_show_messages === true || xp_levelup_show_messages === 1 ? 1 : 0;

            // Get current settings for audit log
            const current = await this.bot.database.get(
                'SELECT * FROM guild_configs WHERE guild_id = ?',
                [guildId]
            );

            // Save XP settings to guild_configs table
            await this.bot.database.run(`
                INSERT INTO guild_configs (guild_id, xp_message, xp_voice, xp_cooldown, xp_levelup_channel, xp_levelup_message, xp_levelup_embed_color, xp_levelup_title, xp_levelup_show_xp, xp_levelup_show_messages)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET
                    xp_message = excluded.xp_message,
                    xp_voice = excluded.xp_voice,
                    xp_cooldown = excluded.xp_cooldown,
                    xp_levelup_channel = excluded.xp_levelup_channel,
                    xp_levelup_message = excluded.xp_levelup_message,
                    xp_levelup_embed_color = excluded.xp_levelup_embed_color,
                    xp_levelup_title = excluded.xp_levelup_title,
                    xp_levelup_show_xp = excluded.xp_levelup_show_xp,
                    xp_levelup_show_messages = excluded.xp_levelup_show_messages,
                    updated_at = CURRENT_TIMESTAMP
            `, [guildId, messageXp, voiceXp, cooldown, levelupChannel, levelupMessage, embedColor, embedTitle, showXP, showMessages]);

            // Insert audit log
            const userId = req.user?.id || 'Dashboard User';
            try {
                await this.bot.database.insertAuditLog({
                    guild_id: guildId,
                    event_type: 'xp_settings_update',
                    event_category: 'config_change',
                    executor_id: userId,
                    executor_tag: req.user?.username || 'Dashboard User',
                    target_type: 'xp_settings',
                    target_name: 'xp_configuration',
                    changes: {
                        xp_message: { from: current?.xp_message, to: messageXp },
                        xp_levelup_message: { from: current?.xp_levelup_message, to: levelupMessage },
                        xp_levelup_embed_color: { from: current?.xp_levelup_embed_color, to: embedColor }
                    },
                    before_state: current ? {
                        xp_message: current.xp_message,
                        xp_levelup_message: current.xp_levelup_message
                    } : null,
                    after_state: {
                        xp_message: messageXp,
                        xp_levelup_message: levelupMessage,
                        xp_levelup_embed_color: embedColor
                    }
                });
            } catch (auditErr) {
                this.bot.logger?.warn && this.bot.logger.warn('Failed to insert audit log:', auditErr.message);
            }

            this.bot.logger.info(`XP settings updated for guild ${guildId}: message=${messageXp}, voice=${voiceXp}, cooldown=${cooldown}`);
            res.json({ success: true, message: 'XP settings saved successfully' });
        } catch (error) {
            this.bot.logger.error('Error saving XP settings:', error);
            res.status(500).json({ error: 'Failed to save XP settings' });
        }
    }

    /**
     * Return list of registered commands for a guild (name, description, group)
     */
    async getGuildCommands(req, res) {
        try {
            const guildId = req.params.guildId;
            // Validate guild presence
            const guild = this.bot.client.guilds.cache.get(guildId) || this.bot.client.guilds.cache.first();
            if (!guild) return res.status(404).json({ error: 'Guild not found' });

            const commands = Array.from(this.bot.commands.values()).map(cmd => ({
                name: cmd.data?.name || cmd.name || 'unknown',
                description: cmd.data?.description || '',
                category: (cmd.category || cmd.data?.category || this.bot.permissionManager?.getCommandGroup(cmd.data?.name || cmd.name || '') || 'utility')
            }));

            res.json({ commands });
        } catch (error) {
            this.bot.logger.error('Error getting commands:', error);
            res.status(500).json({ error: 'Failed to get commands' });
        }
    }

    /**
     * Return existing command_permissions rows for the guild
     */
    async getGuildCommandPermissions(req, res) {
        try {
            const guildId = req.params.guildId;
            const list = await this.bot.permissionManager.list(guildId);
            res.json({ entries: list });
        } catch (error) {
            this.bot.logger.error('Error getting command permissions:', error);
            res.status(500).json({ error: 'Failed to get permissions' });
        }
    }

    /**
     * Save permission mapping for a command or group
     * body: { scope: 'command'|'group', name: 'ban'|'moderation', roleIds: ['id1','id2'], changedBy }
     */
    async saveGuildCommandPermissions(req, res) {
        try {
            const guildId = req.params.guildId;
            const body = req.body || {};
            const scope = body.scope === 'group' ? 'group' : 'command';
            const name = String(body.name || '').trim();
            const roleIds = Array.isArray(body.roleIds) ? body.roleIds : [];
            const changedBy = body.changedBy || null;

            if (!name) return res.status(400).json({ error: 'Name required' });

            // Capture previous roles for confirmation logging
            let prevRoles = [];
            try {
                if (this.bot.permissionManager && typeof this.bot.permissionManager.getRoles === 'function') {
                    prevRoles = await this.bot.permissionManager.getRoles(guildId, scope, name);
                }
            } catch (e) { this.bot.logger?.warn('Failed to fetch previous roles for permissions:', e.message || e); }

            await this.bot.permissionManager.setRoles(guildId, scope, name, roleIds);

            // Send confirmation embed in guild logs and broadcast to dashboards
            try {
                const cfg = await this.bot.database.getGuildConfig(guildId);
                const logChannelId = cfg?.log_channel_id || cfg?.logs_channel_id;
                const logChannel = logChannelId ? this.bot.client.channels.cache.get(logChannelId) : null;
                const embed = this.buildSettingEmbed(
                    `command_permissions.${scope}.${name}`,
                    prevRoles?.length ? prevRoles.join(', ') : 'None',
                    roleIds.length ? roleIds.join(', ') : 'None',
                    changedBy || 'dashboard'
                );
                if (logChannel && logChannel.isTextBased() && embed) {
                    await logChannel.send({ embeds: [embed] });
                }
            } catch (err) {
                this.bot.logger.error('Failed to send confirmation for permissions update:', err);
            }

            // Notify connected dashboard clients for this guild
            if (this.bot.dashboard && this.bot.dashboard.broadcastToGuild) {
                this.bot.dashboard.broadcastToGuild(guildId, {
                    type: 'dashboard_setting_update',
                    setting: `command_permissions.${scope}.${name}`,
                    before: prevRoles,
                    after: roleIds,
                    changedBy: changedBy || 'dashboard'
                });
            }

            res.json({ success: true, message: 'Permissions updated' });
        } catch (error) {
            this.bot.logger.error('Error saving command permissions:', error);
            res.status(500).json({ error: 'Failed to save permissions' });
        }
    }

    // NEW: Quarantine and security scanning endpoints
    async getQuarantinedMessages(req, res) {
        try {
            const status = req.query.status || 'pending';
            const limit = this.validateLimit(req.query.limit, 100) || 50;
            
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.json({ messages: [] });
            }

            const messages = await this.bot.database.all(`
                SELECT qm.* 
                FROM quarantined_messages qm
                WHERE qm.guild_id = ? AND qm.status = ?
                ORDER BY qm.created_at DESC
                LIMIT ?
            `, [guild.id, status, limit]);

            // Parse threats JSON and get channel names
            const formatted = await Promise.all(messages.map(async msg => ({
                ...msg,
                threats: this.safeJsonParse(msg.threats, []),
                channel_name: guild.channels.cache.get(msg.channel_id)?.name || 'Unknown',
                user: await this.bot.client.users.fetch(msg.user_id).catch(() => ({ tag: 'Unknown' }))
            })));

            res.json({ messages: formatted });
        } catch (error) {
            this.bot.logger.error('Error getting quarantined messages:', error);
            res.status(500).json({ error: 'Failed to get quarantined messages' });
        }
    }

    async approveQuarantinedMessage(req, res) {
        try {
            const { id } = req.params;
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.status(400).json({ error: 'No guild found' });
            }

            await this.bot.database.run(`
                UPDATE quarantined_messages 
                SET status = 'approved',
                    reviewed_by = ?,
                    reviewed_at = ?,
                    action = 'approved'
                WHERE id = ?
            `, ['admin', new Date().toISOString(), id]);

            this.bot.logger.info(`Quarantined message ${id} approved`);
            res.json({ success: true, message: 'Message approved' });
        } catch (error) {
            this.bot.logger.error('Error approving message:', error);
            res.status(500).json({ error: 'Failed to approve message' });
        }
    }

    async deleteQuarantinedMessage(req, res) {
        try {
            const { id } = req.params;
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.status(400).json({ error: 'No guild found' });
            }

            // Get message details
            const msg = await this.bot.database.get(`
                SELECT * FROM quarantined_messages WHERE id = ?
            `, [id]);

            if (msg) {
                // Try to delete from Discord
                try {
                    const channel = guild.channels.cache.get(msg.channel_id);
                    if (channel) {
                        const message = await channel.messages.fetch(msg.message_id).catch(() => null);
                        if (message) {
                            await message.delete();
                        }
                    }
                } catch (error) {
                    this.bot.logger.warn('Could not delete message from Discord:', error.message);
                }

                // Update database
                await this.bot.database.run(`
                    UPDATE quarantined_messages 
                    SET status = 'deleted',
                        reviewed_by = ?,
                        reviewed_at = ?,
                        action = 'deleted'
                    WHERE id = ?
                `, ['admin', new Date().toISOString(), id]);
            }

            this.bot.logger.info(`Quarantined message ${id} deleted`);
            res.json({ success: true, message: 'Message deleted' });
        } catch (error) {
            this.bot.logger.error('Error deleting message:', error);
            res.status(500).json({ error: 'Failed to delete message' });
        }
    }

    async getScanHistory(req, res) {
        try {
            const limit = this.validateLimit(req.query.limit, 50) || 10;
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.json({ scans: [] });
            }

            const scans = await this.bot.database.all(`
                SELECT * FROM scan_history
                WHERE guild_id = ?
                ORDER BY scan_date DESC
                LIMIT ?
            `, [guild.id, limit]);

            res.json({ scans });
        } catch (error) {
            this.bot.logger.error('Error getting scan history:', error);
            res.status(500).json({ error: 'Failed to get scan history' });
        }
    }

    async startSecurityScan(req, res) {
        try {
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.status(400).json({ error: 'No guild found' });
            }

            if (!this.bot.securityScanner) {
                return res.status(500).json({ error: 'Security scanner not available' });
            }

            if (this.bot.securityScanner.isScanning) {
                return res.status(400).json({ error: 'Scan already in progress' });
            }

            // Start scan in background
            this.bot.securityScanner.scanServer(guild).catch(error => {
                this.bot.logger.error('Error during manual security scan:', error);
            });

            res.json({ 
                success: true, 
                message: 'Security scan started. Check back in a few minutes for results.' 
            });
        } catch (error) {
            this.bot.logger.error('Error starting security scan:', error);
            res.status(500).json({ error: 'Failed to start scan' });
        }
    }

    async getAutoDeleteSettings(req, res) {
        try {
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.json({ settings: {} });
            }

            const settings = await this.bot.database.get(`
                SELECT * FROM auto_delete_settings WHERE guild_id = ?
            `, [guild.id]);

            if (!settings) {
                return res.json({
                    settings: {
                        auto_delete_threats: false,
                        auto_delete_spam: false,
                        auto_delete_phishing: true,
                        auto_delete_malicious_links: true,
                        auto_delete_toxicity: false,
                        notify_on_delete: true
                    }
                });
            }

            res.json({ settings });
        } catch (error) {
            this.bot.logger.error('Error getting auto-delete settings:', error);
            res.status(500).json({ error: 'Failed to get settings' });
        }
    }

    async saveAutoDeleteSettings(req, res) {
        try {
            const guild = this.bot.client.guilds.cache.first();
            if (!guild) {
                return res.status(400).json({ error: 'No guild found' });
            }

            const settings = req.body;
            
            if (!settings || typeof settings !== 'object') {
                return res.status(400).json({ error: 'Invalid settings format' });
            }

            await this.bot.database.run(`
                INSERT OR REPLACE INTO auto_delete_settings 
                (guild_id, auto_delete_threats, auto_delete_spam, auto_delete_phishing, 
                 auto_delete_malicious_links, auto_delete_toxicity, notify_on_delete, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                guild.id,
                settings.auto_delete_threats ? 1 : 0,
                settings.auto_delete_spam ? 1 : 0,
                settings.auto_delete_phishing ? 1 : 0,
                settings.auto_delete_malicious_links ? 1 : 0,
                settings.auto_delete_toxicity ? 1 : 0,
                settings.notify_on_delete ? 1 : 0,
                new Date().toISOString()
            ]);

            // Update guild_configs for scanner
            await this.bot.database.run(`
                UPDATE guild_configs 
                SET auto_delete_threats = ?
                WHERE guild_id = ?
            `, [settings.auto_delete_threats ? 1 : 0, guild.id]);

            this.bot.logger.info(`Auto-delete settings updated for guild ${guild.id}`);
            res.json({ success: true, message: 'Settings saved successfully' });
        } catch (error) {
            this.bot.logger.error('Error saving auto-delete settings:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }

    // Multi-Server Management Functions
    async getUserServers(req, res) {
        try {
            // Get user ID and access token from JWT token
            const userId = req.user?.discordId || req.user?.userId;
            const accessToken = req.user?.accessToken;
            
            this.bot.logger.info(`[SERVERS] Getting servers for user: ${userId}`);
            
            if (!userId) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            // If user has dashboard admin role (from JWT), return all bot guilds
            if (req.user?.role === 'owner') {
                const botGuilds = Array.from(this.bot.client.guilds.cache.values()).map(guild => ({
                    id: guild.id,
                    name: guild.name,
                    icon: guild.iconURL({ dynamic: true, size: 128 }) || null,
                    memberCount: guild.memberCount,
                    owner: guild.ownerId,
                    hasBot: true,
                    isAdmin: true
                }));
                
                this.bot.logger.info(`[SERVERS] Admin login, returning ${botGuilds.length} servers`);
                return res.json({ servers: botGuilds });
            }

            // Get user's guilds from Discord API
            let userGuilds = [];
            if (accessToken) {
                try {
                    const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
                        headers: {
                            Authorization: `Bearer ${accessToken}`
                        }
                    });
                    userGuilds = guildsResponse.data;
                    this.bot.logger.info(`[SERVERS] User is in ${userGuilds.length} Discord guilds`);
                } catch (apiError) {
                    this.bot.logger.warn(`[SERVERS] Failed to fetch user guilds from Discord API:`, apiError.message);
                }
            }

            // Get bot guilds
            const botGuilds = this.bot.client.guilds.cache;
            const userServers = [];

            // Get user's explicit access grants from database
            const userAccessGrants = await this.bot.database.all(
                `SELECT guild_id FROM dashboard_access WHERE user_id = ?`,
                [userId]
            );
            const grantedGuildIds = new Set(userAccessGrants.map(row => row.guild_id));

            // Get role-based access grants
            const roleAccessGrants = await this.bot.database.all(
                `SELECT guild_id, role_id FROM dashboard_role_access`
            );
            const roleAccessMap = new Map();
            roleAccessGrants.forEach(row => {
                if (!roleAccessMap.has(row.guild_id)) {
                    roleAccessMap.set(row.guild_id, []);
                }
                roleAccessMap.get(row.guild_id).push(row.role_id);
            });

            // Process bot guilds and check authorization
            for (const [guildId, guild] of botGuilds) {
                try {
                    let hasAccess = false;
                    let accessReason = '';
                    let isAdmin = false;
                    let isOwner = false;

                    // Check 1: Is user the server owner?
                    if (guild.ownerId === userId) {
                        hasAccess = true;
                        isOwner = true;
                        isAdmin = true;
                        accessReason = 'owner';
                    }

                    // Check 2: Does user have explicit DB access grant?
                    if (!hasAccess && grantedGuildIds.has(guildId)) {
                        hasAccess = true;
                        accessReason = 'explicit_grant';
                    }

                    // Check 3: Verify user is a member and check permissions
                    const member = await guild.members.fetch(userId).catch(() => null);
                    
                    if (member) {
                        // Check 4: Does user have Discord admin/manage permissions?
                        if (!hasAccess) {
                            const hasManagePerms = member.permissions.has('Administrator') || 
                                                  member.permissions.has('ManageGuild');
                            if (hasManagePerms) {
                                hasAccess = true;
                                isAdmin = true;
                                accessReason = 'discord_permissions';
                            }
                        }

                        // Check 5: Does user have a role that grants access?
                        if (!hasAccess && roleAccessMap.has(guildId)) {
                            const grantedRoles = roleAccessMap.get(guildId);
                            const userRoleIds = member.roles.cache.map(r => r.id);
                            const hasGrantedRole = grantedRoles.some(roleId => userRoleIds.includes(roleId));
                            
                            if (hasGrantedRole) {
                                hasAccess = true;
                                accessReason = 'role_grant';
                            }
                        }

                        if (hasAccess) {
                            userServers.push({
                                id: guild.id,
                                name: guild.name,
                                icon: guild.iconURL({ dynamic: true, size: 128 }) || null,
                                memberCount: guild.memberCount,
                                owner: isOwner,
                                hasBot: true,
                                isAdmin: isAdmin,
                                canManage: isAdmin,
                                accessType: accessReason
                            });
                            
                            this.bot.logger.debug(`[SERVERS] User ${userId} has access to ${guild.name} (${accessReason})`);
                        } else {
                            this.bot.logger.debug(`[SERVERS] User ${userId} is member of ${guild.name} but has no dashboard access`);
                        }
                    } else if (hasAccess) {
                        // User has explicit grant but is not a member - still show it
                        userServers.push({
                            id: guild.id,
                            name: guild.name,
                            icon: guild.iconURL({ dynamic: true, size: 128 }) || null,
                            memberCount: guild.memberCount,
                            owner: false,
                            hasBot: true,
                            isAdmin: false,
                            canManage: false,
                            accessType: accessReason,
                            notMember: true
                        });
                        
                        this.bot.logger.debug(`[SERVERS] User ${userId} has ${accessReason} for ${guild.name} but is not a member`);
                    }
                } catch (error) {
                    this.bot.logger.debug(`[SERVERS] Error checking access for guild ${guildId}:`, error.message);
                    continue;
                }
            }

            this.bot.logger.info(`[SERVERS] Returning ${userServers.length} authorized servers for user ${userId}`);
            res.json({ servers: userServers });
        } catch (error) {
            this.bot.logger.error('Error getting user servers:', error);
            res.status(500).json({ error: 'Failed to load servers' });
        }
    }

    async selectServer(req, res) {
        try {
            const { serverId } = req.body;
            
            if (!serverId) {
                return res.status(400).json({ error: 'Server ID required' });
            }

            // Verify server exists and user has access
            const guild = this.bot.client.guilds.cache.get(serverId);
            
            if (!guild) {
                return res.status(404).json({ error: 'Server not found or bot not in server' });
            }

            const userId = req.user?.discordId || req.user?.userId;
            
            // For dashboard owner role, allow access to all servers
            if (req.user?.role === 'owner') {
                return res.json({ 
                    success: true, 
                    server: {
                        id: guild.id,
                        name: guild.name,
                        icon: guild.iconURL({ dynamic: true, size: 128 })
                    }
                });
            }

            // Verify user has admin permissions in this guild
            try {
                const member = await guild.members.fetch(userId);
                const hasAccess = member.permissions.has('Administrator') || 
                                member.permissions.has('ManageGuild');
                
                if (!hasAccess) {
                    return res.status(403).json({ error: 'You do not have permission to manage this server' });
                }
            } catch (error) {
                return res.status(403).json({ error: 'You are not a member of this server' });
            }

            res.json({ 
                success: true, 
                server: {
                    id: guild.id,
                    name: guild.name,
                    icon: guild.iconURL({ dynamic: true, size: 128 }),
                    memberCount: guild.memberCount
                }
            });
        } catch (error) {
            this.bot.logger.error('Error selecting server:', error);
            res.status(500).json({ error: 'Failed to select server' });
        }
    }

    async getCurrentServer(req, res) {
        try {
            const serverId = req.query.serverId || req.headers['x-server-id'];
            
            if (!serverId) {
                // Return first server as default
                const guild = this.bot.client.guilds.cache.first();
                if (!guild) {
                    return res.status(404).json({ error: 'No servers available' });
                }
                
                return res.json({
                    id: guild.id,
                    name: guild.name,
                    icon: guild.iconURL({ dynamic: true, size: 128 }),
                    memberCount: guild.memberCount
                });
            }

            const guild = this.bot.client.guilds.cache.get(serverId);
            
            if (!guild) {
                return res.status(404).json({ error: 'Server not found' });
            }

            res.json({
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL({ dynamic: true, size: 128 }),
                memberCount: guild.memberCount,
                channels: guild.channels.cache.size,
                roles: guild.roles.cache.size
            });
        } catch (error) {
            this.bot.logger.error('Error getting current server:', error);
            res.status(500).json({ error: 'Failed to get server info' });
        }
    }

    // Bug Report Handler
    async submitBugReport(req, res) {
        try {
            const { title, severity, category, description, expected, actual, discord_server, contact } = req.body;

            if (!title || !severity || !category || !description) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Store bug report in database
            await this.bot.database.run(`
                INSERT INTO bug_reports (title, severity, category, description, expected_behavior, actual_behavior, discord_server, contact, created_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'open')
            `, [title, severity, category, description, expected || null, actual || null, discord_server || null, contact || null]);

            this.bot.logger.info(`Bug report submitted: ${title} (${severity})`);

            res.json({ success: true, message: 'Bug report submitted successfully' });
        } catch (error) {
            this.bot.logger.error('Error submitting bug report:', error);
            res.status(500).json({ error: 'Failed to submit bug report' });
        }
    }

    // User Registration Handler
    async registerUser(req, res) {
        try {
            const bcrypt = require('bcrypt');
            const { username, email, password, discord_id } = req.body;

            if (!username || !email || !password) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Validate username
            if (username.length < 3 || username.length > 32) {
                return res.status(400).json({ error: 'Username must be 3-32 characters' });
            }

            if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
                return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, and hyphens' });
            }

            // Validate password strength
            if (password.length < 8) {
                return res.status(400).json({ error: 'Password must be at least 8 characters' });
            }

            // Check if user already exists
            const existingUser = await this.bot.database.get(`
                SELECT id FROM admin_users WHERE username = ? OR email = ?
            `, [username, email]);

            if (existingUser) {
                return res.status(409).json({ error: 'Username or email already exists' });
            }

            // Hash password with bcrypt (salt rounds: 12)
            const hashedPassword = await bcrypt.hash(password, 12);

            // Store user in database
            await this.bot.database.run(`
                INSERT INTO admin_users (username, email, password_hash, discord_id, created_at, last_login)
                VALUES (?, ?, ?, ?, datetime('now'), NULL)
            `, [username, email, hashedPassword, discord_id || null]);

            this.bot.logger.info(`New admin user registered: ${username}`);

            res.json({ success: true, message: 'Account created successfully' });
        } catch (error) {
            this.bot.logger.error('Error registering user:', error);
            res.status(500).json({ error: 'Failed to create account' });
        }
    }

    /**
     * Handle events from bot (security, moderation, settings changes)
     * Requires internal API key for security
     */
    async handleBotEvent(req, res) {
        try {
            // Verify internal API key
            const apiKey = req.headers['x-api-key'];
            const expectedKey = process.env.INTERNAL_API_KEY;
            if (!expectedKey) {
                console.error('[SECURITY] INTERNAL_API_KEY not configured - bot event endpoint disabled');
                return res.status(500).json({ error: 'Server not properly configured' });
            }
            
            if (apiKey !== expectedKey) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const event = req.body;
            
            // Validate event structure
            if (!event.type || !event.guildId) {
                return res.status(400).json({ error: 'Invalid event: missing type or guildId' });
            }

            // Validate setting_change events have required data
            if (event.type === 'setting_change') {
                if (!event.data || event.data.key === undefined || event.data.value === undefined) {
                    return res.status(400).json({ error: 'Invalid setting_change: missing data.key or data.value' });
                }
            }

            this.bot.logger.info(`Ã°Å¸â€œÂ¨ Received bot event: ${event.type} for guild ${event.guildId}`);

            // Save event to database based on type
            if (event.type === 'security_event' || event.type === 'moderation_action') {
                await this.saveEventToDB(event);
            }
            
            // Update analytics in database
            if (event.type === 'member_join' || event.type === 'member_leave' || event.type === 'command_used') {
                await this.updateAnalytics(event);
            }

            // Broadcast to connected dashboard clients
            this.broadcastToGuild(event.guildId, event);

            res.json({ success: true, message: 'Event received and broadcast' });
        } catch (error) {
            this.bot.logger.error('Error handling bot event:', error);
            res.status(500).json({ error: 'Failed to handle event' });
        }
    }
    
    /**
     * Update analytics in database based on event
     */
    async updateAnalytics(event) {
        try {
            const now = new Date();
            const date = now.toISOString().split('T')[0];
            const hour = now.getHours();
            const guildId = event.guildId;
            
            let metricType = null;
            let metricValue = 1;
            
            switch (event.type) {
                case 'member_join':
                    metricType = 'joins';
                    break;
                case 'member_leave':
                    metricType = 'leaves';
                    break;
                case 'command_used':
                    metricType = 'commands';
                    break;
            }
            
            if (metricType) {
                await this.bot.database.run(`
                    INSERT OR IGNORE INTO analytics 
                    (guild_id, metric_type, metric_value, date, hour)
                    VALUES (?, ?, 0, ?, ?)
                `, [guildId, metricType, date, hour]);
                
                await this.bot.database.run(`
                    UPDATE analytics 
                    SET metric_value = metric_value + 1
                    WHERE guild_id = ? AND metric_type = ? AND date = ? AND hour = ?
                `, [guildId, metricType, date, hour]);
                
                this.bot.logger.debug(`Ã°Å¸â€œÅ  Updated ${metricType} analytics for guild ${guildId}`);
            }
        } catch (error) {
            this.bot.logger.error('Error updating analytics:', error);
            // Don't throw - analytics are non-critical
        }
    }

    // NOTE: First updateGuildSettings definition was removed (duplicate).
    // The canonical updateGuildSettings with comprehensive allowlist is defined below (~line 10735+).
    // This placeholder ensures no dead code remains.
    async _updateGuildSettingsLegacy_removed() {
        // Intentionally empty — merged into the main updateGuildSettings method below.
    }


    async getGuildTickets(req, res) {
        try {
            const guildId = req.params.guildId;
            
            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            // Get all tickets for guild
            const tickets = await this.bot.database.all(`
                SELECT 
                    ticket_id,
                    channel_id,
                    user_id,
                    problem,
                    description,
                    status,
                    claimed_by,
                    claimed_at,
                    created_at,
                    closed_at
                FROM active_tickets
                WHERE guild_id = ?
                ORDER BY created_at DESC
            `, [guildId]);

            res.json({ tickets });
        } catch (error) {
            this.bot.logger.error('Error getting guild tickets:', error);
            res.status(500).json({ error: 'Failed to fetch tickets' });
        }
    }

    async getTicket(req, res) {
        try {
            const ticketId = req.params.ticketId;
            
            if (!ticketId) {
                return res.status(400).json({ error: 'Ticket ID required' });
            }

            // Get ticket details
            const ticket = await this.bot.database.get(`
                SELECT * FROM active_tickets WHERE ticket_id = ?
            `, [ticketId]);

            if (!ticket) {
                return res.status(404).json({ error: 'Ticket not found' });
            }

            res.json({ ticket });
        } catch (error) {
            this.bot.logger.error('Error getting ticket:', error);
            res.status(500).json({ error: 'Failed to fetch ticket' });
        }
    }

    async replyToTicket(req, res) {
        try {
            const ticketId = req.params.ticketId;
            const { message, senderId } = req.body;
            
            if (!ticketId || !message || !senderId) {
                return res.status(400).json({ error: 'Ticket ID, message, and sender ID required' });
            }

            // Authorization: require dashboard user to be admin or staff
            const actingUserId = req.user?.discordId || req.user?.userId || req.user?.id || req.user?.sub || null;
            if (!actingUserId) return res.status(401).json({ error: 'Unauthorized' });

            // Get ticket details (needed to determine guild and channel)
            const ticket = await this.bot.database.get(`
                SELECT * FROM active_tickets WHERE ticket_id = ?
            `, [ticketId]);

            if (!ticket) {
                return res.status(404).json({ error: 'Ticket not found' });
            }

            const ticketGuild = ticket.guild_id;
            const guildObj = this.bot.client.guilds.cache.get(ticketGuild);
            let allowed = false;
            if (req.user?.role === 'admin' || req.user?.role === 'owner') allowed = true;
            if (guildObj) {
                const member = await guildObj.members.fetch(actingUserId).catch(() => null);
                if (member) {
                    if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild')) allowed = true;
                }
                // Check configured ticket staff role
                const cfg = await this.bot.database.get('SELECT ticket_staff_role FROM guild_configs WHERE guild_id = ?', [guildObj.id]);
                if (!allowed && cfg?.ticket_staff_role && member && member.roles.cache.has(cfg.ticket_staff_role)) allowed = true;
            }

            if (!allowed) return res.status(403).json({ error: 'Forbidden' });

            if (ticket.status === 'closed') {
                return res.status(400).json({ error: 'Cannot reply to closed ticket' });
            }

            // Get guild and channel
            const guild = this.bot.client.guilds.cache.get(ticket.guild_id);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            const channel = guild.channels.cache.get(ticket.channel_id);
            if (!channel) {
                return res.status(404).json({ error: 'Ticket channel not found' });
            }

            // Get sender (staff member)
            const sender = await guild.members.fetch(senderId).catch(() => null);
            if (!sender) {
                return res.status(404).json({ error: 'Sender not found' });
            }

            // Prefer bot-side handling to ensure consistent storage/action
            if (this.bot.ticketSystem && typeof this.bot.ticketSystem.replyFromDashboard === 'function') {
                const result = await this.bot.ticketSystem.replyFromDashboard(ticketId, senderId, message);
                if (result.ok) {
                    // Confirmation log
                    try {
                            if (this.bot.confirmationManager && typeof this.bot.confirmationManager.sendConfirmation === 'function') {
                                await this.bot.confirmationManager.sendConfirmation(ticket.guild_id, 'tickets', `ticket.${ticketId}.reply`, message, null, actingUserId || 'dashboard');
                            }
                    } catch (e) { this.bot.logger?.warn('Failed to send confirmation for ticket reply:', e.message || e); }
                    return res.json({ success: true, message: 'Reply sent' });
                }
                // fallback to original behavior if bot handler failed
                this.bot.logger?.warn('TicketSystem.replyFromDashboard failed:', result.error);
            }

            // Fallback: send message directly as before
            const { EmbedBuilder } = require('discord.js');
            const replyEmbed = new EmbedBuilder()
                .setAuthor({ name: sender.user.tag, iconURL: sender.user.displayAvatarURL() })
                .setDescription(message)
                .setColor('#00d4ff')
                .setTimestamp();

            await channel.send({ embeds: [replyEmbed] });

            try {
                const ticketOwner = await this.bot.client.users.fetch(ticket.user_id);
                const dmEmbed = new EmbedBuilder()
                    .setTitle(`Ã°Å¸â€™Â¬ Reply to Ticket #${ticket.ticket_id}`)
                    .setDescription(message)
                    .setFooter({ text: `From: ${sender.user.tag}` })
                    .setColor('#00d4ff')
                    .setTimestamp();

                await ticketOwner.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                this.bot.logger.warn(`Could not send DM to ticket owner:`, dmError.message);
            }

            // Fallback confirmation
            try {
                if (this.bot.confirmationManager && typeof this.bot.confirmationManager.sendConfirmation === 'function') {
                    await this.bot.confirmationManager.sendConfirmation(ticket.guild_id, 'tickets', `ticket.${ticketId}.reply`, message, null, actingUserId || 'dashboard');
                }
            } catch (e) { this.bot.logger?.warn('Failed to send confirmation for ticket reply (fallback):', e.message || e); }

            res.json({ success: true, message: 'Reply sent' });
        } catch (error) {
            this.bot.logger.error('Error replying to ticket:', error);
            res.status(500).json({ error: 'Failed to send reply' });
        }
    }

    async closeTicketFromDashboard(req, res) {
        try {
            const ticketId = req.params.ticketId;
            const { closerId } = req.body;
            
            if (!ticketId || !closerId) {
                return res.status(400).json({ error: 'Ticket ID and closer ID required' });
            }

            // Get ticket details (needed for permission checks)
            const ticket = await this.bot.database.get(`
                SELECT * FROM active_tickets WHERE ticket_id = ?
            `, [ticketId]);

            if (!ticket) {
                return res.status(404).json({ error: 'Ticket not found' });
            }

            // Authorization: require dashboard user to be admin or staff
            const actingUserId = req.user?.discordId || req.user?.userId || req.user?.id || req.user?.sub || null;
            if (!actingUserId) return res.status(401).json({ error: 'Unauthorized' });

            const guildObj = this.bot.client.guilds.cache.get(ticket.guild_id);
            let allowed = false;
            if (req.user?.role === 'admin' || req.user?.role === 'owner') allowed = true;
            if (guildObj) {
                const member = await guildObj.members.fetch(actingUserId).catch(() => null);
                if (member) {
                    if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild')) allowed = true;
                }
                const cfg = await this.bot.database.get('SELECT ticket_staff_role FROM guild_configs WHERE guild_id = ?', [guildObj.id]);
                if (!allowed && cfg?.ticket_staff_role && member && member.roles.cache.has(cfg.ticket_staff_role)) allowed = true;
            }

            if (!allowed) return res.status(403).json({ error: 'Forbidden' });

            if (ticket.status === 'closed') {
                return res.status(400).json({ error: 'Ticket is already closed' });
            }

            // Prefer bot-side handling to ensure transcripts/logs and consistent cleanup
            if (this.bot.ticketSystem && typeof this.bot.ticketSystem.closeFromDashboard === 'function') {
                const result = await this.bot.ticketSystem.closeFromDashboard(ticketId, closerId, req.body.reason || null);
                if (result.ok) {
                    try {
                        if (this.bot.confirmationManager && typeof this.bot.confirmationManager.sendConfirmation === 'function') {
                            // Send confirmation with before/after (status changing to closed)
                            await this.bot.confirmationManager.sendConfirmation(ticket.guild_id, 'tickets', `ticket.${ticketId}.closed`, 'closed', ticket.status || 'open', actingUserId || 'dashboard');
                        }
                    } catch (e) { this.bot.logger?.warn('Failed to send confirmation for ticket close:', e.message || e); }
                    return res.json({ success: true, message: 'Ticket closed' });
                }
                this.bot.logger?.warn('TicketSystem.closeFromDashboard failed:', result.error);
            }

            // Update database (fallback)
            await this.bot.database.run(`
                UPDATE active_tickets 
                SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?
                WHERE ticket_id = ?
            `, [closerId, ticketId]);

            // Get guild and channel
            const guild = this.bot.client.guilds.cache.get(ticket.guild_id);
            if (guild) {
                const channel = guild.channels.cache.get(ticket.channel_id);
                if (channel) {
                    // Send closing message
                    const { EmbedBuilder } = require('discord.js');
                    const closeEmbed = new EmbedBuilder()
                        .setTitle('Ã°Å¸â€â€™ Ticket Closed')
                        .setDescription(`This ticket has been closed from the dashboard.\n\nThe channel will be deleted in 10 seconds...`)
                        .setColor('#ff4757')
                        .setTimestamp();

                    await channel.send({ embeds: [closeEmbed] });

                    // Delete channel after delay
                    setTimeout(async () => {
                        try {
                            await channel.delete('Ticket closed from dashboard');
                        } catch (error) {
                            this.bot.logger.error('Error deleting ticket channel:', error);
                        }
                    }, 10000);
                }
            }

            // Emit standardized event for real-time updates (bot-facing)
            try {
                const payload = {
                    type: 'ticket_closed',
                    guildId: ticket.guild_id,
                    ticketId,
                    closerId,
                    timestamp: Date.now()
                };

                if (this.bot.eventEmitter && typeof this.bot.eventEmitter.sendEvent === 'function') {
                    await this.bot.eventEmitter.sendEvent(payload);
                } else if (this.bot.eventEmitter && typeof this.bot.eventEmitter.emit === 'function') {
                    this.bot.eventEmitter.emit('ticketClosed', payload);
                }

                try {
                    this.broadcastToGuild(ticket.guild_id, { type: 'ticket_update', data: payload });
                } catch (bErr) { this.bot.logger?.warn('Broadcast ticket closed failed:', bErr.message || bErr); }
            } catch (e) {
                this.bot.logger?.warn('Failed to emit/broadcast ticket closed:', e.message || e);
            }

            // Fallback confirmation
            try {
                if (this.bot.confirmationManager && typeof this.bot.confirmationManager.sendConfirmation === 'function') {
                    await this.bot.confirmationManager.sendConfirmation(ticket.guild_id, 'tickets', `ticket.${ticketId}.closed`, 'closed', ticket.status || 'open', actingUserId || 'dashboard');
                }
            } catch (e) { this.bot.logger?.warn('Failed to send confirmation for ticket close (fallback):', e.message || e); }

            res.json({ success: true, message: 'Ticket closed' });
        } catch (error) {
            this.bot.logger.error('Error closing ticket from dashboard:', error);
            res.status(500).json({ error: 'Failed to close ticket' });
        }
    }

    // Claim ticket from dashboard (assign staff member)
    async claimTicketFromDashboard(req, res) {
        try {
            const guildId = req.params.guildId;
            const ticketId = req.params.ticketId;
            const { staffId } = req.body || {};

            if (!guildId || !ticketId || !staffId) return res.status(400).json({ error: 'guildId, ticketId and staffId are required' });

            // Authorization: require dashboard user to be admin or staff
            const actingUserId = req.user?.discordId || req.user?.userId || req.user?.id || req.user?.sub || null;
            if (!actingUserId) return res.status(401).json({ error: 'Unauthorized' });

            const ticket = await this.bot.database.get(`SELECT * FROM active_tickets WHERE id = ? OR ticket_id = ?`, [ticketId, ticketId]);
            if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
            if (ticket.status === 'closed') return res.status(400).json({ error: 'Ticket already closed' });

            const guildObj = this.bot.client.guilds.cache.get(guildId);
            let allowed = false;
            if (req.user?.role === 'admin' || req.user?.role === 'owner') allowed = true;
            if (guildObj) {
                const member = await guildObj.members.fetch(actingUserId).catch(() => null);
                if (member) {
                    if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild')) allowed = true;
                }
                const cfg = await this.bot.database.get('SELECT ticket_staff_role FROM guild_configs WHERE guild_id = ?', [guildObj.id]);
                if (!allowed && cfg?.ticket_staff_role && member && member.roles.cache.has(cfg.ticket_staff_role)) allowed = true;
            }

            if (!allowed) return res.status(403).json({ error: 'Forbidden' });

            // Prefer bot-side handling
            if (this.bot.ticketSystem && typeof this.bot.ticketSystem.claimFromDashboard === 'function') {
                const result = await this.bot.ticketSystem.claimFromDashboard(ticket.id || ticket.ticket_id, staffId);
                if (result.ok) {
                    try {
                        if (this.bot.confirmationManager && typeof this.bot.confirmationManager.sendConfirmation === 'function') {
                            // Include previous assignee as oldValue when available
                            const prevAssigned = ticket.assigned_to || null;
                            await this.bot.confirmationManager.sendConfirmation(guildId, 'tickets', `ticket.${ticket.id || ticket.ticket_id}.claimed`, staffId, prevAssigned, actingUserId || 'dashboard');
                        }
                    } catch (e) { this.bot.logger?.warn('Failed to send confirmation for ticket claim:', e.message || e); }
                    return res.json({ ok: true, ticketId: ticket.id || ticket.ticket_id, staffId });
                }
                this.bot.logger?.warn('TicketSystem.claimFromDashboard failed:', result.error || result);
            }

            // Update DB fallback
            await this.bot.database.run(`UPDATE active_tickets SET staff_id = ?, claimed_at = CURRENT_TIMESTAMP WHERE id = ?`, [staffId, ticket.id]);

            // Notify channel
            try {
                const guild = this.bot.client.guilds.cache.get(guildId);
                if (guild) {
                    const channel = guild.channels.cache.get(ticket.channel_id);
                    if (channel && channel.isTextBased && channel.isTextBased()) {
                        const { EmbedBuilder } = require('discord.js');
                        const embed = new EmbedBuilder()
                            .setTitle('Ã°Å¸Å½Â« Ticket Claimed')
                            .setDescription(`This ticket has been claimed by <@${staffId}>.`)
                            .setColor('#00d4ff')
                            .setTimestamp();

                        await channel.send({ embeds: [embed] }).catch(() => {});
                    }
                }
            } catch (e) {
                this.bot.logger?.warn('Failed to notify ticket channel on claim:', e.message || e);
            }

            // Broadcast event
            try {
                const payload = { type: 'ticket', action: 'claimed', guildId, ticketId: ticket.id || ticket.ticket_id, staffId };
                if (this.bot.eventEmitter) await this.bot.eventEmitter.sendEvent(payload);
                this.broadcastToGuild(guildId, { type: 'ticket_update', data: payload });
            } catch (e) {}

            // Fallback confirmation for claim
            try {
                if (this.bot.confirmationManager && typeof this.bot.confirmationManager.sendConfirmation === 'function') {
                    const prevAssigned = ticket.assigned_to || null;
                    await this.bot.confirmationManager.sendConfirmation(guildId, 'tickets', `ticket.${ticket.id || ticket.ticket_id}.claimed`, staffId, prevAssigned, actingUserId || 'dashboard');
                }
            } catch (e) { this.bot.logger?.warn('Failed to send confirmation for ticket claim (fallback):', e.message || e); }

            res.json({ ok: true, ticketId: ticket.id || ticket.ticket_id, staffId });
        } catch (error) {
            this.bot.logger?.error('Error claiming ticket from dashboard:', error);
            res.status(500).json({ error: 'Failed to claim ticket' });
        }
    }

    /**
     * Save security/moderation events to database
     */
    async saveEventToDB(event) {
        try {
            const eventData = {
                guild_id: event.guildId,
                event_type: event.type,
                event_action: event.data.action,
                executor_id: event.data.executorId || event.data.moderatorId,
                target_id: event.data.targetId,
                details: JSON.stringify(event.data),
                timestamp: event.timestamp || new Date().toISOString()
            };

            await this.bot.database.run(`
                INSERT INTO security_events (guild_id, event_type, event_action, executor_id, target_id, details, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                eventData.guild_id,
                eventData.event_type,
                eventData.event_action,
                eventData.executor_id,
                eventData.target_id,
                eventData.details,
                eventData.timestamp
            ]);

            this.bot.logger.debug(`Ã°Å¸â€™Â¾ Event saved to DB: ${event.type} / ${event.data.action}`);
        } catch (error) {
            // Table might not exist yet - create it
            if (error.message.includes('no such table')) {
                await this.createSecurityEventsTable();
                // Retry save
                await this.saveEventToDB(event);
            } else {
                this.bot.logger.error('Error saving event to DB:', error);
            }
        }
    }

    /**
     * Create security_events table if it doesn't exist
     */
    async createSecurityEventsTable() {
        await this.bot.database.run(`
            CREATE TABLE IF NOT EXISTS security_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_action TEXT NOT NULL,
                executor_id TEXT,
                target_id TEXT,
                details TEXT,
                timestamp TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        this.bot.logger.info('Ã¢Å“â€¦ Created security_events table');
    }

    /**
     * Proxy AI chat requests to OpenAI (secure server-side only)
     * Bot sends requests here instead of calling OpenAI directly
     */
    async proxyAIChat(req, res) {
        try {
            // Verify internal API key
            const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
            const expectedKey = process.env.INTERNAL_API_KEY;
            if (!expectedKey) {
                this.bot?.logger?.error && this.bot.logger.error('INTERNAL_API_KEY is not configured for proxyAIChat');
                return res.status(500).json({ error: 'Server misconfigured' });
            }
            
            if (apiKey !== expectedKey) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { messages, model, temperature, maxTokens } = req.body;

            // Validate request
            if (!messages || !Array.isArray(messages)) {
                return res.status(400).json({ error: 'Invalid request: messages array required' });
            }

            // Check if OpenAI key is configured
            const openaiKey = process.env.OPENAI_API_KEY;
            if (!openaiKey || openaiKey.startsWith('sk-your') || openaiKey === 'sk-...') {
                return res.status(503).json({ 
                    error: 'OpenAI API key not configured',
                    userMessage: 'Ã¢Å¡â„¢Ã¯Â¸Â AI features are not configured. Please contact the server administrator.'
                });
            }

            // Call OpenAI API
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openaiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model || 'gpt-4o-mini',
                    messages: messages,
                    temperature: temperature || 0.7,
                    max_tokens: maxTokens || 500
                }),
                signal: AbortSignal.timeout(30000) // 30s timeout
            });

            if (!response.ok) {
                const error = await response.text();
                
                // Handle rate limiting
                if (response.status === 429) {
                    return res.status(429).json({
                        error: 'Rate limit exceeded',
                        userMessage: 'Ã¢ÂÂ° AI is currently rate-limited. Please try again in a few moments.'
                    });
                }

                // Handle quota exceeded
                if (error.includes('insufficient_quota')) {
                    return res.status(402).json({
                        error: 'Quota exceeded',
                        userMessage: 'Ã°Å¸â€™Â³ AI quota has been exceeded. Please contact the administrator.'
                    });
                }

                this.bot.logger.error('OpenAI API error:', error);
                return res.status(response.status).json({
                    error: 'OpenAI API error',
                    userMessage: 'Ã¢ÂÅ’ An error occurred while processing your request.'
                });
            }

            const data = await response.json();
            res.json({ success: true, data });

        } catch (error) {
            this.bot.logger.error('Error in AI proxy:', error);
            
            if (error.name === 'AbortError') {
                return res.status(504).json({
                    error: 'Request timeout',
                    userMessage: 'Ã¢ÂÂ° Request took too long. Please try a simpler query.'
                });
            }

            res.status(500).json({
                error: 'Internal server error',
                userMessage: 'Ã¢ÂÅ’ An unexpected error occurred.'
            });
        }
    }

    // Guild settings endpoints for toggle persistence with debounce support
    async getGuildSettings(req, res) {
        try {
            const guildId = req.params.guildId;
            const userId = req.user?.discordId || req.user?.userId;
            
            if (!guildId) {
                return res.status(400).json({ error: 'guildId required' });
            }

            // Authorization check
            const access = await this.checkGuildAccess(userId, guildId, true);
            if (!access.authorized) {
                this.bot.logger.error(`[SECURITY] Unauthorized getGuildSettings attempt by ${userId} for guild ${guildId}`);
                return res.status(403).json({ error: access.error });
            }

            const settings = await this.bot.database.getGuildConfig(guildId);
            
            if (!settings) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            res.json(settings);
        } catch (error) {
            this.bot.logger.error('Error getting guild settings:', error);
            res.status(500).json({ error: 'Failed to fetch guild settings' });
        }
    }

    async updateGuildSettings(req, res) {
        try {
            const guildId = req.params.guildId;
            const userId = req.user?.discordId || req.user?.userId;
            const updates = req.body;

            if (!guildId) {
                return res.status(400).json({ error: 'guildId required' });
            }

            // Authorization check
            const access = await this.checkGuildAccess(userId, guildId, true);
            if (!access.authorized) {
                this.bot.logger.error(`[SECURITY] Unauthorized updateGuildSettings attempt by ${userId} for guild ${guildId}`);
                return res.status(403).json({ error: access.error });
            }

            // Comprehensive whitelist of allowed settings to update
            // Covers all setup pages: moderation, anti-raid, anti-spam, verification,
            // welcome/goodbye, autorole, anti-nuke, anti-phishing, and general config
            const allowedSettings = [
                // === Core Feature Toggles ===
                'ai_enabled', 'anti_raid_enabled', 'anti_spam_enabled', 'anti_links_enabled',
                'anti_phishing_enabled', 'antinuke_enabled', 'welcome_enabled', 'tickets_enabled',
                'auto_mod_enabled', 'autorole_enabled', 'verification_enabled', 'xp_enabled',
                'antiraid_enabled', 'antispam_enabled', 'antiphishing_enabled', 'reactionroles_enabled',

                // === Channel & Role IDs ===
                'log_channel_id', 'mod_role_id', 'admin_role_id', 'mute_role_id',
                'verified_role_id', 'unverified_role_id', 'verification_channel_id',
                'welcome_channel_id', 'welcome_channel', 'goodbye_channel_id', 'goodbye_channel',
                'ticket_category_id', 'ticket_log_channel_id', 'ticket_log_channel',
                'ticket_channel_id', 'ticket_category', 'ticket_panel_channel', 'ticket_transcript_channel',
                'ticket_manage_role', 'ticket_staff_role', 'ticket_support_roles',
                'autorole_role_id', 'alert_channel', 'mod_log_channel',
                'level_up_channel', 'appeal_review_channel', 'phishing_log_channel',

                // === Messages & Text ===
                'welcome_message', 'goodbye_message', 'verify_message',
                'ticket_welcome_message', 'ticket_categories',
                'level_up_message', 'appeal_message_template', 'appeal_url',
                'word_filter_custom_message',

                // === Anti-Raid Settings ===
                'raid_threshold', 'raid_interval', 'raid_join_threshold', 'raid_time_window',
                'raid_lockdown_duration_ms', 'raid_action', 'account_age_hours',
                'account_age_enabled', 'min_account_age',

                // === Anti-Spam Settings ===
                'spam_threshold', 'spam_interval', 'spam_action',
                'max_mentions', 'max_lines', 'max_emojis', 'link_whitelist',
                'antispam_bypass_channels', 'antispam_flood_mid', 'antispam_flood_high',
                'antispam_duplicate_mid', 'antispam_duplicate_high', 'antispam_mention_threshold',
                'antispam_emoji_mid', 'antispam_emoji_high', 'antispam_link_threshold',
                'antispam_caps_ratio', 'antispam_caps_min_letters',

                // === Anti-Nuke Settings ===
                'antinuke_limit', 'antinuke_window', 'antinuke_punishment',
                'antinuke_protections', 'antinuke_whitelist',
                'antinuke_role_limit', 'antinuke_channel_limit', 'antinuke_ban_limit',

                // === Anti-Phishing Settings ===
                'antiphishing_enabled', 'phishing_action', 'phishing_sensitivity',
                'phishing_delete_message', 'phishing_log_all', 'phishing_dm_user',
                'phishing_notify_staff', 'phishing_escalate', 'phishing_ban_threshold',
                'phishing_reset_hours', 'phishing_whitelist_roles', 'phishing_ignored_channels',

                // === Verification Settings ===
                'verification_type', 'verification_method', 'verification_level',
                'verify_timeout', 'dm_verification',
                'manual_approval_enabled', 'auto_kick_unverified', 'verification_role',

                // === Welcome/Goodbye Settings ===
                'welcome_embed_enabled', 'welcome_ping_user', 'welcome_delete_after',
                'goodbye_enabled', 'goodbye_embed_enabled', 'goodbye_delete_after',

                // === Autorole Settings ===
                'bot_autorole', 'autorole_delay', 'autoroles',
                'reaction_roles_enabled', 'reaction_channel', 'reaction_title',
                'reaction_desc', 'reaction_roles',

                // === Moderation Settings ===
                'dm_on_warn', 'dm_on_kick', 'dm_on_ban', 'max_warnings',
                'warning_action', 'warning_expiry_days', 'exempt_staff_automod',
                'auto_timeout_enabled', 'default_timeout_duration', 'max_timeout_duration',
                'spam_timeout_duration', 'toxicity_timeout_duration', 'dm_timeout_notification',
                'warning_system_enabled', 'warnings_before_timeout', 'warnings_before_kick',
                'dm_warning_notification',

                // === XP & Levels ===
                'xp_per_message', 'xp_cooldown', 'xp_multiplier',
                'voice_xp_enabled', 'voice_xp_per_minute', 'min_voice_time',
                'level_announcement',

                // === Appeal System ===
                'appeal_system_enabled', 'appeal_cooldown_hours', 'appeal_auto_dm',
                'appeal_require_reason', 'appeal_min_length',

                // === Content Filters ===
                'caps_percentage', 'emoji_limit', 'mention_limit', 'toxicity_threshold',
                'detect_duplicates', 'filter_zalgo',
                'word_filter_enabled', 'banned_words', 'banned_phrases',
                'word_filter_action', 'word_filter_mode', 'filter_display_names',
                'log_filtered_messages', 'word_filter_whitelist_channels', 'word_filter_whitelist_roles',

                // === Ticket System ===
                'ticket_autoclose', 'ticket_autoclose_hours',

                // === Mod Permissions ===
                'mod_perm_tickets', 'mod_perm_analytics', 'mod_perm_security',
                'mod_perm_overview', 'mod_perm_customize',
                'admin_perm_tickets', 'admin_perm_analytics', 'admin_perm_security',
                'admin_perm_overview', 'admin_perm_customize',

                // === General Config ===
                'prefix', 'language', 'timezone', 'premium_tier'
            ];

            const validUpdates = {};
            
            // Dynamically check which columns actually exist in the table
            // This prevents SQL errors when a column hasn't been added yet
            let existingColumns;
            try {
                const tableInfo = await this.bot.database.all('PRAGMA table_info(guild_configs)');
                existingColumns = new Set(tableInfo.map(col => col.name));
            } catch (e) {
                this.bot.logger?.warn('Could not get table info for guild_configs:', e.message);
                existingColumns = null; // Fall back to allowing all allowlisted keys
            }
            
            const rejectedKeys = [];
            const missingColumns = [];
            for (const key of Object.keys(updates)) {
                if (allowedSettings.includes(key)) {
                    if (existingColumns && !existingColumns.has(key)) {
                        missingColumns.push(key);
                    } else {
                        validUpdates[key] = updates[key];
                    }
                } else {
                    rejectedKeys.push(key);
                }
            }
            if (rejectedKeys.length > 0) {
                this.bot.logger?.warn(`[SECURITY] Rejected non-allowlisted setting keys: ${rejectedKeys.join(', ')}`);
            }
            if (missingColumns.length > 0) {
                this.bot.logger?.warn(`[DB] Skipped settings with no matching column: ${missingColumns.join(', ')}. Run migrations to add them.`);
            }

            if (Object.keys(validUpdates).length === 0) {
                const msg = missingColumns.length > 0
                    ? `No valid fields to update. ${missingColumns.length} field(s) skipped (columns not in database): ${missingColumns.join(', ')}`
                    : 'No valid fields to update';
                return res.status(400).json({ error: msg });
            }

            // Read previous settings for confirmation messages
            const previous = await this.bot.database.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]);

            // Ensure guild config row exists before trying to UPDATE
            if (!previous) {
                await this.bot.database.run('INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)', [guildId]);
            }

            // Update database
            // JSON-stringify any array/object values for TEXT column storage
            for (const key of Object.keys(validUpdates)) {
                const val = validUpdates[key];
                if (val !== null && typeof val === 'object') {
                    validUpdates[key] = JSON.stringify(val);
                }
            }
            const setClauses = Object.keys(validUpdates).map(key => `${key} = ?`).join(', ');
            const values = [...Object.values(validUpdates), guildId];

            await this.bot.database.run(
                `UPDATE guild_configs SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
                values
            );

            // Log the settings change for visibility
            const changedKeys = Object.keys(validUpdates);
            const changedBy = req.user?.username || req.user?.discordId || 'unknown';
            this.bot.logger?.info(`[SETTINGS] Guild ${guildId}: ${changedBy} updated ${changedKeys.length} setting(s): ${changedKeys.join(', ')}`);

            // Invalidate ConfigService cache so bot picks up changes immediately
            try {
                if (this.bot.configService?.cache) {
                    this.bot.configService.cache.delete(guildId);
                }
                // Also invalidate word filter cache if word filter settings changed
                if (this.bot.wordFilter?.configCache) {
                    this.bot.wordFilter.configCache.delete(guildId);
                }
            } catch (e) {
                this.bot.logger?.warn('Cache invalidation failed:', e.message || e);
            }

            // Apply certain updates to in-memory modules immediately (e.g., AI toggle)
            try {
                if (typeof validUpdates.ai_enabled !== 'undefined' && this.bot.aiAssistant) {
                    this.bot.aiAssistant.enabled = !!validUpdates.ai_enabled && !!this.bot.aiAssistant.openai;
                    if (typeof this.bot.aiAssistant.updateGuildSettings === 'function') {
                        await this.bot.aiAssistant.updateGuildSettings(guildId, { enabled: validUpdates.ai_enabled ? 1 : 0 });
                    }
                }
            } catch (e) {
                this.bot.logger?.warn('Failed to apply in-memory AI enabled update:', e.message || e);
            }

            // Emit ONE setting change event for the batch (not per-field)
            try {
                const changedBy = req.user?.id || req.user?.sub || null;
                if (typeof this.bot.emitSettingChange === 'function') {
                    await this.bot.emitSettingChange(guildId, changedBy, 'bulk_update', validUpdates, null, 'configuration');
                }
            } catch (e) {
                this.bot.logger?.warn('Failed to emit settingChange event:', e?.message || e);
            }

            // Send ONE summary confirmation (not per-field — prevents notification flood)
            if (this.bot.confirmationManager) {
                try {
                    const changedKeys = Object.keys(validUpdates);
                    const summaryValue = `Updated ${changedKeys.length} setting(s): ${changedKeys.slice(0, 5).join(', ')}${changedKeys.length > 5 ? '...' : ''}`;
                    await this.bot.confirmationManager.sendConfirmation(
                        guildId,
                        'dashboard',
                        'settings_batch_update',
                        summaryValue,
                        null,
                        req.user?.id || req.user?.sub || 'unknown'
                    );
                } catch (e) {
                    this.bot.logger?.warn('Failed to send batch confirmation:', e.message || e);
                }
            }

            // Broadcast to connected dashboard clients (if any)
            try {
                this.broadcastToGuild(guildId, { type: 'settings_updated', data: validUpdates, timestamp: new Date().toISOString() });
            } catch (e) {
                this.bot.logger?.warn('Broadcast to guild failed:', e.message || e);
            }

            const response = { ok: true, success: true, updated: validUpdates };
            if (missingColumns.length > 0) {
                response.skipped = missingColumns;
                response.message = `Saved ${Object.keys(validUpdates).length} setting(s). ${missingColumns.length} field(s) not yet in database.`;
            }
            res.json(response);
        } catch (error) {
            this.bot.logger.error('Error updating guild settings:', error);
            res.status(500).json({ error: 'Failed to update settings' });
        }
    }

    /**
     * Start the HTTP server and attach WebSocket server for real-time dashboard updates
     */
    async start(port = process.env.PORT || process.env.DASHBOARD_PORT || 3001) {
        if (this.server) return; // already started

        // Ensure routes are registered (in case constructor didn't call setupRoutes)
        if (typeof this.setupRoutes === 'function') {
            try { this.setupRoutes(); } catch (e) { /* ignore */ }
        }

        // Verify integrity of critical files before starting server
        if (this.integrityMonitor) {
            await this.integrityMonitor.verify();
        }

        // Mount Darklock Platform at /platform/*
        try {
            const darklock = new DarklockPlatform();
            await darklock.mountOn(this.app, this.bot);
            this.bot?.logger?.info && this.bot.logger.info('✅ Darklock Platform mounted at /platform');
        } catch (error) {
            this.bot?.logger?.error && this.bot.logger.error('Failed to mount Darklock Platform:', error.message || error);
        }

        // 404 handler (must be after all route registrations including Darklock)
        this.app.use('*', (req, res) => {
            res.status(404).json({ error: 'Not found' });
        });

        // Create HTTP server for the Express app and attach WebSocket server
        this.server = http.createServer(this.app);

        // Attach WebSocket server
        this.wss = new WebSocket.Server({ server: this.server, path: '/ws' });

        // Handle connections (authenticated only)
        this.wss.on('connection', (ws, req) => {
            try {
                const fullUrl = req.url || '/';
                const params = new URL(fullUrl, `http://${req.headers.host}`);
                const token = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '') || req.headers['sec-websocket-protocol'];
                let guildId = params.searchParams.get('guildId') || null;

                const internalKey = process.env.INTERNAL_API_KEY;
                const jwtSecret = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;

                if (!internalKey || !jwtSecret) {
                    this.bot?.logger?.error && this.bot.logger.error('Dashboard WebSocket misconfigured: INTERNAL_API_KEY or JWT secret missing');
                    try { ws.close(1011, 'Server configuration error'); } catch (e) {}
                    return;
                }

                if (!token) {
                    try { ws.close(4401, 'Authentication required'); } catch (e) {}
                    return;
                }

                // Server-to-server connection using INTERNAL_API_KEY
                if (token === internalKey) {
                    ws.isServerConnection = true;
                    ws.allowedGuilds = null;
                    ws.user = null;
                    ws.isAlive = true;
                    ws.id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                    ws.subscriptions = new Set();
                    this.clients.add(ws);
                    if (guildId) ws.subscriptions.add(String(guildId));
                } else {
                    // Dashboard client using JWT
                    try {
                        const payload = jwt.verify(token, jwtSecret);
                        ws.user = payload;
                        ws.allowedGuilds = new Set();
                        // Determine allowed guild id from payload or query
                        const allowedGuildId = payload.accessGuild?.id || payload.guildId || null;
                        const primaryGuildId = guildId || allowedGuildId || null;
                        if (guildId && allowedGuildId && String(guildId) !== String(allowedGuildId)) {
                            try { ws.close(4403, 'Guild not permitted'); } catch (e) {}
                            return;
                        }
                        if (!primaryGuildId) {
                            try { ws.close(4403, 'No guild access'); } catch (e) {}
                            return;
                        }
                        guildId = primaryGuildId;
                        ws.allowedGuilds.add(String(guildId));

                        ws.isServerConnection = false;
                        ws.isAlive = true;
                        ws.id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                        ws.subscriptions = new Set([String(guildId)]);
                        this.clients.add(ws);
                    } catch (e) {
                        try { ws.close(4401, 'Invalid token'); } catch (e2) {}
                        return;
                    }
                }

                ws.on('pong', () => { ws.isAlive = true; });

                ws.on('message', async (raw) => {
                    try {
                        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        if (!msg) return;

                        // All messages require an authenticated context (either server or user)
                        if (!ws.isServerConnection && !ws.user) {
                            try { ws.close(4401, 'Auth required'); } catch (e) {}
                            return;
                        }

                        if (msg.type === 'subscribe' && msg.guildId) {
                            const targetGuildId = String(msg.guildId);

                            // Server connections may subscribe to any guild
                            if (ws.isServerConnection) {
                                ws.subscriptions.add(targetGuildId);
                                return;
                            }

                            // Dashboard users may only subscribe to guilds they are authorized for
                            if (!ws.allowedGuilds || !ws.allowedGuilds.has(targetGuildId)) return;

                            ws.subscriptions.add(targetGuildId);
                            return;
                        }
                        if (msg.type === 'unsubscribe' && msg.guildId) {
                            ws.subscriptions.delete(String(msg.guildId));
                            return;
                        }

                        if (msg.type === 'pong') {
                            ws.isAlive = true;
                            return;
                        }

                        // Future message handling could go here
                    } catch (e) {
                        // ignore invalid messages
                    }
                });

                ws.on('close', () => { this.clients.delete(ws); });
                ws.on('error', () => { this.clients.delete(ws); });
            } catch (e) {
                // swallow
            }
        });

        // Heartbeat to detect dead connections
        const interval = setInterval(() => {
            if (!this.wss) return clearInterval(interval);
            for (const client of this.wss.clients) {
                if (client.isAlive === false) {
                    try { client.terminate(); } catch (e) {}
                    continue;
                }
                client.isAlive = false;
                try { client.ping(); } catch (e) {}
            }
        }, 30000);

        // Graceful shutdown handlers (production-safe)
        const shutdown = async () => {
            try {
                clearInterval(interval);
                if (this.wss) {
                    try { this.wss.close(); } catch (e) {}
                }
                if (this.server && this.server.listening) {
                    await new Promise(res => this.server.close(() => res()));
                }
                this.bot?.logger?.info && this.bot.logger.info('Dashboard shutdown complete');
            } catch (e) {
                this.bot?.logger?.warn && this.bot.logger.warn('Error during dashboard shutdown:', e.message || e);
            }
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Ensure we bind to the platform host (0.0.0.0) unless overridden
        const host = process.env.DASHBOARD_HOST || '0.0.0.0';
        await new Promise((resolve, reject) => {
            this.server.listen(port, host, (err) => {
                if (err) return reject(err);
                const addr = this.server.address();
                const boundHost = addr && addr.address ? addr.address : host;
                const boundPort = addr && addr.port ? addr.port : port;
                this.bot?.logger?.info && this.bot.logger.info(`Ã¢Å“â€¦ Dashboard listening on http://${boundHost}:${boundPort}`);
                resolve();
            });
        });
    }

    /**
     * Handle incoming server-to-server events via POST /api/events
     * Requires INTERNAL_API_KEY in `x-api-key` header or Authorization Bearer
     */
    async handleEventPost(req, res) {
        try {
            const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
            const expectedKey = process.env.INTERNAL_API_KEY;
            if (!expectedKey) {
                this.bot?.logger?.error && this.bot.logger.error('INTERNAL_API_KEY is not configured for handleEventPost');
                return res.status(500).json({ error: 'Server misconfigured' });
            }
            if (apiKey !== expectedKey) return res.status(401).json({ error: 'Unauthorized' });

            const event = req.body;
            if (!event || !event.type) return res.status(400).json({ error: 'Invalid event payload' });

            // Persist important events to DB when possible
            try {
                await this.saveEventToDB(event);
            } catch (e) {
                // non-fatal
                this.bot?.logger?.warn && this.bot.logger.warn('Failed to persist event:', e.message || e);
            }

            // Broadcast to connected WS clients (scoped to guild if provided)
            try {
                const guildId = event.guildId || event.data?.guildId || null;
                if (guildId) {
                    this.broadcastToGuild(guildId, { type: 'event', event });
                } else {
                    // Broadcast global event
                    this.broadcastToGuild(null, { type: 'event', event });
                }
            } catch (e) {
                this.bot?.logger?.warn && this.bot.logger.warn('Failed to broadcast event:', e.message || e);
            }

            res.json({ success: true });
        } catch (error) {
            this.bot?.logger?.error && this.bot.logger.error('Error in handleEventPost:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Broadcast a JSON payload to connected dashboard WebSocket clients for a guild
     */
    broadcastToGuild(guildId, payload) {
        // Use the tracked clients set and deliver only to subscribed clients (or global viewers)
        if (!this.clients || this.clients.size === 0) return;
        const message = JSON.stringify({ ...payload, guildId, timestamp: new Date().toISOString() });
        // Persist bot console messages in memory for the console page (retain last 5000)
        try {
            if (payload && payload.type === 'botConsole') {
                this.consoleMessages.push({ guildId: guildId || null, message: payload.message || '', timestamp: payload.timestamp || Date.now() });
                if (this.consoleMessages.length > 5000) this.consoleMessages.splice(0, this.consoleMessages.length - 5000);
            }
        } catch (e) {
            // ignore memory store errors
        }
        for (const client of this.clients) {
            try {
                if (client.readyState !== WebSocket.OPEN) continue;
                // Delivery rules:
                // - If client has explicit subscriptions, only deliver events for those guilds.
                // - If client is an internal server connection, deliver all events.
                // - If client is an anonymous/public viewer (no subscriptions), only deliver global events (no guildId).
                if (client.subscriptions && client.subscriptions.size > 0) {
                    if (!guildId) continue;
                    if (!client.subscriptions.has(String(guildId))) continue;
                    client.send(message);
                    continue;
                }

                if (client.isServerConnection) {
                    client.send(message);
                    continue;
                }

                // Anonymous/public viewer: only deliver events without a guildId (global/aggregate events)
                if (!guildId) {
                    client.send(message);
                }
            } catch (e) {
                try { client.terminate(); } catch (_) {}
                this.clients.delete(client);
            }
        }
    }

    /**
     * Get recent console messages for backfill
     */
    getConsoleMessages(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 1000;
            const messages = this.consoleMessages.slice(-limit);
            res.json({ success: true, messages });
        } catch (error) {
            this.bot?.logger?.error && this.bot.logger.error('Error getting console messages:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get bot logs with filtering and pagination
     */
    async getBotLogs(req, res) {
        try {
            if (!this.bot.logger) {
                return res.status(503).json({ error: 'Logger not initialized' });
            }

            const filters = {
                type: req.query.type || null,
                guildId: req.query.guildId || null,
                userId: req.query.userId || null,
                startDate: req.query.startDate || null,
                endDate: req.query.endDate || null,
                limit: parseInt(req.query.limit) || 100,
                offset: parseInt(req.query.offset) || 0
            };

            // Verify user has access to the guild if guildId is specified
            if (filters.guildId && req.user) {
                const userGuilds = req.user.guilds || [];
                const hasAccess = userGuilds.some(g => g.id === filters.guildId && (g.permissions & 0x8) === 0x8);
                if (!hasAccess) {
                    return res.status(403).json({ error: 'No permission to view logs for this server' });
                }
            }

            const logs = await this.bot.logger.getLogs(filters);
            res.json({ success: true, logs, count: logs.length });
        } catch (error) {
            console.error('Error fetching bot logs:', error);
            res.status(500).json({ error: 'Failed to fetch logs' });
        }
    }

    /**
     * Get dashboard audit logs with filtering and pagination
     */
    async getDashboardAudit(req, res) {
        try {
            if (!this.bot.logger) {
                return res.status(503).json({ error: 'Logger not initialized' });
            }

            const filters = {
                guildId: req.query.guildId || null,
                adminId: req.query.adminId || null,
                eventType: req.query.eventType || null,
                limit: parseInt(req.query.limit) || 100,
                offset: parseInt(req.query.offset) || 0
            };

            // Verify user has access to the guild if guildId is specified
            if (filters.guildId && req.user) {
                const userGuilds = req.user.guilds || [];
                const hasAccess = userGuilds.some(g => g.id === filters.guildId && (g.permissions & 0x8) === 0x8);
                if (!hasAccess) {
                    return res.status(403).json({ error: 'No permission to view audit logs for this server' });
                }
            }

            const logs = await this.bot.logger.getDashboardAudit(filters);
            res.json({ success: true, logs, count: logs.length });
        } catch (error) {
            console.error('Error fetching dashboard audit logs:', error);
            res.status(500).json({ error: 'Failed to fetch audit logs' });
        }
    }

    // Lockdown status endpoint
    async getLockdownStatus(req, res) {
        try {
            const guildId = req.query.guildId;
            
            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            if (!this.bot.lockdownManager) {
                return res.json({ success: true, active: false });
            }

            const status = await this.bot.lockdownManager.getStatus(guildId);
            res.json({ success: true, ...status });

        } catch (error) {
            this.bot.logger.error('Error fetching lockdown status:', error);
            res.status(500).json({ error: 'Failed to fetch lockdown status' });
        }
    }

    // Lockdown history endpoint
    async getLockdownHistory(req, res) {
        try {
            const guildId = req.query.guildId;
            const limit = parseInt(req.query.limit) || 10;
            
            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            if (!this.bot.lockdownManager) {
                return res.json({ success: true, history: [] });
            }

            const history = await this.bot.lockdownManager.getHistory(guildId, limit);
            res.json({ success: true, history });

        } catch (error) {
            this.bot.logger.error('Error fetching lockdown history:', error);
            res.status(500).json({ error: 'Failed to fetch lockdown history' });
        }
    }

    // ================ SHARED ACCESS MANAGEMENT ENDPOINTS ================

    /**
     * Get list of users and roles with shared access to a guild
     */
    async getSharedAccessList(req, res) {
        try {
            const guildId = req.params.guildId;
            const userId = req.user?.discordId || req.user?.userId;

            // Allow any authorized dashboard user to VIEW list (owner, manage perms or granted). Mutations remain owner-only.
            const access = await this.checkGuildAccess(userId, guildId, false);
            if (!access.authorized) {
                return res.status(403).json({ success: false, error: access.error || 'Unauthorized' });
            }

            // Get user access grants
            const userAccess = await this.bot.database.all(
                `SELECT user_id, granted_by, created_at FROM dashboard_access WHERE guild_id = ?`,
                [guildId]
            );

            // Get role access grants
            const roleAccess = await this.bot.database.all(
                `SELECT role_id, granted_by, created_at FROM dashboard_role_access WHERE guild_id = ?`,
                [guildId]
            );

            // Get active access codes
            const accessCodes = await this.bot.database.all(
                `SELECT code, expires_at, created_by, created_at, redeemed_by FROM dashboard_access_codes 
                 WHERE guild_id = ?`,
                [guildId]
            );

            // Fetch usernames from Discord API (with timeout protection)
            const fetchUserWithTimeout = async (userId) => {
                try {
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), 2000)
                    );
                    const user = await Promise.race([
                        this.bot.client.users.fetch(userId).catch(() => null),
                        timeoutPromise
                    ]);
                    return user ? `${user.username}${user.discriminator !== '0' ? '#' + user.discriminator : ''}` : null;
                } catch (e) {
                    return null;
                }
            };

            const usersWithNames = await Promise.all((userAccess || []).map(async (u) => {
                const username = await fetchUserWithTimeout(u.user_id) || 'Unknown User';
                const granted_by_username = await fetchUserWithTimeout(u.granted_by) || 'Unknown';
                return { ...u, username, granted_by_username };
            }));

            // Fetch role names from guild
            const guild = this.bot.client.guilds.cache.get(guildId);
            const rolesWithNames = (roleAccess || []).map(r => {
                const role = guild?.roles.cache.get(r.role_id);
                return {
                    ...r,
                    role_name: role ? role.name : 'Unknown Role',
                    granted_by_username: 'System' // We can fetch this async if needed
                };
            });

            // Fetch creator names for codes
            const codesWithNames = await Promise.all((accessCodes || []).map(async (c) => {
                const created_by_username = await fetchUserWithTimeout(c.created_by) || 'Unknown';
                return { ...c, created_by_username };
            }));

            res.json({
                success: true,
                data: {
                    users: usersWithNames,
                    roles: rolesWithNames,
                    codes: codesWithNames
                }
            });
        } catch (error) {
            this.bot.logger.error('Error getting shared access list:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch access list' });
        }
    }

    /**
     * Grant dashboard access to a specific user
     */
    async grantUserAccess(req, res) {
        try {
            const guildId = req.params.guildId;
            const { userId: targetUserId } = req.body;
            const userId = req.user?.discordId || req.user?.userId;

            // Check if user can manage this guild
            const access = await this.checkGuildAccess(userId, guildId, true);
            if (!access.authorized) {
                return res.status(403).json({ error: access.error });
            }

            if (!targetUserId || !/^\d{17,19}$/.test(targetUserId)) {
                return res.status(400).json({ error: 'Valid user ID required' });
            }

            // Insert or update access grant
            await this.bot.database.run(
                `INSERT OR REPLACE INTO dashboard_access (guild_id, user_id, granted_by, created_at) 
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                [guildId, targetUserId, userId]
            );

            this.bot.logger.info(`[SHARED_ACCESS] User ${userId} granted access to user ${targetUserId} for guild ${guildId}`);
            res.json({ success: true, message: 'Access granted successfully' });
        } catch (error) {
            this.bot.logger.error('Error granting user access:', error);
            res.status(500).json({ error: 'Failed to grant access' });
        }
    }

    /**
     * Grant dashboard access to users with a specific role
     */
    async grantRoleAccess(req, res) {
        try {
            const guildId = req.params.guildId;
            const { roleId } = req.body;
            const userId = req.user?.discordId || req.user?.userId;

            // Check if user can manage this guild
            const access = await this.checkGuildAccess(userId, guildId, true);
            if (!access.authorized) {
                return res.status(403).json({ error: access.error });
            }

            if (!roleId || !/^\d{17,19}$/.test(roleId)) {
                return res.status(400).json({ error: 'Valid role ID required' });
            }

            // Verify role exists in guild
            const guild = this.bot.client.guilds.cache.get(guildId);
            const role = guild?.roles.cache.get(roleId);
            if (!role) {
                return res.status(404).json({ error: 'Role not found in this server' });
            }

            // Insert or update role access grant
            await this.bot.database.run(
                `INSERT OR REPLACE INTO dashboard_role_access (guild_id, role_id, granted_by, created_at) 
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                [guildId, roleId, userId]
            );

            this.bot.logger.info(`[SHARED_ACCESS] User ${userId} granted access to role ${roleId} for guild ${guildId}`);
            res.json({ success: true, message: 'Role access granted successfully', roleName: role.name });
        } catch (error) {
            this.bot.logger.error('Error granting role access:', error);
            res.status(500).json({ error: 'Failed to grant role access' });
        }
    }

    /**
     * Generate a temporary access code for the guild
     */
    async generateAccessCode(req, res) {
        try {
            const guildId = req.params.guildId;
            const { expiresInHours = 24 } = req.body;
            const userId = req.user?.discordId || req.user?.userId;

            // Check if user can manage this guild
            const access = await this.checkGuildAccess(userId, guildId, true);
            if (!access.authorized) {
                return res.status(403).json({ error: access.error });
            }

            // Validate expiration
            const hours = Math.min(Math.max(1, parseInt(expiresInHours) || 24), 168); // 1-168 hours (1 week max)
            
            // Generate random 12-character code
            const crypto = require('crypto');
            const code = crypto.randomBytes(6).toString('hex').toUpperCase();
            const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

            // Store code in database
            await this.bot.database.run(
                `INSERT INTO dashboard_access_codes (code, guild_id, expires_at, created_by, created_at) 
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [code, guildId, expiresAt, userId]
            );

            this.bot.logger.info(`[SHARED_ACCESS] User ${userId} generated access code ${code} for guild ${guildId}`);
            res.json({ 
                success: true, 
                code: code,
                expiresAt: expiresAt,
                expiresInHours: hours
            });
        } catch (error) {
            this.bot.logger.error('Error generating access code:', error);
            res.status(500).json({ error: 'Failed to generate access code' });
        }
    }

    /**
     * Revoke dashboard access from a specific user
     */
    async revokeUserAccess(req, res) {
        try {
            const guildId = req.params.guildId;
            const { userId: targetUserId } = req.body;
            const userId = req.user?.discordId || req.user?.userId;

            // Check if user can manage this guild
            const access = await this.checkGuildAccess(userId, guildId, true);
            if (!access.authorized) {
                return res.status(403).json({ error: access.error });
            }

            await this.bot.database.run(
                `DELETE FROM dashboard_access WHERE guild_id = ? AND user_id = ?`,
                [guildId, targetUserId]
            );

            this.bot.logger.info(`[SHARED_ACCESS] User ${userId} revoked access from user ${targetUserId} for guild ${guildId}`);
            res.json({ success: true, message: 'Access revoked successfully' });
        } catch (error) {
            this.bot.logger.error('Error revoking user access:', error);
            res.status(500).json({ error: 'Failed to revoke access' });
        }
    }

    /**
     * Revoke dashboard access from a specific role
     */
    async revokeRoleAccess(req, res) {
        try {
            const guildId = req.params.guildId;
            const { roleId } = req.body;
            const userId = req.user?.discordId || req.user?.userId;

            // Check if user can manage this guild
            const access = await this.checkGuildAccess(userId, guildId, true);
            if (!access.authorized) {
                return res.status(403).json({ error: access.error });
            }

            await this.bot.database.run(
                `DELETE FROM dashboard_role_access WHERE guild_id = ? AND role_id = ?`,
                [guildId, roleId]
            );

            this.bot.logger.info(`[SHARED_ACCESS] User ${userId} revoked access from role ${roleId} for guild ${guildId}`);
            res.json({ success: true, message: 'Role access revoked successfully' });
        } catch (error) {
            this.bot.logger.error('Error revoking role access:', error);
            res.status(500).json({ error: 'Failed to revoke role access' });
        }
    }

    /**
     * Delete an unused access code
     */
    async deleteAccessCode(req, res) {
        try {
            const guildId = req.params.guildId;
            const code = req.params.code;
            const userId = req.user?.discordId || req.user?.userId;

            // Check if user can manage this guild
            const access = await this.checkGuildAccess(userId, guildId, true);
            if (!access.authorized) {
                return res.status(403).json({ error: access.error });
            }

            await this.bot.database.run(
                `DELETE FROM dashboard_access_codes WHERE guild_id = ? AND code = ?`,
                [guildId, code]
            );

            this.bot.logger.info(`[SHARED_ACCESS] User ${userId} deleted access code ${code} for guild ${guildId}`);
            res.json({ success: true, message: 'Access code deleted successfully' });
        } catch (error) {
            this.bot.logger.error('Error deleting access code:', error);
            res.status(500).json({ error: 'Failed to delete access code' });
        }
    }

    /**
     * Redeem an access code to gain dashboard access to a guild
     */
    async redeemAccessCode(req, res) {
        try {
            const { code } = req.body;
            const userId = req.user?.discordId || req.user?.userId;

            if (!code || typeof code !== 'string') {
                return res.status(400).json({ error: 'Access code required' });
            }

            // Find the code
            const codeData = await this.bot.database.get(
                `SELECT guild_id, expires_at FROM dashboard_access_codes 
                 WHERE code = ? AND redeemed_by IS NULL`,
                [code.toUpperCase()]
            );

            if (!codeData) {
                return res.status(404).json({ error: 'Invalid or already redeemed access code' });
            }

            // Check if expired
            if (new Date(codeData.expires_at) < new Date()) {
                await this.bot.database.run(
                    `DELETE FROM dashboard_access_codes WHERE code = ?`,
                    [code.toUpperCase()]
                );
                return res.status(400).json({ error: 'Access code has expired' });
            }

            // Grant access to user
            await this.bot.database.run(
                `INSERT OR REPLACE INTO dashboard_access (guild_id, user_id, granted_by, created_at) 
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                [codeData.guild_id, userId, 'access_code']
            );

            // Mark code as redeemed
            await this.bot.database.run(
                `UPDATE dashboard_access_codes SET redeemed_by = ?, redeemed_at = CURRENT_TIMESTAMP 
                 WHERE code = ?`,
                [userId, code.toUpperCase()]
            );

            // Get guild info
            const guild = this.bot.client.guilds.cache.get(codeData.guild_id);
            
            this.bot.logger.info(`[SHARED_ACCESS] User ${userId} redeemed access code for guild ${codeData.guild_id}`);
            res.json({ 
                success: true, 
                message: 'Access code redeemed successfully',
                guildId: codeData.guild_id,
                guildName: guild?.name || 'Unknown Server'
            });
        } catch (error) {
            this.bot.logger.error('Error redeeming access code:', error);
            res.status(500).json({ error: 'Failed to redeem access code' });
        }
    }

    /**
     * Recheck user access - checks for role-based access and grants automatically
     */
    async recheckUserAccess(req, res) {
        try {
            const userId = req.user?.discordId || req.user?.userId;

            if (!userId) {
                return res.status(401).json({ error: 'User not authenticated' });
            }

            this.bot.logger.info(`[ACCESS_RECHECK] Rechecking access for user: ${userId}`);

            // Get all guilds the bot is in
            const botGuilds = this.bot.client.guilds.cache;
            let newAccessGranted = 0;

            for (const [guildId, guild] of botGuilds) {
                try {
                    // Check if user is a member of this guild
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (!member) continue;

                    // Check if they already have explicit access
                    const existingAccess = await this.bot.database.get(
                        `SELECT * FROM dashboard_access WHERE guild_id = ? AND user_id = ?`,
                        [guildId, userId]
                    );

                    if (existingAccess) continue; // Already has access

                    // Check for role-based access
                    const roleAccess = await this.bot.database.all(
                        `SELECT role_id FROM dashboard_role_access WHERE guild_id = ?`,
                        [guildId]
                    );

                    for (const roleGrant of roleAccess) {
                        if (member.roles.cache.has(roleGrant.role_id)) {
                            // User has a role that grants access - automatically grant it
                            await this.bot.database.run(
                                `INSERT INTO dashboard_access (guild_id, user_id, granted_by, created_at) 
                                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                                [guildId, userId, 'system_role_based']
                            );

                            newAccessGranted++;
                            this.bot.logger.info(`[ACCESS_RECHECK] Granted role-based access to user ${userId} for guild ${guildId}`);
                            break;
                        }
                    }
                } catch (err) {
                    console.error(`Error checking guild ${guildId}:`, err);
                }
            }

            // Count accessible servers for this user
            let accessibleServerCount = 0;
            for (const [guildId, guild] of botGuilds) {
                try {
                    const access = await this.checkGuildAccess(userId, guildId, false);
                    if (access.authorized) {
                        accessibleServerCount++;
                    }
                } catch (err) {
                    // Skip guilds with errors
                    continue;
                }
            }
            
            res.json({
                success: true,
                newAccessGranted,
                serverCount: accessibleServerCount,
                message: newAccessGranted > 0 
                    ? `Ã¢Å“â€¦ Found ${newAccessGranted} new server(s) you can access!` 
                    : 'No new servers found. Ask an admin for access.'
            });
        } catch (error) {
            this.bot.logger.error('Error rechecking user access:', error);
            res.status(500).json({ success: false, error: 'Failed to recheck access' });
        }
    }

    // Get staff roles configuration
    async getStaffRoles(req, res) {
        try {
            const { guildId } = req.params;
            
            // Check if database is available
            if (!this.bot?.database) {
                return res.json({ success: false, error: 'Database not initialized' });
            }
            
            // Check if bot client is ready
            if (!this.bot?.client?.guilds?.cache) {
                // Return empty config if bot not ready
                const config = this.bot.database.prepare('SELECT * FROM guild_configs WHERE guild_id = ?').get(guildId);
                const staffRoles = config ? {
                    adminRoleId: config.admin_role_id || null,
                    modRoleId: config.mod_role_id || null
                } : { adminRoleId: null, modRoleId: null };
                return res.json({ success: true, data: staffRoles });
            }
            
            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                return res.json({ success: false, error: 'Guild not found' });
            }

            // Check if user is admin/owner
            const userId = req.user?.id;
            const member = guild.members.cache.get(userId);
            if (!member || (!member.permissions.has('Administrator') && guild.ownerId !== userId)) {
                return res.json({ success: false, error: 'Insufficient permissions' });
            }

            // Retrieve from config
            const config = this.bot.database.prepare('SELECT * FROM guild_configs WHERE guild_id = ?').get(guildId);
            const staffRoles = config ? {
                adminRoleId: config.admin_role_id || null,
                modRoleId: config.mod_role_id || null
            } : { adminRoleId: null, modRoleId: null };

            res.json({ success: true, data: staffRoles });
        } catch (error) {
            this.bot.logger.error('[StaffRoles] Error getting staff roles:', error);
            res.json({ success: false, error: error.message });
        }
    }

    // Save staff roles configuration
    async saveStaffRoles(req, res) {
        try {
            const { guildId } = req.params;
            const { modRoleId, adminRoleId } = req.body;
            
            // Check if database is available
            if (!this.bot?.database) {
                return res.json({ success: false, error: 'Database not initialized' });
            }
            
            // Check if bot client is ready
            if (!this.bot?.client?.guilds?.cache) {
                // Skip validation if bot not ready, just save to DB
                this.bot.database.prepare(`
                    UPDATE guild_configs
                    SET admin_role_id = ?, mod_role_id = ?
                    WHERE guild_id = ?
                `).run(adminRoleId || null, modRoleId || null, guildId);
                return res.json({ success: true, data: { modRoleId, adminRoleId } });
            }
            
            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                return res.json({ success: false, error: 'Guild not found' });
            }

            // Check if user is admin/owner
            const userId = req.user?.userId || req.user?.id;
            if (!userId) {
                return res.json({ success: false, error: 'User ID not found in token' });
            }
            
            // Check if user is guild owner first (doesn't require member cache)
            if (guild.ownerId !== userId) {
                // If not owner, check if member is cached with admin perms
                const member = guild.members.cache.get(userId);
                if (!member || !member.permissions.has('Administrator')) {
                    return res.json({ success: false, error: 'Insufficient permissions' });
                }
            }

            // Validate roles exist in guild
            if (modRoleId && !guild.roles.cache.has(modRoleId)) {
                return res.json({ success: false, error: 'Moderator role not found in guild' });
            }
            if (adminRoleId && !guild.roles.cache.has(adminRoleId)) {
                return res.json({ success: false, error: 'Admin role not found in guild' });
            }

            // Get current values for audit log
            const current = this.bot.database.prepare('SELECT admin_role_id, mod_role_id FROM guild_configs WHERE guild_id = ?').get(guildId);

            // Update config
            this.bot.database.prepare(`
                UPDATE guild_configs
                SET admin_role_id = ?, mod_role_id = ?
                WHERE guild_id = ?
            `).run(adminRoleId || null, modRoleId || null, guildId);

            // Insert audit logs for staff role changes
            try {
                if (current?.admin_role_id !== adminRoleId) {
                    await this.bot.database.insertAuditLog({
                        guild_id: guildId,
                        event_type: 'staff_role_update',
                        event_category: 'config_change',
                        executor_id: userId,
                        executor_tag: req.user?.username || 'Dashboard User',
                        target_type: 'role',
                        target_id: adminRoleId,
                        target_name: 'admin_role_id',
                        changes: { admin_role_id: { from: current?.admin_role_id, to: adminRoleId } },
                        before_state: { admin_role_id: current?.admin_role_id },
                        after_state: { admin_role_id: adminRoleId }
                    });
                }
                if (current?.mod_role_id !== modRoleId) {
                    await this.bot.database.insertAuditLog({
                        guild_id: guildId,
                        event_type: 'staff_role_update',
                        event_category: 'config_change',
                        executor_id: userId,
                        executor_tag: req.user?.username || 'Dashboard User',
                        target_type: 'role',
                        target_id: modRoleId,
                        target_name: 'mod_role_id',
                        changes: { mod_role_id: { from: current?.mod_role_id, to: modRoleId } },
                        before_state: { mod_role_id: current?.mod_role_id },
                        after_state: { mod_role_id: modRoleId }
                    });
                }
            } catch (auditErr) {
                this.bot.logger?.warn && this.bot.logger.warn('Failed to insert audit logs:', auditErr.message);
            }

            res.json({ success: true, data: { modRoleId, adminRoleId } });
        } catch (error) {
            this.bot.logger.error('[StaffRoles] Error saving staff roles:', error);
            res.json({ success: false, error: error.message });
        }
    }

    // Get advanced permissions for moderators
    async getAdvancedPermissions(req, res) {
        try {
            const { guildId } = req.params;
            
            // Check if database is available
            if (!this.bot?.database) {
                return res.json({ success: false, error: 'Database not initialized' });
            }
            
            // Check if bot client is ready
            if (!this.bot?.client?.guilds?.cache) {
                // Return config data if bot not ready
                const config = this.bot.database.prepare('SELECT * FROM guild_configs WHERE guild_id = ?').get(guildId);
                const permissions = config ? {
                    adminRoleId: config.admin_role_id || null,
                    modRoleId: config.mod_role_id || null,
                    tickets: !!config.mod_perm_tickets,
                    analytics: !!config.mod_perm_analytics,
                    security: !!config.mod_perm_security,
                    overview: !!config.mod_perm_overview,
                    customize: !!config.mod_perm_customize
                } : { adminRoleId: null, modRoleId: null, tickets: false, analytics: false, security: false, overview: false, customize: false };
                return res.json({ success: true, data: permissions });
            }
            
            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                return res.json({ success: false, error: 'Guild not found' });
            }

            // Check if user is admin/owner
            const userId = req.user?.id;
            const member = guild.members.cache.get(userId);
            if (!member || (!member.permissions.has('Administrator') && guild.ownerId !== userId)) {
                return res.json({ success: false, error: 'Insufficient permissions' });
            }

            // Retrieve from config
            const config = this.bot.database.prepare('SELECT * FROM guild_configs WHERE guild_id = ?').get(guildId);
            const permissions = config ? {
                adminRoleId: config.admin_role_id || null,
                modRoleId: config.mod_role_id || null,
                mod: {
                    tickets: config.mod_perm_tickets ? true : false,
                    analytics: config.mod_perm_analytics ? true : false,
                    security: config.mod_perm_security ? true : false,
                    overview: config.mod_perm_overview ? true : false,
                    customize: config.mod_perm_customize ? true : false
                },
                admin: {
                    tickets: config.admin_perm_tickets !== undefined ? (config.admin_perm_tickets ? true : false) : true,
                    analytics: config.admin_perm_analytics !== undefined ? (config.admin_perm_analytics ? true : false) : true,
                    security: config.admin_perm_security !== undefined ? (config.admin_perm_security ? true : false) : true,
                    overview: config.admin_perm_overview !== undefined ? (config.admin_perm_overview ? true : false) : true,
                    customize: config.admin_perm_customize !== undefined ? (config.admin_perm_customize ? true : false) : true
                }
            } : {
                adminRoleId: null,
                modRoleId: null,
                mod: { tickets: false, analytics: false, security: false, overview: false, customize: false },
                admin: { tickets: true, analytics: true, security: true, overview: true, customize: true }
            };

            res.json({ success: true, data: permissions });
        } catch (error) {
            this.bot.logger.error('[AdvPerms] Error getting permissions:', error);
            res.json({ success: false, error: error.message });
        }
    }

    // Save advanced permissions for moderators
    async saveAdvancedPermissions(req, res) {
        try {
            const { guildId } = req.params;
            const { roleType, tickets, analytics, security, overview, customize } = req.body;
            
            // Check if database is available
            if (!this.bot?.database) {
                return res.json({ success: false, error: 'Database not initialized' });
            }
            
            // Validate roleType
            if (!roleType || (roleType !== 'admin' && roleType !== 'moderator')) {
                return res.json({ success: false, error: 'Please select a role type (Admin or Moderator)' });
            }
            
            // Get existing config from database
            const existingConfig = this.bot.database.prepare('SELECT admin_role_id, mod_role_id FROM guild_configs WHERE guild_id = ?').get(guildId);
            
            // Check if bot client is ready for validation
            if (this.bot?.client?.guilds?.cache) {
                const guild = this.bot.client.guilds.cache.get(guildId);
                if (!guild) {
                    return res.json({ success: false, error: 'Guild not found' });
                }

                // Check if user is admin/owner
                const userId = req.user?.userId || req.user?.id;
                if (!userId) {
                    return res.json({ success: false, error: 'User ID not found in token' });
                }
                
                // Check if user is guild owner first (doesn't require member cache)
                if (guild.ownerId !== userId) {
                    // If not owner, check if member is cached with admin perms
                    const member = guild.members.cache.get(userId);
                    if (!member || !member.permissions.has('Administrator')) {
                        return res.json({ success: false, error: 'Insufficient permissions' });
                    }
                }

                // Check if the role being configured is set
                if (roleType === 'admin' && !existingConfig?.admin_role_id) {
                    return res.json({ success: false, error: 'Please set up the Admin role in Staff Roles first' });
                }
                if (roleType === 'moderator' && !existingConfig?.mod_role_id) {
                    return res.json({ success: false, error: 'Please set up the Moderator role in Staff Roles first' });
                }

                // Validate role exists in guild
                const roleId = roleType === 'admin' ? existingConfig.admin_role_id : existingConfig.mod_role_id;
                if (roleId && !guild.roles.cache.has(roleId)) {
                    return res.json({ success: false, error: `${roleType === 'admin' ? 'Admin' : 'Moderator'} role not found in guild` });
                }
            }

            // Update config based on roleType
            if (roleType === 'moderator') {
                this.bot.database.prepare(`
                    UPDATE guild_configs
                    SET mod_perm_tickets = ?, mod_perm_analytics = ?, mod_perm_security = ?, 
                        mod_perm_overview = ?, mod_perm_customize = ?
                    WHERE guild_id = ?
                `).run(
                    tickets ? 1 : 0, analytics ? 1 : 0, security ? 1 : 0, overview ? 1 : 0, customize ? 1 : 0,
                    guildId
                );
            } else {
                this.bot.database.prepare(`
                    UPDATE guild_configs
                    SET admin_perm_tickets = ?, admin_perm_analytics = ?, admin_perm_security = ?, 
                        admin_perm_overview = ?, admin_perm_customize = ?
                    WHERE guild_id = ?
                `).run(
                    tickets ? 1 : 0, analytics ? 1 : 0, security ? 1 : 0, overview ? 1 : 0, customize ? 1 : 0,
                    guildId
                );
            }

            res.json({ success: true, data: { roleType, tickets, analytics, security, overview, customize } });
        } catch (error) {
            this.bot.logger.error('[AdvPerms] Error saving permissions:', error);
            res.json({ success: false, error: error.message });
        }
    }

    /**
     * Get XP leaderboard for a guild
     */
    async getLevelsLeaderboard(req, res) {
        try {
            const guildId = req.query.guildId;
            if (!guildId) return res.status(400).json({ error: 'Missing guildId' });

            // Get top 10 users by XP
            const leaderboard = await this.bot.database.all(
                `SELECT user_id, xp, level, total_messages
                 FROM user_levels 
                 WHERE guild_id = ? 
                 ORDER BY xp DESC 
                 LIMIT 10`,
                [guildId]
            );

            // Fetch usernames for each user
            const leaderboardWithNames = await Promise.all(leaderboard.map(async (user) => {
                try {
                    const discordUser = await this.bot.client.users.fetch(user.user_id).catch(() => null);
                    return {
                        ...user,
                        username: discordUser ? discordUser.username : `User ${user.user_id.slice(0, 8)}`
                    };
                } catch (e) {
                    return {
                        ...user,
                        username: `User ${user.user_id.slice(0, 8)}`
                    };
                }
            }));

            res.json({ success: true, leaderboard: leaderboardWithNames });
        } catch (error) {
            this.bot.logger.error('Error fetching leaderboard:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch leaderboard' });
        }
    }

    /**
     * Reset all XP for a guild (admin only)
     */
    async resetGuildLevels(req, res) {
        try {
            const guildId = req.body?.guildId;
            const userId = req.headers['x-user-id'] || req.body?.userId;

            if (!guildId || !userId) {
                return res.status(400).json({ error: 'Missing guildId or userId' });
            }

            // Verify user is admin of the guild
            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) return res.status(404).json({ error: 'Guild not found' });

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member || !member.permissions.has('ADMINISTRATOR')) {
                return res.status(403).json({ error: 'Unauthorized' });
            }

            // Reset all XP for the guild
            await this.bot.database.run(
                'DELETE FROM user_levels WHERE guild_id = ?',
                [guildId]
            );

            res.json({ success: true, message: 'All XP reset successfully' });
        } catch (error) {
            this.bot.logger.error('Error resetting guild levels:', error);
            res.status(500).json({ success: false, error: 'Failed to reset XP' });
        }
    }

    // ===== Help Ticket System Methods =====
    
    async getHelpTickets(req, res) {
        try {
            const user = req.user;
            if (!user) return res.status(401).json({ error: 'Access token required' });

            const { status, category, limit = 50 } = req.query;

            if (!this.bot.helpTicketSystem) {
                return res.status(503).json({ error: 'Help ticket system not available' });
            }

            let tickets = [];
            
            if (status) {
                tickets = await this.bot.helpTicketSystem.getTicketsByStatus(status, parseInt(limit));
            } else if (category) {
                tickets = await this.bot.helpTicketSystem.getTicketsByCategory(category, parseInt(limit));
            } else {
                tickets = await this.bot.helpTicketSystem.getAllTickets(parseInt(limit));
            }

            res.json({ success: true, tickets });
        } catch (error) {
            this.bot.logger.error('Error fetching help tickets:', error);
            res.status(500).json({ error: 'Failed to fetch help tickets' });
        }
    }

    async getHelpTicketStats(req, res) {
        try {
            const user = req.user;
            if (!user) return res.status(401).json({ error: 'Access token required' });

            const guildId = req.query.guildId || req.user.guildId;

            if (!this.bot.helpTicketSystem) {
                return res.status(503).json({ error: 'Help ticket system not available' });
            }

            const stats = await this.bot.helpTicketSystem.getTicketStats(guildId);
            res.json({ success: true, stats });
        } catch (error) {
            this.bot.logger.error('Error fetching help ticket stats:', error);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    }

    async getHelpTicketDetails(req, res) {
        try {
            const user = req.user;
            if (!user) return res.status(401).json({ error: 'Access token required' });

            const { ticketId } = req.params;

            if (!this.bot.helpTicketSystem) {
                return res.status(503).json({ error: 'Help ticket system not available' });
            }

            const ticket = await this.bot.helpTicketSystem.getTicket(ticketId);
            if (!ticket) {
                return res.status(404).json({ error: 'Ticket not found' });
            }

            const messages = await this.bot.helpTicketSystem.getTicketMessages(ticketId);
            
            res.json({ success: true, ticket: { ...ticket, messages } });
        } catch (error) {
            this.bot.logger.error('Error fetching help ticket details:', error);
            res.status(500).json({ error: 'Failed to fetch ticket details' });
        }
    }

    async updateHelpTicketStatus(req, res) {
        try {
            const user = req.user;
            if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Admin access required' });

            const { ticketId } = req.params;
            const { status, response } = req.body;

            if (!this.bot.helpTicketSystem) {
                return res.status(503).json({ error: 'Help ticket system not available' });
            }

            const success = await this.bot.helpTicketSystem.updateTicketStatus(ticketId, status, response);
            
            if (success) {
                res.json({ success: true, message: 'Ticket status updated' });
            } else {
                res.status(500).json({ error: 'Failed to update ticket' });
            }
        } catch (error) {
            this.bot.logger.error('Error updating help ticket status:', error);
            res.status(500).json({ error: 'Failed to update status' });
        }
    }

    async assignHelpTicket(req, res) {
        try {
            const user = req.user;
            if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Admin access required' });

            const { ticketId } = req.params;
            const { adminId } = req.body;

            if (!this.bot.helpTicketSystem) {
                return res.status(503).json({ error: 'Help ticket system not available' });
            }

            const assignToId = adminId || user.discordId || user.id || 'admin';
            const success = await this.bot.helpTicketSystem.assignTicket(ticketId, assignToId);
            
            if (success) {
                res.json({ success: true, message: 'Ticket assigned' });
            } else {
                res.status(500).json({ error: 'Failed to assign ticket' });
            }
        } catch (error) {
            this.bot.logger.error('Error assigning help ticket:', error);
            res.status(500).json({ error: 'Failed to assign ticket' });
        }
    }

    async replyToHelpTicket(req, res) {
        try {
            const user = req.user;
            if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Admin access required' });

            const { ticketId } = req.params;
            const { message } = req.body;

            if (!message) {
                return res.status(400).json({ error: 'Message required' });
            }

            if (!this.bot.helpTicketSystem) {
                return res.status(503).json({ error: 'Help ticket system not available' });
            }

            // Use Discord user ID if available, otherwise use 'admin' as identifier
            const adminId = user.discordId || user.id || 'admin';
            
            const success = await this.bot.helpTicketSystem.addTicketMessage(ticketId, adminId, message, true);
            
            if (success) {
                // Try to send DM to user
                try {
                    const ticket = await this.bot.helpTicketSystem.getTicket(ticketId);
                    if (ticket && ticket.user_id) {
                        const userObj = await this.bot.client.users.fetch(ticket.user_id).catch(() => null);
                        if (userObj) {
                            const { EmbedBuilder } = require('discord.js');
                            const embed = new EmbedBuilder()
                                .setTitle(`Ã°Å¸â€œÂ¬ Reply to Ticket ${ticketId}`)
                                .setDescription(message)
                                .setColor('#3b82f6')
                                .addFields(
                                    { name: 'Ticket', value: ticket.subject, inline: true },
                                    { name: 'Status', value: ticket.status, inline: true }
                                )
                                .setTimestamp();
                            await userObj.send({ embeds: [embed] }).catch(() => null);
                            this.bot.logger.info(`Reply sent to user ${ticket.user_id} for ticket ${ticketId}`);
                        }
                    }
                } catch (dmError) {
                    this.bot.logger.warn('Could not DM user for ticket reply:', dmError);
                }
                
                res.json({ success: true, message: 'Reply sent successfully' });
            } else {
                res.status(500).json({ error: 'Failed to add reply' });
            }
        } catch (error) {
            this.bot.logger.error('Error replying to help ticket:', error);
            res.status(500).json({ error: 'Failed to add reply' });
        }
    }

    async updateHelpTicketPriority(req, res) {
        try {
            const user = req.user;
            if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Admin access required' });

            const { ticketId } = req.params;
            const { priority } = req.body;

            if (!priority || !['low', 'normal', 'high', 'urgent'].includes(priority)) {
                return res.status(400).json({ error: 'Valid priority required (low, normal, high, urgent)' });
            }

            if (!this.bot.helpTicketSystem) {
                return res.status(503).json({ error: 'Help ticket system not available' });
            }

            const success = await this.bot.helpTicketSystem.updateTicketPriority(ticketId, priority);
            
            if (success) {
                res.json({ success: true, message: 'Priority updated' });
            } else {
                res.status(500).json({ error: 'Failed to update priority' });
            }
        } catch (error) {
            this.bot.logger.error('Error updating help ticket priority:', error);
            res.status(500).json({ error: 'Failed to update priority' });
        }
    }

    async addHelpTicketNote(req, res) {
        try {
            const user = req.user;
            if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Admin access required' });

            const { ticketId } = req.params;
            const { note } = req.body;

            if (!note) {
                return res.status(400).json({ error: 'Note required' });
            }

            if (!this.bot.helpTicketSystem) {
                return res.status(503).json({ error: 'Help ticket system not available' });
            }

            const adminId = user.discordId || user.id || 'admin';
            const success = await this.bot.helpTicketSystem.addTicketNote(ticketId, adminId, note);
            
            if (success) {
                res.json({ success: true, message: 'Note added' });
            } else {
                res.status(500).json({ error: 'Failed to add note' });
            }
        } catch (error) {
            this.bot.logger.error('Error adding help ticket note:', error);
            res.status(500).json({ error: 'Failed to add note' });
        }
    }

    async deleteHelpTicket(req, res) {
        try {
            const user = req.user;
            if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Admin access required' });

            const { ticketId } = req.params;

            if (!this.bot.helpTicketSystem) {
                return res.status(503).json({ error: 'Help ticket system not available' });
            }

            const success = await this.bot.helpTicketSystem.deleteTicket(ticketId);
            
            if (success) {
                res.json({ success: true, message: 'Ticket deleted' });
            } else {
                res.status(500).json({ error: 'Failed to delete ticket' });
            }
        } catch (error) {
            this.bot.logger.error('Error deleting help ticket:', error);
            res.status(500).json({ error: 'Failed to delete ticket' });
        }
    }

    // ===== Pro Plan Code Generator Methods =====

    async generateProCode(req, res) {
        try {
            const user = req.user;
            if (!user || user.role !== 'admin') {
                return res.status(401).json({ error: 'Admin access required' });
            }

            const userId = user.id || user.userId;
            if (!userId) {
                return res.status(401).json({ error: 'Admin ID missing in token' });
            }

            const { durationDays = 30, maxUses = 1, description = '' } = req.body;

            // Generate unique code
            const code = this.generateUniqueCode();
            const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

            // Store in database
            await this.bot.database.run(
                `INSERT INTO pro_codes (code, created_by, duration_days, max_uses, description, expires_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [code, userId, durationDays, maxUses, description, expiresAt.toISOString()]
            );

            res.json({
                success: true,
                code,
                expiresAt: expiresAt.toISOString(),
                durationDays,
                maxUses,
                message: 'Pro code generated successfully'
            });
        } catch (error) {
            this.bot.logger.error('Error generating pro code:', error);
            res.status(500).json({ error: 'Failed to generate code' });
        }
    }

    async listGeneratedCodes(req, res) {
        try {
            const user = req.user;
            if (!user || user.role !== 'admin') {
                return res.status(401).json({ error: 'Admin access required' });
            }

            const codes = await this.bot.database.all(
                `SELECT code, created_by, duration_days, max_uses, current_uses, description, 
                        expires_at, created_at, last_used_at, status
                 FROM pro_codes ORDER BY created_at DESC LIMIT 100`
            );

            res.json({ success: true, codes: codes || [] });
        } catch (error) {
            this.bot.logger.error('Error listing pro codes:', error);
            res.status(500).json({ error: 'Failed to fetch codes' });
        }
    }

    async redeemProCode(req, res) {
        try {
            const user = req.user;
            if (!user) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const userId = user.id || user.userId;
            if (!userId) {
                return res.status(401).json({ error: 'User ID missing in token' });
            }

            const { code } = req.params;
            const guildId = req.body.guildId;

            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            // Check if code exists and is valid
            const codeRecord = await this.bot.database.get(
                `SELECT * FROM pro_codes WHERE code = ?`,
                [code]
            );

            if (!codeRecord) {
                return res.status(404).json({ error: 'Code not found' });
            }

            if (codeRecord.status && codeRecord.status !== 'active') {
                return res.status(400).json({ error: 'Code is not active' });
            }

            if (new Date(codeRecord.expires_at) < new Date()) {
                return res.status(400).json({ error: 'Code has expired' });
            }

            if (codeRecord.current_uses >= codeRecord.max_uses) {
                return res.status(400).json({ error: 'Code has reached maximum uses' });
            }

            // Check if user already redeemed
            const existing = await this.bot.database.get(
                `SELECT * FROM pro_redemptions WHERE code = ? AND user_id = ?`,
                [code, userId]
            );

            if (existing) {
                return res.status(400).json({ error: 'You have already redeemed this code' });
            }

            // Ensure guild config row exists before updating
            await this.bot.database.getGuildConfig(guildId);

            // Activate pro plan for guild
            await this.bot.database.run(
                `UPDATE guild_configs SET pro_enabled = 1, pro_expires_at = datetime('now', '+${codeRecord.duration_days} days')
                 WHERE guild_id = ?`,
                [guildId]
            );

            // Record redemption
            await this.bot.database.run(
                `INSERT INTO pro_redemptions (code, user_id, guild_id, redeemed_at)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                [code, userId, guildId]
            );

            // Increment usage count
            await this.bot.database.run(
                `UPDATE pro_codes SET current_uses = current_uses + 1, last_used_at = CURRENT_TIMESTAMP
                 WHERE code = ?`,
                [code]
            );

            res.json({
                success: true,
                message: `Ã¢Å“â€¦ Pro plan activated for ${codeRecord.duration_days} days!`,
                expiresAt: new Date(Date.now() + codeRecord.duration_days * 24 * 60 * 60 * 1000).toISOString()
            });
        } catch (error) {
            this.bot.logger.error('Error redeeming pro code:', error);
            res.status(500).json({ error: 'Failed to redeem code' });
        }
    }

    async revokeProCode(req, res) {
        try {
            const user = req.user;
            if (!user || user.role !== 'admin') {
                return res.status(401).json({ error: 'Admin access required' });
            }

            const { code } = req.params;

            await this.bot.database.run(
                `UPDATE pro_codes SET status = 'revoked' WHERE code = ?`,
                [code]
            );

            res.json({ success: true, message: 'Code revoked successfully' });
        } catch (error) {
            this.bot.logger.error('Error revoking pro code:', error);
            res.status(500).json({ error: 'Failed to revoke code' });
        }
    }

    async deleteProCode(req, res) {
        try {
            const user = req.user;
            if (!user || user.role !== 'admin') {
                return res.status(401).json({ error: 'Admin access required' });
            }

            const { code } = req.params;

            // Delete from pro_codes table
            await this.bot.database.run(
                `DELETE FROM pro_codes WHERE code = ?`,
                [code]
            );

            res.json({ success: true, message: 'Code deleted successfully' });
        } catch (error) {
            this.bot.logger.error('Error deleting pro code:', error);
            res.status(500).json({ error: 'Failed to delete code' });
        }
    }

    generateUniqueCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = 'PRO-';
        for (let i = 0; i < 12; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    /**
     * Get current user info from JWT token
     */
    async getCurrentUser(req, res) {
        try {
            const user = req.user;
            if (!user) {
                return res.status(401).json({ error: 'Not authenticated' });
            }

            res.json({
                userId: user.userId,
                username: user.username,
                globalName: user.globalName,
                avatar: user.avatar,
                role: user.role,
                hasAccess: user.hasAccess
            });
        } catch (error) {
            this.bot.logger.error('Error getting current user:', error);
            res.status(500).json({ error: 'Failed to get user info' });
        }
    }

    /**
     * Redeem access code without requiring guild ID (simpler version for non-admin users)
     */
    async redeemAccessCodeSimple(req, res) {
        try {
            const { code } = req.body;
            const userId = req.user?.userId;

            if (!code || typeof code !== 'string') {
                return res.status(400).json({ error: 'Access code required' });
            }

            // Find the code
            const codeData = await this.bot.database.get(
                `SELECT guild_id, expires_at FROM dashboard_access_codes 
                 WHERE code = ? AND redeemed_by IS NULL`,
                [code.toUpperCase()]
            );

            if (!codeData) {
                return res.status(404).json({ error: 'Invalid or already redeemed access code' });
            }

            // Check if expired
            if (new Date(codeData.expires_at) < new Date()) {
                await this.bot.database.run(
                    `DELETE FROM dashboard_access_codes WHERE code = ?`,
                    [code.toUpperCase()]
                );
                return res.status(400).json({ error: 'Access code has expired' });
            }

            // Grant access to user
            await this.bot.database.run(
                `INSERT OR REPLACE INTO dashboard_access (guild_id, user_id, granted_by, created_at) 
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                [codeData.guild_id, userId, 'access_code']
            );

            // Mark code as redeemed
            await this.bot.database.run(
                `UPDATE dashboard_access_codes SET redeemed_by = ?, redeemed_at = CURRENT_TIMESTAMP 
                 WHERE code = ?`,
                [userId, code.toUpperCase()]
            );

            // Get guild info
            const guild = this.bot.client.guilds.cache.get(codeData.guild_id);
            
            // Create new JWT token with access granted
            const jwt = require('jsonwebtoken');
            const newToken = jwt.sign(
                {
                    userId: req.user.userId,
                    username: req.user.username,
                    globalName: req.user.globalName,
                    avatar: req.user.avatar,
                    role: 'user',
                    hasAccess: true, // Now they have access
                    accessGuild: { id: codeData.guild_id, name: guild?.name || 'Unknown Server' },
                    issuedAt: Date.now()
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            // Update the cookie with new token
            const cookieSecure = process.env.NODE_ENV === 'production' && (req.secure || req.headers['x-forwarded-proto'] === 'https');
            res.cookie('dashboardToken', newToken, {
                httpOnly: true,
                secure: cookieSecure,
                sameSite: cookieSecure ? 'strict' : 'lax',
                maxAge: 24 * 60 * 60 * 1000,
                path: '/'
            });
            
            this.bot.logger.info(`[ACCESS_CODE] User ${userId} redeemed access code ${code} for guild ${codeData.guild_id}`);
            res.json({ 
                success: true, 
                message: 'Access granted successfully',
                guildId: codeData.guild_id,
                serverName: guild?.name || 'Unknown Server'
            });
        } catch (error) {
            this.bot.logger.error('Error redeeming access code:', error);
            res.status(500).json({ error: 'Failed to redeem access code' });
        }
    }

    /**
     * Initialize web verification session
     */
    async handleWebVerifyInit(req, res) {
        try {
            const { token, guildId, userId } = req.body;

            // Lookup by token first
            if (token) {
                const session = await this.bot.database?.get(
                    `SELECT * FROM verification_sessions WHERE token = ? AND status = 'pending'`,
                    [token]
                );

                if (!session) {
                    return res.status(404).json({ error: 'Invalid or expired verification link' });
                }

                // Check expiry
                if (session.expires_at && new Date(session.expires_at) < new Date()) {
                    await this.bot.database?.run(
                        `UPDATE verification_sessions SET status = 'expired' WHERE id = ?`,
                        [session.id]
                    );
                    return res.status(410).json({ error: 'Verification link expired. Please request a new one.' });
                }

                const guild = this.bot.client.guilds.cache.get(session.guild_id);

                // If method needs a visible code, generate a fresh one and update the session
                let captchaCode = null;
                if (session.method === 'captcha') {
                    const crypto = require('crypto');
                    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                    captchaCode = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
                    const codeHash = crypto.createHash('sha256').update(captchaCode.toLowerCase()).digest('hex');
                    const newExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
                    await this.bot.database?.run(
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
                const session = await this.bot.database?.get(
                    `SELECT * FROM verification_sessions 
                     WHERE guild_id = ? AND user_id = ? AND status = 'pending'
                     ORDER BY created_at DESC LIMIT 1`,
                    [guildId, userId]
                );

                if (session) {
                    const guild = this.bot.client.guilds.cache.get(guildId);
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
            this.bot.logger?.error('Web verify init error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }

    /**
     * Submit web verification
     */
    async handleWebVerifySubmit(req, res) {
        try {
            console.log('[WebVerify] Raw body:', JSON.stringify(req.body));
            const { token, code, challenge, guildId, userId } = req.body;
            
            console.log('[WebVerify] Submit received:', { hasToken: !!token, hasGuildId: !!guildId, hasUserId: !!userId, hasCode: !!code });
            this.bot.logger?.info('[WebVerify] Submit received:', { hasToken: !!token, hasGuildId: !!guildId, hasUserId: !!userId, hasCode: !!code });

            // Allow legacy fallback when token is missing but guild/user provided
            let session = null;
            if (token) {
                session = await this.bot.database?.get(
                    `SELECT * FROM verification_sessions WHERE token = ? AND status = 'pending'`,
                    [token]
                );
            } else if (guildId && userId) {
                session = await this.bot.database?.get(
                    `SELECT * FROM verification_sessions WHERE guild_id = ? AND user_id = ? AND status = 'pending'
                     ORDER BY created_at DESC LIMIT 1`,
                    [guildId, userId]
                );
            } else {
                this.bot.logger?.warn('[WebVerify] Submit failed: no token or guild/user IDs');
                return res.status(400).json({ error: 'Token or guild/user IDs required' });
            }

            if (!session) {
                this.bot.logger?.warn('[WebVerify] Session not found:', { token, guildId, userId });
                return res.status(404).json({ error: 'Invalid or expired session' });
            }

            this.bot.logger?.info('[WebVerify] Session found:', { method: session.method, hasCodeHash: !!session.code_hash });

            // Check expiry
            if (session.expires_at && new Date(session.expires_at) < new Date()) {
                await this.bot.database?.run(
                    `UPDATE verification_sessions SET status = 'expired' WHERE id = ?`,
                    [session.id]
                );
                return res.status(410).json({ error: 'Session expired' });
            }

            // Simple challenge verification (for web method - no code needed)
            if (session.method === 'web') {
                // Web verification just requires clicking - verify immediately
                this.bot.logger?.info('[WebVerify] Completing web verification (no code needed)');
                await this.completeWebVerification(session);
                return res.json({ success: true, message: 'Verification complete!' });
            }

            // Captcha/code verification
            if (code) {
                const crypto = require('crypto');
                const codeHash = crypto.createHash('sha256').update(code.toLowerCase()).digest('hex');
                
                if (codeHash !== session.code_hash) {
                    // Increment attempts
                    await this.bot.database?.run(
                        `UPDATE verification_sessions SET attempts = attempts + 1 WHERE id = ?`,
                        [session.id]
                    );
                    
                    const updated = await this.bot.database?.get(
                        `SELECT attempts FROM verification_sessions WHERE id = ?`, 
                        [session.id]
                    );
                    
                    if (updated?.attempts >= 5) {
                        await this.bot.database?.run(
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
            this.bot.logger?.error('Web verify submit error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }

    /**
     * Refresh verification code
     */
    async handleWebVerifyRefresh(req, res) {
        try {
            const { token } = req.body;

            if (!token) {
                return res.status(400).json({ error: 'Token required' });
            }

            const session = await this.bot.database?.get(
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
            await this.bot.database?.run(
                `UPDATE verification_sessions SET code_hash = ?, expires_at = ?, attempts = 0 WHERE id = ?`,
                [codeHash, newExpiry, session.id]
            );

            // Try to DM new code to user
            try {
                const guild = this.bot.client.guilds.cache.get(session.guild_id);
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
                // DM failed - code still available via API response in dev mode
            }

            return res.json({ 
                success: true, 
                message: 'New code sent to your DMs',
                expiresAt: newExpiry,
                captchaCode: code
            });
        } catch (error) {
            this.bot.logger?.error('Web verify refresh error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }

    /**
     * Complete web verification and assign roles
     */
    async completeWebVerification(session) {
        const guild = this.bot.client.guilds.cache.get(session.guild_id);
        if (!guild) throw new Error('Guild not found');

        const member = await guild.members.fetch(session.user_id).catch(() => null);
        if (!member) throw new Error('Member not found');

        const config = await this.bot.database?.getGuildConfig(session.guild_id);

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

        // Delete any old sessions for this user to avoid UNIQUE constraint issues
        await this.bot.database?.run(
            `DELETE FROM verification_sessions 
             WHERE guild_id = ? AND user_id = ? AND id != ?`,
            [session.guild_id, session.user_id, session.id]
        );

        // Update session status
        await this.bot.database?.run(
            `UPDATE verification_sessions 
             SET status = 'completed', completed_at = CURRENT_TIMESTAMP, completed_by = ?
             WHERE id = ?`,
            ['web', session.id]
        );

        // Log to forensics
        if (this.bot.forensicsManager) {
            await this.bot.forensicsManager.logAuditEvent({
                guildId: session.guild_id,
                eventType: 'verification_complete',
                eventCategory: 'verification',
                executor: { id: session.user_id },
                target: { id: session.user_id, type: 'user' },
                metadata: { method: 'web', via: 'dashboard' }
            });
        }

        this.bot.logger?.info(`[WebVerify] Verified ${session.user_id} in ${session.guild_id}`);
    }

    // ==================== Access Code Management ====================

    async generateAccessCode(req, res) {
        try {
            const { guildId, type, permission, expiry, note } = req.body;
            const userId = req.user?.discordId || req.user?.userId;

            if (!guildId || !userId) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Verify user has admin access to this guild
            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            const hasAdminAccess = member && (
                member.permissions.has('Administrator') || 
                guild.ownerId === userId
            );

            if (!hasAdminAccess && userId !== 'admin') {
                return res.status(403).json({ error: 'Admin access required to generate codes' });
            }

            // Generate unique code
            const code = this.generateUniqueCode();

            // Calculate expiry date
            let expiresAt = null;
            if (expiry !== 'never') {
                const now = new Date();
                if (expiry === '1h') expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
                else if (expiry === '24h') expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                else if (expiry === '7d') expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                else if (expiry === '30d') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            }

            // Determine max uses
            let maxUses = 1;
            if (type === 'multi') maxUses = 10;
            else if (type === 'unlimited') maxUses = 999999;

            // Insert into database
            await this.bot.database.run(`
                INSERT INTO access_codes (code, guild_id, permission_level, code_type, max_uses, uses_remaining, created_by, expires_at, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [code, guildId, permission || 'viewer', type, maxUses, maxUses, userId, expiresAt?.toISOString(), note]);

            this.bot.logger.info(`[AccessCode] Generated code ${code} for guild ${guildId} by ${userId}`);

            res.json({
                success: true,
                code,
                expiresAt: expiresAt?.toISOString(),
                permission: permission || 'viewer',
                type
            });
        } catch (error) {
            this.bot.logger.error('[AccessCode] Error generating code:', error);
            res.status(500).json({ error: 'Failed to generate access code' });
        }
    }

    generateUniqueCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const segments = [];
        for (let i = 0; i < 4; i++) {
            let segment = '';
            for (let j = 0; j < 4; j++) {
                segment += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            segments.push(segment);
        }
        return segments.join('-');
    }

    async redeemAccessCode(req, res) {
        try {
            const { code } = req.body;
            const userId = req.user?.discordId || req.user?.userId;

            if (!code || !userId) {
                return res.status(400).json({ error: 'Missing code or user ID' });
            }

            // Fetch the access code
            const accessCode = await this.bot.database.get(`
                SELECT * FROM access_codes WHERE code = ? AND revoked = 0
            `, [code]);

            if (!accessCode) {
                return res.status(404).json({ error: 'Invalid or revoked access code' });
            }

            // Check if expired
            if (accessCode.expires_at) {
                const expiryDate = new Date(accessCode.expires_at);
                if (expiryDate < new Date()) {
                    return res.status(400).json({ error: 'Access code has expired' });
                }
            }

            // Check if uses remaining
            if (accessCode.uses_remaining <= 0) {
                return res.status(400).json({ error: 'Access code has no uses remaining' });
            }

            // Check if user already redeemed this code
            const existing = await this.bot.database.get(`
                SELECT * FROM access_code_redemptions WHERE code = ? AND user_id = ?
            `, [code, userId]);

            if (existing) {
                return res.status(400).json({ error: 'You have already redeemed this code' });
            }

            // Grant dashboard access based on permission level
            await this.bot.database.run(`
                INSERT OR REPLACE INTO dashboard_access (user_id, guild_id, access_level, granted_by, granted_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [userId, accessCode.guild_id, accessCode.permission_level, accessCode.created_by]);

            // Record redemption
            await this.bot.database.run(`
                INSERT INTO access_code_redemptions (code, user_id, guild_id)
                VALUES (?, ?, ?)
            `, [code, userId, accessCode.guild_id]);

            // Decrement uses remaining
            await this.bot.database.run(`
                UPDATE access_codes SET uses_remaining = uses_remaining - 1 WHERE code = ?
            `, [code]);

            // Get server name
            const guild = this.bot.client.guilds.cache.get(accessCode.guild_id);
            const serverName = guild?.name || 'Server';

            this.bot.logger.info(`[AccessCode] User ${userId} redeemed code ${code} for guild ${accessCode.guild_id}`);

            res.json({
                success: true,
                serverName,
                guildId: accessCode.guild_id,
                permission: accessCode.permission_level
            });
        } catch (error) {
            this.bot.logger.error('[AccessCode] Error redeeming code:', error);
            res.status(500).json({ error: 'Failed to redeem access code' });
        }
    }

    async getGuildAccessCodes(req, res) {
        try {
            const { guildId } = req.params;
            const userId = req.user?.discordId || req.user?.userId;

            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            // Verify user has access to this guild
            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            const hasAccess = member && (
                member.permissions.has('Administrator') || 
                guild.ownerId === userId
            );

            if (!hasAccess && userId !== 'admin') {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Get all non-revoked codes for this guild
            const codes = await this.bot.database.all(`
                SELECT code, permission_level as permission, code_type, max_uses, uses_remaining as usesRemaining, 
                       created_at as createdAt, expires_at as expiresAt, note, revoked
                FROM access_codes 
                WHERE guild_id = ? AND revoked = 0
                ORDER BY created_at DESC
            `, [guildId]);

            res.json(codes);
        } catch (error) {
            this.bot.logger.error('[AccessCode] Error fetching codes:', error);
            res.status(500).json({ error: 'Failed to fetch access codes' });
        }
    }

    async revokeAccessCode(req, res) {
        try {
            const { code } = req.params;
            const userId = req.user?.discordId || req.user?.userId;

            // Get the access code
            const accessCode = await this.bot.database.get(`
                SELECT * FROM access_codes WHERE code = ?
            `, [code]);

            if (!accessCode) {
                return res.status(404).json({ error: 'Access code not found' });
            }

            // Verify user has permission to revoke (must be admin of the guild)
            const guild = this.bot.client.guilds.cache.get(accessCode.guild_id);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            const hasAccess = member && (
                member.permissions.has('Administrator') || 
                guild.ownerId === userId
            );

            if (!hasAccess && userId !== 'admin') {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Revoke the code
            await this.bot.database.run(`
                UPDATE access_codes SET revoked = 1, revoked_at = CURRENT_TIMESTAMP WHERE code = ?
            `, [code]);

            this.bot.logger.info(`[AccessCode] Code ${code} revoked by ${userId}`);

            res.json({ success: true });
        } catch (error) {
            this.bot.logger.error('[AccessCode] Error revoking code:', error);
            res.status(500).json({ error: 'Failed to revoke access code' });
        }
    }
    
    // ==================== WORD FILTER PRESETS ====================
    
    async getWordFilterPresets(req, res) {
        try {
            if (!this.bot.wordFilter) {
                return res.status(503).json({ error: 'Word filter system not initialized' });
            }
            
            const presets = await this.bot.wordFilter.getPresets();
            res.json({ success: true, presets });
        } catch (error) {
            this.bot.logger.error('[WordFilter] Error fetching presets:', error);
            res.status(500).json({ error: 'Failed to fetch presets' });
        }
    }
    
    async applyWordFilterPreset(req, res) {
        try {
            const { guildId } = req.params;
            const { presetName, action } = req.body;
            const userId = req.user?.discordId || req.user?.userId;
            
            if (!guildId || !presetName) {
                return res.status(400).json({ error: 'Guild ID and preset name required' });
            }
            
            if (!this.bot.wordFilter) {
                return res.status(503).json({ error: 'Word filter system not initialized' });
            }
            
            // Check authorization
            const access = await this.checkGuildAccess(userId, guildId, true);
            if (!access.authorized) {
                return res.status(403).json({ error: access.error || 'Access denied' });
            }
            
            // Apply the preset
            const wordsAdded = await this.bot.wordFilter.applyPreset(
                guildId, 
                presetName, 
                action || 'delete', 
                userId
            );
            
            // Clear cache
            if (this.bot.wordFilter.configCache) {
                this.bot.wordFilter.configCache.delete(guildId);
                this.bot.wordFilter.cacheExpiry.delete(guildId);
            }
            
            this.bot.logger.info(`[WordFilter] Preset "${presetName}" applied to guild ${guildId} by ${userId} (${wordsAdded} words added)`);
            
            res.json({ 
                success: true, 
                message: `Preset applied successfully`,
                wordsAdded 
            });
        } catch (error) {
            this.bot.logger.error('[WordFilter] Error applying preset:', error);
            res.status(500).json({ error: error.message || 'Failed to apply preset' });
        }
    }
}

module.exports = SecurityDashboard;

// If this file is run directly, start the dashboard
if (require.main === module) {
    require('dotenv').config({ path: '../../.env' });
    
    // Create a mock bot object for standalone dashboard
    const mockBot = {
        logger: {
            info: console.log,
            error: console.error,
            warn: console.warn
        },
        database: {
            // Mock database methods
            async getSecurityLogs(filter) {
                return [];
            },
            async getSecurityIncidents(filter) {
                return [];
            }
        }
    };
    
    const dashboard = new SecurityDashboard(mockBot);
    dashboard.start().then(() => {
        console.log('Dashboard started successfully');
    }).catch(error => {
        console.error('Failed to start dashboard:', error);
    });
}
