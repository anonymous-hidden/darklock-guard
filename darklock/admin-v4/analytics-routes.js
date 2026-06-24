'use strict';

/**
 * Darklock Admin v4 — Analytics API Routes
 * Modular analytics with efficient aggregation, caching, premium gating, and audit logging.
 *
 * Mounted at: /api/v4/admin/analytics
 */

const express = require('express');
const router  = express.Router();
const MW      = require('./middleware');
const db      = require('../utils/database');

// ── In-memory result cache (TTL-based) ────────────────────────────────────────
const _cache = new Map();
const CACHE_TTL = 30_000; // 30s default

function cached(key, ttl = CACHE_TTL) {
  const entry = _cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  return null;
}
function setCache(key, data, ttl = CACHE_TTL) {
  _cache.set(key, { data, expiresAt: Date.now() + ttl });
}
// Expire old entries every 2min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache) { if (v.expiresAt < now) _cache.delete(k); }
}, 120_000);

// ── Utility ───────────────────────────────────────────────────────────────────
function timeWhere(column, range) {
  const ranges = {
    '24h':  `${column} >= datetime('now', '-1 day')`,
    '7d':   `${column} >= datetime('now', '-7 days')`,
    '30d':  `${column} >= datetime('now', '-30 days')`,
    '90d':  `${column} >= datetime('now', '-90 days')`,
    '1y':   `${column} >= datetime('now', '-1 year')`,
  };
  return ranges[range] || ranges['7d'];
}
function validRange(r, isPremium) {
  const free = ['24h', '7d'];
  const premium = ['24h', '7d', '30d', '90d', '1y', 'custom'];
  return (isPremium ? premium : free).includes(r) ? r : '7d';
}
function isPremiumAdmin(req) {
  // Any admin-level or above gets full analytics access (owner/coowner/admin = level ≥70)
  const level = req.admin?.level ?? 0;
  return level >= 70 || req.admin?.premiumTier === 'premium' || req.admin?.role === 'owner' || req.admin?.role === 'coowner';
}

// ── Free Tier Metrics ─────────────────────────────────────────────────────────
const FREE_METRICS = [
  'total_messages', 'messages_per_channel', 'messages_per_user',
  'joins', 'leaves', 'net_growth', 'bans', 'kicks',
  'time_activity', 'role_distribution', 'command_usage', 'mod_actions',
  'antiraid_triggers', 'antiphishing_blocks',
];
// Premium-Only Metrics
const PREMIUM_METRICS = [
  'suspicious_patterns', 'risk_score_trends', 'raid_velocity',
  'engagement_score', 'custom_events',
];

// ── Middleware: validate metric access ────────────────────────────────────────
function requireMetric(req, res, next) {
  const metric = req.params.metric || req.query.metric;
  if (!metric) return res.status(400).json({ success: false, error: 'Missing metric param' });
  const all = [...FREE_METRICS, ...PREMIUM_METRICS];
  if (!all.includes(metric)) return res.status(400).json({ success: false, error: `Unknown metric: ${metric}` });
  if (PREMIUM_METRICS.includes(metric) && !isPremiumAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Premium feature', premiumRequired: true, metric });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Routes
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /meta — metric catalogue + premium status ───────────────────────────
router.get('/meta', MW.helperOrAbove, (req, res) => {
  const premium = isPremiumAdmin(req);
  res.json({
    success: true,
    premium,
    freeMetrics: FREE_METRICS,
    premiumMetrics: PREMIUM_METRICS.map(m => ({ id: m, locked: !premium })),
    chartTypes: {
      free:    ['bar', 'line', 'area'],
      premium: ['donut', 'pie', 'stacked_bar', 'multi_line', 'heatmap', 'radar'],
    },
    layouts: {
      free:    ['grid', 'compact', 'detailed', '2col', '3col', 'fullwidth'],
      premium: ['drag_drop', 'profiles', 'presets'],
    },
    timeRanges: {
      free:    ['24h', '7d'],
      premium: ['24h', '7d', '30d', '90d', '1y', 'custom'],
    },
  });
});

// ── GET /overview-cards — live dashboard cards ──────────────────────────────
router.get('/overview-cards', MW.helperOrAbove, async (req, res) => {
  try {
    const ck = 'analytics:overview-cards';
    const hit = cached(ck, 15_000);
    if (hit) return res.json(hit);

    const [users, premium, activeSessions, bugs, openBugs, announcements, auditCount] = await Promise.all([
      db.get("SELECT COUNT(*) as c FROM users"),
      db.get("SELECT COUNT(*) as c FROM users WHERE role = 'premium'").catch(() => ({ c: 0 })),
      db.get("SELECT COUNT(*) as c FROM sessions WHERE expires_at > datetime('now')").catch(() => ({ c: 0 })),
      db.get("SELECT COUNT(*) as c FROM bug_reports_v2"),
      db.get("SELECT COUNT(*) as c FROM bug_reports_v2 WHERE status = 'open'"),
      db.get("SELECT COUNT(*) as c FROM platform_announcements"),
      db.get("SELECT COUNT(*) as c FROM admin_audit_trail WHERE created_at >= datetime('now', '-24 hours')"),
    ]);

    // Joins/Leaves last 7d (from audit trail)
    const joins7d = await db.get("SELECT COUNT(*) as c FROM admin_audit_trail WHERE category = 'member_join' AND created_at >= datetime('now', '-7 days')").catch(() => ({ c: 0 }));
    const leaves7d = await db.get("SELECT COUNT(*) as c FROM admin_audit_trail WHERE category = 'member_leave' AND created_at >= datetime('now', '-7 days')").catch(() => ({ c: 0 }));

    // Compute risk score from real signals: open bugs + recent leaves + failed audit actions.
    // 0-100 scale. No randomness — if signals are zero, score stays at the baseline.
    const failedAudit = await db.get("SELECT COUNT(*) as c FROM admin_audit_trail WHERE action LIKE '%fail%' AND created_at >= datetime('now', '-24 hours')").catch(() => ({ c: 0 }));
    const riskOpenBugs   = Math.min(40, (openBugs?.c   ?? 0) * 4);   // up to 40 pts
    const riskLeaves     = Math.min(20, (leaves7d?.c   ?? 0) * 2);   // up to 20 pts
    const riskAuditFails = Math.min(40, (failedAudit?.c ?? 0) * 5);   // up to 40 pts
    const riskScore = Math.min(100, riskOpenBugs + riskLeaves + riskAuditFails);

    const data = {
      success: true,
      cards: {
        totalUsers: users?.c ?? 0,
        premiumUsers: premium?.c ?? 0,
        activeSessions: activeSessions?.c ?? 0,
        totalBugs: bugs?.c ?? 0,
        openBugs: openBugs?.c ?? 0,
        announcements: announcements?.c ?? 0,
        auditActions24h: auditCount?.c ?? 0,
        joins7d: joins7d?.c ?? 0,
        leaves7d: leaves7d?.c ?? 0,
        netGrowth7d: (joins7d?.c ?? 0) - (leaves7d?.c ?? 0),
        riskScore,
      },
    };
    setCache(ck, data, 15_000);
    res.json(data);
  } catch (err) {
    console.error('[Analytics] overview-cards error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ── GET /metric/:metric — aggregated data for any metric ────────────────────
router.get('/metric/:metric', MW.helperOrAbove, requireMetric, async (req, res) => {
  try {
    const metric = req.params.metric;
    const range = validRange(req.query.range, isPremiumAdmin(req));
    const groupBy = req.query.groupBy || 'day'; // hour|day|week|month

    const ck = `analytics:${metric}:${range}:${groupBy}`;
    const hit = cached(ck);
    if (hit) return res.json(hit);

    const data = await aggregateMetric(metric, range, groupBy);
    const result = { success: true, metric, range, groupBy, data };
    setCache(ck, result);
    res.json(result);
  } catch (err) {
    console.error(`[Analytics] metric error:`, err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ── GET /timeseries — multi-metric time series ──────────────────────────────
router.get('/timeseries', MW.helperOrAbove, async (req, res) => {
  try {
    const metrics = (req.query.metrics || 'total_messages').split(',').slice(0, 5);
    const range = validRange(req.query.range, isPremiumAdmin(req));
    const premium = isPremiumAdmin(req);

    // Validate all metrics
    const allowed = [...FREE_METRICS, ...(premium ? PREMIUM_METRICS : [])];
    const valid = metrics.filter(m => allowed.includes(m));
    if (!valid.length) return res.status(400).json({ success: false, error: 'No valid metrics' });

    const ck = `analytics:ts:${valid.join(',')}:${range}`;
    const hit = cached(ck);
    if (hit) return res.json(hit);

    const series = {};
    for (const m of valid) {
      series[m] = await aggregateMetric(m, range, 'day');
    }
    const result = { success: true, range, series };
    setCache(ck, result);
    res.json(result);
  } catch (err) {
    console.error('[Analytics] timeseries error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ── POST /custom-chart — save custom chart (Premium) ────────────────────────
router.post('/custom-chart', MW.modOrAbove, async (req, res) => {
  if (!isPremiumAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Premium feature', premiumRequired: true });
  }
  try {
    const { title, chartType, primaryMetric, secondaryMetric, groupBy, aggregation, colorTheme, showLegend, showTooltips, showTrendLine, position } = req.body;
    if (!title || !chartType || !primaryMetric) {
      return res.status(400).json({ success: false, error: 'title, chartType, primaryMetric are required' });
    }
    const id = require('crypto').randomUUID();
    await db.run(
      `INSERT INTO analytics_custom_charts (id, admin_id, title, chart_type, primary_metric, secondary_metric, group_by, aggregation, color_theme, show_legend, show_tooltips, show_trend_line, position, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
      [id, req.admin.id, title, chartType, primaryMetric, secondaryMetric || null, groupBy || 'day', aggregation || 'count', colorTheme || 'indigo', showLegend ? 1 : 0, showTooltips !== false ? 1 : 0, showTrendLine ? 1 : 0, position || 0]
    );
    res.json({ success: true, id });
  } catch (err) {
    console.error('[Analytics] custom-chart save error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ── GET /custom-charts — list saved custom charts ───────────────────────────
router.get('/custom-charts', MW.helperOrAbove, async (req, res) => {
  try {
    const charts = await db.all(
      `SELECT * FROM analytics_custom_charts WHERE admin_id = ? ORDER BY position, created_at`,
      [req.admin.id]
    );
    res.json({ success: true, charts: charts || [] });
  } catch (err) {
    res.json({ success: true, charts: [] });
  }
});

// ── DELETE /custom-chart/:id ─────────────────────────────────────────────────
router.delete('/custom-chart/:id', MW.modOrAbove, async (req, res) => {
  try {
    await db.run(
      `DELETE FROM analytics_custom_charts WHERE id = ? AND admin_id = ?`,
      [req.params.id, req.admin.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ── POST /layout — save dashboard layout (Premium) ─────────────────────────
router.post('/layout', MW.modOrAbove, async (req, res) => {
  if (!isPremiumAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Premium feature', premiumRequired: true });
  }
  try {
    const { name, layout } = req.body;
    if (!name || !layout) return res.status(400).json({ success: false, error: 'name and layout required' });
    await db.run(
      `INSERT OR REPLACE INTO analytics_layouts (admin_id, name, layout, updated_at) VALUES (?,?,?,datetime('now'))`,
      [req.admin.id, name, JSON.stringify(layout)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ── GET /layouts — list saved layouts ───────────────────────────────────────
router.get('/layouts', MW.helperOrAbove, async (req, res) => {
  try {
    const layouts = await db.all(
      `SELECT name, layout, updated_at FROM analytics_layouts WHERE admin_id = ? ORDER BY updated_at DESC`,
      [req.admin.id]
    );
    res.json({ success: true, layouts: (layouts || []).map(l => ({ ...l, layout: JSON.parse(l.layout || '{}') })) });
  } catch (err) {
    res.json({ success: true, layouts: [] });
  }
});

// ── GET /export/csv — export data (Premium) ─────────────────────────────────
router.get('/export/csv', MW.modOrAbove, async (req, res) => {
  if (!isPremiumAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Premium feature', premiumRequired: true });
  }
  try {
    const metric = req.query.metric || 'total_messages';
    const range = validRange(req.query.range, true);
    const data = await aggregateMetric(metric, range, 'day');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="darklock-${metric}-${range}.csv"`);
    const header = 'label,value\n';
    const rows = (data.labels || []).map((l, i) => `"${l}",${(data.values || [])[i] ?? 0}`).join('\n');
    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Aggregation Engine
// ═══════════════════════════════════════════════════════════════════════════════

async function aggregateMetric(metric, range, groupBy) {
  const tw = timeWhere('created_at', range);
  const fmt = {
    hour:  '%Y-%m-%d %H:00',
    day:   '%Y-%m-%d',
    week:  '%Y-W%W',
    month: '%Y-%m',
  }[groupBy] || '%Y-%m-%d';

  switch (metric) {
    // ── Messages ────────────────────────────────────────────────────────────
    case 'total_messages': {
      const rows = await safeAll(`
        SELECT strftime('${fmt}', created_at) as label, COUNT(*) as value
        FROM admin_audit_trail WHERE category = 'message' AND ${tw}
        GROUP BY label ORDER BY label
      `);
      return toSeries(rows);
    }
    case 'messages_per_channel': {
      const rows = await safeAll(`
        SELECT target_id as label, COUNT(*) as value
        FROM admin_audit_trail WHERE category = 'message' AND ${tw}
        GROUP BY target_id ORDER BY value DESC LIMIT 15
      `);
      return toSeries(rows);
    }
    case 'messages_per_user': {
      const rows = await safeAll(`
        SELECT admin_email as label, COUNT(*) as value
        FROM admin_audit_trail WHERE category = 'message' AND ${tw}
        GROUP BY admin_email ORDER BY value DESC LIMIT 15
      `);
      return toSeries(rows);
    }

    // ── Members ─────────────────────────────────────────────────────────────
    case 'joins': {
      const rows = await safeAll(`
        SELECT strftime('${fmt}', created_at) as label, COUNT(*) as value
        FROM admin_audit_trail WHERE action LIKE '%join%' AND ${tw}
        GROUP BY label ORDER BY label
      `);
      return toSeries(rows);
    }
    case 'leaves': {
      const rows = await safeAll(`
        SELECT strftime('${fmt}', created_at) as label, COUNT(*) as value
        FROM admin_audit_trail WHERE action LIKE '%leave%' AND ${tw}
        GROUP BY label ORDER BY label
      `);
      return toSeries(rows);
    }
    case 'net_growth': {
      const joins = await safeAll(`
        SELECT strftime('${fmt}', created_at) as label, COUNT(*) as value
        FROM admin_audit_trail WHERE action LIKE '%join%' AND ${tw}
        GROUP BY label ORDER BY label
      `);
      const leaves = await safeAll(`
        SELECT strftime('${fmt}', created_at) as label, COUNT(*) as value
        FROM admin_audit_trail WHERE action LIKE '%leave%' AND ${tw}
        GROUP BY label ORDER BY label
      `);
      const leaveMap = Object.fromEntries((leaves || []).map(r => [r.label, r.value]));
      const merged = (joins || []).map(r => ({ label: r.label, value: r.value - (leaveMap[r.label] || 0) }));
      return toSeries(merged);
    }

    // ── Moderation ──────────────────────────────────────────────────────────
    case 'bans': return await countByAction('%ban%', fmt, tw);
    case 'kicks': return await countByAction('%kick%', fmt, tw);
    case 'mod_actions': {
      const rows = await safeAll(`
        SELECT action as label, COUNT(*) as value
        FROM admin_audit_trail WHERE category IN ('moderation','security') AND ${tw}
        GROUP BY action ORDER BY value DESC LIMIT 20
      `);
      return toSeries(rows);
    }

    // ── Activity ────────────────────────────────────────────────────────────
    case 'time_activity': {
      const rows = await safeAll(`
        SELECT strftime('%H', created_at) as label, COUNT(*) as value
        FROM admin_audit_trail WHERE ${timeWhere('created_at', range)}
        GROUP BY label ORDER BY label
      `);
      return toSeries(rows);
    }
    case 'command_usage': {
      const rows = await safeAll(`
        SELECT action as label, COUNT(*) as value
        FROM admin_audit_trail WHERE category = 'command' AND ${tw}
        GROUP BY action ORDER BY value DESC LIMIT 15
      `);
      return toSeries(rows);
    }

    // ── Security ────────────────────────────────────────────────────────────
    case 'antiraid_triggers': return await countByAction('%raid%', fmt, tw);
    case 'antiphishing_blocks': return await countByAction('%phish%', fmt, tw);
    case 'role_distribution': {
      const rows = await safeAll(`
        SELECT role as label, COUNT(*) as value FROM users GROUP BY role ORDER BY value DESC
      `);
      return toSeries(rows);
    }

    // ── Premium ─────────────────────────────────────────────────────────────
    case 'suspicious_patterns':
    case 'risk_score_trends':
    case 'raid_velocity':
    case 'engagement_score':
    case 'custom_events': {
      // No synthetic data. These metrics require a real signal source that is not
      // wired up yet — return an empty series so the UI honestly shows "no data"
      // instead of misleading placeholder values.
      return { labels: [], values: [] };
    }

    default:
      return { labels: [], values: [] };
  }
}

async function countByAction(pattern, fmt, tw) {
  const rows = await safeAll(`
    SELECT strftime('${fmt}', created_at) as label, COUNT(*) as value
    FROM admin_audit_trail WHERE action LIKE '${pattern}' AND ${tw}
    GROUP BY label ORDER BY label
  `);
  return toSeries(rows);
}

function toSeries(rows) {
  return {
    labels: (rows || []).map(r => r.label || 'Unknown'),
    values: (rows || []).map(r => r.value || 0),
  };
}

async function safeAll(sql, params) {
  try { return (await db.all(sql, params)) || []; }
  catch { return []; }
}

module.exports = router;
