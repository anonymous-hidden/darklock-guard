const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize Tamper Protection System
const TamperProtectionSystem = require('../file-protection/index');
const tamperProtection = new TamperProtectionSystem();

// Validate environment variables on startup
const EnvValidator = require('./utils/env-validator');
const envValidator = new EnvValidator();
envValidator.sanitize();
const validationResult = envValidator.validate();

const reportOk = envValidator.printReport();

// Allow skipping strict validation via explicit env var or when running on common CI/host platforms
const hostAutoSkip = !!(
    process.env.CI === 'true' ||
    process.env.RENDER ||
    process.env.HEROKU ||
    process.env.GITHUB_ACTIONS === 'true' ||
    process.env.RAILWAY ||
    process.env.NETLIFY
);

const SKIP_VALIDATION = (
    process.env.SKIP_ENV_VALIDATION === '1' ||
    process.env.SKIP_ENV_VALIDATION === 'true' ||
    hostAutoSkip
);

if (!reportOk) {
    if (SKIP_VALIDATION) {
        if (hostAutoSkip && !process.env.SKIP_ENV_VALIDATION) {
            console.warn('\n⚠️ Environment validation reported errors, but a hosting/CI environment was detected — continuing startup. To force strict validation, unset CI/RENDER/HEROKU/GITHUB_ACTIONS/RAILWAY/NETLIFY or set `SKIP_ENV_VALIDATION=0`.\n');
        } else {
            console.warn('\n⚠️ Environment validation reported errors, but `SKIP_ENV_VALIDATION` is set — continuing startup. Discord login may be skipped if the token is invalid.\n');
        }
    } else {
        console.error('\n❌ Environment validation failed! Please fix the errors above before starting the bot.\n');
        process.exit(1);
    }
}

// Import core modules
const Database = require('./database/database');
const Logger = require('./utils/logger');
const ConfigManager = require('./utils/config');

// Import security modules
const AntiRaid = require('./security/antiraid');
const AntiSpam = require('./security/antispam');
const AntiNuke = require('./security/antinuke');
const AntiNukeManager = require('./security/AntiNukeManager');
const AntiMaliciousLinks = require('./security/antilinks');
const AntiPhishing = require('./security/antiphishing');
const RoleAuditing = require('./security/roleaudit');
const ChannelProtection = require('./security/channelprotection');
const UserVerification = require('./security/userverification');
const ToxicityFilter = require('./security/toxicity');
const BehaviorDetection = require('./security/behavior');
const setupAuditWatcher = require('./security/auditWatcher');

// Import utility modules
const BackupManager = require('./utils/backup');
const SecurityDashboard = require('./dashboard/dashboard');
const TicketManager = require('./utils/ticket-manager');
const DMTicketManager = require('./utils/DMTicketManager');
const EventEmitter = require('./utils/EventEmitter');
const HelpTicketSystem = require('./utils/HelpTicketSystem');

// Import new enhanced modules
const SecurityManager = require('./utils/SecurityManager');
const AnalyticsManager = require('./utils/AnalyticsManager');
const EnhancedTicketManager = require('./utils/EnhancedTicketManager');
const SettingsManager = require('./utils/SettingsManager');
const PermissionManager = require('./utils/PermissionManager');
const SetupWizard = require('./utils/SetupWizard');
const SecurityScanner = require('./utils/SecurityScanner');
const DashboardLogger = require('./utils/DashboardLogger');
const ConfirmationManager = require('./utils/ConfirmationManager');
const TicketSystem = require('./utils/TicketSystem');
const ForensicsManager = require('./utils/ForensicsManager');
const LockdownManager = require('./utils/LockdownManager');

// Import rank system modules
const RankSystem = require('./utils/RankSystem');
const RankCardGenerator = require('./utils/RankCardGenerator');
const OpenAIClient = require('./utils/OpenAIClient');

// Import new XP system modules
const XPDatabase = require('./db/xpDatabase');
const XPTracker = require('./bot/xpTracker');
const WebDashboard = require('./web/server');

// Import new enterprise services
const SecurityMiddleware = require('./services/SecurityMiddleware');
const ModerationQueue = require('./services/ModerationQueue');
const ConfigService = require('./services/ConfigService');
const VerificationService = require('./services/VerificationService');

class SecurityBot {
    constructor() {
        // Global error handler for uncaught exceptions (logger may not exist yet)
        process.on('uncaughtException', (err) => {
            try {
                console.error('Uncaught Exception:', err);
            } catch {}
        });
        // Initialize Discord client with necessary intents
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildPresences,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.DirectMessageReactions,
                GatewayIntentBits.GuildModeration,
                GatewayIntentBits.GuildInvites,
                GatewayIntentBits.GuildWebhooks,
                GatewayIntentBits.GuildIntegrations,
                GatewayIntentBits.GuildEmojisAndStickers
            ],
            partials: [
                Partials.Message,
                Partials.Channel,
                Partials.Reaction,
                Partials.User,
                Partials.GuildMember
            ]
        });

        this.commands = new Collection();
        this.cooldowns = new Collection();
        
        // Initialize core systems
        this.database = null;
        this.logger = null;
        this.config = null;
        
        // Initialize security modules
        this.antiRaid = null;
        this.antiSpam = null;
        this.antiNuke = null;
        this.antiNukeManager = null;
        this.antiMaliciousLinks = null;
        this.antiPhishing = null;
        this.roleAuditing = null;
        this.channelProtection = null;
        this.userVerification = null;
        this.joinQueue = null;
        this.dmQueue = null;
        this.toxicityFilter = null;
        this.behaviorDetection = null;
        
        // Initialize utility modules
        this.backupManager = null;
        this.dashboard = null;
        this.ticketManager = null;
        
        // Initialize new enhanced systems
        this.securityManager = null;
        this.analyticsManager = null;
        this.enhancedTicketManager = null;
        this.settingsManager = null;
        this.setupWizard = null;
        this.securityScanner = null;
        this.dashboardLogger = null;
        this.confirmationManager = null;
        this.ticketSystem = null;
        this.forensicsManager = null;
        this.lockdownManager = null;
        
        // Initialize rank system
        this.rankSystem = null;
        this.rankCardGenerator = null;

        // Initialize new XP system
        this.xpDatabase = null;
        this.xpTracker = null;
        this.webDashboard = null;

        // Initialize new enterprise services
        this.securityMiddleware = null;
        this.moderationQueue = null;
        this.configService = null;
        this.verificationService = null;

        // Plan gating map for premium features
        this.planRequirements = {
            analytics: 'pro',
            antinuke: 'pro',
            security: 'pro',
            backup: 'pro',
            serversetup: 'pro',
            ticket_ai_summarize: 'enterprise'
        };

        // Per-guild console buffer: guildId -> entries (max 5000 per guild)
        this.consoleBuffer = new Map();
    }

    async initialize() {
        try {
            // Initialize database first
            this.database = new Database();
            await this.database.initialize();
            this.database.attachBot(this);
            
            // Initialize logger with database reference
            this.logger = new Logger(this);
            await this.logger.initialize();
            
            console.log('🤖 Initializing Discord Security Bot...');
            await this.logger.logInternal({
                eventType: 'bot_startup',
                message: 'Bot initialization started',
                details: { version: require('../package.json').version }
            });
            
            this.config = new ConfigManager();
            await this.config.loadConfig();
            
            // Load commands
            await this.loadCommands();

            console.log('🔧 Core modules loaded, initializing security modules...');
            
            // Initialize security modules
            this.antiRaid = new AntiRaid(this);
            this.antiSpam = new AntiSpam(this);
            this.antiNuke = new AntiNuke(this);
            this.logger.info('   ✅ Anti-nuke module loaded');
            this.antiMaliciousLinks = new AntiMaliciousLinks(this);
            this.antiPhishing = new AntiPhishing(this);
            this.roleAuditing = new RoleAuditing(this);
            this.channelProtection = new ChannelProtection(this);
            this.userVerification = new UserVerification(this);
            this.logger.info(`[DEBUG] UserVerification type: ${typeof this.userVerification}, verifyNewMember: ${typeof this.userVerification?.verifyNewMember}`);
            
            const JoinQueue = require('./utils/joinQueue');
            this.joinQueue = new JoinQueue(this);
            
            const DMQueue = require('./utils/dmQueue');
            this.dmQueue = new DMQueue(this);
            this.toxicityFilter = new ToxicityFilter(this);
            this.behaviorDetection = new BehaviorDetection(this);
            this.antiNukeManager = new AntiNukeManager(this);

            // Start audit watcher for fast anti-nuke detection
            try {
                setupAuditWatcher(this.client);
                this.logger.info('   ✅ AuditWatcher initialized');
            } catch (err) {
                this.logger.warn('   ⚠️ Failed to initialize AuditWatcher:', err?.message || err);
            }
            
            // Initialize utility modules
            this.backupManager = new BackupManager(this);
            
            // Initialize dashboard (but don't start it here)
            this.dashboard = new SecurityDashboard(this);
            
            // Set logger reference in dashboard for WebSocket broadcasting
            if (this.logger) {
                this.logger.setDashboard(this.dashboard);
            }
            
            // Initialize DM-based ticket manager (new system)
            this.dmTicketManager = new DMTicketManager(this);
            await this.dmTicketManager.initialize();
            console.log('   ✅ DM Ticket Manager initialized');
            
            // Initialize old ticket manager (for backwards compatibility)
            this.ticketManager = new TicketManager(this.client);
            
            // Initialize new enhanced systems
            this.logger.info('🚀 Initializing enhanced systems...');
            
            // Security Manager for comprehensive threat detection
            this.securityManager = new SecurityManager(this);
            this.logger.info('   ✅ Security Manager initialized');
            
            // Analytics Manager for detailed data tracking
            this.analyticsManager = new AnalyticsManager(this);
            this.logger.info('   ✅ Analytics Manager initialized');
            
            // Enhanced Ticket Manager for advanced support system
            this.enhancedTicketManager = new EnhancedTicketManager(this);
            await this.enhancedTicketManager.initialize();
            this.logger.info('   ✅ Enhanced Ticket Manager initialized');
            
            // Settings Manager for configuration
            this.settingsManager = new SettingsManager(this);
            this.logger.info('   ✅ Settings Manager initialized');

            // Permission Manager for role-based access
            this.permissionManager = new PermissionManager(this);
            this.logger.info('   ✅ Permission Manager initialized');
            
            // Setup Wizard for initial configuration
            this.setupWizard = new SetupWizard(this);
            this.logger.info('   ✅ Setup Wizard initialized');
            
            // Security Scanner for proactive threat detection
            this.securityScanner = new SecurityScanner(this);
            this.logger.info('   ✅ Security Scanner initialized');
            
            // Dashboard Logger for comprehensive command tracking
            this.dashboardLogger = new DashboardLogger(this);
            this.logger.info('   ✅ Dashboard Logger initialized');
            
            // Confirmation Manager for setting change notifications
            this.confirmationManager = new ConfirmationManager(this);
            this.logger.info('   ✅ Confirmation Manager initialized');

            // Ticket System for panel-based ticketing
            this.ticketSystem = new TicketSystem(this);
            this.logger.info('   ✅ Ticket System initialized');
            // Forensics Manager for immutable audit logging
            this.forensicsManager = new ForensicsManager(this);
            this.logger.info('   ✅ Forensics Manager initialized');

            // Lockdown Manager for server lockdowns
            this.lockdownManager = new LockdownManager(this);
            await this.lockdownManager.initialize();
            this.logger.info('   ✅ Lockdown Manager initialized');

            // Help Ticket System
            this.helpTicketSystem = new HelpTicketSystem(this.database, this.logger);
            this.logger.info('   ✅ Help Ticket System initialized');

            // Rank System for XP and leveling
            this.rankSystem = new RankSystem(this);
            this.rankCardGenerator = new RankCardGenerator();
            // OpenAI client (optional)
            this.openAIClient = new OpenAIClient(this);
            this.logger.info('   ✅ Rank System initialized');

            // Initialize new Arcane-style XP system
            this.logger.info('🎮 Initializing Arcane XP system...');
            this.xpDatabase = new XPDatabase('./data/xp.db');
            await this.xpDatabase.initialize();
            this.logger.info('   ✅ XP Database initialized');
            
            this.xpTracker = new XPTracker(this.client, this.xpDatabase);
            this.client.xpTracker = this.xpTracker;
            this.client.xpDatabase = this.xpDatabase;
            this.logger.info('   ✅ XP Tracker initialized');
            
            this.webDashboard = new WebDashboard(this.xpDatabase, this.client, parseInt(process.env.XP_DASHBOARD_PORT || '3007'));
            this.logger.info('   ✅ Web Dashboard initialized');

            // Initialize new enterprise services
            this.logger.info('🛡️ Initializing enterprise security services...');
            
            this.securityMiddleware = new SecurityMiddleware(this);
            this.logger.info('   ✅ Security Middleware initialized');
            
            this.moderationQueue = new ModerationQueue(this);
            this.logger.info('   ✅ Moderation Queue initialized');
            
            this.configService = new ConfigService(this);
            await this.configService.initialize();
            this.logger.info('   ✅ Config Service initialized');

            // Bind config change events to security modules
            const ConfigSubscriber = require('./services/config-subscriber');
            this.configSubscriber = new ConfigSubscriber(this);
            this.configSubscriber.bind();
            this.logger.info('   ✅ Config Subscriber bound');
            
            this.verificationService = new VerificationService(this);
            await this.verificationService.initialize();
            this.logger.info('   ✅ Verification Service initialized');

            // Event Emitter for bot and dashboard communication
            this.eventEmitter = new EventEmitter(this);
            this.logger.info('   ✅ Event Emitter initialized');

            // Broadcast helper for console messages
            this.broadcastConsole = (guildId, message) => {
                try {
                    if (this.dashboard && typeof this.dashboard.broadcastToGuild === 'function') {
                        this.dashboard.broadcastToGuild(guildId || null, { type: 'botConsole', message: String(message), timestamp: Date.now() });
                    }
                } catch (e) {
                    // Don't let console broadcasting crash the bot
                    try { this.logger?.warn && this.logger.warn('broadcastConsole failed:', e?.message || e); } catch (_) {}
                }
            };

            // Append to per-guild console buffer and broadcast
            this.appendConsoleLog = (guildId, entry) => {
                if (!guildId) return;
                if (!this.consoleBuffer.has(guildId)) this.consoleBuffer.set(guildId, []);
                const buf = this.consoleBuffer.get(guildId);
                buf.push(entry);
                if (buf.length > 5000) buf.shift();
                if (this.dashboard && typeof this.dashboard.broadcastToGuild === 'function') {
                    this.dashboard.broadcastToGuild(guildId, { type: 'botConsole', ...entry });
                }
            };

            // Structured event logging into console buffer
            this.logEvent = (type, data = {}) => {
                try {
                    const guildId = data.guildId || (data.guild && data.guild.id) || null;
                    if (!guildId) return; // scope to guild for console page
                    const entry = {
                        level: 'event',
                        eventType: String(type),
                        message: data.message || null,
                        data,
                        timestamp: Date.now()
                    };
                    this.appendConsoleLog(guildId, entry);
                } catch (_) {}
            };

            // Wrap console.* so dashboard receives all console outputs as well
            try {
                const _log = console.log.bind(console);
                const _info = console.info.bind(console);
                const _warn = console.warn.bind(console);
                const _error = console.error.bind(console);

                const serialize = (args) => args.map(a => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); } }).join(' ');
                const broadcastAllGuilds = (entryBase) => {
                    const guildIds = new Set();
                    if (this.client && this.client.guilds && this.client.guilds.cache) {
                        this.client.guilds.cache.forEach(g => guildIds.add(g.id));
                    }
                    if (guildIds.size === 0 && this.lastKnownGuildId) guildIds.add(this.lastKnownGuildId);
                    guildIds.forEach(gid => this.appendConsoleLog(gid, { ...entryBase, guildId: gid }));
                };

                console.log = (...args) => {
                    try { _log(...args); } catch (_) {}
                    const msg = serialize(args);
                    broadcastAllGuilds({ level: 'info', message: msg, timestamp: Date.now() });
                };

                console.info = (...args) => {
                    try { _info(...args); } catch (_) {}
                    const msg = serialize(args);
                    broadcastAllGuilds({ level: 'info', message: msg, timestamp: Date.now() });
                };

                console.warn = (...args) => {
                    try { _warn(...args); } catch (_) {}
                    const msg = serialize(args);
                    broadcastAllGuilds({ level: 'warn', message: msg, timestamp: Date.now() });
                };

                console.error = (...args) => {
                    try { _error(...args); } catch (_) {}
                    const msg = serialize(args);
                    broadcastAllGuilds({ level: 'error', message: msg, timestamp: Date.now() });
                };
            } catch (e) {
                this.logger?.warn && this.logger.warn('Failed to wrap console methods:', e?.message || e);
            }

            // Humanize helper for setting keys (e.g. anti_spam_enabled -> Anti Spam Enabled)
            this.humanizeSettingKey = (key) => {
                if (!key || typeof key !== 'string') return String(key);
                return key.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
            };

            // Lightweight helper: emit a universal setting change event
            this.emitSettingChange = (guildId, userId, settingKey, newValue) => {
                if (!this.eventEmitter || typeof this.eventEmitter.emit !== 'function') return;
                try {
                    this.eventEmitter.emit('settingChanged', { guildId, userId, settingKey, newValue });
                } catch (e) {
                    this.logger?.warn && this.logger.warn('emitSettingChange emit failed:', e?.message || e);
                }
            };

            // Save a history row for setting changes (helper for commands & listeners)
            this.saveSettingHistory = async (guildId, userId, settingKey, oldValue, newValue) => {
                try {
                    if (!this.database) return;
                    const oldStr = (typeof oldValue === 'undefined' || oldValue === null) ? null : JSON.stringify(oldValue);
                    const newStr = (typeof newValue === 'undefined' || newValue === null) ? null : JSON.stringify(newValue);
                    await this.database.run(
                        `INSERT INTO settings_history (guild_id, user_id, setting_key, old_value, new_value) VALUES (?, ?, ?, ?, ?)`,
                        [String(guildId), userId ? String(userId) : null, String(settingKey), oldStr, newStr]
                    );
                } catch (e) {
                    this.logger?.warn && this.logger.warn('saveSettingHistory failed:', e?.message || e);
                }
            };

            // Rollback a setting to the most recent value before targetTimestamp
            this.rollbackSetting = async (guildId, settingKey, targetTimestamp) => {
                try {
                    if (!this.database) throw new Error('Database unavailable');
                    // Normalize timestamp: accept ms or ISO
                    let cutoff;
                    if (!targetTimestamp) cutoff = new Date().toISOString();
                    else if (!isNaN(Number(targetTimestamp))) cutoff = new Date(Number(targetTimestamp)).toISOString();
                    else cutoff = new Date(targetTimestamp).toISOString();

                    const row = await this.database.get(
                        `SELECT * FROM settings_history WHERE guild_id = ? AND setting_key = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1`,
                        [String(guildId), String(settingKey), cutoff]
                    );

                    if (!row) throw new Error('No historical record found before specified timestamp');

                    let oldVal = row.old_value;
                    try { oldVal = oldVal === null ? null : JSON.parse(oldVal); } catch (e) { /* leave as raw */ }

                    // Determine whether target is a guild_configs column (no dot and exists) or guild_settings JSON
                    const isColumn = !String(settingKey).includes('.');
                    let applied = false;

                    if (isColumn) {
                        // Check if column exists in guild_configs
                        const cfg = await this.database.get('SELECT * FROM guild_configs WHERE guild_id = ?', [String(guildId)]).catch(() => null);
                        if (cfg && Object.prototype.hasOwnProperty.call(cfg, settingKey)) {
                            // Safe update using parameterized value
                            await this.database.run(`UPDATE guild_configs SET ${settingKey} = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`, [oldVal, String(guildId)]);
                            applied = true;
                        }
                    }

                    if (!applied) {
                        // Treat as nested key inside guild_settings.settings JSON
                        const settingsRow = await this.database.get('SELECT settings FROM guild_settings WHERE guild_id = ?', [String(guildId)]).catch(() => null);
                        let settingsObj = {};
                        if (settingsRow && settingsRow.settings) {
                            try { settingsObj = JSON.parse(settingsRow.settings); } catch (e) { settingsObj = {}; }
                        }

                        const parts = String(settingKey).split('.');
                        let ref = settingsObj;
                        for (let i = 0; i < parts.length - 1; i++) {
                            if (!ref[parts[i]] || typeof ref[parts[i]] !== 'object') ref[parts[i]] = {};
                            ref = ref[parts[i]];
                        }
                        ref[parts[parts.length - 1]] = oldVal;

                        // Ensure row exists, then update
                        await this.database.run('INSERT OR IGNORE INTO guild_settings (guild_id, settings) VALUES (?, ?)', [String(guildId), JSON.stringify(settingsObj)]);
                        await this.database.run('UPDATE guild_settings SET settings = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [JSON.stringify(settingsObj), String(guildId)]);
                        applied = true;
                    }

                    if (applied) {
                        // Notify listeners and dashboard about the rollback
                        try { if (typeof this.emitSettingChange === 'function') await this.emitSettingChange(String(guildId), 'System', settingKey, oldVal); } catch (e) { /* ignore */ }
                        return { success: true, setting: settingKey, value: oldVal };
                    }

                    throw new Error('Rollback failed: could not apply historical value');
                } catch (e) {
                    this.logger?.warn && this.logger.warn('rollbackSetting failed:', e?.message || e);
                    throw e;
                }
            };

            // Global listener: react to any settingChanged event and notify Discord & dashboard
            try {
                if (this.eventEmitter && typeof this.eventEmitter.on === 'function') {
                    this.eventEmitter.on('settingChanged', async (data) => {
                        try {
                            // Support both old and new payload shapes for compatibility
                            const guildId = data.guildId || data.guild_id || data.guild || null;
                            const userId = data.userId || data.user_id || data.user || null;
                            const settingKey = data.settingKey || data.setting_key || data.key || null;
                            const newValue = typeof data.newValue !== 'undefined' ? data.newValue : (typeof data.after !== 'undefined' ? data.after : null);

                            if (!guildId || !settingKey) return;

                            const guild = this.client.guilds.cache.get(String(guildId));
                            if (!guild) return;

                            const user = await guild.members.fetch(String(userId)).catch(() => null);

                            const prettyName = (settingKey || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                            const status = (typeof newValue === 'boolean') ? (newValue ? 'enabled' : 'disabled') : String(newValue);

                            // ---------- Send log message to Discord ----------
                            try {
                                let cfg = null;
                                if (this.database && typeof this.database.getGuildConfig === 'function') {
                                    try { cfg = await this.database.getGuildConfig(String(guildId)); } catch (_) { cfg = null; }
                                }

                                let logChannel = null;
                                if (cfg && cfg.log_channel_id) {
                                    logChannel = guild.channels.cache.get(String(cfg.log_channel_id)) || null;
                                }
                                if (!logChannel) {
                                    logChannel = guild.channels.cache.find(c => {
                                        try {
                                            return c && c.name && ['security', 'mod', 'logs'].some(n => c.name.toLowerCase().includes(n));
                                        } catch (_) {
                                            return false;
                                        }
                                    }) || null;
                                }

                                if (logChannel && typeof logChannel.isTextBased === 'function' ? logChannel.isTextBased() : (logChannel && String(logChannel.type || '').toLowerCase().includes('text'))) {
                                    try {
                                        await logChannel.send(`🔧 **${prettyName}** was **${status}** by ${user ? user.toString() : 'Unknown'}`);
                                    } catch (e) {
                                        this.logger?.warn && this.logger.warn('Failed to send confirmation to guild log channel:', e?.message || e);
                                    }
                                }
                            } catch (e) {
                                this.logger?.warn && this.logger.warn('settingChanged -> Discord logging error:', e?.message || e);
                            }

                            // ---------- Broadcast to dashboard ----------
                            try {
                                if (this.dashboard && typeof this.dashboard.broadcastToGuild === 'function') {
                                    this.dashboard.broadcastToGuild(String(guildId), {
                                        type: 'settingUpdate',
                                        key: settingKey,
                                        value: newValue,
                                        userId: userId,
                                        userTag: user?.user?.tag || 'Unknown',
                                        timestamp: Date.now()
                                    });
                                }
                            } catch (e) {
                                this.logger?.warn && this.logger.warn('settingChanged -> dashboard broadcast error:', e?.message || e);
                            }

                            // ---------- Log to Bot Console ----------
                            this.logEvent('settingChanged', { guildId: String(guildId), userId, key: settingKey, newValue, message: `Setting changed: ${settingKey} -> ${newValue}` });

                            // ---------- External Webhook Notification ----------
                            try {
                                const webhookUrl = process.env.EXTERNAL_LOG_WEBHOOK_URL;
                                if (webhookUrl) {
                                    const payload = {
                                        guildId: String(guildId),
                                        userId: userId ? String(userId) : null,
                                        userTag: user?.user?.tag || 'Unknown',
                                        setting: settingKey,
                                        value: newValue,
                                        timestamp: Date.now()
                                    };
                                    const controller = new (global.AbortController || require('abort-controller'))();
                                    const timeoutHandle = setTimeout(() => {
                                        try { controller.abort(); } catch (_) {}
                                    }, 3000);
                                    const doFetch = async () => {
                                        if (typeof fetch === 'function') return fetch;
                                        try {
                                            const mod = await import('node-fetch');
                                            return mod.default || mod;
                                        } catch (e) {
                                            return null;
                                        }
                                    };
                                    const f = await doFetch();
                                    if (f) {
                                        f(webhookUrl, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(payload),
                                            signal: controller.signal
                                        }).then(res => {
                                            if (!res.ok) {
                                                this.logger?.warn && this.logger.warn(`External webhook responded with status ${res.status}`);
                                            }
                                        }).catch(err => {
                                            if (err && err.name === 'AbortError') {
                                                this.logger?.warn && this.logger.warn('External webhook request timed out (3s)');
                                            } else {
                                                this.logger?.warn && this.logger.warn('External webhook post failed:', err?.message || err);
                                            }
                                        }).finally(() => {
                                            clearTimeout(timeoutHandle);
                                        });
                                    } else {
                                        clearTimeout(timeoutHandle);
                                        this.logger?.warn && this.logger.warn('Fetch unavailable: cannot send external setting change webhook');
                                    }
                                }
                            } catch (e) {
                                this.logger?.warn && this.logger.warn('External webhook logic error:', e?.message || e);
                            }

                            // ---------- Persist change to settings_history (if applicable) ----------
                            try {
                                const beforeVal = typeof data.before !== 'undefined' ? data.before : null;
                                const afterVal = newValue;
                                const beforeStr = beforeVal === null || typeof beforeVal === 'undefined' ? null : String(beforeVal);
                                const afterStr = afterVal === null || typeof afterVal === 'undefined' ? null : String(afterVal);
                                if (beforeStr !== afterStr) {
                                    try {
                                        if (typeof this.saveSettingHistory === 'function') {
                                            await this.saveSettingHistory(String(guildId), userId || 'System', String(settingKey), beforeVal, afterVal);
                                        } else if (this.database) {
                                            const oldStr = (typeof beforeVal === 'undefined' || beforeVal === null) ? null : JSON.stringify(beforeVal);
                                            const newStr = (typeof afterVal === 'undefined' || afterVal === null) ? null : JSON.stringify(afterVal);
                                            await this.database.run(`INSERT INTO settings_history (guild_id, user_id, setting_key, old_value, new_value) VALUES (?, ?, ?, ?, ?)`, [String(guildId), userId ? String(userId) : null, String(settingKey), oldStr, newStr]);
                                        }
                                    } catch (e) {
                                        this.logger?.warn && this.logger.warn('Failed to persist settings_history:', e?.message || e);
                                    }
                                }
                            } catch (e) {
                                this.logger?.warn && this.logger.warn('settings_history logic error:', e?.message || e);
                            }

                            // ---------- Local logging & forensics ----------
                            try {
                                this.logger?.info && this.logger.info(`[SETTING] ${prettyName} ${status} by ${userId}`);
                                if (this.forensicsManager && typeof this.forensicsManager.record === 'function') {
                                    await this.forensicsManager.record({ type: 'settingChanged', guildId: guildId, userId: userId, key: settingKey, before: data.before || null, after: newValue, category: data.category || null, timestamp: Date.now() });
                                }
                            } catch (e) {
                                this.logger?.warn && this.logger.warn('settingChanged -> local logging/forensics error:', e?.message || e);
                            }
                        } catch (err) {
                            this.logger?.error && this.logger.error('Settings change handler error:', err);
                        }
                    });
                }
            } catch (e) {
                this.logger.warn('Failed to attach settingChanged listener:', e?.message || e);
            }

            // Start verification cleanup job (expire pending challenges and optional auto-kick)
            try {
                const VerificationCleanup = require('./utils/verificationCleanup');
                this.verificationCleanup = VerificationCleanup;
                this.verificationCleanup.start(this);
            } catch (err) {
                this.logger?.warn && this.logger.warn('Failed to start verification cleanup job:', err?.message || err);
            }

            // Feature gate helper: uses the class method isFeatureEnabledForGuild() below.
            // (Arrow function override removed — consolidated into class method)
            
            // Setup event handlers
            await this.setupEventHandlers();
            
            // Start web dashboard if enabled
            if (process.env.ENABLE_WEB_DASHBOARD === 'true') {
                // Prefer platform-assigned PORT, then DASHBOARD_PORT, then WEB_PORT, then fallback to 3001
                const port = process.env.PORT || process.env.DASHBOARD_PORT || process.env.WEB_PORT || 3001;
                await this.dashboard.start(port);
                this.logger.info(`🌐 Dashboard started on http://localhost:${port}`);
            }
            
            // Start XP Web Dashboard
            if (this.webDashboard) {
                try {
                    await this.webDashboard.start();
                    this.logger.info('🎮 XP Leaderboard Dashboard started');
                } catch (error) {
                    this.logger.warn('⚠️ Failed to start XP dashboard:', error.message);
                }
            }
            
            this.logger.info('✅ Bot initialization complete!');
        } catch (error) {
            this.logger.error('❌ Failed to initialize bot:', error);
            throw error;
        }
    }

    async loadCommands() {
        this.logger.info('📂 Loading commands...');
        
        const commandsPath = path.join(__dirname, 'commands');
        if (!fs.existsSync(commandsPath)) {
            fs.mkdirSync(commandsPath, { recursive: true });
            return;
        }

        // Phase 1: Load new top-level commands (refactored structure)
        const topLevelFiles = fs.readdirSync(commandsPath)
            .filter(file => file.endsWith('.js') && !file.includes('.old'));
        
        for (const file of topLevelFiles) {
            try {
                const filePath = path.join(commandsPath, file);
                const command = require(filePath);
                
                // Skip deprecated commands
                if (command.deprecated) {
                    this.logger.warn(`   ⚠️  Deprecated: ${file} → Use ${command.newCommand}`);
                    continue;
                }
                
                // Validate command structure
                if (!command.data || !command.execute) {
                    this.logger.warn(`   ⚠️  Invalid structure: ${file}`);
                    continue;
                }
                
                const commandName = command.data.name;
                
                // Prevent duplicates
                if (this.commands.has(commandName)) {
                    this.logger.warn(`   ⚠️  Duplicate: ${commandName} (skipped)`);
                    continue;
                }
                
                this.commands.set(commandName, command);
                this.logger.info(`   ✅ ${commandName}`);
                
            } catch (error) {
                this.logger.error(`   ❌ Failed to load ${file}:`, error);
            }
        }
        
        // Phase 2: Load legacy commands from subfolders (temporary during migration)
        const commandFolders = ['admin', 'moderation', 'security', 'utility'];
        
        for (const folder of commandFolders) {
            const folderPath = path.join(commandsPath, folder);
            if (!fs.existsSync(folderPath)) continue;
            
            const commandFiles = fs.readdirSync(folderPath)
                .filter(file => file.endsWith('.js') && !file.includes('.old'));
            
            for (const file of commandFiles) {
                try {
                    const command = require(path.join(folderPath, file));
                    
                    // Skip deprecated legacy commands
                    if (command.deprecated) {
                        continue;
                    }
                    
                    if (command.data && command.execute) {
                        const commandName = command.data.name;
                        
                        // Skip if already loaded from top-level (prioritize new structure)
                        if (this.commands.has(commandName)) {
                            continue;
                        }
                        
                        this.commands.set(commandName, command);
                        this.logger.info(`   ✅ ${commandName} (legacy)`);
                    }
                } catch (error) {
                    this.logger.error(`   ❌ Failed to load ${folder}/${file}:`, error);
                }
            }
        }
        
        this.logger.info(`📋 Loaded ${this.commands.size} commands total`);
    }

    async setupEventHandlers() {
        // Ready event (clientReady to avoid deprecation warning)
        this.client.once('clientReady', async () => {
            this.logger.info(`🚀 Bot is online as ${this.client.user.tag}`);
            this.logger.info(`📊 Serving ${this.client.guilds.cache.size} guilds`);
            
            // Set bot presence
            this.client.user.setActivity('🛡️ guardianbot.xyz | Protecting servers', { type: 'WATCHING' });
            
            // Register slash commands (global + per-guild for immediacy)
            await this.registerSlashCommands();
        });

        // Interaction handling
        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) {
                const command = this.commands.get(interaction.commandName);
                
                if (!command) {
                    return await interaction.reply({
                        content: '❌ Command not found.',
                        ephemeral: true
                    });
                }

                // Check cooldowns
                if (!this.cooldowns.has(command.data.name)) {
                    this.cooldowns.set(command.data.name, new Collection());
                }

                const now = Date.now();
                const timestamps = this.cooldowns.get(command.data.name);
                const cooldownAmount = (command.cooldown || 3) * 1000;

                if (timestamps.has(interaction.user.id)) {
                    const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

                    if (now < expirationTime) {
                        const timeLeft = (expirationTime - now) / 1000;
                        return await interaction.reply({
                            content: `⏰ Please wait ${timeLeft.toFixed(1)} seconds before using this command again.`,
                            ephemeral: true
                        });
                    }
                }

                timestamps.set(interaction.user.id, now);
                setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

                const startTime = Date.now();
                let commandSuccess = true;
                let commandError = null;

                try {
                    // Enterprise security middleware check
                    if (this.securityMiddleware) {
                        const securityCheck = await this.securityMiddleware.checkCommand(interaction, command);
                        if (!securityCheck.passed) {
                            return await interaction.reply({
                                content: securityCheck.error || '❌ Security check failed.',
                                ephemeral: true
                            });
                        }
                    }

                    // Feature gating
                    const blocked = await this.isFeatureBlocked(interaction);
                    if (blocked) {
                        return await interaction.reply({ content: '❌ This feature is disabled in this server.', ephemeral: true });
                    }

                    // Plan-based gating
                    if (interaction.guild) {
                        const requiredPlan = command.requiredPlan || this.planRequirements?.[command.data?.name];
                        if (requiredPlan === 'pro') {
                            const hasPro = await this.hasProFeatures(interaction.guild.id);
                            if (!hasPro) {
                                return await interaction.reply('❌ This feature requires the **Pro plan**.');
                            }
                        } else if (requiredPlan === 'enterprise') {
                            const hasEnterprise = await this.hasEnterpriseFeatures(interaction.guild.id);
                            if (!hasEnterprise) {
                                return await interaction.reply('❌ This feature requires the **Enterprise plan**.');
                            }
                        }
                    }

                    // Role-based permission check (before command execution)
                    if (this.permissionManager) {
                        const allowed = await this.permissionManager.isAllowed(interaction);
                        if (!allowed) {
                            return await interaction.reply({
                                content: '🚫 You do not have permission to use this command. Ask a server admin to grant access via `/permissions`.',
                                ephemeral: true
                            });
                        }
                    }

                    // Feature gating: if the command declares a feature requirement, ensure it's enabled for the guild
                    if (interaction.guild && command.feature) {
                        try {
                            const enabled = await this.isFeatureEnabledForGuild(interaction.guild.id, command.feature);
                            if (!enabled) {
                                return await interaction.reply({
                                    content: `⚠️ The feature required for this command (${command.feature}) is currently disabled in this server. Ask an admin to enable it in the dashboard.`,
                                    ephemeral: true
                                });
                            }
                        } catch (e) {
                            await this.logger.logError({
                                error: e,
                                context: 'feature_gate_check',
                                guildId: interaction.guild.id,
                                userId: interaction.user.id
                            });
                        }
                    }

                    // Track command usage for analytics
                    if (this.eventEmitter && interaction.guild) {
                        await this.eventEmitter.emitCommandUsed(
                            interaction.guild.id,
                            interaction.commandName,
                            interaction.user.id
                        );
                    }

                    // Pass bot instance to commands that need it
                    await command.execute(interaction, this);
                    
                    // Broadcast command execution to console
                    try {
                        const guildId = interaction.guild ? interaction.guild.id : null;
                        const who = interaction.user ? `${interaction.user.tag} (${interaction.user.id})` : String(interaction.user?.id || 'Unknown');
                        const cmd = command.data && command.data.name ? command.data.name : interaction.commandName;
                        this.broadcastConsole(guildId, `[COMMAND] ${who} -> /${cmd}`);
                    } catch (e) {
                        /* ignore */
                    }
                    
                    // NEW: Track command usage in analytics
                    if (this.analyticsManager) {
                        await this.analyticsManager.trackCommand(interaction);
                    }
                } catch (error) {
                    commandSuccess = false;
                    commandError = error.message || String(error);
                    
                    await this.logger.logError({
                        error,
                        context: `command_${interaction.commandName}`,
                        userId: interaction.user.id,
                        userTag: interaction.user.tag,
                        guildId: interaction.guild?.id,
                        channelId: interaction.channel?.id
                    });
                    
                    // Broadcast error to console
                    try {
                        const guildId = interaction.guild ? interaction.guild.id : null;
                        this.broadcastConsole(guildId, `[CMD ERROR] /${interaction.commandName} failed: ${error.message || error}`);
                    } catch (_) {}
                    
                    const errorMessage = {
                        content: '❌ An error occurred while executing this command.',
                        ephemeral: true
                    };

                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp(errorMessage);
                    } else {
                        await interaction.reply(errorMessage);
                    }
                } finally {
                    // Log command execution
                    const duration = Date.now() - startTime;
                    await this.logger.logCommand({
                        commandName: interaction.commandName,
                        userId: interaction.user.id,
                        userTag: interaction.user.tag,
                        guildId: interaction.guild?.id,
                        channelId: interaction.channel?.id,
                        options: interaction.options?.data || {},
                        success: commandSuccess,
                        duration,
                        error: commandError
                    });
                }
            }
            // Handle button interactions
            else if (interaction.isButton()) {
                const buttonSuccess = await (async () => {
                    try {
                        // Enterprise security middleware check for buttons
                        if (this.securityMiddleware) {
                            const securityCheck = await this.securityMiddleware.checkButton(interaction);
                            if (!securityCheck.passed) {
                                return interaction.reply({
                                    content: securityCheck.error || '❌ Security check failed.',
                                    ephemeral: true
                                });
                            }
                        }

                        // Handle verification through enterprise VerificationService
                        if (interaction.customId === 'verify_button' && this.verificationService) {
                            await this.verificationService.handleVerifyButton(interaction);
                            return true;
                        }

                        // Verification skip/deny
                        if (interaction.customId.startsWith('verify_allow_') || interaction.customId.startsWith('verify_deny_')) {
                            const targetId = interaction.customId.split('_')[2];
                            const approve = interaction.customId.startsWith('verify_allow_');
                            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
                                !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                                return interaction.reply({ content: 'Staff only.', ephemeral: true });
                            }
                            await interaction.deferReply({ ephemeral: true });
                            const member = await interaction.guild.members.fetch(targetId).catch(() => null);
                            if (!member) return interaction.editReply({ content: 'User not found.' });
                            const cfg = await this.database.getGuildConfig(interaction.guild.id);
                            const unverifiedRole = cfg.unverified_role_id ? interaction.guild.roles.cache.get(cfg.unverified_role_id) : null;
                            const verifiedRole = cfg.verified_role_id ? interaction.guild.roles.cache.get(cfg.verified_role_id) : null;
                            if (approve) {
                                if (unverifiedRole) await member.roles.remove(unverifiedRole).catch(() => {});
                                if (verifiedRole) await member.roles.add(verifiedRole).catch(() => {});
                                const welcomeChannel = cfg.verified_welcome_channel_id ? interaction.guild.channels.cache.get(cfg.verified_welcome_channel_id) : interaction.guild.systemChannel;
                                if (welcomeChannel?.isTextBased()) {
                                    const msg = (cfg.verified_welcome_message || 'Welcome {user} to {server}!').replace('{user}', member).replace('{server}', interaction.guild.name);
                                    await welcomeChannel.send({ content: msg });
                                }
                                await interaction.message.edit({ components: [] });
                                await interaction.editReply({ content: `Approved ${member.user.tag}.` });
                            } else {
                                await member.kick(`Verification denied by ${interaction.user.tag}`);
                                await interaction.message.edit({ components: [] });
                                await interaction.editReply({ content: `Denied and kicked ${member.user.tag}.` });
                            }
                            return true;
                        }
                        // Handle enhanced ticket system buttons
                        if (interaction.customId.startsWith('close_ticket_') || 
                            interaction.customId.startsWith('claim_ticket_') || 
                            interaction.customId.startsWith('add_user_') ||
                            interaction.customId.startsWith('confirm_close_') ||
                            interaction.customId.startsWith('cancel_close_') ||
                            interaction.customId.startsWith('rate_ticket_')) {
                            if (this.enhancedTicketManager) {
                                await this.enhancedTicketManager.handleTicketInteraction(interaction);
                            }
                            return true;
                        }
                        // Handle leaderboard time-range buttons
                        else if (interaction.customId.startsWith('leaderboard:') || interaction.customId.startsWith('leaderboard_')) {
                            const leaderboardCommand = this.commands.get('leaderboard');
                            if (leaderboardCommand && leaderboardCommand.handleLeaderboardButton) {
                                await leaderboardCommand.handleLeaderboardButton(interaction, this);
                            }
                            return true;
                        }
                        // Handle setup wizard buttons
                        else if (interaction.customId.startsWith('setup_')) {
                            if (this.setupWizard) {
                                await this.setupWizard.handleSetupInteraction(interaction);
                            }
                            return true;
                        }
                        // NOTE: verify_allow_ and verify_deny_ already handled above - removed duplicate
                        // Handle settings buttons
                        else if (interaction.customId.startsWith('toggle_') || 
                                 interaction.customId.startsWith('configure_') ||
                                 interaction.customId === 'settings_back') {
                            if (this.settingsManager) {
                                await this.settingsManager.handleSettingsInteraction(interaction);
                            }
                            return true;
                        }
                        // Handle legacy ticket system and other buttons
                        else {
                            await this.handleButtonInteraction(interaction);
                            return true;
                        }
                    } catch (error) {
                        await this.logger.logError({
                            error,
                            context: `button_${interaction.customId}`,
                            userId: interaction.user.id,
                            userTag: interaction.user.tag,
                            guildId: interaction.guild?.id,
                            channelId: interaction.channel?.id
                        });
                        return false;
                    }
                })();

                // Log button interaction
                await this.logger.logButton({
                    customId: interaction.customId,
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    guildId: interaction.guild?.id,
                    channelId: interaction.channel?.id,
                    messageId: interaction.message?.id,
                    action: interaction.customId.split('_')[0],
                    success: buttonSuccess
                });
            }
            // Handle select menu interactions
            else if (interaction.isStringSelectMenu()) {
                // Handle leaderboard time range selection
                if (interaction.customId === 'leaderboard_select') {
                    const leaderboardCommand = this.commands.get('leaderboard');
                    if (leaderboardCommand && leaderboardCommand.handleLeaderboardSelect) {
                        await leaderboardCommand.handleLeaderboardSelect(interaction, this);
                    }
                }
                // Handle ticket category selection
                else if (interaction.customId === 'ticket_category_select') {
                    if (this.enhancedTicketManager) {
                        await this.enhancedTicketManager.handleTicketButton(interaction);
                    }
                }
                // Handle settings category selection
                else if (interaction.customId === 'settings_category_select') {
                    if (this.settingsManager) {
                        await this.settingsManager.handleSettingsInteraction(interaction);
                    }
                }
                // Handle help category selection
                else if (interaction.customId === 'help-category-select') {
                    const category = interaction.values[0];
                    
                    if (!this.helpTicketSystem) {
                        return await interaction.reply({ content: '❌ Help ticket system not available', ephemeral: true });
                    }

                    // Show modal for the selected category
                    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

                    const modal = new ModalBuilder()
                        .setCustomId(`help-ticket-modal-${category}`)
                        .setTitle(`🆘 ${this.helpTicketSystem.getCategoryLabel(category)}`);

                    const subjectInput = new TextInputBuilder()
                        .setCustomId('help-subject')
                        .setLabel('Subject/Title')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Brief description of your issue')
                        .setMinLength(5)
                        .setMaxLength(100)
                        .setRequired(true);

                    const reasonInput = new TextInputBuilder()
                        .setCustomId('help-reason')
                        .setLabel('Reason')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Why do you need help with this?')
                        .setMinLength(5)
                        .setMaxLength(200)
                        .setRequired(true);

                    const descriptionInput = new TextInputBuilder()
                        .setCustomId('help-description')
                        .setLabel('Detailed Description')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Please provide as much detail as possible...')
                        .setMinLength(10)
                        .setMaxLength(2000)
                        .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(subjectInput),
                        new ActionRowBuilder().addComponents(reasonInput),
                        new ActionRowBuilder().addComponents(descriptionInput)
                    );

                    await interaction.showModal(modal);
                }
            }
            // Handle modal submissions
            else if (interaction.isModalSubmit()) {
                // Enterprise security middleware check for modals
                if (this.securityMiddleware) {
                    const securityCheck = await this.securityMiddleware.checkModal(interaction);
                    if (!securityCheck.passed) {
                        return interaction.reply({
                            content: securityCheck.error || '❌ Security check failed.',
                            ephemeral: true
                        });
                    }
                }

                // Handle verification captcha modal through enterprise VerificationService
                if ((interaction.customId.startsWith('verify_captcha_') || interaction.customId.startsWith('verify_code_modal_')) && this.verificationService) {
                    await this.verificationService.handleCodeModalSubmit(interaction);
                    return;
                }

                if (interaction.customId === 'ticket_modal') {
                    await this.handleTicketSubmit(interaction);
                } else if (interaction.customId === 'ticket_create_modal') {
                    if (this.ticketSystem) {
                        await this.ticketSystem.handleModalSubmit(interaction);
                    }
                } else if (interaction.customId === 'help-modal') {
                    await this.handleHelpModal(interaction);
                } else if (interaction.customId.startsWith('help-ticket-modal-')) {
                    // Handle help ticket modal submission
                    await this.handleHelpTicketModal(interaction);
                }
            }
        });

        // Message events for security modules
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot || !message.guild) return;

            try {
                // Get guild config once for all checks
                const guildConfig = await this.database.getGuildConfig(message.guild.id).catch(() => ({}));

                // Anti-spam check
                if (this.antiSpam && guildConfig.anti_spam_enabled !== 0) {
                    const spamResult = await this.antiSpam.checkMessage(message);
                    // checkMessage returns true if spam detected
                    if (spamResult === true) {
                        this.logger.debug(`Spam detected, message handled by antiSpam`);
                        return;
                    }
                }

                // Anti-malicious links check
                if (this.antiMaliciousLinks && guildConfig.anti_phishing_enabled !== 0) {
                    const linkResult = await this.antiMaliciousLinks.checkMessage(message);
                    if (linkResult && linkResult.isBlocked) return;
                }

                // Toxicity filter (part of auto-mod)
                if (this.toxicityFilter && guildConfig.auto_mod_enabled !== 0) {
                    await this.toxicityFilter.checkMessage(message);
                }

                // Behavior detection
                if (this.behaviorDetection) {
                    await this.behaviorDetection.trackUserBehavior(message);
                }
                
                // NEW: Security Manager comprehensive check
                if (this.securityManager) {
                    await this.securityManager.handleMessage(message);
                }
                
                // NEW: Analytics tracking
                if (this.analyticsManager) {
                    await this.analyticsManager.trackMessage(message);
                }

                // Rank System: Add XP for message
                if (this.rankSystem) {
                    // Anti-ghost XP protection
                    const content = message.content.trim();
                    
                    // Check minimum length (5 characters)
                    if (content.length < 5) {
                        this.logger.debug('Message too short for XP');
                    }
                    // Check emoji-only messages
                    else if (/^[\p{Emoji}\s]+$/u.test(content)) {
                        this.logger.debug('Emoji-only message, no XP');
                    }
                    else {
                        const result = await this.rankSystem.addXP(message.guild.id, message.author.id, message.content);
                        
                        // If user leveled up, send congratulations
                        if (result && result.leveledUp) {
                            // Get guild config for custom level-up message
                            const config = await this.database.getGuildConfig(message.guild.id);
                            
                            // Build custom message with variable replacement
                            const defaultMessage = 'Congratulations {user}! You\'ve reached **Level {level}**!';
                            let customMessage = config?.xp_levelup_message || defaultMessage;
                            const userData = this.rankSystem.getUserData(message.guild.id, message.author.id);
                            
                            // Get role name if role reward exists
                            let roleName = 'None';
                            if (result.roleReward) {
                                const role = message.guild.roles.cache.get(result.roleReward);
                                roleName = role ? role.name : result.roleReward;
                            }
                            
                            // Replace variables
                            customMessage = customMessage
                                .replace(/{user}/g, message.author.toString())
                                .replace(/{username}/g, message.author.username)
                                .replace(/{level}/g, result.newLevel.toString())
                                .replace(/{xp}/g, this.rankSystem.formatXP(result.currentXP))
                                .replace(/{role}/g, roleName)
                                .replace(/{messages}/g, userData.totalMessages.toString());
                            
                            const embedTitle = config?.xp_levelup_title || '🎉 Level Up!';
                            const embedColor = config?.xp_levelup_embed_color || '#00ff41';
                            const showXP = config?.xp_levelup_show_xp !== 0;
                            const showMessages = config?.xp_levelup_show_messages !== 0;

                            const levelUpEmbed = new EmbedBuilder()
                                .setColor(embedColor)
                                .setTitle(embedTitle)
                                .setDescription(customMessage)
                                .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                                .setTimestamp();

                            // Add optional fields
                            if (showXP) {
                                levelUpEmbed.addFields({ name: 'Total XP', value: this.rankSystem.formatXP(result.currentXP), inline: true });
                            }
                            if (showMessages) {
                                levelUpEmbed.addFields({ name: 'Messages', value: userData.totalMessages.toString(), inline: true });
                            }

                            try {
                                // Check for custom level-up channel
                                const levelUpChannelId = config?.xp_levelup_channel;
                                const targetChannel = levelUpChannelId 
                                    ? message.guild.channels.cache.get(levelUpChannelId) 
                                    : message.channel;
                                    
                                if (targetChannel && targetChannel.isTextBased()) {
                                    await targetChannel.send({ embeds: [levelUpEmbed] });
                                } else {
                                    await message.channel.send({ embeds: [levelUpEmbed] });
                                }
                            } catch (e) {
                                // Couldn't send level up message (permissions)
                            }
                            
                            // Check for role rewards
                            if (result.roleReward) {
                                try {
                                    const role = message.guild.roles.cache.get(result.roleReward);
                                    if (role) {
                                        await message.member.roles.add(role);
                                        await message.channel.send(`🏆 ${message.author} earned the **${role.name}** role!`);
                                    }
                                } catch (e) {
                                    console.error('Failed to assign role reward:', e);
                                }
                            }
                        }
                    }
                }

                // Ticket system message logging
                if (this.ticketSystem) {
                    await this.ticketSystem.handleTicketMessage(message);
                }
            } catch (error) {
                this.logger.error('Error in message handler:', error);
            }
        });

        // Message edit security — Security Rule 9
        // Runs the same security pipeline on edited messages to prevent bypass
        this.client.on('messageUpdate', async (oldMessage, newMessage) => {
            try {
                const messageUpdateHandler = require('./events/messageUpdate');
                await messageUpdateHandler.execute(oldMessage, newMessage, this);
            } catch (error) {
                this.logger.error('Error in messageUpdate handler:', error);
            }
        });

        // Member join events
        this.client.on('guildMemberAdd', async (member) => {
            try {
                // Broadcast to console
                try {
                    this.broadcastConsole(member.guild.id, `[JOIN] ${member.user.tag} (${member.id}) joined ${member.guild.name}`);
                } catch (_) {}

                // Lockdown check - handle first
                if (this.lockdownManager) {
                    await this.lockdownManager.handleNewJoin(member);
                }

                // Anti-raid check
                if (this.antiRaid) {
                    const raidResult = await this.antiRaid.checkNewMember(member);
                    if (raidResult && raidResult.isRaid) return;
                }

                // Enterprise verification service (preferred over legacy)
                if (this.verificationService) {
                    await this.verificationService.handleMemberJoin(member);
                }
                // Fallback: User verification via join queue (raid-safe)
                else if (this.joinQueue) {
                    this.joinQueue.enqueueJoin(member);
                } else if (this.userVerification && typeof this.userVerification.verifyNewMember === 'function') {
                    await this.userVerification.verifyNewMember(member);
                }

                // Log join
                if (this.database) {
                    await this.database.logEvent({
                        type: 'member_join',
                        guildId: member.guild.id,
                        userId: member.id,
                        timestamp: Date.now(),
                        metadata: {
                            accountAge: Date.now() - member.user.createdTimestamp,
                            joinMethod: 'unknown'
                        }
                    });
                }
                
                // NEW: Security Manager join check
                if (this.securityManager) {
                    await this.securityManager.handleMemberJoin(member);
                }
                
                // NEW: Analytics tracking
                if (this.analyticsManager) {
                    await this.analyticsManager.trackMemberJoin(member);
                }

                // Forensics audit log
                if (this.forensicsManager) {
                    await this.forensicsManager.logAuditEvent({
                        guildId: member.guild.id,
                        eventType: 'member_join',
                        eventCategory: 'member',
                        executor: { id: member.id, tag: member.user.tag },
                        target: { id: member.id, name: member.user.tag, type: 'user' },
                        changes: { accountAgeMs: Date.now() - member.user.createdTimestamp },
                        canReplay: false
                    });
                }
                
                // Welcome message
                if (this.database) {
                    const config = await this.database.getGuildConfig(member.guild.id);
                    if (config.welcome_enabled && config.welcome_channel) {
                        try {
                            const channel = member.guild.channels.cache.get(config.welcome_channel);
                            if (channel && channel.permissionsFor(member.guild.members.me).has('SendMessages')) {
                                const welcomeMessage = this.formatWelcomeMessage(
                                    config.welcome_message || 'Welcome {user} to **{server}**! You are member #{memberCount}! 🎉',
                                    member
                                );
                                await channel.send(welcomeMessage);
                                this.logger.info(`📩 Sent welcome message to ${member.user.tag} in ${member.guild.name}`);
                            }
                        } catch (error) {
                            this.logger.error('Error sending welcome message:', error);
                        }
                    }
                }
            } catch (error) {
                this.logger.error('Error in member join handler:', error);
            }
        });

        // Bot added to new server
        this.client.on('guildCreate', async (guild) => {
            try {
                this.logger.info(`✅ Bot added to new server: ${guild.name} (${guild.id})`);
                
                // Initialize guild configuration
                if (this.database) {
                    await this.database.getGuildConfig(guild.id);
                }
                
                // Send comprehensive DM guide to server owner
                try {
                    const owner = await guild.fetchOwner();
                    
                    const welcomeDM1 = new EmbedBuilder()
                        .setTitle('🛡️ Welcome to GuardianBot!')
                        .setDescription(`
Thank you for adding **GuardianBot** to **${guild.name}**!

I'm an advanced security and moderation bot designed to protect your server and make management easier.

**🎯 I'm currently performing an initial security scan** of your server to check for existing threats. This will complete in a few minutes.
                        `)
                        .setColor('#00d4ff')
                        .setThumbnail(this.client.user.displayAvatarURL())
                        .setTimestamp();

                    const securityFeatures = new EmbedBuilder()
                        .setTitle('🔒 Security Features')
                        .setColor('#e74c3c')
                        .setDescription('GuardianBot provides comprehensive protection:')
                        .addFields(
                            { 
                                name: '🚨 Anti-Raid Protection', 
                                value: 'Automatically detects and stops server raids\n• Monitors join patterns\n• Configurable thresholds\n• Auto-lockdown capabilities', 
                                inline: false 
                            },
                            { 
                                name: '🗑️ Anti-Spam System', 
                                value: 'Prevents spam and flooding\n• Message rate limiting\n• Duplicate detection\n• Auto-delete spam', 
                                inline: false 
                            },
                            { 
                                name: '🔗 Link Protection', 
                                value: 'Blocks malicious links and phishing\n• Real-time URL scanning\n• Phishing database checks\n• Scam prevention', 
                                inline: false 
                            },
                            { 
                                name: '🧹 Toxicity Detection', 
                                value: 'Filters toxic and harmful content\n• Advanced content analysis\n• Configurable sensitivity\n• Automatic warnings', 
                                inline: false 
                            },
                            { 
                                name: '📊 Proactive Scanning', 
                                value: 'Regular security scans of all channels\n• Scheduled automatic scans\n• Manual scan triggers\n• Detailed threat reports', 
                                inline: false 
                            }
                        );

                    const moderationCommands = new EmbedBuilder()
                        .setTitle('⚖️ Moderation Commands')
                        .setColor('#3498db')
                        .addFields(
                            { 
                                name: '`/ban` `[user] [reason]`', 
                                value: 'Ban a user from the server', 
                                inline: true 
                            },
                            { 
                                name: '`/kick` `[user] [reason]`', 
                                value: 'Kick a user from the server', 
                                inline: true 
                            },
                            { 
                                name: '`/timeout` `[user] [duration]`', 
                                value: 'Timeout a user temporarily', 
                                inline: true 
                            },
                            { 
                                name: '`/warn` `[user] [reason]`', 
                                value: 'Issue a warning to a user', 
                                inline: true 
                            },
                            { 
                                name: '`/purge` `[amount]`', 
                                value: 'Delete multiple messages', 
                                inline: true 
                            },
                            { 
                                name: '`/lockdown` `[channel]`', 
                                value: 'Lock a channel temporarily', 
                                inline: true 
                            }
                        );

                    const adminCommands = new EmbedBuilder()
                        .setTitle('🛠️ Setup & Admin Commands')
                        .setColor('#f39c12')
                        .addFields(
                            { 
                                name: '`/wizard`', 
                                value: '**⭐ Recommended first step!**\nInteractive setup wizard for all features', 
                                inline: false 
                            },
                            { 
                                name: '`/serversetup` `[template]`', 
                                value: '**NEW!** Complete server setup with channels & roles\nChoose from Gaming, Business, Education, Creative, or General templates', 
                                inline: false 
                            },
                            { 
                                name: '`/setup`', 
                                value: 'Configure security features and channels', 
                                inline: true 
                            },
                            { 
                                name: '`/settings` `[feature]`', 
                                value: 'View and modify bot settings', 
                                inline: true 
                            },
                            { 
                                name: '`/security` `[action]`', 
                                value: 'Manage security features', 
                                inline: true 
                            },
                            { 
                                name: '`/permissions` `[role]`', 
                                value: 'Configure role permissions', 
                                inline: true 
                            }
                        );

                    const utilityCommands = new EmbedBuilder()
                        .setTitle('🔧 Utility Commands')
                        .setColor('#2ecc71')
                        .addFields(
                            { 
                                name: '`/ticket` `[create/close]`', 
                                value: 'Manage support tickets', 
                                inline: true 
                            },
                            { 
                                name: '`/help` `[command]`', 
                                value: 'Get help with commands', 
                                inline: true 
                            },
                            { 
                                name: '`/serverinfo`', 
                                value: 'View server information', 
                                inline: true 
                            },
                            { 
                                name: '`/userinfo` `[user]`', 
                                value: 'View user information', 
                                inline: true 
                            },
                            { 
                                name: '`/analytics`', 
                                value: 'View server analytics', 
                                inline: true 
                            },
                            { 
                                name: '`/status`', 
                                value: 'Check security status', 
                                inline: true 
                            }
                        );

                    const dashboardInfo = new EmbedBuilder()
                        .setTitle('🌐 Web Dashboard')
                        .setColor('#9b59b6')
                        .setDescription(`
**Access your dashboard at:** \`${process.env.DASHBOARD_URL || 'Your Dashboard URL'}\`

**Dashboard Features:**
🎨 Modern, responsive interface
📊 Real-time server statistics
🔧 Configure all bot settings
🚨 View security alerts and quarantined content
📈 Detailed analytics and insights
🎫 Manage tickets
👥 User management tools
⚙️ Auto-delete configuration for threats
📋 Security scan history

**Login:** Use your Discord account to authenticate
                        `);

                    const quickStart = new EmbedBuilder()
                        .setTitle('🚀 Quick Start Guide')
                        .setColor('#1abc9c')
                        .setDescription(`
**Recommended Setup Steps:**

**1️⃣ Run the Setup Wizard**
Use \`/wizard\` to configure basic settings in a guided format

**2️⃣ Set Up Your Server Structure** *(Optional)*
Use \`/serversetup\` to create a complete server template with channels and roles

**3️⃣ Configure Security Features**
Use \`/security enable\` to enable protection features
• Anti-raid protection
• Anti-spam filtering
• Link protection
• Toxicity detection

**4️⃣ Set Moderation Roles**
Use \`/setup\` to assign moderator and admin roles

**5️⃣ Configure Auto-Delete Settings**
Visit the web dashboard to configure automatic deletion of threats

**6️⃣ Review Security Scan Results**
Check the scan report I'm generating now!

**💡 Pro Tips:**
• Use the web dashboard for advanced configuration
• Enable notifications for security events
• Set up a dedicated log channel
• Regular security scans are automatically performed
• Check quarantined messages before deletion
                        `);

                    const supportInfo = new EmbedBuilder()
                        .setTitle('❓ Need Help?')
                        .setColor('#95a5a6')
                        .setDescription(`
**Support Resources:**

📖 **Documentation:** Use \`/help\` for command documentation
🌐 **Web Dashboard:** Full feature documentation available
💬 **In-Server Help:** Use \`/help [command]\` for specific commands
🔍 **Status Check:** Use \`/status\` to verify bot functionality
🔗 **Website:** https://guardianbot.xyz
💬 **Community Server:** https://discord.gg/Vsq9PUTrgb

**Common Issues:**
• Missing permissions: Grant Administrator permission
• Commands not working: Check role hierarchy
• Features not triggering: Verify settings with \`/settings\`

**All set!** GuardianBot is now protecting your server. Run \`/wizard\` to get started!
                        `)
                        .setFooter({ text: 'GuardianBot - Advanced Security & Moderation' })
                        .setTimestamp();

                    // Send all embeds to owner
                    await owner.send({ embeds: [welcomeDM1] });
                    await owner.send({ embeds: [securityFeatures] });
                    await owner.send({ embeds: [moderationCommands] });
                    await owner.send({ embeds: [adminCommands] });
                    await owner.send({ embeds: [utilityCommands] });
                    await owner.send({ embeds: [dashboardInfo] });
                    await owner.send({ embeds: [quickStart] });
                    await owner.send({ embeds: [supportInfo] });

                    this.logger.info(`📧 Sent welcome guide to ${owner.user.tag}`);
                } catch (dmError) {
                    this.logger.error('Could not send DM to server owner:', dmError);
                    // Fallback: send basic message in server
                }
                
                // Send welcome message in server channel
                const welcomeEmbed = new EmbedBuilder()
                    .setTitle('🛡️ GuardianBot is now online!')
                    .setDescription(`
Thank you for adding me to **${guild.name}**!

I'm performing an initial security scan to check for threats. This will complete in a few minutes.

**Server owner:** Check your DMs for a complete feature guide!
**Quick start:** Use \`/wizard\` to configure the bot
**Server setup:** Use \`/serversetup\` to create a complete server structure
                    `)
                    .setColor('#00d4ff')
                    .addFields(
                        { name: '🔧 Setup', value: '`/wizard` or `/setup`', inline: true },
                        { name: '❓ Help', value: '`/help`', inline: true },
                        { name: '🌐 Dashboard', value: process.env.DASHBOARD_URL || 'See DM', inline: true }
                    )
                    .setTimestamp();

                const firstChannel = guild.channels.cache.find(c => 
                    c.type === 0 && 
                    c.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)
                );

                if (firstChannel) {
                    await firstChannel.send({ embeds: [welcomeEmbed] });
                }

                // Start security scan in background
                if (this.securityScanner) {
                    setTimeout(async () => {
                        try {
                            await this.securityScanner.scanServer(guild);
                            this.logger.info(`✅ Initial security scan complete for ${guild.name}`);
                        } catch (error) {
                            this.logger.error('Error during initial security scan:', error);
                        }
                    }, 5000); // Wait 5 seconds before starting scan
                }
                
            } catch (error) {
                this.logger.error('Error in guildCreate handler:', error);
            }
        });

        // Member leave events
        this.client.on('guildMemberRemove', async (member) => {
            try {
                // Broadcast to console
                try {
                    this.broadcastConsole(member.guild.id, `[LEAVE] ${member.user.tag} (${member.id}) left ${member.guild.name}`);
                } catch (_) {}

                if (this.database) {
                    await this.database.logEvent({
                        type: 'member_leave',
                        guildId: member.guild.id,
                        userId: member.id,
                        timestamp: Date.now()
                    });
                }
                
                // NEW: Analytics tracking
                if (this.analyticsManager) {
                    await this.analyticsManager.trackMemberLeave(member);
                }

                if (this.forensicsManager) {
                    await this.forensicsManager.logAuditEvent({
                        guildId: member.guild.id,
                        eventType: 'member_leave',
                        eventCategory: 'member',
                        executor: { id: member.id, tag: member.user.tag },
                        target: { id: member.id, name: member.user.tag, type: 'user' },
                        canReplay: false
                    });
                }
            } catch (error) {
                this.logger.error('Error in member leave handler:', error);
            }
        });

        // Member update events (role conflict resolution + timeout notifications)
        this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
            try {
                // 1) Auto-resolve role conflicts (verified + unverified)
                const cfg = await this.database.getGuildConfig(newMember.guild.id).catch(() => null);
                if (cfg?.verified_role_id && cfg?.unverified_role_id) {
                    if (newMember.roles.cache.has(cfg.verified_role_id) && newMember.roles.cache.has(cfg.unverified_role_id)) {
                        await newMember.roles.remove(cfg.unverified_role_id).catch(() => {});
                        this.logger?.info && this.logger.info(`[RoleConflict] Removed Unverified from ${newMember.user.tag} (has Verified)`);
                    }
                }

                // 2) Timeout notifications
                const { EmbedBuilder } = require('discord.js');
                
                // Check if timeout status changed
                const wasTimedOut = oldMember.communicationDisabledUntil;
                const isTimedOut = newMember.communicationDisabledUntil;
                
                // User was just timed out
                if (!wasTimedOut && isTimedOut) {
                    this.logger.info(`🔇 Timeout detected: ${newMember.user.tag} in ${newMember.guild.name}`);
                    
                    const timeoutUntil = new Date(isTimedOut);
                    const duration = Math.round((timeoutUntil - Date.now()) / 1000 / 60); // minutes
                    
                    // Get guild config
                    const config = await this.database.getGuildConfig(newMember.guild.id);
                    
                    // Find log channel
                    let logChannel = null;
                    if (config && config.log_channel_id) {
                        logChannel = newMember.guild.channels.cache.get(config.log_channel_id);
                    }
                    
                    if (!logChannel) {
                        logChannel = newMember.guild.channels.cache.find(c => 
                            c.name.toLowerCase().includes('log') || 
                            c.name.toLowerCase().includes('mod') ||
                            c.name.toLowerCase().includes('security')
                        );
                    }
                    
                    if (logChannel && logChannel.isTextBased()) {
                        const timeoutEmbed = new EmbedBuilder()
                            .setTitle('🔇 Member Timed Out')
                            .setDescription(`**${newMember.user.tag}** has been timed out`)
                            .addFields(
                                { name: '👤 User', value: `${newMember.user.tag}\n<@${newMember.user.id}>\n\`${newMember.user.id}\``, inline: true },
                                { name: '⏰ Duration', value: `${duration} minutes`, inline: true },
                                { name: '🕐 Until', value: `<t:${Math.floor(timeoutUntil.getTime() / 1000)}:F>`, inline: true }
                            )
                            .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
                            .setColor('#ffa502')
                            .setTimestamp();
                        
                        try {
                            await logChannel.send({ embeds: [timeoutEmbed] });
                            this.logger.info(`✅ Timeout notification sent to #${logChannel.name}`);
                        } catch (error) {
                            this.logger.error('Failed to send timeout notification:', error);
                        }
                    }
                    
                    // Send to dashboard via WebSocket
                    if (this.dashboard && this.dashboard.wss) {
                        this.dashboard.broadcastToGuild(newMember.guild.id, {
                            type: 'timeout_alert',
                            data: {
                                type: 'TIMEOUT',
                                userId: newMember.user.id,
                                userTag: newMember.user.tag,
                                userAvatar: newMember.user.displayAvatarURL({ dynamic: true }),
                                guildId: newMember.guild.id,
                                guildName: newMember.guild.name,
                                duration: duration,
                                until: timeoutUntil.toISOString(),
                                timestamp: new Date().toISOString(),
                                severity: 'MEDIUM'
                            }
                        });
                        this.logger.info('✅ Timeout notification sent to dashboard');
                    }
                    
                    // Log to new Logger system
                    try {
                        await this.logger.logSecurityEvent({
                            eventType: 'TIMEOUT',
                            guildId: newMember.guild.id,
                            channelId: null,
                            moderatorId: null,
                            moderatorTag: null,
                            targetId: newMember.user.id,
                            targetTag: newMember.user.tag,
                            reason: `Timed out for ${duration} minutes`,
                            details: {
                                duration: duration,
                                until: timeoutUntil.toISOString()
                            }
                        });
                        this.logger.info('✅ Timeout logged to database');
                    } catch (error) {
                        this.logger.error('Failed to log timeout to database:', error);
                    }
                }
                
                // User timeout was removed
                if (wasTimedOut && !isTimedOut) {
                    this.logger.info(`✅ Timeout removed: ${newMember.user.tag} in ${newMember.guild.name}`);
                }
                
            } catch (error) {
                this.logger.error('Error handling member update:', error);
            }
        });

        // Error handling
        this.client.on('error', (error) => {
            this.logger.error('Discord client error:', error);
        });

        this.client.on('warn', (warning) => {
            this.logger.warn('Discord client warning:', warning);
        });

        // NEW: Voice state tracking for analytics
        this.client.on('voiceStateUpdate', async (oldState, newState) => {
            try {
                if (this.analyticsManager) {
                    await this.analyticsManager.trackVoiceActivity(oldState, newState);
                }
            } catch (error) {
                this.logger.error('Error in voice state handler:', error);
            }
        });

        // NEW: Reaction tracking for analytics
        this.client.on('messageReactionAdd', async (reaction, user) => {
            try {
                if (this.analyticsManager && !user.bot) {
                    await this.analyticsManager.trackReaction(reaction, user);
                }
            } catch (error) {
                this.logger.error('Error in reaction handler:', error);
            }
        });
        
        // Anti-Nuke Event Handlers
        this.client.on('roleCreate', async (role) => {
            try {
                await this.handleRoleCreate(role);
            } catch (error) {
                this.logger.error('Error handling roleCreate:', error);
            }
        });
        
        this.client.on('roleDelete', async (role) => {
            try {
                await this.handleRoleDelete(role);
            } catch (error) {
                this.logger.error('Error handling roleDelete:', error);
            }
        });
        
        this.client.on('channelCreate', async (channel) => {
            try {
                await this.handleChannelCreate(channel);
            } catch (error) {
                this.logger.error('Error handling channelCreate:', error);
            }
        });
        
        this.client.on('channelDelete', async (channel) => {
            try {
                await this.handleChannelDelete(channel);
            } catch (error) {
                this.logger.error('Error handling channelDelete:', error);
            }
        });
        
        this.client.on('guildBanAdd', async (ban) => {
            try {
                await this.handleBanAdd(ban);
            } catch (error) {
                this.logger.error('Error handling guildBanAdd:', error);
            }
        });
        
        this.client.on('webhookUpdate', async (channel) => {
            try {
                await this.handleWebhookUpdate(channel);
            } catch (error) {
                this.logger.error('Error handling webhookUpdate:', error);
            }
        });

        process.on('unhandledRejection', (error) => {
            try {
                this.logger.error('Unhandled promise rejection:', error);
            } catch {
                console.error('Unhandled Promise Rejection:', error);
            }
        });
    }

    /**
     * Runtime feature block check for interactions.
     * Prefers a command-declared `feature` property, falls back to a small name->feature map.
     */
    async isFeatureBlocked(interaction) {
        try {
            if (!interaction || !interaction.guild) return false;

            const commandName = interaction.commandName || (interaction?.customId || '').split('_')[1] || null;
            const command = commandName ? this.commands.get(commandName) : null;

            // If command explicitly declares a feature, use that as authoritative
            if (command && command.feature) {
                const enabled = await this.isFeatureEnabledForGuild(interaction.guild.id, command.feature);
                return !enabled;
            }

            // Fallback small map of command name -> feature flag
            // NOTE: Only map commands that TRULY should be disabled when feature is off.
            // Do NOT gate setup/config commands — they need to work to enable the feature!
            // Do NOT gate core moderation commands (ban, kick, etc.) — they should always work.
            const fallbackMap = {
                ai: 'ai',
                verify: 'verification'
            };

            const feature = commandName ? (fallbackMap[commandName] || null) : null;
            if (feature) {
                const enabled = await this.isFeatureEnabledForGuild(interaction.guild.id, feature);
                return !enabled;
            }

            return false;
        } catch (e) {
            this.logger?.warn('isFeatureBlocked check failed:', e.message || e);
            return false;
        }
    }

    async handleButtonInteraction(interaction) {
        const { customId } = interaction;

        try {
            // Early catch for verification buttons if event handler did not consume
            if (customId.startsWith('verify_user_')) {
                // Fallback parsing: verify_user_<guildId>_<userId>
                const parts = customId.split('_');
                if (parts.length >= 4) {
                    const guildId = parts[2];
                    const targetUserId = parts[3];
                    if (interaction.user.id !== targetUserId) {
                        return interaction.reply({ content: 'This verification button is not for you.', ephemeral: true });
                    }
                    const pending = await this.database.get(
                        `SELECT * FROM verification_queue WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
                        [guildId, targetUserId]
                    );
                    if (!pending) {
                        return interaction.reply({ content: 'No active verification challenge found.', ephemeral: true });
                    }
                    const isExpired = pending.expires_at && new Date(pending.expires_at).getTime() < Date.now();
                    if (isExpired) {
                        await this.database.run(`UPDATE verification_queue SET status = 'expired', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                        return interaction.reply({ content: 'Verification challenge expired. Ask staff to resend.', ephemeral: true });
                    }
                    const guild = this.client.guilds.cache.get(guildId);
                    if (!guild) return interaction.reply({ content: 'Guild not found for verification.', ephemeral: true });
                    const member = await guild.members.fetch(targetUserId).catch(() => null);
                    if (!member) return interaction.reply({ content: 'You are no longer in the server.', ephemeral: true });
                    await this.userVerification.markVerified(member, 'button');
                    await this.database.run(`UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                    return interaction.reply({ content: '✅ You are now verified. Welcome!', ephemeral: true });
                }
            }
            switch (customId) {
                case 'refresh_status':
                    // Refresh security status
                    const statusCommand = this.commands.get('status');
                    if (statusCommand) {
                        await statusCommand.execute(interaction);
                    }
                    break;

                case 'setup_guide':
                    const setupEmbed = new EmbedBuilder()
                        .setTitle('📋 GuardianBot Setup Guide')
                        .setDescription('Follow these steps to secure your server:')
                        .addFields(
                            { name: '1. Quick Setup', value: 'Use `/setup quick` for recommended settings', inline: false },
                            { name: '2. Configure Logging', value: 'Use `/setup logs` to set up security logs', inline: false },
                            { name: '3. Customize Protection', value: 'Fine-tune anti-spam and anti-raid settings', inline: false },
                            { name: '4. Check Status', value: 'Use `/status` to monitor your security score', inline: false },
                            { name: '5. Dashboard Access', value: 'Visit the web dashboard for detailed analytics', inline: false }
                        )
                        .setColor('#00d4ff');

                    await interaction.reply({ embeds: [setupEmbed], ephemeral: true });
                    break;

                case 'security_guide':
                    const securityEmbed = new EmbedBuilder()
                        .setTitle('🛡️ Security Best Practices')
                        .setDescription('Improve your server security:')
                        .addFields(
                            { name: '✅ Enable 2FA', value: 'Require 2FA for moderators', inline: false },
                            { name: '✅ Set Verification Level', value: 'Use medium or high verification', inline: false },
                            { name: '✅ Configure Permissions', value: 'Review and limit role permissions', inline: false },
                            { name: '✅ Monitor Activity', value: 'Regular check security logs and dashboard', inline: false },
                            { name: '✅ Stay Updated', value: 'Keep GuardianBot permissions up to date', inline: false }
                        )
                        .setColor('#2ed573');

                    await interaction.reply({ embeds: [securityEmbed], ephemeral: true });
                    break;

                case 'check_status':
                    const statusCmd = this.commands.get('status');
                    if (statusCmd) {
                        await statusCmd.execute(interaction);
                    }
                    break;

                // Ticket system buttons
                case 'ticket_open':
                case 'ticket_create':
                    if (this.ticketSystem) {
                        await this.ticketSystem.handleCreateButton(interaction);
                    }
                    break;
                
                case 'ticket_claim':
                    if (this.ticketSystem) {
                        await this.ticketSystem.handleClaim(interaction);
                    }
                    break;
                
                case 'ticket_close':
                    if (this.ticketSystem) {
                        await this.ticketSystem.handleClose(interaction);
                    }
                    break;

                // Spam action buttons
                default:
                    // Check if it's a spam action button
                    if (customId.startsWith('spam_')) {
                        await this.handleSpamAction(interaction);
                    } else {
                        await interaction.reply({
                            content: '❌ Unknown button interaction.',
                            ephemeral: true
                        });
                    }
            }
        } catch (error) {
            this.logger.error('Error handling button interaction:', error);
            await interaction.reply({
                content: '❌ An error occurred while processing your request.',
                ephemeral: true
            });
        }
    }

    async handleSpamAction(interaction) {
        const { customId, member, guild } = interaction;
        const { PermissionsBitField } = require('discord.js');

        // Check if user has moderation permissions
        if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return interaction.reply({
                content: '❌ You need Moderate Members permission to use these actions.',
                ephemeral: true
            });
        }

        // Parse the action and user ID from customId
        // Format: spam_action_userId
        const parts = customId.split('_');
        const action = parts[1]; // remove_timeout, warn, kick, ban
        const targetUserId = parts[parts.length - 1];

        await interaction.deferReply({ ephemeral: true });

        try {
            const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
            
            if (!targetMember) {
                return interaction.editReply({
                    content: '❌ User not found. They may have left the server.'
                });
            }

            const targetUser = targetMember.user;

            switch (action) {
                case 'remove':
                    // Remove timeout (from spam_remove_timeout_userId)
                    if (targetMember.communicationDisabledUntil) {
                        await targetMember.timeout(null, `Timeout removed by ${member.user.tag}`);
                        
                        // Log the action
                        await this.database.run(`
                            INSERT INTO mod_actions 
                            (guild_id, action_type, target_user_id, moderator_id, reason)
                            VALUES (?, ?, ?, ?, ?)
                        `, [
                            guild.id,
                            'TIMEOUT_REMOVED',
                            targetUserId,
                            member.id,
                            'Manual review: timeout removed after spam detection'
                        ]);

                        await interaction.editReply({
                            content: `✅ Removed timeout from ${targetUser.tag}`
                        });
                    } else {
                        await interaction.editReply({
                            content: `ℹ️ ${targetUser.tag} is not currently timed out.`
                        });
                    }
                    break;

                case 'warn':
                    // Add additional warning
                    const userRecord = await this.database.getUserRecord(guild.id, targetUserId);
                    const newWarningCount = (userRecord?.warning_count || 0) + 1;
                    
                    await this.database.createOrUpdateUserRecord(guild.id, targetUserId, {
                        warning_count: newWarningCount,
                        trust_score: Math.max(0, (userRecord?.trust_score || 50) - 15)
                    });

                    await this.database.run(`
                        INSERT INTO mod_actions 
                        (guild_id, action_type, target_user_id, moderator_id, reason)
                        VALUES (?, ?, ?, ?, ?)
                    `, [
                        guild.id,
                        'WARN',
                        targetUserId,
                        member.id,
                        'Additional warning after spam detection'
                    ]);

                    // Try to DM the user
                    try {
                        await targetUser.send({
                            embeds: [{
                                title: '⚠️ Additional Warning',
                                description: `You received an additional warning in **${guild.name}** from a moderator.`,
                                fields: [
                                    { name: 'Total Warnings', value: `${newWarningCount}`, inline: true },
                                    { name: 'Moderator', value: member.user.tag, inline: true }
                                ],
                                color: 0xffa500,
                                timestamp: new Date().toISOString()
                            }]
                        });
                    } catch (e) {
                        // User has DMs disabled
                    }

                    await interaction.editReply({
                        content: `✅ Added warning to ${targetUser.tag} (Total: ${newWarningCount})`
                    });
                    break;

                case 'kick':
                    if (!member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                        return interaction.editReply({
                            content: '❌ You need Kick Members permission to use this action.'
                        });
                    }

                    await targetMember.kick(`Kicked by ${member.user.tag} after spam detection`);

                    await this.database.run(`
                        INSERT INTO mod_actions 
                        (guild_id, action_type, target_user_id, moderator_id, reason)
                        VALUES (?, ?, ?, ?, ?)
                    `, [
                        guild.id,
                        'KICK',
                        targetUserId,
                        member.id,
                        'Kicked after spam detection review'
                    ]);

                    await interaction.editReply({
                        content: `✅ Kicked ${targetUser.tag} from the server`
                    });
                    break;

                case 'ban':
                    if (!member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                        return interaction.editReply({
                            content: '❌ You need Ban Members permission to use this action.'
                        });
                    }

                    await guild.members.ban(targetUserId, { 
                        reason: `Banned by ${member.user.tag} after spam detection`,
                        deleteMessageSeconds: 86400 // Delete messages from last 24 hours
                    });

                    await this.database.run(`
                        INSERT INTO mod_actions 
                        (guild_id, action_type, target_user_id, moderator_id, reason)
                        VALUES (?, ?, ?, ?, ?)
                    `, [
                        guild.id,
                        'BAN',
                        targetUserId,
                        member.id,
                        'Banned after spam detection review'
                    ]);

                    await interaction.editReply({
                        content: `✅ Banned ${targetUser.tag} from the server`
                    });
                    break;

                default:
                    await interaction.editReply({
                        content: '❌ Unknown action.'
                    });
            }

            // Update the original message to show action was taken
            try {
                const originalEmbed = interaction.message.embeds[0];
                if (originalEmbed) {
                    const updatedEmbed = new EmbedBuilder(originalEmbed.data)
                        .setColor(0x00ff00)
                        .addFields({
                            name: '✅ Action Taken',
                            value: `${member.user.tag} used: **${action.toUpperCase()}**`,
                            inline: false
                        });

                    await interaction.message.edit({
                        embeds: [updatedEmbed],
                        components: [] // Remove buttons after action
                    });
                }
            } catch (e) {
                // Failed to update original message
            }

        } catch (error) {
            this.logger.error('Error handling spam action:', error);
            await interaction.editReply({
                content: `❌ Failed to execute action: ${error.message}`
            });
        }
    }

    async registerSlashCommands() {
        try {
            this.logger.info('🔄 Refreshing application commands (global only, clearing guild overrides)...');
            const allCommands = Array.from(this.commands.values()).map(c => c.data.toJSON());

            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

            // Register commands globally
            await rest.put(Routes.applicationCommands(this.client.user.id), { body: allCommands });
            this.logger.info(`✅ Registered ${allCommands.length} global commands`);

            // Clear any guild-specific command sets to avoid duplicates in clients
            for (const guild of this.client.guilds.cache.values()) {
                try {
                    await rest.put(
                        Routes.applicationGuildCommands(this.client.user.id, guild.id),
                        { body: [] }
                    );
                    this.logger.info(`🧹 Cleared guild command overrides for ${guild.id}`);
                } catch (gErr) {
                    this.logger.warn(`⚠️ Failed to clear guild commands for ${guild.id}: ${gErr.message}`);
                }
            }
        } catch (error) {
            this.logger.error('❌ Failed to register slash commands:', error);
        }
    }

    async start() {
        await this.initialize();
        
        // Make bot and database accessible from client for command handlers
        this.client.bot = this;
        this.client.database = this.database;
        
        // Prevent attempting Discord login with an obviously invalid token when validation was skipped.
        const token = process.env.DISCORD_TOKEN;
        const tokenLooksValid = token && token.length >= 50 && !token.includes('your_') && !token.includes('paste_');
        const skipValidationFlag = (process.env.SKIP_ENV_VALIDATION === '1' || process.env.SKIP_ENV_VALIDATION === 'true');

        if (!tokenLooksValid) {
            if (skipValidationFlag) {
                this.logger.warn('⚠️ DISCORD_TOKEN appears invalid but SKIP_ENV_VALIDATION is set — skipping Discord login. Web/dashboard features may still start.');
                return;
            } else {
                this.logger.error('❌ DISCORD_TOKEN appears to be invalid. Aborting login.');
                throw new Error('Invalid DISCORD_TOKEN');
            }
        }

        try {
            console.log('🔐 Attempting Discord login...');
            await this.client.login(process.env.DISCORD_TOKEN);
            console.log('✅ Discord login successful');
            
            // Start tamper protection system
            console.log('🔒 Initializing tamper protection...');
            await tamperProtection.initialize();
            await tamperProtection.start();
            console.log('✅ Tamper protection active - monitoring critical files');
        } catch (e) {
            console.error('❌ Discord login failed:', e?.message || e);
            // Do not exit hard; allow Render to keep service up for dashboard/debugging
        }
    }

    // Feature gating utilities
    async isFeatureBlocked(interaction) {
        const guild = interaction.guild;
        if (!guild) return false;
        const cfg = await this.database.getGuildConfig(guild.id);
        const name = interaction.commandName;
        // If the command object declares a feature, prefer that authoritative flag
        try {
            const cmdObj = this.commands.get(name);
            if (cmdObj && cmdObj.feature) {
                const enabled = await this.isFeatureEnabledForGuild(guild.id, cmdObj.feature);
                return !enabled;
            }
        } catch (e) {
            this.logger?.warn('Error checking command-level feature flag:', e.message || e);
        }
        const featureMap = {
            // Only gate commands that are truly feature-specific and should not work without the feature
            // Do NOT gate setup/config commands or core moderation commands
            ai: ['ai', 'askai', 'ai_security_help'],
            autorole: ['autorole']
        };
        const isDisabled = (flag) => {
            if (flag === 'welcome') return !cfg.welcome_enabled;
            if (flag === 'verification') return !cfg.verification_enabled;
            if (flag === 'tickets') return !cfg.tickets_enabled;
            if (flag === 'ai') return !cfg.ai_enabled;
            if (flag === 'antinuke') return !cfg.antinuke_enabled;
            if (flag === 'antispam') return !cfg.anti_spam_enabled;
            if (flag === 'antiraid') return !cfg.anti_raid_enabled;
            if (flag === 'antiphishing') return !cfg.anti_phishing_enabled;
            if (flag === 'automod') return !cfg.auto_mod_enabled;
            if (flag === 'autorole') return !cfg.autorole_enabled;
            return false;
        };
        for (const [flag, cmds] of Object.entries(featureMap)) {
            if (cmds.includes(name)) return isDisabled(flag);
        }
        return false;
    }

    async isFeatureEnabledForGuild(guildId, feature) {
        if (!this.database) return false; // Fail-closed when DB unavailable
        const cfg = await this.database.getGuildConfig(guildId);
        if (!cfg) return false;
        const featureMap = {
            ai: 'ai_enabled',
            tickets: 'tickets_enabled',
            welcome: 'welcome_enabled',
            verification: 'verification_enabled',
            antinuke: 'antinuke_enabled',
            antispam: 'anti_spam_enabled',
            antiraid: 'anti_raid_enabled',
            antiphishing: 'anti_phishing_enabled',
            automod: 'auto_mod_enabled',
            autorole: 'autorole_enabled',
            links: 'anti_links_enabled',
            xp: 'xp_enabled'
        };
        const key = featureMap[feature];
        if (!key) return false; // Unknown feature = disabled
        return !!cfg[key];
    }

    isSubscriptionActive(record) {
        if (!record) return false;
        if (record.status !== 'active') return false;
        if (record.current_period_end && record.current_period_end <= Math.floor(Date.now() / 1000)) {
            return false;
        }
        return true;
    }

    async getGuildPlan(guildId) {
        const now = Math.floor(Date.now() / 1000);
        try {
            const record = await this.database.getGuildSubscription(guildId);
            let status = record?.status || 'inactive';
            if (status === 'active' && record?.current_period_end && record.current_period_end <= now) {
                status = 'inactive';
            }
            const isActive = status === 'active';
            const plan = record?.plan || 'free';
            return {
                guild_id: guildId,
                plan,
                effectivePlan: isActive ? plan : 'free',
                status,
                current_period_end: record?.current_period_end || null,
                stripe_customer_id: record?.stripe_customer_id || null,
                stripe_subscription_id: record?.stripe_subscription_id || null,
                is_active: isActive
            };
        } catch (error) {
            this.logger?.warn('Failed to load guild subscription state:', error.message || error);
            return {
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
    }

    async hasProFeatures(guildId) {
        try {
            const sub = await this.getGuildPlan(guildId);
            return sub.effectivePlan === 'pro' || sub.effectivePlan === 'enterprise';
        } catch (err) {
            this.logger?.warn(`[Paywall] Failed to check pro features for ${guildId}:`, err.message);
            return false; // fail-closed: deny access when subscription state unknown
        }
    }

    async hasEnterpriseFeatures(guildId) {
        try {
            const sub = await this.getGuildPlan(guildId);
            return sub.effectivePlan === 'enterprise';
        } catch (err) {
            this.logger?.warn(`[Paywall] Failed to check enterprise features for ${guildId}:`, err.message);
            return false; // fail-closed: deny access when subscription state unknown
        }
    }

    async applySubscriptionUpdate({ guildId, userId = null, plan = 'free', status = 'inactive', currentPeriodEnd = undefined, stripeCustomerId = null, stripeSubscriptionId = null }) {
        if (!guildId) {
            this.logger?.warn('Subscription update received without guildId');
            return null;
        }

        const allowedPlans = new Set(['free', 'pro', 'enterprise']);
        const allowedStatuses = new Set(['active', 'inactive', 'past_due', 'canceled']);

        const normalizedPlan = allowedPlans.has(plan) ? plan : 'free';
        const normalizedStatus = allowedStatuses.has(status) ? status : 'inactive';

        const previous = await this.database.getGuildSubscription(guildId).catch(() => null);
        const updatePayload = {
            plan: normalizedPlan,
            status: normalizedStatus,
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: stripeSubscriptionId
        };

        if (currentPeriodEnd !== undefined) {
            updatePayload.current_period_end = currentPeriodEnd;
        }

        const updated = await this.database.setGuildSubscription(guildId, updatePayload);

        await this.handleSubscriptionNotifications(updated, previous, userId);
        return updated;
    }

    async handleSubscriptionNotifications(updated, previous, userId = null) {
        try {
            const wasActive = this.isSubscriptionActive(previous);
            const isActive = this.isSubscriptionActive(updated);
            const statusChanged = (previous?.status || 'inactive') !== (updated?.status || 'inactive');
            const planChanged = (previous?.plan || 'free') !== (updated?.plan || 'free');

            if (isActive && (!wasActive || statusChanged || planChanged)) {
                await this.notifyGuildOwnerPlan(updated.guild_id, updated.plan, 'active');
                return;
            }

            const becameInactive = wasActive && !isActive;
            const movedToPastDue = ['past_due', 'canceled'].includes(updated?.status) && statusChanged;
            if (becameInactive || movedToPastDue) {
                await this.notifyGuildOwnerPlan(updated.guild_id, previous?.plan || updated.plan, 'expired', updated.status);
            }
        } catch (error) {
            this.logger?.warn('Subscription notification error:', error.message || error);
        }
    }

    async notifyGuildOwnerPlan(guildId, plan, type, status = null) {
        try {
            const guild = await this.client.guilds.fetch(guildId);
            const owner = await guild.fetchOwner();

            if (!owner) return;

            if (type === 'active') {
                const planLabel = plan === 'enterprise' ? 'Enterprise Plan' : 'Pro Plan';
                await owner.send(`Your server is now on the **${planLabel}**. Premium features are unlocked and active.`);
            } else {
                const planLabel = plan === 'enterprise' ? 'Enterprise' : 'Pro';
                await owner.send(`⚠️ Your ${planLabel} plan has expired or a payment failed. Status: ${status || 'inactive'}. Premium features are paused until billing is updated.`);
            }
        } catch (error) {
            this.logger?.warn('Failed to send subscription notification:', error.message || error);
        }
    }

    async shutdown() {
        this.logger.info('🔄 Shutting down bot...');
        
        if (this.dashboard && this.dashboard.server) {
            try {
                this.dashboard.server.close(() => {
                    this.logger.info('Dashboard shutdown complete');
                });
            } catch (error) {
                this.logger.warn('Dashboard shutdown error:', error.message);
            }
        }
        
        if (this.database) {
            await this.database.close();
        }
        
        this.client.destroy();
        this.logger.info('✅ Bot shutdown complete');
    }

    formatWelcomeMessage(messageTemplate, member) {
        const { EmbedBuilder } = require('discord.js');
        
        // Try to parse as JSON for custom embeds
        let customization;
        try {
            customization = JSON.parse(messageTemplate);
        } catch (e) {
            // Not JSON, treat as plain message
            customization = { message: messageTemplate };
        }

        // Replace placeholders
        const message = customization.message
            .replace(/{user}/g, member.user.toString())
            .replace(/{username}/g, member.user.username)
            .replace(/{server}/g, member.guild.name)
            .replace(/{memberCount}/g, member.guild.memberCount.toString());

        // Check if embed customization exists
        if (customization.embedTitle || customization.embedColor || customization.imageUrl) {
            const embed = new EmbedBuilder()
                .setColor(customization.embedColor || '#00d4ff')
                .setDescription(message)
                .setTimestamp();

            if (customization.embedTitle) embed.setTitle(customization.embedTitle);
            if (customization.imageUrl) embed.setImage(customization.imageUrl);
            
            return { embeds: [embed] };
        }

        // Return plain message
        return { content: message };
    }

    // Anti-Nuke Event Handlers
    async handleRoleCreate(role) {
        if (!this.antiNuke) return;
        
        const guild = role.guild;
        this.logger.debug(`Role created: ${role.name} in ${guild.name}`);
        
        // Get audit log to find who created the role
        const auditLogs = await guild.fetchAuditLogs({
            type: 30, // ROLE_CREATE
            limit: 1
        }).catch(() => null);
        
        if (!auditLogs) return;
        
        const entry = auditLogs.entries.first();
        if (!entry || !entry.executor) return;
        
        const userId = entry.executor.id;
        if (userId === this.client.user.id) return; // Ignore bot's own actions
        
        // Track the action
        const result = await this.antiNuke.trackAction(guild, userId, 'roleCreate', {
            roleId: role.id,
            roleName: role.name,
            permissions: role.permissions.bitfield.toString()
        });
        
        if (result.violated) {
            await this.antiNuke.handleViolation(guild, userId, result);
        }

        if (this.forensicsManager) {
            await this.forensicsManager.logAuditEvent({
                guildId: guild.id,
                eventType: 'role_create',
                eventCategory: 'role',
                executor: entry.executor,
                target: { id: role.id, name: role.name, type: 'role' },
                changes: { permissions: role.permissions.bitfield.toString() },
                afterState: { name: role.name, permissions: role.permissions.bitfield.toString() },
                canReplay: true
            });
        }

        if (this.antiNukeManager) {
            const tracked = this.antiNukeManager.track(guild.id, userId, 'role_create', { id: role.id });
            if (tracked?.triggered) {
                await this.antiNukeManager.mitigate(guild, userId);
            }
        }
    }

    async handleRoleDelete(role) {
        if (!this.antiNuke) return;
        
        const guild = role.guild;
        this.logger.debug(`Role deleted: ${role.name} in ${guild.name}`);
        
        const auditLogs = await guild.fetchAuditLogs({
            type: 32, // ROLE_DELETE
            limit: 1
        }).catch(() => null);
        
        if (!auditLogs) return;
        
        const entry = auditLogs.entries.first();
        if (!entry || !entry.executor) return;
        
        const userId = entry.executor.id;
        if (userId === this.client.user.id) return;
        
        const result = await this.antiNuke.trackAction(guild, userId, 'roleDelete', {
            roleId: role.id,
            roleName: role.name
        });
        
        if (result.violated) {
            await this.antiNuke.handleViolation(guild, userId, result);
        }

        if (this.forensicsManager) {
            await this.forensicsManager.logAuditEvent({
                guildId: guild.id,
                eventType: 'role_delete',
                eventCategory: 'role',
                executor: entry.executor,
                target: { id: role.id, name: role.name, type: 'role' },
                beforeState: { name: role.name },
                reason: result?.violated ? 'anti-nuke violation tracked' : null,
                canReplay: true
            });
        }

        if (this.antiNukeManager) {
            const tracked = this.antiNukeManager.track(guild.id, userId, 'role_delete', { id: role.id });
            if (tracked?.triggered) {
                await this.antiNukeManager.mitigate(guild, userId);
            }
        }
    }

    async handleChannelCreate(channel) {
        if (!this.antiNuke) {
            this.logger.warn('⚠️ Anti-nuke module not initialized');
            return;
        }
        if (!channel.guild) return; // DM channels
        
        const guild = channel.guild;
        this.logger.info(`🔔 Channel created: ${channel.name} (${channel.id}) in ${guild.name}`);
        
        const auditLogs = await guild.fetchAuditLogs({
            type: 10, // CHANNEL_CREATE
            limit: 1
        }).catch(err => {
            this.logger.error('❌ Failed to fetch audit logs:', err.message);
            return null;
        });
        
        if (!auditLogs) {
            this.logger.warn('⚠️ No audit logs available for channel creation');
            return;
        }
        
        const entry = auditLogs.entries.first();
        if (!entry) {
            this.logger.warn('⚠️ No audit log entry found');
            return;
        }
        if (!entry.executor) {
            this.logger.warn('⚠️ No executor in audit log entry');
            return;
        }
        
        const userId = entry.executor.id;
        this.logger.info(`👤 Channel creator: ${entry.executor.tag} (${userId})`);
        
        if (userId === this.client.user.id) {
            this.logger.debug('ℹ️ Ignoring own action');
            return;
        }
        
        this.logger.info(`🔍 Tracking channel creation by ${entry.executor.tag}`);
        const result = await this.antiNuke.trackAction(guild, userId, 'channelCreate', {
            channelId: channel.id,
            channelName: channel.name,
            channelType: channel.type
        });
        
        this.logger.info(`📊 Anti-nuke result:`, {
            violated: result.violated,
            counts: result.counts,
            limits: result.limits
        });
        
        if (result.violated) {
            this.logger.warn(`🚨 VIOLATION DETECTED! Taking action against ${entry.executor.tag}`);
            await this.antiNuke.handleViolation(guild, userId, result);
        }
        if (this.forensicsManager) {
            await this.forensicsManager.logAuditEvent({
                guildId: guild.id,
                eventType: 'channel_create',
                eventCategory: 'channel',
                executor: entry.executor,
                target: { id: channel.id, name: channel.name, type: 'channel' },
                changes: { channelType: channel.type },
                afterState: { name: channel.name, type: channel.type },
                canReplay: true
            });
        }

        if (this.antiNukeManager) {
            const tracked = this.antiNukeManager.track(guild.id, userId, 'channel_create', { id: channel.id });
            if (tracked?.triggered) {
                await this.antiNukeManager.mitigate(guild, userId);
            }
        }
    }

    async handleChannelDelete(channel) {
        if (!this.antiNuke) return;
        if (!channel.guild) return;
        
        const guild = channel.guild;
        this.logger.debug(`Channel deleted: ${channel.name} in ${guild.name}`);
        
        const auditLogs = await guild.fetchAuditLogs({
            type: 12, // CHANNEL_DELETE
            limit: 1
        }).catch(() => null);
        
        if (!auditLogs) return;
        
        const entry = auditLogs.entries.first();
        if (!entry || !entry.executor) return;
        
        const userId = entry.executor.id;
        if (userId === this.client.user.id) return;
        
        const result = await this.antiNuke.trackAction(guild, userId, 'channelDelete', {
            channelId: channel.id,
            channelName: channel.name
        });
        
        if (result.violated) {
            await this.antiNuke.handleViolation(guild, userId, result);
        }
        if (this.forensicsManager) {
            await this.forensicsManager.logAuditEvent({
                guildId: guild.id,
                eventType: 'channel_delete',
                eventCategory: 'channel',
                executor: entry.executor,
                target: { id: channel.id, name: channel.name, type: 'channel' },
                beforeState: { name: channel.name, type: channel.type },
                canReplay: true
            });
        }

        if (this.antiNukeManager) {
            const tracked = this.antiNukeManager.track(guild.id, userId, 'channel_delete', { id: channel.id });
            if (tracked?.triggered) {
                await this.antiNukeManager.mitigate(guild, userId);
            }
        }
    }

    async handleBanAdd(ban) {
        if (!this.antiNuke) return;
        
        const guild = ban.guild;
        this.logger.debug(`Ban added: ${ban.user.tag} in ${guild.name}`);
        
        const auditLogs = await guild.fetchAuditLogs({
            type: 22, // MEMBER_BAN_ADD
            limit: 1
        }).catch(() => null);
        
        if (!auditLogs) return;
        
        const entry = auditLogs.entries.first();
        if (!entry || !entry.executor) return;
        
        const userId = entry.executor.id;
        if (userId === this.client.user.id) return;
        
        const result = await this.antiNuke.trackAction(guild, userId, 'banAdd', {
            targetId: ban.user.id,
            targetTag: ban.user.tag
        });
        
        if (result.violated) {
            await this.antiNuke.handleViolation(guild, userId, result);
        }
        if (this.forensicsManager) {
            await this.forensicsManager.logAuditEvent({
                guildId: guild.id,
                eventType: 'ban_add',
                eventCategory: 'moderation',
                executor: entry.executor,
                target: { id: ban.user.id, name: ban.user.tag, type: 'user' },
                reason: entry.reason || null,
                changes: { action: 'ban' }
            });
        }
    }

    async handleWebhookUpdate(channel) {
        if (!this.antiNuke) return;
        if (!channel.guild) return;
        
        const guild = channel.guild;
        
        const auditLogs = await guild.fetchAuditLogs({
            type: 50, // WEBHOOK_CREATE
            limit: 1
        }).catch(() => null);
        
        if (!auditLogs) return;
        
        const entry = auditLogs.entries.first();
        if (!entry || !entry.executor) return;
        if (Date.now() - entry.createdTimestamp > 5000) return; // Only recent webhooks
        
        const userId = entry.executor.id;
        if (userId === this.client.user.id) return;
        
        const result = await this.antiNuke.trackAction(guild, userId, 'webhookCreate', {
            webhookId: entry.target?.id,
            channelId: channel.id,
            channelName: channel.name
        });
        
        if (result.violated) {
            await this.antiNuke.handleViolation(guild, userId, result);
        }
        if (this.forensicsManager) {
            await this.forensicsManager.logAuditEvent({
                guildId: guild.id,
                eventType: 'webhook_create',
                eventCategory: 'integration',
                executor: entry.executor,
                target: { id: entry.target?.id || channel.id, name: channel.name, type: 'webhook' },
                changes: { channelId: channel.id },
                canReplay: true
            });
        }
    }

    // Handle channel-based ticket creation
    async handleTicketCreate(interaction) {
        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType } = require('discord.js');
        
        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;
            const user = interaction.user;

            // Get guild ticket config
            const config = await this.database.get(
                'SELECT ticket_staff_role, ticket_category_id FROM guild_configs WHERE guild_id = ?',
                [guild.id]
            );

            if (!config || !config.ticket_staff_role) {
                return await interaction.editReply({
                    content: '❌ Ticket system is not configured. Ask an admin to run `/ticket-panel setup`.',
                    ephemeral: true
                });
            }

            // Check if user already has an open ticket
            const existingTicket = await this.database.get(
                'SELECT channel_id FROM active_tickets WHERE guild_id = ? AND user_id = ? AND status = ?',
                [guild.id, user.id, 'open']
            );

            if (existingTicket) {
                const channel = guild.channels.cache.get(existingTicket.channel_id);
                if (channel) {
                    return await interaction.editReply({
                        content: `❌ You already have an open ticket: ${channel}`,
                        ephemeral: true
                    });
                }
            }

            // Create ticket channel
            const ticketNumber = Date.now().toString().slice(-6);
            const channelName = `ticket-${user.username}-${ticketNumber}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

            const channelOptions = {
                name: channelName,
                type: ChannelType.GuildText,
                parent: config.ticket_category_id || null,
                topic: `Support ticket for ${user.tag} | User ID: ${user.id}`,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.AttachFiles
                        ]
                    },
                    {
                        id: config.ticket_staff_role,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.ManageMessages
                        ]
                    },
                    {
                        id: this.client.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ManageChannels
                        ]
                    }
                ]
            };

            const ticketChannel = await guild.channels.create(channelOptions);

            // Save to database
            await this.database.run(`
                INSERT INTO active_tickets (guild_id, channel_id, user_id, status, created_at)
                VALUES (?, ?, ?, 'open', CURRENT_TIMESTAMP)
            `, [guild.id, ticketChannel.id, user.id]);

            // Send welcome message
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🎫 Support Ticket Created')
                .setDescription(`
Hello ${user}, welcome to your support ticket!

Please describe your issue in detail. A staff member will assist you shortly.

**What happens next:**
• Staff will be notified of your ticket
• Please be patient and wait for a response
• Click the button below when your issue is resolved
                `)
                .setColor('#0096ff')
                .setTimestamp();

            const closeRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_close')
                        .setLabel('🔒 Close Ticket')
                        .setStyle(ButtonStyle.Danger)
                );

            await ticketChannel.send({
                content: `${user} | <@&${config.ticket_staff_role}>`,
                embeds: [welcomeEmbed],
                components: [closeRow]
            });

            await interaction.editReply({
                content: `✅ Ticket created! ${ticketChannel}`,
                ephemeral: true
            });

        } catch (error) {
            this.logger.error('Error creating ticket:', error);
            await interaction.editReply({
                content: '❌ Failed to create ticket. Please contact an administrator.',
                ephemeral: true
            });
        }
    }

    // Handle ticket close
    async handleTicketClose(interaction) {
        const { EmbedBuilder } = require('discord.js');
        
        await interaction.deferReply();

        try {
            const channel = interaction.channel;

            // Check if this is a ticket channel
            const ticket = await this.database.get(
                'SELECT * FROM active_tickets WHERE channel_id = ? AND status = ?',
                [channel.id, 'open']
            );

            if (!ticket) {
                return await interaction.editReply({
                    content: '❌ This is not an active ticket channel.',
                    ephemeral: true
                });
            }

            // Check permissions (ticket owner or staff)
            const config = await this.database.get(
                'SELECT ticket_staff_role FROM guild_configs WHERE guild_id = ?',
                [interaction.guild.id]
            );

            const isOwner = interaction.user.id === ticket.user_id;
            const isStaff = config && interaction.member.roles.cache.has(config.ticket_staff_role);
            const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

            if (!isOwner && !isStaff && !isAdmin) {
                return await interaction.editReply({
                    content: '❌ You don\'t have permission to close this ticket.',
                    ephemeral: true
                });
            }

            // Update database
            await this.database.run(
                'UPDATE active_tickets SET status = ?, closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE channel_id = ?',
                ['closed', interaction.user.id, channel.id]
            );

            // Send closing message
            const closeEmbed = new EmbedBuilder()
                .setTitle('🔒 Ticket Closed')
                .setDescription(`
This ticket has been closed by ${interaction.user}.

The channel will be deleted in 10 seconds...
                `)
                .setColor('#ff4757')
                .setTimestamp();

            await interaction.editReply({ embeds: [closeEmbed] });

            // Delete channel after delay
            setTimeout(async () => {
                try {
                    await channel.delete('Ticket closed');
                } catch (error) {
                    this.logger.error('Error deleting ticket channel:', error);
                }
            }, 10000);

        } catch (error) {
            this.logger.error('Error closing ticket:', error);
            await interaction.editReply({
                content: '❌ Failed to close ticket. Please contact an administrator.',
                ephemeral: true
            });
        }
    }

    async handleTicketCreateModal(interaction) {
        try {
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

            // Create modal with Problem and Detailed Description fields
            const modal = new ModalBuilder()
                .setCustomId('ticket_modal')
                .setTitle('📨 Create Support Ticket');

            const problemInput = new TextInputBuilder()
                .setCustomId('ticket_problem')
                .setLabel('Problem')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Brief summary of your issue...')
                .setRequired(true)
                .setMaxLength(100);

            const descriptionInput = new TextInputBuilder()
                .setCustomId('ticket_description')
                .setLabel('Detailed Description')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Provide all relevant details about your issue...')
                .setRequired(true)
                .setMaxLength(1000);

            const problemRow = new ActionRowBuilder().addComponents(problemInput);
            const descriptionRow = new ActionRowBuilder().addComponents(descriptionInput);

            modal.addComponents(problemRow, descriptionRow);

            await interaction.showModal(modal);
        } catch (error) {
            this.logger.error('Error showing ticket modal:', error);
            await interaction.reply({
                content: '❌ Failed to open ticket creation form.',
                ephemeral: true
            });
        }
    }

    async handleTicketSubmit(interaction) {
        try {
            const { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

            await interaction.deferReply({ ephemeral: true });

            // Get ticket config
            const config = await this.database.get(
                'SELECT ticket_channel_id, ticket_staff_role, ticket_manage_role, ticket_category_id FROM guild_configs WHERE guild_id = ?',
                [interaction.guild.id]
            );

            if (!config || !config.ticket_channel_id) {
                return await interaction.editReply({
                    content: '❌ Ticket system is not set up. Ask an admin to run `/ticket setup`.',
                    ephemeral: true
                });
            }

            // Check if user already has an open ticket
            const existingTicket = await this.database.get(
                'SELECT * FROM active_tickets WHERE guild_id = ? AND user_id = ? AND status = ?',
                [interaction.guild.id, interaction.user.id, 'open']
            );

            if (existingTicket) {
                return await interaction.editReply({
                    content: `❌ You already have an open ticket: <#${existingTicket.channel_id}>`,
                    ephemeral: true
                });
            }

            // Get form data
            const problem = interaction.fields.getTextInputValue('ticket_problem');
            const description = interaction.fields.getTextInputValue('ticket_description');

            // Generate ticket ID
            const ticketCount = await this.database.get(
                'SELECT COUNT(*) as count FROM active_tickets WHERE guild_id = ?',
                [interaction.guild.id]
            );
            const ticketId = (ticketCount.count + 1).toString().padStart(4, '0');

            // Create ticket channel
            const channelName = `ticket-${interaction.user.username}-${ticketId}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
            
            const ticketChannel = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: config.ticket_category_id || null,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.AttachFiles
                        ]
                    },
                    {
                        id: config.ticket_staff_role,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.AttachFiles
                        ]
                    }
                ]
            });

            // Add manage role if specified
            if (config.ticket_manage_role) {
                await ticketChannel.permissionOverwrites.create(config.ticket_manage_role, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    ManageChannels: true,
                    ManageMessages: true
                });
            }

            // Save to database
            await this.database.run(
                `INSERT INTO active_tickets (guild_id, channel_id, user_id, ticket_id, problem, description, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [interaction.guild.id, ticketChannel.id, interaction.user.id, ticketId, problem, description, 'open']
            );

            // Send welcome message in ticket channel
            const welcomeEmbed = new EmbedBuilder()
                .setTitle(`🎫 Ticket #${ticketId}`)
                .setDescription(`
**Problem:** ${problem}

**Description:**
${description}

**Created by:** ${interaction.user}
**Status:** 🟢 Open

Our support team will be with you shortly!
                `)
                .setColor('#00d4ff')
                .setTimestamp();

            const closeButton = new ButtonBuilder()
                .setCustomId('ticket_close')
                .setLabel('🔒 Close Ticket')
                .setStyle(ButtonStyle.Danger);

            const buttonRow = new ActionRowBuilder().addComponents(closeButton);

            await ticketChannel.send({
                content: `${interaction.user} | <@&${config.ticket_staff_role}>`,
                embeds: [welcomeEmbed],
                components: [buttonRow]
            });

            // Send DM confirmation to user
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('✅ Ticket Created')
                    .setDescription(`
Your support ticket has been created successfully!

**Ticket ID:** #${ticketId}
**Channel:** ${ticketChannel}

Our support team will reach out shortly. Please check the ticket channel for updates.
                    `)
                    .setColor('#2ed573')
                    .setTimestamp();

                await interaction.user.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                this.logger.warn(`Could not send DM to ${interaction.user.tag}:`, dmError.message);
            }

            // Reply to interaction
            await interaction.editReply({
                content: `✅ Your ticket has been created: ${ticketChannel}`,
                ephemeral: true
            });

            // Emit event for dashboard
            if (this.backend && this.backend.eventEmitter) {
                this.backend.eventEmitter.emit('ticketCreated', {
                    guildId: interaction.guild.id,
                    ticketId,
                    channelId: ticketChannel.id,
                    userId: interaction.user.id,
                    problem,
                    description
                });
            }

        } catch (error) {
            this.logger.error('Error creating ticket:', error);
            await interaction.editReply({
                content: '❌ Failed to create ticket. Please contact an administrator.',
                ephemeral: true
            });
        }
    }

    async handleTicketClaim(interaction) {
        try {
            const { EmbedBuilder, PermissionsBitField } = require('discord.js');

            await interaction.deferReply({ ephemeral: true });

            // Get ticket config
            const config = await this.database.get(
                'SELECT ticket_staff_role, ticket_manage_role FROM guild_configs WHERE guild_id = ?',
                [interaction.guild.id]
            );

            if (!config) {
                return await interaction.editReply({
                    content: '❌ Ticket system is not configured.',
                    ephemeral: true
                });
            }

            // Check if user has staff or manage role
            const hasStaffRole = interaction.member.roles.cache.has(config.ticket_staff_role);
            const hasManageRole = config.ticket_manage_role && interaction.member.roles.cache.has(config.ticket_manage_role);
            const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

            if (!hasStaffRole && !hasManageRole && !isAdmin) {
                return await interaction.editReply({
                    content: '❌ You don\'t have permission to claim tickets.',
                    ephemeral: true
                });
            }

            // Get ticket from database
            const ticket = await this.database.get(
                'SELECT * FROM active_tickets WHERE channel_id = ? AND status = ?',
                [interaction.channel.id, 'open']
            );

            if (!ticket) {
                return await interaction.editReply({
                    content: '❌ This is not an active ticket channel.',
                    ephemeral: true
                });
            }

            // Check if already claimed
            if (ticket.claimed_by) {
                const claimer = await interaction.guild.members.fetch(ticket.claimed_by);
                return await interaction.editReply({
                    content: `❌ This ticket has already been claimed by ${claimer}.`,
                    ephemeral: true
                });
            }

            // Claim the ticket
            await this.database.run(
                'UPDATE active_tickets SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP WHERE channel_id = ?',
                [interaction.user.id, interaction.channel.id]
            );

            // Send claim message
            const claimEmbed = new EmbedBuilder()
                .setTitle('✅ Ticket Claimed')
                .setDescription(`This ticket has been claimed by ${interaction.user}`)
                .setColor('#2ed573')
                .setTimestamp();

            await interaction.channel.send({ embeds: [claimEmbed] });

            // Update original panel message to disable claim button (if found)
            try {
                const messages = await interaction.channel.messages.fetch({ limit: 50 });
                const welcomeMessage = messages.find(msg => 
                    msg.author.id === this.client.user.id && 
                    msg.embeds.length > 0 && 
                    msg.embeds[0].title?.includes('Ticket #')
                );

                if (welcomeMessage && welcomeMessage.components.length > 0) {
                    // Keep the close button, but disable claim if it exists
                    const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
                    const closeButton = new ButtonBuilder()
                        .setCustomId('ticket_close')
                        .setLabel('🔒 Close Ticket')
                        .setStyle(ButtonStyle.Danger);

                    const buttonRow = new ActionRowBuilder().addComponents(closeButton);
                    await welcomeMessage.edit({ components: [buttonRow] });
                }
            } catch (updateError) {
                this.logger.warn('Could not update ticket message:', updateError.message);
            }

            await interaction.editReply({
                content: '✅ You have claimed this ticket.',
                ephemeral: true
            });

            // Emit event for dashboard
            if (this.backend && this.backend.eventEmitter) {
                this.backend.eventEmitter.emit('ticketClaimed', {
                    guildId: interaction.guild.id,
                    ticketId: ticket.ticket_id,
                    channelId: interaction.channel.id,
                    claimedBy: interaction.user.id
                });
            }

        } catch (error) {
            this.logger.error('Error claiming ticket:', error);
            await interaction.editReply({
                content: '❌ Failed to claim ticket. Please try again.',
                ephemeral: true
            });
        }
    }

    async handleHelpModal(interaction) {
        try {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

            // Get the topic the user selected
            const topic = interaction.fields.getTextInputValue('help-description') || 'General';

            const helpCategories = {
                'Moderation': {
                    emoji: '🔨',
                    color: '#ff6b6b',
                    commands: ['kick', 'ban', 'timeout', 'warn', 'purge', 'unban'],
                    description: 'Manage and moderate your community with powerful tools'
                },
                'Security': {
                    emoji: '🛡️',
                    color: '#00d4ff',
                    commands: ['status', 'lockdown', 'antispam', 'antiraid'],
                    description: 'Advanced protection against raids, spam, and attacks'
                },
                'Verification': {
                    emoji: '✅',
                    color: '#51cf66',
                    commands: ['verify', 'verify-approve', 'verify-reject'],
                    description: 'Verify users with captcha and approval workflows'
                },
                'Admin': {
                    emoji: '⚙️',
                    color: '#ffd43b',
                    commands: ['setup', 'config', 'backup', 'logs'],
                    description: 'Configure and manage bot settings'
                },
                'Economy': {
                    emoji: '💰',
                    color: '#ff922b',
                    commands: ['balance', 'daily', 'work', 'pay', 'deposit', 'withdraw'],
                    description: 'Economy system with coins, shops, and trading'
                },
                'Leveling': {
                    emoji: '📈',
                    color: '#a78bfa',
                    commands: ['rank', 'leaderboard', 'top10', 'profile'],
                    description: 'XP system with ranks and leaderboards'
                },
                'Utility': {
                    emoji: '🔧',
                    color: '#1f2937',
                    commands: ['help', 'ping', 'info', 'userinfo', 'serverinfo', 'avatar'],
                    description: 'General utility and information commands'
                }
            };

            const helpEmbed = new EmbedBuilder()
                .setTitle('🛡️ GuardianBot - Help Center')
                .setDescription('Select a category from the buttons below to learn more')
                .setColor('#00d4ff')
                .setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }))
                .setTimestamp()
                .setFooter({ text: 'Use /help <command> for detailed info on specific commands' });

            // Add category information
            let categoryText = '';
            for (const [category, info] of Object.entries(helpCategories)) {
                categoryText += `${info.emoji} **${category}**: ${info.description}\n`;
            }
            helpEmbed.addFields({ name: 'Available Categories', value: categoryText, inline: false });

            // Create buttons for each category
            const buttons = [];
            const categoryNames = Object.keys(helpCategories);
            
            for (let i = 0; i < categoryNames.length; i += 5) {
                const row = new ActionRowBuilder();
                const slice = categoryNames.slice(i, i + 5);
                
                slice.forEach(category => {
                    const info = helpCategories[category];
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`help-category-${category.toLowerCase()}`)
                            .setLabel(category)
                            .setEmoji(info.emoji)
                            .setStyle(ButtonStyle.Secondary)
                    );
                });
                
                buttons.push(row);
            }

            // Add admin panel button
            const adminRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Admin Panel')
                        .setStyle(ButtonStyle.Link)
                        .setURL(process.env.DASHBOARD_URL || 'https://discord-security-bot-uyxf.onrender.com/dashboard')
                        .setEmoji('📊'),
                    new ButtonBuilder()
                        .setLabel('Support Server')
                        .setStyle(ButtonStyle.Link)
                        .setURL(process.env.SUPPORT_INVITE || 'https://discord.gg/Vsq9PUTrgb')
                        .setEmoji('🤝')
                );

            buttons.push(adminRow);

            await interaction.reply({
                embeds: [helpEmbed],
                components: buttons,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error handling help modal:', error);
            if (!interaction.replied) {
                await interaction.reply({
                    content: '❌ An error occurred while processing your request.',
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }

    async handleHelpTicketModal(interaction) {
        const category = interaction.customId.replace('help-ticket-modal-', '');

        try {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            
            const subject = interaction.fields.getTextInputValue('help-subject');
            const reason = interaction.fields.getTextInputValue('help-reason');
            const description = interaction.fields.getTextInputValue('help-description');
            const priority = 'normal'; // Default priority

            await interaction.deferReply({ ephemeral: true });

            // Create the ticket (combine reason and description)
            const fullDescription = `**Reason:** ${reason}\n\n**Details:**\n${description}`;
            const result = await this.helpTicketSystem.createTicket(
                interaction.user.id,
                interaction.guildId,
                category,
                subject,
                fullDescription,
                priority
            );

            if (!result || !result.ticketId) {
                return await interaction.editReply({
                    content: '❌ Failed to create ticket. Please try again later.',
                    ephemeral: true
                });
            }

            const ticketId = result.ticketId;

            // Send confirmation to user
            const userEmbed = new EmbedBuilder()
                .setTitle('✅ Support Ticket Created')
                .setColor('#00ff00')
                .addFields(
                    { name: 'Ticket ID', value: `\`${ticketId}\``, inline: false },
                    { name: 'Category', value: `${this.helpTicketSystem.getCategoryEmoji(category)} ${this.helpTicketSystem.getCategoryLabel(category)}`, inline: true },
                    { name: 'Status', value: '🔄 Open', inline: true },
                    { name: '\u200b', value: '\u200b', inline: true },
                    { name: 'Subject', value: subject, inline: false },
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Description', value: description.slice(0, 400) + (description.length > 400 ? '...' : ''), inline: false },
                )
                .setFooter({ text: 'Our team will review your ticket shortly.' })
                .setTimestamp();

            await interaction.editReply({ embeds: [userEmbed] });

            // Send notification to admins
            try {
                const config = await this.configManager.getGuildConfig(interaction.guildId);
                const supportChannelId = config?.supportChannelId || config?.modLogChannel;

                if (supportChannelId) {
                    const adminChannel = await interaction.guild.channels.fetch(supportChannelId);

                    const adminEmbed = new EmbedBuilder()
                        .setTitle(`🆘 New Support Ticket: ${ticketId}`)
                        .setColor('#ff9900')
                        .addFields(
                            { name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
                            { name: 'Category', value: `${this.helpTicketSystem.getCategoryEmoji(category)} ${this.helpTicketSystem.getCategoryLabel(category)}`, inline: true },
                            { name: 'Status', value: '🔄 Open', inline: true },
                            { name: 'Subject', value: subject, inline: false },
                            { name: 'Reason', value: reason, inline: false },
                            { name: 'Description', value: description.slice(0, 800) + (description.length > 800 ? '...' : ''), inline: false },
                        )
                        .setThumbnail(interaction.user.displayAvatarURL())
                        .setTimestamp();

                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`ticket-assign-${ticketId}`)
                                .setLabel('Assign to Me')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`ticket-in-progress-${ticketId}`)
                                .setLabel('Mark In Progress')
                                .setStyle(ButtonStyle.Warning),
                            new ButtonBuilder()
                                .setURL(process.env.DASHBOARD_URL || 'https://discord-security-bot-uyxf.onrender.com/admin')
                                .setLabel('View Dashboard')
                                .setStyle(ButtonStyle.Link)
                        );

                    await adminChannel.send({ embeds: [adminEmbed], components: [row] });
                }
            } catch (error) {
                this.logger?.warn('Failed to send ticket notification to admin channel:', error);
            }

            // Try to DM the user
            try {
                await interaction.user.send({
                    embeds: [userEmbed]
                });
            } catch (error) {
                this.logger?.warn('Failed to DM user about ticket:', error);
            }

        } catch (error) {
            this.logger?.error('Error processing help ticket modal:', error);
            await interaction.editReply({
                content: '❌ An error occurred while creating your ticket. Please try again.',
                ephemeral: true
            });
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    if (global.bot) {
        await global.bot.shutdown();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (global.bot) {
        await global.bot.shutdown();
    }
    process.exit(0);
});

// Start the bot
async function startBot() {
    try {
        const bot = new SecurityBot();
        global.bot = bot;
        await bot.start();
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    startBot();
}

module.exports = SecurityBot;





