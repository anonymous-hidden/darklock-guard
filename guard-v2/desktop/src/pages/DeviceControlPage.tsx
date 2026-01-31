import React from 'react';
import { useService } from '../state/service';

const DeviceControlPage: React.FC = () => {
  const { capabilities, serviceAvailable } = useService();
  const disabled = !serviceAvailable || !capabilities.deviceControl;

  return (
    <div className="p-6 space-y-4">
      <div className="bg-[rgba(148,163,184,0.1)] border border-[rgba(148,163,184,0.2)] text-text-secondary rounded-lg p-4 text-sm">
        Device Control is a planned feature. {disabled ? 'Not exposed by service yet.' : 'Limited preview.'}
      </div>
      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4">
        <div className="text-sm text-text-muted">USB devices will appear here when supported.</div>
      </div>
    </div>
  );
};

export default DeviceControlPage;
