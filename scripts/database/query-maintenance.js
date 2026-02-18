#!/usr/bin/env node
// Direct database check without requiring the database wrapper
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'darklock/data/darklock.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Database connection error:', err);
        process.exit(1);
    }
});

db.all('SELECT * FROM maintenance_state', [], (err, rows) => {
    if (err) {
        console.error('Query error:', err);
        process.exit(1);
    }
    
    console.log('\n=== MAINTENANCE STATE TABLE ===\n');
    
    if (rows.length === 0) {
        console.log('❌ Table is EMPTY - no maintenance configurations saved yet\n');
    } else {
        rows.forEach((row, idx) => {
            console.log(`Record ${idx + 1}:`);
            console.log(`  Scope: ${row.scope}`);
            console.log(`  Enabled: ${row.enabled ? '✅ YES' : '❌ NO'}`);
            console.log(`  Title: ${row.title || '(none)'}`);
            console.log(`  Subtitle: ${row.subtitle || '(none)'}`);
            console.log(`  Message: ${row.message || '(none)'}`);
            console.log(`  Scheduled Start: ${row.scheduled_start || '(immediate)'}`);
            console.log(`  Scheduled End: ${row.scheduled_end || '(manual)'}`);
            console.log(`  Admin Bypass: ${row.admin_bypass ? 'YES' : 'NO'}`);
            console.log(`  Updated: ${row.updated_at || '(never)'}`);
            console.log('');
        });
    }
    
    db.close();
});
