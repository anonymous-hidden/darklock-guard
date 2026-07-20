/**
 * JWT authentication middleware for IDS.
 */
import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_ISSUER = 'dl-ids';
const ACCESS_TOKEN_AUDIENCE = 'ridgeline-services';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEBUG_SECURITY = process.env.DEBUG_SECURITY === '1';

function logInfo(message) {
  if (!IS_PRODUCTION || DEBUG_SECURITY) {
    console.log(message);
  }
}

function logWarn(message) {
  if (!IS_PRODUCTION || DEBUG_SECURITY) {
    console.warn(message);
  } else {
    // Keep production logs free from user/account identifiers.
    console.warn(message);
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    logWarn('[IDS] requireAuth: missing/invalid Authorization header');
    return res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'unauthorized' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, req.jwtSecret, {
      algorithms: ['HS256'],
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    });
    if (!payload || typeof payload !== 'object' || payload.type !== 'access' || typeof payload.sub !== 'string') {
      return res.status(401).json({ error: 'Invalid token', code: 'invalid_token' });
    }
    req.userId = payload.sub;
    req.username = payload.username;
    logInfo('[IDS] requireAuth: OK user authenticated for %s %s', req.method, req.path);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      logWarn('[IDS] requireAuth: token expired');
      return res.status(401).json({ error: 'Token expired', code: 'token_expired' });
    }
    logWarn('[IDS] requireAuth: invalid token');
    return res.status(401).json({ error: 'Invalid token', code: 'invalid_token' });
  }
}
