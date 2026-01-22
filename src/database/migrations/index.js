/**
 * Database Migration System
 * Manages versioned schema migrations with tracking and rollback support
 */

const fs = require('fs');
const path = require('path');

class MigrationRunner {
    constructor(database) {
        this.db = database;
        this.migrationsPath = __dirname;
    }

    /**
     * Initialize the schema_version tracking table
     */
    async ensureVersionTable() {
        try {
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    executed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    execution_time_ms INTEGER,
                    status TEXT DEFAULT 'success',
                    error_message TEXT
                )
            `);
            console.log('✅ Schema version table ready');
        } catch (error) {
            console.error('❌ Failed to create schema_version table:', error);
            throw error;
        }
    }

    /**
     * Get current schema version
     */
    async getCurrentVersion() {
        try {
            const result = await this.db.get('SELECT MAX(version) as version FROM schema_version WHERE status = ?', ['success']);
            return result?.version || 0;
        } catch (error) {
            // Table doesn't exist yet
            return 0;
        }
    }

    /**
     * Get all migration files sorted by version
     */
    getMigrationFiles() {
        const files = fs.readdirSync(this.migrationsPath)
            .filter(f => /^\d+_.*\.js$/.test(f) && f !== 'index.js')
            .sort((a, b) => {
                const versionA = parseInt(a.split('_')[0]);
                const versionB = parseInt(b.split('_')[0]);
                return versionA - versionB;
            });

        return files.map(file => {
            const match = file.match(/^(\d+)_(.*)\.js$/);
            return {
                version: parseInt(match[1]),
                name: match[2],
                filename: file,
                path: path.join(this.migrationsPath, file)
            };
        });
    }

    /**
     * Execute pending migrations
     */
    async runPendingMigrations() {
        try {
            // Ensure version table exists
            await this.ensureVersionTable();

            const currentVersion = await this.getCurrentVersion();
            const allMigrations = this.getMigrationFiles();
            const pendingMigrations = allMigrations.filter(m => m.version > currentVersion);

            if (pendingMigrations.length === 0) {
                console.log('✅ Database is up to date (version', currentVersion, ')');
                return true;
            }

            console.log(`🔄 Running ${pendingMigrations.length} pending migration(s)...`);

            for (const migration of pendingMigrations) {
                await this.executeMigration(migration);
            }

            console.log('✅ All migrations completed successfully');
            return true;
        } catch (error) {
            console.error('❌ Migration failed:', error);
            throw error;
        }
    }

    /**
     * Execute a single migration
     */
    async executeMigration(migration) {
        const startTime = Date.now();

        try {
            console.log(`  → Migration ${migration.version}: ${migration.name}...`);

            // Load migration module
            const migrationModule = require(migration.path);

            // Validate migration has up() method
            if (typeof migrationModule.up !== 'function') {
                throw new Error(`Migration ${migration.filename} must export an 'up' function`);
            }

            // Execute migration
            await migrationModule.up(this.db);

            const executionTime = Date.now() - startTime;

            // Record success
            await this.db.run(
                `INSERT INTO schema_version (version, name, description, execution_time_ms, status, error_message)
                 VALUES (?, ?, ?, ?, 'success', NULL)`,
                [migration.version, migration.name, migrationModule.description || '', executionTime]
            );

            console.log(`    ✅ Completed in ${executionTime}ms`);
        } catch (error) {
            const executionTime = Date.now() - startTime;

            // Record failure
            await this.db.run(
                `INSERT INTO schema_version (version, name, description, execution_time_ms, status, error_message)
                 VALUES (?, ?, ?, ?, 'failed', ?)`,
                [migration.version, migration.name, '', executionTime, error.message]
            );

            console.error(`    ❌ Failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get migration history
     */
    async getMigrationHistory() {
        try {
            const rows = await this.db.all(
                `SELECT * FROM schema_version ORDER BY version ASC`
            );
            return rows || [];
        } catch (error) {
            return [];
        }
    }

    /**
     * Print migration status
     */
    async printStatus() {
        const currentVersion = await this.getCurrentVersion();
        const history = await this.getMigrationHistory();
        const allMigrations = this.getMigrationFiles();

        console.log('\n📊 Database Schema Status:');
        console.log(`   Current version: ${currentVersion}`);
        console.log(`   Total migrations: ${allMigrations.length}`);
        console.log(`   Applied: ${history.filter(h => h.status === 'success').length}`);
        console.log(`   Failed: ${history.filter(h => h.status === 'failed').length}`);

        if (history.length > 0) {
            console.log('\n   Recent migrations:');
            history.slice(-5).forEach(h => {
                const icon = h.status === 'success' ? '✅' : '❌';
                console.log(`     ${icon} v${h.version}: ${h.name} (${h.execution_time_ms}ms)`);
            });
        }
    }
}

module.exports = MigrationRunner;
