import React, { useState } from 'react';
import { useService } from '../state/service';
import { updateCheck, updateInstall, updateRollback } from '../ipc';

const UpdatesPage: React.FC = () => {
  const { capabilities, serviceAvailable } = useService();
  const [message, setMessage] = useState('');
  const disabled = !serviceAvailable || !capabilities.updates;

  const check = async () => {
    if (disabled) return;
    try {
      const res = await updateCheck();
      setMessage(res.available ? `Update ${res.version ?? ''} available` : 'Up to date');
    } catch (e) {
      setMessage('Update check failed: ' + (e as Error).message);
    }
  };

  const install = async () => {
    if (disabled) return;
    try {
      const res = await updateInstall();
      setMessage(res.ok ? 'Update install started' : 'Update install rejected');
    } catch (e) {
      setMessage('Install failed: ' + (e as Error).message);
    }
  };

  const rollback = async () => {
    const manifest = window.prompt('Backup manifest path');
    if (!manifest) return;
    try {
      const res = await updateRollback(manifest);
      setMessage(res.ok ? 'Rollback started' : 'Rollback rejected');
    } catch (e) {
      setMessage('Rollback failed: ' + (e as Error).message);
    }
  };

  return (
    <div className="p-6 space-y-4">
      {!serviceAvailable && (
        <div className="bg-[rgba(239,68,68,0.1)] border border-semantic-error text-semantic-error rounded-lg p-3 text-sm">
          Service Unavailable. Cannot check for updates.
        </div>
      )}
      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4 space-y-3">
        <div className="text-sm text-text-primary">Updates</div>
        <div className="flex gap-2">
          <button
            onClick={check}
            disabled={disabled}
            className={`px-3 py-2 rounded-md text-sm border ${disabled ? 'border-text-muted text-text-muted cursor-not-allowed' : 'border-accent-primary text-accent-primary hover:bg-[rgba(0,240,255,0.1)]'}`}
            title={disabled ? 'Updates not exposed by service' : ''}
          >
            Check Now
          </button>
          <button
            onClick={install}
            disabled={disabled}
            className={`px-3 py-2 rounded-md text-sm border ${disabled ? 'border-text-muted text-text-muted cursor-not-allowed' : 'border-semantic-success text-semantic-success hover:bg-[rgba(16,185,129,0.1)]'}`}
            title={disabled ? 'Updates not exposed by service' : ''}
          >
            Download & Install
          </button>
          <button
            onClick={rollback}
            disabled={disabled}
            className={`px-3 py-2 rounded-md text-sm border ${disabled ? 'border-text-muted text-text-muted cursor-not-allowed' : 'border-semantic-warning text-semantic-warning hover:bg-[rgba(245,158,11,0.1)]'}`}
            title={disabled ? 'Rollback not available' : ''}
          >
            Rollback
          </button>
        </div>
        <div className="text-xs text-text-muted">Buttons stay disabled until service exposes update endpoints.</div>
        {message && <div className="text-sm text-text-secondary">{message}</div>}
      </div>
    </div>
  );
};

export default UpdatesPage;
