/**
 * Migration script to add missing columns to maintenance_state table
 */

const db = require('./utils/database');

async function runMigration() {
    console.log('[Migration] Starting maintenance_state table migration...');
    
    await db.initialize();
    
    const columns = [
        { name: 'title', sql: 'ALTER TABLE maintenance_state ADD COLUMN title TEXT DEFAULT "Scheduled Maintenance"' },
        { name: 'subtitle', sql: 'ALTER TABLE maintenance_state ADD COLUMN subtitle TEXT DEFAULT "We\'ll be back shortly"' },
        { name: 'status_updates', sql: 'ALTER TABLE maintenance_state ADD COLUMN status_updates TEXT' }
    ];
    
    for (const col of columns) {
        try {
            await db.run(col.sql);
            console.log(`✅ Added column: ${col.name}`);
        } catch (error) {
            if (error.message.includes('duplicate column name')) {
                console.log(`⏭️  Column already exists: ${col.name}`);
            } else {
                console.error(`❌ Error adding column ${col.name}:`, error.message);
            }
        }
    }
    
    console.log('[Migration] Migration complete!');
    process.exit(0);
}

runMigration().catch(error => {
    console.error('[Migration] Fatal error:', error);
    process.exit(1);
});
