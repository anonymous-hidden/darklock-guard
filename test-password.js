const bcrypt = require('bcrypt');

const hash = '$2b$10$BuQ345dKEf4al/U2ZHY65OjRTyihWHCKgXG1NFcwW6yHHHEyQyh/.';

const commonPasswords = [
    'admin',
    'password', 
    'admin123',
    'ChangeMe123!',
    '123456',
    'darklock',
    'Darklock123',
    'guardian',
    'GuardianBot',
    'password123',
    'Admin123',
    'Darklock',
    'darklock123'
];

console.log('🔍 Testing common passwords against your hash...\n');

for (const pw of commonPasswords) {
    if (bcrypt.compareSync(pw, hash)) {
        console.log('✅ PASSWORD FOUND:', pw);
        process.exit(0);
    }
}

console.log('❌ None of the common passwords matched your hash.');
console.log('\nYou need to either:');
console.log('1. Remember your original password');
console.log('2. Set a new one with: node hash-password.js NewPassword123');
