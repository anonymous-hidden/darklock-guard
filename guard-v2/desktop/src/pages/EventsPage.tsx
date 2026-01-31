import React from 'react';
import { useService } from '../state/service';

const EventsPage: React.FC = () => {
  const { events, capabilities, serviceAvailable } = useService();
  const disabled = !serviceAvailable || !capabilities.events;

  return (
    <div className="p-6 space-y-4">
      {disabled && (
        <div className="bg-[rgba(148,163,184,0.1)] border border-[rgba(148,163,184,0.2)] text-text-secondary rounded-lg p-3 text-sm">
          Event stream unavailable. {serviceAvailable ? 'Service has not exposed events yet.' : 'Service unreachable.'}
        </div>
      )}
      {!disabled && (
        <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4">
          <div className="text-sm text-text-primary mb-3">Event Log</div>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto">
            {events.length === 0 && <div className="text-text-muted text-sm">No events yet.</div>}
            {events.map((evt, idx) => (
              <div key={`${evt.timestamp}-${idx}`} className="border border-[rgba(148,163,184,0.1)] rounded-md p-3">
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span>{evt.timestamp}</span>
                  <span className={evt.severity === 'error' ? 'text-semantic-error' : evt.severity === 'warning' ? 'text-semantic-warning' : 'text-accent-primary'}>
                    {evt.severity}
                  </span>
                </div>
                <div className="text-sm text-text-primary mt-1">{evt.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EventsPage;
