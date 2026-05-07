import React from 'react';
import clsx from 'clsx';
import { BUILD_STAGES, useWidgetStore } from '@store/widgetStore.js';

const STAGE_LABELS = {
  analyze:  'Nova is analyzing your request',
  plan:     'Planning component structure',
  write:    'Writing component code',
  parse:    'Parsing and validating output',
  preview:  'Rendering preview',
  save:     'Saving widget',
};

function Spinner() {
  return (
    <span className="inline-block w-3 h-3 border-2 border-nova-accent/30 border-t-nova-accent rounded-full animate-spin" />
  );
}
function Check() {
  return <span className="inline-block w-3 h-3 text-nova-ok">✓</span>;
}
function Cross() {
  return <span className="inline-block w-3 h-3 text-nova-err">✗</span>;
}
function Dot() {
  return <span className="inline-block w-3 h-3 rounded-full border border-nova-border" />;
}

function fmtMs(ms) {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function BuildProcess() {
  const build = useWidgetStore((s) => s.build);

  return (
    <section className="nova-card p-3 flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <h3 className="font-display text-xs uppercase tracking-wider text-nova-accent">Build Pipeline</h3>
        {build.isBuilding && <span className="text-[11px] text-nova-muted font-mono">running…</span>}
      </header>

      <ol className="space-y-1.5 text-sm">
        {BUILD_STAGES.map((id, i) => {
          const status = build.stageStatus[id] || 'pending';
          const dur = build.stageDurations[id];
          return (
            <li key={id} className="flex items-center gap-3">
              <span className="w-5 text-center">
                {status === 'active' && <Spinner />}
                {status === 'done'   && <Check />}
                {status === 'error'  && <Cross />}
                {status === 'pending' && <Dot />}
              </span>
              <span className={clsx(
                'flex-1',
                status === 'pending' && 'text-nova-muted',
                status === 'active'  && 'text-nova-text',
                status === 'done'    && 'text-nova-text/80',
                status === 'error'   && 'text-nova-err',
              )}>
                <span className="text-nova-muted/70 font-mono mr-2">[{i + 1}]</span>
                {STAGE_LABELS[id]}
              </span>
              {dur != null && <span className="text-[11px] text-nova-muted font-mono">{fmtMs(dur)}</span>}
            </li>
          );
        })}
      </ol>

      {build.error && (
        <div className="mt-2 text-xs text-nova-err border border-nova-err/40 rounded p-2 bg-nova-err/10">
          Error: {build.error}
        </div>
      )}

      {build.thinking && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-nova-muted hover:text-nova-text">Thinking</summary>
          <pre className="mt-2 text-[11.5px] leading-relaxed whitespace-pre-wrap bg-nova-bg border border-nova-border rounded p-2 max-h-48 overflow-auto">{build.thinking}</pre>
        </details>
      )}

      {build.streamedText && (
        <details className="mt-1" open>
          <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-nova-muted hover:text-nova-text">Live stream</summary>
          <pre className="mt-2 text-[11px] leading-relaxed whitespace-pre-wrap bg-nova-bg border border-nova-border rounded p-2 max-h-64 overflow-auto font-mono">{build.streamedText.slice(-4000)}</pre>
        </details>
      )}
    </section>
  );
}
