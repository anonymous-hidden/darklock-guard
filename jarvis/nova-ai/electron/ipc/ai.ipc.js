/**
 * AI IPC — server-side helpers for Ollama discovery and health.
 *
 * Streaming chat is performed directly from the renderer via `fetch()` to
 * `http://localhost:11434/api/chat` (Electron renderers can do this freely
 * since the page is loaded over `http://localhost:5173` in dev / `file://`
 * in prod, both of which are not subject to CORS for localhost APIs in
 * Electron). This module only exposes operations that benefit from being
 * in the main process.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

async function ollamaJson(pathname, init = {}) {
  const res = await fetch(OLLAMA_URL + pathname, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export function registerAiIpc(ipcMain) {
  ipcMain.handle('ai:health', async () => {
    try {
      const res = await fetch(OLLAMA_URL + '/api/version');
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      return { ok: true, version: data.version || 'unknown' };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('ai:listModels', async () => {
    try {
      const data = await ollamaJson('/api/tags');
      const models = Array.isArray(data?.models) ? data.models : [];
      return {
        ok: true,
        models: models.map((m) => ({
          name: m.name,
          size: m.size,
          modified: m.modified_at,
          family: m?.details?.family || '',
          parameter_size: m?.details?.parameter_size || '',
        })),
      };
    } catch (err) {
      return { ok: false, models: [], error: String(err?.message || err) };
    }
  });
}
