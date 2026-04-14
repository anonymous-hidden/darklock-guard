const express = require('express');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { authenticator } = require('otplib');
const users = require('../db/users');
const { hashToken } = require('../utils/crypto');
const { sanitizeString } = require('../utils/sanitize');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me';

router.post('/', async (req, res) => {
  try {
    const { usernameHash, passwordHash, totpCode } = req.body;

    if (!usernameHash || !passwordHash) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const cleanUsernameHash = sanitizeString(usernameHash);
    const cleanPasswordHash = sanitizeString(passwordHash);

    const user = users.findByUsernameHash(cleanUsernameHash);
    if (!user) {
      // Constant-time: still hash to prevent timing attacks
      await argon2.hash('dummy', { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await argon2.verify(user.password_hash, cleanPasswordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check TOTP if 2FA is enabled
    if (user.totp_secret) {
      if (!totpCode) {
        return res.status(403).json({ error: '2FA required', requires2FA: true });
      }
      const isValid = authenticator.check(totpCode, user.totp_secret);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid 2FA code' });
      }
    }

    users.updateLastSeen(user.id);

    const accessToken = jwt.sign({ sub: user.id }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '15m'
    });

    const refreshToken = uuidv4();
    const refreshHash = hashToken(refreshToken);
    const refreshExpiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    users.storeRefreshToken(user.id, refreshHash, refreshExpiry);

    // Add random timing jitter (10-50ms) to resist traffic analysis
    const jitter = 10 + Math.floor(Math.random() * 40);
    await new Promise(resolve => setTimeout(resolve, jitter));

    res.json({
      userId: user.id,
      publicKey: user.public_key,
      encryptedPrivateKey: user.encrypted_private_key,
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
