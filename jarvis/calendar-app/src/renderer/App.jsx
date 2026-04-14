import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import WeekView from './components/WeekView';
import DayView from './components/DayView';
import MonthView from './components/MonthView';
import YearView from './components/YearView';
import EventModal from './components/EventModal';
import EventPopover from './components/EventPopover';
import { useCalendar } from './hooks/useCalendar';
import { useEvents } from './hooks/useEvents';
import { syncFromNova, checkNovaConnection } from './hooks/useNova';
import { toISODate } from './utils/dateHelpers';

export default function App() {
  const calendar = useCalendar();
  const {
    events,
    calendars,
    createEvent,
    updateEvent,
    deleteEvent,
    toggleCalendar,
    getVisibleEvents,
    loadEvents,
  } = useEvents();

  const [modalState, setModalState] = useState(null); // null | { mode: 'create'|'edit', event }
  const [popoverState, setPopoverState] = useState(null); // null | { event, position }
  const [novaConnected, setNovaConnected] = useState(false);

  // Check Nova connection on startup and sync
  useEffect(() => {
    (async () => {
      const connected = await checkNovaConnection();
      setNovaConnected(connected);
      if (connected) {
        const { events: novaEvents } = await syncFromNova(30);
        if (novaEvents.length > 0) {
          const api = window.electronAPI;
          if (api) {
            // Merge Nova events into local store (don't overwrite local events)
            const existing = await api.getAll();
            const existingIds = new Set(existing.map((e) => e.id));
            const newEvents = novaEvents.filter((e) => !existingIds.has(e.id));
            if (newEvents.length > 0) {
              await api.bulkSave(newEvents);
              loadEvents();
            }
          }
        }
      }
    })();
  }, [loadEvents]);

  // Periodically re-sync with Nova every 5 minutes
  useEffect(() => {
    const interval = setInterval(async () => {
      const connected = await checkNovaConnection();
      setNovaConnected(connected);
    }, 300000);
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (modalState || popoverState) return;

      switch (e.key) {
        case 'c':
        case 'n':
          setModalState({
            mode: 'create',
            event: { date: toISODate(calendar.currentDate), startTime: '09:00', endTime: '10:00' },
          });
          break;
        case 't':
          calendar.goToday();
          break;
        case '1':
          calendar.setView('day');
          break;
        case '2':
          calendar.setView('week');
          break;
        case '3':
          calendar.setView('month');
          break;
        case '4':
          calendar.setView('year');
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [calendar, modalState, popoverState]);

  const visibleEvents = getVisibleEvents(calendar.searchQuery);

  // Event handlers
  const handleNewEvent = useCallback(() => {
    setPopoverState(null);
    setModalState({
      mode: 'create',
      event: { date: toISODate(calendar.currentDate), startTime: '09:00', endTime: '10:00' },
    });
  }, [calendar.currentDate]);

  const handleSlotClick = useCallback((slotData) => {
    setPopoverState(null);
    setModalState({ mode: 'create', event: slotData });
  }, []);

  const handleEventClick = useCallback((event, mouseEvent) => {
    setModalState(null);
    setPopoverState({
      event,
      position: { x: mouseEvent.clientX, y: mouseEvent.clientY },
    });
  }, []);

  const handleEditFromPopover = useCallback((event) => {
    setPopoverState(null);
    setModalState({ mode: 'edit', event });
  }, []);

  const handleSaveEvent = useCallback(
    async (eventData) => {
      if (modalState?.mode === 'edit') {
        await updateEvent(eventData);
      } else {
        await createEvent(eventData);
      }
      setModalState(null);
    },
    [modalState, createEvent, updateEvent]
  );

  const handleDeleteEvent = useCallback(
    async (id) => {
      await deleteEvent(id);
      setModalState(null);
      setPopoverState(null);
    },
    [deleteEvent]
  );

  const handleEventUpdate = useCallback(
    async (event) => {
      await updateEvent(event);
    },
    [updateEvent]
  );

  const handleSelectDate = useCallback(
    (date) => {
      calendar.goToDate(date);
      if (calendar.view === 'year') {
        calendar.setView('month');
      }
    },
    [calendar]
  );

  // Render the active view
  const renderView = () => {
    const viewProps = {
      currentDate: calendar.currentDate,
      events: visibleEvents,
      onEventClick: handleEventClick,
      onSlotClick: handleSlotClick,
      onEventUpdate: handleEventUpdate,
    };

    switch (calendar.view) {
      case 'day':
        return <DayView {...viewProps} />;
      case 'week':
        return <WeekView {...viewProps} />;
      case 'month':
        return <MonthView {...viewProps} />;
      case 'year':
        return <YearView currentDate={calendar.currentDate} onSelectDate={handleSelectDate} />;
      default:
        return <WeekView {...viewProps} />;
    }
  };

  return (
    <div className="flex h-screen bg-white font-sans">
      {/* Sidebar */}
      <Sidebar
        currentDate={calendar.currentDate}
        calendars={calendars}
        onSelectDate={handleSelectDate}
        onToggleCalendar={toggleCalendar}
        onNewEvent={handleNewEvent}
      />

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">
        <Toolbar
          currentDate={calendar.currentDate}
          view={calendar.view}
          searchQuery={calendar.searchQuery}
          onToday={calendar.goToday}
          onBack={calendar.goBack}
          onForward={calendar.goForward}
          onViewChange={calendar.setView}
          onSearchChange={calendar.setSearchQuery}
        />

        {/* Calendar view */}
        <div className="flex-1 overflow-hidden">{renderView()}</div>
      </div>

      {/* Event popover */}
      {popoverState && (
        <EventPopover
          event={popoverState.event}
          position={popoverState.position}
          onEdit={handleEditFromPopover}
          onDelete={handleDeleteEvent}
          onClose={() => setPopoverState(null)}
        />
      )}

      {/* Event modal */}
      {modalState && (
        <EventModal
          event={modalState.event}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}
