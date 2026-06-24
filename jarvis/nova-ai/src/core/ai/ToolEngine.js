/**
 * ToolEngine — parses tool-call blocks emitted by the model and executes
 * them against the IPC tool dispatcher.
 *
 * Protocol the model is taught (see PromptEngine.TOOLS_MODE):
 *
 *   <<<TOOL_CALL>>>
 *   { "name": "system.volume.set", "args": { "level": 50 } }
 *   <<<TOOL_END>>>
 *
 * Multiple calls may appear per response. ToolEngine.runAll() executes
 * them sequentially and returns an array of { call, result, error? }.
 */

const RX = /<<<TOOL_CALL>>>\s*([\s\S]*?)\s*<<<TOOL_END>>>/g;

function tryJson(s) {
  const txt = String(s || '').trim();
  // Allow accidental fenced JSON.
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = fence ? fence[1] : txt;
  try { return JSON.parse(body); } catch { return null; }
}

export const ToolEngine = {
  /** Find every tool-call block in a string and return parsed calls. */
  parse(text) {
    const calls = [];
    if (!text) return calls;
    RX.lastIndex = 0;
    let m;
    while ((m = RX.exec(text)) !== null) {
      const json = tryJson(m[1]);
      if (json && typeof json.name === 'string') {
        calls.push({ name: json.name, args: json.args || {}, raw: m[0] });
      } else {
        calls.push({ name: null, args: null, raw: m[0], parseError: 'invalid JSON' });
      }
    }
    return calls;
  },

  /** Execute one tool call via the preload bridge. */
  async execute(call) {
    if (!call?.name) return { ok: false, error: call?.parseError || 'no tool name' };
    if (typeof window === 'undefined' || !window.nova?.tools?.execute) {
      return { ok: false, error: 'tool bridge unavailable' };
    }
    try {
      return await window.nova.tools.execute(call.name, call.args || {});
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  },

  /** Execute every parsed call sequentially and return outcomes. */
  async runAll(text, { onBefore, onAfter } = {}) {
    const calls = this.parse(text);
    const out = [];
    for (const c of calls) {
      try { onBefore?.(c); } catch {}
      const result = await this.execute(c);
      out.push({ call: c, result });
      try { onAfter?.(c, result); } catch {}
    }
    return out;
  },

  /** Replace each tool-call block in `text` with a short status line. */
  rewriteWithStatuses(text, outcomes) {
    if (!text || !outcomes?.length) return text;
    let i = 0;
    return text.replace(RX, () => {
      const o = outcomes[i++];
      if (!o) return '';
      const name = o.call?.name || '?';
      if (o.result?.ok) return `\n> ✓ \`${name}\` — done\n`;
      return `\n> ✗ \`${name}\` — ${o.result?.error || 'failed'}\n`;
    });
  },

  /** Build a 'tool' role message that feeds the outcomes back to the model. */
  buildResultMessage(outcomes) {
    const summary = outcomes.map((o) => {
      const safe = JSON.stringify(o.result, null, 0);
      return `${o.call?.name || '?'} → ${safe.length > 1500 ? safe.slice(0, 1500) + '…' : safe}`;
    }).join('\n');
    return {
      role: 'system',
      content: `TOOL_RESULTS:\n${summary}\n\nUse these real results to answer. If the result clearly needs one more lookup/action, emit the next tool call. Otherwise give the user a concise final answer.`,
    };
  },
};
