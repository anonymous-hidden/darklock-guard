import React, { useState } from 'react';
import { useService } from '../state/service';
import { triggerScan } from '../ipc';

const ScansPage: React.FC = () => {
  const { serviceAvailable, capabilities } = useService();
  const [message, setMessage] = useState<string>('');

  const disabled = !serviceAvailable || !capabilities.scans;
  const reason = !serviceAvailable ? 'Service unavailable' : 'Scan engine not exposed by service yet';

  const startScan = async (kind: 'quick' | 'full' | 'custom') => {
    if (disabled) return;
    try {
      const res = await triggerScan(kind);
      if (res.accepted) setMessage(`Started ${kind} scan`);
      else setMessage('Scan request rejected');
    } catch (e) {
      setMessage('Scan failed: ' + (e as Error).message);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4">
        <div className="text-sm text-text-primary mb-2">Scans</div>
        <div className="flex gap-2">
          {['quick', 'full', 'custom'].map((kind) => (
            <button
              key={kind}
              onClick={() => startScan(kind as 'quick' | 'full' | 'custom')}
              disabled={disabled}
              title={disabled ? reason : ''}
              className={`px-3 py-2 rounded-md text-sm border ${disabled ? 'border-text-muted text-text-muted cursor-not-allowed' : 'border-accent-primary text-accent-primary hover:bg-[rgba(0,240,255,0.1)]'}`}
            >
              {kind === 'custom' ? 'Custom' : kind[0].toUpperCase() + kind.slice(1)} Scan
            </button>
          ))}
        </div>
        <div className="text-xs text-text-muted mt-2">Scans will remain disabled until the service exposes a scan endpoint.</div>
        {message && <div className="text-sm text-text-secondary mt-3">{message}</div>}
      </div>
    </div>
  );
};

export default ScansPage;
