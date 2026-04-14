/**
 * Nova AI Calendar Integration Hook
 * Connects to Nova's FastAPI server at localhost:8950
 * Provides full CRUD access for Nova to manage calendar events
 */

const NOVA_API_BASE = 'http://127.0.0.1:8950/api';

/**
 * Sync events from Nova's Google Calendar into local store
 */
export async function syncFromNova(days = 30) {
  try {
    const res = await fetch(`${NOVA_API_BASE}/calendar/upcoming?days=${days}`);
    if (!res.ok) throw new Error(`Nova API error: ${res.status}`);
    const data = await res.json();

    if (data.error) {
      console.warn('Nova calendar sync error:', data.error);
      return { events: [], error: data.error };
    }

    // Convert Nova's Google Calendar format to our local event format
    const events = (data.events || []).map(novaEventToLocal);
    return { events, error: null };
  } catch (err) {
    console.warn('Could not reach Nova API:', err.message);
    return { events: [], error: err.message };
  }
}

/**
 * Get today's events from Nova (for briefings)
 */
export async function getTodayFromNova() {
  try {
    const res = await fetch(`${NOVA_API_BASE}/calendar/today`);
    if (!res.ok) throw new Error(`Nova API error: ${res.status}`);
    const data = await res.json();
    return { events: (data.events || []).map(novaEventToLocal), count: data.count || 0 };
  } catch (err) {
    return { events: [], count: 0, error: err.message };
  }
}

/**
 * Create an event via Nova (uses Google Calendar quick-add)
 */
export async function createViaNova(text) {
  try {
    const res = await fetch(`${NOVA_API_BASE}/calendar/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Nova API error: ${res.status}`);
    const data = await res.json();
    if (data.error) return { event: null, error: data.error };
    return { event: novaEventToLocal(data.event), error: null };
  } catch (err) {
    return { event: null, error: err.message };
  }
}

/**
 * Delete an event via Nova (Google Calendar)
 */
export async function deleteViaNova(googleEventId) {
  try {
    const res = await fetch(`${NOVA_API_BASE}/calendar/${encodeURIComponent(googleEventId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Nova API error: ${res.status}`);
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Send a chat message to Nova and get a response
 * Used for natural language calendar commands
 */
export async function chatWithNova(message) {
  try {
    const res = await fetch(`${NOVA_API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error(`Nova API error: ${res.status}`);
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Check if Nova API is reachable
 */
export async function checkNovaConnection() {
  try {
    const res = await fetch(`${NOVA_API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Push all local events to Nova's local calendar (SQLite).
 * Called on startup and after every save/delete so Nova always has current data.
 */
export async function pushAllToNova(events) {
  try {
    const res = await fetch(`${NOVA_API_BASE}/calendar/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    if (!res.ok) throw new Error(`Nova API error: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Could not push events to Nova:', err.message);
    return { error: err.message };
  }
}

// ── Helpers ──

function novaEventToLocal(novaEvent) {
  if (!novaEvent) return null;

  // Parse start/end from Nova's format (ISO dateTime or date string)
  let date = '';
  let startTime = '09:00';
  let endTime = '10:00';
  let allDay = novaEvent.all_day || false;

  const startStr = novaEvent.start || '';
  const endStr = novaEvent.end || '';

  if (startStr.includes('T')) {
    // Timed event: "2026-03-24T09:00:00-05:00"
    const dt = new Date(startStr);
    date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    startTime = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  } else if (startStr) {
    // All-day event: "2026-03-24"
    date = startStr;
    allDay = true;
  }

  if (endStr.includes('T')) {
    const dt = new Date(endStr);
    endTime = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  }

  return {
    id: novaEvent.id || '',
    title: novaEvent.summary || '(No title)',
    date,
    startTime,
    endTime,
    allDay,
    color: 'blue',
    calendar: 'personal',
    description: novaEvent.description || '',
    recurrence: 'none',
    // Keep reference to Nova/Google source
    _source: 'nova',
    _googleId: novaEvent.id,
    _link: novaEvent.link || '',
    _location: novaEvent.location || '',
  };
}
