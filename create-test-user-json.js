// Create a test user in the JSON file for local dashboard testing
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const USERS_FILE = path.join(__dirname, 'darklock', 'data', 'users.json');

const testUsername = 'testuser';
const testPassword = 'TestPass123!';
const testEmail = 'test@localhost';

console.log('Creating test account for local development...\n');

// Load existing users
let usersData = { users: [] };
if (fs.existsSync(USERS_FILE)) {
    try {
        usersData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (err) {
        console.warn('Warning: Could not read existing users.json, creating new file');
    }
}

// Check if user already exists
const existingUserIndex = usersData.users.findIndex(u => u.username === testUsername);

// Hash the password
const passwordHash = bcrypt.hashSync(testPassword, 10);

const testUser = {
    id: existingUserIndex >= 0 ? usersData.users[existingUserIndex].id : uuidv4(),
    username: testUsername,
    email: testEmail,
    password: passwordHash,
    role: 'admin',
    twoFactorEnabled: false,
    twoFactorSecret: null,
    createdAt: existingUserIndex >= 0 ? usersData.users[existingUserIndex].createdAt : new Date().toISOString(),
    lastLogin: null
};

// Add or update user
if (existingUserIndex >= 0) {
    usersData.users[existingUserIndex] = testUser;
    console.log('✅ Test user updated!\n');
} else {
    usersData.users.push(testUser);
    console.log('✅ Test user created!\n');
}

// Save to file
fs.writeFileSync(USERS_FILE, JSON.stringify(usersData, null, 2));

console.log('═══════════════════════════════════════════');
console.log('  TEST ACCOUNT CREDENTIALS (LOCAL ONLY)');
console.log('═══════════════════════════════════════════');
console.log(`  Username: ${testUsername}`);
console.log(`  Password: ${testPassword}`);
console.log(`  Email:    ${testEmail}`);
console.log(`  Role:     ${testUser.role}`);
console.log(`  2FA:      ${testUser.twoFactorEnabled ? 'Enabled' : 'Disabled'}`);
console.log('═══════════════════════════════════════════\n');
console.log('🔗 Login at: http://localhost:3001/auth/login\n');
