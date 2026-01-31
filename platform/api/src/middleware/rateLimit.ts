import { NextFunction, Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const buckets: Map<string, Bucket> = new Map();

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || 'global';
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  if (bucket.count >= MAX_REQUESTS) {
    const retry = Math.max(0, bucket.resetAt - now);
    res.setHeader('Retry-After', Math.ceil(retry / 1000));
    return res.status(429).json({ error: 'rate_limited' });
  }

  bucket.count += 1;
  return next();
}
