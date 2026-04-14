import { timeToMinutes, ROW_HEIGHT } from './dateHelpers';

/** Color palette for calendar events */
export const EVENT_COLORS = {
  blue:   { bg: '#e8f0fe', text: '#1a73e8', border: '#1a73e8' },
  green:  { bg: '#e6f4ea', text: '#137333', border: '#137333' },
  red:    { bg: '#fce8e6', text: '#c5221f', border: '#c5221f' },
  purple: { bg: '#f3e8fd', text: '#8430ce', border: '#8430ce' },
  orange: { bg: '#fef7e0', text: '#e37400', border: '#e37400' },
  teal:   { bg: '#e0f7fa', text: '#00796b', border: '#00796b' },
};

/** Calendar → default color mapping */
export const CALENDAR_COLORS = {
  personal: 'blue',
  work: 'green',
  family: 'orange',
  holidays: 'purple',
  birthdays: 'red',
};

/**
 * Calculate positioning for overlapping events in a day column.
 * Returns events with added `top`, `height`, `left`, `width` (as fractions/px).
 */
export function layoutEventsForDay(events, columnWidth = 1) {
  if (!events.length) return [];

  // Sort by start time, then by duration (longer first)
  const sorted = [...events]
    .filter((e) => !e.allDay)
    .sort((a, b) => {
      const aStart = timeToMinutes(a.startTime);
      const bStart = timeToMinutes(b.startTime);
      if (aStart !== bStart) return aStart - bStart;
      const aDuration = timeToMinutes(a.endTime) - aStart;
      const bDuration = timeToMinutes(b.endTime) - bStart;
      return bDuration - aDuration;
    });

  // Group into overlapping clusters
  const clusters = [];
  let currentCluster = [];
  let clusterEnd = 0;

  for (const event of sorted) {
    const start = timeToMinutes(event.startTime);
    const end = timeToMinutes(event.endTime);

    if (currentCluster.length === 0 || start < clusterEnd) {
      currentCluster.push(event);
      clusterEnd = Math.max(clusterEnd, end);
    } else {
      clusters.push(currentCluster);
      currentCluster = [event];
      clusterEnd = end;
    }
  }
  if (currentCluster.length) clusters.push(currentCluster);

  // Layout each cluster
  const positioned = [];
  for (const cluster of clusters) {
    const columns = [];
    for (const event of cluster) {
      const start = timeToMinutes(event.startTime);
      const end = timeToMinutes(event.endTime);
      let placed = false;

      for (let col = 0; col < columns.length; col++) {
        const lastInCol = columns[col][columns[col].length - 1];
        if (timeToMinutes(lastInCol.endTime) <= start) {
          columns[col].push(event);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([event]);
      }
    }

    const numCols = columns.length;
    for (let col = 0; col < columns.length; col++) {
      for (const event of columns[col]) {
        const startMins = timeToMinutes(event.startTime);
        const endMins = timeToMinutes(event.endTime);
        const duration = Math.max(endMins - startMins, 15);

        positioned.push({
          ...event,
          top: (startMins / 60) * ROW_HEIGHT,
          height: (duration / 60) * ROW_HEIGHT,
          left: col / numCols,
          width: 1 / numCols,
        });
      }
    }
  }

  return positioned;
}

/** Get color config for an event */
export function getEventColor(event) {
  const colorKey = event.color || CALENDAR_COLORS[event.calendar] || 'blue';
  return EVENT_COLORS[colorKey] || EVENT_COLORS.blue;
}

/** Filter events for a specific date */
export function getEventsForDate(events, dateStr) {
  return events.filter((e) => e.date === dateStr);
}

/** Filter events by visible calendars */
export function filterByCalendars(events, visibleCalendars) {
  return events.filter((e) => visibleCalendars[e.calendar] !== false);
}
