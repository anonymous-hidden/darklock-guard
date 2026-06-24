import React, { useEffect, useState, useCallback, useRef } from 'react';

const API = 'http://127.0.0.1:8951/api/emotions';

// Emotion → color mapping
const EMOTION_META = {
  happy:       { color: '#f9c74f', bg: 'rgba(249,199,79,0.15)',  emoji: '😊' },
  excited:     { color: '#f8961e', bg: 'rgba(248,150,30,0.15)',  emoji: '🤩' },
  proud:       { color: '#90be6d', bg: 'rgba(144,190,109,0.15)', emoji: '💪' },
  grateful:    { color: '#43aa8b', bg: 'rgba(67,170,139,0.15)',  emoji: '🙏' },
  calm:        { color: '#4cc9f0', bg: 'rgba(76,201,240,0.15)',  emoji: '😌' },
  content:     { color: '#4361ee', bg: 'rgba(67,97,238,0.15)',   emoji: '🙂' },
  hopeful:     { color: '#b5e48c', bg: 'rgba(181,228,140,0.15)', emoji: '✨' },
  focused:     { color: '#7b2d8b', bg: 'rgba(123,45,139,0.15)', emoji: '🎯' },
  tired:       { color: '#9d8189', bg: 'rgba(157,129,137,0.15)', emoji: '😴' },
  bored:       { color: '#adb5bd', bg: 'rgba(173,181,189,0.15)', emoji: '😑' },
  confused:    { color: '#ffd6a5', bg: 'rgba(255,214,165,0.15)', emoji: '😕' },
  lonely:      { color: '#cdb4db', bg: 'rgba(205,180,219,0.15)', emoji: '🫂' },
  sad:         { color: '#5e60ce', bg: 'rgba(94,96,206,0.15)',   emoji: '😢' },
  anxious:     { color: '#f4a261', bg: 'rgba(244,162,97,0.15)',  emoji: '😰' },
  stressed:    { color: '#e76f51', bg: 'rgba(231,111,81,0.15)',  emoji: '😤' },
  overwhelmed: { color: '#e63946', bg: 'rgba(230,57,70,0.15)',   emoji: '🤯' },
  angry:       { color: '#d00000', bg: 'rgba(208,0,0,0.15)',     emoji: '😠' },
  frustrated:  { color: '#c1121f', bg: 'rgba(193,18,31,0.15)',   emoji: '😒' },
};
const ALL_EMOTIONS = Object.keys(EMOTION_META);

function getEmotionMeta(emotion) {
  return EMOTION_META[emotion] || { color: '#888', bg: 'rgba(136,136,136,0.15)', emoji: '🔹' };
}

function IntensityBar({ value, max = 10 }) {
  const pct = (value / max) * 100;
  const color = value <= 3 ? '#4cc9f0' : value <= 6 ? '#f9c74f' : '#e76f51';
  return (
    <div className="flex items-center gap-1.5 flex-1">
      <div className="flex-1 h-1.5 rounded-full bg-nova-border/30 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono text-nova-muted w-6 text-right">{value}/10</span>
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// ─── Main widget ──────────────────────────────────────────────────────────────

export default function EmotionWidget() {
  const publish = (action, summary) => {
    try { window.nova?.bus?.publish?.('widget:event', { widget: 'emotions', action, summary }); } catch {}
  };

  const [view, setView]       = useState('log');    // 'log' | 'stats' | 'add'
  const [entries, setEntries] = useState([]);
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // Add form state
  const [draft, setDraft] = useState({ emotion: 'calm', intensity: 5, note: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API}?limit=100`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setEntries(Array.isArray(j) ? j : []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally { setLoading(false); }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch(`${API}/stats`);
      if (!r.ok) return;
      setStats(await r.json());
    } catch {}
  }, []);

  useEffect(() => { load(); loadStats(); }, [load, loadStats]);

  // Auto-refresh when Jarvis logs an emotion
  useEffect(() => {
    const off = window.nova?.bus?.subscribe?.('emotion:changed', () => { load(); loadStats(); });
    const t = setInterval(() => { load(); loadStats(); }, 15000);
    return () => { off?.(); clearInterval(t); };
  }, [load, loadStats]);

  const saveEntry = async () => {
    if (!draft.emotion) return;
    setSaving(true);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emotion:   draft.emotion,
          intensity: draft.intensity,
          note:      draft.note.trim(),
          source:    'user',
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDraft({ emotion: 'calm', intensity: 5, note: '' });
      setView('log');
      publish('logged', `${draft.emotion} ${draft.intensity}/10`);
      load(); loadStats();
    } catch (e) {
      setError(String(e?.message || e));
    } finally { setSaving(false); }
  };

  const deleteEntry = async (id) => {
    try {
      await fetch(`${API}/${id}`, { method: 'DELETE' });
      publish('deleted', `entry #${id}`);
      load(); loadStats();
    } catch {}
  };

  // Group entries by day
  const grouped = entries.reduce((acc, e) => {
    const day = (e.logged_at || '').slice(0, 10);
    (acc[day] = acc[day] || []).push(e);
    return acc;
  }, {});
  const days = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  // Top 5 emotions for stats bar chart
  const topEmotions = stats
    ? Object.entries(stats.by_emotion || {})
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 6)
    : [];
  const maxCount = topEmotions[0]?.[1]?.count || 1;

  return (
    <div className="h-full flex flex-col bg-nova-bg text-nova-text overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-nova-border/40 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">💭</span>
          <span className="font-semibold text-sm">Mood Journal</span>
          {stats?.total > 0 && (
            <span className="text-[10px] text-nova-muted bg-nova-panel px-1.5 py-0.5 rounded-full">
              {stats.total} entries
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {['log','stats','add'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                view === v
                  ? 'bg-nova-accent text-white'
                  : 'text-nova-muted hover:text-nova-text hover:bg-nova-border/30'
              }`}>
              {v === 'log' ? '📋 Log' : v === 'stats' ? '📊 Stats' : '+ Log'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 text-[11px] text-nova-err bg-nova-err/10 px-2 py-1 rounded">
          {error}
        </div>
      )}

      {/* ── Quick snapshot bar ── */}
      {stats?.total > 0 && view !== 'add' && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-nova-border/20 bg-nova-panel/40 shrink-0">
          <div className="text-[11px] text-nova-muted">Most common:</div>
          {stats.most_common && (() => {
            const m = getEmotionMeta(stats.most_common);
            return (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full"
                style={{ background: m.bg, color: m.color }}>
                {m.emoji} {stats.most_common}
              </span>
            );
          })()}
          <div className="text-[11px] text-nova-muted ml-auto">avg intensity:</div>
          <span className="text-[11px] font-mono text-nova-accent">{stats.avg_intensity}/10</span>
        </div>
      )}

      {/* ── Views ── */}
      <div className="flex-1 overflow-auto">

        {/* ── LOG VIEW ── */}
        {view === 'log' && (
          <div>
            {loading && entries.length === 0 && (
              <div className="text-center text-nova-muted py-8 text-sm">Loading…</div>
            )}
            {!loading && entries.length === 0 && (
              <div className="text-center text-nova-muted py-10 text-sm">
                <div className="text-3xl mb-2">💭</div>
                <div>No entries yet.</div>
                <div className="text-[11px] mt-1">Click <strong>+ Log</strong> or just tell Jarvis how you're feeling.</div>
              </div>
            )}
            {days.map(day => (
              <div key={day}>
                <div className="px-3 py-1 text-[10.5px] font-semibold text-nova-muted uppercase tracking-wide bg-nova-panel/30 border-b border-nova-border/20 sticky top-0">
                  {fmtDate(day + 'T00:00')}
                </div>
                {grouped[day].map(e => {
                  const m = getEmotionMeta(e.emotion);
                  return (
                    <div key={e.id}
                      className="group flex items-start gap-2.5 px-3 py-2 border-b border-nova-border/20 hover:bg-nova-panel/30 transition-colors">
                      {/* Emotion chip */}
                      <div className="shrink-0 mt-0.5 text-base" title={e.emotion}>{m.emoji}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: m.bg, color: m.color }}>
                            {e.emotion}
                          </span>
                          {e.source === 'nova' && (
                            <span className="text-[9.5px] text-nova-accent bg-nova-accent/10 px-1 py-0.5 rounded-full">✦ Jarvis</span>
                          )}
                          <IntensityBar value={e.intensity} />
                          <span className="text-[10.5px] text-nova-muted font-mono ml-auto">{fmtTime(e.logged_at)}</span>
                        </div>
                        {e.note && (
                          <div className="text-[11.5px] text-nova-muted mt-1 leading-relaxed">{e.note}</div>
                        )}
                      </div>
                      <button onClick={() => deleteEntry(e.id)}
                        className="opacity-0 group-hover:opacity-100 text-nova-muted hover:text-nova-err text-xs transition-opacity shrink-0 mt-0.5">×</button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* ── STATS VIEW ── */}
        {view === 'stats' && (
          <div className="p-3 flex flex-col gap-4">
            {(!stats || stats.total === 0) && (
              <div className="text-center text-nova-muted py-8 text-sm">No data yet.</div>
            )}
            {stats?.total > 0 && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Total entries', value: stats.total },
                    { label: 'Most common', value: (() => { const m = getEmotionMeta(stats.most_common); return `${m.emoji} ${stats.most_common}`; })() },
                    { label: 'Avg intensity', value: `${stats.avg_intensity}/10` },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-nova-panel rounded-lg p-2 text-center">
                      <div className="text-sm font-bold text-nova-accent truncate">{value}</div>
                      <div className="text-[9.5px] text-nova-muted mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>

                {/* Emotion frequency bars */}
                <div>
                  <div className="text-[10.5px] text-nova-muted font-semibold uppercase tracking-wide mb-2">Frequency</div>
                  <div className="flex flex-col gap-2">
                    {topEmotions.map(([emotion, data]) => {
                      const m = getEmotionMeta(emotion);
                      const pct = (data.count / maxCount) * 100;
                      return (
                        <div key={emotion} className="flex items-center gap-2">
                          <span className="text-base shrink-0">{m.emoji}</span>
                          <div className="w-20 shrink-0 text-[11px] truncate" style={{ color: m.color }}>
                            {emotion}
                          </div>
                          <div className="flex-1 h-2 rounded-full bg-nova-border/20 overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, background: m.color }} />
                          </div>
                          <span className="text-[10px] font-mono text-nova-muted w-6 text-right">{data.count}×</span>
                          <span className="text-[10px] font-mono text-nova-muted w-10 text-right">{data.avg_intensity}/10</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Source split */}
                {entries.length > 0 && (() => {
                  const novaCount = entries.filter(e => e.source === 'nova').length;
                  const userCount = entries.length - novaCount;
                  return (
                    <div className="bg-nova-panel/50 rounded-lg p-2.5 text-[11px]">
                      <div className="text-nova-muted font-semibold mb-1">Logged by</div>
                      <div className="flex gap-4">
                        <div><span className="text-nova-text font-bold">{userCount}</span> <span className="text-nova-muted">by you</span></div>
                        <div><span className="text-nova-accent font-bold">{novaCount}</span> <span className="text-nova-muted">by Jarvis</span></div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* ── ADD VIEW ── */}
        {view === 'add' && (
          <div className="p-3 flex flex-col gap-4">
            {/* Emotion picker */}
            <div>
              <div className="text-[10.5px] text-nova-muted font-semibold uppercase tracking-wide mb-2">How are you feeling?</div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_EMOTIONS.map(em => {
                  const m = getEmotionMeta(em);
                  const sel = draft.emotion === em;
                  return (
                    <button key={em} onClick={() => setDraft(d => ({ ...d, emotion: em }))}
                      className="text-[11px] px-2 py-1 rounded-full border transition-all"
                      style={{
                        borderColor: sel ? m.color : 'transparent',
                        background:  sel ? m.bg : 'rgba(255,255,255,0.03)',
                        color:       sel ? m.color : 'var(--nova-muted)',
                        fontWeight:  sel ? 600 : 400,
                      }}>
                      {m.emoji} {em}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Intensity slider */}
            <div>
              <div className="text-[10.5px] text-nova-muted font-semibold uppercase tracking-wide mb-2">
                Intensity: <span className="text-nova-accent font-bold">{draft.intensity}/10</span>
              </div>
              <input type="range" min={1} max={10} value={draft.intensity}
                onChange={e => setDraft(d => ({ ...d, intensity: Number(e.target.value) }))}
                className="w-full accent-nova-accent" />
              <div className="flex justify-between text-[9px] text-nova-muted mt-0.5">
                <span>mild</span><span>moderate</span><span>intense</span>
              </div>
            </div>

            {/* Note */}
            <div>
              <div className="text-[10.5px] text-nova-muted font-semibold uppercase tracking-wide mb-1.5">Context (optional)</div>
              <textarea
                value={draft.note}
                onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
                placeholder="What's going on? What triggered this feeling?"
                rows={3}
                className="nova-input w-full text-sm resize-none"
              />
            </div>

            {/* Preview + Save */}
            {draft.emotion && (() => {
              const m = getEmotionMeta(draft.emotion);
              return (
                <div className="rounded-lg p-2.5 text-sm font-medium flex items-center gap-2"
                  style={{ background: m.bg, color: m.color }}>
                  <span className="text-lg">{m.emoji}</span>
                  <span>{draft.emotion}</span>
                  <span className="opacity-60 ml-auto text-xs">{draft.intensity}/10</span>
                </div>
              );
            })()}

            <button onClick={saveEntry} disabled={saving || !draft.emotion}
              className="nova-btn-primary text-sm py-1.5 disabled:opacity-50">
              {saving ? 'Saving…' : 'Log Entry'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
