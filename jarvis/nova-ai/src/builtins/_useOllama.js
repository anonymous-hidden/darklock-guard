/**
 * useOllama — self-contained AI hook for built-in widgets.
 *
 * Built-in widgets can run outside the main app shell, so they cannot rely
 * on global stores being initialized. This hook probes provider health and
 * model availability directly.
 */
import { useEffect, useState } from 'react';
import { aiClient, DEFAULT_MODEL, pickBestAiModel } from '@core/ai/AIClient.js';

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
        const provider = String(model || '').startsWith('ollama:') ? 'ollama' : 'openai';
        const h = await aiClient.health(provider);
        if (cancelled) return;
        setHealth({ ok: !!h.ok, checking: false, error: h.error || null, version: h.version });

        try {
          const list = await aiClient.listModels();
          if (cancelled) return;
          const names = (list || []).map((m) => m.name || m.model || m).filter(Boolean);
          setModels(names);
          // Pick a sensible default model if user hasn't chosen one.
          setModel((cur) => {
            if (cur && names.includes(cur)) return cur;
            return pickBestAiModel(names, DEFAULT_MODEL) || cur || '';
          });
        } catch {}
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
