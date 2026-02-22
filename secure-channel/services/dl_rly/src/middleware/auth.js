/**
 * RLY auth middleware — verifies JWT issued by IDS.
 * The relay trusts IDS-issued tokens, same secret must be shared.
 */
import jwt from 'jsonwebtoken';

function resolveJwtSecrets() {
  // Prefer relay-specific secret, but allow shared secret names.
  // NOTE: resolved at request-time so that `.env` loading done in `src/server.js`
  // works correctly under Node ESM.
  const candidates = [
    process.env.RLY_JWT_SECRET,
    process.env.JWT_SECRET,
    process.env.IDS_JWT_SECRET,
  ].filter(Boolean);
  return [...new Set(candidates)];
}

function verifyWithAnySecret(token, secrets) {
  let lastErr;
  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('No JWT secrets configured');
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token', code: 'unauthorized' });
  }

  const JWT_SECRETS = resolveJwtSecrets();
  const hasValid = JWT_SECRETS.some((s) => typeof s === 'string' && s.length >= 32);
  if (!hasValid) {
    console.error('[RLY] Misconfigured JWT secret (RLY_JWT_SECRET/JWT_SECRET)');
    return res.status(500).json({ error: 'Relay authentication misconfigured', code: 'internal' });
  }

  try {
    const token = header.slice(7);
    const payload = verifyWithAnySecret(token, JWT_SECRETS);
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
