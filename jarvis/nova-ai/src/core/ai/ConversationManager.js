/**
 * ConversationManager — message history with a sliding context window.
 *
 * Keeps the system prompt + the most recent N tokens (approx) of conversation,
 * dropping the oldest user/assistant pairs when the budget is exceeded.
 * Token estimation is approximated as `len/4` characters which is good enough
 * for budgeting against an 8k–32k context.
 */

const APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 6000; // leave headroom for response generation

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / APPROX_CHARS_PER_TOKEN);
}

/**
 * @typedef {{ role: 'system'|'user'|'assistant', content: string, ts?: number, id?: string }} Message
 */

let _id = 0;
function nextId() {
  _id += 1;
  return `m_${Date.now().toString(36)}_${_id}`;
}

export class ConversationManager {
  constructor({ maxTokens = DEFAULT_MAX_TOKENS, systemPrompt = '' } = {}) {
    this.maxTokens = maxTokens;
    /** @type {Message[]} */
    this.messages = [];
    this.systemPrompt = systemPrompt;
  }

  setSystemPrompt(text) {
    this.systemPrompt = String(text || '');
  }

  reset() {
    this.messages = [];
  }

  /** Append a user message and return its record. */
  addUser(content) {
    const m = { id: nextId(), role: 'user', content: String(content ?? ''), ts: Date.now() };
    this.messages.push(m);
    return m;
  }

  /** Append a finished assistant message. */
  addAssistant(content, extra = {}) {
    const m = { id: nextId(), role: 'assistant', content: String(content ?? ''), ts: Date.now(), ...extra };
    this.messages.push(m);
    return m;
  }

  /** Replace the last assistant message (used while streaming). */
  updateLastAssistant(content) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        this.messages[i] = { ...this.messages[i], content: String(content ?? '') };
        return this.messages[i];
      }
    }
    return null;
  }

  removeById(id) {
    this.messages = this.messages.filter((m) => m.id !== id);
  }

  /**
   * Build the array passed to `OllamaClient.chat({ messages })`.
   * Always prepends the system prompt and trims oldest pairs to fit budget.
   */
  buildPayload({ extraSystem = '' } = {}) {
    const sys = [this.systemPrompt, extraSystem].filter(Boolean).join('\n\n').trim();
    const head = sys ? [{ role: 'system', content: sys }] : [];
    const sysTokens = estimateTokens(sys);

    // Walk backwards collecting messages until we exhaust the budget.
    const budget = this.maxTokens - sysTokens;
    /** @type {Message[]} */
    const tail = [];
    let used = 0;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      const t = estimateTokens(m.content) + 4; // overhead per message
      if (used + t > budget && tail.length >= 2) break;
      tail.push({ role: m.role, content: m.content });
      used += t;
    }
    tail.reverse();
    return [...head, ...tail];
  }

  /** Snapshot for persistence / store sync. */
  toJSON() {
    return {
      systemPrompt: this.systemPrompt,
      messages: this.messages.map((m) => ({ ...m })),
    };
  }

  static fromJSON(obj, opts = {}) {
    const cm = new ConversationManager(opts);
    if (obj && typeof obj === 'object') {
      cm.systemPrompt = obj.systemPrompt || '';
      cm.messages = Array.isArray(obj.messages) ? obj.messages.slice() : [];
    }
    return cm;
  }
}
