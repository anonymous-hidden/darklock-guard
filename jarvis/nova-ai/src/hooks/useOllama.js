/**
 * useOllama — binds the OllamaClient to the AI + App stores.
 *
 * Exposes:
 *   - ready, modelHealth, models
 *   - send(content, { extraSystem })
 *   - abort()
 *   - setModel(name)
 */
import { useCallback, useEffect, useRef } from 'react';
import { ollama } from '@core/ai/OllamaClient.js';
import { useAiStore } from '@store/aiStore.js';
import { useAppStore } from '@store/appStore.js';

export function useOllama() {
  const aiStore = useAiStore();
  const appStore = useAppStore();
  const tickRef = useRef(0);

  // Health probe + model list on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await ollama.health();
      if (cancelled) return;
      appStore.setOllamaHealth(h);
      if (h.ok) {
        try {
          const list = await ollama.listModels();
          if (!cancelled) appStore.setModels(list);
        } catch (err) {
          if (!cancelled) appStore.setStatusMessage(`Model list failed: ${err.message}`);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(async (content, opts = {}) => {
    const text = String(content || '').trim();
    const agentic = !!opts._agentic;
    if (!text && !agentic) return;
    if (aiStore.streaming) return;

    if (!agentic) aiStore.pushUser(text);
    const assistantMsg = aiStore.pushAssistantStreaming('');
    aiStore.setStreaming(true);
    aiStore.logInfo('chat', agentic
      ? `↻ agentic re-invoke (tool results)`
      : `→ user: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);

    const ac = new AbortController();
    aiStore.setAbortController(ac);

    const messages = aiStore.conversation.buildPayload({ extraSystem: opts.extraSystem || '' });
    const model = opts.model || appStore.selectedModel;

    try {
      const result = await ollama.chat({
        model,
        messages,
        temperature: opts.temperature ?? 0.7,
        signal: ac.signal,
        onToken: (_tok) => {
          tickRef.current += 1;
          // updateLastAssistant uses the conversation's latest content,
          // which we update incrementally:
          const cur = aiStore.conversation.messages[aiStore.conversation.messages.length - 1];
          if (cur && cur.role === 'assistant') {
            aiStore.updateLastAssistant((cur.content || '') + _tok);
          }
        },
        onMeta: (meta) => {
          aiStore.logInfo('ollama', `done: model=${model} eval=${meta?.eval_count || 0}`);
        },
      });

      aiStore.finishLastAssistant({
        model: result.model,
        durationMs: result.durationMs,
        evalCount: result.evalCount,
      });
      aiStore.logInfo('chat', `← assistant: ${(result.text || '').slice(0, 80)}…`);
      return { ok: true, text: result.text, msgId: assistantMsg.id, model: result.model };
    } catch (err) {
      const aborted = err?.name === 'AbortError' || /aborted/i.test(String(err?.message));
      aiStore.finishLastAssistant({ aborted, error: aborted ? null : String(err?.message || err) });
      aiStore.logError('ollama', String(err?.message || err));
      return { ok: false, error: String(err?.message || err), aborted };
    } finally {
      aiStore.setStreaming(false);
      aiStore.setAbortController(null);
    }
  }, [aiStore, appStore]);

  const abort = useCallback(() => aiStore.abort(), [aiStore]);

  const setModel = useCallback((name) => {
    if (!name) return;
    appStore.setSelectedModel(name);
  }, [appStore]);

  return {
    ready: appStore.ollamaHealth.ok === true,
    health: appStore.ollamaHealth,
    models: appStore.models,
    selectedModel: appStore.selectedModel,
    streaming: aiStore.streaming,
    messages: aiStore.messages,
    send,
    abort,
    setModel,
    reset: aiStore.reset,
  };
}
