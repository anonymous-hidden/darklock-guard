const argon2 = require('argon2');
const { Client } = require('pg');

const username = 'owner';
const email = 'owner@darklock.net';
const password = 'Tattling3-Absolve2-Matchbook0-Aide1-Unpaved5-Finalize1-Rockband4-Salaried0-Shrink3-Swinging6';

async function createOwner() {
  const client = new Client({
    connectionString: 'postgresql://darklock:darklock@127.0.0.1:5432/darklock_guard'
  });

  try {
    await client.connect();
    console.log('Connected to database...\n');

    // Hash the password with Argon2id (same as API)
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    console.log('Password hashed...\n');

    // Check if user exists
    const checkResult = await client.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (checkResult.rows.length > 0) {
      // Update existing user
      await client.query(
        'UPDATE users SET password_hash = $1, role = $2, username = $3 WHERE email = $4',
        [passwordHash, 'admin', username, email]
      );
      console.log('✅ Existing user updated to owner account!');
    } else {
      // Create new user
      await client.query(
        'INSERT INTO users (username, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [username, email, passwordHash, 'admin']
      );
      console.log('✅ Owner account created successfully!');
    }

    console.log('\nCredentials:');
    console.log('Username:', username);
    console.log('Email:', email);
    console.log('Password: [hidden]');
    console.log('Role: admin');

    await client.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createOwner();
