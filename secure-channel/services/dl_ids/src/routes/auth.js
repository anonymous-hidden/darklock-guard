/**
 * IDS Auth routes: /register, /login, /refresh
 */
import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import {
  argon2idHashNeedsUpgrade,
  hashPasswordArgon2id,
  isArgon2idHash,
  verifyPasswordArgon2id,
} from '@darklock/ridgeline-secure-storage';

export const authRouter = Router();

const ACCESS_TOKEN_EXPIRY = '15m';
const ACCESS_TOKEN_ISSUER = 'dl-ids';
const ACCESS_TOKEN_AUDIENCE = 'ridgeline-services';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LEGACY_AUTH_ENABLED = process.env.IDS_ENABLE_LEGACY_AUTH === '1' && !IS_PRODUCTION;
const DEBUG_SECURITY = process.env.DEBUG_SECURITY === '1';

function securityLog(level, message) {
  if (level === 'warn') console.warn(message);
  else if (level === 'error') console.error(message);
  else if (!IS_PRODUCTION || DEBUG_SECURITY) console.log(message);
}

authRouter.use((req, res, next) => {
  if (LEGACY_AUTH_ENABLED) {
    next();
    return;
  }
  res.status(410).json({ error: 'legacy_auth_disabled', code: 'gone' });
});

function normalizeIdentityPubkey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function detectIdentityKeyChange(storedIdentityPubkey, lastKnownIdentityPubkey) {
  const stored = normalizeIdentityPubkey(storedIdentityPubkey);
  const known = normalizeIdentityPubkey(lastKnownIdentityPubkey);
  if (!stored || !known) return false;
  return stored !== known;
}

// ── /register ────────────────────────────────────────────────────────────────

authRouter.post('/register', async (req, res) => {
  try {
    const { username, email, password, identity_pubkey } = req.body;
    if (!username || !email || !password || !identity_pubkey) {
      return res.status(400).json({ error: 'Missing required fields', code: 'bad_request' });
    }
    if (password.length < 12) {
      return res.status(400).json({ error: 'Password must be at least 12 characters', code: 'bad_request' });
    }

    const db = req.db;

    // Check uniqueness
    const normalizedEmail = String(email).trim().toLowerCase();
    const emailBlindIndex = req.secureFields.configured ? req.secureFields.emailIndex(normalizedEmail) : null;
    const existing = req.secureFields.configured
      ? db.prepare('SELECT id FROM users WHERE username = ? OR email_blind_index = ?').get(username, emailBlindIndex)
      : db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'Username or email already taken', code: 'conflict' });
    }

    const userId = uuidv4();
    const passwordHash = await hashPasswordArgon2id(password, { environment: process.env.NODE_ENV });

    db.prepare(
      `INSERT INTO users (id, username, email, email_blind_index, password_hash, identity_pubkey)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      username,
      req.secureFields.encodeUserField(userId, 'email', normalizedEmail),
      emailBlindIndex,
      passwordHash,
      identity_pubkey,
    );

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
    securityLog('error', 'Register error');
    res.status(500).json({ error: 'Registration failed', code: 'internal' });
  }
});

// ── /login ───────────────────────────────────────────────────────────────────

authRouter.post('/login', async (req, res) => {
  try {
    const { username_or_email, password, last_known_identity_pubkey } = req.body;
    securityLog('info', '[IDS] POST /login');
    if (!username_or_email || !password) {
      return res.status(400).json({ error: 'Missing credentials', code: 'bad_request' });
    }

    const db = req.db;
    const identifier = String(username_or_email).trim().toLowerCase();
    const user = req.secureFields.configured
      ? db.prepare(
          'SELECT id, username, email, password_hash, identity_pubkey, system_role FROM users WHERE username = ? OR email_blind_index = ?'
        ).get(identifier, identifier.includes('@') ? req.secureFields.emailIndex(identifier) : '')
      : db.prepare(
          'SELECT id, username, email, password_hash, identity_pubkey, system_role FROM users WHERE username = ? OR email = ?'
        ).get(identifier, identifier);

    if (!user) {
      securityLog('warn', '[IDS] POST /login: user not found');
      return res.status(401).json({ error: 'Invalid credentials', code: 'invalid_credentials' });
    }

    const argon2id = isArgon2idHash(user.password_hash);
    const valid = argon2id
      ? await verifyPasswordArgon2id(user.password_hash, password)
      : await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      securityLog('warn', '[IDS] POST /login: bad password');
      return res.status(401).json({ error: 'Invalid credentials', code: 'invalid_credentials' });
    }
    if (!argon2id || await argon2idHashNeedsUpgrade(user.password_hash, { environment: process.env.NODE_ENV })) {
      const upgraded = await hashPasswordArgon2id(password, { environment: process.env.NODE_ENV });
      db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ? AND password_hash = ?')
        .run(upgraded, user.id, user.password_hash);
      securityLog('info', '[IDS_PASSWORD_HASH_UPGRADED]');
    }
    securityLog('info', '[IDS] POST /login: credentials validated');

    const accessToken = generateAccessToken(user.id, user.username, req.jwtSecret);
    const { refreshToken, tokenHash, expiresAt } = generateRefreshToken();
    const keyChangeDetected = detectIdentityKeyChange(user.identity_pubkey, last_known_identity_pubkey);

    db.prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), user.id, tokenHash, expiresAt);

    res.json({
      user_id: user.id,
      username: user.username,
      access_token: accessToken,
      refresh_token: refreshToken,
      system_role: user.system_role ?? null,
      key_change_detected: keyChangeDetected,
    });
    securityLog('info', '[IDS] POST /login: success');
  } catch (err) {
    securityLog('error', 'Login error');
    res.status(500).json({ error: 'Login failed', code: 'internal' });
  }
});

// ── /refresh ─────────────────────────────────────────────────────────────────

authRouter.post('/refresh', (req, res) => {
  try {
    const { refresh_token } = req.body;
    securityLog('info', '[IDS] POST /refresh');
    if (!refresh_token) {
      return res.status(400).json({ error: 'Missing refresh token', code: 'bad_request' });
    }

    const db = req.db;
    const tokenHash = hashToken(refresh_token);
    const row = db.prepare(
      "SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > datetime('now')"
    ).get(tokenHash);

    if (!row) {
      securityLog('warn', '[IDS] POST /refresh: token not found or expired');
      return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'invalid_token' });
    }

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
    securityLog('error', 'Refresh error');
    res.status(500).json({ error: 'Token refresh failed', code: 'internal' });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateAccessToken(userId, username, secret) {
  return jwt.sign(
    { sub: userId, username, type: 'access' },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_EXPIRY,
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    }
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
