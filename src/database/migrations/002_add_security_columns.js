/**
 * Migration 002: Add Core Guild Configuration Columns
 * Adds essential guild configuration columns for security features
 */

module.exports = {
    description: 'Add core guild configuration columns',

    async up(db) {
        // Security settings
        const securityColumns = [
            { name: 'antiraid_enabled', type: 'INTEGER DEFAULT 1' },
            { name: 'antispam_enabled', type: 'INTEGER DEFAULT 1' },
            { name: 'antiphishing_enabled', type: 'INTEGER DEFAULT 1' },
            { name: 'antilinks_enabled', type: 'INTEGER DEFAULT 1' },
            { name: 'verification_enabled', type: 'INTEGER DEFAULT 1' },
            { name: 'antinuke_enabled', type: 'BOOLEAN DEFAULT 0' },
            { name: 'antinuke_role_limit', type: 'INTEGER DEFAULT 3' }
        ];

        for (const col of securityColumns) {
            try {
                await db.run(`ALTER TABLE guild_configs ADD COLUMN ${col.name} ${col.type}`);
                console.log(`    ✅ Added ${col.name} to guild_configs`);
            } catch (e) {
                // Column already exists
            }
        }

        // Ticket system columns
        const ticketColumns = [
            { name: 'ticket_channel_id', type: 'TEXT' },
            { name: 'ticket_category_id', type: 'TEXT' },
            { name: 'ticket_manage_role', type: 'TEXT' },
            { name: 'ticket_log_channel', type: 'TEXT' }
        ];

        for (const col of ticketColumns) {
            try {
                await db.run(`ALTER TABLE guild_configs ADD COLUMN ${col.name} ${col.type}`);
                console.log(`    ✅ Added ${col.name} to guild_configs`);
            } catch (e) {
                // Column already exists
            }
        }

        // Subscription & billing
        const billingColumns = [
            { name: 'pro_enabled', type: 'INTEGER DEFAULT 0' },
            { name: 'pro_expires_at', type: 'DATETIME' }
        ];

        for (const col of billingColumns) {
            try {
                await db.run(`ALTER TABLE guild_configs ADD COLUMN ${col.name} ${col.type}`);
                console.log(`    ✅ Added ${col.name} to guild_configs`);
            } catch (e) {
                // Column already exists
            }
        }
    }
};
