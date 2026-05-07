import React, { useState, useCallback } from 'react';
import clsx from 'clsx';
import BuildProcess from './BuildProcess.jsx';
import WidgetPreview from './WidgetPreview.jsx';
import { useWidgetBuilder } from '@hooks/useWidgetBuilder.js';
import { useWidgetStore } from '@store/widgetStore.js';
import LoadingStream from '@components/shared/LoadingStream.jsx';

export default function WidgetStudio() {
  const [prompt, setPrompt] = useState('');
  const { state, buildWidget, retryBuild, cancelBuild } = useWidgetBuilder();
  const resetBuild = useWidgetStore((s) => s.resetBuild);

  const onSubmit = useCallback(async (e) => {
    e?.preventDefault?.();
    const v = prompt.trim();
    if (!v || state.isBuilding) return;
    await buildWidget(v);
  }, [prompt, state.isBuilding, buildWidget]);

  const popout = useCallback(async () => {
    if (!state.previewHtml || !state.extractedMeta) return;
    const meta = state.extractedMeta;
    await window.nova?.widgets?.popout?.({
      id: 'preview_' + Date.now().toString(36),
      name: meta.name,
      html: state.previewHtml,
      width: meta.width,
      height: meta.height,
    });
  }, [state.previewHtml, state.extractedMeta]);

  return (
    <div className="flex h-full">
      {/* LEFT — pipeline + prompt */}
      <aside className="w-[420px] border-r border-nova-border bg-nova-panel flex flex-col">
        <header className="px-4 py-3 border-b border-nova-border">
          <h2 className="font-display text-base text-nova-text">Widget Studio</h2>
          <p className="text-xs text-nova-muted mt-0.5">Describe a widget. Nova plans, writes, validates, and saves it.</p>
        </header>

        <form onSubmit={onSubmit} className="p-3 flex flex-col gap-2 border-b border-nova-border">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. Build a pomodoro timer with start/pause/reset buttons and a circular progress ring."
            className="nova-input resize-none font-sans"
            disabled={state.isBuilding}
          />
          <div className="flex gap-2">
            <button type="submit" className="nova-btn-primary flex-1" disabled={state.isBuilding || !prompt.trim()}>
              {state.isBuilding ? <LoadingStream label="Building" /> : 'Build widget'}
            </button>
            {state.isBuilding && (
              <button type="button" onClick={cancelBuild} className="nova-btn-danger">Cancel</button>
            )}
            {!state.isBuilding && state.error && (
              <button type="button" onClick={retryBuild} className="nova-btn">Retry</button>
            )}
            {!state.isBuilding && state.extractedCode && (
              <button type="button" onClick={resetBuild} className="nova-btn">Clear</button>
            )}
          </div>
        </form>

        <div className="p-3 overflow-auto flex-1">
          <BuildProcess />
        </div>
      </aside>

      {/* RIGHT — preview + meta */}
      <main className="flex-1 flex flex-col">
        <header className="px-4 py-3 border-b border-nova-border bg-nova-panel flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm text-nova-text">
              {state.extractedMeta?.name || 'Preview'}
            </h3>
            {state.extractedMeta?.description && (
              <p className="text-[11.5px] text-nova-muted mt-0.5">{state.extractedMeta.description}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={popout} disabled={!state.previewHtml} className="nova-btn">Pop Out</button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          <WidgetPreview
            html={state.previewHtml}
            height={state.extractedMeta?.height || 380}
          />
          {state.extractedMeta?.tags?.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {state.extractedMeta.tags.map((t) => (
                <span key={t} className="px-2 py-0.5 rounded-full text-[11px] bg-nova-panel border border-nova-border text-nova-muted">
                  {t}
                </span>
              ))}
            </div>
          )}
          {state.extractedCode && (
            <details className="nova-card p-3">
              <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-nova-muted hover:text-nova-text">Component source</summary>
              <pre className="mt-2 text-[12px] leading-relaxed whitespace-pre-wrap font-mono max-h-[480px] overflow-auto">{state.extractedCode}</pre>
            </details>
          )}
        </div>
      </main>
    </div>
  );
}
