import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

router.get('/', async (req, res) => {
  const { os, channel, version, product } = req.query as { os?: string; channel?: string; version?: string; product?: string };
  const conditions: string[] = [];
  const params: any[] = [];

  if (os && os !== 'all') {
    params.push(os);
    conditions.push(`os = $${params.length}`);
  }
  if (product && product !== 'all') {
    params.push(product);
    conditions.push(`product = $${params.length}`);
  }
  if (channel && channel !== 'all') {
    params.push(channel);
    conditions.push(`channel = $${params.length}`);
  }
  if (version) {
    params.push(`%${version}%`);
    conditions.push(`version ILIKE $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM releases
       ${where}
       ORDER BY created_at DESC
       LIMIT 100`,
    params,
  );

  return res.json({ releases: rows });
});

router.get('/:os/:channel/latest', async (req, res) => {
  const { os, channel } = req.params;
  const { rows } = await pool.query(
    `SELECT * FROM releases
     WHERE os = $1 AND channel = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [os, channel],
  );

  if (!rows.length) {
    return res.status(404).json({ error: 'release_not_found' });
  }

  return res.json({ release: rows[0] });
});

export default router;
