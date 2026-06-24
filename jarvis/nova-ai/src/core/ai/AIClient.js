import { ollama, pickBestChatModel } from './OllamaClient.js';

export const OPENAI_MODELS = [
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'gpt-4.1',
];

export const AUTO_MODEL = 'auto';
export const DEFAULT_MODEL = `openai:${OPENAI_MODELS[0]}`;
export const FAST_MODEL = `openai:${OPENAI_MODELS[0]}`;

const KNOWN_PREFIXES = new Set(['openai', 'ollama']);

export function parseModelRef(modelRef) {
  const raw = String(modelRef || '').trim();
  if (!raw) return { provider: 'openai', model: OPENAI_MODELS[0], full: DEFAULT_MODEL };
  if (/^auto(?:matic)?$/i.test(raw)) {
    return { provider: 'auto', model: '', full: AUTO_MODEL };
  }
  const idx = raw.indexOf(':');
  if (idx > 0) {
    const maybeProvider = raw.slice(0, idx).toLowerCase();
    if (KNOWN_PREFIXES.has(maybeProvider)) {
      const model = raw.slice(idx + 1).trim();
      return { provider: maybeProvider, model, full: `${maybeProvider}:${model}` };
    }
  }
  if (/^(gpt-|o[134]|chatgpt)/i.test(raw)) {
    return { provider: 'openai', model: raw, full: `openai:${raw}` };
  }
  return { provider: 'ollama', model: raw, full: `ollama:${raw}` };
}

export function pickBestAiModel(models, fallback = DEFAULT_MODEL) {
  const list = Array.isArray(models) ? models : [];
  const names = list
    .map((m) => (typeof m === 'string' ? m : (m?.name || m?.model || '')))
    .filter((n) => !!n && !/^auto(?:matic)?$/i.test(String(n)));
  if (!names.length) return fallback;

  const preferredOpenAi = [`openai:${OPENAI_MODELS[0]}`, `openai:${OPENAI_MODELS[1]}`, `openai:${OPENAI_MODELS[2]}`]
    .find((name) => names.includes(name));
  if (preferredOpenAi) return preferredOpenAi;

  const ollamaNames = names
    .filter((n) => n.startsWith('ollama:'))
    .map((n) => ({ name: n.slice('ollama:'.length) }));
  if (ollamaNames.length) return `ollama:${pickBestChatModel(ollamaNames, 'llama3.2:3b')}`;

  return names[0] || fallback;
}

class AIClient {
  async health(provider = 'auto') {
    const target = provider === 'auto' ? 'openai' : provider;
    try {
      const fn = window.nova?.ai?.health;
      if (typeof fn === 'function') {
        const out = await fn({ provider: target });
        return { ...out, provider: target };
      }
    } catch (err) {
      return { ok: false, error: String(err?.message || err), provider: target };
    }
    if (target === 'ollama') {
      const h = await ollama.health();
      return { ...h, provider: 'ollama' };
    }
    return { ok: false, error: 'AI bridge unavailable', provider: target };
  }

  async listModels() {
    try {
      const fn = window.nova?.ai?.listModels;
      if (typeof fn === 'function') {
        const out = await fn();
        if (out?.ok && Array.isArray(out.models)) return out.models;
      }
    } catch {}

    try {
      const local = await ollama.listModels();
      return (local || []).map((m) => ({ ...m, name: `ollama:${m.name || m.model}` }));
    } catch {
      return [];
    }
  }

  async chat(opts = {}) {
    const { provider: explicitProvider, model: modelRef = DEFAULT_MODEL } = opts;
    const parsed = parseModelRef(modelRef);
    const provider = explicitProvider || parsed.provider;
    const model = parsed.model;

    if (provider === 'openai') {
      const abortSignal = opts.signal;
      if (abortSignal?.aborted) {
        const e = new Error('Request aborted');
        e.name = 'AbortError';
        throw e;
      }
      const fn = window.nova?.ai?.chat;
      if (typeof fn !== 'function') {
        throw new Error('OpenAI bridge is unavailable in this renderer.');
      }
      const out = await fn({
        provider: 'openai',
        model,
        messages: opts.messages,
        temperature: opts.temperature,
        topP: opts.topP,
      });
      if (!out?.ok) throw new Error(out?.error || 'OpenAI request failed');
      const text = String(out.text || '');
      if (typeof opts.onToken === 'function' && text) {
        try { opts.onToken(text, { done: true, provider: 'openai' }); } catch {}
      }
      if (typeof opts.onMeta === 'function') {
        try { opts.onMeta({ provider: 'openai', usage: out.usage || null, done: true }); } catch {}
      }
      return {
        text,
        model: `openai:${out.model || model}`,
        provider: 'openai',
        durationMs: Number(out.durationMs || 0),
        evalCount: Number(out.evalCount || out?.usage?.total_tokens || 0),
      };
    }

    const localResult = await ollama.chat({
      ...opts,
      model,
    });
    return {
      ...localResult,
      model: `ollama:${localResult.model || model}`,
      provider: 'ollama',
    };
  }

  async chatOnce(opts = {}) {
    return this.chat({ ...opts, onToken: undefined });
  }
}

export const aiClient = new AIClient();
