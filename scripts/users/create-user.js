/**
 * Create Regular User for Darklock Desktop App
 * Usage: node create-user.js <email> <password> [username]
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

// Set DB path to Darklock directory before importing database
process.env.DARKLOCK_DB_PATH = path.join(__dirname, 'darklock', 'data', 'darklock.db');

// Import darklock database
const db = require('./darklock/utils/database');

async function createUser(email, password, username) {
    try {
        // Initialize database
        await db.initialize();

        // Check if user already exists
        const existingUser = await db.getUserByEmail(email);
        if (existingUser) {
            console.log('❌ Error: A user with this email already exists');
            process.exit(1);
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate user ID
        const userId = crypto.randomBytes(16).toString('hex');

        // Create user in users table (NOT admins table)
        await db.run(`
            INSERT INTO users (id, username, email, password, role, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'user', ?, ?)
        `, [
            userId,
            username || email.split('@')[0],
            email.toLowerCase(),
            hashedPassword,
            new Date().toISOString(),
            new Date().toISOString()
        ]);

        console.log('✅ User created successfully!\n');
        console.log(`   Email: ${email}`);
        console.log(`   Username: ${username || email.split('@')[0]}`);
        console.log(`   ID: ${userId}`);
        console.log('\n🔐 You can now login with the desktop app!\n');

        process.exit(0);
    } catch (err) {
        console.error('❌ Error creating user:', err.message);
        process.exit(1);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
    console.log('Usage: node create-user.js <email> <password> [username]');
    console.log('\nExample:');
    console.log('  node create-user.js user@example.com MyPassword123! myusername');
    process.exit(1);
}

const [email, password, username] = args;

// Validate email format
if (!email.includes('@')) {
    console.error('❌ Error: Invalid email format');
    process.exit(1);
}

// Validate password strength
if (password.length < 8) {
    console.error('❌ Error: Password must be at least 8 characters');
    process.exit(1);
}

createUser(email, password, username);
