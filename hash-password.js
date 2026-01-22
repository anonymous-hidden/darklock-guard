// Hash a password with bcrypt for production use
const bcrypt = require('bcrypt');

const password = process.argv[2];

if (!password) {
    console.error('Usage: node hash-password.js <password>');
    console.error('Example: node hash-password.js mySecurePassword123');
    process.exit(1);
}

if (password.length < 8) {
    console.error('Error: Password must be at least 8 characters long');
    process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

console.log('\n✅ Password hashed successfully!\n');
console.log('Copy this hash and set it as your ADMIN_PASSWORD environment variable:\n');
console.log(hash);
console.log('\nTo update on Render:');
console.log('1. Go to your Render dashboard');
console.log('2. Select your web service');
console.log('3. Go to Environment tab');
console.log('4. Update ADMIN_PASSWORD with the hash above');
console.log('5. Save changes (will trigger automatic redeploy)\n');
