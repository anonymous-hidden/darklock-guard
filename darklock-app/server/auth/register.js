const express = require('express');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const users = require('../db/users');
const { hashToken } = require('../utils/crypto');
const { sanitizeString, isValidBase64 } = require('../utils/sanitize');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me';

router.post('/', async (req, res) => {
  try {
    const { usernameHash, passwordHash, publicKey, encryptedPrivateKey } = req.body;

    if (!usernameHash || !passwordHash || !publicKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const cleanUsernameHash = sanitizeString(usernameHash);
    const cleanPasswordHash = sanitizeString(passwordHash);

    if (!isValidBase64(publicKey)) {
      return res.status(400).json({ error: 'Invalid public key format' });
    }

    // Check if username already taken
    const existing = users.findByUsernameHash(cleanUsernameHash);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Hash the password hash again server-side with argon2id
    const serverHash = await argon2.hash(cleanPasswordHash, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1
    });

    const user = users.createUser({
      usernameHash: cleanUsernameHash,
      passwordHash: serverHash,
      publicKey,
      encryptedPrivateKey: encryptedPrivateKey || null
    });

    // Generate tokens
    const accessToken = jwt.sign({ sub: user.id }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '15m'
    });

    const refreshToken = uuidv4();
    const refreshHash = hashToken(refreshToken);
    const refreshExpiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    users.storeRefreshToken(user.id, refreshHash, refreshExpiry);

    res.status(201).json({
      userId: user.id,
      publicKey: user.publicKey,
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

module.exports = router;
