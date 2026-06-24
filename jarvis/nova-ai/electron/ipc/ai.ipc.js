/**
 * AI IPC — main-process helpers for model/provider discovery and chat calls.
 *
 * Supports two providers:
 *   - Ollama (local)
 *   - OpenAI Chat Completions (cloud)
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OPENAI_URL = process.env.OPENAI_URL || 'https://api.openai.com/v1';
const OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOVA_ROOT = path.resolve(__dirname, '..', '..');

function parseEnvKey(filePath, key) {
  try {
    if (!existsSync(filePath)) return '';
    const content = readFileSync(filePath, 'utf8');
    const line = content
      .split(/\r?\n/)
      .find((l) => new RegExp(`^\\s*${key}\\s*=`, 'i').test(l));
    if (!line) return '';
    const idx = line.indexOf('=');
    if (idx < 0) return '';
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value.trim();
  } catch {
    return '';
  }
}

function readKeyFromKnownEnvFiles(key) {
  const candidates = [
    path.join(NOVA_ROOT, '.env'),
    path.join(path.resolve(NOVA_ROOT, '..'), '.env'),
    path.join(path.resolve(NOVA_ROOT, '..', '..'), '.env'),
  ];
  for (const file of candidates) {
    const value = parseEnvKey(file, key);
    if (value) return value;
  }
  return '';
}

function getOpenAiKey() {
  const fromEnv = String(process.env.OPENAI_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  return readKeyFromKnownEnvFiles('OPENAI_API_KEY');
}

function normalizeModelRef(name, provider = 'ollama') {
  const n = String(name || '').trim();
  if (!n) return '';
  return n.includes(':') && (n.startsWith('openai:') || n.startsWith('ollama:'))
    ? n
    : `${provider}:${n}`;
}

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
  ipcMain.handle('ai:health', async (_evt, payload = {}) => {
    const provider = String(payload?.provider || 'ollama').toLowerCase();
    if (provider === 'openai') {
      const key = getOpenAiKey();
      if (!key) {
        return { ok: false, provider: 'openai', error: 'OPENAI_API_KEY is missing' };
      }
      return { ok: true, provider: 'openai', version: 'api' };
    }

    try {
      const res = await fetch(OLLAMA_URL + '/api/version');
      if (!res.ok) return { ok: false, provider: 'ollama', error: `HTTP ${res.status}` };
      const data = await res.json();
      return { ok: true, provider: 'ollama', version: data.version || 'unknown' };
    } catch (err) {
      return { ok: false, provider: 'ollama', error: String(err?.message || err) };
    }
  });

  ipcMain.handle('ai:listModels', async () => {
    const openAiKey = getOpenAiKey();
    const providers = {
      openai: { available: !!openAiKey, reason: openAiKey ? '' : 'OPENAI_API_KEY is missing' },
      ollama: { available: false, reason: '' },
    };

    const models = [];
    if (openAiKey) {
      try {
        const res = await fetch(`${OPENAI_URL}/models`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${openAiKey}` },
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(json?.data)) {
          const openAiIds = [...new Set(json.data.map((m) => String(m?.id || '').trim()).filter(Boolean))];
          for (const m of openAiIds) {
            models.push({ name: normalizeModelRef(m, 'openai'), provider: 'openai', family: 'openai' });
          }
        }
      } catch {}

      if (!models.some((m) => m.provider === 'openai')) {
        for (const m of OPENAI_MODELS) {
          models.push({ name: normalizeModelRef(m, 'openai'), provider: 'openai', family: 'openai' });
        }
      }
    }

    try {
      const data = await ollamaJson('/api/tags');
      const localModels = Array.isArray(data?.models) ? data.models : [];
      providers.ollama.available = true;

      for (const m of localModels) {
        models.push({
          name: normalizeModelRef(m.name, 'ollama'),
          provider: 'ollama',
          size: m.size,
          modified: m.modified_at,
          family: m?.details?.family || '',
          parameter_size: m?.details?.parameter_size || '',
        });
      }

      return {
        ok: models.length > 0,
        models,
        providers,
      };
    } catch (err) {
      providers.ollama.available = false;
      providers.ollama.reason = String(err?.message || err);
      return {
        ok: models.length > 0,
        models,
        providers,
        error: models.length ? '' : String(err?.message || err),
      };
    }
  });

  ipcMain.handle('ai:chat', async (_evt, payload = {}) => {
    const provider = String(payload?.provider || '').toLowerCase();
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    const modelRef = String(payload?.model || '').trim();
    const temperature = Number.isFinite(payload?.temperature) ? payload.temperature : 0.45;
    const topP = Number.isFinite(payload?.topP) ? payload.topP : 0.9;

    if (!messages.length) return { ok: false, error: 'messages[] required' };

    if (provider === 'openai' || modelRef.startsWith('openai:')) {
      const key = getOpenAiKey();
      if (!key) return { ok: false, error: 'OPENAI_API_KEY is missing' };

      const model = modelRef.replace(/^openai:/, '') || OPENAI_MODELS[0];
      const start = Date.now();

      try {
        const res = await fetch(`${OPENAI_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: messages.map((m) => ({
              role: m?.role || 'user',
              content: String(m?.content ?? ''),
            })),
            temperature,
            top_p: topP,
          }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = json?.error?.message || `OpenAI HTTP ${res.status}`;
          return { ok: false, error: msg };
        }

        const text = String(json?.choices?.[0]?.message?.content || '');
        return {
          ok: true,
          provider: 'openai',
          model,
          text,
          usage: json?.usage || null,
          evalCount: json?.usage?.total_tokens || 0,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
    }

    const model = modelRef.replace(/^ollama:/, '').trim();
    const chosenModel = model || 'llama3.2:3b';
    const start = Date.now();

    try {
      const data = await ollamaJson('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          model: chosenModel,
          stream: false,
          messages: messages.map((m) => ({ role: m?.role || 'user', content: String(m?.content ?? '') })),
          options: { temperature, top_p: topP },
        }),
      });
      return {
        ok: true,
        provider: 'ollama',
        model: chosenModel,
        text: String(data?.message?.content || ''),
        evalCount: Number(data?.eval_count || 0),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}
