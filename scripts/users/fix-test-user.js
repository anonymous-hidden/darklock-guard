const fs = require('fs');
const bcrypt = require('bcrypt');

const password = 'TestPass123!';
const hash = bcrypt.hashSync(password, 10);

console.log('Generated hash:', hash);
console.log('Validates:', bcrypt.compareSync(password, hash));

const userData = {
  "users": [
    {
      "id": "test-user-001",
      "username": "testuser",
      "email": "test@localhost",
      "password": hash,
      "role": "admin",
      "twoFactorEnabled": false,
      "twoFactorSecret": null,
      "createdAt": new Date().toISOString(),
      "lastLogin": null
    }
  ]
};

fs.writeFileSync('./darklock/data/users.json', JSON.stringify(userData, null, 2));
console.log('\n✅ Test user created in darklock/data/users.json');
console.log('\nCredentials:');
console.log('Username: testuser');
console.log('Password: TestPass123!');
