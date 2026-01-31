import { NextFunction, Response } from 'express';
import { Pool } from 'pg';
import { AuthenticatedRequest } from './auth';

export function audit(pool: Pool) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const started = Date.now();
    res.on('finish', async () => {
      try {
        const durationMs = Date.now() - started;
        await pool.query(
          `INSERT INTO audit_logs (device_id, action, path, method, status, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            req.auth?.deviceId || null,
            req.route?.path || req.originalUrl,
            req.originalUrl,
            req.method,
            res.statusCode,
            JSON.stringify({ durationMs, ip: req.ip }),
          ],
        );
      } catch (err) {
        // Do not block responses if audit fails
        console.warn('audit log failed', err);
      }
    });
    return next();
  };
}
