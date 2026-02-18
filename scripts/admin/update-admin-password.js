const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'darklock.db');
const db = new sqlite3.Database(dbPath);

const newPasswordHash = '$2b$12$yZbQ3O020tHCPXMwJiqbBOMuAX24dDBjOKVyXAzH7zrvayxXDHIHa';
const email = 'admin@darklock.net';

console.log('Updating admin password for:', email);

db.run(`
    UPDATE admins 
    SET password_hash = ?, updated_at = datetime('now')
    WHERE email = ?
`, [newPasswordHash, email], function(err) {
    if (err) {
        console.error('Error updating password:', err);
        db.close();
        process.exit(1);
    }
    
    if (this.changes === 0) {
        console.log('No admin found with that email. Creating new admin...');
        
        const crypto = require('crypto');
        const adminId = crypto.randomUUID();
        const now = new Date().toISOString();
        
        db.run(`
            INSERT INTO admins (id, email, password_hash, role, created_at, updated_at, active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        `, [adminId, email, newPasswordHash, 'owner', now, now], function(err) {
            if (err) {
                console.error('Error creating admin:', err);
            } else {
                console.log('✅ Admin created successfully');
            }
            db.close();
        });
    } else {
        console.log(`✅ Password updated successfully (${this.changes} row(s) affected)`);
        
        // Verify the update
        db.get('SELECT email, role, active FROM admins WHERE email = ?', [email], (err, row) => {
            if (err) {
                console.error('Error verifying:', err);
            } else if (row) {
                console.log('✅ Admin verified:');
                console.log('   Email:', row.email);
                console.log('   Role:', row.role);
                console.log('   Active:', row.active);
            }
            db.close();
        });
    }
});
