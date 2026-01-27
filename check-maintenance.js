const db = require('./darklock/utils/database');

db.initialize().then(async () => {
    const rows = await db.all('SELECT * FROM maintenance_state');
    
    console.log('\n📊 Current Maintenance States:\n');
    
    if (rows.length === 0) {
        console.log('  ⚠️  No maintenance states found in database.');
        console.log('  This means no one has configured any maintenance settings yet.\n');
    } else {
        rows.forEach(r => {
            console.log(`Scope: ${r.scope}`);
            console.log(`  Enabled: ${r.enabled ? '✅ YES' : '❌ NO'}`);
            console.log(`  Title: ${r.title || '(none)'}`);
            console.log(`  Subtitle: ${r.subtitle || '(none)'}`);
            console.log(`  Message: ${r.message || '(none)'}`);
            console.log(`  Start: ${r.scheduled_start || '(immediate)'}`);
            console.log(`  End: ${r.scheduled_end || '(manual end)'}`);
            console.log(`  Admin Bypass: ${r.admin_bypass ? 'YES' : 'NO'}`);
            console.log(`  Updated: ${r.updated_at || '(never)'}`);
            console.log('');
        });
    }
    
    process.exit(0);
}).catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
