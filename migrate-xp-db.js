/**
 * Migration script to add time-based XP tracking columns
 * Run this once to update the XP database schema
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data/xp.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Failed to open database:', err.message);
        process.exit(1);
    }
    console.log('✅ Connected to database at:', dbPath);
});

console.log('🔄 Running XP database migration...');

// Add new columns for time-based tracking
const migrations = [
    `ALTER TABLE user_xp ADD COLUMN daily_xp INTEGER DEFAULT 0`,
    `ALTER TABLE user_xp ADD COLUMN weekly_xp INTEGER DEFAULT 0`,
    `ALTER TABLE user_xp ADD COLUMN monthly_xp INTEGER DEFAULT 0`,
    `ALTER TABLE user_xp ADD COLUMN daily_reset INTEGER DEFAULT (strftime('%s', 'now'))`,
    `ALTER TABLE user_xp ADD COLUMN weekly_reset INTEGER DEFAULT (strftime('%s', 'now'))`,
    `ALTER TABLE user_xp ADD COLUMN monthly_reset INTEGER DEFAULT (strftime('%s', 'now'))`
];

// Create new indexes
const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_guild_daily_xp ON user_xp(guild_id, daily_xp DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_guild_weekly_xp ON user_xp(guild_id, weekly_xp DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_guild_monthly_xp ON user_xp(guild_id, monthly_xp DESC)`
];

let completed = 0;
let failed = 0;

// Run migrations
migrations.forEach((sql, index) => {
    db.run(sql, (err) => {
        if (err) {
            // Ignore "duplicate column" errors
            if (err.message.includes('duplicate column')) {
                console.log(`⏭️  Column already exists (skipping)`);
                completed++;
            } else {
                console.error(`❌ Migration ${index + 1} failed:`, err.message);
                failed++;
            }
        } else {
            console.log(`✅ Migration ${index + 1} completed`);
            completed++;
        }
        
        // Once all migrations done, create indexes
        if (completed + failed === migrations.length) {
            createIndexes();
        }
    });
});

function createIndexes() {
    let indexCount = 0;
    
    indexes.forEach((sql, index) => {
        db.run(sql, (err) => {
            if (err) {
                console.error(`❌ Index ${index + 1} failed:`, err.message);
            } else {
                console.log(`✅ Index ${index + 1} created`);
            }
            
            indexCount++;
            if (indexCount === indexes.length) {
                finish();
            }
        });
    });
}

function finish() {
    db.close((err) => {
        if (err) {
            console.error('❌ Error closing database:', err.message);
        }
        console.log('\n✅ Migration complete!');
        console.log(`   Migrations: ${completed} completed, ${failed} failed`);
        console.log('   Database updated successfully\n');
    });
}
