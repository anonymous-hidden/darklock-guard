import React, { useState } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameDay,
  isSameMonth,
  isToday,
} from '../utils/dateHelpers';

export default function MiniCalendar({ currentDate, onSelectDate }) {
  const [viewMonth, setViewMonth] = useState(startOfMonth(currentDate));

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const days = [];
  let d = gridStart;
  while (d <= gridEnd) {
    days.push(d);
    d = addDays(d, 1);
  }

  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="select-none">
      {/* Month header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-sm font-medium text-gray-700">
          {format(viewMonth, 'MMMM yyyy')}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMonth((m) => subMonths(m, 1))}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 text-xs"
          >
            ‹
          </button>
          <button
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 text-xs"
          >
            ›
          </button>
        </div>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 mb-1">
        {dayLabels.map((label, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-gray-400 py-0.5">
            {label}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const inMonth = isSameMonth(day, viewMonth);
          const today = isToday(day);
          const selected = isSameDay(day, currentDate);

          return (
            <button
              key={i}
              onClick={() => onSelectDate(day)}
              className={`
                w-7 h-7 flex items-center justify-center text-xs rounded-full
                transition-colors duration-100
                ${!inMonth ? 'text-gray-300' : 'text-gray-700'}
                ${today && !selected ? 'text-primary font-bold' : ''}
                ${selected ? 'bg-primary text-white font-bold' : 'hover:bg-gray-100'}
              `}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}
