import React, { useEffect, useState, useCallback, useRef } from 'react';
import clsx from 'clsx';
import { ollama } from '@core/ai/OllamaClient.js';
import { CODING_MODE, PromptEngine, CODING_ACTIONS } from '@core/ai/PromptEngine.js';
import { useAppStore } from '@store/appStore.js';
import { useAiStore } from '@store/aiStore.js';
import LoadingStream from '@components/shared/LoadingStream.jsx';

const QUICK_ACTIONS = [
  { id: 'explain',  label: 'Explain this file' },
  { id: 'findBugs', label: 'Find bugs' },
  { id: 'refactor', label: 'Refactor' },
  { id: 'comments', label: 'Add comments' },
  { id: 'tests',    label: 'Write tests' },
];

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/**
 * Parse fenced code blocks from a markdown response. Returns the array of
 * { language, code, replaceFile, insertAtCursor } detected. We respect the
 * REPLACE_FILE: / INSERT_AT_CURSOR: hints emitted in CODING_MODE.
 */
function parseCodeBlocks(text) {
  const blocks = [];
  const rx = /(?:^(REPLACE_FILE|INSERT_AT_CURSOR):\s*\n)?```(\w+)?\n([\s\S]*?)```/gm;
  let m;
  while ((m = rx.exec(text)) !== null) {
    blocks.push({
      hint: m[1] || null,
      language: m[2] || 'plaintext',
      code: m[3],
    });
  }
  return blocks;
}

function renderInline(text) {
  const blocks = parseCodeBlocks(text);
  let cursor = 0;
  const out = [];
  const rx = /(?:^(?:REPLACE_FILE|INSERT_AT_CURSOR):\s*\n)?```(\w+)?\n([\s\S]*?)```/gm;
  let m;
  let i = 0;
  while ((m = rx.exec(text)) !== null) {
    if (m.index > cursor) out.push({ kind: 'text', value: text.slice(cursor, m.index) });
    out.push({ kind: 'code', block: blocks[i++] });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) out.push({ kind: 'text', value: text.slice(cursor) });
  return out;
}

export default function AICodeAssistant({ filePath, fileContent }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const acRef = useRef(null);
  const endRef = useRef(null);
  const model = useAppStore((s) => s.selectedModel);
  const aiStore = useAiStore();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async (userText) => {
    const t = String(userText || '').trim();
    if (!t || streaming) return;
    const fileCtx = PromptEngine.codingFileContext({ relPath: filePath, content: fileContent || '' });
    const sys = [CODING_MODE, fileCtx].filter(Boolean).join('\n\n');
    const next = [
      { role: 'system', content: sys },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: t },
    ];
    setMessages((p) => [...p, { role: 'user', content: t }, { role: 'assistant', content: '', streaming: true }]);
    setStreaming(true);
    aiStore.logInfo('coding', `→ ${t.slice(0, 80)}`);

    const ac = new AbortController();
    acRef.current = ac;
    try {
      let acc = '';
      const result = await ollama.chat({
        model, messages: next, temperature: 0.3, signal: ac.signal,
        onToken: (tok) => {
          acc += tok;
          setMessages((p) => {
            const copy = p.slice();
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === 'assistant' && copy[i].streaming) {
                copy[i] = { ...copy[i], content: acc };
                break;
              }
            }
            return copy;
          });
        },
      });
      setMessages((p) => p.map((m) => m.streaming ? { ...m, streaming: false, content: result.text || acc, model: result.model } : m));
      aiStore.logInfo('coding', `done: ${result.evalCount || 0} tok`);
    } catch (err) {
      const aborted = err?.name === 'AbortError';
      setMessages((p) => p.map((m) => m.streaming ? { ...m, streaming: false, error: aborted ? null : String(err?.message || err) } : m));
      aiStore.logError('coding', String(err?.message || err));
    } finally {
      setStreaming(false);
      acRef.current = null;
    }
  }, [streaming, filePath, fileContent, messages, model, aiStore]);

  const abort = useCallback(() => {
    if (acRef.current) { try { acRef.current.abort(); } catch {} }
    acRef.current = null;
    setStreaming(false);
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
    const v = input.trim();
    if (!v) return;
    setInput('');
    send(v);
  };

  const runAction = (id) => {
    if (!filePath) {
      send(`(no file is open) — ${CODING_ACTIONS[id]}`);
      return;
    }
    send(CODING_ACTIONS[id]);
  };

  const insertAtCursor = (code) => window.__novaCodeEditor?.insertAtCursor?.(code);
  const replaceFile    = (code) => window.__novaCodeEditor?.replaceAll?.(code);

  return (
    <div className="flex flex-col h-full bg-nova-panel border-l border-nova-border">
      <header className="px-3 py-2 border-b border-nova-border flex items-center justify-between">
        <span className="font-display text-xs uppercase tracking-wider text-nova-accent">AI Assistant</span>
        <span className="text-[10.5px] font-mono text-nova-muted">{filePath ? filePath : 'no file'}</span>
      </header>

      <div className="px-3 py-2 border-b border-nova-border flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map((a) => (
          <button key={a.id} onClick={() => runAction(a.id)} disabled={streaming} className="nova-btn text-[11px] py-1">
            {a.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-nova-muted text-sm">Ask about the open file or pick a quick action above.</div>
        )}
        {messages.map((m, idx) => (
          <div key={idx} className={clsx('rounded-md p-2.5 text-[13px] leading-relaxed',
            m.role === 'user'
              ? 'bg-nova-accent/10 border border-nova-accent/30'
              : 'bg-nova-bg border border-nova-border')}>
            {m.role === 'assistant' ? (
              <AssistantBody text={m.content + (m.streaming ? '▍' : '')} onInsert={insertAtCursor} onReplace={replaceFile} />
            ) : (
              <div className="whitespace-pre-wrap">{m.content}</div>
            )}
            {m.error && <div className="mt-1 text-[11px] text-nova-err">error: {m.error}</div>}
          </div>
        ))}
        {streaming && <LoadingStream label="Nova is thinking" />}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="p-2 border-t border-nova-border flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the open file…"
          className="nova-input text-sm flex-1"
          disabled={streaming}
        />
        {streaming ? (
          <button type="button" onClick={abort} className="nova-btn-danger text-xs">Stop</button>
        ) : (
          <button type="submit" disabled={!input.trim()} className="nova-btn-primary text-xs">Send</button>
        )}
      </form>
    </div>
  );
}

function AssistantBody({ text, onInsert, onReplace }) {
  const parts = renderInline(text || '');
  return (
    <div className="space-y-2">
      {parts.map((p, i) => p.kind === 'text' ? (
        <div key={i} className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: esc(p.value).replace(/`([^`]+)`/g, '<code class="bg-nova-panel2 px-1 py-0.5 rounded text-nova-accent">$1</code>') }} />
      ) : (
        <div key={i} className="rounded border border-nova-border bg-nova-panel2">
          <div className="flex items-center justify-between px-2 py-1 border-b border-nova-border text-[10.5px] text-nova-muted font-mono">
            <span>{p.block.language}{p.block.hint ? ` · ${p.block.hint}` : ''}</span>
            <span className="flex gap-1">
              <button onClick={() => onInsert?.(p.block.code)} className="nova-btn py-0.5 text-[10.5px]">Insert at cursor</button>
              {p.block.hint === 'REPLACE_FILE' && (
                <button onClick={() => onReplace?.(p.block.code)} className="nova-btn-primary py-0.5 text-[10.5px]">Replace file</button>
              )}
            </span>
          </div>
          <pre className="p-2 overflow-auto text-[12px] leading-relaxed font-mono max-h-72">{p.block.code}</pre>
        </div>
      ))}
    </div>
  );
}
