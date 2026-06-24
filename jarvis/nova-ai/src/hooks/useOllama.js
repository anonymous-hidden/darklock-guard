/**
 * useOllama — binds the provider-aware AI client to the AI + App stores.
 *
 * Exposes:
 *   - ready, modelHealth, models
 *   - send(content, { extraSystem })
 *   - abort()
 *   - setModel(name)
 */
import { useCallback, useEffect, useRef } from 'react';
import { aiClient, AUTO_MODEL, parseModelRef, pickBestAiModel } from '@core/ai/AIClient.js';
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
      try {
        const list = await aiClient.listModels();
        if (cancelled) return;
        appStore.setModels(list);

        const selectedRef = appStore.selectedModel === AUTO_MODEL
          ? pickBestAiModel(list)
          : appStore.selectedModel;
        const selected = parseModelRef(selectedRef || '');
        const h = await aiClient.health(selected.provider);
        if (!cancelled) appStore.setOllamaHealth(h);
      } catch (err) {
        if (!cancelled) appStore.setStatusMessage(`Model list failed: ${err.message}`);
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
    aiStore.setStreaming(true);
    aiStore.logInfo('chat', agentic
      ? `↻ agentic re-invoke (tool results)`
      : `→ user: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);

    const ac = new AbortController();
    aiStore.setAbortController(ac);

    const messages = aiStore.conversation.buildPayload({ extraSystem: opts.extraSystem || '' });
    const model = opts.model || appStore.selectedModel;
    const resolvedModel = model === AUTO_MODEL
      ? pickBestAiModel(appStore.models)
      : model;
    const modelProvider = parseModelRef(resolvedModel).provider;
    const assistantMsg = aiStore.pushAssistantStreaming('');

    try {
      const result = await aiClient.chat({
        provider: modelProvider,
        model: resolvedModel,
        messages,
        temperature: opts.temperature ?? (agentic ? 0.25 : 0.45),
        topP: opts.topP ?? 0.9,
        numCtx: opts.numCtx ?? 6144,
        numPredict: opts.numPredict ?? (agentic ? 650 : 900),
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
          aiStore.logInfo('ai', `done: provider=${modelProvider} model=${resolvedModel} eval=${meta?.eval_count || meta?.usage?.total_tokens || 0}`);
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
      aiStore.logError('ai', String(err?.message || err));
      return { ok: false, error: String(err?.message || err), aborted };
    } finally {
      aiStore.setStreaming(false);
      aiStore.setAbortController(null);
    }
  }, [aiStore, appStore]);

  const abort = useCallback(() => aiStore.abort(), [aiStore]);

  const setModel = useCallback(async (name) => {
    if (!name) return;
    appStore.setSelectedModel(name);
    const effective = name === AUTO_MODEL
      ? pickBestAiModel(appStore.models)
      : name;
    const provider = parseModelRef(effective).provider;
    const h = await aiClient.health(provider);
    appStore.setOllamaHealth(h);
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
