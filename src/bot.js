const Module = require('module');
const ORIGINAL_MODULE_LOAD = Module._load;
Object.freeze(Module);
Object.freeze(Module._load);

const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════════════════════
// SELF-INTEGRITY CHECK - Protect the Protector
// These hashes are hardcoded. If an attacker modifies the protection system,
// they would also need to modify bot.js, which is itself protected by the system.
// This creates a circular dependency that's hard to bypass atomically.
// ═══════════════════════════════════════════════════════════════════════════════
const CRITICAL_HASHES = {
    'file-protection/agent/validator.js': '832fc82fe3a4d0c777f51f5a413198ee3f2709fd9a1d5b6c575c28136ebdf67d',
    'file-protection/agent/baseline-manager.js': 'a86c1e22a7ee3bb99f2a374ab6f4ecb9ca31c906e17d12285b1ab82c92278a41',
    'file-protection/agent/response-handler.js': 'f4061527f5e62087f7d0e4e2c77e0c0b2ea93de8917ae780053f7c94b41c8ba5',
    'file-protection/agent/constants.js': 'fbd542244a24c092face3a3951629eeb4650a7dde7bc23b4c1cec79c38f87f1e'
};

const hashFileSync = (filePath) => {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
};

for (const [relativePath, expectedHash] of Object.entries(CRITICAL_HASHES)) {
    const fullPath = path.join(__dirname, '..', relativePath);
    try {
        const actualHash = hashFileSync(fullPath);
        if (actualHash !== expectedHash) {
            console.error(`[CRITICAL] Self-integrity check FAILED for ${relativePath}`);
            console.error(`  Expected: ${expectedHash}`);
            console.error(`  Actual:   ${actualHash}`);
            console.error('[CRITICAL] Protection system may be compromised. Shutting down.');
            process.exit(1);
        }
    } catch (err) {
        console.error(`[CRITICAL] Cannot verify ${relativePath}: ${err.message}`);
        process.exit(1);
    }
}

// Initialize Tamper Protection System
const TamperProtectionSystem = require('../file-protection/index');
const tamperProtection = new TamperProtectionSystem({ logger: console });

// Validate environment variables on startup (fail closed)
const EnvValidator = require('./utils/env-validator');
const envValidator = new EnvValidator();
envValidator.sanitize();
const validationResult = envValidator.validate();
const reportOk = envValidator.printReport();

if (!reportOk) {
    console.error('\n[ENV] Environment validation failed! Please fix the errors above before starting the bot.\n');
    process.exit(1);
}

// Import core modules
const Database = require('./database/database');
const Logger = require('./utils/logger');
const ConfigManager = require('./utils/config');

// Import security modules
const AntiRaid = require('./security/antiraid');
const AntiSpam = require('./security/antispam');
const AntiNuke = require('./security/antinuke');
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
const StandardEmbedBuilder = require('./utils/embed-builder');

// Import new enhanced modules
const SecurityManager = require('./utils/SecurityManager');
const AnalyticsManager = require('./utils/AnalyticsManager');
const SettingsManager = require('./utils/SettingsManager');
const PermissionManager = require('./utils/PermissionManager');
const SetupWizard = require('./utils/SetupWizard');
const SecurityScanner = require('./utils/SecurityScanner');
const DashboardLogger = require('./utils/DashboardLogger');
const ConfirmationManager = require('./utils/ConfirmationManager');
const ForensicsManager = require('./utils/ForensicsManager');
const LockdownManager = require('./utils/LockdownManager');

// Import extracted interaction handlers
const interactionHandlers = require('./core/interactions');

// Import rank system from systems folder
const RankSystem = require('./systems/rankSystem');

// Production mode check
const PRODUCTION_MODE = process.env.PRODUCTION_MODE === 'true' || process.env.NODE_ENV === 'production';

class SecurityBot {
    constructor() {
        // Enhanced global error handlers with production mode support
        process.on('unhandledRejection', (reason, promise) => {
            const errorMsg = `Unhandled Promise Rejection at: ${promise}\nReason: ${reason}`;

            if (PRODUCTION_MODE) {
                // Production: Log to file/service, suppress console spam
                if (this.logger) {
                    this.logger.error(errorMsg);
                } else {
                    console.error('[CRITICAL]', errorMsg);
                }
            } else {
                // Development: Verbose output
                console.error('━'.repeat(80));
                console.error('🚨 UNHANDLED PROMISE REJECTION');
                console.error('━'.repeat(80));
                console.error(reason);
                console.error('━'.repeat(80));
            }

            // Attempt graceful recovery
            if (this.database && typeof this.database.logError === 'function') {
                this.database.logError('unhandled_rejection', errorMsg).catch(() => { });
            }
        });

        process.on('uncaughtException', (error, origin) => {
            const errorMsg = `Uncaught Exception at: ${origin}\nError: ${error.stack || error}`;

            if (PRODUCTION_MODE) {
                // Production: Log and attempt graceful shutdown
                if (this.logger) {
                    this.logger.error(errorMsg);
                } else {
                    console.error('[FATAL]', errorMsg);
                }

                // Give time for logs to flush before exiting
                setTimeout(() => {
                    process.exit(1);
                }, 1000);
            } else {
                // Development: Verbose output, don't exit
                console.error('━'.repeat(80));
                console.error('💥 UNCAUGHT EXCEPTION');
                console.error('━'.repeat(80));
                console.error(error);
                console.error('━'.repeat(80));
            }

            // Log to database if available
            if (this.database && typeof this.database.logError === 'function') {
                this.database.logError('uncaught_exception', errorMsg).catch(() => { });
            }
        });

        // SIGTERM/SIGINT handlers for graceful shutdown
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));

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
        this.settingsManager = null;
        this.setupWizard = null;
        this.securityScanner = null;
        this.dashboardLogger = null;
        this.confirmationManager = null;
        this.forensicsManager = null;
        this.lockdownManager = null;

        // Initialize rank system
        this.rankSystem = null;
        this.rankCardGenerator = null;

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
        this.commandProcessingDisabled = false;
    }

    async initialize() {
        try {
            // Initialize database first
            this.database = new Database();
            await this.database.initialize();
            this.database.attachBot(this);
            
            // Give database time to fully initialize
            await new Promise(resolve => setTimeout(resolve, 100));

            // Initialize logger with database reference
            this.logger = new Logger(this);
            await this.logger.initialize();

            console.log('🤖 Initializing DarkLock...');
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

            const JoinQueue = require('./utils/joinQueue');
            this.joinQueue = new JoinQueue(this);

            const DMQueue = require('./utils/dmQueue');
            this.dmQueue = new DMQueue(this);
            this.toxicityFilter = new ToxicityFilter(this);
            this.behaviorDetection = new BehaviorDetection(this);

            // Start audit watcher for fast anti-nuke detection
            try {
                setupAuditWatcher(this.client, this);
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

            // Forensics Manager for immutable audit logging
            this.forensicsManager = new ForensicsManager(this);
            this.logger.info('   ✅ Forensics Manager initialized');

            // Lockdown Manager for server lockdowns
            this.lockdownManager = new LockdownManager(this);
            await this.lockdownManager.initialize();
            this.logger.info('   ✅ Lockdown Manager initialized');

            // Rank System for XP and leveling
            this.rankSystem = new RankSystem(this);
            this.logger.info('   ✅ Rank System initialized');
            this.logger.info('   ✅ Rank System initialized');

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
                    try { this.logger?.warn && this.logger.warn('broadcastConsole failed:', e?.message || e); } catch (_) { }
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
                } catch (_) { }
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
                    try { _log(...args); } catch (_) { }
                    const msg = serialize(args);
                    broadcastAllGuilds({ level: 'info', message: msg, timestamp: Date.now() });
                };

                console.info = (...args) => {
                    try { _info(...args); } catch (_) { }
                    const msg = serialize(args);
                    broadcastAllGuilds({ level: 'info', message: msg, timestamp: Date.now() });
                };

                console.warn = (...args) => {
                    try { _warn(...args); } catch (_) { }
                    const msg = serialize(args);
                    broadcastAllGuilds({ level: 'warn', message: msg, timestamp: Date.now() });
                };

                console.error = (...args) => {
                    try { _error(...args); } catch (_) { }
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
                                        try { controller.abort(); } catch (_) { }
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

            // Feature gate helper bound to bot instance
            this.isFeatureEnabledForGuild = async (guildId, feature) => {
                if (!this.database) return true;
                const cfg = await this.database.getGuildConfig(guildId);
                const map = {
                    ai: 'ai_enabled',
                    tickets: 'tickets_enabled',
                    verification: 'verification_enabled',
                    welcome: 'welcome_enabled',
                    antinuke: 'antinuke_enabled',
                    antiraid: 'antiraid_enabled',
                    antispam: 'antispam_enabled',
                    antiphishing: 'antiphishing_enabled',
                    links: 'anti_links_enabled'
                };
                const key = map[feature] || feature;
                // If config doesn't have the key, default to true (don't block commands unexpectedly)
                if (typeof cfg[key] === 'undefined' || cfg[key] === null) return true;
                return Boolean(cfg[key]);
            };

            // Listen for dashboard config updates for real-time sync
            this.client.on('guildConfigUpdate', async ({ guildId, settings }) => {
                try {
                    this.logger.info(`[ConfigSync] Received config update for guild ${guildId}`);

                    // Reload config from database to get fresh data
                    const config = await this.database.getGuildConfig(guildId);

                    // Handle anti-raid toggle
                    if (settings.hasOwnProperty('anti_raid_enabled') || settings.hasOwnProperty('antiraid_enabled')) {
                        const enabled = settings.anti_raid_enabled || settings.antiraid_enabled;
                        if (!enabled && this.antiRaid) {
                            this.logger.info(`[AntiRaid] Disabled for guild ${guildId}`);
                            // Clear any active lockdowns
                            if (this.antiRaid.lockdowns && this.antiRaid.lockdowns.has(guildId)) {
                                this.antiRaid.lockdowns.delete(guildId);
                            }
                        } else if (enabled) {
                            this.logger.info(`[AntiRaid] Enabled for guild ${guildId}`);
                            if (this.antiRaid && this.antiRaid.initializeGuild) {
                                await this.antiRaid.initializeGuild(guildId);
                            }
                        }
                    }

                    // Handle anti-spam toggle
                    if (settings.hasOwnProperty('anti_spam_enabled') || settings.hasOwnProperty('antispam_enabled')) {
                        const enabled = settings.anti_spam_enabled || settings.antispam_enabled;
                        if (!enabled && this.antiSpam) {
                            this.logger.info(`[AntiSpam] Disabled for guild ${guildId}`);
                            // Clear message tracking for this guild
                            if (this.antiSpam.userMessages) {
                                for (const [key] of this.antiSpam.userMessages.entries()) {
                                    if (key.startsWith(guildId)) {
                                        this.antiSpam.userMessages.delete(key);
                                    }
                                }
                            }
                        } else if (enabled) {
                            this.logger.info(`[AntiSpam] Enabled for guild ${guildId}`);
                        }
                    }

                    // Handle anti-phishing toggle
                    if (settings.hasOwnProperty('anti_phishing_enabled') || settings.hasOwnProperty('antiphishing_enabled')) {
                        const enabled = settings.anti_phishing_enabled || settings.antiphishing_enabled;
                        if (!enabled && this.antiPhishing) {
                            this.logger.info(`[AntiPhishing] Disabled for guild ${guildId}`);
                        } else if (enabled) {
                            this.logger.info(`[AntiPhishing] Enabled for guild ${guildId}`);
                        }
                    }

                    // Handle anti-nuke toggle
                    if (settings.hasOwnProperty('antinuke_enabled')) {
                        const enabled = settings.antinuke_enabled;
                        if (!enabled && this.antiNuke) {
                            this.logger.info(`[AntiNuke] Disabled for guild ${guildId}`);
                        } else if (enabled) {
                            this.logger.info(`[AntiNuke] Enabled for guild ${guildId}`);
                            if (this.antiNuke && this.antiNuke.initializeGuild) {
                                await this.antiNuke.initializeGuild(guildId);
                            }
                        }
                    }

                    // Handle verification toggle
                    if (settings.hasOwnProperty('verification_enabled')) {
                        const enabled = settings.verification_enabled;
                        if (!enabled && this.userVerification) {
                            this.logger.info(`[Verification] Disabled for guild ${guildId}`);
                        } else if (enabled) {
                            this.logger.info(`[Verification] Enabled for guild ${guildId}`);
                        }
                    }

                    // Handle tickets toggle
                    if (settings.hasOwnProperty('tickets_enabled')) {
                        const enabled = settings.tickets_enabled;
                        if (!enabled) {
                            this.logger.info(`[Tickets] Disabled for guild ${guildId}`);
                        } else if (enabled) {
                            this.logger.info(`[Tickets] Enabled for guild ${guildId}`);
                            // Initialize ticket system for this guild if needed
                            if (this.ticketManager && this.ticketManager.initializeGuild) {
                                await this.ticketManager.initializeGuild(guildId);
                            }
                        }
                    }

                    this.logger.success(`[ConfigSync] Guild ${guildId} configuration reloaded successfully`);
                } catch (error) {
                    this.logger.error(`[ConfigSync] Error handling config update for guild ${guildId}:`, error);
                }
            });

            // Setup event handlers
            await this.setupEventHandlers();

            // Start web dashboard if enabled
            if (process.env.ENABLE_WEB_DASHBOARD === 'true') {
                // Prefer platform-assigned PORT, then DASHBOARD_PORT, then WEB_PORT, then fallback to 3001
                const port = process.env.PORT || process.env.DASHBOARD_PORT || process.env.WEB_PORT || 3001;
                await this.dashboard.start(port);
                this.logger.info(`🌐 Dashboard started on http://localhost:${port}`);
                
                // Mount Darklock Platform on the same server
                try {
                    const DarklockPlatform = require('../darklock/server');
                    const darklock = new DarklockPlatform();
                    await darklock.mountOn(this.dashboard.app);
                    this.logger.info('🔐 Darklock Platform mounted at /platform/*');
                    this.logger.info(`   - Homepage: http://localhost:${port}/platform`);
                    this.logger.info(`   - Darklock Guard: http://localhost:${port}/platform/download/darklock-guard-installer`);
                    this.logger.info(`   - Web Monitor: http://localhost:${port}/platform/monitor/darklock-guard`);
                    
                    // Register 404 handler AFTER Darklock routes are mounted
                    this.dashboard.app.use((req, res) => {
                        res.status(404).json({ error: 'Not found' });
                    });
                    
                } catch (error) {
                    this.logger.error('❌ Failed to mount Darklock Platform:', error);
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

        const commandFolders = ['admin', 'moderation', 'security', 'utility'];

        for (const folder of commandFolders) {
            const folderPath = path.join(commandsPath, folder);
            if (!fs.existsSync(folderPath)) continue;

            const commandFiles = fs.readdirSync(folderPath)
                .filter(file => file.endsWith('.js'));

            for (const file of commandFiles) {
                try {
                    const command = require(path.join(folderPath, file));
                    if (command.data && command.execute) {
                        this.commands.set(command.data.name, command);
                        this.logger.info(`   ✅ Loaded command: ${command.data.name}`);
                    } else {
                        this.logger.warn(`   ⚠️  Command ${file} is missing data or execute function`);
                    }
                } catch (error) {
                    this.logger.error(`   ❌ Failed to load command ${file}:`, error);
                }
            }
        }

        this.logger.info(`📋 Loaded ${this.commands.size} commands`);
    }

    async setupEventHandlers() {
        // Load event handlers from src/core/events/
        const coreEvents = require('./core/events');
        const allEvents = coreEvents.getAllEvents();

        this.logger.info(`📋 Loading ${allEvents.length} event handlers from core/events/`);

        for (const event of allEvents) {
            if (!event || !event.name) continue;

            const handler = async (...args) => {
                try {
                    await event.execute(...args, this);
                } catch (error) {
                    this.logger.error(`Error in event ${event.name}:`, error);
                }
            };

            if (event.once) {
                this.client.once(event.name, handler);
            } else {
                this.client.on(event.name, handler);
            }

            this.logger.debug(`   ✅ Registered event: ${event.name}${event.once ? ' (once)' : ''}`);
        }

        // Process-level error handler (keep in bot.js)
        process.on('unhandledRejection', (error) => {
            this.logger.error('Unhandled promise rejection:', error);
        });

        this.logger.info('✅ Event handlers loaded successfully');
    }

    // NOTE: The following large block of event handler code has been moved to src/core/events/
    // Old inline handlers for: clientReady, interactionCreate, messageCreate, guildMemberAdd,
    // guildCreate, guildMemberRemove, guildMemberUpdate, voiceStateUpdate, messageReactionAdd,
    // messageReactionRemove, roleCreate, roleDelete, channelCreate, channelDelete, guildBanAdd,
    // webhookUpdate, error, warn have been extracted to separate files.

    // =====================================================
    // LEGACY CODE MARKER - Below methods are still needed
    // as they are called BY the extracted event handlers
    // =====================================================

    // The following inline handlers were removed and moved to src/core/events/:
    // - clientReady, interactionCreate, messageCreate, guildMemberAdd, guildCreate,
    // - guildMemberRemove, guildMemberUpdate, voiceStateUpdate, messageReactionAdd,
    // - messageReactionRemove, roleCreate, roleDelete, channelCreate, channelDelete,
    // - guildBanAdd, webhookUpdate, error, warn



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
            const fallbackMap = {
                ticket: 'tickets',
                tix: 'tickets',
                ai: 'ai',
                welcome: 'welcome',
                verify: 'verification',
                ban: 'antinuke',
                kick: 'antinuke',
                timeout: 'antinuke',
                purge: 'antinuke'
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
                        .setTitle('📋 DarkLock Setup Guide')
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
                            { name: '✅ Stay Updated', value: 'Keep DarkLock permissions up to date', inline: false }
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
                    if (this.ticketManager) {
                        await this.ticketManager.handleCreateButton(interaction);
                    }
                    break;

                case 'ticket_claim':
                    if (this.ticketManager) {
                        await this.ticketManager.handleClaim(interaction);
                    }
                    break;

                case 'ticket_close':
                    if (this.ticketManager) {
                        await this.ticketManager.handleClose(interaction);
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
        this.tamperProtection = tamperProtection;
        tamperProtection.attachBot(this);

        // Prevent attempting Discord login with an obviously invalid token
        const token = process.env.DISCORD_TOKEN;
        const tokenLooksValid = token && token.length >= 50 && !token.includes('your_') && !token.includes('paste_');

        if (!tokenLooksValid) {
            this.logger.error('DISCORD_TOKEN appears to be invalid. Aborting login.');
            throw new Error('Invalid DISCORD_TOKEN');
        }

        try {
            console.log('[Tamper] Initializing tamper protection...');
            await tamperProtection.initialize(this);
            await tamperProtection.start(this);
            console.log('[Tamper] Protection active - monitoring protected files');
        } catch (err) {
            console.error('[Tamper] Startup tamper checks failed:', err?.message || err);
            throw err;
        }

        try {
            console.log('[Login] Attempting Discord login...');
            await this.client.login(process.env.DISCORD_TOKEN);
            console.log('[Login] Discord login successful');

            // Start trust recovery background job (runs every 6 hours)
            this.startTrustRecoveryJob();
            console.log('[Login] Trust recovery job scheduled');
        } catch (e) {
            console.error('[Login] Discord login failed:', e?.message || e);
            // Do not exit hard; allow Render to keep service up for dashboard/debugging
        }
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
            const fallbackMap = {
                ticket: 'tickets',
                tix: 'tickets',
                ai: 'ai',
                welcome: 'welcome',
                verify: 'verification',
                ban: 'antinuke',
                kick: 'antinuke',
                timeout: 'antinuke',
                purge: 'antinuke'
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
                        .setTitle('📋 DarkLock Setup Guide')
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
                            { name: '✅ Stay Updated', value: 'Keep DarkLock permissions up to date', inline: false }
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
                    if (this.ticketManager) {
                        await this.ticketManager.handleCreateButton(interaction);
                    }
                    break;

                case 'ticket_claim':
                    if (this.ticketManager) {
                        await this.ticketManager.handleClaim(interaction);
                    }
                    break;

                case 'ticket_close':
                    if (this.ticketManager) {
                        await this.ticketManager.handleClose(interaction);
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
            const fallbackMap = {
                ticket: 'tickets',
                tix: 'tickets',
                ai: 'ai',
                welcome: 'welcome',
                verify: 'verification',
                ban: 'antinuke',
                kick: 'antinuke',
                timeout: 'antinuke',
                purge: 'antinuke'
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
                        .setTitle('📋 DarkLock Setup Guide')
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
                            { name: '✅ Stay Updated', value: 'Keep DarkLock permissions up to date', inline: false }
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
                    if (this.ticketManager) {
                        await this.ticketManager.handleCreateButton(interaction);
                    }
                    break;

                case 'ticket_claim':
                    if (this.ticketManager) {
                        await this.ticketManager.handleClaim(interaction);
                    }
                    break;

                case 'ticket_close':
                    if (this.ticketManager) {
                        await this.ticketManager.handleClose(interaction);
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


    /**
     * Background job: Recover trust scores over time for users without incidents
     * +1 trust every 7 days without incidents, capped at 100
     */
    startTrustRecoveryJob() {
        const RECOVERY_INTERVAL = 6 * 60 * 60 * 1000; // Run every 6 hours
        const DAYS_PER_RECOVERY = 7; // +1 trust per 7 days
        const MAX_TRUST = 100;
        const MIN_TRUST_FOR_RECOVERY = 20; // Don't recover if trust is very low (likely banned/flagged)

        const runRecovery = async () => {
            try {
                this.logger?.info('[TrustRecovery] Starting trust recovery job...');

                // Find users eligible for trust recovery:
                // - Trust < 100 (room to recover)
                // - Trust >= 20 (not severely flagged)
                // - No recent incidents (check mod_actions for warnings/kicks in last 7 days)
                // - Last recovery was > 7 days ago (or never)
                const eligibleUsers = await this.database.all(`
                    SELECT ur.guild_id, ur.user_id, ur.trust_score, ur.last_trust_recovery, ur.manual_override
                    FROM user_records ur
                    WHERE ur.trust_score < ? 
                      AND ur.trust_score >= ?
                      AND (ur.last_trust_recovery IS NULL OR ur.last_trust_recovery < datetime('now', '-${DAYS_PER_RECOVERY} days'))
                      AND NOT EXISTS (
                          SELECT 1 FROM mod_actions ma 
                          WHERE ma.guild_id = ur.guild_id 
                            AND ma.target_user_id = ur.user_id
                            AND ma.action_type IN ('warn', 'kick', 'ban', 'timeout', 'KICK', 'WARN', 'BAN', 'TIMEOUT')
                            AND ma.created_at > datetime('now', '-${DAYS_PER_RECOVERY} days')
                      )
                    LIMIT 500
                `, [MAX_TRUST, MIN_TRUST_FOR_RECOVERY]);

                if (!eligibleUsers || eligibleUsers.length === 0) {
                    this.logger?.debug('[TrustRecovery] No users eligible for trust recovery');
                    return;
                }

                let recovered = 0;
                for (const user of eligibleUsers) {
                    const newTrust = Math.min(user.trust_score + 1, MAX_TRUST);
                    await this.database.run(`
                        UPDATE user_records 
                        SET trust_score = ?, last_trust_recovery = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                        WHERE guild_id = ? AND user_id = ?
                    `, [newTrust, user.guild_id, user.user_id]);
                    recovered++;
                }

                this.logger?.info(`[TrustRecovery] Recovered trust for ${recovered} users`);
            } catch (err) {
                this.logger?.error(`[TrustRecovery] Job failed: ${err.message}`);
            }
        };

        // Run immediately on startup, then every RECOVERY_INTERVAL
        setTimeout(() => runRecovery(), 30000); // 30 seconds after startup
        setInterval(() => runRecovery(), RECOVERY_INTERVAL);
    }

    // Feature gating utilities (see isFeatureBlocked above)

    async isFeatureEnabledForGuild(guildId, feature) {
        const cfg = await this.database.getGuildConfig(guildId);
        if (feature === 'ai') return !!cfg.ai_enabled;
        if (feature === 'tickets') return !!cfg.tickets_enabled;
        if (feature === 'welcome') return !!cfg.welcome_enabled;
        if (feature === 'verification') return !!cfg.verification_enabled;
        if (feature === 'antinuke') return !!cfg.antinuke_enabled;
        if (feature === 'antispam') return !!cfg.anti_spam_enabled;
        if (feature === 'antiraid') return !!cfg.anti_raid_enabled;
        if (feature === 'antiphishing') return !!cfg.anti_phishing_enabled;
        if (feature === 'automod') return !!cfg.auto_mod_enabled;
        if (feature === 'autorole') return !!cfg.autorole_enabled;
        return true;
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
        // Paywall disabled: treat all guilds as having Pro features
        return true;
    }

    async hasEnterpriseFeatures(guildId) {
        // Paywall disabled: treat all guilds as having Enterprise features
        return true;
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

    async gracefulShutdown(signal) {
        console.log(`\n🛑 Received ${signal} - Starting graceful shutdown...`);

        try {
            // Close dashboard server
            if (this.dashboard && this.dashboard.server) {
                await new Promise((resolve) => {
                    this.dashboard.server.close(() => {
                        console.log('✅ Dashboard server closed');
                        resolve();
                    });
                });
            }

            // Close database connections
            if (this.database) {
                await this.database.close();
                console.log('✅ Database connections closed');
            }

            // Destroy Discord client
            this.client.destroy();
            console.log('✅ Discord client destroyed');

            console.log('✅ Graceful shutdown complete');
            process.exit(0);
        } catch (error) {
            console.error('❌ Error during graceful shutdown:', error);
            process.exit(1);
        }
    }

    async shutdown() {
        if (this.logger && typeof this.logger.info === 'function') {
            this.logger.info('🔄 Shutting down bot...');
        } else {
            console.log('🔄 Shutting down bot...');
        }

        if (this.dashboard && this.dashboard.server) {
            try {
                this.dashboard.server.close(() => {
                    if (this.logger && typeof this.logger.info === 'function') {
                        this.logger.info('Dashboard shutdown complete');
                    } else {
                        console.log('Dashboard shutdown complete');
                    }
                });
            } catch (error) {
                if (this.logger && typeof this.logger.warn === 'function') {
                    this.logger.warn('Dashboard shutdown error:', error.message);
                } else {
                    console.warn('Dashboard shutdown error:', error.message);
                }
            }
        }

        if (this.database) {
            await this.database.close();
        }

        this.client.destroy();
        
        if (this.logger && typeof this.logger.info === 'function') {
            this.logger.info('✅ Bot shutdown complete');
        } else {
            console.log('✅ Bot shutdown complete');
        }
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
        return interactionHandlers.handleRoleCreate(role, this);
    }

    async handleRoleDelete(role) {
        return interactionHandlers.handleRoleDelete(role, this);
    }

    async handleChannelCreate(channel) {
        return interactionHandlers.handleChannelCreate(channel, this);
    }

    async handleChannelDelete(channel) {
        return interactionHandlers.handleChannelDelete(channel, this);
    }

    async handleBanAdd(ban) {
        return interactionHandlers.handleBanAdd(ban, this);
    }

    async handleWebhookUpdate(channel) {
        return interactionHandlers.handleWebhookUpdate(channel, this);
    }

    // Handle channel-based ticket creation
    async handleTicketCreate(interaction) {
        return interactionHandlers.handleTicketCreate(interaction, this);
    }

    // Handle ticket close
    async handleTicketClose(interaction) {
        return interactionHandlers.handleTicketClose(interaction, this);
    }

    async handleTicketCreateModal(interaction) {
        return interactionHandlers.handleTicketCreateModal(interaction, this);
    }

    async handleTicketSubmit(interaction) {
        return interactionHandlers.handleTicketSubmit(interaction, this);
    }

    async handleTicketClaim(interaction) {
        return interactionHandlers.handleTicketClaim(interaction, this);
    }

    async handleHelpModal(interaction) {
        return interactionHandlers.handleHelpModal(interaction, this);
    }

    async handleHelpTicketModal(interaction) {
        return interactionHandlers.handleHelpTicketModal(interaction, this);
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






