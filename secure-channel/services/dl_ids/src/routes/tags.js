import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth.js';

export const tagsRouter = Router();

const MAX_SELECTED_TAGS = 5;

function requireAppGrantAuth(req, res, next) {
  const configured = process.env.IDS_APP_GRANT_KEY;
  if (!configured) return res.status(503).json({ error: 'Tag grant key is not configured', code: 'not_configured' });
  const provided = req.headers['x-app-grant-key'];
  if (provided !== configured) {
    return res.status(403).json({ error: 'Invalid grant key', code: 'forbidden' });
  }
  next();
}

// ── GET /users/me/tags ───────────────────────────────────────────────────────
tagsRouter.get('/users/me/tags', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const granted = db.prepare(`
      SELECT t.id, t.key, t.label, t.description, t.color_hex, utg.granted_at, utg.expires_at, utg.granted_by
      FROM user_tag_grants utg
      JOIN app_tags t ON t.id = utg.tag_id
      WHERE utg.user_id = ? AND (utg.expires_at IS NULL OR utg.expires_at > datetime('now'))
      ORDER BY utg.granted_at DESC
    `).all(userId);
    const selected = db.prepare(`
      SELECT t.id, t.key, t.label, t.description, t.color_hex, uts.position
      FROM user_tag_selections uts
      JOIN app_tags t ON t.id = uts.tag_id
      WHERE uts.user_id = ?
      ORDER BY uts.position ASC
    `).all(userId);
    res.json({ max_selected: MAX_SELECTED_TAGS, granted, selected });
  } catch (err) {
    console.error('[tags] get me tags error:', err);
    res.status(500).json({ error: 'Failed to load tags', code: 'internal' });
  }
});

// ── PUT /users/me/tags/selected ─────────────────────────────────────────────
tagsRouter.put('/users/me/tags/selected', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const tagIds = Array.isArray(req.body?.tag_ids) ? req.body.tag_ids : null;
    if (!tagIds) return res.status(400).json({ error: 'tag_ids array required', code: 'bad_request' });
    if (tagIds.some((id) => typeof id !== 'string')) {
      return res.status(400).json({ error: 'tag_ids must contain only strings', code: 'bad_request' });
    }
    if (new Set(tagIds).size !== tagIds.length) {
      return res.status(400).json({ error: 'tag_ids contains duplicates', code: 'bad_request' });
    }
    if (tagIds.length > MAX_SELECTED_TAGS) {
      return res.status(400).json({ error: `You can select at most ${MAX_SELECTED_TAGS} tags`, code: 'bad_request' });
    }

    // Only allow selecting tags that were granted by the app/event.
    const grantRows = db.prepare(`
      SELECT tag_id
      FROM user_tag_grants
      WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).all(userId);
    const granted = new Set(grantRows.map((r) => r.tag_id));
    for (const id of tagIds) {
      if (!granted.has(id)) {
        return res.status(403).json({ error: 'Cannot select a tag that was not granted', code: 'forbidden' });
      }
    }

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM user_tag_selections WHERE user_id = ?').run(userId);
      const ins = db.prepare(`
        INSERT INTO user_tag_selections (user_id, tag_id, position, selected_at)
        VALUES (?, ?, ?, datetime('now'))
      `);
      tagIds.forEach((id, idx) => ins.run(userId, id, idx));
    });
    tx();

    res.json({ ok: true, selected_count: tagIds.length, max_selected: MAX_SELECTED_TAGS });
  } catch (err) {
    console.error('[tags] update selection error:', err);
    res.status(500).json({ error: 'Failed to update selected tags', code: 'internal' });
  }
});

// ── GET /users/:id/tags ─────────────────────────────────────────────────────
tagsRouter.get('/users/:id/tags', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = req.params.id;
    const selected = db.prepare(`
      SELECT t.id, t.key, t.label, t.description, t.color_hex, uts.position
      FROM user_tag_selections uts
      JOIN app_tags t ON t.id = uts.tag_id
      WHERE uts.user_id = ?
      ORDER BY uts.position ASC
    `).all(userId);
    res.json({ selected });
  } catch (err) {
    console.error('[tags] get user tags error:', err);
    res.status(500).json({ error: 'Failed to load user tags', code: 'internal' });
  }
});

// ── POST /internal/tags/create ──────────────────────────────────────────────
tagsRouter.post('/internal/tags/create', requireAppGrantAuth, (req, res) => {
  try {
    const db = req.db;
    const { key, label, description, color_hex } = req.body ?? {};
    if (!key || !label) return res.status(400).json({ error: 'key and label are required', code: 'bad_request' });
    const existing = db.prepare('SELECT id FROM app_tags WHERE key = ?').get(key);
    if (existing) return res.status(409).json({ error: 'Tag key already exists', code: 'conflict' });

    const id = randomUUID();
    db.prepare(`
      INSERT INTO app_tags (id, key, label, description, color_hex)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, key, label, description ?? null, color_hex ?? '#99aab5');
    res.status(201).json({ id, key, label, description: description ?? null, color_hex: color_hex ?? '#99aab5' });
  } catch (err) {
    console.error('[tags] create tag error:', err);
    res.status(500).json({ error: 'Failed to create tag', code: 'internal' });
  }
});

// ── POST /internal/tags/grant ───────────────────────────────────────────────
tagsRouter.post('/internal/tags/grant', requireAppGrantAuth, (req, res) => {
  try {
    const db = req.db;
    const { user_id, tag_key, granted_by, expires_at, metadata_json } = req.body ?? {};
    if (!user_id || !tag_key || !granted_by) {
      return res.status(400).json({ error: 'user_id, tag_key and granted_by are required', code: 'bad_request' });
    }
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
    if (!user) return res.status(404).json({ error: 'User not found', code: 'not_found' });
    const tag = db.prepare('SELECT id FROM app_tags WHERE key = ?').get(tag_key);
    if (!tag) return res.status(404).json({ error: 'Tag not found', code: 'not_found' });

    const id = randomUUID();
    db.prepare(`
      INSERT OR IGNORE INTO user_tag_grants (id, user_id, tag_id, granted_by, expires_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      user_id,
      tag.id,
      granted_by,
      expires_at ?? null,
      metadata_json ? JSON.stringify(metadata_json) : null,
    );
    res.status(201).json({ ok: true, user_id, tag_id: tag.id });
  } catch (err) {
    console.error('[tags] grant tag error:', err);
    res.status(500).json({ error: 'Failed to grant tag', code: 'internal' });
  }
});
