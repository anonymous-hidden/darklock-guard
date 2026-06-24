/**
 * Built-in widget registry.
 *
 * Each entry describes a first-class Jarvis widget that ships in the app
 * (as opposed to AI-built ones from the Widget Studio). The Command
 * Center renders a gallery from this list, and the AI can dock/popout
 * any of them via the `widgets.dock` / `widgets.popout` tools.
 */
import ClockWidget         from './ClockWidget.jsx';
import CalculatorWidget    from './CalculatorWidget.jsx';
import NotesWidget         from './NotesWidget.jsx';
import TodoWidget          from './TodoWidget.jsx';
import SystemMonitorWidget from './SystemMonitorWidget.jsx';
import SpotifyWidget       from './SpotifyWidget.jsx';
import WeatherWidget       from './WeatherWidget.jsx';
import QuickActionsWidget  from './QuickActionsWidget.jsx';
import RemindersWidget     from './RemindersWidget.jsx';
import ClipboardWidget     from './ClipboardWidget.jsx';
import NovaChatWidget      from './NovaChatWidget.jsx';
import NovaCallWidget      from './NovaCallWidget.jsx';
import CalendarWidget      from './CalendarWidget.jsx';
import LogsWidget          from './LogsWidget.jsx';
import EmotionWidget       from './EmotionWidget.jsx';
import MapWidget           from './MapWidget.jsx';
import NewsWidget          from './NewsWidget.jsx';
import RoomControlWidget   from './RoomControlWidget.jsx';
import WidgetThemeWidget   from './WidgetThemeWidget.jsx';

export const BUILTIN_WIDGETS = [
  { id: 'nova-call',     name: 'Call Jarvis',    icon: '☎',  accent: 'ok',      tags: ['voice','ai'],      description: 'Voice call with Jarvis — speak and hear replies in real time.', component: NovaCallWidget,      w: 380, h: 520, aliases: ['jarvis-call'] },
  { id: 'nova-chat',     name: 'Chat with Jarvis', icon: '✦',  accent: 'accent',  tags: ['chat','ai'],       description: 'Quick chat with Jarvis in a docked panel.',               component: NovaChatWidget,      w: 420, h: 520, aliases: ['jarvis-chat'] },
  { id: 'widget-theme',  name: 'Widget Themes',  icon: '◇',  accent: 'accent2', tags: ['theme','layout'],  description: 'Set a shared widget theme and desktop mode for all widgets.', component: WidgetThemeWidget, w: 560, h: 620 },
  { id: 'clock',         name: 'Clock',          icon: '◷',  accent: 'accent',  tags: ['time'],            description: 'Live clock with multiple time zones and a stopwatch.', component: ClockWidget,         w: 360, h: 280 },
  { id: 'calculator',    name: 'Calculator',     icon: '∑',  accent: 'accent2', tags: ['math','graph'],    description: 'Scientific calculator + function grapher.',             component: CalculatorWidget,    w: 520, h: 560 },
  { id: 'notes',         name: 'Notes',          icon: '✎',  accent: 'ok',      tags: ['notes'],           description: 'Markdown notes Jarvis can read, write and edit.',         component: NotesWidget,         w: 720, h: 520 },
  { id: 'todo',          name: 'Todos',          icon: '☑',  accent: 'accent',  tags: ['tasks'],           description: 'Task list with priorities, tags, and quick-add.',       component: TodoWidget,          w: 480, h: 540 },
  { id: 'calendar',      name: 'Calendar',       icon: '📅', accent: 'accent',  tags: ['time','plan'],     description: 'Local calendar Jarvis can read and write to.',            component: CalendarWidget,      w: 460, h: 520 },
  { id: 'emotions',      name: 'Mood Journal',   icon: '💭', accent: 'accent',  tags: ['mood','wellbeing'],'description': 'Track your emotions over time — Jarvis logs them too.', component: EmotionWidget,       w: 460, h: 540 },
  { id: 'sysmon',        name: 'System Monitor', icon: '◐',  accent: 'warn',    tags: ['stats'],           description: 'Live CPU, RAM, disk and load average.',                 component: SystemMonitorWidget, w: 460, h: 360 },
  { id: 'spotify',       name: 'Spotify',        icon: '♫',  accent: 'ok',      tags: ['media'],           description: 'Spotify now-playing display + transport controls.',     component: SpotifyWidget,       w: 420, h: 280 },
  { id: 'weather',       name: 'Weather',        icon: '☼',  accent: 'accent',  tags: ['weather'],         description: 'Hourly + 7-day forecast (Open-Meteo, no API key).',     component: WeatherWidget,       w: 480, h: 380 },
  { id: 'map',           name: 'Map',            icon: '🗺', accent: 'accent2', tags: ['maps','travel'],   description: 'World map with search, directions, and 3D terrain mode.', component: MapWidget,          w: 980, h: 700 },
  { id: 'news',          name: 'News',           icon: '📰', accent: 'accent',  tags: ['news','briefing'], description: 'Headlines and summaries for your daily Jarvis briefing.',   component: NewsWidget,         w: 720, h: 560 },
  { id: 'room-control',  name: 'Room Control',   icon: '🏠', accent: 'ok',      tags: ['iot','home'],      description: 'Control lights, buzzers, and monitor bridge health.',     component: RoomControlWidget,  w: 560, h: 620 },
  { id: 'quick-actions', name: 'Quick Actions',  icon: '⚡', accent: 'accent2', tags: ['system'],          description: 'One-tap volume, brightness, screenshot, power.',        component: QuickActionsWidget,  w: 420, h: 460 },
  { id: 'reminders',     name: 'Reminders',      icon: '⏰', accent: 'warn',    tags: ['time'],            description: 'Timed reminders that pop a desktop notification.',      component: RemindersWidget,     w: 440, h: 420 },
  { id: 'clipboard',     name: 'Clipboard',      icon: '⎘',  accent: 'accent',  tags: ['utility'],         description: 'Clipboard manager with searchable history.',            component: ClipboardWidget,     w: 480, h: 460 },
  { id: 'logs',          name: 'Logs',           icon: '📋', accent: 'accent2', tags: ['system','debug'],  description: 'Live activity log for every widget plus the system journal.', component: LogsWidget,     w: 560, h: 480 },
];

export function getBuiltin(id) {
  return BUILTIN_WIDGETS.find((w) => w.id === id) || null;
}
