/**
 * Migration 004: Create User Records & Risk Assessment Tables
 * Tracks user behavior, risk scores, and trust levels
 */

module.exports = {
    description: 'Create user records and risk assessment tables',

    async up(db) {
        // User records with risk assessment
        await db.run(`
            CREATE TABLE IF NOT EXISTS user_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                guild_id TEXT,
                risk_score INTEGER DEFAULT 50,
                behavior_score INTEGER DEFAULT 50,
                pattern_flags TEXT DEFAULT '[]',
                avatar_url TEXT,
                manual_override INTEGER DEFAULT 0,
                last_trust_recovery DATETIME,
                first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, guild_id)
            )
        `);

        // Phishing attempts tracking
        await db.run(`
            CREATE TABLE IF NOT EXISTS phishing_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                message_id TEXT,
                url TEXT,
                detected_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // User behavior tracking
        await db.run(`
            CREATE TABLE IF NOT EXISTS user_behavior (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                action_type TEXT,
                details TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Indexes for user tables
        await db.run(`CREATE INDEX IF NOT EXISTS idx_user_records_user ON user_records(user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_user_records_guild ON user_records(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_user_records_risk ON user_records(risk_score)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_phishing_attempts_guild ON phishing_attempts(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_phishing_attempts_user ON phishing_attempts(user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_user_behavior_guild ON user_behavior(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_user_behavior_user ON user_behavior(user_id)`);
    }
};
