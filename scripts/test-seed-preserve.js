// Lightweight test to ensure seeding defaults doesn't overwrite existing values
// Usage: node scripts/test-seed-preserve.js

const Database = require('../src/database/database');
const fs = require('fs');
const path = require('path');

async function run() {
    // Use a temp DB file
    const dbFile = path.join(__dirname, 'temp-seed-test.db');
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    process.env.DB_PATH = __dirname; // data dir not used for file path here
    process.env.DB_NAME = 'temp-seed-test.db';

    const db = new Database();
    await db.initialize();

    const guildId = 'TEST_GUILD_123';

    // Insert a custom value for a config field
    await db.run('INSERT OR IGNORE INTO guild_configs (guild_id, anti_raid_enabled) VALUES (?, ?)', [guildId, 0]);

    // Now run the seeding logic we expect to use in the app: INSERT OR IGNORE then UPDATE with COALESCE
    await db.run('INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)', [guildId]);
    await db.run(`
        UPDATE guild_configs SET
            anti_raid_enabled = COALESCE(anti_raid_enabled, 1),
            anti_spam_enabled = COALESCE(anti_spam_enabled, 1)
        WHERE guild_id = ?
    `, [guildId]);

    const row = await db.get('SELECT anti_raid_enabled, anti_spam_enabled FROM guild_configs WHERE guild_id = ?', [guildId]);

    console.log('Guild config after seeding:', row);

    if (row.anti_raid_enabled === 0) {
        console.log('✅ PASS: existing anti_raid_enabled preserved');
        process.exit(0);
    } else {
        console.error('❌ FAIL: existing anti_raid_enabled was overwritten');
        process.exit(2);
    }
}

run().catch(err => {
    console.error('Test error:', err);
    process.exit(2);
});
