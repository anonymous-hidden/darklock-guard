import { useEffect, useState } from 'react';
import './TitleBar.css';

const api = (window as any).electronAPI;

export function TitleBar() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dl-fullscreen', isFullscreen);
    return () => {
      document.documentElement.classList.remove('dl-fullscreen');
    };
  }, [isFullscreen]);

  useEffect(() => {
    let disposed = false;

    void api?.winIsFullscreen?.()
      .then((value: boolean) => {
        if (!disposed) setIsFullscreen(!!value);
      })
      .catch(() => {
        /* no-op in web mode */
      });

    const unsubscribe = api?.onFullscreenChanged?.((value: boolean) => {
      setIsFullscreen(!!value);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  // In browser/web mode (no Electron), don't render anything
  if (!api?.winClose) return null;
  if (isFullscreen) return null;

  return (
    <div className="titlebar">
      <div className="titlebar__drag" />
      <div className="titlebar__controls">
        <button
          className="titlebar__btn titlebar__btn--min"
          onClick={() => api.winMinimize()}
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button
          className="titlebar__btn titlebar__btn--max"
          onClick={() => api.winMaximize()}
          aria-label="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" /></svg>
        </button>
        <button
          className="titlebar__btn titlebar__btn--fullscreen"
          onClick={() => api.winToggleFullscreen?.()}
          aria-label="Toggle Full Screen"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M1 4V1h3" />
            <path d="M6 1h3v3" />
            <path d="M9 6v3H6" />
            <path d="M4 9H1V6" />
          </svg>
        </button>
        <button
          className="titlebar__btn titlebar__btn--close"
          onClick={() => api.winClose()}
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" /><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
    </div>
  );
}
