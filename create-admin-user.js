const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('data/security_bot.db');

const adminUsername = process.env.ADMIN_USERNAME || 'admin';

console.log(`Creating admin user record for: ${adminUsername}...`);

db.run(`
    INSERT INTO admin_users (username, email, password_hash, role, active, created_at) 
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(username) DO NOTHING
`, [adminUsername, `${adminUsername}@local`, 'ENV_VAR', 'admin', 1], (err) => {
    if (err) {
        console.error('Error creating admin user:', err);
    } else {
        console.log('✅ Admin user record created (or already exists)');
        
        // Verify
        db.get('SELECT * FROM admin_users WHERE username = ?', [adminUsername], (err, row) => {
            if (err) {
                console.error('Error verifying:', err);
            } else if (row) {
                console.log('✅ Admin user verified in database');
                console.log('   Username:', row.username);
                console.log('   Role:', row.role);
                console.log('   Active:', row.active);
            } else {
                console.log('❌ Admin user not found after insert');
            }
            db.close();
        });
    }
});
