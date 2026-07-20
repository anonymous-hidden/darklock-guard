/* ──────────────────────────────────────────────────────────
 *  ErrorBoundary — top-level React error boundary so an
 *  uncaught render error produces a recoverable fallback UI
 *  instead of a blank white page.
 *
 *  The fallback deliberately avoids any store, crypto, or
 *  network call — it must work even if those modules are
 *  the ones that crashed.
 * ────────────────────────────────────────────────────────── */

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { createLogger } from '../utils/logger';

const log = createLogger('err-boundary');

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logger is silent in prod except .error — good for Sentry hookup later.
    log.error('render crash', error, info.componentStack);
  }

  private handleReload = () => {
    // Full reload is the safest recovery — store state and caches are rebuilt.
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        className="app-error-boundary"
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--dl-space-6, 24px)',
          gap: 'var(--dl-space-4, 16px)',
          background: 'var(--dl-bg-0, #0a0a0f)',
          color: 'var(--dl-text-0, #e6e6ef)',
          fontFamily: 'var(--dl-font-sans, system-ui, sans-serif)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 42, lineHeight: 1 }} aria-hidden="true">⚠️</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ margin: 0, maxWidth: 440, color: 'var(--dl-text-2, #9a9aae)', fontSize: 14 }}>
          Ridgeline hit an unexpected error. Try dismissing this message. If it keeps
          happening, reload the app.
        </p>
        <pre
          style={{
            maxWidth: '100%',
            maxHeight: 160,
            overflow: 'auto',
            padding: 'var(--dl-space-3, 12px)',
            background: 'var(--dl-bg-1, #14141c)',
            border: '1px solid var(--dl-border-0, #23232f)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--dl-danger, #ff5b6b)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {this.state.error.message || String(this.state.error)}
        </pre>
        <div style={{ display: 'flex', gap: 'var(--dl-space-3, 12px)' }}>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: '1px solid var(--dl-border-0, #23232f)',
              background: 'transparent',
              color: 'var(--dl-text-0, #e6e6ef)',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--dl-accent, #7c6cff)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
