// Create a test user for local dashboard testing
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const db = new sqlite3.Database('data/security_bot.db');

const testUsername = 'testuser';
const testPassword = 'TestPass123!';
const testEmail = 'test@localhost';

console.log('Creating test account for local development...\n');

// Hash the password
const passwordHash = bcrypt.hashSync(testPassword, 10);

// Create the test user
db.run(`
    INSERT INTO admin_users (username, email, password_hash, role, active, created_at) 
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        email = excluded.email,
        active = excluded.active
`, [testUsername, testEmail, passwordHash, 'admin', 1], (err) => {
    if (err) {
        console.error('❌ Error creating test user:', err);
        db.close();
        process.exit(1);
    }
    
    console.log('✅ Test user created successfully!\n');
    
    // Verify the user was created
    db.get('SELECT * FROM admin_users WHERE username = ?', [testUsername], (err, row) => {
        if (err) {
            console.error('❌ Error verifying test user:', err);
        } else if (row) {
            console.log('═══════════════════════════════════════════');
            console.log('  TEST ACCOUNT CREDENTIALS (LOCAL ONLY)');
            console.log('═══════════════════════════════════════════');
            console.log(`  Username: ${testUsername}`);
            console.log(`  Password: ${testPassword}`);
            console.log(`  Email:    ${testEmail}`);
            console.log(`  Role:     ${row.role}`);
            console.log(`  Status:   ${row.active ? 'Active' : 'Inactive'}`);
            console.log('═══════════════════════════════════════════\n');
            console.log('🔗 Login at: http://localhost:3001/auth/login\n');
        } else {
            console.log('❌ Test user not found after insert');
        }
        
        db.close();
    });
});
