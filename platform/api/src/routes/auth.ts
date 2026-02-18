import { Router, Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { pool } from '../db/pool';
import { UserRecord } from '../types/api';

const router = Router();

// Session-based user auth - attach user to req
interface AuthedRequest extends Request {
  user?: UserRecord;
}

function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  pool
    .query('SELECT * FROM users WHERE id = $1', [userId])
    .then(({ rows }) => {
      if (rows.length === 0) {
        return res.status(401).json({ error: 'User not found' });
      }
      req.user = rows[0] as UserRecord;
      next();
    })
    .catch(() => res.status(500).json({ error: 'Internal error' }));
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (typeof username !== 'string' || username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: 'Username must be 3-32 characters' });
    }
    if (typeof password !== 'string' || password.length < 10) {
      return res.status(400).json({ error: 'Password must be at least 10 characters' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check existing
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2)',
      [email, username]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already taken' });
    }

    // Hash password with Argon2id
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 4,
    });

    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, totp_enabled, created_at`,
      [username.trim(), email.trim().toLowerCase(), passwordHash]
    );

    const user = rows[0];
    (req.session as any).userId = user.id;

    return res.status(201).json({
      id: user.id,
      username: user.username,
      email: user.email,
      totp_enabled: user.totp_enabled,
    });
  } catch (err: any) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, totp_code } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0] as UserRecord;

    const validPassword = await argon2.verify(user.password_hash, password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check 2FA
    if (user.totp_enabled && user.totp_secret) {
      if (!totp_code) {
        return res.status(403).json({ error: '2FA code required', requires_2fa: true });
      }
      const valid = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: totp_code });
      if (!valid) {
        return res.status(401).json({ error: 'Invalid 2FA code' });
      }
    }

    (req.session as any).userId = user.id;

    return res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      totp_enabled: user.totp_enabled,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('dlg.sid');
    return res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', requireUser as any, (req: AuthedRequest, res: Response) => {
  const u = req.user!;
  return res.json({
    id: u.id,
    username: u.username,
    email: u.email,
    role: (u as any).role || 'user',
    totp_enabled: u.totp_enabled,
    api_key: u.api_key ? `${u.api_key.slice(0, 8)}${'•'.repeat(32)}` : null,
    created_at: u.created_at,
  });
});

// PATCH /api/auth/profile
router.patch('/profile', requireUser as any, async (req: AuthedRequest, res: Response) => {
  try {
    const { username, email } = req.body;
    const user = req.user!;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (username && username !== user.username) {
      const dup = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2', [username, user.id]);
      if (dup.rows.length > 0) return res.status(409).json({ error: 'Username already taken' });
      updates.push(`username = $${paramIdx++}`);
      values.push(username.trim());
    }
    if (email && email !== user.email) {
      const dup = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2', [email, user.id]);
      if (dup.rows.length > 0) return res.status(409).json({ error: 'Email already taken' });
      updates.push(`email = $${paramIdx++}`);
      values.push(email.trim().toLowerCase());
    }

    if (updates.length === 0) return res.json({ ok: true });

    updates.push(`updated_at = now()`);
    values.push(user.id);

    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

// PUT /api/auth/password
router.put('/password', requireUser as any, async (req: AuthedRequest, res: Response) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Both current and new password required' });
    }
    if (new_password.length < 10) {
      return res.status(400).json({ error: 'New password must be at least 10 characters' });
    }

    const valid = await argon2.verify(req.user!.password_hash, current_password);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await argon2.hash(new_password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, req.user!.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Password change failed' });
  }
});

// POST /api/auth/2fa/setup
router.post('/2fa/setup', requireUser as any, async (req: AuthedRequest, res: Response) => {
  try {
    const secretObj = speakeasy.generateSecret({ name: `Darklock Guard (${req.user!.email})`, issuer: 'Darklock' });
    const secret = secretObj.base32;
    const otpauth = secretObj.otpauth_url!;
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    // Store secret temporarily (not enabled yet)
    await pool.query('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret, req.user!.id]);

    return res.json({ qr_url: qrDataUrl, secret });
  } catch (err) {
    return res.status(500).json({ error: '2FA setup failed' });
  }
});

// POST /api/auth/2fa/verify
router.post('/2fa/verify', requireUser as any, async (req: AuthedRequest, res: Response) => {
  try {
    const { code } = req.body;

    // Re-fetch to get latest totp_secret
    const { rows } = await pool.query('SELECT totp_secret FROM users WHERE id = $1', [req.user!.id]);
    const secret = rows[0]?.totp_secret;
    if (!secret) return res.status(400).json({ error: 'No 2FA setup in progress' });

    const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: code });
    if (!valid) return res.status(400).json({ error: 'Invalid code' });

    await pool.query('UPDATE users SET totp_enabled = TRUE WHERE id = $1', [req.user!.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// DELETE /api/auth/2fa
router.delete('/2fa', requireUser as any, async (req: AuthedRequest, res: Response) => {
  try {
    await pool.query('UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1', [req.user!.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// POST /api/auth/api-key
router.post('/api-key', requireUser as any, async (req: AuthedRequest, res: Response) => {
  try {
    // Generate a secure random API key
    const { randomBytes } = await import('crypto');
    const key = `dlg_${randomBytes(32).toString('hex')}`;

    await pool.query('UPDATE users SET api_key = $1, updated_at = now() WHERE id = $2', [key, req.user!.id]);
    return res.json({ api_key: key });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate API key' });
  }
});

export { requireUser, AuthedRequest };
export default router;
