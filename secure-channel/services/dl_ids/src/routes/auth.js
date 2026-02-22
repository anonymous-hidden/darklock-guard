/**
 * IDS Auth routes: /register, /login, /refresh
 */
import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

// ── /register ────────────────────────────────────────────────────────────────

authRouter.post('/register', async (req, res) => {
  try {
    const { username, email, password, identity_pubkey } = req.body;
    if (!username || !email || !password || !identity_pubkey) {
      return res.status(400).json({ error: 'Missing required fields', code: 'bad_request' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters', code: 'bad_request' });
    }

    const db = req.db;

    // Check uniqueness
    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existing) {
      return res.status(409).json({ error: 'Username or email already taken', code: 'conflict' });
    }

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, identity_pubkey)
       VALUES (?, ?, ?, ?, ?)`
    ).run(userId, username, email, passwordHash, identity_pubkey);

    // Generate tokens
    const accessToken = generateAccessToken(userId, username, req.jwtSecret);
    const { refreshToken, tokenHash, expiresAt } = generateRefreshToken();

    db.prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), userId, tokenHash, expiresAt);

    res.status(201).json({
      user_id: userId,
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed', code: 'internal' });
  }
});

// ── /login ───────────────────────────────────────────────────────────────────

authRouter.post('/login', async (req, res) => {
  try {
    const { username_or_email, password } = req.body;
    console.log('[IDS] POST /login username_or_email=%s', username_or_email);
    if (!username_or_email || !password) {
      return res.status(400).json({ error: 'Missing credentials', code: 'bad_request' });
    }

    const db = req.db;
    const user = db.prepare(
      'SELECT id, username, email, password_hash, identity_pubkey, system_role FROM users WHERE username = ? OR email = ?'
    ).get(username_or_email, username_or_email);

    if (!user) {
      console.warn('[IDS] POST /login: user not found for %s', username_or_email);
      return res.status(401).json({ error: 'Invalid credentials', code: 'invalid_credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      console.warn('[IDS] POST /login: bad password for userId=%s', user.id);
      return res.status(401).json({ error: 'Invalid credentials', code: 'invalid_credentials' });
    }
    console.log('[IDS DEBUG] user object system_role=%j all_keys=%j', user.system_role, Object.keys(user));

    const accessToken = generateAccessToken(user.id, user.username, req.jwtSecret);
    const { refreshToken, tokenHash, expiresAt } = generateRefreshToken();

    db.prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), user.id, tokenHash, expiresAt);

    res.json({
      user_id: user.id,
      username: user.username,
      access_token: accessToken,
      refresh_token: refreshToken,
      system_role: user.system_role ?? null,
      key_change_detected: false, // REPLACE_ME: compare with last-known key from client
    });
    console.log('[IDS] POST /login: success userId=%s username=%s system_role=%s', user.id, user.username, user.system_role);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed', code: 'internal' });
  }
});

// ── /refresh ─────────────────────────────────────────────────────────────────

authRouter.post('/refresh', (req, res) => {
  try {
    const { refresh_token } = req.body;
    console.log('[IDS] POST /refresh (token present=%s)', !!refresh_token);
    if (!refresh_token) {
      return res.status(400).json({ error: 'Missing refresh token', code: 'bad_request' });
    }

    const db = req.db;
    const tokenHash = hashToken(refresh_token);
    const row = db.prepare(
      "SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > datetime('now')"
    ).get(tokenHash);

    if (!row) {
      console.warn('[IDS] POST /refresh: token not found or expired');
      return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'invalid_token' });
    }
    console.log('[IDS] POST /refresh: found token for userId=%s', row.user_id);

    // Delete old token (rotation)
    db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    if (!user) {
      return res.status(401).json({ error: 'User not found', code: 'invalid_token' });
    }

    const accessToken = generateAccessToken(user.id, user.username, req.jwtSecret);
    const newRefresh = generateRefreshToken();

    db.prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), user.id, newRefresh.tokenHash, newRefresh.expiresAt);

    res.json({
      access_token: accessToken,
      refresh_token: newRefresh.refreshToken,
    });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Token refresh failed', code: 'internal' });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateAccessToken(userId, username, secret) {
  return jwt.sign(
    { sub: userId, username, type: 'access' },
    secret,
    { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

function generateRefreshToken() {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 86400000).toISOString();
  return { refreshToken, tokenHash, expiresAt };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
