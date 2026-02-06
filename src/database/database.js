const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        this.db = null;
        this.dbPath = path.join(process.env.DB_PATH || './data/', process.env.DB_NAME || 'security_bot.db');
        
        // Config caching system
        this.configCache = new Map();
        this.cacheExpiry = new Map();
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes default TTL
    }

    async initialize() {
        // Ensure data directory exists
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Check if this is a fresh database
        const isFreshDb = !fs.existsSync(this.dbPath);
        if (isFreshDb) {
            console.log('⚠️  Starting with fresh database. Consider setting up a persistent volume to prevent data loss.');
        }

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, async (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('📊 Connected to SQLite database at:', this.dbPath);
                    await this.createTables();
                    await this.runMigrations();
                    // Verify data integrity
                    await this.verifyDataIntegrity();
                    resolve();
                }
            });
        });
    }

    async verifyDataIntegrity() {
        try {
            const subCount = await this.get('SELECT COUNT(*) as count FROM guild_subscriptions');
            const configCount = await this.get('SELECT COUNT(*) as count FROM guild_configs');
            console.log(`✅ Database integrity check: ${subCount?.count || 0} subscriptions, ${configCount?.count || 0} configs`);
        } catch (e) {
            console.warn('⚠️  Could not verify data integrity:', e.message);
        }
    }

    // Allow the bot to attach itself so DB can emit setting change events
    attachBot(bot) {
        this.bot = bot;
    }

    async runMigrations() {
        try {
            console.log('🔄 Running database migrations...');
            
            // Migration 1: Add subject, description, last_message_at to tickets table
            try {
                await this.run(`ALTER TABLE tickets ADD COLUMN subject TEXT`);
                console.log('✅ Added subject column to tickets');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE tickets ADD COLUMN description TEXT`);
                console.log('✅ Added description column to tickets');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE tickets ADD COLUMN last_message_at DATETIME`);
                console.log('✅ Added last_message_at column to tickets');
            } catch (e) {
                // Column already exists
            }
            
            // Migration 2: Add subject, description, last_message_at to active_tickets table
            try {
                await this.run(`ALTER TABLE active_tickets ADD COLUMN subject TEXT`);
                console.log('✅ Added subject column to active_tickets');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE active_tickets ADD COLUMN description TEXT`);
                console.log('✅ Added description column to active_tickets');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE active_tickets ADD COLUMN last_message_at DATETIME`);
                console.log('✅ Added last_message_at column to active_tickets');
            } catch (e) {
                // Column already exists
            }
            
            // Migration 3: Add bot settings columns to guild_settings table
            try {
                await this.run(`ALTER TABLE guild_settings ADD COLUMN mod_role_id TEXT`);
                console.log('✅ Added mod_role_id column to guild_settings');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE guild_settings ADD COLUMN admin_role_id TEXT`);
                console.log('✅ Added admin_role_id column to guild_settings');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE guild_settings ADD COLUMN ticket_category TEXT`);
                console.log('✅ Added ticket_category column to guild_settings');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE guild_settings ADD COLUMN ticket_panel_channel TEXT`);
                console.log('✅ Added ticket_panel_channel column to guild_settings');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE guild_settings ADD COLUMN ticket_transcript_channel TEXT`);
                console.log('✅ Added ticket_transcript_channel column to guild_settings');
            } catch (e) {
                // Column already exists
            }
            
            // Migration 4: Add anti-nuke columns to guild_configs
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN antinuke_enabled BOOLEAN DEFAULT 0`);
                console.log('✅ Added antinuke_enabled column to guild_configs');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN antinuke_role_limit INTEGER DEFAULT 3`);
                console.log('✅ Added antinuke_role_limit column to guild_configs');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN antinuke_channel_limit INTEGER DEFAULT 3`);
                console.log('✅ Added antinuke_channel_limit column to guild_configs');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN antinuke_ban_limit INTEGER DEFAULT 5`);
                console.log('✅ Added antinuke_ban_limit column to guild_configs');
            } catch (e) {
                // Column already exists
            }
            
            // Migration 5: Add goodbye system columns
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN goodbye_enabled BOOLEAN DEFAULT 0`);
                console.log('✅ Added goodbye_enabled column to guild_configs');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN goodbye_channel TEXT`);
                console.log('✅ Added goodbye_channel column to guild_configs');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN goodbye_message TEXT DEFAULT 'Goodbye {user}, thanks for being part of {server}!'`);
                console.log('✅ Added goodbye_message column to guild_configs');
            } catch (e) {
                // Column already exists
            }
            
            // Migration 6: Add action column to mod_actions for dashboard compatibility
            try {
                await this.run(`ALTER TABLE mod_actions ADD COLUMN action TEXT`);
                console.log('✅ Added action column to mod_actions');
                // Populate action column from action_type for existing records
                await this.run(`UPDATE mod_actions SET action = action_type WHERE action IS NULL`);
                console.log('✅ Populated action column from action_type');
            } catch (e) {
                // Column already exists
            }
            
            // Migration 7: Add ai_enabled column to guild_configs
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN ai_enabled BOOLEAN DEFAULT 1`);
                console.log('✅ Added ai_enabled column to guild_configs');
            } catch (e) {
                // Column already exists
            }
            
            // Migration 8: Add target_tag to mod_actions
            try {
                await this.run(`ALTER TABLE mod_actions ADD COLUMN target_tag TEXT`);
                console.log('✅ Added target_tag column to mod_actions');
            } catch (e) {
                // Column already exists
            }
            
            // Migration 9: Add ticket_staff_role to guild_configs
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN ticket_staff_role TEXT`);
                console.log('✅ Added ticket_staff_role column to guild_configs');
            } catch (e) {
                // Column already exists
            }
            
            // Migration 10: Add details column to security_logs
            try {
                await this.run(`ALTER TABLE security_logs ADD COLUMN details TEXT`);
                console.log('✅ Added details column to security_logs');
            } catch (e) {
                // Column already exists
            }
            
            // Migration 11: Add moderator_tag to mod_actions if not exists
            try {
                await this.run(`ALTER TABLE mod_actions ADD COLUMN moderator_tag TEXT`);
                console.log('✅ Added moderator_tag column to mod_actions');
            } catch (e) {
                // Column already exists
            }
            
            // Migration 12: Add ticket_channel_id and ticket_category_id for channel-based tickets
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN ticket_channel_id TEXT`);
                console.log('✅ Added ticket_channel_id column to guild_configs');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN ticket_category_id TEXT`);
                console.log('✅ Added ticket_category_id column to guild_configs');
            } catch (e) {
                // Column already exists
            }
            
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN ticket_manage_role TEXT`);
                console.log('✅ Added ticket_manage_role column to guild_configs');
            } catch (e) {
                // Column already exists
            }

            // Migration 13: Add ticket_log_channel for ticket notifications
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN ticket_log_channel TEXT`);
                console.log('✅ Added ticket_log_channel column to guild_configs');
            } catch (e) {
                // Column already exists
            }

            // Migration 14: Add ticket_id and assigned_to columns to active_tickets
            try {
                await this.run(`ALTER TABLE active_tickets ADD COLUMN ticket_id TEXT`);
                console.log('✅ Added ticket_id column to active_tickets');
            } catch (e) {
                // Column already exists
            }

            try {
                await this.run(`ALTER TABLE active_tickets ADD COLUMN assigned_to TEXT`);
                console.log('✅ Added assigned_to column to active_tickets');
            } catch (e) {
                // Column already exists
            }

            // Migration 16: Add shared access tables for dashboard authorization
            try {
                await this.run(`
                    CREATE TABLE IF NOT EXISTS dashboard_access (
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        granted_by TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (guild_id, user_id)
                    )
                `);
                console.log('✅ Created dashboard_access table');
            } catch (e) {
                // Table already exists
            }

            try {
                await this.run(`
                    CREATE TABLE IF NOT EXISTS dashboard_role_access (
                        guild_id TEXT NOT NULL,
                        role_id TEXT NOT NULL,
                        granted_by TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (guild_id, role_id)
                    )
                `);
                console.log('✅ Created dashboard_role_access table');
            } catch (e) {
                // Table already exists
            }

            try {
                await this.run(`
                    CREATE TABLE IF NOT EXISTS dashboard_access_codes (
                        code TEXT PRIMARY KEY,
                        guild_id TEXT NOT NULL,
                        expires_at DATETIME NOT NULL,
                        created_by TEXT,
                        redeemed_by TEXT,
                        redeemed_at DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                console.log('✅ Created dashboard_access_codes table');
            } catch (e) {
                // Table already exists
            }

            // Migration 15: Add ticket_id column to tickets and ticket_transcripts for consistency
            try {
                await this.run(`ALTER TABLE tickets ADD COLUMN ticket_id TEXT`);
                console.log('✅ Added ticket_id column to tickets');
            } catch (e) {
                // Column already exists
            }

            try {
                await this.run(`ALTER TABLE ticket_transcripts ADD COLUMN ticket_id TEXT`);
                console.log('✅ Added ticket_id column to ticket_transcripts');
            } catch (e) {
                // Column already exists
            }

            // Migration 16: Add comprehensive audit logging columns
            try {
                await this.run(`ALTER TABLE security_logs ADD COLUMN action TEXT`);
                console.log('✅ Added action column to security_logs');
            } catch (e) {}

            try {
                await this.run(`ALTER TABLE security_logs ADD COLUMN target_id TEXT`);
                console.log('✅ Added target_id column to security_logs');
            } catch (e) {}

            try {
                await this.run(`ALTER TABLE security_logs ADD COLUMN before_data TEXT`);
                console.log('✅ Added before_data column to security_logs');
            } catch (e) {}

            try {
                await this.run(`ALTER TABLE security_logs ADD COLUMN after_data TEXT`);
                console.log('✅ Added after_data column to security_logs');
            } catch (e) {}

            // Migration 17: Add verification system enhancements
            try {
                await this.run(`ALTER TABLE verification_queue ADD COLUMN risk_score INTEGER DEFAULT 50`);
                console.log('✅ Added risk_score to verification_queue');
            } catch (e) {}

            try {
                await this.run(`ALTER TABLE verification_queue ADD COLUMN device_fingerprint TEXT`);
                console.log('✅ Added device_fingerprint to verification_queue');
            } catch (e) {}

            try {
                await this.run(`ALTER TABLE verification_queue ADD COLUMN ip_hash TEXT`);
                console.log('✅ Added ip_hash to verification_queue');
            } catch (e) {}

            // Migration: Ensure verification columns exist on guild_configs
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_method TEXT`);
                console.log('✅ Added verification_method to guild_configs');
            } catch (e) {
                // Column may already exist
            }
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN unverified_role_id TEXT`);
                console.log('✅ Added unverified_role_id to guild_configs');
            } catch (e) {
                // Column may already exist
            }
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN verified_role_id TEXT`);
                console.log('✅ Added verified_role_id to guild_configs');
            } catch (e) {
                // Column may already exist
            }
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN mod_log_channel TEXT`);
                console.log('✅ Added mod_log_channel to guild_configs');
            } catch (e) {
                // Column may already exist
            }
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_channel_id TEXT`);
                console.log('✅ Added verification_channel_id to guild_configs');
            } catch (e) {
                // Column may already exist
            }

            // Migration 18: Add user_records risk and behavior tracking
            try {
                await this.run(`ALTER TABLE user_records ADD COLUMN risk_score INTEGER DEFAULT 50`);
                console.log('✅ Added risk_score to user_records');
            } catch (e) {}

            try {
                await this.run(`ALTER TABLE user_records ADD COLUMN behavior_score INTEGER DEFAULT 50`);
                console.log('✅ Added behavior_score to user_records');
            } catch (e) {}

            try {
                await this.run(`ALTER TABLE user_records ADD COLUMN pattern_flags TEXT DEFAULT '[]'`);
                console.log('✅ Added pattern_flags to user_records');
            } catch (e) {}

            // Migration 19: Add staff security enhancements
            try {
                await this.run(`ALTER TABLE mod_actions ADD COLUMN requires_2fa INTEGER DEFAULT 0`);
                console.log('✅ Added requires_2fa to mod_actions');
            } catch (e) {}

            try {
                await this.run(`ALTER TABLE mod_actions ADD COLUMN confirmed INTEGER DEFAULT 0`);
                console.log('✅ Added confirmed to mod_actions');
            } catch (e) {}

            try {
                await this.run(`ALTER TABLE mod_actions ADD COLUMN device_fingerprint TEXT`);
                console.log('✅ Added device_fingerprint to mod_actions');
            } catch (e) {}
            
            // Migration 20: Ensure user_records has avatar_url column
            try {
                await this.run(`ALTER TABLE user_records ADD COLUMN avatar_url TEXT`);
                console.log('✅ Added avatar_url to user_records');
            } catch (e) {
                // Column may already exist
            }
            
            // Migration 21: Ensure security_logs has event_type column
            try {
                await this.run(`ALTER TABLE security_logs ADD COLUMN event_type TEXT`);
                console.log('✅ Added event_type to security_logs');
            } catch (e) {
                // Column may already exist
            }
            
            // Migration XX: Ensure verification-related guild config columns exist
            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_timeout_minutes INTEGER DEFAULT 10`);
                console.log('✅ Added verification_timeout_minutes to guild_configs');
            } catch (e) {
                // Column may already exist
            }

            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN captcha_mode TEXT DEFAULT 'code'`);
                console.log("✅ Added captcha_mode to guild_configs");
            } catch (e) {
                // Column may already exist
            }

            try {
                await this.run(`ALTER TABLE guild_configs ADD COLUMN verified_welcome_message TEXT DEFAULT 'Welcome {user} to {server}!'`);
                console.log('✅ Ensured verified_welcome_message exists in guild_configs');
            } catch (e) {
                // Column may already exist
            }

            // Verification system columns for enterprise module
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_profile TEXT DEFAULT 'standard'`); console.log('✅ Added verification_profile'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN enable_queue INTEGER DEFAULT 1`); console.log('✅ Added enable_queue'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN enable_ai_scan INTEGER DEFAULT 0`); console.log('✅ Added enable_ai_scan'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN enable_dashboard_buttons INTEGER DEFAULT 1`); console.log('✅ Added enable_dashboard_buttons'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN enable_staff_dm INTEGER DEFAULT 1`); console.log('✅ Added enable_staff_dm'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_language TEXT DEFAULT 'en'`); console.log('✅ Added verification_language'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN auto_kick_on_timeout INTEGER DEFAULT 0`); console.log('✅ Added auto_kick_on_timeout'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_min_account_age_days INTEGER DEFAULT 7`); console.log('✅ Added verification_min_account_age_days'); } catch (e) {}
            
            // Advanced Verification Settings (Dashboard Settings Tab)
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_dm_message TEXT`); console.log('✅ Added verification_dm_message'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_expiration INTEGER DEFAULT 10`); console.log('✅ Added verification_expiration'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_max_attempts INTEGER DEFAULT 3`); console.log('✅ Added verification_max_attempts'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_cooldown INTEGER DEFAULT 30`); console.log('✅ Added verification_cooldown'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_fail_action TEXT DEFAULT 'nothing'`); console.log('✅ Added verification_fail_action'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_require_captcha INTEGER DEFAULT 0`); console.log('✅ Added verification_require_captcha'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN verification_log_attempts INTEGER DEFAULT 0`); console.log('✅ Added verification_log_attempts'); } catch (e) {}
            
            // Advanced Settings - Anti-Raid
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN raid_action TEXT DEFAULT 'kick'`); console.log('✅ Added raid_action'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN raid_timeout_minutes INTEGER DEFAULT 10`); console.log('✅ Added raid_timeout_minutes'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN raid_dm_notify INTEGER DEFAULT 1`); console.log('✅ Added raid_dm_notify'); } catch (e) {}
            
            // Advanced Settings - Anti-Spam
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN spam_timeout_seconds INTEGER DEFAULT 30`); console.log('✅ Added spam_timeout_seconds'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN spam_delete_messages INTEGER DEFAULT 1`); console.log('✅ Added spam_delete_messages'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN spam_mute_duration INTEGER DEFAULT 300`); console.log('✅ Added spam_mute_duration'); } catch (e) {}
            
            // Advanced Settings - Anti-Phishing
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN phishing_check_links INTEGER DEFAULT 1`); console.log('✅ Added phishing_check_links'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN phishing_delete_messages INTEGER DEFAULT 1`); console.log('✅ Added phishing_delete_messages'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN phishing_ban_user INTEGER DEFAULT 0`); console.log('✅ Added phishing_ban_user'); } catch (e) {}
            
            // Advanced Settings - Anti-Nuke
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN antinuke_auto_ban INTEGER DEFAULT 1`); console.log('✅ Added antinuke_auto_ban'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN antinuke_reverse_actions INTEGER DEFAULT 1`); console.log('✅ Added antinuke_reverse_actions'); } catch (e) {}
            
            // Advanced Settings - Welcome
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN welcome_embed_enabled INTEGER DEFAULT 1`); console.log('✅ Added welcome_embed_enabled'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN welcome_ping_user INTEGER DEFAULT 0`); console.log('✅ Added welcome_ping_user'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN welcome_delete_after INTEGER DEFAULT 0`); console.log('✅ Added welcome_delete_after'); } catch (e) {}
            
            // Advanced Settings - Tickets
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN ticket_max_open INTEGER DEFAULT 3`); console.log('✅ Added ticket_max_open'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN ticket_transcript_enabled INTEGER DEFAULT 1`); console.log('✅ Added ticket_transcript_enabled'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN ticket_rating_enabled INTEGER DEFAULT 1`); console.log('✅ Added ticket_rating_enabled'); } catch (e) {}
            
            // Advanced Settings - Auto-Mod
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN automod_toxicity_threshold REAL DEFAULT 0.8`); console.log('✅ Added automod_toxicity_threshold'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN automod_caps_percentage INTEGER DEFAULT 70`); console.log('✅ Added automod_caps_percentage'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN automod_emoji_limit INTEGER DEFAULT 10`); console.log('✅ Added automod_emoji_limit'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN automod_mention_limit INTEGER DEFAULT 5`); console.log('✅ Added automod_mention_limit'); } catch (e) {}
            
            // Advanced Settings - Auto-Role
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN autorole_delay_seconds INTEGER DEFAULT 5`); console.log('✅ Added autorole_delay_seconds'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN autorole_remove_on_leave INTEGER DEFAULT 1`); console.log('✅ Added autorole_remove_on_leave'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN autorole_bypass_bots INTEGER DEFAULT 1`); console.log('✅ Added autorole_bypass_bots'); } catch (e) {}
            
            // XP/Leveling System Settings
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN xp_enabled BOOLEAN DEFAULT 0`); console.log('✅ Added xp_enabled'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN xp_message INTEGER DEFAULT 20`); console.log('✅ Added xp_message'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN xp_voice INTEGER DEFAULT 10`); console.log('✅ Added xp_voice'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN xp_cooldown INTEGER DEFAULT 60`); console.log('✅ Added xp_cooldown'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN xp_levelup_channel TEXT`); console.log('✅ Added xp_levelup_channel'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN xp_levelup_message TEXT DEFAULT 'Congratulations {user}! You''ve reached **Level {level}**!'`); console.log('✅ Added xp_levelup_message'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN xp_levelup_embed_color TEXT DEFAULT '#00ff41'`); console.log('✅ Added xp_levelup_embed_color'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN xp_levelup_title TEXT DEFAULT '🎉 Level Up!'`); console.log('✅ Added xp_levelup_title'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN xp_levelup_show_xp BOOLEAN DEFAULT 1`); console.log('✅ Added xp_levelup_show_xp'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN xp_levelup_show_messages BOOLEAN DEFAULT 1`); console.log('✅ Added xp_levelup_show_messages'); } catch (e) {}
            
            // Migration (Notes system): add notes column to verification_records
            try { await this.run(`ALTER TABLE verification_records ADD COLUMN notes TEXT`); console.log('✅ Added notes column to verification_records'); } catch (e) { /* already exists */ }

                // Customization flags
                try { await this.run(`ALTER TABLE guild_configs ADD COLUMN custom_verification_message TEXT`); console.log('✅ Added custom_verification_message'); } catch (e) {}
                try { await this.run(`ALTER TABLE guild_configs ADD COLUMN ticket_theme TEXT`); console.log('✅ Added ticket_theme'); } catch (e) {}
                try { await this.run(`ALTER TABLE guild_configs ADD COLUMN dashboard_theme TEXT`); console.log('✅ Added dashboard_theme'); } catch (e) {}
                try { await this.run(`ALTER TABLE guild_configs ADD COLUMN ai_personality TEXT`); console.log('✅ Added ai_personality'); } catch (e) {}
                try { await this.run(`ALTER TABLE guild_configs ADD COLUMN workflow_rules TEXT DEFAULT '{}'`); console.log('✅ Added workflow_rules'); } catch (e) {}

            // Activation codes table
            try {
                await this.run(`CREATE TABLE IF NOT EXISTS activation_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT NOT NULL,
                    code TEXT NOT NULL,
                    used INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    used_at DATETIME,
                    paypal_order_id TEXT
                )`);
                console.log('✅ Ensured activation_codes table exists');
            } catch (e) {}

            // Users table (minimal for Pro gating)
            try {
                await this.run(`CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT,
                    is_pro INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);
                console.log('✅ Ensured users table exists');
            } catch (e) {}

            // Pro codes table for pro plan unlock codes
            try {
                await this.run(`CREATE TABLE IF NOT EXISTS pro_codes (
                    code TEXT PRIMARY KEY,
                    created_by TEXT NOT NULL,
                    duration_days INTEGER DEFAULT 30,
                    max_uses INTEGER DEFAULT 1,
                    current_uses INTEGER DEFAULT 0,
                    description TEXT,
                    expires_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_used_at DATETIME,
                    status TEXT DEFAULT 'active'
                )`);
                console.log('✅ Ensured pro_codes table exists');
            } catch (e) {}

            // Pro redemptions tracking table
            try {
                await this.run(`CREATE TABLE IF NOT EXISTS pro_redemptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    guild_id TEXT,
                    redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(code) REFERENCES pro_codes(code)
                )`);
                console.log('✅ Ensured pro_redemptions table exists');
            } catch (e) {}

            // Migration: relax NOT NULL on pro_redemptions.guild_id without losing data
            try {
                const columns = await this.all(`PRAGMA table_info(pro_redemptions)`);
                const guildCol = (columns || []).find(c => c.name === 'guild_id');
                if (guildCol && guildCol.notnull === 1) {
                    console.log('⚙️  Migrating pro_redemptions.guild_id to allow NULL...');
                    await this.run('BEGIN TRANSACTION');
                    await this.run(`CREATE TABLE IF NOT EXISTS pro_redemptions_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        code TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        guild_id TEXT,
                        redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(code) REFERENCES pro_codes(code)
                    )`);
                    await this.run(`INSERT INTO pro_redemptions_new (id, code, user_id, guild_id, redeemed_at)
                                     SELECT id, code, user_id, guild_id, redeemed_at FROM pro_redemptions`);
                    await this.run(`DROP TABLE pro_redemptions`);
                    await this.run(`ALTER TABLE pro_redemptions_new RENAME TO pro_redemptions`);
                    await this.run('COMMIT');
                    console.log('✅ Migrated pro_redemptions.guild_id to be nullable');
                }
            } catch (e) {
                await this.run('ROLLBACK').catch(() => {});
                console.warn('⚠️  Migration skipped: unable to relax pro_redemptions.guild_id constraint', e.message || e);
            }

            // Add pro plan columns to guild_configs if needed
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN pro_enabled INTEGER DEFAULT 0`); console.log('✅ Added pro_enabled'); } catch (e) {}
            try { await this.run(`ALTER TABLE guild_configs ADD COLUMN pro_expires_at DATETIME`); console.log('✅ Added pro_expires_at'); } catch (e) {}
            
            console.log('✅ Database migrations complete');
        } catch (error) {
            console.error('⚠️ Migration error:', error);
        }
    }

    async createTables() {
        const tables = [
            // Guild configurations
            `CREATE TABLE IF NOT EXISTS guild_configs (
                guild_id TEXT PRIMARY KEY,
                anti_raid_enabled BOOLEAN DEFAULT 1,
                anti_spam_enabled BOOLEAN DEFAULT 1,
                anti_links_enabled BOOLEAN DEFAULT 1,
                anti_phishing_enabled BOOLEAN DEFAULT 1,
                verification_enabled BOOLEAN DEFAULT 1,
                welcome_enabled BOOLEAN DEFAULT 0,
                verification_channel_id TEXT,
                logs_channel_id TEXT,
                unverified_role_id TEXT,
                verified_role_id TEXT,
                verified_welcome_channel_id TEXT,
                verified_welcome_message TEXT,
                verification_method TEXT,
                manual_approval_enabled BOOLEAN DEFAULT 1,
                auto_kick_unverified INTEGER DEFAULT 0,
                antinuke_enabled BOOLEAN DEFAULT 0,
                antinuke_role_limit INTEGER DEFAULT 3,
                antinuke_channel_limit INTEGER DEFAULT 3,
                antinuke_ban_limit INTEGER DEFAULT 5,
                log_channel_id TEXT,
                mod_role_id TEXT,
                admin_role_id TEXT,
                raid_threshold INTEGER DEFAULT 10,
                spam_threshold INTEGER DEFAULT 5,
                account_age_hours INTEGER DEFAULT 24,
                verification_level INTEGER DEFAULT 1,
                alert_channel TEXT,
                antiraid_enabled BOOLEAN DEFAULT 1,
                antispam_enabled BOOLEAN DEFAULT 1,
                antiphishing_enabled BOOLEAN DEFAULT 1,
                tickets_enabled BOOLEAN DEFAULT 0,
                ticket_category TEXT,
                ticket_panel_channel TEXT,
                ticket_transcript_channel TEXT,
                ticket_support_roles TEXT DEFAULT '[]',
                ticket_welcome_message TEXT DEFAULT 'Thank you for creating a ticket!',
                ticket_categories TEXT DEFAULT '["General Support","Technical Issue","Billing","Report User","Other"]',
                ticket_autoclose BOOLEAN DEFAULT 0,
                ticket_autoclose_hours INTEGER DEFAULT 48,
                mod_log_channel TEXT,
                auto_mod_enabled BOOLEAN DEFAULT 0,
                dm_on_warn BOOLEAN DEFAULT 1,
                dm_on_kick BOOLEAN DEFAULT 1,
                dm_on_ban BOOLEAN DEFAULT 1,
                max_warnings INTEGER DEFAULT 3,
                warning_action TEXT DEFAULT 'timeout',
                autorole_enabled BOOLEAN DEFAULT 0,
                reactionroles_enabled BOOLEAN DEFAULT 0,
                welcome_channel TEXT,
                welcome_message TEXT DEFAULT 'Welcome {user} to {server}!',
                verification_role TEXT,
                mod_perm_tickets BOOLEAN DEFAULT 0,
                mod_perm_analytics BOOLEAN DEFAULT 0,
                mod_perm_security BOOLEAN DEFAULT 0,
                mod_perm_overview BOOLEAN DEFAULT 0,
                mod_perm_customize BOOLEAN DEFAULT 0,
                admin_perm_tickets BOOLEAN DEFAULT 1,
                admin_perm_analytics BOOLEAN DEFAULT 1,
                admin_perm_security BOOLEAN DEFAULT 1,
                admin_perm_overview BOOLEAN DEFAULT 1,
                admin_perm_customize BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Guild subscription and billing state
            `CREATE TABLE IF NOT EXISTS guild_subscriptions (
                guild_id TEXT PRIMARY KEY,
                plan TEXT NOT NULL DEFAULT 'free',
                status TEXT NOT NULL DEFAULT 'inactive',
                current_period_end INTEGER,
                stripe_customer_id TEXT,
                stripe_subscription_id TEXT
            )`,

            // Security incidents
            `CREATE TABLE IF NOT EXISTS security_incidents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                incident_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                user_id TEXT,
                channel_id TEXT,
                description TEXT,
                data TEXT,
                resolved BOOLEAN DEFAULT 0,
                resolved_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                resolved_at DATETIME
            )`,

            // User records and behavior tracking
            `CREATE TABLE IF NOT EXISTS user_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                username TEXT,
                discriminator TEXT,
                avatar_url TEXT,
                join_date DATETIME,
                account_created DATETIME,
                verification_status TEXT DEFAULT 'unverified',
                trust_score INTEGER DEFAULT 50,
                warning_count INTEGER DEFAULT 0,
                last_activity DATETIME,
                flags TEXT,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )`,

            // Message logs
            `CREATE TABLE IF NOT EXISTS message_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                content TEXT,
                attachments TEXT,
                embeds TEXT,
                deleted BOOLEAN DEFAULT 0,
                edited BOOLEAN DEFAULT 0,
                flagged BOOLEAN DEFAULT 0,
                flag_reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                deleted_at DATETIME,
                edited_at DATETIME
            )`,

            // Moderation actions
            `CREATE TABLE IF NOT EXISTS mod_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                target_user_id TEXT NOT NULL,
                moderator_id TEXT,
                reason TEXT,
                duration INTEGER,
                active BOOLEAN DEFAULT 1,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Raid detection data
            `CREATE TABLE IF NOT EXISTS raid_detection (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                user_count INTEGER,
                time_window INTEGER,
                pattern_type TEXT,
                handled BOOLEAN DEFAULT 0,
                lockdown_activated BOOLEAN DEFAULT 0,
                user_ids TEXT
            )`,

            // Spam detection
            `CREATE TABLE IF NOT EXISTS spam_detection (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                spam_type TEXT NOT NULL,
                message_count INTEGER,
                time_window INTEGER,
                content_sample TEXT,
                handled BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Malicious links
            `CREATE TABLE IF NOT EXISTS malicious_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT UNIQUE,
                threat_type TEXT,
                severity INTEGER,
                source TEXT,
                verified BOOLEAN DEFAULT 0,
                whitelisted BOOLEAN DEFAULT 0,
                last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Role changes audit
            `CREATE TABLE IF NOT EXISTS role_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                role_id TEXT NOT NULL,
                role_name TEXT,
                change_type TEXT NOT NULL,
                permissions_before TEXT,
                permissions_after TEXT,
                changed_by TEXT,
                dangerous_permission BOOLEAN DEFAULT 0,
                approved BOOLEAN DEFAULT 0,
                approved_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Channel protection
            `CREATE TABLE IF NOT EXISTS channel_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                channel_name TEXT,
                action_type TEXT NOT NULL,
                permissions_before TEXT,
                permissions_after TEXT,
                changed_by TEXT,
                restored BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Server backups
            `CREATE TABLE IF NOT EXISTS server_backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                backup_type TEXT NOT NULL,
                backup_data TEXT,
                file_path TEXT,
                size_bytes INTEGER,
                created_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Enhanced Security Tables
            `CREATE TABLE IF NOT EXISTS guild_security (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                settings TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id)
            )`,
            
            `CREATE TABLE IF NOT EXISTS security_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                incident_type TEXT,
                user_id TEXT,
                channel_id TEXT,
                description TEXT NOT NULL,
                severity TEXT DEFAULT 'medium',
                action_taken TEXT,
                evidence TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            // Settings history for rollback and auditing
            `CREATE TABLE IF NOT EXISTS settings_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                user_id TEXT,
                setting_key TEXT,
                old_value TEXT,
                new_value TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Analytics Tables
            `CREATE TABLE IF NOT EXISTS message_analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_count INTEGER DEFAULT 0,
                character_count INTEGER DEFAULT 0,
                hour_of_day INTEGER NOT NULL,
                date DATE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id, channel_id, date, hour_of_day)
            )`,
            
            `CREATE TABLE IF NOT EXISTS command_analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                command_name TEXT NOT NULL,
                success INTEGER DEFAULT 1,
                response_time INTEGER DEFAULT 0,
                date DATE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS join_analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                account_age_days INTEGER NOT NULL,
                invite_code TEXT,
                date DATE NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS leave_analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                stay_duration_hours INTEGER NOT NULL,
                date DATE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS reaction_analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                emoji TEXT NOT NULL,
                reaction_type TEXT NOT NULL,
                date DATE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS voice_analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                action TEXT NOT NULL,
                date DATE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS bot_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                memory_used_mb INTEGER NOT NULL,
                memory_total_mb INTEGER NOT NULL,
                cpu_usage REAL NOT NULL,
                uptime_seconds INTEGER NOT NULL,
                guild_count INTEGER NOT NULL,
                user_count INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Enhanced Ticket System
            `CREATE TABLE IF NOT EXISTS ticket_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                emoji TEXT DEFAULT '🎫',
                staff_role_id TEXT,
                priority TEXT DEFAULT 'medium',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, name)
            )`,
            
            `CREATE TABLE IF NOT EXISTS ticket_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                message_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                avatar_url TEXT,
                content TEXT NOT NULL,
                attachments TEXT,
                embeds TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(ticket_id) REFERENCES active_tickets(id)
            )`,
            
            // Settings and Configuration
            `CREATE TABLE IF NOT EXISTS guild_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL UNIQUE,
                prefix TEXT DEFAULT '!',
                language TEXT DEFAULT 'en',
                timezone TEXT DEFAULT 'UTC',
                welcome_enabled INTEGER DEFAULT 0,
                welcome_channel_id TEXT,
                welcome_message TEXT,
                leave_enabled INTEGER DEFAULT 0,
                leave_channel_id TEXT,
                leave_message TEXT,
                automod_enabled INTEGER DEFAULT 1,
                logging_enabled INTEGER DEFAULT 1,
                log_channel_id TEXT,
                settings_json TEXT DEFAULT '{}',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS user_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                dm_notifications INTEGER DEFAULT 1,
                language TEXT DEFAULT 'en',
                timezone TEXT,
                preferences_json TEXT DEFAULT '{}',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, guild_id)
            )`,
            
            // Setup and Onboarding
            `CREATE TABLE IF NOT EXISTS setup_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                step_name TEXT NOT NULL,
                completed INTEGER DEFAULT 0,
                data_json TEXT,
                completed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, step_name)
            )`,
            
            `CREATE TABLE IF NOT EXISTS setup_wizard (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL UNIQUE,
                current_step INTEGER DEFAULT 0,
                total_steps INTEGER DEFAULT 6,
                started_by TEXT NOT NULL,
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                configuration TEXT DEFAULT '{}'
            )`,

            // Verification system
            `CREATE TABLE IF NOT EXISTS verification_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                verification_type TEXT,
                verification_data TEXT,
                status TEXT DEFAULT 'pending',
                attempts INTEGER DEFAULT 0,
                expires_at DATETIME,
                completed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS verification_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                status TEXT NOT NULL,
                risk_score INTEGER,
                profile_used TEXT,
                method TEXT,
                actor_id TEXT,
                source TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )`,

            // Blocklists and allowlists
            `CREATE TABLE IF NOT EXISTS lists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                list_type TEXT NOT NULL,
                item_type TEXT NOT NULL,
                value TEXT NOT NULL,
                reason TEXT,
                added_by TEXT,
                global BOOLEAN DEFAULT 0,
                active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, list_type, item_type, value)
            )`,

            // Dashboard sessions
            `CREATE TABLE IF NOT EXISTS command_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                scope TEXT NOT NULL,
                name TEXT NOT NULL,
                role_ids TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, scope, name)
            )`,
            `CREATE TABLE IF NOT EXISTS dashboard_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                guild_id TEXT,
                token TEXT UNIQUE,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Analytics and metrics
            `CREATE TABLE IF NOT EXISTS analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                metric_type TEXT NOT NULL,
                metric_value INTEGER,
                date DATE,
                hour INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, metric_type, date, hour)
            )`,

            // Ticket system tables
            `CREATE TABLE IF NOT EXISTS ticket_config (
                guild_id TEXT PRIMARY KEY,
                category_id TEXT NOT NULL,
                staff_role_id TEXT NOT NULL,
                panel_channel_id TEXT NOT NULL,
                auto_close_hours INTEGER DEFAULT 24,
                max_tickets_per_user INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS active_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT UNIQUE NOT NULL,
                user_id TEXT NOT NULL,
                staff_id TEXT,
                status TEXT DEFAULT 'open',
                priority TEXT DEFAULT 'medium',
                category TEXT DEFAULT 'general',
                subject TEXT,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                claimed_at DATETIME,
                closed_at DATETIME,
                last_message_at DATETIME
            )`,

            `CREATE TABLE IF NOT EXISTS ticket_transcripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                channel_name TEXT NOT NULL,
                user_id TEXT,
                closer_id TEXT NOT NULL,
                transcript TEXT,
                message_count INTEGER DEFAULT 0,
                closed_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // NEW TABLES FOR ENHANCED FEATURES
            `CREATE TABLE IF NOT EXISTS mod_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                moderator_id TEXT NOT NULL,
                note TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS moderation_cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                moderator_id TEXT NOT NULL,
                action TEXT NOT NULL,
                reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                status TEXT DEFAULT 'open',
                priority TEXT DEFAULT 'normal',
                tag TEXT,
                subject TEXT,
                description TEXT,
                assigned_to TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                closed_at DATETIME,
                last_message_at DATETIME
            )`,

            `CREATE TABLE IF NOT EXISTS autoroles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                role_id TEXT NOT NULL,
                UNIQUE(guild_id, role_id)
            )`,

            `CREATE TABLE IF NOT EXISTS reaction_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS reaction_role_options (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reaction_role_id INTEGER NOT NULL,
                role_id TEXT NOT NULL,
                emoji TEXT NOT NULL,
                FOREIGN KEY (reaction_role_id) REFERENCES reaction_roles(id)
            )`,

            `CREATE TABLE IF NOT EXISTS polls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                question TEXT NOT NULL,
                options TEXT NOT NULL,
                creator_id TEXT NOT NULL,
                ends_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS server_backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                backup_data TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS antinuke_whitelist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                UNIQUE(guild_id, user_id)
            )`,

            `CREATE TABLE IF NOT EXISTS quarantined_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                content TEXT NOT NULL,
                threats TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                reviewed_by TEXT,
                reviewed_at DATETIME,
                action TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS scan_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                scanned_messages INTEGER DEFAULT 0,
                scanned_channels INTEGER DEFAULT 0,
                threats_found INTEGER DEFAULT 0,
                duration INTEGER DEFAULT 0,
                scan_date DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS auto_delete_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL UNIQUE,
                auto_delete_threats BOOLEAN DEFAULT 0,
                auto_delete_spam BOOLEAN DEFAULT 0,
                auto_delete_phishing BOOLEAN DEFAULT 1,
                auto_delete_malicious_links BOOLEAN DEFAULT 1,
                auto_delete_toxicity BOOLEAN DEFAULT 0,
                notify_on_delete BOOLEAN DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS server_setups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                template TEXT NOT NULL,
                setup_by TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS bug_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                severity TEXT NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                expected_behavior TEXT,
                actual_behavior TEXT,
                discord_server TEXT,
                contact TEXT,
                status TEXT DEFAULT 'open',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                resolved_at DATETIME,
                resolved_by TEXT
            )`,

            `CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                discord_id TEXT,
                role TEXT DEFAULT 'admin',
                active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME,
                login_attempts INTEGER DEFAULT 0,
                locked_until DATETIME
            )`,
            
            // Coin system with atomic operations
            `CREATE TABLE IF NOT EXISTS coins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                balance INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )`,
            
            `CREATE TABLE IF NOT EXISTS coin_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                from_user_id TEXT NOT NULL,
                to_user_id TEXT,
                amount INTEGER NOT NULL,
                transaction_type TEXT NOT NULL,
                reason TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS self_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                role_id TEXT NOT NULL,
                emoji TEXT,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, role_id)
            )`,

            `CREATE TABLE IF NOT EXISTS reaction_role_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                title TEXT,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(message_id)
            )`,

            `CREATE TABLE IF NOT EXISTS user_levels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                xp INTEGER DEFAULT 0,
                level INTEGER DEFAULT 0,
                total_messages INTEGER DEFAULT 0,
                last_xp_gain DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )`,

            `CREATE TABLE IF NOT EXISTS user_economy (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                balance INTEGER DEFAULT 0,
                bank INTEGER DEFAULT 0,
                last_daily DATETIME,
                last_work DATETIME,
                total_earned INTEGER DEFAULT 0,
                total_spent INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )`,

            `CREATE TABLE IF NOT EXISTS shop_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                price INTEGER NOT NULL,
                role_id TEXT,
                emoji TEXT,
                stock INTEGER DEFAULT -1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS user_inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                item_id INTEGER NOT NULL,
                quantity INTEGER DEFAULT 1,
                purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(item_id) REFERENCES shop_items(id)
            )`
            ,
            // AI Assistant Conversation History
            `CREATE TABLE IF NOT EXISTS ai_conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                messages TEXT NOT NULL, -- Stored as JSON array [{role, content, timestamp}]
                last_interaction DATETIME DEFAULT CURRENT_TIMESTAMP,
                total_messages INTEGER DEFAULT 0,
                token_estimate INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, channel_id, user_id)
            )`,

            // AI Assistant Knowledge Base (per guild)
            `CREATE TABLE IF NOT EXISTS ai_knowledge (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT, -- comma separated tags
                added_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // AI Settings (per guild)
            `CREATE TABLE IF NOT EXISTS ai_settings (
                guild_id TEXT PRIMARY KEY,
                enabled BOOLEAN DEFAULT 0,
                system_prompt TEXT DEFAULT 'You are an AI assistant for this Discord server.',
                model TEXT DEFAULT 'gpt-4o-mini',
                embedding_model TEXT DEFAULT 'text-embedding-3-small',
                rate_messages_per_minute INTEGER DEFAULT 5,
                rate_tokens_per_day INTEGER DEFAULT 50000,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // AI Knowledge Embeddings
            `CREATE TABLE IF NOT EXISTS ai_embeddings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                knowledge_id INTEGER NOT NULL,
                guild_id TEXT NOT NULL,
                embedding TEXT NOT NULL, -- JSON array of floats
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(knowledge_id) REFERENCES ai_knowledge(id)
            )`,

            // AI Token Usage Logs
            `CREATE TABLE IF NOT EXISTS ai_token_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                total_tokens INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Comprehensive Action Logs (for all bot actions with undo capability)
            `CREATE TABLE IF NOT EXISTS action_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                action_category TEXT NOT NULL,
                target_user_id TEXT,
                target_username TEXT,
                moderator_id TEXT NOT NULL,
                moderator_username TEXT,
                reason TEXT,
                duration TEXT,
                channel_id TEXT,
                details TEXT,
                can_undo INTEGER DEFAULT 0,
                undone INTEGER DEFAULT 0,
                undone_by TEXT,
                undone_at DATETIME,
                undo_reason TEXT,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Command Logs for Dashboard
            `CREATE TABLE IF NOT EXISTS command_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                command_name TEXT NOT NULL,
                executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                success INTEGER DEFAULT 1,
                error_message TEXT
            )`,
            
            // Settings Changes for Dashboard
            `CREATE TABLE IF NOT EXISTS settings_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                guild_name TEXT,
                category TEXT NOT NULL,
                setting_name TEXT NOT NULL,
                old_value TEXT,
                new_value TEXT,
                changed_by_id TEXT NOT NULL,
                changed_by_name TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                extra_data TEXT
            )`,

            // ============================================
            // ADVANCED SECURITY FEATURES
            // ============================================

            // Comprehensive Audit Log System (Forensics)
            `CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_category TEXT NOT NULL,
                executor_id TEXT,
                executor_tag TEXT,
                target_type TEXT,
                target_id TEXT,
                target_name TEXT,
                changes TEXT,
                reason TEXT,
                before_state TEXT,
                after_state TEXT,
                can_replay INTEGER DEFAULT 0,
                replayed INTEGER DEFAULT 0,
                ip_hash TEXT,
                device_fingerprint TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // XP Multiplier Events System
            `CREATE TABLE IF NOT EXISTS xp_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                event_name TEXT NOT NULL,
                multiplier REAL DEFAULT 2.0,
                start_time DATETIME NOT NULL,
                end_time DATETIME NOT NULL,
                created_by TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active INTEGER DEFAULT 1,
                description TEXT
            )`,

            // Seasonal Leaderboard System
            `CREATE TABLE IF NOT EXISTS xp_seasons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                season_name TEXT NOT NULL,
                start_date DATETIME NOT NULL,
                end_date DATETIME NOT NULL,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, season_name)
            )`,

            `CREATE TABLE IF NOT EXISTS xp_season_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                season_id INTEGER NOT NULL,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                username TEXT,
                xp INTEGER DEFAULT 0,
                level INTEGER DEFAULT 0,
                rank INTEGER,
                reward_type TEXT,
                reward_value TEXT,
                claim_status INTEGER DEFAULT 0,
                claimed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(season_id) REFERENCES xp_seasons(id)
            )`,

            // Account Risk Scoring System
            `CREATE TABLE IF NOT EXISTS user_risk_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                account_age_days INTEGER,
                has_avatar INTEGER DEFAULT 0,
                mutual_servers INTEGER DEFAULT 0,
                join_velocity_score INTEGER DEFAULT 0,
                ip_cluster_score INTEGER DEFAULT 0,
                total_risk_score INTEGER DEFAULT 50,
                risk_level TEXT DEFAULT 'medium',
                verification_required INTEGER DEFAULT 0,
                flagged INTEGER DEFAULT 0,
                flag_reasons TEXT,
                last_calculated DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )`,

            // Whitelist System
            `CREATE TABLE IF NOT EXISTS whitelists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                whitelist_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                target_name TEXT,
                added_by TEXT NOT NULL,
                reason TEXT,
                bypass_antispam INTEGER DEFAULT 1,
                bypass_antinuke INTEGER DEFAULT 1,
                bypass_antiraid INTEGER DEFAULT 1,
                bypass_verification INTEGER DEFAULT 1,
                active INTEGER DEFAULT 1,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, whitelist_type, target_id)
            )`,

            // AI Behavior Analysis
            `CREATE TABLE IF NOT EXISTS behavior_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                analysis_type TEXT NOT NULL,
                content_sample TEXT,
                threat_score REAL DEFAULT 0,
                threat_categories TEXT,
                confidence REAL DEFAULT 0,
                action_taken TEXT,
                false_positive INTEGER DEFAULT 0,
                reviewed INTEGER DEFAULT 0,
                reviewed_by TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Staff Security (2FA & Session Management)
            `CREATE TABLE IF NOT EXISTS staff_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                session_token TEXT UNIQUE NOT NULL,
                device_fingerprint TEXT,
                ip_hash TEXT,
                requires_2fa INTEGER DEFAULT 0,
                twofa_verified INTEGER DEFAULT 0,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS staff_2fa (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                enabled INTEGER DEFAULT 0,
                secret TEXT,
                backup_codes TEXT,
                last_used DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )`,

            `CREATE TABLE IF NOT EXISTS destructive_action_confirmations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                action_details TEXT,
                confirmation_code TEXT NOT NULL,
                confirmed INTEGER DEFAULT 0,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Post-Incident Recovery System
            `CREATE TABLE IF NOT EXISTS server_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                snapshot_type TEXT DEFAULT 'auto',
                channels TEXT,
                roles TEXT,
                permissions TEXT,
                members TEXT,
                settings TEXT,
                created_by TEXT,
                auto_created INTEGER DEFAULT 1,
                can_restore INTEGER DEFAULT 1,
                restored INTEGER DEFAULT 0,
                restored_at DATETIME,
                restored_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS recovery_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                incident_id INTEGER,
                recovery_type TEXT NOT NULL,
                items_restored INTEGER DEFAULT 0,
                total_items INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                started_by TEXT NOT NULL,
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                errors TEXT,
                FOREIGN KEY(incident_id) REFERENCES security_incidents(id)
            )`,

            // Advanced Link Analysis
            `CREATE TABLE IF NOT EXISTS link_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                url TEXT NOT NULL,
                original_url TEXT,
                expanded_url TEXT,
                redirect_chain TEXT,
                domain TEXT,
                is_spoofed INTEGER DEFAULT 0,
                is_lookalike INTEGER DEFAULT 0,
                is_ip_logger INTEGER DEFAULT 0,
                is_token_grabber INTEGER DEFAULT 0,
                is_shortener INTEGER DEFAULT 0,
                threat_score REAL DEFAULT 0,
                threat_types TEXT,
                whitelisted INTEGER DEFAULT 0,
                blacklisted INTEGER DEFAULT 0,
                last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(url)
            )`,

            // Raid Prediction System
            `CREATE TABLE IF NOT EXISTS raid_predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                prediction_type TEXT NOT NULL,
                confidence REAL DEFAULT 0,
                indicators TEXT,
                user_count INTEGER DEFAULT 0,
                join_velocity REAL DEFAULT 0,
                region_cluster TEXT,
                invite_sources TEXT,
                predicted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                actual_raid INTEGER DEFAULT 0,
                prevented INTEGER DEFAULT 0,
                lockdown_activated INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Global Threat Network
            `CREATE TABLE IF NOT EXISTS global_threats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                threat_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                target_tag TEXT,
                evidence TEXT,
                severity TEXT DEFAULT 'medium',
                verified INTEGER DEFAULT 0,
                verified_by TEXT,
                guild_count INTEGER DEFAULT 1,
                reported_guilds TEXT,
                first_reported DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_reported DATETIME DEFAULT CURRENT_TIMESTAMP,
                active INTEGER DEFAULT 1,
                UNIQUE(threat_type, target_id)
            )`,

            `CREATE TABLE IF NOT EXISTS global_threat_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                reporter_id TEXT NOT NULL,
                threat_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                evidence TEXT,
                notes TEXT,
                auto_reported INTEGER DEFAULT 0,
                verified INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Multi-Layer Security Configuration
            `CREATE TABLE IF NOT EXISTS security_layers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                layer_name TEXT NOT NULL,
                layer_order INTEGER NOT NULL,
                enabled INTEGER DEFAULT 1,
                config TEXT,
                last_triggered DATETIME,
                trigger_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, layer_name)
            )`,

            // Beast Mode (Incident Response)
            `CREATE TABLE IF NOT EXISTS beast_mode_activations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                activated_by TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                trigger_details TEXT,
                lockdown_channels INTEGER DEFAULT 0,
                freeze_permissions INTEGER DEFAULT 0,
                require_2fa INTEGER DEFAULT 0,
                auto_deactivate INTEGER DEFAULT 1,
                deactivate_after INTEGER DEFAULT 3600,
                activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                deactivated_at DATETIME,
                deactivated_by TEXT
            )`,

            // User Safety & Wellbeing
            `CREATE TABLE IF NOT EXISTS safety_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT,
                alert_type TEXT NOT NULL,
                content_sample TEXT,
                confidence REAL DEFAULT 0,
                intervention_sent INTEGER DEFAULT 0,
                intervention_type TEXT,
                moderator_notified INTEGER DEFAULT 0,
                false_positive INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS toxicity_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                message_count INTEGER DEFAULT 0,
                toxic_count INTEGER DEFAULT 0,
                toxicity_score REAL DEFAULT 0,
                categories TEXT,
                last_toxic_message DATETIME,
                warnings_sent INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )`,

            // Enhanced Server Analytics
            `CREATE TABLE IF NOT EXISTS raid_charts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                date DATE NOT NULL,
                hour INTEGER NOT NULL,
                join_count INTEGER DEFAULT 0,
                raid_detected INTEGER DEFAULT 0,
                accounts_blocked INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, date, hour)
            )`,

            `CREATE TABLE IF NOT EXISTS spam_heatmap (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                date DATE NOT NULL,
                hour INTEGER NOT NULL,
                spam_count INTEGER DEFAULT 0,
                unique_spammers INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, channel_id, date, hour)
            )`,

            `CREATE TABLE IF NOT EXISTS staff_performance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                staff_id TEXT NOT NULL,
                date DATE NOT NULL,
                actions_taken INTEGER DEFAULT 0,
                warnings_issued INTEGER DEFAULT 0,
                kicks_issued INTEGER DEFAULT 0,
                bans_issued INTEGER DEFAULT 0,
                tickets_resolved INTEGER DEFAULT 0,
                avg_response_time INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, staff_id, date)
            )`,

            // Server Hardening Scanner
            `CREATE TABLE IF NOT EXISTS hardening_scans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                scan_type TEXT DEFAULT 'full',
                dangerous_perms_found INTEGER DEFAULT 0,
                vulnerable_roles INTEGER DEFAULT 0,
                exposed_channels INTEGER DEFAULT 0,
                risky_bots INTEGER DEFAULT 0,
                security_score INTEGER DEFAULT 100,
                recommendations TEXT,
                scanned_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS hardening_issues (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                scan_id INTEGER NOT NULL,
                issue_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                target_name TEXT,
                description TEXT,
                recommendation TEXT,
                resolved INTEGER DEFAULT 0,
                resolved_at DATETIME,
                resolved_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(scan_id) REFERENCES hardening_scans(id)
            )`,

            // Enhanced Captcha System
            `CREATE TABLE IF NOT EXISTS captcha_challenges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                challenge_type TEXT NOT NULL,
                challenge_data TEXT,
                answer_hash TEXT,
                attempts INTEGER DEFAULT 0,
                max_attempts INTEGER DEFAULT 3,
                completed INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0,
                adaptive_difficulty INTEGER DEFAULT 1,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Anti-Alt Enhanced Detection
            `CREATE TABLE IF NOT EXISTS alt_detection (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                suspected_main_account TEXT,
                detection_method TEXT NOT NULL,
                confidence REAL DEFAULT 0,
                evidence TEXT,
                action_taken TEXT,
                false_positive INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const tableSQL of tables) {
            await this.run(tableSQL);
        }

        // Create indexes for better performance
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_incidents_guild ON security_incidents(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_incidents_type ON security_incidents(incident_type)',
            'CREATE INDEX IF NOT EXISTS idx_user_records_guild_user ON user_records(guild_id, user_id)',
            'CREATE INDEX IF NOT EXISTS idx_message_logs_guild_channel ON message_logs(guild_id, channel_id)',
            'CREATE INDEX IF NOT EXISTS idx_mod_actions_guild ON mod_actions(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_analytics_guild_date ON analytics(guild_id, date)',
            'CREATE INDEX IF NOT EXISTS idx_active_tickets_guild ON active_tickets(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_active_tickets_user ON active_tickets(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_active_tickets_status ON active_tickets(status)',
            'CREATE INDEX IF NOT EXISTS idx_ticket_transcripts_guild ON ticket_transcripts(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_action_logs_guild ON action_logs(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_action_logs_category ON action_logs(action_category)',
            'CREATE INDEX IF NOT EXISTS idx_action_logs_can_undo ON action_logs(can_undo, undone)',
            // Advanced security indexes
            'CREATE INDEX IF NOT EXISTS idx_audit_logs_guild_event ON audit_logs(guild_id, event_type)',
            'CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_user_risk_scores_guild_user ON user_risk_scores(guild_id, user_id)',
            'CREATE INDEX IF NOT EXISTS idx_user_risk_scores_risk_level ON user_risk_scores(risk_level)',
            'CREATE INDEX IF NOT EXISTS idx_whitelists_guild_type ON whitelists(guild_id, whitelist_type)',
            'CREATE INDEX IF NOT EXISTS idx_behavior_analysis_guild_user ON behavior_analysis(guild_id, user_id)',
            'CREATE INDEX IF NOT EXISTS idx_behavior_analysis_type ON behavior_analysis(analysis_type)',
            'CREATE INDEX IF NOT EXISTS idx_staff_sessions_user ON staff_sessions(user_id, guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_staff_sessions_token ON staff_sessions(session_token)',
            'CREATE INDEX IF NOT EXISTS idx_server_snapshots_guild ON server_snapshots(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_server_snapshots_restored ON server_snapshots(restored)',
            'CREATE INDEX IF NOT EXISTS idx_link_analysis_url ON link_analysis(url)',
            'CREATE INDEX IF NOT EXISTS idx_link_analysis_domain ON link_analysis(domain)',
            'CREATE INDEX IF NOT EXISTS idx_raid_predictions_guild ON raid_predictions(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_raid_predictions_actual ON raid_predictions(actual_raid)',
            'CREATE INDEX IF NOT EXISTS idx_global_threats_type_target ON global_threats(threat_type, target_id)',
            'CREATE INDEX IF NOT EXISTS idx_global_threats_active ON global_threats(active)',
            'CREATE INDEX IF NOT EXISTS idx_security_layers_guild ON security_layers(guild_id, layer_order)',
            'CREATE INDEX IF NOT EXISTS idx_beast_mode_guild ON beast_mode_activations(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_safety_alerts_guild_user ON safety_alerts(guild_id, user_id)',
            'CREATE INDEX IF NOT EXISTS idx_safety_alerts_type ON safety_alerts(alert_type)',
            'CREATE INDEX IF NOT EXISTS idx_toxicity_scores_guild_user ON toxicity_scores(guild_id, user_id)',
            'CREATE INDEX IF NOT EXISTS idx_raid_charts_guild_date ON raid_charts(guild_id, date)',
            'CREATE INDEX IF NOT EXISTS idx_spam_heatmap_guild_date ON spam_heatmap(guild_id, channel_id, date)',
            'CREATE INDEX IF NOT EXISTS idx_staff_performance_guild_staff ON staff_performance(guild_id, staff_id)',
            'CREATE INDEX IF NOT EXISTS idx_hardening_scans_guild ON hardening_scans(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_hardening_issues_scan ON hardening_issues(scan_id)',
            'CREATE INDEX IF NOT EXISTS idx_captcha_challenges_guild_user ON captcha_challenges(guild_id, user_id)',
            'CREATE INDEX IF NOT EXISTS idx_alt_detection_guild_user ON alt_detection(guild_id, user_id)',
            'CREATE INDEX IF NOT EXISTS idx_guild_subscriptions_customer ON guild_subscriptions(stripe_customer_id)',
            'CREATE INDEX IF NOT EXISTS idx_guild_subscriptions_subscription ON guild_subscriptions(stripe_subscription_id)'
        ];

        for (const indexSQL of indexes) {
            await this.run(indexSQL);
        }

        console.log('📋 Database tables created/verified');
    }

    async run(sql, params = []) {
        // Detect writes to guild_configs / guild_settings and emit granular events
        const lower = String(sql || '').toLowerCase();
        const touchesConfigs = lower.includes('guild_configs');
        const touchesSettings = lower.includes('guild_settings');

        // Helper to guess guildId from params
        const guessGuildId = (p) => {
            if (!p || !Array.isArray(p) || p.length === 0) return null;
            for (const v of p) {
                if (v && typeof v === 'string' && /^\d{16,20}$/.test(v)) return v;
            }
            if (p[0] && typeof p[0] === 'string' && p[0].length > 4) return p[0];
            return null;
        };

        const guildId = guessGuildId(params);

        let beforeRow = null;
        try {
            if (touchesConfigs && guildId) beforeRow = await this.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]).catch(() => null);
            if (touchesSettings && guildId && !beforeRow) beforeRow = await this.get('SELECT * FROM guild_settings WHERE guild_id = ?', [guildId]).catch(() => null);
        } catch (e) {
            beforeRow = null;
        }

        const self = this;
        return new Promise((resolve, reject) => {
            self.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    const result = { id: this.lastID, changes: this.changes };
                    resolve(result);

                    // Fire-and-forget: compute diffs and emit events
                    (async () => {
                        try {
                            if ((touchesConfigs || touchesSettings) && guildId && result.changes >= 0 && self && self.bot) {
                                let afterRow = null;
                                try {
                                    if (touchesConfigs) afterRow = await self.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]).catch(() => null);
                                    if (touchesSettings && !afterRow) afterRow = await self.get('SELECT * FROM guild_settings WHERE guild_id = ?', [guildId]).catch(() => null);
                                } catch (e) {
                                    afterRow = null;
                                }

                                if (afterRow) {
                                    try {
                                        const ignoreCols = new Set(['id', 'created_at', 'updated_at', 'guild_id']);
                                        for (const k of Object.keys(afterRow)) {
                                            if (ignoreCols.has(k)) continue;
                                            const beforeVal = beforeRow ? (beforeRow[k] === undefined ? null : beforeRow[k]) : null;
                                            const afterVal = afterRow[k] === undefined ? null : afterRow[k];
                                            // Compare loosely via JSON stringify to handle numbers/booleans
                                            const beforeStr = beforeVal === null || typeof beforeVal === 'undefined' ? null : String(beforeVal);
                                            const afterStr = afterVal === null || typeof afterVal === 'undefined' ? null : String(afterVal);
                                            if (beforeStr !== afterStr) {
                                                try {
                                                    if (typeof self.bot.emitSettingChange === 'function') {
                                                        // Emit with userId 'System' for DB-driven changes
                                                        try { self.bot.emitSettingChange(String(guildId), 'System', k, afterVal); } catch (e) { /* ignore */ }
                                                    }
                                                } catch (e) {
                                                    // ignore per-key emit errors
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        // ignore
                                    }
                                }
                            }
                        } catch (e) {
                            // ignore emit errors
                        }
                    })();
                }
            });
        });
    }

    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('📊 Database connection closed');
                    resolve();
                }
            });
        });
    }

    // Helper methods for common operations
    async getGuildConfig(guildId) {
        // Check cache first
        const cached = this.getConfigCache(guildId);
        if (cached) {
            return cached;
        }

        const config = await this.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]);
        if (!config) {
            // Create default config
            await this.run(`
                INSERT INTO guild_configs (guild_id) 
                VALUES (?)
            `, [guildId]);
            return this.getGuildConfig(guildId);
        }
        
        // Cache the config
        this.setConfigCache(guildId, config);
        return config;
    }

    async updateGuildConfig(guildId, updates) {
        const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(updates), guildId];
        
        const result = await this.run(`
            UPDATE guild_configs 
            SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
            WHERE guild_id = ?
        `, values);

        // Invalidate cache when config is updated
        this.invalidateConfigCache(guildId);
        
        return result;
    }

    async insertAuditLog(data) {
        const {
            guild_id,
            event_type,
            event_category = 'config_change',
            executor_id,
            executor_tag,
            target_type = 'setting',
            target_id = null,
            target_name = null,
            changes = null,
            reason = null,
            before_state = null,
            after_state = null,
            can_replay = 0,
            ip_hash = null,
            device_fingerprint = null
        } = data;

        return this.run(`
            INSERT INTO audit_logs (
                guild_id, event_type, event_category, executor_id, executor_tag,
                target_type, target_id, target_name, changes, reason,
                before_state, after_state, can_replay, ip_hash, device_fingerprint
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            guild_id, event_type, event_category, executor_id, executor_tag,
            target_type, target_id, target_name,
            changes ? JSON.stringify(changes) : null,
            reason,
            before_state ? JSON.stringify(before_state) : null,
            after_state ? JSON.stringify(after_state) : null,
            can_replay, ip_hash, device_fingerprint
        ]);
    }

    async createXPEvent(data) {
        const { guild_id, event_name, multiplier, start_time, end_time, created_by, description } = data;
        return this.run(`
            INSERT INTO xp_events (guild_id, event_name, multiplier, start_time, end_time, created_by, description)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [guild_id, event_name, multiplier, start_time, end_time, created_by, description]);
    }

    async getActiveXPEvents(guildId) {
        const now = new Date().toISOString();
        return this.all(`
            SELECT * FROM xp_events 
            WHERE guild_id = ? AND is_active = 1 
            AND datetime(start_time) <= datetime(?) 
            AND datetime(end_time) >= datetime(?)
            ORDER BY start_time DESC
        `, [guildId, now, now]);
    }

    async getAllXPEvents(guildId) {
        return this.all(`
            SELECT * FROM xp_events 
            WHERE guild_id = ? 
            ORDER BY start_time DESC
        `, [guildId]);
    }

    async deleteXPEvent(eventId) {
        return this.run('DELETE FROM xp_events WHERE id = ?', [eventId]);
    }

    async createSeason(guildId, seasonName, startDate, endDate) {
        return this.run(`
            INSERT INTO xp_seasons (guild_id, season_name, start_date, end_date, status)
            VALUES (?, ?, ?, ?, 'active')
        `, [guildId, seasonName, startDate, endDate]);
    }

    async getActiveSeason(guildId) {
        const now = new Date().toISOString();
        return this.get(`
            SELECT * FROM xp_seasons 
            WHERE guild_id = ? AND status = 'active'
            AND datetime(start_date) <= datetime(?)
            AND datetime(end_date) >= datetime(?)
            LIMIT 1
        `, [guildId, now, now]);
    }

    async getSeasonById(seasonId) {
        return this.get('SELECT * FROM xp_seasons WHERE id = ?', [seasonId]);
    }

    async getAllSeasons(guildId) {
        return this.all(`
            SELECT * FROM xp_seasons 
            WHERE guild_id = ?
            ORDER BY end_date DESC
        `, [guildId]);
    }

    async endSeason(seasonId) {
        return this.run('UPDATE xp_seasons SET status = ? WHERE id = ?', ['ended', seasonId]);
    }

    async recordSeasonSnapshot(seasonId, guildId, userId, username, xp, level) {
        return this.run(`
            INSERT INTO xp_season_snapshots (season_id, guild_id, user_id, username, xp, level)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [seasonId, guildId, userId, username, xp, level]);
    }

    async recordSeasonRewards(seasonId, guildId, userId, rank, rewardType, rewardValue) {
        return this.run(`
            UPDATE xp_season_snapshots 
            SET rank = ?, reward_type = ?, reward_value = ?
            WHERE season_id = ? AND user_id = ? AND guild_id = ?
        `, [rank, rewardType, rewardValue, seasonId, userId, guildId]);
    }

    async getSeasonLeaderboard(seasonId, limit = 10) {
        return this.all(`
            SELECT * FROM xp_season_snapshots 
            WHERE season_id = ?
            ORDER BY rank ASC
            LIMIT ?
        `, [seasonId, limit]);
    }

    async claimSeasonReward(snapshotId) {
        return this.run(`
            UPDATE xp_season_snapshots 
            SET claim_status = 1, claimed_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [snapshotId]);
    }

    // ========================
    // CACHING SYSTEM
    // ========================

    getConfigCache(guildId) {
        const cacheKey = `config_${guildId}`;
        const expiry = this.cacheExpiry.get(cacheKey);
        
        // Check if cache has expired
        if (expiry && Date.now() > expiry) {
            this.configCache.delete(cacheKey);
            this.cacheExpiry.delete(cacheKey);
            return null;
        }
        
        return this.configCache.get(cacheKey);
    }

    setConfigCache(guildId, config, ttl = null) {
        const cacheKey = `config_${guildId}`;
        const expiryTime = Date.now() + (ttl || this.cacheTTL);
        
        this.configCache.set(cacheKey, config);
        this.cacheExpiry.set(cacheKey, expiryTime);
    }

    invalidateConfigCache(guildId) {
        const cacheKey = `config_${guildId}`;
        this.configCache.delete(cacheKey);
        this.cacheExpiry.delete(cacheKey);
    }

    invalidateAllCache() {
        this.configCache.clear();
        this.cacheExpiry.clear();
    }

    getCacheStats() {
        return {
            size: this.configCache.size,
            maxSize: this.cacheTTL,
            entries: Array.from(this.configCache.keys())
        };
    }

    async getGuildSubscription(guildId) {
        const existing = await this.get(
            'SELECT * FROM guild_subscriptions WHERE guild_id = ?',
            [guildId]
        );

        if (existing) return existing;

        await this.run(
            'INSERT OR IGNORE INTO guild_subscriptions (guild_id, plan, status) VALUES (?, ?, ?)',
            [guildId, 'free', 'inactive']
        );

        return this.get(
            'SELECT * FROM guild_subscriptions WHERE guild_id = ?',
            [guildId]
        );
    }

    async setGuildSubscription(guildId, data = {}) {
        const allowedPlans = new Set(['free', 'pro', 'enterprise']);
        const allowedStatuses = new Set(['active', 'inactive', 'past_due', 'canceled']);

        const existing = await this.getGuildSubscription(guildId).catch(() => null);

        let plan = data.plan || existing?.plan || 'free';
        if (!allowedPlans.has(plan)) plan = 'free';

        let status = data.status || existing?.status || 'inactive';
        if (!allowedStatuses.has(status)) status = 'inactive';

        const hasPeriodEnd = Object.prototype.hasOwnProperty.call(data, 'current_period_end');
        const currentPeriodEnd = hasPeriodEnd
            ? (data.current_period_end === null || data.current_period_end === undefined
                ? null
                : Math.floor(Number(data.current_period_end)) || null)
            : (existing?.current_period_end || null);

        const stripeCustomerId = data.stripe_customer_id || existing?.stripe_customer_id || null;
        const stripeSubscriptionId = data.stripe_subscription_id || existing?.stripe_subscription_id || null;

        await this.run(`
            INSERT INTO guild_subscriptions (
                guild_id, plan, status, current_period_end, stripe_customer_id, stripe_subscription_id
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                plan = excluded.plan,
                status = excluded.status,
                current_period_end = excluded.current_period_end,
                stripe_customer_id = COALESCE(excluded.stripe_customer_id, guild_subscriptions.stripe_customer_id),
                stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, guild_subscriptions.stripe_subscription_id)
        `, [
            guildId,
            plan,
            status,
            currentPeriodEnd,
            stripeCustomerId,
            stripeSubscriptionId
        ]);

        return this.getGuildSubscription(guildId);
    }

    async setPlanFree(guildId) {
        return this.setGuildSubscription(guildId, {
            plan: 'free',
            status: 'inactive',
            current_period_end: null
        });
    }

    async setPlanPro(guildId, stripeCustomerId = null, stripeSubscriptionId = null, periodEnd = null) {
        return this.setGuildSubscription(guildId, {
            plan: 'pro',
            status: 'active',
            current_period_end: periodEnd,
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: stripeSubscriptionId
        });
    }

    async setPlanEnterprise(guildId, stripeCustomerId = null, stripeSubscriptionId = null, periodEnd = null) {
        return this.setGuildSubscription(guildId, {
            plan: 'enterprise',
            status: 'active',
            current_period_end: periodEnd,
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: stripeSubscriptionId
        });
    }

    async logSecurityIncident(guildId, type, severity, data = {}) {
        return this.run(`
            INSERT INTO security_incidents 
            (guild_id, incident_type, severity, user_id, channel_id, description, data)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            guildId,
            type,
            severity,
            data.userId || null,
            data.channelId || null,
            data.description || null,
            JSON.stringify(data)
        ]);
    }

    async getUserRecord(guildId, userId) {
        return this.get(`
            SELECT * FROM user_records 
            WHERE guild_id = ? AND user_id = ?
        `, [guildId, userId]);
    }

    async createOrUpdateUserRecord(guildId, userId, userData) {
        const existing = await this.getUserRecord(guildId, userId);
        
        if (existing) {
            const setClause = Object.keys(userData).map(key => `${key} = ?`).join(', ');
            const values = [...Object.values(userData), guildId, userId];
            
            return this.run(`
                UPDATE user_records 
                SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
                WHERE guild_id = ? AND user_id = ?
            `, values);
        } else {
            const columns = ['guild_id', 'user_id', ...Object.keys(userData)];
            const placeholders = columns.map(() => '?').join(', ');
            const values = [guildId, userId, ...Object.values(userData)];
            
            return this.run(`
                INSERT INTO user_records (${columns.join(', ')})
                VALUES (${placeholders})
            `, values);
        }
    }

    // Action Logging System
    async logAction(actionData) {
        const result = await this.run(`
            INSERT INTO action_logs 
            (guild_id, action_type, action_category, target_user_id, target_username, 
             moderator_id, moderator_username, reason, duration, channel_id, details, 
             can_undo, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            actionData.guildId,
            actionData.actionType,
            actionData.actionCategory || 'moderation',
            actionData.targetUserId || null,
            actionData.targetUsername || null,
            actionData.moderatorId,
            actionData.moderatorUsername || null,
            actionData.reason || 'No reason provided',
            actionData.duration || null,
            actionData.channelId || null,
            actionData.details ? JSON.stringify(actionData.details) : null,
            actionData.canUndo ? 1 : 0,
            actionData.expiresAt || null
        ]);

        // Also log to the new Logger system for security events
        if (this.bot && this.bot.logger) {
            try {
                await this.bot.logger.logSecurityEvent({
                    eventType: actionData.actionType,
                    guildId: actionData.guildId,
                    channelId: actionData.channelId || null,
                    moderatorId: actionData.moderatorId,
                    moderatorTag: actionData.moderatorUsername || null,
                    targetId: actionData.targetUserId || null,
                    targetTag: actionData.targetUsername || null,
                    reason: actionData.reason || 'No reason provided',
                    details: {
                        category: actionData.actionCategory || 'moderation',
                        duration: actionData.duration || null,
                        canUndo: actionData.canUndo || false,
                        ...actionData.details
                    }
                });
            } catch (err) {
                // Non-fatal, don't block action logging
                console.error('[Database] Failed to log action to Logger:', err);
            }
        }

        return result;
    }

    async getRecentActions(guildId, limit = 100, category = null) {
        let query = `
            SELECT * FROM action_logs 
            WHERE guild_id = ?
        `;
        const params = [guildId];

        if (category) {
            query += ' AND action_category = ?';
            params.push(category);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        return this.all(query, params);
    }

    async getActionById(actionId) {
        return this.get('SELECT * FROM action_logs WHERE id = ?', [actionId]);
    }

    async markActionAsUndone(actionId, undoneBy, undoReason) {
        return this.run(`
            UPDATE action_logs 
            SET undone = 1, undone_by = ?, undone_at = CURRENT_TIMESTAMP, undo_reason = ?
            WHERE id = ?
        `, [undoneBy, undoReason, actionId]);
    }

    async getActionStats(guildId, days = 7) {
        return this.all(`
            SELECT 
                action_category,
                action_type,
                COUNT(*) as count,
                SUM(CASE WHEN undone = 1 THEN 1 ELSE 0 END) as undone_count
            FROM action_logs
            WHERE guild_id = ? AND created_at > datetime('now', '-${days} days')
            GROUP BY action_category, action_type
            ORDER BY count DESC
        `, [guildId]);
    }

    async logEvent(eventData) {
        try {
            const { type, guildId, userId, timestamp, metadata } = eventData;
            
            await this.run(`
                INSERT INTO action_logs (
                    guild_id,
                    action_type,
                    action_category,
                    moderator_id,
                    target_user_id,
                    reason,
                    details,
                    can_undo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                guildId,
                type,
                'system',
                userId,
                metadata?.targetUserId,
                metadata?.reason || 'System action',
                JSON.stringify(metadata),
                false
            ]);
        } catch (error) {
            console.error('Failed to log event:', error);
        }
    }

    // ============================================
    // COIN SYSTEM METHODS (Atomic Operations)
    // ============================================

    async getCoins(guildId, userId) {
        const result = await this.get(
            'SELECT balance FROM coins WHERE guild_id = ? AND user_id = ?',
            [guildId, userId]
        );
        return result ? result.balance : 0;
    }

    async addCoins(guildId, userId, amount, reason = 'Admin grant') {
        try {
            // Use INSERT OR IGNORE followed by UPDATE for atomic operation
            await this.run(
                'INSERT OR IGNORE INTO coins (guild_id, user_id, balance) VALUES (?, ?, 0)',
                [guildId, userId]
            );

            // Atomic increment
            const result = await this.run(
                'UPDATE coins SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ?',
                [amount, guildId, userId]
            );

            // Log transaction
            await this.run(
                'INSERT INTO coin_transactions (guild_id, from_user_id, to_user_id, amount, transaction_type, reason) VALUES (?, ?, ?, ?, ?, ?)',
                [guildId, 'SYSTEM', userId, amount, 'ADMIN_GRANT', reason]
            );

            const newBalance = await this.getCoins(guildId, userId);
            return { success: true, balance: newBalance };
        } catch (error) {
            console.error('Error adding coins:', error);
            return { success: false, error: error.message };
        }
    }

    async transferCoins(guildId, fromUserId, toUserId, amount) {
        try {
            // Check sender balance
            const senderBalance = await this.getCoins(guildId, fromUserId);
            if (senderBalance < amount) {
                return { success: false, error: 'Insufficient coins' };
            }

            // Initialize recipient if needed
            await this.run(
                'INSERT OR IGNORE INTO coins (guild_id, user_id, balance) VALUES (?, ?, 0)',
                [guildId, toUserId]
            );

            // Atomic transfer (deduct from sender)
            await this.run(
                'UPDATE coins SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ?',
                [amount, guildId, fromUserId]
            );

            // Add to recipient
            await this.run(
                'UPDATE coins SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ?',
                [amount, guildId, toUserId]
            );

            // Log transaction
            await this.run(
                'INSERT INTO coin_transactions (guild_id, from_user_id, to_user_id, amount, transaction_type) VALUES (?, ?, ?, ?, ?)',
                [guildId, fromUserId, toUserId, amount, 'TRANSFER']
            );

            const newSenderBalance = await this.getCoins(guildId, fromUserId);
            const newRecipientBalance = await this.getCoins(guildId, toUserId);

            return {
                success: true,
                senderBalance: newSenderBalance,
                recipientBalance: newRecipientBalance
            };
        } catch (error) {
            console.error('Error transferring coins:', error);
            return { success: false, error: error.message };
        }
    }

    async getCoinLeaderboard(guildId, limit = 10) {
        return this.all(
            'SELECT user_id, balance FROM coins WHERE guild_id = ? ORDER BY balance DESC LIMIT ?',
            [guildId, limit]
        );
    }

    async getCoinTransactions(guildId, userId, limit = 20) {
        return this.all(
            `SELECT * FROM coin_transactions 
             WHERE guild_id = ? AND (from_user_id = ? OR to_user_id = ?)
             ORDER BY timestamp DESC LIMIT ?`,
            [guildId, userId, userId, limit]
        );
    }

    async logIncident(data) {
        try {
            await this.run(
                `INSERT INTO mod_actions (
                    guild_id, action_type, action_category,
                    moderator_id, target_user_id, reason, details, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    data.guildId,
                    data.type,
                    data.category || 'moderation',
                    data.moderatorId,
                    data.targetUserId,
                    data.reason || 'No reason provided',
                    JSON.stringify(data.details || {}),
                    new Date().toISOString()
                ]
            );
            this.logger?.debug(`Logged incident: ${data.type} in guild ${data.guildId}`);
            
            // Track moderation action for analytics if bot is attached
            if (this.bot && this.bot.analyticsManager) {
                this.bot.analyticsManager.trackModerationAction(data.guildId, data.type);
            }
        } catch (error) {
            this.logger?.error('Error logging incident:', error);
            // Don't throw - let the action continue even if logging fails
        }
    }
}

module.exports = Database;
