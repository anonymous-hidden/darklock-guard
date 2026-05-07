import React, { useMemo, useState, useCallback } from 'react';
import clsx from 'clsx';
import WidgetCard from '@components/widget-studio/WidgetCard.jsx';
import { useWidgetBuilder } from '@hooks/useWidgetBuilder.js';
import { useAppStore } from '@store/appStore.js';
import { useWidgetStore } from '@store/widgetStore.js';

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'name',   label: 'Name' },
];

export default function WidgetGallery() {
  const { widgets, launchWidget, previewWidget, deleteWidget } = useWidgetBuilder();
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const [confirmId, setConfirmId] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = widgets.slice();
    if (q) {
      list = list.filter((w) =>
        (w.name || '').toLowerCase().includes(q) ||
        (w.description || '').toLowerCase().includes(q) ||
        (w.tags || []).some((t) => String(t).toLowerCase().includes(q))
      );
    }
    if (sort === 'newest') list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (sort === 'oldest') list.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    if (sort === 'name')   list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return list;
  }, [widgets, query, sort]);

  const handleDelete = useCallback(async (w) => {
    if (confirmId !== w.id) {
      setConfirmId(w.id);
      setTimeout(() => setConfirmId((cur) => cur === w.id ? null : cur), 3500);
      return;
    }
    await deleteWidget(w.id);
    setConfirmId(null);
  }, [confirmId, deleteWidget]);

  const handlePreview = useCallback(async (w) => {
    await previewWidget(w);
    setActiveTab('widget-studio');
  }, [previewWidget, setActiveTab]);

  return (
    <section className="nova-card p-4 flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base text-nova-text">My Widgets</h3>
          <p className="text-xs text-nova-muted">{widgets.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or tag…"
            className="nova-input text-xs w-56 py-1"
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="nova-input text-xs w-auto py-1">
            {SORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      </header>

      {widgets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-nova-border p-8 text-center text-nova-muted">
          <div className="font-display text-base text-nova-text mb-1">No widgets yet</div>
          <div className="text-sm">Ask Nova to build your first widget — try "build a calculator" in the chat.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-nova-border p-6 text-center text-nova-muted text-sm">
          No widgets match "{query}".
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((w) => (
            <WidgetCard
              key={w.id}
              widget={w}
              onLaunch={launchWidget}
              onPreview={handlePreview}
              onDelete={(x) => handleDelete(x)}
              className={clsx(confirmId === w.id && 'ring-1 ring-nova-err/60')}
            />
          ))}
        </div>
      )}
      {confirmId && (
        <div className="text-[11px] text-nova-warn font-mono">
          Click Delete again to confirm removing the highlighted widget.
        </div>
      )}
    </section>
  );
}
