import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { pushAllToNova } from './useNova';

// Fallback storage for when Electron API is not available (dev in browser)
const memoryStore = { events: [] };
const fallbackAPI = {
  getAll: () => Promise.resolve(memoryStore.events),
  save: (event) => {
    const idx = memoryStore.events.findIndex((e) => e.id === event.id);
    if (idx >= 0) memoryStore.events[idx] = event;
    else memoryStore.events.push(event);
    return Promise.resolve(event);
  },
  delete: (id) => {
    memoryStore.events = memoryStore.events.filter((e) => e.id !== id);
    return Promise.resolve(true);
  },
};

function getAPI() {
  return window.electronAPI || fallbackAPI;
}

export function useEvents() {
  const [events, setEvents] = useState([]);
  const [calendars, setCalendars] = useState({
    personal: { name: 'Personal', color: 'blue', visible: true },
    work: { name: 'Work', color: 'green', visible: true },
    family: { name: 'Family', color: 'orange', visible: true },
    holidays: { name: 'Holidays', color: 'purple', visible: true },
    birthdays: { name: 'Birthdays', color: 'red', visible: true },
  });

  const loadEvents = useCallback(async () => {
    const api = getAPI();
    const data = await api.getAll();
    setEvents(data);
    // Push all local events to Nova so the AI always has current data
    pushAllToNova(data).catch(() => {});
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const syncAfterChange = useCallback(async () => {
    const api = getAPI();
    const all = await api.getAll();
    pushAllToNova(all).catch(() => {});
  }, []);

  const createEvent = useCallback(async (eventData) => {
    const api = getAPI();
    const event = {
      id: uuidv4(),
      title: '',
      date: '',
      startTime: '09:00',
      endTime: '10:00',
      allDay: false,
      color: 'blue',
      calendar: 'personal',
      description: '',
      recurrence: 'none',
      ...eventData,
    };
    await api.save(event);
    setEvents((prev) => [...prev, event]);
    syncAfterChange();
    return event;
  }, [syncAfterChange]);

  const updateEvent = useCallback(async (event) => {
    const api = getAPI();
    await api.save(event);
    setEvents((prev) => prev.map((e) => (e.id === event.id ? event : e)));
    syncAfterChange();
    return event;
  }, [syncAfterChange]);

  const deleteEvent = useCallback(async (id) => {
    const api = getAPI();
    await api.delete(id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
    syncAfterChange();
  }, [syncAfterChange]);

  const toggleCalendar = useCallback((calKey) => {
    setCalendars((prev) => ({
      ...prev,
      [calKey]: { ...prev[calKey], visible: !prev[calKey].visible },
    }));
  }, []);

  // Filter events by visible calendars and search
  const getVisibleEvents = useCallback(
    (searchQuery = '') => {
      return events.filter((e) => {
        if (!calendars[e.calendar]?.visible) return false;
        if (searchQuery && !e.title.toLowerCase().includes(searchQuery.toLowerCase()))
          return false;
        return true;
      });
    },
    [events, calendars]
  );

  return {
    events,
    calendars,
    createEvent,
    updateEvent,
    deleteEvent,
    toggleCalendar,
    getVisibleEvents,
    loadEvents,
  };
}
