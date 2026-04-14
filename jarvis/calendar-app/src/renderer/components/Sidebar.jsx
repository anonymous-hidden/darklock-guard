import React from 'react';
import MiniCalendar from './MiniCalendar';

const CALENDARS_MAIN = [
  { key: 'personal', label: 'Personal', color: '#1a73e8' },
  { key: 'work', label: 'Work', color: '#137333' },
  { key: 'family', label: 'Family', color: '#e37400' },
];

const CALENDARS_OTHER = [
  { key: 'holidays', label: 'Holidays', color: '#8430ce' },
  { key: 'birthdays', label: 'Birthdays', color: '#c5221f' },
];

export default function Sidebar({
  currentDate,
  calendars,
  onSelectDate,
  onToggleCalendar,
  onNewEvent,
}) {
  return (
    <aside className="w-[220px] min-w-[220px] border-r border-gray-200 flex flex-col h-full bg-white">
      {/* New event button */}
      <div className="p-4 pb-2">
        <button
          onClick={onNewEvent}
          className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-300 rounded-3xl shadow-sm hover:shadow-md transition-shadow text-sm font-medium text-gray-700"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" className="text-primary">
            <path fill="#1a73e8" d="M20 13h-7v7h-2v-7H4v-2h7V4h2v7h7v2z" />
          </svg>
          Create
        </button>
      </div>

      {/* Mini calendar */}
      <div className="px-3 py-2">
        <MiniCalendar currentDate={currentDate} onSelectDate={onSelectDate} />
      </div>

      {/* My calendars */}
      <div className="px-3 py-2 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            My calendars
          </span>
        </div>
        {CALENDARS_MAIN.map((cal) => (
          <CalendarRow
            key={cal.key}
            cal={cal}
            visible={calendars[cal.key]?.visible !== false}
            onToggle={() => onToggleCalendar(cal.key)}
          />
        ))}

        <div className="flex items-center justify-between mb-2 mt-4">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Other calendars
          </span>
        </div>
        {CALENDARS_OTHER.map((cal) => (
          <CalendarRow
            key={cal.key}
            cal={cal}
            visible={calendars[cal.key]?.visible !== false}
            onToggle={() => onToggleCalendar(cal.key)}
          />
        ))}
      </div>

      {/* Nova connection indicator */}
      <div className="border-t border-gray-200 px-3 py-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Nova AI Connected
        </div>
      </div>
    </aside>
  );
}

function CalendarRow({ cal, visible, onToggle }) {
  return (
    <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-50 cursor-pointer">
      <input
        type="checkbox"
        checked={visible}
        onChange={onToggle}
        className="sr-only"
      />
      <span
        className="w-3.5 h-3.5 rounded-sm flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: visible ? cal.color : 'transparent',
          border: visible ? 'none' : `2px solid ${cal.color}`,
        }}
      >
        {visible && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="text-sm text-gray-700">{cal.label}</span>
    </label>
  );
}
