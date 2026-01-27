const Database = require('better-sqlite3');
const db = new Database('./darklock/data/darklock.db');

const rows = db.prepare(`
    SELECT scope, enabled, apply_localhost, admin_bypass, scheduled_start, scheduled_end 
    FROM maintenance_state 
    WHERE scope IN ('darklock_site', 'platform')
`).all();

console.log('\n=== MAINTENANCE STATE IN DATABASE ===\n');
rows.forEach(row => {
    console.log(`Scope: ${row.scope}`);
    console.log(`  enabled: ${row.enabled} (type: ${typeof row.enabled})`);
    console.log(`  apply_localhost: ${row.apply_localhost}`);
    console.log(`  admin_bypass: ${row.admin_bypass}`);
    console.log(`  scheduled_start: ${row.scheduled_start}`);
    console.log(`  scheduled_end: ${row.scheduled_end}`);
    console.log('');
});

db.close();
