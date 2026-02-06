#!/usr/bin/env node
/**
 * Setup Cayden's Personal Account
 * - Removes test accounts and darklock user account
 * - Preserves all admin accounts
 * - Creates new personal user account
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');

// Import darklock database
const db = require('./darklock/utils/database');

// New account credentials
const username = 'cayden';
const password = 'Cayden@2026!Secure#Pass'; // Strong password
const email = 'cayden@darklock.net';

async function setupAccount() {
    console.log('🔧 Setting up Cayden\'s personal account...\n');

    try {
        // Initialize database
        await db.initialize();

        // Step 1: Remove test accounts and darklock user (NOT admin accounts)
        console.log('🗑️  Removing test and darklock user accounts...');
        
        const accountsToRemove = [
            'testuser',
            'test@localhost',
            'admin@darklock.net'  // The darklock user, not admin
        ];

        for (const identifier of accountsToRemove) {
            try {
                // Remove by username
                const result1 = await db.run(`
                    DELETE FROM users 
                    WHERE (username = ? OR email = ?)
                    AND role != 'owner' 
                    AND role != 'admin'
                `, [identifier, identifier]);

                if (result1 && result1.changes > 0) {
                    console.log(`   ✓ Removed account: ${identifier}`);
                }
            } catch (err) {
                // Continue even if account doesn't exist
            }
        }

        // Step 2: Check if cayden account already exists
        const existingUser = await db.getUserByUsername(username);
        if (existingUser) {
            console.log('\n⚠️  Cayden account already exists. Updating password...');
        }

        // Step 3: Create or update cayden account
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = crypto.randomBytes(16).toString('hex');

        if (existingUser) {
            // Update existing account
            await db.run(`
                UPDATE users 
                SET password = ?, email = ?, updated_at = ?
                WHERE username = ?
            `, [hashedPassword, email, new Date().toISOString(), username]);
        } else {
            // Create new account
            await db.createUser({
                id: userId,
                username: username,
                email: email,
                password: hashedPassword,
                displayName: 'Cayden',
                role: 'user',
                settings: {}
            });
        }

        // Step 4: Verify the account
        const user = await db.getUserByUsername(username);
        
        if (user) {
            console.log('\n✅ Account setup completed successfully!\n');
            console.log('═══════════════════════════════════════════');
            console.log('  CAYDEN\'S ACCOUNT CREDENTIALS');
            console.log('═══════════════════════════════════════════');
            console.log(`  Username: ${username}`);
            console.log(`  Password: ${password}`);
            console.log(`  Email:    ${email}`);
            console.log(`  Role:     ${user.role}`);
            console.log(`  Status:   ${user.active ? 'Active' : 'Inactive'}`);
            console.log('═══════════════════════════════════════════\n');
            console.log('🔗 Login at: http://localhost:3001/darklock/auth/login\n');
            console.log('💾 Save these credentials securely!\n');
            
            // Show remaining accounts (for verification)
            const allUsers = await db.all('SELECT username, email, role FROM users ORDER BY role, username');
            console.log('📋 All remaining accounts:');
            allUsers.forEach(u => {
                const roleIcon = u.role === 'owner' ? '👑' : u.role === 'admin' ? '🛡️' : '👤';
                console.log(`   ${roleIcon} ${u.username} (${u.email}) - ${u.role}`);
            });
            console.log('');
        } else {
            console.log('❌ Account not found after creation');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error setting up account:', error);
        process.exit(1);
    }
}

setupAccount();
