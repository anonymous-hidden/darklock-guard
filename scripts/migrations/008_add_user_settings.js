/**
 * Migration: Add settings_json column to admin_users table
 * Stores user-specific dashboard settings (theme, notifications, etc.)
 */

module.exports = {
    version: 8,
    name: 'add_user_settings',
    description: 'Add settings_json column for user dashboard preferences',

    async up(db) {
        // Check if column already exists
        const tableInfo = await db.all("PRAGMA table_info(admin_users)");
        const hasSettingsColumn = tableInfo.some(col => col.name === 'settings_json');
        
        if (!hasSettingsColumn) {
            await db.run(`
                ALTER TABLE admin_users 
                ADD COLUMN settings_json TEXT DEFAULT '{}'
            `);
            console.log('[Migration 008] Added settings_json column to admin_users');
        } else {
            console.log('[Migration 008] settings_json column already exists');
        }
    },

    async down(db) {
        // SQLite doesn't support DROP COLUMN easily, so we'd need to recreate the table
        // For now, just log that this migration can't be rolled back
        console.log('[Migration 008] Rollback not supported - column will remain');
    }
};
