import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchCapabilities, fetchEvents, fetchStatus } from '../ipc';
import { CapabilityMap, EventEntry, ServiceStatus } from '../types';

export type ServiceContextState = {
  status: ServiceStatus | null;
  capabilities: CapabilityMap;
  events: EventEntry[];
  serviceAvailable: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
};

const defaultCapabilities: CapabilityMap = {
  updates: false,
  events: false,
  scans: false,
  deviceControl: false,
  connectedMode: false,
};

const ServiceContext = createContext<ServiceContextState | undefined>(undefined);

export const ServiceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityMap>(defaultCapabilities);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [serviceAvailable, setServiceAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastEventSeqRef = useRef<number>(0);
  const notificationsRequested = useRef(false);

  // Request notification permission on mount
  useEffect(() => {
    if (!notificationsRequested.current && 'Notification' in window) {
      notificationsRequested.current = true;
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, []);

  const sendNotification = (title: string, body: string, urgency: 'critical' | 'warning' | 'info') => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, {
          body,
          icon: '/icons/icon.png',
          tag: `darklock-${urgency}-${Date.now()}`,
          requireInteraction: urgency === 'critical',
        });
        if (urgency === 'critical') {
          setTimeout(() => n.close(), 10000);
        } else {
          setTimeout(() => n.close(), 5000);
        }
      } catch (e) {
        console.warn('Notification failed:', e);
      }
    }
  };

  console.log('🔵 ServiceProvider: Initializing');

  const refresh = async () => {
    console.log('🔵 ServiceProvider: Refreshing status');
    try {
      const st = await fetchStatus();
      console.log('✅ ServiceProvider: Got status and capabilities', { st });
      setStatus(st);
      // capabilities live inside the status response — no separate call needed
      if (st.capabilities) {
        setCapabilities(st.capabilities);
      }
      setServiceAvailable(true);
      setError(null);
    } catch (e) {
      console.error('❌ ServiceProvider: Error fetching status', e);
      setServiceAvailable(false);
      setStatus(null);
      setCapabilities(defaultCapabilities);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 1000); // poll every 1s per requirement
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!serviceAvailable) return;
    const loadEvents = async () => {
      try {
        const res = await fetchEvents();
        if (res && res.events) {
          // Check for new critical events since last check
          const newEvents = res.events.filter(
            (e: EventEntry) => (e.seq || 0) > lastEventSeqRef.current
          );
          
          for (const evt of newEvents) {
            const evType = (evt.event_type || '').toUpperCase();
            const sev = (evt.severity || '').toUpperCase();
            
            if (evType.includes('TAMPER')) {
              const path = (evt.data as any)?.path || 'Unknown file';
              const kind = (evt.data as any)?.kind || 'unknown';
              sendNotification(
                '\u26a0\ufe0f TAMPER DETECTED',
                `File ${kind}: ${path}`,
                'critical'
              );
            } else if (evType.includes('UNAUTHORIZED') || evType.includes('INTRUSION')) {
              const path = (evt.data as any)?.path || 'Unknown file';
              sendNotification(
                '\ud83d\udea8 UNAUTHORIZED FILE',
                `Suspicious file detected: ${path}`,
                'critical'
              );
            } else if (evType.includes('RESTORE_SUCCESS')) {
              const path = (evt.data as any)?.path || 'Unknown file';
              sendNotification(
                '\u2705 File Restored',
                `Successfully restored: ${path}`,
                'warning'
              );
            } else if (evType.includes('QUARANTINE')) {
              const path = (evt.data as any)?.path || 'Unknown file';
              sendNotification(
                '\ud83d\udd12 File Quarantined',
                `Suspicious file quarantined: ${path}`,
                'warning'
              );
            }
          }
          
          // Update last seen seq
          const maxSeq = res.events.reduce((max: number, e: EventEntry) => Math.max(max, e.seq || 0), 0);
          if (maxSeq > lastEventSeqRef.current) {
            lastEventSeqRef.current = maxSeq;
          }
          
          setEvents(res.events);
        }
      } catch (e) {
        console.warn('events fetch failed', e);
      }
    };
    void loadEvents();
    // Poll events every 3 seconds
    const iv = setInterval(() => void loadEvents(), 3000);
    return () => clearInterval(iv);
  }, [serviceAvailable]);

  const value = useMemo<ServiceContextState>(() => ({
    status,
    capabilities: capabilities || defaultCapabilities,
    events,
    serviceAvailable,
    loading,
    refresh,
  }), [status, capabilities, events, serviceAvailable, loading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-app text-text-primary">
        <div className="text-center space-y-4">
          <div className="text-4xl">🔐</div>
          <div className="text-xl font-semibold">Darklock Guard</div>
          <div className="text-text-muted">Connecting to service...</div>
          {error && (
            <div className="mt-4 p-4 bg-red-900/20 border border-red-500 rounded text-red-400 text-sm max-w-md">
              <div className="font-semibold">Error:</div>
              <div className="mt-1">{error}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <ServiceContext.Provider value={value}>{children}</ServiceContext.Provider>;
};

export const useService = (): ServiceContextState => {
  const ctx = useContext(ServiceContext);
  if (!ctx) throw new Error('useService must be used within ServiceProvider');
  return ctx;
};
