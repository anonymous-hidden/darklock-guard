import React, { useState, useEffect, useRef } from 'react';
import { EVENT_COLORS, CALENDAR_COLORS } from '../utils/eventHelpers';

const COLOR_OPTIONS = Object.keys(EVENT_COLORS);
const CALENDAR_OPTIONS = [
  { key: 'personal', label: 'Personal' },
  { key: 'work', label: 'Work' },
  { key: 'family', label: 'Family' },
  { key: 'holidays', label: 'Holidays' },
  { key: 'birthdays', label: 'Birthdays' },
];
const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export default function EventModal({ event, onSave, onDelete, onClose }) {
  const isEdit = !!event?.id && !!event?.title;
  const [form, setForm] = useState({
    title: '',
    date: '',
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    color: 'blue',
    calendar: 'personal',
    description: '',
    recurrence: 'none',
    ...event,
  });

  const titleRef = useRef(null);

  useEffect(() => {
    // Focus title on open
    setTimeout(() => titleRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSave = () => {
    if (!form.title.trim()) {
      titleRef.current?.focus();
      return;
    }
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Modal */}
      <div
        className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h2 className="text-lg font-medium text-gray-800">
            {isEdit ? 'Edit event' : 'New event'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Add title"
            className="w-full text-xl font-normal border-b-2 border-gray-200 focus:border-primary outline-none pb-2 transition-colors"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />

          {/* Date & Time row */}
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="date"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {!form.allDay && (
              <>
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => set('startTime', e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <span className="text-gray-400">–</span>
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => set('endTime', e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </>
            )}
          </div>

          {/* All day toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(e) => set('allDay', e.target.checked)}
              className="w-4 h-4 text-primary rounded focus:ring-primary"
            />
            <span className="text-sm text-gray-700">All day</span>
          </label>

          {/* Calendar & Recurrence row */}
          <div className="flex gap-3">
            <select
              value={form.calendar}
              onChange={(e) => {
                set('calendar', e.target.value);
                set('color', CALENDAR_COLORS[e.target.value] || form.color);
              }}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary bg-white"
            >
              {CALENDAR_OPTIONS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>

            <select
              value={form.recurrence}
              onChange={(e) => set('recurrence', e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary bg-white"
            >
              {RECURRENCE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Color picker */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Color</label>
            <div className="flex gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => set('color', c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    form.color === c ? 'border-gray-800 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: EVENT_COLORS[c].border }}
                />
              ))}
            </div>
          </div>

          {/* Description */}
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Add description"
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary resize-none"
          />

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <div>
              {isEdit && (
                <button
                  onClick={() => onDelete(form.id)}
                  className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-6 py-2 text-sm font-medium text-white bg-primary hover:bg-blue-700 rounded-lg transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
