import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  isSameDay,
  isSameMonth,
  isToday,
  getHours,
  getMinutes,
  parseISO,
  eachDayOfInterval,
  startOfDay,
  endOfDay,
  differenceInMinutes,
  setHours,
  setMinutes,
} from 'date-fns';

export {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  isSameDay,
  isSameMonth,
  isToday,
  getHours,
  getMinutes,
  parseISO,
  eachDayOfInterval,
  startOfDay,
  endOfDay,
  differenceInMinutes,
  setHours,
  setMinutes,
};

/** Get array of 7 day dates for the week containing `date` */
export function getWeekDays(date) {
  const start = startOfWeek(date, { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Get a 6-row * 7-col grid of dates for the month view */
export function getMonthGrid(date) {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  return eachDayOfInterval({ start: gridStart, end: gridEnd });
}

/** Parse "HH:mm" into total minutes from midnight */
export function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/** Convert total minutes to "HH:mm" */
export function minutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Format hour as "12 AM", "1 PM", etc */
export function formatHourLabel(hour) {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/** Format time string "09:30" to "9:30 AM" */
export function formatTimeDisplay(timeStr) {
  if (!timeStr) return '';
  const mins = timeToMinutes(timeStr);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** ISO date string from a Date object */
export function toISODate(date) {
  return format(date, 'yyyy-MM-dd');
}

/** Current time as minutes from midnight */
export function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** Navigate date based on view */
export function navigateDate(date, direction, view) {
  const fns = {
    day: direction > 0 ? addDays : subDays,
    week: direction > 0 ? addWeeks : subWeeks,
    month: direction > 0 ? addMonths : subMonths,
    year: direction > 0 ? addYears : subYears,
  };
  return fns[view](date, 1);
}

/** Get the display label for the toolbar */
export function getViewLabel(date, view) {
  switch (view) {
    case 'day':
      return format(date, 'MMMM d, yyyy');
    case 'week': {
      const start = startOfWeek(date, { weekStartsOn: 0 });
      const end = endOfWeek(date, { weekStartsOn: 0 });
      if (start.getMonth() === end.getMonth()) {
        return format(start, 'MMMM yyyy');
      }
      return `${format(start, 'MMM')} – ${format(end, 'MMM yyyy')}`;
    }
    case 'month':
      return format(date, 'MMMM yyyy');
    case 'year':
      return format(date, 'yyyy');
    default:
      return format(date, 'MMMM yyyy');
  }
}

/** 24 hours array [0..23] */
export const HOURS = Array.from({ length: 24 }, (_, i) => i);

export const ROW_HEIGHT = 48;
