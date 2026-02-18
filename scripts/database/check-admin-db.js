const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'data/darklock.db');
const db = new sqlite3.Database(dbPath);

async function checkAndCreateAdmin() {
    try {
        // Check for existing admins
        const admins = await new Promise((resolve, reject) => {
            db.all('SELECT id, email, role, active FROM admins', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        console.log('\n=== Current Admins in Database ===');
        if (admins.length === 0) {
            console.log('No admins found in database!');
        } else {
            admins.forEach(admin => {
                console.log(`ID: ${admin.id}, Email: ${admin.email}, Role: ${admin.role}, Active: ${admin.active ? 'Yes' : 'No'}`);
            });
        }

        // Check if admin@darklock.net exists
        const targetAdmin = admins.find(a => a.email === 'admin@darklock.net');

        if (!targetAdmin) {
            console.log('\n=== Creating admin@darklock.net ===');
            
            // Hash the password
            const password = 'Uncut4-Drown2-Dollop4-Backwash2-Slug8-Oblivious2-Canyon7';
            const passwordHash = await bcrypt.hash(password, 10);
            
            const now = new Date().toISOString();
            
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO admins (email, password_hash, role, active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, ['admin@darklock.net', passwordHash, 'super_admin', 1, now, now], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            console.log('✅ Admin user created successfully!');
            console.log('Email: admin@darklock.net');
            console.log('Password: Uncut4-Drown2-Dollop4-Backwash2-Slug8-Oblivious2-Canyon7');
        } else {
            console.log('\n=== Updating admin@darklock.net password ===');
            
            // Update the password
            const password = 'Uncut4-Drown2-Dollop4-Backwash2-Slug8-Oblivious2-Canyon7';
            const passwordHash = await bcrypt.hash(password, 10);
            const now = new Date().toISOString();
            
            await new Promise((resolve, reject) => {
                db.run(`
                    UPDATE admins 
                    SET password_hash = ?, updated_at = ?, active = 1
                    WHERE email = ?
                `, [passwordHash, now, 'admin@darklock.net'], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            console.log('✅ Admin password updated successfully!');
            console.log('Email: admin@darklock.net');
            console.log('Password: Uncut4-Drown2-Dollop4-Backwash2-Slug8-Oblivious2-Canyon7');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        db.close();
    }
}

checkAndCreateAdmin();
