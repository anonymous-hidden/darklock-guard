import React from 'react';
import clsx from 'clsx';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * WidgetCard — a tile in the Command Center / Widget Studio gallery.
 */
export default function WidgetCard({ widget, onLaunch, onPreview, onDelete, className }) {
  return (
    <article className={clsx('nova-card p-3 flex flex-col gap-2 group hover:border-nova-accent/40 transition-colors', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-display text-sm text-nova-text truncate">{widget.name || 'Untitled'}</h4>
          {widget.description && (
            <p className="text-[12px] text-nova-muted line-clamp-2 mt-0.5">{widget.description}</p>
          )}
        </div>
        <span className="text-[10.5px] font-mono text-nova-muted shrink-0">{fmtDate(widget.createdAt)}</span>
      </div>

      <div className="h-24 rounded-md bg-gradient-to-br from-nova-accent/10 via-nova-panel2 to-nova-accent2/10 border border-nova-border flex items-center justify-center text-nova-muted text-[11px] font-mono">
        {widget.thumbnail
          ? <img src={widget.thumbnail} alt="" className="w-full h-full object-cover rounded-md" />
          : <span>{(widget.name || '?').slice(0, 18)}</span>}
      </div>

      {widget.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {widget.tags.slice(0, 4).map((t) => (
            <span key={t} className="px-1.5 py-0.5 rounded text-[10.5px] bg-nova-panel2 border border-nova-border text-nova-muted">{t}</span>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 mt-1">
        <button onClick={() => onLaunch?.(widget)}  className="nova-btn-primary flex-1 py-1 text-xs">Launch</button>
        <button onClick={() => onPreview?.(widget)} className="nova-btn flex-1 py-1 text-xs">Preview</button>
        <button onClick={() => onDelete?.(widget)}  className="nova-btn-danger py-1 text-xs">Delete</button>
      </div>
    </article>
  );
}
