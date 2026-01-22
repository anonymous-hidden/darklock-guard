/**
 * Migration 001: Initial Database Schema
 * Creates all base tables for the security bot
 */

module.exports = {
    description: 'Initial database schema with all core tables',

    async up(db) {
        // Guild configuration tables
        await db.run(`
            CREATE TABLE IF NOT EXISTS guild_configs (
                guild_id TEXT PRIMARY KEY,
                settings_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id TEXT PRIMARY KEY,
                mod_log_channel TEXT,
                admin_log_channel TEXT,
                security_log_channel TEXT,
                welcome_channel TEXT,
                welcome_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tickets
        await db.run(`
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                ticket_id TEXT,
                user_id TEXT NOT NULL,
                channel_id TEXT,
                moderator_id TEXT,
                assigned_to TEXT,
                assigned_to_name TEXT,
                status TEXT DEFAULT 'open',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                closed_at DATETIME,
                reopened_count INTEGER DEFAULT 0,
                total_messages INTEGER DEFAULT 0,
                subject TEXT,
                description TEXT,
                last_message_at DATETIME,
                escalated INTEGER DEFAULT 0,
                escalated_at DATETIME,
                escalated_by TEXT,
                dm_notify INTEGER DEFAULT 1,
                first_response_at DATETIME,
                user_tag TEXT,
                user_avatar TEXT,
                category TEXT
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS active_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                ticket_id TEXT,
                channel_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                moderator_id TEXT,
                assigned_to TEXT,
                assigned_to_name TEXT,
                status TEXT DEFAULT 'open',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                subject TEXT,
                description TEXT,
                last_message_at DATETIME,
                escalated INTEGER DEFAULT 0,
                escalated_at DATETIME,
                escalated_by TEXT,
                dm_notify INTEGER DEFAULT 1,
                first_response_at DATETIME,
                user_tag TEXT,
                user_avatar TEXT
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS ticket_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                content TEXT,
                attachments TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(message_id)
            )
        `);

        // Moderation actions (IMMUTABLE)
        await db.run(`
            CREATE TABLE IF NOT EXISTS mod_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                moderator_id TEXT NOT NULL,
                moderator_tag TEXT,
                target_id TEXT,
                target_tag TEXT,
                action TEXT NOT NULL,
                reason TEXT,
                duration_ms INTEGER,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                action_json TEXT,
                details TEXT,
                target_tag TEXT,
                requires_2fa INTEGER DEFAULT 0,
                confirmed INTEGER DEFAULT 0,
                device_fingerprint TEXT
            )
        `);

        // Logging tables
        await db.run(`
            CREATE TABLE IF NOT EXISTS bot_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                user_id TEXT,
                user_tag TEXT,
                guild_id TEXT,
                channel_id TEXT,
                command TEXT,
                endpoint TEXT,
                payload TEXT,
                success INTEGER DEFAULT 1,
                duration_ms INTEGER,
                error TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS dashboard_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id TEXT,
                admin_tag TEXT,
                guild_id TEXT,
                event_type TEXT NOT NULL,
                before_data TEXT,
                after_data TEXT,
                ip TEXT,
                user_agent TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS security_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                user_id TEXT,
                action TEXT,
                target_id TEXT,
                details TEXT,
                event_type TEXT,
                before_data TEXT,
                after_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Security & verification
        await db.run(`
            CREATE TABLE IF NOT EXISTS user_verifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME,
                UNIQUE(guild_id, user_id)
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS verification_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                challenge_type TEXT,
                challenge_data TEXT,
                attempts INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME,
                risk_score INTEGER DEFAULT 50,
                device_fingerprint TEXT,
                ip_hash TEXT
            )
        `);

        // Create indexes for better query performance
        await db.run(`CREATE INDEX IF NOT EXISTS idx_bot_logs_type ON bot_logs(type)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_bot_logs_guild ON bot_logs(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_bot_logs_user ON bot_logs(user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_bot_logs_created ON bot_logs(created_at)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_dashboard_audit_guild ON dashboard_audit(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_dashboard_audit_admin ON dashboard_audit(admin_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_dashboard_audit_created ON dashboard_audit(created_at)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_mod_actions_guild ON mod_actions(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_mod_actions_moderator ON mod_actions(moderator_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_mod_actions_target ON mod_actions(target_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_active_tickets_guild ON active_tickets(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_security_logs_guild ON security_logs(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_user_verifications_guild ON user_verifications(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_user_verifications_user ON user_verifications(user_id)`);
    }
};
