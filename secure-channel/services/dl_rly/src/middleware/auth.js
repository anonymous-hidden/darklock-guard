/**
 * RLY auth middleware — verifies JWT issued by IDS.
 * Only RLY_JWT_SECRET is accepted. No fallback env names.
 */
import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_ISSUER = 'dl-ids';
const ACCESS_TOKEN_AUDIENCE = 'ridgeline-services';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token', code: 'unauthorized' });
  }

  // Read at request-time so .env loaded by server.js at startup is present.
  const secret = process.env.RLY_JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim().length < 32) {
    console.error('[RLY] RLY_JWT_SECRET is missing or too short — startup should have caught this');
    return res.status(500).json({ error: 'Relay authentication misconfigured', code: 'internal' });
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, secret.trim(), {
      algorithms: ['HS256'],
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    });
    if (!payload || typeof payload !== 'object' || payload.type !== 'access' || typeof payload.sub !== 'string') {
      return res.status(401).json({ error: 'Invalid token', code: 'unauthorized' });
    }
    req.userId = payload.sub;
    req.username = payload.username;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'token_expired' });
    }
    return res.status(401).json({ error: 'Invalid token', code: 'unauthorized' });
  }
}
