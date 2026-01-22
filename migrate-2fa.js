const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('data/security_bot.db');

console.log('Adding 2FA columns to admin_users table...\n');

const queries = [
    'ALTER TABLE admin_users ADD COLUMN totp_secret TEXT',
    'ALTER TABLE admin_users ADD COLUMN totp_enabled INTEGER DEFAULT 0',
    'ALTER TABLE admin_users ADD COLUMN backup_codes TEXT'
];

let completed = 0;

queries.forEach((query, index) => {
    db.run(query, (err) => {
        if (err) {
            if (err.message.includes('duplicate column')) {
                console.log(`✓ Column ${index + 1} already exists`);
            } else {
                console.error(`❌ Error on query ${index + 1}:`, err.message);
            }
        } else {
            console.log(`✅ Added column ${index + 1}`);
        }
        
        completed++;
        if (completed === queries.length) {
            db.all('PRAGMA table_info(admin_users)', (err, rows) => {
                if (err) {
                    console.error('Error getting schema:', err.message);
                } else {
                    console.log('\nCurrent admin_users schema:');
                    rows.forEach(col => {
                        console.log(`  ${col.name.padEnd(20)} ${col.type}`);
                    });
                }
                db.close(() => {
                    console.log('\n✅ Migration complete!');
                });
            });
        }
    });
});
