// Create a non-admin user for darklock
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');

// Import darklock database (singleton instance)
const db = require('./darklock/utils/database');

const username = 'admin@darklock.net';
const password = 'Dk@2026!Secure#Pass$99'; // Strong password
const email = 'admin@darklock.net';

async function createUser() {
    console.log('Creating non-admin user for Darklock...\n');

    try {
        // Initialize database
        await db.initialize();

        // Check if user already exists
        const existingUser = await db.getUserByUsername(username);
        if (existingUser) {
            console.log('⚠️  User already exists. Updating password...');
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate user ID
        const userId = crypto.randomBytes(16).toString('hex');

        // Create user with 'user' role (non-admin)
        if (existingUser) {
            // Update existing user
            await db.run(`
                UPDATE users 
                SET password = ?, role = 'user', updated_at = ?
                WHERE username = ?
            `, [hashedPassword, new Date().toISOString(), username]);
        } else {
            // Create new user
            await db.createUser({
                id: userId,
                username: username,
                email: email,
                password: hashedPassword,
                displayName: 'Darklock User',
                role: 'user', // Non-admin role
                settings: {}
            });
        }

        // Verify the user was created
        const user = await db.getUserByUsername(username);
        
        if (user) {
            console.log('✅ User created successfully!\n');
            console.log('═══════════════════════════════════════════');
            console.log('  DARKLOCK USER CREDENTIALS');
            console.log('═══════════════════════════════════════════');
            console.log(`  Username: ${username}`);
            console.log(`  Password: ${password}`);
            console.log(`  Email:    ${email}`);
            console.log(`  Role:     ${user.role}`);
            console.log(`  Status:   ${user.active ? 'Active' : 'Inactive'}`);
            console.log('═══════════════════════════════════════════\n');
            console.log('🔗 Login at: http://localhost:3001/darklock/auth/login\n');
            console.log('⚠️  Save these credentials - password will not be shown again!\n');
        } else {
            console.log('❌ User not found after creation');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating user:', error);
        process.exit(1);
    }
}

createUser();
