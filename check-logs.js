const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'security_bot.db');
const db = new sqlite3.Database(dbPath);

console.log('Checking database at:', dbPath);

// Check bot_logs
db.all('SELECT COUNT(*) as count FROM bot_logs', (err, rows) => {
    if (err) {
        console.error('Error checking bot_logs:', err);
    } else {
        console.log('bot_logs count:', rows[0].count);
    }
    
    // Get recent logs
    db.all('SELECT * FROM bot_logs ORDER BY created_at DESC LIMIT 10', (err, rows) => {
        if (err) {
            console.error('Error fetching recent logs:', err);
        } else {
            console.log('\nRecent bot_logs:');
            console.log(rows);
        }
        
        // Check dashboard_audit
        db.all('SELECT COUNT(*) as count FROM dashboard_audit', (err, rows) => {
            if (err) {
                console.error('Error checking dashboard_audit:', err);
            } else {
                console.log('\ndashboard_audit count:', rows[0].count);
            }
            
            // Get recent audit logs
            db.all('SELECT * FROM dashboard_audit ORDER BY created_at DESC LIMIT 10', (err, rows) => {
                if (err) {
                    console.error('Error fetching recent audit logs:', err);
                } else {
                    console.log('\nRecent dashboard_audit:');
                    console.log(rows);
                }
                
                db.close();
            });
        });
    });
});
