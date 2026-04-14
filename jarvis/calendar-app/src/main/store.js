const Store = require('electron-store');

const store = new Store({
  name: 'nova-calendar-events',
  defaults: {
    events: [],
    calendars: {
      personal: { name: 'Personal', color: 'blue', visible: true },
      work: { name: 'Work', color: 'green', visible: true },
      family: { name: 'Family', color: 'orange', visible: true },
      holidays: { name: 'Holidays', color: 'purple', visible: true },
      birthdays: { name: 'Birthdays', color: 'red', visible: true },
    },
  },
});

function getAllEvents() {
  return store.get('events', []);
}

function saveEvent(event) {
  const events = store.get('events', []);
  const idx = events.findIndex((e) => e.id === event.id);
  if (idx >= 0) {
    events[idx] = event;
  } else {
    events.push(event);
  }
  store.set('events', events);
  return event;
}

function deleteEvent(id) {
  const events = store.get('events', []);
  store.set('events', events.filter((e) => e.id !== id));
  return true;
}

function getEventsByRange(startDate, endDate) {
  const events = store.get('events', []);
  return events.filter((e) => {
    return e.date >= startDate && e.date <= endDate;
  });
}

module.exports = { store, getAllEvents, saveEvent, deleteEvent, getEventsByRange };
