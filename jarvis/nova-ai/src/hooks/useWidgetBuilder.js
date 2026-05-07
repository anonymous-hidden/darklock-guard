/**
 * useWidgetBuilder — drives the WidgetBuilder pipeline against the widgetStore.
 */
import { useCallback, useMemo, useRef, useEffect } from 'react';
import { WidgetBuilder, detectWidgetIntent } from '@core/ai/WidgetBuilder.js';
import { ollama } from '@core/ai/OllamaClient.js';
import { useWidgetStore } from '@store/widgetStore.js';
import { useAppStore } from '@store/appStore.js';
import { useAiStore } from '@store/aiStore.js';

export function useWidgetBuilder() {
  const wstore = useWidgetStore();
  const astore = useAppStore();
  const aiStore = useAiStore();
  const acRef = useRef(null);

  // Initial widgets list from disk via IPC
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (wstore.loaded) return;
      try {
        const res = await window.nova?.widgets?.list?.();
        if (!cancelled && res?.ok) wstore.setWidgets(res.widgets || []);
      } catch (err) {
        aiStore.logError('widgets', String(err?.message || err));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const builder = useMemo(() => new WidgetBuilder({
    ollama,
    model: astore.selectedModel,
    ipcSave: async (widget) => {
      const res = await window.nova?.widgets?.save?.(widget);
      if (res?.ok && res.widget) wstore.upsertWidget(res.widget);
      return res;
    },
  }), [astore.selectedModel, wstore]);

  const buildWidget = useCallback(async (userPrompt) => {
    if (!userPrompt || !userPrompt.trim()) return { ok: false, error: 'Empty prompt' };
    if (wstore.build.isBuilding) return { ok: false, error: 'Build already in progress' };

    wstore.beginBuild(userPrompt);
    aiStore.logInfo('widget', `build start: ${userPrompt.slice(0, 80)}`);

    const ac = new AbortController();
    acRef.current = ac;

    try {
      const result = await builder.run(userPrompt, {
        signal: ac.signal,
        model: astore.selectedModel,
        onStage: ({ stage, status, durationMs, error }) => {
          if (status === 'start')      wstore.setStage(stage, 'active');
          else if (status === 'done')  wstore.setStage(stage, 'done', durationMs);
          else if (status === 'error') wstore.setStage(stage, 'error', durationMs);
          if (error) aiStore.logError('widget', `${stage}: ${error}`);
        },
        onStream: (full) => wstore.appendStream(full),
        onLog:    (line) => aiStore.logInfo('widget', line),
      });

      if (result?.ok) {
        wstore.setBuildResult({
          code: result.code,
          meta: result.meta,
          thinking: result.thinking,
          html: result.html,
        });
        aiStore.logInfo('widget', `build complete: ${result.meta?.name || 'widget'} (${result.durationMs}ms)`);
      }
      wstore.finishBuild();
      return result;
    } catch (err) {
      wstore.setBuildError(err);
      aiStore.logError('widget', String(err?.message || err));
      return { ok: false, error: String(err?.message || err) };
    } finally {
      acRef.current = null;
    }
  }, [builder, wstore, aiStore, astore.selectedModel]);

  const cancelBuild = useCallback(() => {
    if (acRef.current) { try { acRef.current.abort(); } catch {} }
    acRef.current = null;
    wstore.setBuildError(new Error('Cancelled by user'));
  }, [wstore]);

  const retryBuild = useCallback(() => {
    const p = wstore.build.prompt;
    if (!p) return;
    wstore.resetBuild();
    return buildWidget(p);
  }, [wstore, buildWidget]);

  const deleteWidget = useCallback(async (id) => {
    const res = await window.nova?.widgets?.delete?.(id);
    if (res?.ok) wstore.removeWidget(id);
    return res;
  }, [wstore]);

  const launchWidget = useCallback(async (widget) => {
    const codeRes = await window.nova?.widgets?.read?.(widget.id);
    if (!codeRes?.ok) return { ok: false, error: codeRes?.error || 'read failed' };
    const { buildWidgetIframeHtml } = await import('@core/ai/CodeExtractor.js');
    const html = buildWidgetIframeHtml({ code: codeRes.code, meta: widget });
    const res = await window.nova?.widgets?.popout?.({
      id: widget.id, name: widget.name, html, width: widget.width, height: widget.height,
    });
    return { ok: !!res };
  }, []);

  const previewWidget = useCallback(async (widget) => {
    const codeRes = await window.nova?.widgets?.read?.(widget.id);
    if (!codeRes?.ok) return { ok: false, error: codeRes?.error || 'read failed' };
    const { buildWidgetIframeHtml } = await import('@core/ai/CodeExtractor.js');
    const html = buildWidgetIframeHtml({ code: codeRes.code, meta: widget });
    wstore.setBuildResult({ code: codeRes.code, meta: widget, thinking: '', html });
    return { ok: true };
  }, [wstore]);

  return {
    state: wstore.build,
    widgets: wstore.widgets,
    detectIntent: detectWidgetIntent,
    buildWidget,
    retryBuild,
    cancelBuild,
    deleteWidget,
    launchWidget,
    previewWidget,
    selectWidget: wstore.selectWidget,
    selectedId: wstore.selectedId,
  };
}
