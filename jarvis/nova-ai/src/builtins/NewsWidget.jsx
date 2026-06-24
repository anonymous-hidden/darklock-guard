import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const OLLAMA_CHAT = 'http://127.0.0.1:11434/api/chat';
const OLLAMA_GENERATE = 'http://127.0.0.1:11434/api/generate';
const FALLBACK_MODELS = ['llama3.2:3b', 'gemma3:4b', 'llama3.2:1b', 'qwen2.5:3b', 'mistral:7b', 'llama3.1:8b', 'llama3:8b'];
const FRESH_WINDOW_MS = 48 * 60 * 60 * 1000;
const GENERIC_NEWS_WORDS = new Set(['news', 'today', 'latest', 'current', 'headline', 'headlines', 'breaking']);

/* ── RSS feeds (freely accessible, no API key, no bot detection) ── */
const RSS_FEEDS = [
  { url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', label: 'Google News'  },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',          label: 'BBC World'    },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',     label: 'BBC Tech'     },
  { url: 'https://feeds.npr.org/1001/rss.xml',                    label: 'NPR'          },
  { url: 'https://www.theguardian.com/world/rss',                 label: 'Guardian'     },
  { url: 'https://feeds.arstechnica.com/arstechnica/index',       label: 'Ars Technica' },
  { url: 'https://www.theverge.com/rss/index.xml',                label: 'The Verge'    },
  { url: 'https://techcrunch.com/feed/',                          label: 'TechCrunch'   },
  { url: 'https://news.ycombinator.com/rss',                      label: 'HN'           },
  { url: 'https://krebsonsecurity.com/feed/',                     label: 'Krebs'        },
];

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDate(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : 0;
}

function relTime(ts) {
  if (!ts) return '';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins || 1}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function preferFresh(items) {
  const now = Date.now();
  const fresh = items.filter((item) => {
    const ts = Number(item.publishedAt) || 0;
    return ts > 0 && ts <= now + 30 * 60 * 1000 && now - ts <= FRESH_WINDOW_MS;
  });
  if (fresh.length >= Math.min(6, items.length)) return fresh;
  if (!fresh.length) return items;
  const freshSet = new Set(fresh);
  return [...fresh, ...items.filter((item) => !freshSet.has(item))];
}

async function fetchRss(feed) {
  try {
    let xml = '';
    const rawFetch = window.nova?.control?.webFetchRaw;
    if (rawFetch) {
      const r = await rawFetch(feed.url);
      if (!r?.ok || !r.body) return [];
      xml = r.body;
    } else {
      const r = await fetch(feed.url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return [];
      xml = await r.text();
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const items = Array.from(doc.querySelectorAll('item, entry'));
    return items.slice(0, 12).map((el) => {
      const get = (tag) => el.querySelector(tag)?.textContent?.trim() || '';
      const title   = stripTags(get('title'));
      const snippet = stripTags(get('description') || get('summary') || get('content'));
      const url     = (el.querySelector('link')?.getAttribute('href') || get('link') || '').trim();
      const publishedAt = parseDate(get('pubDate') || get('updated') || get('published'));
      return title ? { title, snippet: snippet.slice(0, 200), url, source: feed.label, publishedAt } : null;
    }).filter(Boolean);
  } catch { return []; }
}

async function fetchAllRss(topicFilter) {
  const feeds = [...RSS_FEEDS];
  const q = String(topicFilter || '').trim();
  if (q) {
    feeds.unshift({
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} news`)}&hl=en-US&gl=US&ceid=US:en`,
      label: 'Google News',
    });
  }
  const results = await Promise.allSettled(feeds.map(fetchRss));
  const all = results.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
  all.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  const current = preferFresh(all);
  if (!topicFilter) return current.slice(0, 24);
  const kw = topicFilter.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !GENERIC_NEWS_WORDS.has(w));
  if (!kw.length) return current.slice(0, 24);
  const scored = current.map((item) => {
    const hay = `${item.title} ${item.snippet} ${item.source}`.toLowerCase();
    const hits = kw.filter((w) => hay.includes(w)).length;
    return { item, hits };
  });
  scored.sort((a, b) => (b.hits - a.hits) || ((b.item.publishedAt || 0) - (a.item.publishedAt || 0)));
  // Return scored matches first, then fill up to 20 with everything else
  const matched = scored.filter((s) => s.hits > 0).map((s) => s.item);
  const rest    = scored.filter((s) => s.hits === 0).map((s) => s.item);
  return [...matched, ...rest].slice(0, 24);
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function cleanBrief(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();
}

async function getModel() {
  try {
    const result = await window.nova?.ai?.listModels?.();
    const models = result?.models || result?.data || [];
    if (models.length) return models[0].name || models[0].model || FALLBACK_MODELS[0];
  } catch {}
  // Probe Ollama directly
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags');
    if (r.ok) {
      const data = await r.json();
      const models = data?.models || [];
      if (models.length) return models[0].name;
    }
  } catch {}
  return FALLBACK_MODELS[0];
}

export default function NewsWidget() {
  const [topic, setTopic] = useState('latest world technology security');
  const [results, setResults] = useState([]);
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  const sourceText = useMemo(() => results.slice(0, 6).map((r, i) => `${i + 1}. ${r.title} - ${r.snippet} ${r.publishedAt ? `[${new Date(r.publishedAt).toLocaleString()}]` : ''} (${r.url})`).join('\n'), [results]);

  // Calls Ollama directly — bypasses the Jarvis AI agent loop at port 8951
  // which runs tools like NEWS: and easily exceeds 16-second timeouts.
  const askNova = useCallback(async (items) => {
    if (abortRef.current) { try { abortRef.current.abort(); } catch {} }
    const ac = new AbortController();
    abortRef.current = ac;

    if (!items?.length) {
      setBrief('⚠ No articles fetched — check your internet connection and try again.');
      return;
    }

    setBrief('');
    const model = await getModel();

    const prompt = [
      'You are writing a concise daily news brief. Use only the provided snippets — do not invent facts.',
      'Prefer the newest articles. If an item is older than 48 hours, mention that it is older instead of presenting it as breaking.',
      'Write exactly 5 tight bullet points (one sentence each), then one short "Watch next:" line.',
      'Plain text only. No markdown headings, no bold, no asterisks.',
      '',
      items.slice(0, 8).map((r, i) => `${i + 1}. ${r.title} — ${r.snippet}${r.publishedAt ? ` — published ${new Date(r.publishedAt).toLocaleString()}` : ''}`).join('\n'),
    ].join('\n');

    try {
      let resp = await fetch(OLLAMA_CHAT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
          options: { temperature: 0.3, num_predict: 450 },
        }),
      });
      let mode = 'chat';
      if (resp.status === 404) {
        mode = 'generate';
        resp = await fetch(OLLAMA_GENERATE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ac.signal,
          body: JSON.stringify({
            model,
            prompt,
            stream: true,
            options: { temperature: 0.3, num_predict: 450 },
          }),
        });
      }

      if (!resp.ok) throw new Error(`Ollama returned HTTP ${resp.status}. Is it running?`);

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let full = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            const token = mode === 'generate' ? msg.response : msg.message?.content;
            if (token) {
              full += token;
              setBrief(cleanBrief(full));
            }
            if (msg.done) { reader.cancel(); break; }
          } catch {}
        }
      }

      if (!full.trim()) setBrief('⚠ Jarvis returned an empty response. Try refreshing.');
    } catch (e) {
      if (e.name === 'AbortError') return;
      setBrief(`⚠ Could not reach Ollama (${OLLAMA_CHAT}).\nMake sure Ollama is running: ollama serve\n\nError: ${e.message}`);
    }
  }, []);

  const load = useCallback(async (q = topic) => {
    setBusy(true); setError(''); setBrief('');
    try {
      // Primary: RSS feeds — no bot detection, no scraping, always works in Electron
      let items = await fetchAllRss(q);
      if (!items.length) {
        // Fallback: webSearch via IPC (DDG HTML scrape — may fail)
        const r = await window.nova?.control?.webSearch?.(q, 10);
        items = r?.results || [];
      }
      setResults(items);
      await askNova(items);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [askNova, topic]);

  useEffect(() => () => { try { abortRef.current?.abort(); } catch {} }, []);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const off = window.nova?.ui?.onNewsRefresh?.((payload) => load(payload?.topic || topic));
    return () => off?.();
  }, [load, topic]);

  return (
    <div className="h-full flex flex-col bg-nova-bg text-nova-text overflow-hidden">
      <header className="px-3 py-2 border-b border-nova-border bg-nova-panel/70 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm">Daily News</div>
          <div className="text-[10px] text-nova-muted">{todayLabel()}</div>
        </div>
        <button onClick={() => load()} disabled={busy} className="nova-btn text-xs">Refresh</button>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); load(topic); }} className="px-3 py-2 border-b border-nova-border/60 flex gap-2 bg-nova-panel/35">
        <input value={topic} onChange={(e) => setTopic(e.target.value)} className="nova-input text-xs flex-1" />
        <button disabled={busy || !topic.trim()} className="nova-btn-primary text-xs px-3">Brief</button>
      </form>
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_1fr] overflow-hidden">
        <section className="min-h-0 overflow-y-auto p-3 border-r border-nova-border/60">
          {error && <div className="text-[11px] text-nova-err font-mono mb-2">{error}</div>}
          <div className="text-[10px] uppercase tracking-wider text-nova-accent2 mb-2">Jarvis Brief</div>
          <div className="text-[12px] leading-relaxed whitespace-pre-wrap bg-nova-panel/55 border border-nova-border/50 rounded-lg p-3 min-h-[170px]">
            {brief || (busy ? 'Collecting today’s headlines...' : 'Waiting for Jarvis.')}
          </div>
        </section>
        <section className="min-h-0 overflow-y-auto p-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-nova-muted px-1">Sources</div>
          {results.map((r, idx) => (
            <button key={`${r.url}-${idx}`} onClick={() => window.nova?.control?.openPath?.(r.url)} className="w-full text-left border border-nova-border/40 bg-nova-panel/45 hover:border-nova-accent/50 rounded-lg px-2 py-2">
              <div className="text-[12px] line-clamp-2">{r.title}</div>
              <div className="text-[10.5px] text-nova-muted line-clamp-2 mt-1">{r.snippet}</div>
              {(r.source || r.publishedAt) && <div className="text-[9.5px] text-nova-accent2 mt-1">{[r.source, relTime(r.publishedAt)].filter(Boolean).join(' · ')}</div>}
            </button>
          ))}
          {!results.length && !busy && <div className="text-xs text-nova-muted p-4 text-center">No stories loaded.</div>}
          <textarea readOnly value={sourceText} className="sr-only" />
        </section>
      </div>
    </div>
  );
}
