import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthContext, Role, SecurityProfile } from '../types/api';

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

function getSecret(): string {
  const secret = process.env.API_JWT_SECRET;
  if (!secret) {
    throw new Error('API_JWT_SECRET is required');
  }
  return secret;
}

export function signDeviceToken(deviceId: string, securityProfile: SecurityProfile): string {
  return jwt.sign({ sub: deviceId, role: 'device', securityProfile }, getSecret(), {
    expiresIn: '12h',
  });
}

export function signServerToken(subject: string): string {
  return jwt.sign({ sub: subject, role: 'server' }, getSecret(), {
    expiresIn: '1h',
  });
}

function verifyToken(header?: string): AuthContext {
  if (!header) {
    throw new Error('Missing Authorization header');
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new Error('Invalid Authorization format');
  }
  const decoded = jwt.verify(token, getSecret()) as jwt.JwtPayload;
  const role = decoded.role as Role | undefined;
  if (!role) {
    throw new Error('Missing role in token');
  }
  return {
    deviceId: decoded.sub as string | undefined,
    role,
    securityProfile: decoded.securityProfile as SecurityProfile | undefined,
    issuedAt: decoded.iat,
  };
}

export function requireServerAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const ctx = verifyToken(req.header('authorization'));
    if (ctx.role !== 'server') {
      return res.status(403).json({ error: 'forbidden' });
    }
    req.auth = ctx;
    return next();
  } catch (err: any) {
    return res.status(401).json({ error: 'unauthorized', details: err?.message });
  }
}

export function requireDeviceAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const ctx = verifyToken(req.header('authorization'));
    if (ctx.role !== 'device' || !ctx.deviceId) {
      return res.status(403).json({ error: 'forbidden' });
    }
    req.auth = ctx;
    return next();
  } catch (err: any) {
    return res.status(401).json({ error: 'unauthorized', details: err?.message });
  }
}
