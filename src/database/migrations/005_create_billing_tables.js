/**
 * Migration 005: Create Billing & Pro Plan Tables
 * Tables for subscription management and activation codes
 */

module.exports = {
    description: 'Create billing and pro plan tables',

    async up(db) {
        // Users table for billing
        await db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT,
                is_pro INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Activation codes
        await db.run(`
            CREATE TABLE IF NOT EXISTS activation_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                code TEXT NOT NULL,
                used INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                used_at DATETIME,
                paypal_order_id TEXT
            )
        `);

        // Pro codes for plan unlocks
        await db.run(`
            CREATE TABLE IF NOT EXISTS pro_codes (
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
            )
        `);

        // Pro redemptions tracking
        await db.run(`
            CREATE TABLE IF NOT EXISTS pro_redemptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL,
                user_id TEXT NOT NULL,
                guild_id TEXT,
                redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(code) REFERENCES pro_codes(code)
            )
        `);

        // Guild subscriptions
        await db.run(`
            CREATE TABLE IF NOT EXISTS guild_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                plan_type TEXT DEFAULT 'free',
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME,
                UNIQUE(guild_id)
            )
        `);

        // Indexes for billing tables
        await db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_activation_codes_code ON activation_codes(code)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_pro_codes_code ON pro_codes(code)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_pro_redemptions_user ON pro_redemptions(user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_pro_redemptions_guild ON pro_redemptions(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_guild_subscriptions_guild ON guild_subscriptions(guild_id)`);
    }
};
