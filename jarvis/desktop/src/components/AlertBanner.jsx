import React from 'react';

const SEVERITY_ICONS = { critical: '●', warning: '▲', info: '○' };
const CATEGORY_LABELS = { security: 'Security', file: 'File', system: 'System', ai: 'AI' };

export default function AlertBanner({ alerts, onDismiss, onDismissAll }) {
  if (!alerts.length) return null;

  return (
    <div className="alert-banner">
      <div className="alert-banner-header">
        <span className="alert-banner-count">{alerts.length} alert{alerts.length > 1 ? 's' : ''}</span>
        {alerts.length > 1 && (
          <button className="alert-dismiss-all" onClick={onDismissAll}>Dismiss All</button>
        )}
      </div>
      <div className="alert-banner-list">
        {alerts.slice(-5).reverse().map(a => (
          <div key={a.id} className={`alert-item alert-${a.severity}`}>
            <span className="alert-icon">{SEVERITY_ICONS[a.severity] || '○'}</span>
            <div className="alert-body">
              <div className="alert-title">
                <span className="alert-category">{CATEGORY_LABELS[a.category] || a.category}</span>
                {a.title}
              </div>
              <div className="alert-message">{a.message}</div>
            </div>
            <button className="alert-dismiss" onClick={() => onDismiss(a.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
