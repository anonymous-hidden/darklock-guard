import React, { useState } from 'react';
import { getViewLabel } from '../utils/dateHelpers';

const VIEW_TABS = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

export default function Toolbar({
  currentDate,
  view,
  searchQuery,
  onToday,
  onBack,
  onForward,
  onViewChange,
  onSearchChange,
}) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="flex items-center gap-4 px-4 h-14 border-b border-gray-200 bg-white flex-shrink-0">
      {/* Today button */}
      <button
        onClick={onToday}
        className="px-4 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        Today
      </button>

      {/* Nav arrows */}
      <div className="flex items-center gap-1">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
        </button>
        <button
          onClick={onForward}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
          </svg>
        </button>
      </div>

      {/* Date label */}
      <h1 className="text-xl font-normal text-gray-800 whitespace-nowrap">
        {getViewLabel(currentDate, view)}
      </h1>

      <div className="flex-1" />

      {/* Search */}
      {searchOpen ? (
        <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-gray-50">
          <svg className="w-4 h-4 text-gray-400 ml-2" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search events..."
            className="px-2 py-1.5 text-sm bg-transparent outline-none w-48"
            autoFocus
            onBlur={() => {
              if (!searchQuery) setSearchOpen(false);
            }}
          />
          {searchQuery && (
            <button
              onClick={() => {
                onSearchChange('');
                setSearchOpen(false);
              }}
              className="px-2 text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => setSearchOpen(true)}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
        </button>
      )}

      {/* View switcher */}
      <div className="flex border border-gray-300 rounded-lg overflow-hidden">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onViewChange(tab.key)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              view === tab.key
                ? 'bg-primary text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
