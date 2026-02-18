import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireUser, AuthedRequest } from './auth';
import { randomBytes } from 'crypto';

const router = Router();

// All dashboard routes require authenticated user
router.use(requireUser as any);

// GET /api/dashboard/stats
router.get('/stats', async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const devicesResult = await pool.query(
      'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = $2) as online FROM devices WHERE owner_id = $1',
      [userId, 'online']
    );

    const alertsResult = await pool.query(
      `SELECT COUNT(*) as count FROM device_events de
       JOIN devices d ON de.device_id = d.id
       WHERE d.owner_id = $1 AND de.severity IN ('error', 'critical')
       AND de.created_at > now() - interval '24 hours'`,
      [userId]
    );

    const scanResult = await pool.query(
      `SELECT MAX(last_scan_at) as last_scan FROM devices WHERE owner_id = $1`,
      [userId]
    );

    const stats = devicesResult.rows[0];
    return res.json({
      totalDevices: parseInt(stats.total),
      onlineDevices: parseInt(stats.online),
      recentAlerts: parseInt(alertsResult.rows[0].count),
      lastScanTime: scanResult.rows[0].last_scan,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
});

// GET /api/dashboard/recent-events
router.get('/recent-events', async (req: AuthedRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT de.id, de.event_type, de.message, de.created_at, d.name as device_name
       FROM device_events de
       JOIN devices d ON de.device_id = d.id
       WHERE d.owner_id = $1
       ORDER BY de.created_at DESC
       LIMIT 20`,
      [req.user!.id]
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load events' });
  }
});

// GET /api/dashboard/logs
router.get('/logs', async (req: AuthedRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;
    const search = (req.query.search as string) || '';
    const eventType = (req.query.event_type as string) || '';
    const severity = (req.query.severity as string) || '';

    let where = 'd.owner_id = $1';
    const params: any[] = [req.user!.id];
    let paramIdx = 2;

    if (search) {
      where += ` AND de.message ILIKE $${paramIdx}`;
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (eventType) {
      where += ` AND de.event_type = $${paramIdx}`;
      params.push(eventType);
      paramIdx++;
    }
    if (severity) {
      where += ` AND de.severity = $${paramIdx}`;
      params.push(severity);
      paramIdx++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM device_events de JOIN devices d ON de.device_id = d.id WHERE ${where}`,
      params
    );

    const { rows } = await pool.query(
      `SELECT de.id, de.device_id, d.name as device_name, de.event_type, de.severity, de.message, de.metadata, de.created_at
       FROM device_events de
       JOIN devices d ON de.device_id = d.id
       WHERE ${where}
       ORDER BY de.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    return res.json({
      logs: rows,
      total: parseInt(countResult.rows[0].total),
      page,
      limit,
    });
  } catch (err) {
    console.error('Logs error:', err);
    return res.status(500).json({ error: 'Failed to load logs' });
  }
});

// GET /api/devices (user's devices list)
router.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, os, status, last_seen_at as last_heartbeat, baseline_valid, version
       FROM devices WHERE owner_id = $1 ORDER BY name`,
      [req.user!.id]
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load devices' });
  }
});

// GET /api/devices/:id (single device detail)
router.get('/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, os, status, last_seen_at as last_heartbeat, baseline_valid, baseline_files, version, public_key, linked_at, last_scan_at as last_scan
       FROM devices WHERE id = $1 AND owner_id = $2`,
      [req.params.id, req.user!.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Device not found' });
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load device' });
  }
});

// GET /api/devices/:id/events
router.get('/:id/events', async (req: AuthedRequest, res: Response) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    // Verify ownership
    const device = await pool.query('SELECT id FROM devices WHERE id = $1 AND owner_id = $2', [req.params.id, req.user!.id]);
    if (device.rows.length === 0) return res.status(404).json({ error: 'Device not found' });

    const { rows } = await pool.query(
      `SELECT id, event_type, severity, message, metadata, created_at
       FROM device_events WHERE device_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [req.params.id, limit]
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load events' });
  }
});

// POST /api/devices/generate-link
router.post('/generate-link', async (req: AuthedRequest, res: Response) => {
  try {
    // Generate 6-char alphanumeric code
    const code = randomBytes(3).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      `INSERT INTO device_link_codes (user_id, code, expires_at) VALUES ($1, $2, $3)`,
      [req.user!.id, code, expiresAt]
    );

    return res.json({ code, expires_at: expiresAt.toISOString() });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate code' });
  }
});

// POST /api/devices/:id/commands (send remote action)
router.post('/:id/commands', async (req: AuthedRequest, res: Response) => {
  try {
    const { action } = req.body;
    if (!action) return res.status(400).json({ error: 'Action required' });

    // Verify ownership
    const device = await pool.query('SELECT id FROM devices WHERE id = $1 AND owner_id = $2', [req.params.id, req.user!.id]);
    if (device.rows.length === 0) return res.status(404).json({ error: 'Device not found' });

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry
    const nonce = randomBytes(16).toString('hex');

    const { rows } = await pool.query(
      `INSERT INTO device_commands (device_id, command, payload, nonce, signature, status, expires_at)
       VALUES ($1, $2, '{}', $3, '', 'PENDING', $4)
       RETURNING id, command as action, status, issued_at as created_at`,
      [req.params.id, action, nonce, expiresAt]
    );

    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send command' });
  }
});

export default router;
