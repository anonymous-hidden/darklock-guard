/**
 * Cleanup Script: Remove deprecated tables after migration verification
 * 
 * WARNING: Only run this AFTER:
 * 1. Running migrate-to-single-source.js
 * 2. Verifying bot behavior works correctly
 * 3. Verifying dashboard changes affect bot behavior
 * 
 * This script will PERMANENTLY DELETE data from deprecated tables.
 * 
 * Run with: node scripts/migrations/cleanup-deprecated-tables.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const readline = require('readline');

const DB_PATH = path.join(__dirname, '../../data/discord.db');

async function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.toLowerCase().trim());
        });
    });
}

async function run() {
    console.log('=== DEPRECATED TABLE CLEANUP ===');
    console.log('Database:', DB_PATH);
    console.log('\nWARNING: This will permanently delete deprecated tables.\n');
    
    const answer = await prompt('Have you verified bot behavior after migration? (yes/no): ');
    if (answer !== 'yes') {
        console.log('Aborting. Run migration verification first.');
        process.exit(0);
    }
    
    const db = new sqlite3.Database(DB_PATH);
    
    const runAsync = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
    
    const getAsync = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
    
    try {
        // Tables to drop
        const tablesToDrop = [
            { name: 'word_filters', reason: 'Data migrated to guild_configs.banned_words' },
            { name: 'word_filter_logs', reason: 'Dead table, never read in production' },
            { name: 'word_filter_config', reason: 'Dead table from wordfilter-v2.js (unused)' },
            { name: 'emoji_spam_config', reason: 'Data migrated to guild_configs columns' }
        ];
        
        // Tables to keep but monitor
        const tablesToKeep = [
            { name: 'emoji_spam_log', reason: 'Historical audit log, may be useful' },
            { name: 'guild_settings', reason: 'Used by rollbackSetting(), needs separate migration' },
            { name: 'word_filter_violations', reason: 'Active log table for WordFilterEngine' }
        ];
        
        console.log('\n--- Tables to DROP ---');
        for (const { name, reason } of tablesToDrop) {
            const exists = await getAsync(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                [name]
            );
            
            if (exists) {
                const count = await getAsync(`SELECT COUNT(*) as count FROM ${name}`);
                console.log(`  Dropping ${name} (${count?.count || 0} rows) - ${reason}`);
                await runAsync(`DROP TABLE ${name}`);
                console.log(`    + Dropped`);
            } else {
                console.log(`  Skipping ${name} - does not exist`);
            }
        }
        
        console.log('\n--- Tables KEPT (not dropped) ---');
        for (const { name, reason } of tablesToKeep) {
            const exists = await getAsync(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                [name]
            );
            
            if (exists) {
                const count = await getAsync(`SELECT COUNT(*) as count FROM ${name}`);
                console.log(`  ${name} (${count?.count || 0} rows) - ${reason}`);
            } else {
                console.log(`  ${name} - does not exist`);
            }
        }
        
        console.log('\n=== Cleanup Complete ===');
        console.log('Deprecated tables have been removed.');
        console.log('guild_configs is now the single source of truth for Word Filter and Emoji Spam.');
        
    } catch (err) {
        console.error('Cleanup failed:', err);
        process.exit(1);
    } finally {
        db.close();
    }
}

run();
