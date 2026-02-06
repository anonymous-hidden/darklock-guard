const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'darklock.db');
const newPasswordHash = '$2b$10$BuQ345dKEf4al/U2ZHY65OjRTyihWHCKgXG1NFcwW6yHHHEyQyh/.';

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error connecting to database:', err);
        process.exit(1);
    }
    console.log('✅ Connected to darklock.db');
});

// First, let's see what admins exist
db.all('SELECT id, email, role FROM admins', [], (err, rows) => {
    if (err) {
        console.error('❌ Error querying admins:', err);
        db.close();
        process.exit(1);
    }
    
    console.log('\n📋 Current admins:');
    rows.forEach(admin => {
        console.log(`   - ${admin.email} (${admin.role})`);
    });
    
    // Update all admin passwords
    db.run(
        'UPDATE admins SET password_hash = ?, updated_at = ? WHERE 1=1',
        [newPasswordHash, new Date().toISOString()],
        function(err) {
            if (err) {
                console.error('❌ Error updating passwords:', err);
                db.close();
                process.exit(1);
            }
            
            console.log(`\n✅ Updated ${this.changes} admin password(s)`);
            console.log('🔐 New password: Commence7-Barista5-Pungent0-Affirm5-Revolt7-Unmoved3-Sly4');
            console.log('\n⚠️  You can now log in to /admin with any admin email and the new password');
            
            db.close();
        }
    );
});
