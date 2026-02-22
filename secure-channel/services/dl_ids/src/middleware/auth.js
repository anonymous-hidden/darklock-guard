/**
 * JWT authentication middleware for IDS.
 */
import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    console.warn('[IDS] requireAuth: missing/invalid Authorization header %s %s', req.method, req.path);
    return res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'unauthorized' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, req.jwtSecret, { algorithms: ['HS256'] });
    req.userId = payload.sub;
    req.username = payload.username;
    console.log('[IDS] requireAuth: OK userId=%s username=%s path=%s %s', payload.sub, payload.username, req.method, req.path);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      console.warn('[IDS] requireAuth: token EXPIRED %s %s', req.method, req.path);
      return res.status(401).json({ error: 'Token expired', code: 'token_expired' });
    }
    console.warn('[IDS] requireAuth: invalid token %s %s err=%s', req.method, req.path, err.message);
    return res.status(401).json({ error: 'Invalid token', code: 'invalid_token' });
  }
}
