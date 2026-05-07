import React, { useEffect, useState, useCallback, useRef } from 'react';

/**
 * NotesWidget — file-backed markdown notes the AI can read/write/edit
 * via the `notes.*` IPC bridge (window.nova.notes.*).
 */
export default function NotesWidget() {
  const publish = (action, summary) => {
    try { window.nova?.bus?.publish?.('widget:event', { widget: 'notes', action, summary }); } catch {}
  };

  const [notes, setNotes]       = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [title, setTitle]       = useState('');
  const [content, setContent]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [savedAt, setSavedAt]   = useState(null);
  const [filter, setFilter]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [errMsg, setErrMsg]     = useState('');
  const dirtyRef  = useRef(false);
  const saveTimer = useRef(null);

  /* Check if window.nova IPC bridge is actually available */
  const hasIpc = typeof window !== 'undefined' && !!window.nova?.isElectron;

  /* ── List ─────────────────────────────────────────────── */
  const refresh = useCallback(async () => {
    if (!hasIpc) { setLoading(false); return; }
    try {
      const list = await window.nova.notes.list();
      if (Array.isArray(list)) setNotes(list);
    } catch (e) {
      console.error('[notes] list failed:', e);
    } finally {
      setLoading(false);
    }
  }, [hasIpc]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!hasIpc) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh, hasIpc]);

  /* ── Load active note ────────────────────────────────── */
  useEffect(() => {
    if (!activeId) { setTitle(''); setContent(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const n = await window.nova.notes.get(activeId);
        if (!cancelled && n) {
          setTitle(n.title || '');
          setContent(n.content || '');
          dirtyRef.current = false;
        }
      } catch (e) {
        console.error('[notes] get failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  /* ── Auto-save ───────────────────────────────────────── */
  useEffect(() => {
    if (!activeId || !dirtyRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await window.nova.notes.update({ id: activeId, title, content });
        setSavedAt(new Date());
        dirtyRef.current = false;
        publish('saved', `Saved note: ${title || 'Untitled'}`);
        refresh();
      } catch (e) {
        console.error('[notes] update failed:', e);
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => clearTimeout(saveTimer.current);
  }, [title, content, activeId, refresh]);

  /* ── Actions ─────────────────────────────────────────── */
  const newNote = async () => {
    setErrMsg('');
    if (!hasIpc) { setErrMsg('IPC bridge unavailable — is Electron running?'); return; }
    try {
      const n = await window.nova.notes.create({ title: 'Untitled', content: '' });
      if (n?.id) {
        await refresh();
        setActiveId(n.id);
        publish('created', 'Created a new note');
      } else {
        setErrMsg('Create returned no id — check Electron console');
      }
    } catch (e) {
      setErrMsg(String(e?.message || e));
      console.error('[notes] create failed:', e);
    }
  };

  const deleteNote = async (id) => {
    if (!confirm('Delete this note?')) return;
    try {
      await window.nova.notes.delete(id);
      publish('deleted', 'Deleted a note');
    } catch {}
    if (activeId === id) setActiveId(null);
    refresh();
  };

  const filtered = notes.filter((n) =>
    !filter.trim() || (n.title || '').toLowerCase().includes(filter.toLowerCase())
  );

  const fmtDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  /* ── No IPC ────────────────────────────────────────────── */
  if (!hasIpc) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6 bg-nova-bg text-nova-text">
        <div className="w-14 h-14 rounded-full bg-nova-panel border border-nova-border flex items-center justify-center text-2xl text-nova-err">!</div>
        <div>
          <div className="font-display text-sm text-nova-err">IPC bridge unavailable</div>
          <div className="text-[11px] text-nova-muted mt-1">
            window.nova is not set — the Electron preload didn't run.<br />
            Re-launch with <code className="bg-nova-panel px-1 rounded">nova-widget notes</code>.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-nova-bg text-nova-text">
      {/* ── Sidebar ───────────────────────────────── */}
      <aside className="w-52 shrink-0 border-r border-nova-border flex flex-col bg-nova-panel">
        <div className="p-2 border-b border-nova-border">
          <button onClick={newNote} className="nova-btn-primary text-[12px] w-full">+ New note</button>
        </div>

        {errMsg && (
          <div className="mx-2 mt-2 p-1.5 bg-nova-err/10 border border-nova-err/30 rounded text-[10.5px] text-nova-err font-mono leading-snug">
            {errMsg}
          </div>
        )}

        <div className="px-2 pt-2 pb-1">
          <input
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="nova-input text-[11.5px] py-1.5"
          />
        </div>

        <div className="flex-1 overflow-auto px-1 pb-1">
          {loading && <div className="px-2 py-2 text-[11px] text-nova-muted">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="px-2 py-3 text-[11px] text-nova-muted text-center">
              {notes.length === 0 ? 'No notes yet — create one.' : 'No matches.'}
            </div>
          )}
          {filtered.map((n) => {
            const active = activeId === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setActiveId(n.id)}
                className={[
                  'group w-full text-left px-2 py-1.5 rounded mb-0.5 transition-colors border',
                  active ? 'bg-nova-accent/10 border-nova-accent/30' : 'border-transparent hover:bg-nova-panel2',
                ].join(' ')}
              >
                <div className="flex justify-between items-start gap-1.5">
                  <span className={`truncate text-[12px] ${active ? 'text-nova-accent' : 'text-nova-text'}`}>
                    {n.title || 'Untitled'}
                  </span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); deleteNote(n.id); }}
                    className="opacity-0 group-hover:opacity-100 text-[12px] leading-none text-nova-muted hover:text-nova-err px-1"
                    title="Delete"
                  >×</span>
                </div>
                <div className="text-[10px] text-nova-muted font-mono mt-0.5">{fmtDate(n.updatedAt)}</div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Editor ────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {!activeId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="w-16 h-16 rounded-full bg-nova-panel border border-nova-border flex items-center justify-center text-3xl text-nova-ok">✎</div>
            <div>
              <div className="font-display text-base">
                {notes.length === 0 ? 'Start a new note' : 'Pick a note to edit'}
              </div>
              <div className="text-[11px] text-nova-muted mt-0.5 max-w-[280px]">
                Notes are saved as plain markdown files. Nova can read, append, and edit them anytime.
              </div>
            </div>
            <button onClick={newNote} className="nova-btn-primary text-xs">
              {notes.length === 0 ? 'Create your first note' : 'New note'}
            </button>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 px-3 py-2 border-b border-nova-border bg-nova-panel">
              <input
                value={title}
                onChange={(e) => { dirtyRef.current = true; setTitle(e.target.value); }}
                placeholder="Title"
                className="flex-1 bg-transparent border-none outline-none font-display text-base"
              />
              <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-nova-muted">
                <span className={`w-1.5 h-1.5 rounded-full ${saving ? 'bg-nova-warn animate-pulse' : 'bg-nova-ok'}`} />
                {saving ? 'saving…'
                  : savedAt ? `saved ${savedAt.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}`
                  : 'idle'}
              </div>
            </header>
            <textarea
              value={content}
              onChange={(e) => { dirtyRef.current = true; setContent(e.target.value); }}
              placeholder="Write something… markdown supported."
              spellCheck
              className="flex-1 w-full p-3 bg-nova-bg text-[13px] font-mono leading-relaxed outline-none resize-none placeholder-nova-muted"
            />
            <footer className="px-3 py-1 border-t border-nova-border bg-nova-panel flex justify-between text-[10px] text-nova-muted font-mono">
              <span>{wordCount} word{wordCount === 1 ? '' : 's'}</span>
              <span>{content.length} chars</span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
