/**
 * Widgets IPC — persists generated widgets to disk and maintains
 * `widgets/registry.json` as the single source of truth.
 *
 * Widget on-disk format:
 *   widgets/<id>.jsx            — the raw component source
 *   widgets/<id>.meta.json      — duplicate of registry entry (audit trail)
 *   widgets/registry.json       — index of all widgets
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

function safeId() {
  return 'w_' + crypto.randomBytes(6).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

async function readRegistry(registryPath) {
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return { version: 1, widgets: [] };
    return { version: data.version || 1, widgets: Array.isArray(data.widgets) ? data.widgets : [] };
  } catch {
    return { version: 1, widgets: [] };
  }
}

async function writeRegistry(registryPath, registry) {
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf8');
}

export function registerWidgetsIpc(ipcMain, { rootDir }) {
  const widgetsDir = path.join(rootDir, 'widgets');
  const registryPath = path.join(widgetsDir, 'registry.json');

  ipcMain.handle('widgets:list', async () => {
    const reg = await readRegistry(registryPath);
    return { ok: true, widgets: reg.widgets };
  });

  ipcMain.handle('widgets:read', async (_evt, id) => {
    if (!id || typeof id !== 'string') return { ok: false, error: 'missing id' };
    try {
      const code = await fs.readFile(path.join(widgetsDir, `${id}.jsx`), 'utf8');
      return { ok: true, code };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('widgets:save', async (_evt, payload) => {
    const w = payload || {};
    const id = w.id || safeId();
    const meta = {
      id,
      name: String(w.name || 'Untitled Widget').slice(0, 80),
      description: String(w.description || '').slice(0, 400),
      tags: Array.isArray(w.tags) ? w.tags.slice(0, 10).map(String) : [],
      width: Number(w.width) || 480,
      height: Number(w.height) || 360,
      createdAt: w.createdAt || nowIso(),
      updatedAt: nowIso(),
      thumbnail: w.thumbnail || null,
      prompt: String(w.prompt || '').slice(0, 2000),
    };

    await fs.mkdir(widgetsDir, { recursive: true });
    await fs.writeFile(path.join(widgetsDir, `${id}.jsx`), String(w.code || ''), 'utf8');
    await fs.writeFile(path.join(widgetsDir, `${id}.meta.json`), JSON.stringify(meta, null, 2), 'utf8');

    const reg = await readRegistry(registryPath);
    const idx = reg.widgets.findIndex((x) => x.id === id);
    if (idx >= 0) reg.widgets[idx] = meta;
    else reg.widgets.unshift(meta);
    await writeRegistry(registryPath, reg);

    return { ok: true, widget: meta };
  });

  ipcMain.handle('widgets:delete', async (_evt, id) => {
    if (!id || typeof id !== 'string') return { ok: false, error: 'missing id' };
    const reg = await readRegistry(registryPath);
    const next = reg.widgets.filter((w) => w.id !== id);
    await writeRegistry(registryPath, { ...reg, widgets: next });
    for (const ext of ['.jsx', '.meta.json']) {
      try { await fs.unlink(path.join(widgetsDir, `${id}${ext}`)); } catch {}
    }
    return { ok: true };
  });
}
