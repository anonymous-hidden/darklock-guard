import React from 'react';
import { useNovaStore } from '../../store/novaStore';

function AlertItem({ alert, onAck }) {
  const severityColors = {
    critical: 'border-danger bg-danger/10',
    high: 'border-warning bg-warning/10',
    medium: 'border-accent bg-accent/10',
    low: 'border-text-muted bg-bg-primary',
    info: 'border-text-muted bg-bg-primary',
  };

  const severity = alert.severity || alert.level || 'info';
  const time = alert.timestamp ? new Date(alert.timestamp).toLocaleString() : '';

  return (
    <div className={`p-3 rounded-lg border-l-2 ${severityColors[severity] || severityColors.info}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-text-primary">
            {alert.title || alert.type || alert.event || 'Alert'}
          </div>
          <div className="text-[11px] text-text-secondary mt-0.5">
            {alert.message || alert.detail || alert.description || JSON.stringify(alert)}
          </div>
          {time && <div className="text-[10px] text-text-muted mt-1">{time}</div>}
        </div>
        {!alert.acknowledged && onAck && (
          <button
            onClick={() => onAck(alert.id)}
            className="text-[10px] px-2 py-1 bg-bg-hover rounded text-text-muted hover:text-text-primary shrink-0"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

export default function SecurityPanel() {
  const alerts = useNovaStore(s => s.alerts);
  const unreadAlerts = useNovaStore(s => s.unreadAlerts);
  const securityStatus = useNovaStore(s => s.securityStatus);
  const auditLog = useNovaStore(s => s.auditLog);
  const ackAllAlerts = useNovaStore(s => s.ackAllAlerts);
  const refreshSecurity = useNovaStore(s => s.refreshSecurity);
  const refreshAlerts = useNovaStore(s => s.refreshAlerts);
  const rescanIntegrity = useNovaStore(s => s.rescanIntegrity);

  const processWatcher = securityStatus?.process_watcher;
  const integrity = securityStatus?.integrity;

  return (
    <div className="bg-bg-secondary rounded-xl border border-border flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <span>🛡️</span> Security & Alerts
          {unreadAlerts > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-danger rounded-full text-white font-bold">
              {unreadAlerts}
            </span>
          )}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={rescanIntegrity}
            className="text-[10px] px-2 py-1 bg-bg-hover rounded text-text-muted hover:text-text-primary"
          >Rescan</button>
          <button
            onClick={refreshSecurity}
            className="text-xs text-text-muted hover:text-text-primary"
          >↻</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0">
        {/* Security Status */}
        <div>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">System Status</div>
          <div className="grid grid-cols-2 gap-2">
            <div className={`p-2 rounded-lg border text-center ${
              processWatcher?.healthy !== false ? 'border-success/30 bg-success/10' : 'border-danger/30 bg-danger/10'
            }`}>
              <div className="text-lg">{processWatcher?.healthy !== false ? '✅' : '⚠️'}</div>
              <div className="text-[10px] text-text-muted mt-1">Process Watcher</div>
            </div>
            <div className={`p-2 rounded-lg border text-center ${
              integrity?.clean !== false ? 'border-success/30 bg-success/10' : 'border-danger/30 bg-danger/10'
            }`}>
              <div className="text-lg">{integrity?.clean !== false ? '✅' : '⚠️'}</div>
              <div className="text-[10px] text-text-muted mt-1">File Integrity</div>
            </div>
          </div>
        </div>

        {/* Alerts */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Alerts ({alerts.length})
            </div>
            {unreadAlerts > 0 && (
              <button
                onClick={ackAllAlerts}
                className="text-[10px] px-2 py-1 bg-accent/20 rounded text-accent hover:bg-accent/30"
              >Dismiss All</button>
            )}
          </div>
          <div className="space-y-2">
            {alerts.length === 0 ? (
              <div className="text-text-muted text-xs text-center py-4">
                All clear — no alerts
              </div>
            ) : (
              alerts.slice(0, 20).map((alert, i) => (
                <AlertItem key={alert.id || i} alert={alert} />
              ))
            )}
          </div>
        </div>

        {/* Audit Log */}
        <div>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
            Recent Audit Log
          </div>
          <div className="space-y-1">
            {auditLog.length === 0 ? (
              <div className="text-text-muted text-xs text-center py-2">No audit entries</div>
            ) : (
              auditLog.slice(0, 15).map((entry, i) => (
                <div key={i} className="text-[10px] text-text-muted py-0.5 px-2 bg-bg-primary rounded font-mono">
                  <span className="text-text-secondary">{entry.source || entry.type || '?'}</span>
                  <span className="mx-1">·</span>
                  <span>{entry.event || entry.action || entry.message || JSON.stringify(entry).slice(0, 80)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
