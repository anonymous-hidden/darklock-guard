import React from 'react';
import {
  format,
  isToday,
  isSameMonth,
  isSameDay,
  getMonthGrid,
  toISODate,
} from '../utils/dateHelpers';
import { getEventsForDate, getEventColor } from '../utils/eventHelpers';

const MAX_VISIBLE_EVENTS = 3;

export default function MonthView({ currentDate, events, onEventClick, onSlotClick }) {
  const grid = getMonthGrid(currentDate);
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weeks = [];
  for (let i = 0; i < grid.length; i += 7) {
    weeks.push(grid.slice(i, i + 7));
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-gray-200 flex-shrink-0">
        {dayLabels.map((label) => (
          <div key={label} className="text-center py-2 text-xs font-medium text-gray-500 uppercase">
            {label}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className="flex-1 grid" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-gray-100">
            {week.map((day) => {
              const dateStr = toISODate(day);
              const inMonth = isSameMonth(day, currentDate);
              const today = isToday(day);
              const dayEvents = getEventsForDate(events, dateStr);
              const visible = dayEvents.slice(0, MAX_VISIBLE_EVENTS);
              const overflow = dayEvents.length - MAX_VISIBLE_EVENTS;

              return (
                <div
                  key={day.toISOString()}
                  className={`border-l border-gray-100 p-1 min-h-0 overflow-hidden cursor-pointer hover:bg-gray-50 transition-colors ${
                    !inMonth ? 'bg-gray-50/50' : ''
                  }`}
                  onClick={() =>
                    onSlotClick({ date: dateStr, startTime: '09:00', endTime: '10:00' })
                  }
                >
                  <div className="flex justify-center mb-0.5">
                    <span
                      className={`text-xs w-6 h-6 flex items-center justify-center rounded-full ${
                        today
                          ? 'bg-primary text-white font-bold'
                          : inMonth
                          ? 'text-gray-700'
                          : 'text-gray-400'
                      }`}
                    >
                      {format(day, 'd')}
                    </span>
                  </div>
                  <div className="space-y-px">
                    {visible.map((ev) => {
                      const colors = getEventColor(ev);
                      return (
                        <div
                          key={ev.id}
                          className="rounded px-1 py-px text-[10px] font-medium truncate cursor-pointer"
                          style={{ backgroundColor: colors.bg, color: colors.text }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEventClick(ev, e);
                          }}
                        >
                          {ev.allDay ? '' : `${formatMinimal(ev.startTime)} `}
                          {ev.title || '(No title)'}
                        </div>
                      );
                    })}
                    {overflow > 0 && (
                      <div className="text-[10px] text-gray-500 px-1 font-medium">
                        +{overflow} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatMinimal(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const suffix = h >= 12 ? 'p' : 'a';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}
