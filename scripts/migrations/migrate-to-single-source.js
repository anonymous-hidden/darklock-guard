/**
 * Migration Script: Consolidate Word Filter and Emoji Spam to guild_configs
 * 
 * This script:
 * 1. Migrates word_filters table data to guild_configs.banned_words
 * 2. Migrates emoji_spam_config table data to guild_configs columns
 * 3. Does NOT delete old tables (run cleanup separately after verification)
 * 
 * Run with: node scripts/migrations/migrate-to-single-source.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/discord.db');

async function run() {
    console.log('Starting migration to single source of truth...');
    console.log('Database:', DB_PATH);
    
    const db = new sqlite3.Database(DB_PATH);
    
    const runAsync = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
    
    const allAsync = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
    
    const getAsync = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
    
    try {
        // ============================================================
        // PHASE 1: Ensure new columns exist in guild_configs
        // ============================================================
        console.log('\n--- Phase 1: Adding missing columns ---');
        
        const newColumns = [
            'antispam_flood_seconds INTEGER DEFAULT 10',
            'emoji_spam_sticker_max INTEGER DEFAULT 3',
            'emoji_spam_whitelist_roles TEXT DEFAULT \'\''
        ];
        
        for (const col of newColumns) {
            try {
                await runAsync(`ALTER TABLE guild_configs ADD COLUMN ${col}`);
                console.log(`  + Added column: ${col.split(' ')[0]}`);
            } catch (e) {
                // Column already exists
                console.log(`  = Column exists: ${col.split(' ')[0]}`);
            }
        }
        
        // ============================================================
        // PHASE 2: Migrate word_filters table to guild_configs.banned_words
        // ============================================================
        console.log('\n--- Phase 2: Migrating word_filters table ---');
        
        // Check if word_filters table exists
        const wordFiltersExists = await getAsync(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='word_filters'"
        );
        
        if (wordFiltersExists) {
            // Get all guilds with word_filters
            const guildsWithFilters = await allAsync(
                'SELECT DISTINCT guild_id FROM word_filters WHERE enabled = 1'
            );
            
            console.log(`  Found ${guildsWithFilters.length} guilds with word_filters data`);
            
            let migratedCount = 0;
            for (const { guild_id } of guildsWithFilters) {
                // Get existing banned_words from guild_configs
                const config = await getAsync(
                    'SELECT banned_words FROM guild_configs WHERE guild_id = ?',
                    [guild_id]
                );
                
                const existingWords = config?.banned_words 
                    ? config.banned_words.split(',').filter(w => w.trim()) 
                    : [];
                
                // Get patterns from word_filters table
                const filters = await allAsync(
                    'SELECT pattern FROM word_filters WHERE guild_id = ? AND enabled = 1',
                    [guild_id]
                );
                
                const filterPatterns = filters.map(f => f.pattern).filter(p => p);
                
                // Merge without duplicates
                const merged = [...new Set([...existingWords, ...filterPatterns])];
                
                if (filterPatterns.length > 0) {
                    // Update guild_configs
                    await runAsync(
                        `INSERT INTO guild_configs (guild_id, banned_words) 
                         VALUES (?, ?)
                         ON CONFLICT(guild_id) DO UPDATE SET banned_words = ?`,
                        [guild_id, merged.join(','), merged.join(',')]
                    );
                    migratedCount++;
                    console.log(`  + Migrated ${filterPatterns.length} patterns for guild ${guild_id}`);
                }
            }
            
            console.log(`  Total: ${migratedCount} guilds migrated`);
        } else {
            console.log('  word_filters table does not exist, skipping');
        }
        
        // ============================================================
        // PHASE 3: Migrate emoji_spam_config table to guild_configs
        // ============================================================
        console.log('\n--- Phase 3: Migrating emoji_spam_config table ---');
        
        const emojiConfigExists = await getAsync(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='emoji_spam_config'"
        );
        
        if (emojiConfigExists) {
            const emojiConfigs = await allAsync('SELECT * FROM emoji_spam_config');
            
            console.log(`  Found ${emojiConfigs.length} emoji_spam_config rows`);
            
            let emojiMigratedCount = 0;
            for (const config of emojiConfigs) {
                await runAsync(
                    `INSERT INTO guild_configs (guild_id, emoji_spam_enabled, emoji_spam_max, emoji_spam_sticker_max, emoji_spam_action, emoji_spam_whitelist_roles)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT(guild_id) DO UPDATE SET 
                         emoji_spam_enabled = COALESCE(?, emoji_spam_enabled),
                         emoji_spam_max = COALESCE(?, emoji_spam_max),
                         emoji_spam_sticker_max = COALESCE(?, emoji_spam_sticker_max),
                         emoji_spam_action = COALESCE(?, emoji_spam_action),
                         emoji_spam_whitelist_roles = COALESCE(?, emoji_spam_whitelist_roles)`,
                    [
                        config.guild_id,
                        config.enabled,
                        config.max_emojis_per_message,
                        config.max_stickers_per_message,
                        config.action_type,
                        config.whitelist_roles || '',
                        // For ON CONFLICT UPDATE
                        config.enabled,
                        config.max_emojis_per_message,
                        config.max_stickers_per_message,
                        config.action_type,
                        config.whitelist_roles || ''
                    ]
                );
                emojiMigratedCount++;
            }
            
            console.log(`  Total: ${emojiMigratedCount} emoji configs migrated`);
        } else {
            console.log('  emoji_spam_config table does not exist, skipping');
        }
        
        // ============================================================
        // PHASE 4: Report deprecated tables (do not delete yet)
        // ============================================================
        console.log('\n--- Phase 4: Deprecated tables report ---');
        
        const deprecatedTables = [
            'word_filters',
            'word_filter_logs', 
            'word_filter_config',
            'emoji_spam_config',
            'guild_settings'
        ];
        
        for (const table of deprecatedTables) {
            const exists = await getAsync(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                [table]
            );
            
            if (exists) {
                const count = await getAsync(`SELECT COUNT(*) as count FROM ${table}`);
                console.log(`  [DEPRECATED] ${table}: ${count?.count || 0} rows (do not delete until verified)`);
            } else {
                console.log(`  [NOT FOUND] ${table}: table does not exist`);
            }
        }
        
        // ============================================================
        // DONE
        // ============================================================
        console.log('\n=== Migration Complete ===');
        console.log('IMPORTANT: Verify bot behavior before running cleanup script');
        console.log('After verification, run: node scripts/migrations/cleanup-deprecated-tables.js');
        
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    } finally {
        db.close();
    }
}

run();
