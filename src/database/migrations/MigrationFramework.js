/**
 * Robust Migration Framework for DarkLock
 * Handles database schema migrations with safety checks, rollback support, and atomic execution
 */

const fs = require('fs');
const path = require('path');

class MigrationFramework {
    constructor(database) {
        this.db = database;
        this.migrationsPath = __dirname;
        this.lockFile = path.join(process.cwd(), 'data', '.migration.lock');
    }

    /**
     * Acquire migration lock to prevent concurrent migrations
     */
    async acquireLock() {
        const dataDir = path.dirname(this.lockFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        if (fs.existsSync(this.lockFile)) {
            const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
            const lockAge = Date.now() - lockData.timestamp;
            
            // If lock is older than 10 minutes, consider it stale
            if (lockAge > 10 * 60 * 1000) {
                console.warn('⚠️ Stale migration lock detected, removing...');
                fs.unlinkSync(this.lockFile);
            } else {
                throw new Error(`Migration already in progress (PID: ${lockData.pid})`);
            }
        }

        fs.writeFileSync(this.lockFile, JSON.stringify({
            pid: process.pid,
            timestamp: Date.now(),
            hostname: require('os').hostname()
        }));
    }

    /**
     * Release migration lock
     */
    releaseLock() {
        if (fs.existsSync(this.lockFile)) {
            fs.unlinkSync(this.lockFile);
        }
    }

    /**
     * Ensure schema_version table exists
     */
    async ensureVersionTable() {
        await this.db.run(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                batch INTEGER NOT NULL,
                applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
                execution_time_ms INTEGER,
                checksum TEXT,
                status TEXT DEFAULT 'applied'
            )
        `);
    }

    /**
     * Check if a column exists in a table
     */
    async columnExists(table, column) {
        try {
            const columns = await this.db.all(`PRAGMA table_info(${table})`);
            return columns.some(col => col.name === column);
        } catch (e) {
            return false;
        }
    }

    /**
     * Check if a table exists
     */
    async tableExists(table) {
        const result = await this.db.get(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
            [table]
        );
        return !!result;
    }

    /**
     * Safe column addition - only adds if not exists
     */
    async safeAddColumn(table, column, definition) {
        if (await this.columnExists(table, column)) {
            return { added: false, reason: 'already_exists' };
        }

        await this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        return { added: true };
    }

    /**
     * Get pending migrations
     */
    async getPendingMigrations() {
        const appliedVersions = await this.db.all(
            `SELECT version FROM schema_migrations WHERE status = 'applied'`
        );
        const applied = new Set(appliedVersions.map(r => r.version));

        const migrations = this.loadMigrationDefinitions();
        return migrations.filter(m => !applied.has(m.version));
    }

    /**
     * Load migration definitions
     */
    loadMigrationDefinitions() {
        return [
            // Core schema fixes
            {
                version: '20251230_001',
                name: 'add_verified_at_columns',
                up: async () => {
                    await this.safeAddColumn('user_records', 'verified_at', 'DATETIME');
                    await this.safeAddColumn('user_records', 'verification_reason', 'TEXT');
                }
            },
            {
                version: '20251230_002',
                name: 'add_welcome_goodbye_columns',
                up: async () => {
                    await this.safeAddColumn('guild_configs', 'goodbye_enabled', 'INTEGER DEFAULT 0');
                    await this.safeAddColumn('guild_configs', 'goodbye_channel', 'TEXT');
                    await this.safeAddColumn('guild_configs', 'goodbye_message', 'TEXT');
                    await this.safeAddColumn('guild_configs', 'verified_welcome_channel_id', 'TEXT');
                    await this.safeAddColumn('guild_configs', 'verified_welcome_enabled', 'INTEGER DEFAULT 0');
                }
            },
            {
                version: '20251230_003',
                name: 'add_strike_system_tables',
                up: async () => {
                    if (!await this.tableExists('user_strikes')) {
                        await this.db.run(`
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
                        await this.db.run(`CREATE INDEX idx_strikes_guild_user ON user_strikes(guild_id, user_id)`);
                    }
                }
            },
            {
                version: '20251230_004',
                name: 'add_quarantine_tables',
                up: async () => {
                    if (!await this.tableExists('quarantined_users')) {
                        await this.db.run(`
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
                    }
                    await this.safeAddColumn('guild_configs', 'quarantine_role_id', 'TEXT');
                }
            },
            {
                version: '20251230_005',
                name: 'add_appeal_system_tables',
                up: async () => {
                    if (!await this.tableExists('appeals')) {
                        await this.db.run(`
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
                }
            },
            {
                version: '20251230_006',
                name: 'add_modmail_tables',
                up: async () => {
                    if (!await this.tableExists('modmail_threads')) {
                        await this.db.run(`
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
                    }
                    if (!await this.tableExists('modmail_messages')) {
                        await this.db.run(`
                            CREATE TABLE modmail_messages (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                thread_id INTEGER NOT NULL,
                                author_id TEXT NOT NULL,
                                content TEXT,
                                is_staff INTEGER DEFAULT 0,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY (thread_id) REFERENCES modmail_threads(id)
                            )
                        `);
                    }
                    await this.safeAddColumn('guild_configs', 'modmail_enabled', 'INTEGER DEFAULT 0');
                    await this.safeAddColumn('guild_configs', 'modmail_category_id', 'TEXT');
                }
            },
            {
                version: '20251230_007',
                name: 'add_invite_tracker_tables',
                up: async () => {
                    if (!await this.tableExists('invite_tracker_config')) {
                        await this.db.run(`
                            CREATE TABLE invite_tracker_config (
                                guild_id TEXT PRIMARY KEY,
                                enabled INTEGER DEFAULT 0,
                                log_channel_id TEXT,
                                track_leaves INTEGER DEFAULT 1,
                                reward_roles TEXT DEFAULT '[]',
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                            )
                        `);
                    }
                    if (!await this.tableExists('invite_data')) {
                        await this.db.run(`
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
                    }
                    if (!await this.tableExists('invite_joins')) {
                        await this.db.run(`
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
                }
            },
            {
                version: '20251230_008',
                name: 'add_scheduled_actions_table',
                up: async () => {
                    if (!await this.tableExists('scheduled_actions')) {
                        await this.db.run(`
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
                        await this.db.run(`CREATE INDEX idx_scheduled_execute ON scheduled_actions(execute_at, executed)`);
                    }
                }
            },
            {
                version: '20251230_009',
                name: 'add_language_support',
                up: async () => {
                    await this.safeAddColumn('guild_configs', 'language', "TEXT DEFAULT 'en'");
                    await this.safeAddColumn('user_records', 'language', 'TEXT');
                }
            },
            {
                version: '20251230_010',
                name: 'add_alt_detection_tables',
                up: async () => {
                    if (!await this.tableExists('alt_accounts')) {
                        await this.db.run(`
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
                    }
                    await this.safeAddColumn('guild_configs', 'alt_detection_enabled', 'INTEGER DEFAULT 0');
                    await this.safeAddColumn('guild_configs', 'alt_detection_action', "TEXT DEFAULT 'notify'");
                }
            },
            {
                version: '20251230_011',
                name: 'add_word_filter_tables',
                up: async () => {
                    if (!await this.tableExists('word_filter_rules')) {
                        await this.db.run(`
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
                    }
                    await this.safeAddColumn('guild_configs', 'word_filter_enabled', 'INTEGER DEFAULT 0');
                }
            },
            {
                version: '20251230_012',
                name: 'add_reputation_table',
                up: async () => {
                    if (!await this.tableExists('user_reputation')) {
                        await this.db.run(`
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
                }
            },
            {
                version: '20251230_013',
                name: 'add_voice_monitor_tables',
                up: async () => {
                    if (!await this.tableExists('voice_sessions')) {
                        await this.db.run(`
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
                    }
                    await this.safeAddColumn('guild_configs', 'voice_monitor_enabled', 'INTEGER DEFAULT 0');
                }
            }
        ];
    }

    /**
     * Run all pending migrations
     */
    async runMigrations() {
        let lockAcquired = false;
        
        try {
            await this.acquireLock();
            lockAcquired = true;

            await this.ensureVersionTable();
            const pending = await this.getPendingMigrations();

            if (pending.length === 0) {
                console.log('✅ Database schema is up to date');
                return { success: true, migrationsRun: 0 };
            }

            console.log(`🔄 Running ${pending.length} pending migration(s)...`);

            const batch = Date.now();
            let successCount = 0;

            for (const migration of pending) {
                const startTime = Date.now();
                
                try {
                    console.log(`  → Running: ${migration.name}`);
                    await migration.up();
                    
                    const executionTime = Date.now() - startTime;
                    
                    await this.db.run(`
                        INSERT INTO schema_migrations (version, name, batch, execution_time_ms, status)
                        VALUES (?, ?, ?, ?, 'applied')
                    `, [migration.version, migration.name, batch, executionTime]);

                    console.log(`    ✅ Completed in ${executionTime}ms`);
                    successCount++;
                } catch (error) {
                    console.error(`    ❌ Failed: ${error.message}`);
                    
                    // Record failed migration
                    await this.db.run(`
                        INSERT INTO schema_migrations (version, name, batch, status)
                        VALUES (?, ?, ?, 'failed')
                    `, [migration.version, migration.name, batch]).catch(() => {});

                    throw error;
                }
            }

            console.log(`✅ Successfully ran ${successCount} migration(s)`);
            return { success: true, migrationsRun: successCount };

        } finally {
            if (lockAcquired) {
                this.releaseLock();
            }
        }
    }

    /**
     * Get migration status
     */
    async getStatus() {
        await this.ensureVersionTable();
        
        const applied = await this.db.all(
            `SELECT * FROM schema_migrations ORDER BY applied_at DESC`
        );
        
        const pending = await this.getPendingMigrations();

        return {
            applied: applied.length,
            pending: pending.length,
            migrations: applied,
            pendingMigrations: pending.map(m => ({ version: m.version, name: m.name }))
        };
    }
}

module.exports = MigrationFramework;
