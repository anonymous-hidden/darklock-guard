/**
 * Set Owner Role Script
 * This script upgrades the 'admin' user to 'owner' role
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'security_bot.db');

console.log('🔧 Setting owner role...');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Failed to open database:', err.message);
        process.exit(1);
    }
    
    // Update the admin user to owner role
    db.run(`UPDATE admin_users SET role = 'owner' WHERE username = 'admin'`, function(err) {
        if (err) {
            console.error('❌ Failed to update role:', err.message);
            db.close();
            process.exit(1);
        }
        
        if (this.changes === 0) {
            console.log('⚠️ No user with username "admin" found.');
        } else {
            console.log('✅ Successfully set admin user to owner role!');
        }
        
        // Show current users and their roles
        db.all(`SELECT id, username, display_name, role, active FROM admin_users ORDER BY id`, (err, rows) => {
            if (err) {
                console.error('❌ Failed to query users:', err.message);
            } else {
                console.log('\n📋 Current users:');
                console.log('─'.repeat(60));
                rows.forEach(row => {
                    const status = row.active ? '✓' : '✗';
                    console.log(`  ${status} ${row.username} (${row.display_name || 'N/A'}) - ${row.role}`);
                });
                console.log('─'.repeat(60));
            }
            
            db.close(() => {
                console.log('\n✨ Done!');
                process.exit(0);
            });
        });
    });
});
