import React from 'react';

const SupportPage: React.FC = () => {
  return (
    <div className="p-6 space-y-4">
      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4">
        <div className="text-sm text-text-primary">Support</div>
        <div className="text-xs text-text-muted">Links to docs, bug reports, and system info will go here.</div>
      </div>
      <div className="bg-[rgba(245,158,11,0.1)] border border-semantic-warning text-semantic-warning rounded-lg p-4 text-sm">
        Beta warning: Darklock Guard v2 is in active development.
      </div>
    </div>
  );
};

export default SupportPage;
