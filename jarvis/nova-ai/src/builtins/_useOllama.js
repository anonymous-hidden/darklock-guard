/**
 * useOllama — self-contained Ollama hook for built-in widgets.
 *
 * Built-in widgets (Call, Chat) used to depend on the global Zustand
 * `appStore` for ollama health and selectedModel. That store is only
 * initialised when the FULL Nova app shell mounts, so when a widget
 * runs in a standalone popout window it would hang forever in a
 * "Waiting for Ollama…" state.
 *
 * This hook does its own health probe + model discovery so widgets work
 * regardless of whether the app shell is loaded.
 */
import { useEffect, useState } from 'react';
import { ollama, DEFAULT_MODEL, FAST_MODEL } from '@core/ai/OllamaClient.js';

export function useOllama() {
  const [health, setHealth] = useState({ ok: false, checking: true, error: null });
  const [models, setModels] = useState([]);
  const [model,  setModel]  = useState(() => {
    try { return localStorage.getItem('nova:selectedModel') || ''; } catch { return ''; }
  });

  // Health probe + model list
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      try {
        const h = await ollama.health();
        if (cancelled) return;
        setHealth({ ok: !!h.ok, checking: false, error: h.error || null, version: h.version });

        if (h.ok) {
          try {
            const list = await ollama.listModels();
            if (cancelled) return;
            const names = (list || []).map((m) => m.name || m.model).filter(Boolean);
            setModels(names);
            // Pick a sensible default model if user hasn't chosen one.
            setModel((cur) => {
              if (cur && names.includes(cur)) return cur;
              if (names.includes(DEFAULT_MODEL)) return DEFAULT_MODEL;
              if (names.includes(FAST_MODEL))    return FAST_MODEL;
              return names[0] || cur || '';
            });
          } catch {}
        }
      } catch (err) {
        if (!cancelled) setHealth({ ok: false, checking: false, error: String(err?.message || err) });
      }
    };

    tick();
    timer = setInterval(tick, 8000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, []);

  // Persist model choice across reloads.
  const selectModel = (name) => {
    setModel(name);
    try { localStorage.setItem('nova:selectedModel', name); } catch {}
  };

  return { health, ready: health.ok, models, model, setModel: selectModel };
}
