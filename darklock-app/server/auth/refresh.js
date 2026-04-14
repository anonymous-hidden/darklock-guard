const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const users = require('../db/users');
const { hashToken } = require('../utils/crypto');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

router.post('/', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const tokenHash = hashToken(refreshToken);
    const stored = users.findRefreshToken(tokenHash);
    if (!stored) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Rotate: delete old, issue new
    users.deleteRefreshToken(tokenHash);

    const user = users.findById(stored.user_id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const accessToken = jwt.sign({ sub: user.id }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '15m'
    });

    const newRefreshToken = uuidv4();
    const newRefreshHash = hashToken(newRefreshToken);
    const refreshExpiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    users.storeRefreshToken(user.id, newRefreshHash, refreshExpiry);

    users.updateLastSeen(user.id);

    res.json({
      accessToken,
      refreshToken: newRefreshToken
    });
  } catch (err) {
    console.error('Refresh error:', err.message);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

module.exports = router;
