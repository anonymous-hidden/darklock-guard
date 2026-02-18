/**
 * Database Schema Fix - Adds missing columns to guild_configs
 * This script adds all missing moderation and settings columns
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'security_bot.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Starting database schema fix...');
console.log(`📂 Database: ${dbPath}\n`);

// List of all columns that should exist in guild_configs
const requiredColumns = [
    // Moderation columns
    { name: 'auto_mod_enabled', type: 'BOOLEAN DEFAULT 0' },
    { name: 'xp_enabled', type: 'BOOLEAN DEFAULT 1' },
    { name: 'xp_per_message', type: 'INTEGER DEFAULT 15' },
    { name: 'xp_cooldown', type: 'INTEGER DEFAULT 60' },
    { name: 'level_up_channel', type: 'TEXT' },
    { name: 'xp_multiplier', type: 'REAL DEFAULT 1.0' },
    { name: 'voice_xp_enabled', type: 'BOOLEAN DEFAULT 1' },
    { name: 'voice_xp_per_minute', type: 'INTEGER DEFAULT 5' },
    { name: 'min_voice_time', type: 'INTEGER DEFAULT 60' },
    { name: 'level_announcement', type: 'BOOLEAN DEFAULT 1' },
    { name: 'level_up_message', type: 'TEXT' },
    
    // Timeout settings
    { name: 'auto_timeout_enabled', type: 'BOOLEAN DEFAULT 0' },
    { name: 'default_timeout_duration', type: 'INTEGER DEFAULT 60' },
    { name: 'max_timeout_duration', type: 'INTEGER DEFAULT 40320' },
    { name: 'spam_timeout_duration', type: 'INTEGER DEFAULT 5' },
    { name: 'toxicity_timeout_duration', type: 'INTEGER DEFAULT 30' },
    { name: 'dm_timeout_notification', type: 'BOOLEAN DEFAULT 1' },
    
    // Warning system
    { name: 'warning_system_enabled', type: 'BOOLEAN DEFAULT 1' },
    { name: 'warnings_before_timeout', type: 'INTEGER DEFAULT 3' },
    { name: 'warnings_before_kick', type: 'INTEGER DEFAULT 5' },
    { name: 'dm_warning_notification', type: 'BOOLEAN DEFAULT 1' },
    
    // Appeal system
    { name: 'appeal_system_enabled', type: 'BOOLEAN DEFAULT 0' },
    { name: 'appeal_review_channel', type: 'TEXT' },
    { name: 'appeal_cooldown_hours', type: 'INTEGER DEFAULT 168' },
    { name: 'appeal_auto_dm', type: 'BOOLEAN DEFAULT 1' },
    { name: 'appeal_url', type: 'TEXT' },
    { name: 'appeal_message_template', type: 'TEXT' },
    { name: 'appeal_require_reason', type: 'BOOLEAN DEFAULT 1' },
    { name: 'appeal_min_length', type: 'INTEGER DEFAULT 50' },
    
    // Auto-mod filters
    { name: 'caps_percentage', type: 'INTEGER DEFAULT 70' },
    { name: 'emoji_limit', type: 'INTEGER DEFAULT 10' },
    { name: 'mention_limit', type: 'INTEGER DEFAULT 5' },
    { name: 'toxicity_threshold', type: 'INTEGER DEFAULT 80' },
    { name: 'detect_duplicates', type: 'BOOLEAN DEFAULT 1' },
    { name: 'filter_zalgo', type: 'BOOLEAN DEFAULT 1' },
    
    // Word filter
    { name: 'word_filter_enabled', type: 'BOOLEAN DEFAULT 0' },
    { name: 'banned_words', type: 'TEXT' },
    { name: 'banned_phrases', type: 'TEXT' },
    { name: 'word_filter_action', type: 'TEXT DEFAULT "delete"' },
    { name: 'word_filter_mode', type: 'TEXT DEFAULT "contains"' },
    { name: 'filter_display_names', type: 'BOOLEAN DEFAULT 0' },
    { name: 'log_filtered_messages', type: 'BOOLEAN DEFAULT 1' },
    { name: 'word_filter_custom_message', type: 'TEXT' },
    { name: 'word_filter_whitelist_channels', type: 'TEXT' },
    { name: 'word_filter_whitelist_roles', type: 'TEXT' },
    
    // Logging and roles
    { name: 'mod_log_channel', type: 'TEXT' },
    { name: 'dm_on_warn', type: 'BOOLEAN DEFAULT 1' },
    { name: 'dm_on_kick', type: 'BOOLEAN DEFAULT 1' },
    { name: 'dm_on_ban', type: 'BOOLEAN DEFAULT 1' },
    { name: 'max_warnings', type: 'INTEGER DEFAULT 3' },
    { name: 'warning_action', type: 'TEXT DEFAULT "timeout"' },
    { name: 'warning_expiry_days', type: 'INTEGER DEFAULT 30' },
    { name: 'mod_role_id', type: 'TEXT' },
    { name: 'admin_role_id', type: 'TEXT' },
    { name: 'exempt_staff_automod', type: 'BOOLEAN DEFAULT 1' }
];

try {
    // Get existing columns
    db.all('PRAGMA table_info(guild_configs)', (err, existingColumns) => {
        if (err) {
            console.error('❌ Error checking existing columns:', err);
            db.close();
            process.exit(1);
        }
        
        const existingColumnNames = existingColumns.map(col => col.name);
        
        console.log(`📊 Found ${existingColumns.length} existing columns in guild_configs\n`);
        
        let added = 0;
        let skipped = 0;
        let processed = 0;
        
        // Process columns one by one
        const processColumn = (index) => {
            if (index >= requiredColumns.length) {
                // All done
                console.log(`\n✨ Schema fix complete!`);
                console.log(`   - Added: ${added} columns`);
                console.log(`   - Skipped (already exist): ${skipped} columns`);
                console.log(`   - Total required: ${requiredColumns.length} columns\n`);
                db.close();
                return;
            }
            
            const column = requiredColumns[index];
            
            if (!existingColumnNames.includes(column.name)) {
                const sql = `ALTER TABLE guild_configs ADD COLUMN ${column.name} ${column.type}`;
                db.run(sql, (error) => {
                    if (error) {
                        console.error(`❌ Failed to add column ${column.name}:`, error.message);
                    } else {
                        console.log(`✅ Added column: ${column.name}`);
                        added++;
                    }
                    processColumn(index + 1);
                });
            } else {
                skipped++;
                processColumn(index + 1);
            }
        };
        
        processColumn(0);
    });
    
} catch (error) {
    console.error('❌ Error fixing database schema:', error);
    db.close();
    process.exit(1);
}
