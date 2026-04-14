import React, { useRef, useEffect, useState } from 'react';
import {
  format,
  isToday,
  toISODate,
  HOURS,
  ROW_HEIGHT,
  formatHourLabel,
  nowMinutes,
  timeToMinutes,
  minutesToTime,
} from '../utils/dateHelpers';
import { layoutEventsForDay, getEventsForDate, getEventColor } from '../utils/eventHelpers';

export default function DayView({ currentDate, events, onEventClick, onSlotClick, onEventUpdate }) {
  const scrollRef = useRef(null);
  const [currentTimePos, setCurrentTimePos] = useState(nowMinutes());
  const [dragState, setDragState] = useState(null);
  const today = isToday(currentDate);
  const dateStr = toISODate(currentDate);
  const dayEvents = getEventsForDate(events, dateStr);
  const positioned = layoutEventsForDay(dayEvents);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * ROW_HEIGHT;
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTimePos(nowMinutes()), 60000);
    return () => clearInterval(interval);
  }, []);

  const handleSlotClick = (hour, e) => {
    if (dragState) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const yOff = e.clientY - rect.top;
    const mins = Math.floor(yOff / (ROW_HEIGHT / 2)) * 30;
    const startMins = hour * 60 + mins;
    onSlotClick({
      date: dateStr,
      startTime: minutesToTime(startMins),
      endTime: minutesToTime(startMins + 60),
    });
  };

  const handleDragStart = (event, type, e) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    setDragState({ event, type, startY, origStartTime: event.startTime, origEndTime: event.endTime });

    const onMove = (me) => {
      const deltaY = me.clientY - startY;
      const deltaMins = Math.round(deltaY / (ROW_HEIGHT / 60));
      const snapped = Math.round(deltaMins / 15) * 15;
      setDragState((prev) => {
        if (!prev) return null;
        if (type === 'move') {
          const oS = timeToMinutes(prev.origStartTime);
          const oE = timeToMinutes(prev.origEndTime);
          const nS = Math.max(0, Math.min(1410, oS + snapped));
          return { ...prev, tempStartTime: minutesToTime(nS), tempEndTime: minutesToTime(nS + oE - oS) };
        }
        const oE = timeToMinutes(prev.origEndTime);
        const oS = timeToMinutes(prev.origStartTime);
        return { ...prev, tempEndTime: minutesToTime(Math.min(1440, Math.max(oS + 15, oE + snapped))) };
      });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setDragState((prev) => {
        if (!prev) return null;
        const updates = {};
        if (type === 'move' && prev.tempStartTime) {
          updates.startTime = prev.tempStartTime;
          updates.endTime = prev.tempEndTime;
        } else if (type === 'resize' && prev.tempEndTime) {
          updates.endTime = prev.tempEndTime;
        }
        if (Object.keys(updates).length) onEventUpdate({ ...prev.event, ...updates });
        return null;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const timeLineTop = (currentTimePos / 60) * ROW_HEIGHT;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex border-b border-gray-200 flex-shrink-0">
        <div className="w-16 flex-shrink-0" />
        <div className="flex-1 text-center py-2">
          <div className="text-xs text-gray-500 uppercase">{format(currentDate, 'EEEE')}</div>
          <div className={`text-2xl font-light mt-0.5 w-10 h-10 mx-auto flex items-center justify-center rounded-full ${today ? 'bg-primary text-white' : 'text-gray-800'}`}>
            {format(currentDate, 'd')}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden relative">
        <div className="flex" style={{ minHeight: 24 * ROW_HEIGHT }}>
          <div className="w-16 flex-shrink-0 relative">
            {HOURS.map((h) => (
              <div key={h} className="absolute right-2 text-[10px] text-gray-400 -translate-y-1/2" style={{ top: h * ROW_HEIGHT }}>
                {h === 0 ? '' : formatHourLabel(h)}
              </div>
            ))}
          </div>

          <div className={`flex-1 relative border-l border-gray-200 ${today ? 'bg-blue-50/30' : ''}`}>
            {HOURS.map((h) => (
              <div key={h} className="absolute w-full border-t border-gray-100 cursor-pointer" style={{ top: h * ROW_HEIGHT, height: ROW_HEIGHT }} onClick={(e) => handleSlotClick(h, e)} />
            ))}

            {positioned.map((ev) => {
              const colors = getEventColor(ev);
              const isDragging = dragState?.event?.id === ev.id;
              const dStart = isDragging && dragState.tempStartTime ? timeToMinutes(dragState.tempStartTime) : timeToMinutes(ev.startTime);
              const dEnd = isDragging && dragState.tempEndTime ? timeToMinutes(dragState.tempEndTime) : timeToMinutes(ev.endTime);
              const top = (dStart / 60) * ROW_HEIGHT;
              const height = Math.max(((dEnd - dStart) / 60) * ROW_HEIGHT, 18);

              return (
                <div key={ev.id} className="absolute rounded cursor-pointer overflow-hidden select-none group" style={{
                  top, height,
                  left: `calc(${ev.left * 100}% + 2px)`,
                  width: `calc(${ev.width * 100}% - 4px)`,
                  backgroundColor: colors.bg,
                  borderLeft: `3px solid ${colors.border}`,
                  zIndex: isDragging ? 50 : 10,
                  opacity: isDragging ? 0.85 : 1,
                }} onClick={(e) => { e.stopPropagation(); if (!isDragging) onEventClick(ev, e); }} onMouseDown={(e) => handleDragStart(ev, 'move', e)}>
                  <div className="px-1.5 py-0.5 text-xs font-medium truncate" style={{ color: colors.text }}>{ev.title || '(No title)'}</div>
                  {height > 30 && <div className="px-1.5 text-[10px] opacity-75" style={{ color: colors.text }}>{ev.startTime} – {ev.endTime}</div>}
                  <div className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize opacity-0 group-hover:opacity-100" onMouseDown={(e) => handleDragStart(ev, 'resize', e)} />
                </div>
              );
            })}

            {today && (
              <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: timeLineTop }}>
                <div className="flex items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1" />
                  <div className="flex-1 h-[2px] bg-red-500" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
