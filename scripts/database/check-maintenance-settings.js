const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'darklock.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 Checking maintenance settings...\n');

db.all(`SELECT key, value FROM platform_settings WHERE key LIKE '%maintenance%'`, [], (err, rows) => {
    if (err) {
        console.error('❌ Error:', err);
        db.close();
        return;
    }

    if (rows.length === 0) {
        console.log('⚠️  No maintenance settings found in database');
    } else {
        rows.forEach(row => {
            console.log(`${row.key}:`);
            console.log(`  ${row.value}`);
            console.log('');
        });
    }

    db.close();
});
