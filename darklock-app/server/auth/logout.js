const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const users = require('../db/users');

const router = express.Router();

router.post('/', authMiddleware, (req, res) => {
  try {
    // Revoke all refresh tokens for this user
    users.deleteRefreshTokensByUser(req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err.message);
    res.status(500).json({ error: 'Logout failed' });
  }
});

module.exports = router;
