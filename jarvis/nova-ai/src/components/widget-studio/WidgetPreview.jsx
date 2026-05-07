import React, { useMemo, useEffect, useRef } from 'react';

/**
 * WidgetPreview — renders a widget's HTML inside a sandboxed iframe.
 * Uses srcdoc + sandbox attribute so the widget cannot reach Electron APIs.
 */
export default function WidgetPreview({ html, height = 360 }) {
  const ref = useRef(null);

  useEffect(() => {
    // No-op; srcdoc handles loading. Kept for future hot-reload hooks.
  }, [html]);

  if (!html) {
    return (
      <div
        className="nova-card flex items-center justify-center text-nova-muted text-sm"
        style={{ height }}
      >
        No preview yet. Build a widget to see it here.
      </div>
    );
  }

  return (
    <iframe
      ref={ref}
      title="Widget preview"
      srcDoc={html}
      sandbox="allow-scripts"
      className="w-full nova-card bg-white/0"
      style={{ height, border: 0 }}
    />
  );
}
