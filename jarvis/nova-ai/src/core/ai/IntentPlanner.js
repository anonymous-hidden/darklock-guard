/**
 * IntentPlanner — lightweight deterministic planner for the renderer.
 *
 * This does not execute tools. It produces a structured plan that can be
 * logged, shown, or passed into the model so tool use is grounded in the
 * registry instead of ad-hoc keyword prompting.
 */

export const WIDGET_REGISTRY = [
  { id: 'jarvis-call', legacyId: 'nova-call', name: 'Call Jarvis', aliases: ['call', 'voice', 'nova-call'], description: 'Voice call with Jarvis.' },
  { id: 'jarvis-chat', legacyId: 'nova-chat', name: 'Chat with Jarvis', aliases: ['chat', 'nova-chat'], description: 'Quick chat with Jarvis.' },
  { id: 'notes', name: 'Notes', aliases: ['note'], description: 'Markdown notes Jarvis can read and write.' },
  { id: 'todo', name: 'Todos', aliases: ['tasks', 'to do'], description: 'Task list.' },
  { id: 'calendar', name: 'Calendar', aliases: ['schedule'], description: 'Local calendar.' },
  { id: 'spotify', name: 'Spotify', aliases: ['music', 'songs'], description: 'Spotify playback.' },
  { id: 'weather', name: 'Weather', aliases: ['forecast'], description: 'Weather forecast.' },
  { id: 'map', name: 'Map', aliases: ['maps', 'directions'], description: 'Map and route display.' },
  { id: 'news', name: 'News', aliases: ['headlines'], description: 'Current headlines.' },
  { id: 'room-control', name: 'Room Control', aliases: ['room', 'lights', 'govee'], description: 'Room and Govee controls.' },
  { id: 'sysmon', name: 'System Monitor', aliases: ['system', 'stats'], description: 'System resource stats.' },
  { id: 'logs', name: 'Logs', aliases: ['log'], description: 'Activity logs.' },
  { id: 'widget-theme', name: 'Widget Themes', aliases: ['theme', 'themes'], description: 'Widget theme controls.' },
];

export const TOOL_REGISTRY = [
  { name: 'widgets.list', description: 'List widgets.', required: [], optional: [], examples: ['what widgets do i have'], combinable: true, requiresConfirmation: false },
  { name: 'widgets.popout', description: 'Open widget in popout.', required: ['id'], optional: [], examples: ['open notes widget'], combinable: true, requiresConfirmation: false },
  { name: 'notes.list', description: 'List notes.', required: [], optional: [], examples: ['what notes do i have'], combinable: true, requiresConfirmation: false },
  { name: 'notes.latest', description: 'Read latest note.', required: [], optional: [], examples: ['finish my story in notes'], combinable: true, requiresConfirmation: false },
  { name: 'notes.search', description: 'Search notes.', required: ['query'], optional: [], examples: ['read testing note'], combinable: true, requiresConfirmation: false },
  { name: 'notes.create', description: 'Create note.', required: ['title'], optional: ['content'], examples: ['make a new note'], combinable: true, requiresConfirmation: false },
  { name: 'notes.update', description: 'Update note.', required: ['id'], optional: ['title', 'content'], examples: ['rewrite my note'], combinable: true, requiresConfirmation: false },
  { name: 'news.today', description: 'Fetch current headlines.', required: [], optional: ['topic'], examples: ['today news'], combinable: true, requiresConfirmation: false },
  { name: 'weather.current', description: 'Get weather.', required: [], optional: ['location'], examples: ['weather for my appointment'], combinable: true, requiresConfirmation: false },
  { name: 'maps.search', description: 'Find place on map.', required: ['query'], optional: ['limit', 'zoom'], examples: ['show map of miami'], combinable: true, requiresConfirmation: false },
  { name: 'maps.directions', description: 'Get directions.', required: ['from', 'to'], optional: [], examples: ['directions to school'], combinable: true, requiresConfirmation: false },
  { name: 'spotify.control', description: 'Control Spotify.', required: ['action'], optional: [], examples: ['play music'], combinable: true, requiresConfirmation: false },
  { name: 'room.lights', description: 'Control lights.', required: ['action'], optional: ['color', 'brightness', 'scene'], examples: ['turn lights blue'], combinable: true, requiresConfirmation: false },
  { name: 'desktop.snapshot', description: 'Detect windows/apps.', required: [], optional: ['includeScreenshot'], examples: ['what is open'], combinable: true, requiresConfirmation: false },
  { name: 'desktop.read', description: 'Read desktop screenshot/OCR.', required: [], optional: ['includeScreenshot', 'ocr'], examples: ['what do you see in discord'], combinable: true, requiresConfirmation: false },
  { name: 'desktop.focus', description: 'Focus app/window.', required: [], optional: ['app', 'title'], examples: ['focus discord'], combinable: true, requiresConfirmation: false },
  { name: 'desktop.type', description: 'Type into focused app.', required: ['text'], optional: ['delayMs'], examples: ['type hi'], combinable: true, requiresConfirmation: false },
  { name: 'desktop.key', description: 'Press key/hotkey.', required: ['key'], optional: ['confirmSend'], examples: ['send it'], combinable: true, requiresConfirmation: true },
  { name: 'terminal.open', description: 'Open shared terminal.', required: [], optional: ['command', 'cwd'], examples: ['run command'], combinable: true, requiresConfirmation: true },
  { name: 'web.search', description: 'Search web.', required: ['query'], optional: ['limit'], examples: ['find best pc'], combinable: true, requiresConfirmation: false },
  { name: 'web.fetch', description: 'Fetch URL text.', required: ['url'], optional: [], examples: ['read this page'], combinable: true, requiresConfirmation: false },
];

const INTENTS = [
  { intent: 'notes_list', examples: ['what notes do i have', 'list my notes'], tools: ['widgets.popout', 'notes.list'], widgets: ['notes'] },
  { intent: 'notes_read', examples: ['what is in the testing note', 'read my note', 'tell me whats in note testing'], tools: ['widgets.popout', 'notes.search'], widgets: ['notes'] },
  { intent: 'notes_create', examples: ['make a new note', 'write down todays news and date'], tools: ['widgets.popout', 'news.today', 'notes.create'], widgets: ['notes'] },
  { intent: 'notes_edit', examples: ['finish my story in notes', 'rewrite testing note'], tools: ['widgets.popout', 'notes.search', 'notes.update'], widgets: ['notes'] },
  { intent: 'widget_control', examples: ['open spotify widget', 'show weather widget'], tools: ['widgets.popout'], widgets: [] },
  { intent: 'music', examples: ['play a good song', 'play my stressed mix'], tools: ['widgets.popout', 'spotify.control'], widgets: ['spotify'] },
  { intent: 'lights', examples: ['turn lights blue', 'lights off'], tools: ['room.lights'], widgets: ['room-control'] },
  { intent: 'desktop_read', examples: ['what do you see in discord', 'read my desktop'], tools: ['desktop.focus', 'desktop.read'], widgets: [] },
  { intent: 'app_launch', examples: ['open brave', 'launch discord'], tools: ['apps.open'], widgets: [] },
  { intent: 'terminal', examples: ['run command in terminal', 'install tesseract'], tools: ['terminal.open'], widgets: [], requiresConfirmation: true },
  { intent: 'shopping_compare', examples: ['find best cheapest pc', 'compare products'], tools: ['web.search', 'web.fetch'], widgets: [] },
  { intent: 'map_weather_parking', examples: ['find weather traffic and nearby parking for my appointment'], tools: ['weather.current', 'maps.directions', 'maps.search'], widgets: ['weather', 'map'], missingWhenNoPlace: true },
  { intent: 'calendar_plan', examples: ['plan my day tomorrow and show it on my calendar widget'], tools: ['widgets.popout'], widgets: ['calendar'], missingQuestion: 'What fixed events or tasks should I plan around tomorrow?' },
  { intent: 'restaurant_booking', examples: ['find me a restaurant book it and show the map'], tools: ['web.search', 'maps.search'], widgets: ['map'], requiresConfirmation: true, missingQuestion: 'What area, day/time, and food vibe should I use?' },
];

function norm(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokens(text) {
  return new Set(norm(text).match(/[a-z0-9_'-]+/g)?.filter((t) => t.length > 2 && !['the', 'and', 'for', 'you', 'can', 'please', 'with'].includes(t)) || []);
}

function overlapScore(text, examples) {
  const q = tokens(text);
  let best = 0;
  for (const ex of examples || []) {
    const e = tokens(ex);
    if (!e.size) continue;
    let n = 0;
    for (const t of e) if (q.has(t)) n += 1;
    best = Math.max(best, n / e.size);
  }
  return Math.min(0.99, best);
}

function widgetFromText(text) {
  const q = norm(text);
  for (const w of WIDGET_REGISTRY) {
    const labels = [w.id, w.legacyId, w.name, ...(w.aliases || [])].filter(Boolean).map(norm);
    if (labels.some((label) => new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q))) {
      return w.id;
    }
  }
  return '';
}

function extractEntities(text, intent) {
  const q = norm(text);
  const quoted = [...String(text || '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const entities = {};
  if (q.includes('tomorrow')) entities.date = 'tomorrow';
  if (q.includes('today')) entities.date = 'today';
  const widget = widgetFromText(text);
  if (widget) entities.widget = widget;
  const noteTitle = String(text || '').match(/\b(?:under|called|named|titled|note)\s+([a-z0-9 _'-]+?)(?:\s+in\s+the\s+notes?\s+widget)?$/i);
  if (noteTitle) entities.title = noteTitle[1].trim();
  if (quoted[0]) entities.title = quoted[0];
  if (quoted[1]) entities.content = quoted[1];
  if (intent === 'app_launch') {
    const m = String(text || '').match(/\b(?:open|launch|start)\s+(.+?)(?:\s+app)?$/i);
    if (m) entities.app = m[1].trim();
  }
  if (intent === 'shopping_compare') {
    entities.query = String(text || '').replace(/^(can you|please|pls)?\s*(find|compare|search for|look for)\s+/i, '').trim();
  }
  return entities;
}

export function planUserRequest(text, { previousPlan = null } = {}) {
  const q = norm(text);
  if (!q) return null;
  let best = null;
  for (const def of INTENTS) {
    let score = overlapScore(q, def.examples);
    if (def.intent.startsWith('notes') && /\bnotes?\b/.test(q)) score += 0.18;
    if (def.intent === 'music' && /\b(song|music|spotify|playlist)\b/.test(q)) score += 0.18;
    if (def.intent === 'lights' && /\b(lights?|govee)\b/.test(q)) score += 0.18;
    if (def.intent === 'widget_control' && /\bwidget\b/.test(q)) score += 0.18;
    if (!best || score > best.score) best = { def, score };
  }
  if (!best || best.score < 0.34) return null;

  const entities = extractEntities(text, best.def.intent);
  const missingInfo = [];
  let clarification = best.def.missingQuestion || '';
  if (best.def.intent === 'widget_control' && !entities.widget) {
    missingInfo.push('widget');
    clarification = 'Which widget should I open or close?';
  }
  if (best.def.intent === 'app_launch' && !entities.app) {
    missingInfo.push('app');
    clarification = 'Which app should I open?';
  }
  if (best.def.missingWhenNoPlace && !entities.place) {
    missingInfo.push('place');
    clarification = 'Where is the appointment?';
  }
  if (previousPlan?.intent && /^(yes|yeah|yep|go ahead|do it)$/i.test(q)) {
    entities.followUpTo = previousPlan.intent;
  }

  const steps = [];
  for (const tool of best.def.tools || []) {
    const params = {};
    if (tool === 'widgets.popout') params.id = entities.widget || best.def.widgets?.[0];
    if (tool === 'web.search') params.query = entities.query || text;
    steps.push({ type: 'tool', name: tool, params });
  }
  for (const widget of best.def.widgets || []) {
    if (!steps.some((s) => s.type === 'widget' && s.name === widget)) {
      steps.push({ type: 'widget', name: widget, params: {} });
    }
  }

  return {
    intent: best.def.intent,
    confidence: Number(Math.min(0.99, best.score).toFixed(2)),
    entities,
    steps,
    missing_info: missingInfo,
    requires_confirmation: !!best.def.requiresConfirmation || steps.some((s) => TOOL_REGISTRY.find((t) => t.name === s.name)?.requiresConfirmation),
    clarification_question: missingInfo.length || best.def.missingQuestion ? clarification : '',
  };
}

export function registrySnapshot() {
  return {
    tools: TOOL_REGISTRY,
    widgets: WIDGET_REGISTRY,
    intents: INTENTS.map(({ intent, examples, tools, widgets, requiresConfirmation }) => ({ intent, examples, tools, widgets, requiresConfirmation: !!requiresConfirmation })),
  };
}

export function planToSystemBlock(plan) {
  if (!plan) return '';
  return `STRUCTURED_ACTION_PLAN:\n${JSON.stringify(plan, null, 2)}\n\nUse this plan as grounding. Do not execute any step with missing_info. Ask the clarification_question when missing_info is not empty. Require explicit confirmation before any step marked requires_confirmation.`;
}
