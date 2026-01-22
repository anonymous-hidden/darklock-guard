/**
 * Migration: Add admin permission columns to guild_configs
 * 
 * This migration adds separate permission columns for admin roles,
 * allowing different permissions for admins vs moderators.
 */

const Database = require('better-sqlite3');
const path = require('path');

function runMigration() {
    const dbPath = process.env.DB_PATH 
        ? path.join(process.env.DB_PATH, 'security_bot.db')
        : path.join(__dirname, '../../data/security_bot.db');
    
    console.log(`📊 Running migration on database: ${dbPath}`);
    
    const db = new Database(dbPath);
    
    try {
        // Check if columns already exist
        const tableInfo = db.pragma('table_info(guild_configs)');
        const hasAdminPerms = tableInfo.some(col => col.name === 'admin_perm_tickets');
        
        if (hasAdminPerms) {
            console.log('✅ Admin permission columns already exist. Skipping migration.');
            db.close();
            return;
        }
        
        console.log('📝 Adding admin permission columns...');
        
        // Add admin permission columns (default to 1 = enabled for admins)
        db.exec(`
            ALTER TABLE guild_configs ADD COLUMN admin_perm_tickets BOOLEAN DEFAULT 1;
            ALTER TABLE guild_configs ADD COLUMN admin_perm_analytics BOOLEAN DEFAULT 1;
            ALTER TABLE guild_configs ADD COLUMN admin_perm_security BOOLEAN DEFAULT 1;
            ALTER TABLE guild_configs ADD COLUMN admin_perm_overview BOOLEAN DEFAULT 1;
            ALTER TABLE guild_configs ADD COLUMN admin_perm_customize BOOLEAN DEFAULT 1;
        `);
        
        // Update existing rows to have full admin permissions
        db.exec(`
            UPDATE guild_configs 
            SET admin_perm_tickets = 1,
                admin_perm_analytics = 1,
                admin_perm_security = 1,
                admin_perm_overview = 1,
                admin_perm_customize = 1
            WHERE admin_perm_tickets IS NULL;
        `);
        
        console.log('✅ Migration completed successfully!');
        console.log('📊 Admin permission columns added:');
        console.log('   - admin_perm_tickets');
        console.log('   - admin_perm_analytics');
        console.log('   - admin_perm_security');
        console.log('   - admin_perm_overview');
        console.log('   - admin_perm_customize');
        
        db.close();
    } catch (error) {
        console.error('❌ Migration failed:', error);
        db.close();
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    require('dotenv').config({ path: path.join(__dirname, '../../.env') });
    runMigration();
}

module.exports = { runMigration };
