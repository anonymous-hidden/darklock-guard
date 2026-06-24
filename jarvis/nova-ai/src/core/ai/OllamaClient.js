/**
 * OllamaClient — direct HTTP client for the local Ollama daemon.
 *
 * Streams responses with `/api/chat` (preferred — supports messages array)
 * with NDJSON line decoding. Fully cancellable via AbortController.
 *
 * Model strategy:
 *   - chat defaults to a small model so Nova stays responsive on low VRAM.
 *   - heavier local models are still preferred for code/widget generation.
 *
 * The renderer can talk to Ollama directly because Electron renderers are
 * not bound by browser CORS for localhost. No proxy is required.
 */

export const DEFAULT_MODEL = 'llama3.2:3b';
export const FAST_MODEL = 'llama3.2:3b';
export const OLLAMA_URL = 'http://localhost:11434';

const CHAT_MODEL_RANK = [
  /llama3\.2:1b/i,
  /llama3\.2:3b/i,
  /gemma3:1b/i,
  /gemma3:4b/i,
  /qwen2\.5:0\.5b/i,
  /qwen2\.5:1\.5b/i,
  /qwen2\.5:3b/i,
  /phi3:mini/i,
  /mistral:7b/i,
  /qwen2\.5:7b/i,
  /llama3\.1:8b/i,
  /llama3:8b/i,
];

const HEAVY_MODEL_RANK = [
  /llama3\.2:3b/i,
  /gemma3:4b/i,
  /mistral:7b/i,
  /llama3\.1:8b/i,
  /llama3:8b/i,
  /qwen2\.5:32b/i,
  /qwen2\.5-coder:32b/i,
  /deepseek-coder/i,
  /qwen2\.5:14b/i,
];

function modelName(model) {
  return String(model?.name || model?.model || model || '').trim();
}

function pickByRank(models, rank, fallback) {
  const names = (models || []).map(modelName).filter(Boolean);
  for (const rx of rank) {
    const hit = names.find((name) => rx.test(name));
    if (hit) return hit;
  }
  return names[0] || fallback;
}

function messagesToPrompt(messages) {
  return [
    ...messages.map((m) => `${String(m.role || 'user').toUpperCase()}:\n${String(m.content ?? '').trim()}`),
    'ASSISTANT:',
  ].join('\n\n');
}

export function pickBestChatModel(models, fallback = DEFAULT_MODEL) {
  return pickByRank(models, CHAT_MODEL_RANK, fallback);
}

export function pickBestHeavyModel(models, fallback = DEFAULT_MODEL) {
  return pickByRank(models, HEAVY_MODEL_RANK, pickBestChatModel(models, fallback));
}

/**
 * @typedef {{ role: 'system'|'user'|'assistant', content: string }} ChatMessage
 * @typedef {{
 *   model?: string,
 *   messages: ChatMessage[],
 *   temperature?: number,
 *   topP?: number,
 *   numCtx?: number,
 *   stop?: string[],
 *   signal?: AbortSignal,
 *   onToken?: (text: string, raw?: object) => void,
 *   onMeta?:  (meta: object) => void,
 * }} ChatOptions
 */

export class OllamaClient {
  constructor({ baseUrl = OLLAMA_URL, defaultModel = DEFAULT_MODEL } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultModel = defaultModel;
  }

  async health() {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      return { ok: true, version: data.version || 'unknown' };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  async listModels() {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`Ollama listModels failed: HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.models) ? data.models : [];
  }

  async resolveInstalledModel(preferred) {
    const wanted = modelName(preferred || this.defaultModel);
    let models = [];
    try { models = await this.listModels(); } catch { return wanted; }
    const names = models.map(modelName).filter(Boolean);
    if (!names.length) return wanted;
    if (names.includes(wanted)) return wanted;
    const base = wanted.split(':')[0];
    const sameBase = names.find((name) => name.split(':')[0] === base);
    if (sameBase) return sameBase;
    return pickBestChatModel(models, names[0]);
  }

  /**
   * Stream a chat completion. Returns the final accumulated text.
   * @param {ChatOptions} opts
   * @returns {Promise<{ text: string, model: string, durationMs: number, evalCount: number }>}
   */
  async chat(opts) {
    const {
      model = this.defaultModel,
      messages,
      temperature = 0.45,
      topP = 0.9,
      numCtx = 6144,
      numPredict = 900,
      stop,
      signal,
      onToken,
      onMeta,
    } = opts || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('OllamaClient.chat: messages[] required');
    }

    const resolvedModel = await this.resolveInstalledModel(model);

    const body = {
      model: resolvedModel,
      messages: messages.map((m) => ({ role: m.role, content: String(m.content ?? '') })),
      stream: true,
      options: {
        temperature,
        top_p: topP,
        num_ctx: numCtx,
        num_predict: numPredict,
        ...(Array.isArray(stop) && stop.length ? { stop } : {}),
      },
    };

    const start = Date.now();
    let res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    let mode = 'chat';
    if (res.status === 404) {
      mode = 'generate';
      res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: resolvedModel,
          prompt: messagesToPrompt(body.messages),
          stream: true,
          options: body.options,
        }),
        signal,
      });
    }

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Ollama chat failed (${res.status}): ${errText || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let evalCount = 0;
    let lastMeta = null;

    /* eslint-disable no-constant-condition */
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx;
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line) continue;

        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }

        if (parsed.error) {
          throw new Error(`Ollama error: ${parsed.error}`);
        }
        const tok = mode === 'generate' ? parsed?.response : parsed?.message?.content;
        if (typeof tok === 'string' && tok.length) {
          fullText += tok;
          if (onToken) {
            try { onToken(tok, parsed); } catch {}
          }
        }
        if (parsed.done) {
          lastMeta = parsed;
          evalCount = parsed.eval_count || evalCount;
          if (onMeta) { try { onMeta(parsed); } catch {} }
        }
      }
    }
    // Flush trailing buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        if (mode === 'generate' && parsed?.response) fullText += parsed.response;
        else if (parsed?.message?.content) fullText += parsed.message.content;
        if (parsed?.done) lastMeta = parsed;
      } catch {}
    }

    return {
      text: fullText,
      model: resolvedModel,
      durationMs: Date.now() - start,
      evalCount,
      raw: lastMeta,
    };
  }

  /**
   * Convenience: one-shot non-streaming chat (still uses streaming API
   * under the hood but resolves with the full string).
   */
  async chatOnce(opts) {
    const { text, model, durationMs, evalCount } = await this.chat({ ...opts, onToken: undefined });
    return { text, model, durationMs, evalCount };
  }
}

export const ollama = new OllamaClient();
