/**
 * CodeExtractor — parses the delimited response produced by WIDGET_MODE.
 *
 * Primary path:  <<<THINKING_START>>>...<<<THINKING_END>>>,
 *                <<<WIDGET_CODE_START>>>...<<<WIDGET_CODE_END>>>,
 *                <<<WIDGET_META_START>>>{...}<<<WIDGET_META_END>>>
 *
 * Fallback path: scan markdown fenced code blocks (```jsx / ```js / ```tsx)
 * and try to recover a usable component definition. If multiple blocks
 * exist, the largest one wins.
 */

const RX = {
  thinking: /<<<THINKING_START>>>([\s\S]*?)<<<THINKING_END>>>/i,
  code:     /<<<WIDGET_CODE_START>>>([\s\S]*?)<<<WIDGET_CODE_END>>>/i,
  meta:     /<<<WIDGET_META_START>>>([\s\S]*?)<<<WIDGET_META_END>>>/i,
  fence:    /```(?:jsx?|tsx?|javascript|typescript|react)?\s*\n([\s\S]*?)```/gi,
};

function tryParseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  try { return JSON.parse(trimmed); }
  catch {}
  // Permissive: extract the first {...} block.
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

function looksLikeReactComponent(src) {
  if (!src || src.length < 30) return false;
  const hasFn = /\bfunction\s+[A-Z]\w*|const\s+[A-Z]\w*\s*=\s*\(?/i.test(src);
  const hasJsx = /<[A-Za-z][^>]*>/.test(src) || /React\.createElement/.test(src);
  return hasFn && hasJsx;
}

function findLargestFence(text) {
  const blocks = [];
  let m;
  RX.fence.lastIndex = 0;
  while ((m = RX.fence.exec(text)) !== null) {
    blocks.push(m[1]);
  }
  if (!blocks.length) return null;
  blocks.sort((a, b) => b.length - a.length);
  return blocks[0];
}

function deriveDefaultMeta(code, prompt) {
  const nameMatch =
    code.match(/export\s+default\s+function\s+([A-Z]\w*)/) ||
    code.match(/function\s+([A-Z]\w*)/) ||
    code.match(/const\s+([A-Z]\w*)\s*=/);
  const name = (nameMatch && nameMatch[1]) || 'Untitled Widget';
  return {
    name: name.replace(/([A-Z])/g, ' $1').trim(),
    description: prompt ? String(prompt).slice(0, 140) : 'Generated widget',
    tags: [],
    width: 480,
    height: 360,
  };
}

/**
 * @param {string} response - full AI response text
 * @param {{ prompt?: string }} [opts]
 * @returns {{
 *   ok: boolean,
 *   thinking: string,
 *   code: string,
 *   meta: { name: string, description: string, tags: string[], width: number, height: number },
 *   usedFallback: boolean,
 *   error?: string,
 * }}
 */
export function extractWidget(response, opts = {}) {
  const text = String(response || '');
  const out = {
    ok: false,
    thinking: '',
    code: '',
    meta: { name: 'Untitled Widget', description: '', tags: [], width: 480, height: 360 },
    usedFallback: false,
  };

  const tMatch = text.match(RX.thinking);
  if (tMatch) out.thinking = tMatch[1].trim();

  const cMatch = text.match(RX.code);
  if (cMatch && cMatch[1].trim()) {
    out.code = cMatch[1].trim();
  } else {
    // Fallback: largest fenced block
    const fence = findLargestFence(text);
    if (fence && looksLikeReactComponent(fence)) {
      out.code = fence.trim();
      out.usedFallback = true;
    }
  }

  const mMatch = text.match(RX.meta);
  const metaJson = mMatch ? tryParseJson(mMatch[1]) : null;
  if (metaJson && typeof metaJson === 'object') {
    out.meta = {
      name: String(metaJson.name || out.meta.name).slice(0, 80),
      description: String(metaJson.description || '').slice(0, 400),
      tags: Array.isArray(metaJson.tags) ? metaJson.tags.map(String).slice(0, 10) : [],
      width: Math.max(240, Math.min(1600, Number(metaJson.width) || 480)),
      height: Math.max(200, Math.min(1200, Number(metaJson.height) || 360)),
    };
  } else if (out.code) {
    out.meta = deriveDefaultMeta(out.code, opts.prompt);
    out.usedFallback = true;
  }

  if (!out.code) {
    out.error = 'No widget code found in response.';
    return out;
  }
  if (!looksLikeReactComponent(out.code)) {
    out.error = 'Extracted block does not look like a React component.';
    return out;
  }

  out.ok = true;
  return out;
}

/**
 * Render the iframe HTML for an extracted widget. The iframe loads React
 * and Tailwind from CDN, then evaluates the component via Babel-standalone.
 * Self-contained — no network calls beyond CDN at render time.
 */
export function buildWidgetIframeHtml({ code, meta }) {
  const safeCode = String(code).replace(/<\/script>/gi, '<\\/script>');
  const title = (meta?.name || 'Widget').replace(/[<>]/g, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script crossorigin src="https://unpkg.com/react@19/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@19/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone@7.25.6/babel.min.js"></script>
<style>
  html,body,#root{margin:0;padding:0;height:100%;background:#0a0a0f;color:#e8e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
  #__nova_err{padding:16px;color:#ff8a8a;font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;}
</style>
</head>
<body>
<div id="root"></div>
<div id="__nova_err" hidden></div>
<script type="text/babel" data-presets="env,react">
try {
  const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useLayoutEffect, Fragment } = React;
${safeCode}
  // Locate the component to render.
  let __NovaWidget = null;
  try { __NovaWidget = (typeof exports !== 'undefined' && exports.default) || null; } catch {}
  if (!__NovaWidget) {
    // Heuristic: find the last top-level capitalised identifier defined.
    const names = Object.keys(this || {});
    for (const n of names.reverse()) { if (/^[A-Z]/.test(n) && typeof this[n] === 'function') { __NovaWidget = this[n]; break; } }
  }
  if (!__NovaWidget) {
    throw new Error('No default-exported component found.');
  }
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(__NovaWidget));
} catch (e) {
  const el = document.getElementById('__nova_err');
  el.hidden = false;
  el.textContent = 'Widget runtime error:\\n' + (e && e.stack || e);
  document.getElementById('root').remove();
}
</script>
</body>
</html>`;
}

export const CodeExtractor = { extractWidget, buildWidgetIframeHtml };
