import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { UserRecord } from '../types/api';

const router = Router();

interface AuthedRequest extends Request {
  user?: UserRecord & { role?: string };
}

// ---------- Middleware ----------

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  pool
    .query('SELECT * FROM users WHERE id = $1', [userId])
    .then(({ rows }) => {
      if (rows.length === 0) return res.status(401).json({ error: 'User not found' });
      const user = rows[0];
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      req.user = user;
      next();
    })
    .catch(() => res.status(500).json({ error: 'Internal error' }));
}

// ---------- Telemetry ingestion (PUBLIC - no auth, anonymous) ----------

// POST /api/admin/telemetry/report - Desktop apps send crash/bug reports here
router.post('/telemetry/report', async (req: Request, res: Response) => {
  try {
    const { type, description, diagnostics, stack_trace, app_version, platform, os_version, error_code, metadata } = req.body;
    
    if (!type) return res.status(400).json({ error: 'type is required' });

    await pool.query(
      `INSERT INTO crash_reports (report_type, description, diagnostics, stack_trace, app_version, platform, os_version, error_code, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        type || 'crash',
        description || null,
        diagnostics || null,
        stack_trace || null,
        app_version || null,
        platform || null,
        os_version || null,
        error_code || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    res.json({ ok: true });
  } catch (e: any) {
    console.error('Telemetry ingestion error:', e.message);
    res.status(500).json({ error: 'Failed to store report' });
  }
});

// ---------- Admin-only routes below ----------

// GET /api/admin/stats - Overview stats for the admin dashboard
router.get('/stats', requireAdmin, async (_req: AuthedRequest, res: Response) => {
  try {
    const [crashes, devices, users, recentCrashes] = await Promise.all([
      pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE NOT resolved) as unresolved FROM crash_reports'),
      pool.query('SELECT COUNT(*) as total FROM devices'),
      pool.query('SELECT COUNT(*) as total FROM users'),
      pool.query(`SELECT report_type, COUNT(*) as count FROM crash_reports WHERE created_at > now() - interval '7 days' GROUP BY report_type`),
    ]);

    res.json({
      crash_reports: {
        total: parseInt(crashes.rows[0].total),
        unresolved: parseInt(crashes.rows[0].unresolved),
      },
      devices: parseInt(devices.rows[0].total),
      users: parseInt(users.rows[0].total),
      recent_by_type: recentCrashes.rows,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/crash-reports - List crash reports with pagination
router.get('/crash-reports', requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;
    const resolved = req.query.resolved;
    const type = req.query.type;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (resolved !== undefined) {
      params.push(resolved === 'true');
      where += ` AND resolved = $${params.length}`;
    }
    if (type) {
      params.push(type);
      where += ` AND report_type = $${params.length}`;
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM crash_reports ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT id, report_type, description, app_version, platform, error_code, resolved, notes, created_at
       FROM crash_reports ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ reports: result.rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/crash-reports/:id - Single crash report details
router.get('/crash-reports/:id', requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    const { rows } = await pool.query('SELECT * FROM crash_reports WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/admin/crash-reports/:id - Resolve / add notes to a crash report
router.patch('/crash-reports/:id', requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    const { resolved, notes } = req.body;
    const updates: string[] = [];
    const params: any[] = [];

    if (resolved !== undefined) {
      params.push(resolved);
      updates.push(`resolved = $${params.length}`);
    }
    if (notes !== undefined) {
      params.push(notes);
      updates.push(`notes = $${params.length}`);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE crash_reports SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/crash-reports/:id - Delete a crash report
router.delete('/crash-reports/:id', requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    const result = await pool.query('DELETE FROM crash_reports WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/crash-reports/stats/versions - Crash breakdown by app version
router.get('/crash-reports/stats/versions', requireAdmin, async (_req: AuthedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT app_version, COUNT(*) as count, COUNT(*) FILTER (WHERE NOT resolved) as unresolved
       FROM crash_reports
       GROUP BY app_version
       ORDER BY count DESC
       LIMIT 20`
    );
    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/push-update - Record an update push
router.post('/push-update', requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    const { version, channel, title, release_notes } = req.body;
    if (!version) return res.status(400).json({ error: 'version is required' });

    // Count target devices on this channel
    const deviceCount = await pool.query(
      "SELECT COUNT(*) FROM devices WHERE status != 'offline'"
    );

    const result = await pool.query(
      `INSERT INTO update_pushes (version, channel, title, release_notes, pushed_by, target_count)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [version, channel || 'stable', title || `v${version} Release`, release_notes || '', req.user?.id, parseInt(deviceCount.rows[0].count)]
    );

    res.json(result.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/push-updates - List update pushes
router.get('/push-updates', requireAdmin, async (_req: AuthedRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM update_pushes ORDER BY created_at DESC LIMIT 50'
    );
    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/devices - Admin view of all devices (no user data)
router.get('/devices', requireAdmin, async (_req: AuthedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT d.id, d.name, d.os, d.version, d.status, d.security_profile, d.baseline_valid, 
              d.baseline_files, d.last_scan_at, d.last_seen_at, d.linked_at
       FROM devices d
       ORDER BY d.last_seen_at DESC NULLS LAST
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
