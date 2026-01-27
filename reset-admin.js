/**
 * Reset Admin Credentials
 * Creates or resets admin account with known credentials
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'data/darklock.db');
const EMAIL = 'admin@darklock.net';
const PASSWORD = 'admin123';
const ROLE = 'owner';

async function resetAdmin() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Database connection error:', err);
                reject(err);
                return;
            }
            console.log('✅ Connected to database');
        });

        // Get current admins
        db.all(`SELECT id, email, role, active FROM admins`, [], (err, rows) => {
            if (err) {
                console.error('Query error:', err);
                db.close();
                reject(err);
                return;
            }

            console.log('\n📋 Current Admin Accounts:');
            if (rows.length === 0) {
                console.log('   No admins found');
            } else {
                rows.forEach(row => {
                    console.log(`   - ${row.email} (${row.role}) - ${row.active ? 'Active' : 'Inactive'}`);
                });
            }

            // Hash the new password
            bcrypt.hash(PASSWORD, 12, (err, hash) => {
                if (err) {
                    console.error('Hash error:', err);
                    db.close();
                    reject(err);
                    return;
                }

                const now = new Date().toISOString();
                const adminId = crypto.randomUUID();

                // Check if admin exists
                db.get(`SELECT id FROM admins WHERE email = ?`, [EMAIL], (err, existing) => {
                    if (err) {
                        console.error('Check error:', err);
                        db.close();
                        reject(err);
                        return;
                    }

                    if (existing) {
                        // Update existing admin
                        console.log(`\n🔄 Updating existing admin: ${EMAIL}`);
                        db.run(`
                            UPDATE admins 
                            SET password_hash = ?, role = ?, active = 1, updated_at = ?
                            WHERE email = ?
                        `, [hash, ROLE, now, EMAIL], function(err) {
                            if (err) {
                                console.error('Update error:', err);
                                db.close();
                                reject(err);
                                return;
                            }

                            console.log('✅ Admin account updated successfully!');
                            console.log('\n🔑 Login Credentials:');
                            console.log(`   Email: ${EMAIL}`);
                            console.log(`   Password: ${PASSWORD}`);
                            console.log(`   Role: ${ROLE}`);
                            console.log('\n🌐 Login at: http://localhost:3000/signin');

                            db.close();
                            resolve();
                        });
                    } else {
                        // Create new admin
                        console.log(`\n➕ Creating new admin: ${EMAIL}`);
                        db.run(`
                            INSERT INTO admins (id, email, password_hash, role, active, created_at, updated_at)
                            VALUES (?, ?, ?, ?, 1, ?, ?)
                        `, [adminId, EMAIL, hash, ROLE, now, now], function(err) {
                            if (err) {
                                console.error('Insert error:', err);
                                db.close();
                                reject(err);
                                return;
                            }

                            console.log('✅ Admin account created successfully!');
                            console.log('\n🔑 Login Credentials:');
                            console.log(`   Email: ${EMAIL}`);
                            console.log(`   Password: ${PASSWORD}`);
                            console.log(`   Role: ${ROLE}`);
                            console.log('\n🌐 Login at: http://localhost:3000/signin');

                            db.close();
                            resolve();
                        });
                    }
                });
            });
        });
    });
}

// Run the reset
resetAdmin()
    .then(() => {
        console.log('\n✅ Done!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n❌ Failed:', err.message);
        process.exit(1);
    });
