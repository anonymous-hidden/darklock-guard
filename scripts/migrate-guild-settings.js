#!/usr/bin/env node
/**
 * Migration: Merge guild_settings into guild_configs
 * 
 * This script:
 * 1. Reads all rows from guild_settings
 * 2. For each guild, merges any non-null guild_settings values into guild_configs
 *    (guild_configs values take priority — we only fill NULLs)
 * 3. Parses settings_json blobs and merges safe keys into guild_configs
 * 4. Renames guild_settings → guild_settings_backup
 * 5. Canonicalizes internal duplicates (antiraid_enabled → anti_raid_enabled, etc.)
 *
 * SAFE TO RE-RUN: Uses INSERT OR IGNORE / UPDATE ... WHERE ... IS NULL
 * 
 * Run:  node scripts/migrate-guild-settings.js
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '..', 'data', 'database.sqlite');

// Column mapping: guild_settings column → guild_configs column
const COLUMN_MAP = {
    'welcome_enabled':   'welcome_enabled',
    'welcome_channel_id':'welcome_channel',       // different name
    'welcome_message':   'welcome_message',
    'leave_enabled':     'goodbye_enabled',        // different name  
    'leave_channel_id':  'goodbye_channel',        // different name
    'leave_message':     'goodbye_message',        // different name
    'log_channel_id':    'log_channel_id',
    'automod_enabled':   'auto_mod_enabled',       // different name
    'language':          'language',
    'mod_role_id':       'mod_role_id',
    'admin_role_id':     'admin_role_id',
    'ticket_category':   'ticket_category',
    'ticket_panel_channel': 'ticket_panel_channel',
    'ticket_transcript_channel': 'ticket_transcript_channel',
};

// Internal guild_configs duplicate columns to canonicalize
// source → canonical target (source will be zeroed after merging)
const INTERNAL_DUPES = {
    'antiraid_enabled':    'anti_raid_enabled',
    'antispam_enabled':    'anti_spam_enabled',
    'antiphishing_enabled':'anti_phishing_enabled',
    'logs_channel_id':     'log_channel_id',        // keep log_channel_id as canonical
};

function openDB() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) reject(err);
            else resolve(db);
        });
    });
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ changes: this.changes, lastID: this.lastID });
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

async function tableExists(db, name) {
    const row = await get(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]);
    return !!row;
}

async function getTableColumns(db, name) {
    const rows = await all(db, `PRAGMA table_info(${name})`);
    return rows.map(r => r.name);
}

async function main() {
    console.log('=== Guild Settings → Guild Configs Migration ===\n');
    
    const db = await openDB();
    
    // Check tables exist
    const hasSettings = await tableExists(db, 'guild_settings');
    const hasConfigs  = await tableExists(db, 'guild_configs');
    
    if (!hasConfigs) {
        console.error('ERROR: guild_configs table does not exist. Run the bot first to create tables.');
        db.close();
        process.exit(1);
    }
    
    if (!hasSettings) {
        console.log('guild_settings table does not exist — nothing to migrate.');
        console.log('Proceeding to canonicalize internal duplicates...\n');
    }
    
    const configCols = await getTableColumns(db, 'guild_configs');
    console.log(`guild_configs has ${configCols.length} columns`);
    
    let mergedCount = 0;
    let skippedCount = 0;
    
    // Step 1: Merge guild_settings rows into guild_configs
    if (hasSettings) {
        const settingsCols = await getTableColumns(db, 'guild_settings');
        console.log(`guild_settings has ${settingsCols.length} columns`);
        
        const settingsRows = await all(db, 'SELECT * FROM guild_settings');
        console.log(`Found ${settingsRows.length} guild_settings rows\n`);
        
        for (const row of settingsRows) {
            const guildId = row.guild_id;
            if (!guildId) continue;
            
            // Ensure guild_configs row exists
            await run(db, 'INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)', [guildId]);
            
            // Merge mapped columns (only fill NULLs in guild_configs)
            for (const [srcCol, dstCol] of Object.entries(COLUMN_MAP)) {
                if (row[srcCol] != null && configCols.includes(dstCol)) {
                    const result = await run(db,
                        `UPDATE guild_configs SET ${dstCol} = ? WHERE guild_id = ? AND ${dstCol} IS NULL`,
                        [row[srcCol], guildId]
                    );
                    if (result.changes > 0) {
                        mergedCount++;
                    }
                }
            }
            
            // Parse settings_json and merge safe keys
            if (row.settings_json) {
                try {
                    const blob = JSON.parse(row.settings_json);
                    for (const [key, val] of Object.entries(blob)) {
                        if (val != null && configCols.includes(key)) {
                            const result = await run(db,
                                `UPDATE guild_configs SET ${key} = ? WHERE guild_id = ? AND ${key} IS NULL`,
                                [typeof val === 'object' ? JSON.stringify(val) : val, guildId]
                            );
                            if (result.changes > 0) mergedCount++;
                        }
                    }
                } catch (e) {
                    console.warn(`  WARN: Could not parse settings_json for ${guildId}: ${e.message}`);
                }
            }
        }
        
        console.log(`Merged ${mergedCount} values from guild_settings → guild_configs\n`);
        
        // Step 2: Rename guild_settings to backup
        const hasBackup = await tableExists(db, 'guild_settings_backup');
        if (hasBackup) {
            console.log('guild_settings_backup already exists; dropping old backup...');
            await run(db, 'DROP TABLE guild_settings_backup');
        }
        await run(db, 'ALTER TABLE guild_settings RENAME TO guild_settings_backup');
        console.log('Renamed guild_settings → guild_settings_backup\n');
    }
    
    // Step 3: Canonicalize internal duplicate columns in guild_configs
    console.log('Canonicalizing internal duplicate columns...');
    
    for (const [srcCol, dstCol] of Object.entries(INTERNAL_DUPES)) {
        if (!configCols.includes(srcCol)) {
            console.log(`  SKIP: ${srcCol} column not found`);
            continue;
        }
        if (!configCols.includes(dstCol)) {
            console.log(`  SKIP: ${dstCol} column not found`);
            continue;
        }
        
        // Copy non-null source values into target where target is null
        const result = await run(db,
            `UPDATE guild_configs SET ${dstCol} = ${srcCol} WHERE ${srcCol} IS NOT NULL AND ${dstCol} IS NULL`
        );
        console.log(`  ${srcCol} → ${dstCol}: ${result.changes} rows updated`);
        
        // Now null out the source column to avoid confusion
        const cleared = await run(db,
            `UPDATE guild_configs SET ${srcCol} = NULL WHERE ${srcCol} IS NOT NULL`
        );
        console.log(`  Cleared ${cleared.changes} rows in ${srcCol}`);
    }
    
    console.log('\n=== Migration Complete ===');
    console.log(`Merged: ${mergedCount} values`);
    console.log('Backup table: guild_settings_backup (safe to DROP after verification)');
    console.log('\nIMPORTANT: Update all code references from guild_settings to guild_configs.');
    
    db.close();
}

main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
