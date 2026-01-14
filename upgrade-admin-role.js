// Update admin user to super_admin role
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.env.DB_PATH || './data/', process.env.DB_NAME || 'security_bot.db');
const db = new sqlite3.Database(dbPath);

db.run(`UPDATE admin_users SET role = 'super_admin' WHERE username = 'admin'`, function(err) {
    if (err) {
        console.error('Error updating admin role:', err);
    } else {
        console.log('✅ Admin user updated to super_admin role');
        console.log(`   Rows affected: ${this.changes}`);
    }
    
    // Verify
    db.get('SELECT username, role FROM admin_users WHERE username = ?', ['admin'], (err, row) => {
        if (row) {
            console.log(`   User: ${row.username}, Role: ${row.role}`);
        }
        db.close();
    });
});
