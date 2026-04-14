import React, { useEffect, useRef } from 'react';
import { getEventColor } from '../utils/eventHelpers';
import { formatTimeDisplay } from '../utils/dateHelpers';

export default function EventPopover({ event, position, onEdit, onDelete, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        onClose();
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  if (!event) return null;

  const colors = getEventColor(event);

  // Position near the click, but keep on screen
  const style = {};
  if (position) {
    style.position = 'fixed';
    style.left = Math.min(position.x, window.innerWidth - 320);
    style.top = Math.min(position.y, window.innerHeight - 250);
    style.zIndex = 100;
  }

  return (
    <div ref={ref} className="bg-white rounded-xl shadow-2xl border border-gray-200 w-72" style={style}>
      {/* Color bar */}
      <div className="h-2 rounded-t-xl" style={{ backgroundColor: colors.border }} />

      <div className="p-4">
        {/* Title */}
        <h3 className="text-base font-medium text-gray-900 mb-1">
          {event.title || '(No title)'}
        </h3>

        {/* Time */}
        <p className="text-sm text-gray-600 mb-2">
          {event.allDay
            ? 'All day'
            : `${formatTimeDisplay(event.startTime)} – ${formatTimeDisplay(event.endTime)}`}
        </p>

        {/* Date */}
        <p className="text-sm text-gray-500 mb-2">{event.date}</p>

        {/* Calendar */}
        <div className="flex items-center gap-1.5 mb-3">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.border }} />
          <span className="text-xs text-gray-500 capitalize">{event.calendar}</span>
        </div>

        {/* Description */}
        {event.description && (
          <p className="text-sm text-gray-600 mb-3 whitespace-pre-wrap">{event.description}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={() => onEdit(event)}
            className="flex-1 px-3 py-1.5 text-sm font-medium text-primary hover:bg-blue-50 rounded-lg transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(event.id)}
            className="flex-1 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
