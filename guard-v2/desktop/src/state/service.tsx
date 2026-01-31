import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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

  const refresh = async () => {
    try {
      const [st, caps] = await Promise.all([fetchStatus(), fetchCapabilities()]);
      setStatus(st);
      setCapabilities(caps.capabilities);
      setServiceAvailable(true);
    } catch (e) {
      console.error('service status error', e);
      setServiceAvailable(false);
      setStatus(null);
      setCapabilities(defaultCapabilities);
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
    if (!serviceAvailable || !capabilities.events) return;
    const loadEvents = async () => {
      try {
        const res = await fetchEvents();
        setEvents(res.events);
      } catch (e) {
        console.warn('events fetch failed', e);
      }
    };
    void loadEvents();
  }, [serviceAvailable, capabilities.events, status?.mode]);

  const value = useMemo<ServiceContextState>(() => ({
    status,
    capabilities,
    events,
    serviceAvailable,
    loading,
    refresh,
  }), [status, capabilities, events, serviceAvailable, loading]);

  return <ServiceContext.Provider value={value}>{children}</ServiceContext.Provider>;
};

export const useService = (): ServiceContextState => {
  const ctx = useContext(ServiceContext);
  if (!ctx) throw new Error('useService must be used within ServiceProvider');
  return ctx;
};
