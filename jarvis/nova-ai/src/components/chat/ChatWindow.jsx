import React, { useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble.jsx';
import StreamingMessage from './StreamingMessage.jsx';
import ChatInput from './ChatInput.jsx';
import { useOllama } from '@hooks/useOllama.js';
import { PromptEngine } from '@core/ai/PromptEngine.js';
import { ToolEngine } from '@core/ai/ToolEngine.js';
import { useAiStore } from '@store/aiStore.js';
import { useWidgetBuilder } from '@hooks/useWidgetBuilder.js';
import { useAppStore } from '@store/appStore.js';

const MAX_TOOL_HOPS = 3;

export default function ChatWindow() {
  const { messages, streaming, send, abort, ready, health, models, selectedModel, setModel } = useOllama();
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const reset = useAiStore((s) => s.reset);
  const { detectIntent, buildWidget } = useWidgetBuilder();
  const endRef = useRef(null);
  const [toolDescription, setToolDescription] = useState('');

  // Load available tools once and inject into the chat system prompt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.nova?.tools?.list?.();
        if (cancelled) return;
        if (r?.description) {
          setToolDescription(r.description);
          useAiStore.getState().setSystemPrompt(PromptEngine.forTab('chat', { toolDescription: r.description }));
          return;
        }
      } catch {}
      if (!cancelled) useAiStore.getState().setSystemPrompt(PromptEngine.forTab('chat'));
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * Execute the agentic tool loop after the model produces a reply.
   * If the reply contains <<<TOOL_CALL>>> blocks, run them, surface
   * statuses inline, push a system message with results, and re-invoke
   * the model up to MAX_TOOL_HOPS hops.
   */
  const runToolLoop = async (initialText, initialMsgId) => {
    let text = initialText;
    let msgId = initialMsgId;
    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      const calls = ToolEngine.parse(text);
      if (!calls.length) return;
      const outcomes = await ToolEngine.runAll(text, {
        onBefore: (c) => useAiStore.getState().logInfo('tools', `→ ${c.name}`),
        onAfter:  (c, r) => useAiStore.getState().logInfo('tools', `← ${c.name} ${r?.ok ? 'ok' : 'err'}`),
      });
      // Replace the current assistant message text with statuses inline
      const rewritten = ToolEngine.rewriteWithStatuses(text, outcomes);
      useAiStore.getState().updateAssistantById?.(msgId, rewritten) ||
        useAiStore.getState().updateLastAssistant(rewritten);
      // Feed results back into the conversation
      const resultMsg = ToolEngine.buildResultMessage(outcomes);
      const r = await send('', { extraSystem: resultMsg.content, _agentic: true });
      if (!r?.ok) return;
      text  = r.text;
      msgId = r.msgId;
    }
  };

  const handleSend = async (text) => {
    if (detectIntent(text)) {
      setActiveTab('widget-studio');
      buildWidget(text);
      return;
    }
    const result = await send(text);
    if (result?.ok && toolDescription && /<<<TOOL_CALL>>>/.test(result.text || '')) {
      await runToolLoop(result.text, result.msgId);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between border-b border-nova-border bg-nova-panel px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-base text-nova-text">Chat</h2>
          {!ready && <span className="text-[11px] text-nova-warn font-mono">Ollama not reachable: {health.error || 'starting…'}</span>}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedModel}
            onChange={(e) => setModel(e.target.value)}
            className="nova-input py-1 text-xs w-auto"
          >
            <option value={selectedModel}>{selectedModel}</option>
            {models.filter((m) => m.name !== selectedModel).map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
          <button onClick={reset} className="nova-btn text-xs">New chat</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-nova-muted py-16">
            <div className="font-display text-2xl text-nova-text mb-1">Nova</div>
            <div className="text-sm">Ask me anything. Say "build a …" to start a widget.</div>
          </div>
        )}
        {messages.map((m) => (
          m._streaming
            ? <StreamingMessage key={m.id} message={m} />
            : <MessageBubble    key={m.id} message={m} />
        ))}
        <div ref={endRef} />
      </div>

      <ChatInput
        disabled={!ready}
        streaming={streaming}
        onSend={handleSend}
        onAbort={abort}
        placeholder={ready ? 'Message Nova…' : 'Waiting for Ollama…'}
      />
    </div>
  );
}
