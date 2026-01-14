const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'security_bot.db');
const db = new sqlite3.Database(dbPath);

console.log('Checking anti-spam settings in database...\n');

db.all('SELECT guild_id, anti_spam_enabled, antispam_enabled FROM guild_configs', (err, rows) => {
    if (err) {
        console.error('Error:', err);
    } else {
        console.log('Guild Configs:');
        rows.forEach(row => {
            console.log(`Guild ${row.guild_id}:`);
            console.log(`  anti_spam_enabled: ${row.anti_spam_enabled}`);
            console.log(`  antispam_enabled: ${row.antispam_enabled}`);
            console.log(`  Result: ${row.anti_spam_enabled || row.antispam_enabled ? 'ENABLED' : 'DISABLED'}`);
            console.log('');
        });
    }
    db.close();
});
