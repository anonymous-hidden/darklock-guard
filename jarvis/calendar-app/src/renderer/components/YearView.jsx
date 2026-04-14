import React from 'react';
import {
  format,
  isToday,
  isSameMonth,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
} from '../utils/dateHelpers';

export default function YearView({ currentDate, onSelectDate }) {
  const year = currentDate.getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => new Date(year, i, 1));
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-4 gap-8 max-w-5xl mx-auto">
        {months.map((month) => {
          const monthStart = startOfMonth(month);
          const monthEnd = endOfMonth(month);
          const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
          const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

          const days = [];
          let d = gridStart;
          while (d <= gridEnd) {
            days.push(d);
            d = addDays(d, 1);
          }

          return (
            <div key={month.toISOString()} className="select-none">
              <h3
                className="text-sm font-medium text-gray-700 mb-2 cursor-pointer hover:text-primary"
                onClick={() => onSelectDate(month)}
              >
                {format(month, 'MMMM')}
              </h3>
              <div className="grid grid-cols-7 gap-0">
                {dayLabels.map((label, i) => (
                  <div key={i} className="text-center text-[9px] text-gray-400 py-0.5">
                    {label}
                  </div>
                ))}
                {days.map((day, i) => {
                  const inMonth = isSameMonth(day, month);
                  const today = isToday(day);

                  return (
                    <button
                      key={i}
                      onClick={() => onSelectDate(day)}
                      className={`w-6 h-6 flex items-center justify-center text-[10px] rounded-full transition-colors
                        ${!inMonth ? 'text-transparent cursor-default' : 'text-gray-600 hover:bg-gray-100'}
                        ${today ? 'bg-primary text-white font-bold hover:bg-primary' : ''}
                      `}
                      disabled={!inMonth}
                    >
                      {format(day, 'd')}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
