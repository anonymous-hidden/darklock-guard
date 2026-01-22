/**
 * Idempotent Database Migration Runner
 * Safe for production - runs on every startup, tracks applied migrations
 * Works with SQLite (default) and MySQL-compatible APIs
 */

const fs = require('fs');
const path = require('path');

class MigrationRunner {
    /**
     * @param {Object} db - Database adapter with run/get/all methods
     * @param {Object} logger - Logger instance (optional)
     */
    constructor(db, logger = console) {
        this.db = db;
        this.logger = logger;
        this.lockFile = path.join(process.cwd(), 'data', '.migration.lock');
    }

    // ═══════════════════════════════════════════════════════════════════
    // DATABASE ADAPTER HELPERS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Execute a query (INSERT, UPDATE, CREATE, etc)
     */
    async run(sql, params = []) {
        // Support different DB APIs
        if (typeof this.db.run === 'function') {
            return new Promise((resolve, reject) => {
                this.db.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes, lastID: this.lastID });
                });
            });
        }
        if (typeof this.db.execute === 'function') {
            return this.db.execute(sql, params);
        }
        if (typeof this.db.query === 'function') {
            return this.db.query(sql, params);
        }
        throw new Error('Unsupported database adapter');
    }

    /**
     * Get single row
     */
    async get(sql, params = []) {
        if (typeof this.db.get === 'function') {
            return new Promise((resolve, reject) => {
                this.db.get(sql, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        }
        const rows = await this.all(sql, params);
        return rows[0];
    }

    /**
     * Get all rows
     */
    async all(sql, params = []) {
        if (typeof this.db.all === 'function') {
            return new Promise((resolve, reject) => {
                this.db.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
        }
        if (typeof this.db.query === 'function') {
            const [rows] = await this.db.query(sql, params);
            return rows || [];
        }
        throw new Error('Unsupported database adapter');
    }

    // ═══════════════════════════════════════════════════════════════════
    // LOCK MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════

    acquireLock() {
        const dataDir = path.dirname(this.lockFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        if (fs.existsSync(this.lockFile)) {
            try {
                const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
                const lockAge = Date.now() - lockData.timestamp;
                
                // Stale lock (> 10 minutes)
                if (lockAge > 10 * 60 * 1000) {
                    this.logger.warn('⚠️ Removing stale migration lock');
                    fs.unlinkSync(this.lockFile);
                } else {
                    throw new Error(`Migration in progress (PID: ${lockData.pid}, Age: ${Math.round(lockAge/1000)}s)`);
                }
            } catch (e) {
                if (e.message.includes('Migration in progress')) throw e;
                // Corrupted lock file, remove it
                fs.unlinkSync(this.lockFile);
            }
        }

        fs.writeFileSync(this.lockFile, JSON.stringify({
            pid: process.pid,
            timestamp: Date.now(),
            hostname: require('os').hostname()
        }));
    }

    releaseLock() {
        try {
            if (fs.existsSync(this.lockFile)) {
                fs.unlinkSync(this.lockFile);
            }
        } catch (e) {
            this.logger.warn('Could not release migration lock:', e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // SCHEMA INTROSPECTION
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Check if table exists
     */
    async tableExists(tableName) {
        try {
            const result = await this.get(
                `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
                [tableName]
            );
            return !!result;
        } catch (e) {
            // MySQL fallback
            try {
                const [rows] = await this.db.query(`SHOW TABLES LIKE ?`, [tableName]);
                return rows && rows.length > 0;
            } catch {
                return false;
            }
        }
    }

    /**
     * Check if column exists in table
     */
    async columnExists(tableName, columnName) {
        try {
            // SQLite
            const columns = await this.all(`PRAGMA table_info(${tableName})`);
            return columns.some(col => col.name === columnName);
        } catch (e) {
            // MySQL fallback
            try {
                const [rows] = await this.db.query(
                    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=? AND COLUMN_NAME=?`,
                    [tableName, columnName]
                );
                return rows && rows.length > 0;
            } catch {
                return false;
            }
        }
    }

    /**
     * Safely add column if not exists
     */
    async safeAddColumn(table, column, definition) {
        if (await this.columnExists(table, column)) {
            return { added: false, reason: 'already_exists' };
        }

        await this.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        return { added: true };
    }

    /**
     * Safely create table if not exists
     */
    async safeCreateTable(tableName, createSQL) {
        if (await this.tableExists(tableName)) {
            return { created: false, reason: 'already_exists' };
        }

        await this.run(createSQL);
        return { created: true };
    }

    // ═══════════════════════════════════════════════════════════════════
    // MIGRATION TRACKING
    // ═══════════════════════════════════════════════════════════════════

    async ensureMigrationTable() {
        await this.run(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                batch INTEGER NOT NULL,
                applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
                execution_time_ms INTEGER,
                status TEXT DEFAULT 'applied'
            )
        `);
    }

    async isApplied(version) {
        const row = await this.get(
            `SELECT id FROM schema_migrations WHERE version = ? AND status = 'applied'`,
            [version]
        );
        return !!row;
    }

    async recordMigration(version, name, batch, executionTime) {
        await this.run(`
            INSERT INTO schema_migrations (version, name, batch, execution_time_ms, status)
            VALUES (?, ?, ?, ?, 'applied')
        `, [version, name, batch, executionTime]);
    }

    // ═══════════════════════════════════════════════════════════════════
    // MIGRATION DEFINITIONS
    // ═══════════════════════════════════════════════════════════════════

    getMigrations() {
        return [
            {
                version: '001_verified_at',
                name: 'Add verified_at columns',
                up: async () => {
                    await this.safeAddColumn('user_records', 'verified_at', 'DATETIME');
                    await this.safeAddColumn('user_records', 'verification_reason', 'TEXT');
                }
            },
            {
                version: '002_welcome_goodbye',
                name: 'Add welcome/goodbye columns',
                up: async () => {
                    await this.safeAddColumn('guild_configs', 'goodbye_enabled', 'INTEGER DEFAULT 0');
                    await this.safeAddColumn('guild_configs', 'goodbye_channel', 'TEXT');
                    await this.safeAddColumn('guild_configs', 'goodbye_message', 'TEXT');
                    await this.safeAddColumn('guild_configs', 'verified_welcome_channel_id', 'TEXT');
                    await this.safeAddColumn('guild_configs', 'verified_welcome_enabled', 'INTEGER DEFAULT 0');
                }
            },
            {
                version: '003_strikes',
                name: 'Create user_strikes table',
                up: async () => {
                    await this.safeCreateTable('user_strikes', `
                        CREATE TABLE user_strikes (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            user_id TEXT NOT NULL,
                            moderator_id TEXT NOT NULL,
                            reason TEXT,
                            points INTEGER DEFAULT 1,
                            expires_at DATETIME,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    // Index for fast lookups
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_strikes_guild_user ON user_strikes(guild_id, user_id)`).catch(() => {});
                }
            },
            {
                version: '004_quarantine',
                name: 'Create quarantine table',
                up: async () => {
                    await this.safeCreateTable('quarantined_users', `
                        CREATE TABLE quarantined_users (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            user_id TEXT NOT NULL,
                            reason TEXT,
                            quarantined_by TEXT,
                            original_roles TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            released_at DATETIME,
                            status TEXT DEFAULT 'active'
                        )
                    `);
                    await this.safeAddColumn('guild_configs', 'quarantine_role_id', 'TEXT');
                }
            },
            {
                version: '005_appeals',
                name: 'Create appeals table',
                up: async () => {
                    await this.safeCreateTable('appeals', `
                        CREATE TABLE appeals (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            user_id TEXT NOT NULL,
                            action_type TEXT NOT NULL,
                            action_id TEXT,
                            reason TEXT,
                            status TEXT DEFAULT 'pending',
                            reviewed_by TEXT,
                            reviewed_at DATETIME,
                            notes TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                }
            },
            {
                version: '006_modmail',
                name: 'Create modmail tables',
                up: async () => {
                    await this.safeCreateTable('modmail_threads', `
                        CREATE TABLE modmail_threads (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            user_id TEXT NOT NULL,
                            channel_id TEXT,
                            status TEXT DEFAULT 'open',
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            closed_at DATETIME,
                            closed_by TEXT
                        )
                    `);
                    await this.safeCreateTable('modmail_messages', `
                        CREATE TABLE modmail_messages (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            thread_id INTEGER NOT NULL,
                            author_id TEXT NOT NULL,
                            content TEXT,
                            is_staff INTEGER DEFAULT 0,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    await this.safeAddColumn('guild_configs', 'modmail_enabled', 'INTEGER DEFAULT 0');
                    await this.safeAddColumn('guild_configs', 'modmail_category_id', 'TEXT');
                }
            },
            {
                version: '007_invite_tracking',
                name: 'Create invite tracking tables',
                up: async () => {
                    await this.safeCreateTable('invite_tracker_config', `
                        CREATE TABLE invite_tracker_config (
                            guild_id TEXT PRIMARY KEY,
                            enabled INTEGER DEFAULT 0,
                            log_channel_id TEXT,
                            track_leaves INTEGER DEFAULT 1,
                            reward_roles TEXT DEFAULT '[]',
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    await this.safeCreateTable('invite_data', `
                        CREATE TABLE invite_data (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            invite_code TEXT NOT NULL,
                            inviter_id TEXT NOT NULL,
                            uses INTEGER DEFAULT 0,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE(guild_id, invite_code)
                        )
                    `);
                    await this.safeCreateTable('invite_joins', `
                        CREATE TABLE invite_joins (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            user_id TEXT NOT NULL,
                            inviter_id TEXT,
                            invite_code TEXT,
                            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            left_at DATETIME
                        )
                    `);
                }
            },
            {
                version: '008_scheduled_actions',
                name: 'Create scheduled actions table',
                up: async () => {
                    await this.safeCreateTable('scheduled_actions', `
                        CREATE TABLE scheduled_actions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            action_type TEXT NOT NULL,
                            target_id TEXT,
                            data TEXT,
                            execute_at DATETIME NOT NULL,
                            executed INTEGER DEFAULT 0,
                            created_by TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_scheduled_execute ON scheduled_actions(execute_at, executed)`).catch(() => {});
                }
            },
            {
                version: '009_language',
                name: 'Add language columns',
                up: async () => {
                    await this.safeAddColumn('guild_configs', 'language', "TEXT DEFAULT 'en'");
                    await this.safeAddColumn('user_records', 'language', 'TEXT');
                }
            },
            {
                version: '010_alt_detection',
                name: 'Create alt detection table',
                up: async () => {
                    await this.safeCreateTable('alt_accounts', `
                        CREATE TABLE alt_accounts (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            main_user_id TEXT NOT NULL,
                            alt_user_id TEXT NOT NULL,
                            confidence REAL DEFAULT 0.5,
                            detection_method TEXT,
                            detected_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    await this.safeAddColumn('guild_configs', 'alt_detection_enabled', 'INTEGER DEFAULT 0');
                    await this.safeAddColumn('guild_configs', 'alt_detection_action', "TEXT DEFAULT 'notify'");
                }
            },
            {
                version: '011_word_filter',
                name: 'Create word filter table',
                up: async () => {
                    await this.safeCreateTable('word_filter_rules', `
                        CREATE TABLE word_filter_rules (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            pattern TEXT NOT NULL,
                            is_regex INTEGER DEFAULT 0,
                            action TEXT DEFAULT 'delete',
                            severity TEXT DEFAULT 'low',
                            enabled INTEGER DEFAULT 1,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    await this.safeAddColumn('guild_configs', 'word_filter_enabled', 'INTEGER DEFAULT 0');
                }
            },
            {
                version: '012_reputation',
                name: 'Create reputation table',
                up: async () => {
                    await this.safeCreateTable('user_reputation', `
                        CREATE TABLE user_reputation (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            user_id TEXT NOT NULL,
                            given_by TEXT NOT NULL,
                            amount INTEGER DEFAULT 1,
                            reason TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE(guild_id, user_id, given_by)
                        )
                    `);
                }
            },
            {
                version: '013_voice_sessions',
                name: 'Create voice sessions table',
                up: async () => {
                    await this.safeCreateTable('voice_sessions', `
                        CREATE TABLE voice_sessions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            user_id TEXT NOT NULL,
                            channel_id TEXT NOT NULL,
                            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            left_at DATETIME,
                            duration_seconds INTEGER
                        )
                    `);
                    await this.safeAddColumn('guild_configs', 'voice_monitor_enabled', 'INTEGER DEFAULT 0');
                }
            },
            {
                version: '014_dashboard_audit',
                name: 'Create dashboard audit log table',
                up: async () => {
                    await this.safeCreateTable('dashboard_audit_logs', `
                        CREATE TABLE dashboard_audit_logs (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT,
                            user_id TEXT NOT NULL,
                            action TEXT NOT NULL,
                            target_type TEXT,
                            target_id TEXT,
                            details TEXT,
                            ip_address TEXT,
                            user_agent TEXT,
                            timestamp TEXT NOT NULL,
                            created_at TEXT DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_audit_guild ON dashboard_audit_logs(guild_id)`).catch(() => {});
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON dashboard_audit_logs(timestamp)`).catch(() => {});
                }
            },
            {
                version: '015_trust_score',
                name: 'Add trust score system columns',
                up: async () => {
                    // Add trust score columns to user_records
                    await this.safeAddColumn('user_records', 'spam_flags', 'INTEGER DEFAULT 0');
                    await this.safeAddColumn('user_records', 'recent_incidents', 'INTEGER DEFAULT 0');
                    await this.safeAddColumn('user_records', 'last_incident_at', 'DATETIME');
                    await this.safeAddColumn('user_records', 'trust_score_cached', 'INTEGER');
                    await this.safeAddColumn('user_records', 'trust_score_updated_at', 'DATETIME');

                    // Create user_verifications table
                    await this.safeCreateTable('user_verifications', `
                        CREATE TABLE user_verifications (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            user_id TEXT NOT NULL,
                            verified INTEGER DEFAULT 0,
                            verified_at DATETIME,
                            verified_by TEXT,
                            verification_method TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE(guild_id, user_id)
                        )
                    `);

                    // Create warnings table
                    await this.safeCreateTable('warnings', `
                        CREATE TABLE warnings (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            user_id TEXT NOT NULL,
                            moderator_id TEXT,
                            reason TEXT,
                            active INTEGER DEFAULT 1,
                            expires_at DATETIME,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);

                    // Create strikes table
                    await this.safeCreateTable('strikes', `
                        CREATE TABLE strikes (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            user_id TEXT NOT NULL,
                            moderator_id TEXT,
                            reason TEXT,
                            severity INTEGER DEFAULT 1,
                            active INTEGER DEFAULT 1,
                            expires_at DATETIME,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);

                    // Create indexes
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_verifications_guild_user ON user_verifications(guild_id, user_id)`).catch(() => {});
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_warnings_guild_user ON warnings(guild_id, user_id)`).catch(() => {});
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_warnings_active ON warnings(active)`).catch(() => {});
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_strikes_guild_user ON strikes(guild_id, user_id)`).catch(() => {});
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_strikes_active ON strikes(active)`).catch(() => {});
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_user_records_trust ON user_records(guild_id, user_id, recent_incidents)`).catch(() => {});
                }
            },
            {
                version: '016_discord_user_2fa',
                name: 'Create discord_users_2fa table for OAuth 2FA',
                up: async () => {
                    await this.safeCreateTable('discord_users_2fa', `
                        CREATE TABLE discord_users_2fa (
                            discord_id TEXT PRIMARY KEY,
                            totp_secret TEXT,
                            totp_enabled INTEGER DEFAULT 0,
                            backup_codes TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            enabled_at DATETIME,
                            last_used DATETIME
                        )
                    `);
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_discord_2fa_enabled ON discord_users_2fa(discord_id, totp_enabled)`).catch(() => {});
                }
            },
            {
                version: '017_dashboard_updates',
                name: 'Create dashboard_updates table for announcements',
                up: async () => {
                    await this.safeCreateTable('dashboard_updates', `
                        CREATE TABLE dashboard_updates (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            title TEXT NOT NULL,
                            content TEXT NOT NULL,
                            type TEXT DEFAULT 'info',
                            priority INTEGER DEFAULT 0,
                            author_id TEXT,
                            author_name TEXT,
                            published INTEGER DEFAULT 1,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_updates_published ON dashboard_updates(published, created_at)`).catch(() => {});
                }
            },
            {
                version: '019_user_sessions',
                name: 'Create user sessions table for session management',
                up: async () => {
                    await this.safeCreateTable('user_sessions', `
                        CREATE TABLE user_sessions (
                            id TEXT PRIMARY KEY,
                            user_id TEXT NOT NULL,
                            device TEXT,
                            browser TEXT,
                            os TEXT,
                            ip_address TEXT,
                            user_agent TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
                            expires_at DATETIME NOT NULL
                        )
                    `);
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id)`).catch(() => {});
                    await this.run(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at)`).catch(() => {});
                }
            }
        ];
    }

    // ═══════════════════════════════════════════════════════════════════
    // MAIN RUNNER
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Run all pending migrations
     * Safe to call on every startup
     */
    async run() {
        let lockAcquired = false;

        try {
            this.acquireLock();
            lockAcquired = true;

            await this.ensureMigrationTable();

            const migrations = this.getMigrations();
            const batch = Date.now();
            let applied = 0;
            let skipped = 0;

            for (const migration of migrations) {
                if (await this.isApplied(migration.version)) {
                    skipped++;
                    continue;
                }

                const startTime = Date.now();
                this.logger.info(`🔄 Running migration: ${migration.name}`);

                try {
                    await migration.up();
                    const executionTime = Date.now() - startTime;
                    await this.recordMigration(migration.version, migration.name, batch, executionTime);
                    this.logger.info(`   ✅ Completed in ${executionTime}ms`);
                    applied++;
                } catch (err) {
                    this.logger.error(`   ❌ Failed: ${err.message}`);
                    throw err;
                }
            }

            if (applied === 0) {
                this.logger.info('✅ Database schema is up to date');
            } else {
                this.logger.info(`✅ Applied ${applied} migration(s), skipped ${skipped}`);
            }

            return { success: true, applied, skipped };

        } finally {
            if (lockAcquired) {
                this.releaseLock();
            }
        }
    }

    /**
     * Get current migration status
     */
    async status() {
        await this.ensureMigrationTable();

        const applied = await this.all(
            `SELECT version, name, applied_at, execution_time_ms FROM schema_migrations WHERE status='applied' ORDER BY applied_at`
        );

        const allMigrations = this.getMigrations();
        const appliedVersions = new Set(applied.map(m => m.version));
        const pending = allMigrations.filter(m => !appliedVersions.has(m.version));

        return {
            applied: applied.length,
            pending: pending.length,
            appliedMigrations: applied,
            pendingMigrations: pending.map(m => ({ version: m.version, name: m.name }))
        };
    }
}

module.exports = MigrationRunner;
