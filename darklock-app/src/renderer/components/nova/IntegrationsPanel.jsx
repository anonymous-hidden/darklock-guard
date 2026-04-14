import React from 'react';
import { useNovaStore } from '../../store/novaStore';

const INTEGRATIONS = [
  { id: 'weather', name: 'Weather', icon: '🌤️', desc: 'OpenWeather API — real-time conditions & forecast', setup: 'Set OPENWEATHER_API_KEY in jarvis/.env' },
  { id: 'google_calendar', name: 'Google Calendar', icon: '📅', desc: 'Real events, reminders, scheduling', setup: 'OAuth2 credentials in jarvis/data/credentials.json' },
  { id: 'google_docs', name: 'Google Docs', icon: '📝', desc: 'Read, write, and edit documents live', setup: 'Same Google OAuth2 credentials' },
  { id: 'google_sheets', name: 'Google Sheets', icon: '📊', desc: 'Spreadsheet data access', setup: 'Same Google OAuth2 credentials' },
  { id: 'govee', name: 'Smart Lights (Govee)', icon: '💡', desc: 'Color, brightness, scenes for all lights', setup: 'Set GOVEE_API_KEY in jarvis/.env' },
  { id: 'github', name: 'GitHub', icon: '🐙', desc: 'Repo stats, READMEs, code lookup', setup: 'Set GITHUB_TOKEN in jarvis/.env (optional for public repos)' },
  { id: 'browser', name: 'Browser Bridge', icon: '🌐', desc: 'Read tabs, type, click, search — Chrome extension', setup: 'Install jarvis/browser-extension/ in Chrome' },
  { id: 'darklock', name: 'DarkLock Server', icon: '🔒', desc: 'Monitor status, restart, view logs', setup: 'DarkLock server on same network, auto-detected' },
  { id: 'pi5', name: 'Raspberry Pi 5', icon: '🍓', desc: 'SSH health checks, remote commands', setup: 'Set PI5_HOST and PI5_USER in jarvis/.env' },
  { id: 'voice_tts', name: 'Voice Output (TTS)', icon: '🔊', desc: 'Neural voice via edge-tts + GStreamer', setup: 'pip install edge-tts; apt install gstreamer1.0-tools' },
  { id: 'voice_stt', name: 'Voice Input (STT)', icon: '🎤', desc: 'faster-whisper local speech recognition', setup: 'pip install faster-whisper; model auto-downloads' },
  { id: 'news', name: 'News Feed', icon: '📰', desc: 'Latest headlines from RSS/API', setup: 'Built-in, no config needed' },
  { id: 'spotify', name: 'Spotify (Media)', icon: '🎵', desc: 'Play/pause, next/prev via system media keys', setup: 'System media keys, works with any player' },
  { id: 'terminal', name: 'Terminal / Shell', icon: '🖥️', desc: 'Run commands in sandboxed shell', setup: 'Built-in, sandboxed execution' },
  { id: 'vision', name: 'Vision (Image Analysis)', icon: '👁️', desc: 'Analyze images with llava:13b model', setup: 'ollama pull llava:13b' },
  { id: 'screenshots', name: 'Screenshots', icon: '📸', desc: 'Capture screen on command', setup: 'Requires gnome-screenshot or scrot' },
];

const FUTURE_INTEGRATIONS = [
  { id: 'home_assistant', name: 'Home Assistant', icon: '🏠', desc: 'Full smart home control — thermostats, locks, cameras', setup: 'Set HA_URL and HA_TOKEN in jarvis/.env' },
  { id: 'notion', name: 'Notion', icon: '📋', desc: 'Notes, databases, project management', setup: 'Create Notion integration, set NOTION_TOKEN' },
  { id: 'obsidian', name: 'Obsidian Vault', icon: '🗃️', desc: 'Read and write to your knowledge base', setup: 'Set OBSIDIAN_VAULT_PATH in jarvis/.env' },
  { id: 'email', name: 'Email (Gmail)', icon: '📧', desc: 'Read inbox, draft replies, send messages', setup: 'Gmail API via Google OAuth2' },
  { id: 'todoist', name: 'Todoist', icon: '✅', desc: 'Task management across all devices', setup: 'Set TODOIST_TOKEN in jarvis/.env' },
  { id: 'discord_bot', name: 'Discord Bot', icon: '🤖', desc: 'Monitor & reply in Discord channels', setup: 'Already running — connect via API' },
  { id: 'twitch', name: 'Twitch', icon: '🎮', desc: 'Stream status, chat monitoring', setup: 'Set TWITCH_TOKEN in jarvis/.env' },
  { id: 'system_monitor', name: 'Deep System Monitor', icon: '📈', desc: 'CPU/GPU/RAM/Disk live graphs', setup: 'Built-in via psutil' },
  { id: 'docker', name: 'Docker', icon: '🐳', desc: 'Manage containers, view logs, restart services', setup: 'Docker socket access' },
  { id: 'ollama_models', name: 'Model Manager', icon: '🧪', desc: 'Pull, remove, switch Ollama models', setup: 'Built-in via Ollama API' },
];

function IntegrationCard({ integration, active, future }) {
  return (
    <div className={`p-3 rounded-lg border transition-all ${
      future
        ? 'bg-bg-primary/50 border-border/50 opacity-60'
        : active
          ? 'bg-bg-primary border-success/30'
          : 'bg-bg-primary border-border'
    }`}>
      <div className="flex items-start gap-2">
        <span className="text-lg">{integration.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-primary">{integration.name}</span>
            {future ? (
              <span className="text-[10px] px-1.5 py-0.5 bg-bg-hover rounded text-text-muted">Coming Soon</span>
            ) : active ? (
              <span className="text-[10px] px-1.5 py-0.5 bg-success/20 rounded text-success">Active</span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 bg-warning/20 rounded text-warning">Setup Needed</span>
            )}
          </div>
          <div className="text-[11px] text-text-muted mt-0.5">{integration.desc}</div>
          {!active && !future && (
            <div className="text-[10px] text-accent mt-1 font-mono">{integration.setup}</div>
          )}
          {future && (
            <div className="text-[10px] text-text-muted mt-1 font-mono">{integration.setup}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsPanel() {
  const connected = useNovaStore(s => s.connected);
  const settings = useNovaStore(s => s.settings);
  const integrationStatus = useNovaStore(s => s.integrationStatus);

  // Match integration IDs to API response keys
  const statusMap = {
    weather: integrationStatus?.weather,
    google_calendar: integrationStatus?.google_calendar,
    govee: integrationStatus?.govee,
    github: integrationStatus?.github,
    browser: integrationStatus?.browser,
    voice_tts: integrationStatus?.voice_tts,
    voice_stt: integrationStatus?.voice_stt,
    pi5: integrationStatus?.pi5,
    darklock: integrationStatus?.darklock,
    vision: integrationStatus?.vision,
    terminal: integrationStatus?.terminal,
  };

  const isActive = (id) => {
    const s = statusMap[id];
    return s?.available === true;
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <span>🔌</span> Integrations & Connections
        </h3>
        <span className="text-xs text-text-muted">{INTEGRATIONS.length} available</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0">
        {/* Active integrations */}
        <div>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Available Now</div>
          <div className="grid grid-cols-1 gap-2">
            {INTEGRATIONS.map(int => (
              <IntegrationCard
                key={int.id}
                integration={int}
                active={isActive(int.id)}
              />
            ))}
          </div>
        </div>

        {/* Future integrations */}
        <div>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
            Connectable (Setup Required)
          </div>
          <div className="grid grid-cols-1 gap-2">
            {FUTURE_INTEGRATIONS.map(int => (
              <IntegrationCard
                key={int.id}
                integration={int}
                future
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
