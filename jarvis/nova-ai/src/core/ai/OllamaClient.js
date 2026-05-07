/**
 * OllamaClient — direct HTTP client for the local Ollama daemon.
 *
 * Streams responses with `/api/chat` (preferred — supports messages array)
 * with NDJSON line decoding. Fully cancellable via AbortController.
 *
 * Model strategy:
 *   - default: qwen2.5:32b   (deep reasoning, widget builds, code)
 *   - fast:    llama3.1:8b   (chat fallback, fast replies)
 *
 * The renderer can talk to Ollama directly because Electron renderers are
 * not bound by browser CORS for localhost. No proxy is required.
 */

export const DEFAULT_MODEL = 'qwen2.5:32b';
export const FAST_MODEL = 'llama3.1:8b';
export const OLLAMA_URL = 'http://localhost:11434';

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

  /**
   * Stream a chat completion. Returns the final accumulated text.
   * @param {ChatOptions} opts
   * @returns {Promise<{ text: string, model: string, durationMs: number, evalCount: number }>}
   */
  async chat(opts) {
    const {
      model = this.defaultModel,
      messages,
      temperature = 0.7,
      topP = 0.9,
      numCtx = 8192,
      stop,
      signal,
      onToken,
      onMeta,
    } = opts || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('OllamaClient.chat: messages[] required');
    }

    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: String(m.content ?? '') })),
      stream: true,
      options: {
        temperature,
        top_p: topP,
        num_ctx: numCtx,
        ...(Array.isArray(stop) && stop.length ? { stop } : {}),
      },
    };

    const start = Date.now();
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

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
        const tok = parsed?.message?.content;
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
        if (parsed?.message?.content) fullText += parsed.message.content;
        if (parsed?.done) lastMeta = parsed;
      } catch {}
    }

    return {
      text: fullText,
      model,
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
