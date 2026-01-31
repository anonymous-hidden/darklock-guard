import React from 'react';
import { useService } from '../state/service';

const safeModeReasonLabel = (reason?: string): string => {
  switch (reason) {
    case 'REMOTE_COMMAND': return 'Triggered remotely';
    case 'MANUAL': return 'Manual entry';
    case 'SERVICE_CRASH_LOOP': return 'Crash loop detected';
    case 'VAULT_CORRUPT': return 'Vault corruption';
    case 'CRYPTO_ERROR': return 'Crypto error';
    case 'INTEGRITY_FAILURE': return 'Integrity failure';
    case 'IPC_FAILURE': return 'IPC failure';
    default: return reason || 'Unknown';
  }
};

const Card: React.FC<{ title: string; value: string; tone?: 'ok' | 'warn' | 'error' } & React.PropsWithChildren> = ({ title, value, tone = 'ok', children }) => {
  const toneClass = tone === 'ok' ? 'text-semantic-success' : tone === 'warn' ? 'text-semantic-warning' : 'text-semantic-error';
  return (
    <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4 shadow-md">
      <div className="text-sm text-text-muted">{title}</div>
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      {children}
    </div>
  );
};

const StatusPage: React.FC = () => {
  const { status, serviceAvailable } = useService();

  if (!serviceAvailable) {
    return (
      <div className="p-6 space-y-4">
        <div className="bg-[rgba(239,68,68,0.1)] border border-semantic-error text-semantic-error rounded-lg p-4">
          Service Unavailable. Cannot communicate with Darklock Guard service.
        </div>
      </div>
    );
  }

  const isSafeMode = status?.mode === 'safemode';
  const isRemoteSafeMode = isSafeMode && status?.safeModeReason === 'REMOTE_COMMAND';

  return (
    <div className="p-6 space-y-6">
      {isSafeMode && (
        <div className={`rounded-lg p-4 ${isRemoteSafeMode ? 'bg-[rgba(249,115,22,0.15)] border border-orange-500/50' : 'bg-[rgba(245,158,11,0.1)] border border-semantic-warning'}`}>
          <div className="flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            <span className={`font-semibold ${isRemoteSafeMode ? 'text-orange-400' : 'text-semantic-warning'}`}>
              SAFE MODE {isRemoteSafeMode && '(Remote)'}
            </span>
          </div>
          <div className="text-sm text-text-secondary mt-1">
            Protection is disabled. {safeModeReasonLabel(status?.safeModeReason)}.
            {isRemoteSafeMode && ' A remote command triggered this mode.'}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Protection" value={status?.ok ? 'Protected' : 'Degraded'} tone={status?.ok ? 'ok' : 'warn'} />
        <Card title="Mode" value={status?.mode === 'zerotrust' ? 'Zero-Trust' : status?.mode === 'safemode' ? 'Safe Mode' : 'Standard'} tone={status?.mode === 'safemode' ? 'warn' : 'ok'}>
          {status?.safeModeReason && <div className="text-sm text-text-secondary">{safeModeReasonLabel(status?.safeModeReason)}</div>}
        </Card>
        <Card title="Version" value={status?.version ?? 'n/a'} />
      </div>
      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4">
        <div className="text-sm text-text-secondary">Recent activity will appear here once events are available.</div>
      </div>
    </div>
  );
};

export default StatusPage;
