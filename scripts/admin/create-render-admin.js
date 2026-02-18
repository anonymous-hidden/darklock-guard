/**
 * Create Admin User for Render Deployment
 * Run this once on Render after deployment
 */

const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(__dirname, 'data/darklock.db');
const db = new sqlite3.Database(dbPath);

async function createAdmin() {
    console.log('[Render Admin Setup] Starting...');
    
    // Get credentials from environment or use defaults
    const username = process.env.RENDER_ADMIN_USERNAME || 'admin';
    const email = process.env.RENDER_ADMIN_EMAIL || 'admin@darklock.net';
    const password = process.env.RENDER_ADMIN_PASSWORD || 'ChangeMe123!';
    
    console.log(`[Render Admin Setup] Creating admin user: ${username}`);
    console.log(`[Render Admin Setup] Email: ${email}`);
    console.log(`[Render Admin Setup] Password: ${password}`);
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create admins table if it doesn't exist
    await new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS admins (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                two_factor_enabled INTEGER DEFAULT 0,
                two_factor_secret TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME,
                avatar TEXT
            )
        `, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
    
    // Insert or replace admin user
    await new Promise((resolve, reject) => {
        db.run(`
            INSERT OR REPLACE INTO admins (id, username, email, password, role, two_factor_enabled)
            VALUES (?, ?, ?, ?, 'owner', 0)
        `, ['admin-001', username, email, hashedPassword], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
    
    console.log('✅ Admin user created successfully!');
    console.log('');
    console.log('Login at: https://your-app.onrender.com/signin');
    console.log(`Username: ${username}`);
    console.log(`Password: ${password}`);
    console.log('');
    console.log('⚠️  CHANGE YOUR PASSWORD IMMEDIATELY AFTER LOGIN!');
    
    db.close();
}

createAdmin().catch(err => {
    console.error('❌ Error creating admin:', err);
    process.exit(1);
});
