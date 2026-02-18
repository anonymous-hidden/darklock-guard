const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('data/security_bot.db');

db.get('SELECT username, totp_enabled, totp_secret, backup_codes FROM admin_users WHERE username = ?', ['admin'], (err, row) => {
    if (err) {
        console.error('Error:', err);
    } else if (row) {
        console.log('Admin user 2FA status:');
        console.log('Username:', row.username);
        console.log('2FA Enabled:', row.totp_enabled === 1 ? 'YES' : 'NO');
        console.log('Has Secret:', row.totp_secret ? 'YES' : 'NO');
        console.log('Has Backup Codes:', row.backup_codes ? 'YES' : 'NO');
        
        if (row.backup_codes) {
            const codes = JSON.parse(row.backup_codes);
            console.log('Number of backup codes:', codes.length);
        }
    } else {
        console.log('No admin user found in database!');
    }
    db.close();
});
