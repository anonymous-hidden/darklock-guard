/**
 * Migration: Create discord_users_2fa table for OAuth users
 * This enables 2FA for users who log in via Discord OAuth
 */

module.exports = {
    name: '009_discord_user_2fa',
    
    async up(db) {
        // Create table for Discord user 2FA settings
        await db.run(`
            CREATE TABLE IF NOT EXISTS discord_users_2fa (
                discord_id TEXT PRIMARY KEY,
                totp_secret TEXT,
                totp_enabled INTEGER DEFAULT 0,
                backup_codes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                enabled_at DATETIME,
                last_used DATETIME
            )
        `);
        
        console.log('[Migration 009] Created discord_users_2fa table');
        
        // Create index for faster lookups
        await db.run(`
            CREATE INDEX IF NOT EXISTS idx_discord_2fa_enabled 
            ON discord_users_2fa (discord_id, totp_enabled)
        `);
        
        console.log('[Migration 009] Created index on discord_users_2fa');
    },
    
    async down(db) {
        await db.run('DROP TABLE IF EXISTS discord_users_2fa');
        console.log('[Migration 009] Dropped discord_users_2fa table');
    }
};
