import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { sendCrashReport } from './ipc';
import './index.css';

console.log('🔵 main.tsx: Starting Darklock Guard UI');

// Global error handler — sends anonymous crash reports
window.addEventListener('error', (event) => {
  sendCrashReport({
    type: 'crash',
    description: event.message || 'Unhandled error',
    stack_trace: event.error?.stack || '',
    app_version: 'v2.0.0',
    platform: navigator.platform,
    error_code: 'UNHANDLED_ERROR',
  }).catch(() => {}); // Best effort
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  sendCrashReport({
    type: 'crash',
    description: reason?.message || String(reason) || 'Unhandled promise rejection',
    stack_trace: reason?.stack || '',
    app_version: 'v2.0.0',
    platform: navigator.platform,
    error_code: 'UNHANDLED_REJECTION',
  }).catch(() => {});
});

// Error boundary
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('❌ React Error Boundary caught error:', error, errorInfo);
    sendCrashReport({
      type: 'crash',
      description: error?.message || 'React rendering error',
      stack_trace: `${error?.stack || ''}\n\nComponent Stack:${errorInfo?.componentStack || ''}`,
      app_version: 'v2.0.0',
      platform: navigator.platform,
      error_code: 'REACT_ERROR_BOUNDARY',
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: '#ef4444', background: '#0a0e17' }}>
          <h1>❌ Application Error</h1>
          <pre style={{ color: '#94a3b8', marginTop: '1rem' }}>
            {this.state.error?.toString()}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) {
  console.error('❌ Root element not found!');
} else {
  console.log('✅ Root element found, mounting React');
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>
  );
  console.log('✅ React render called');
}
