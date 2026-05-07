import React, { useEffect, useState } from 'react';

/**
 * PopoutViewer — rendered inside a child Electron BrowserWindow when the
 * user clicks "Pop Out" on a widget. The main process actually loads a
 * data: URL containing the widget HTML directly, so this component is
 * only used inside the *main app* when a user wants an inline overlay
 * preview (not a separate window).
 */
export default function PopoutViewer({ html, name = 'Widget', onClose }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!open || !html) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-6">
      <div className="bg-nova-panel border border-nova-border rounded-lg shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-4 py-2 border-b border-nova-border">
          <h3 className="font-display text-sm">{name}</h3>
          <button onClick={() => { setOpen(false); onClose?.(); }} className="nova-btn">Close</button>
        </header>
        <iframe
          title={name}
          srcDoc={html}
          sandbox="allow-scripts"
          className="w-full h-[560px] border-0 bg-nova-bg"
        />
      </div>
    </div>
  );
}
