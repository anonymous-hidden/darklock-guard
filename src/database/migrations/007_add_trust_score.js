/**
 * Migration 007: Add Trust Score System Columns
 * 
 * Adds columns needed by the TrustScore system to track:
 * - spam_flags: Count of spam-related incidents
 * - recent_incidents: Count of incidents in rolling 30-day window
 * - last_incident_at: Timestamp of most recent incident
 * - trust_score_cached: Cached trust score (calculated on demand)
 * - trust_score_updated_at: When trust score was last calculated
 */

module.exports = {
    description: 'Add trust score tracking columns to user_records',

    async up(db) {
        // Add trust score columns to user_records
        // Using ALTER TABLE with individual ADD COLUMN for SQLite compatibility
        
        const columns = [
            { name: 'spam_flags', def: 'INTEGER DEFAULT 0' },
            { name: 'recent_incidents', def: 'INTEGER DEFAULT 0' },
            { name: 'last_incident_at', def: 'DATETIME' },
            { name: 'trust_score_cached', def: 'INTEGER' },
            { name: 'trust_score_updated_at', def: 'DATETIME' }
        ];

        for (const col of columns) {
            try {
                await db.run(`ALTER TABLE user_records ADD COLUMN ${col.name} ${col.def}`);
                console.log(`    Added column: ${col.name}`);
            } catch (e) {
                // Column may already exist - SQLite doesn't have IF NOT EXISTS for columns
                if (!e.message.includes('duplicate column')) {
                    throw e;
                }
                console.log(`    Column ${col.name} already exists, skipping`);
            }
        }

        // Create user_verifications table for verification status
        await db.run(`
            CREATE TABLE IF NOT EXISTS user_verifications (
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

        // Create warnings table if not exists
        await db.run(`
            CREATE TABLE IF NOT EXISTS warnings (
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

        // Create strikes table if not exists
        await db.run(`
            CREATE TABLE IF NOT EXISTS strikes (
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

        // Create indexes for new tables
        await db.run(`CREATE INDEX IF NOT EXISTS idx_verifications_guild_user 
            ON user_verifications(guild_id, user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_warnings_guild_user 
            ON warnings(guild_id, user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_warnings_active 
            ON warnings(active)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_strikes_guild_user 
            ON strikes(guild_id, user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_strikes_active 
            ON strikes(active)`);

        // Index for trust score queries
        await db.run(`CREATE INDEX IF NOT EXISTS idx_user_records_trust 
            ON user_records(guild_id, user_id, recent_incidents)`);
    },

    async down(db) {
        // SQLite doesn't support DROP COLUMN easily
        // Would need to recreate table - skip for now
        console.log('    Rollback not supported for column additions in SQLite');
    }
};
