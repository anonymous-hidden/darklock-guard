import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  format,
  isToday,
  getWeekDays,
  toISODate,
  HOURS,
  ROW_HEIGHT,
  formatHourLabel,
  nowMinutes,
  timeToMinutes,
  minutesToTime,
} from '../utils/dateHelpers';
import { layoutEventsForDay, getEventsForDate, getEventColor } from '../utils/eventHelpers';

export default function WeekView({
  currentDate,
  events,
  onEventClick,
  onSlotClick,
  onEventUpdate,
}) {
  const scrollRef = useRef(null);
  const [currentTimePos, setCurrentTimePos] = useState(nowMinutes());
  const [dragState, setDragState] = useState(null); // { event, type: 'move'|'resize', startY, origStartTime, origEndTime }

  const weekDays = getWeekDays(currentDate);

  // Scroll to 7 AM on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * ROW_HEIGHT;
    }
  }, []);

  // Update current time indicator every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTimePos(nowMinutes());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Handle slot click (create event)
  const handleSlotClick = (day, hour, e) => {
    if (dragState) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const yOffset = e.clientY - rect.top;
    const minutes = Math.floor(yOffset / (ROW_HEIGHT / 2)) * 30;
    const startMins = hour * 60 + minutes;
    onSlotClick({
      date: toISODate(day),
      startTime: minutesToTime(startMins),
      endTime: minutesToTime(startMins + 60),
    });
  };

  // Drag to move
  const handleDragStart = (event, type, e) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    setDragState({ event, type, startY, origStartTime: event.startTime, origEndTime: event.endTime });

    const handleMouseMove = (me) => {
      const deltaY = me.clientY - startY;
      const deltaMinutes = Math.round(deltaY / (ROW_HEIGHT / 60));
      const snapped = Math.round(deltaMinutes / 15) * 15;

      setDragState((prev) => {
        if (!prev) return null;
        if (type === 'move') {
          const origStart = timeToMinutes(prev.origStartTime);
          const origEnd = timeToMinutes(prev.origEndTime);
          const newStart = Math.max(0, Math.min(1410, origStart + snapped));
          const duration = origEnd - origStart;
          return {
            ...prev,
            tempStartTime: minutesToTime(newStart),
            tempEndTime: minutesToTime(newStart + duration),
          };
        } else {
          // resize
          const origEnd = timeToMinutes(prev.origEndTime);
          const origStart = timeToMinutes(prev.origStartTime);
          const newEnd = Math.max(origStart + 15, origEnd + snapped);
          return { ...prev, tempEndTime: minutesToTime(Math.min(1440, newEnd)) };
        }
      });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      setDragState((prev) => {
        if (!prev) return null;
        const updates = {};
        if (type === 'move' && prev.tempStartTime) {
          updates.startTime = prev.tempStartTime;
          updates.endTime = prev.tempEndTime;
        } else if (type === 'resize' && prev.tempEndTime) {
          updates.endTime = prev.tempEndTime;
        }
        if (Object.keys(updates).length > 0) {
          onEventUpdate({ ...prev.event, ...updates });
        }
        return null;
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const timeLineTop = (currentTimePos / 60) * ROW_HEIGHT;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Day headers */}
      <div className="flex border-b border-gray-200 flex-shrink-0">
        <div className="w-16 flex-shrink-0" /> {/* gutter for hour labels */}
        {weekDays.map((day) => {
          const today = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className="flex-1 text-center py-2 border-l border-gray-200"
            >
              <div className="text-xs text-gray-500 uppercase">
                {format(day, 'EEE')}
              </div>
              <div
                className={`text-2xl font-light mt-0.5 w-10 h-10 mx-auto flex items-center justify-center rounded-full ${
                  today ? 'bg-primary text-white' : 'text-gray-800'
                }`}
              >
                {format(day, 'd')}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden relative">
        <div className="flex" style={{ minHeight: 24 * ROW_HEIGHT }}>
          {/* Hour labels */}
          <div className="w-16 flex-shrink-0 relative">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 text-[10px] text-gray-400 -translate-y-1/2"
                style={{ top: hour * ROW_HEIGHT }}
              >
                {hour === 0 ? '' : formatHourLabel(hour)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day) => {
            const dateStr = toISODate(day);
            const dayEvents = getEventsForDate(events, dateStr);
            const positioned = layoutEventsForDay(dayEvents);
            const today = isToday(day);

            return (
              <div
                key={day.toISOString()}
                className={`flex-1 relative border-l border-gray-200 ${
                  today ? 'bg-blue-50/30' : ''
                }`}
              >
                {/* Hour grid lines */}
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="absolute w-full border-t border-gray-100 cursor-pointer"
                    style={{ top: hour * ROW_HEIGHT, height: ROW_HEIGHT }}
                    onClick={(e) => handleSlotClick(day, hour, e)}
                  />
                ))}

                {/* Events */}
                {positioned.map((ev) => {
                  const colors = getEventColor(ev);
                  const isDragging = dragState?.event?.id === ev.id;
                  const displayStart = isDragging && dragState.tempStartTime
                    ? timeToMinutes(dragState.tempStartTime)
                    : timeToMinutes(ev.startTime);
                  const displayEnd = isDragging && dragState.tempEndTime
                    ? timeToMinutes(dragState.tempEndTime)
                    : timeToMinutes(ev.endTime);
                  const top = (displayStart / 60) * ROW_HEIGHT;
                  const height = Math.max(((displayEnd - displayStart) / 60) * ROW_HEIGHT, 18);

                  return (
                    <div
                      key={ev.id}
                      className="absolute rounded cursor-pointer overflow-hidden select-none group"
                      style={{
                        top,
                        height,
                        left: `calc(${ev.left * 100}% + 2px)`,
                        width: `calc(${ev.width * 100}% - 4px)`,
                        backgroundColor: colors.bg,
                        borderLeft: `3px solid ${colors.border}`,
                        zIndex: isDragging ? 50 : 10,
                        opacity: isDragging ? 0.85 : 1,
                        transition: isDragging ? 'none' : 'opacity 0.1s',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isDragging) onEventClick(ev, e);
                      }}
                      onMouseDown={(e) => handleDragStart(ev, 'move', e)}
                    >
                      <div className="px-1.5 py-0.5 text-xs font-medium truncate" style={{ color: colors.text }}>
                        {ev.title || '(No title)'}
                      </div>
                      {height > 30 && (
                        <div className="px-1.5 text-[10px] opacity-75" style={{ color: colors.text }}>
                          {formatTimeRange(ev.startTime, ev.endTime)}
                        </div>
                      )}
                      {/* Resize handle */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize opacity-0 group-hover:opacity-100"
                        onMouseDown={(e) => handleDragStart(ev, 'resize', e)}
                      />
                    </div>
                  );
                })}

                {/* All-day events at top */}
                {dayEvents
                  .filter((e) => e.allDay)
                  .map((ev, i) => {
                    const colors = getEventColor(ev);
                    return (
                      <div
                        key={ev.id}
                        className="absolute left-1 right-1 rounded px-1.5 py-0.5 text-xs font-medium cursor-pointer truncate"
                        style={{
                          top: i * 22,
                          backgroundColor: colors.bg,
                          color: colors.text,
                          zIndex: 5,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(ev, e);
                        }}
                      >
                        {ev.title || '(No title)'}
                      </div>
                    );
                  })}

                {/* Current time indicator */}
                {today && (
                  <div
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: timeLineTop }}
                  >
                    <div className="flex items-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1" />
                      <div className="flex-1 h-[2px] bg-red-500" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatTimeRange(start, end) {
  const format12 = (t) => {
    const [h, m] = t.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
  };
  return `${format12(start)} – ${format12(end)}`;
}
