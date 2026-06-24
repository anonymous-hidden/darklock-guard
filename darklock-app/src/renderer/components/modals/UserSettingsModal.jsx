import React, { useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { useAuth } from '../../hooks/useAuth';
import { getKeyFingerprint } from '../../crypto/keyManager';

const TABS = [
  { id: 'account', label: 'My Account' },
  { id: 'privacy', label: 'Privacy & Safety' },
  { id: 'security', label: 'Security' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'keybinds', label: 'Keybinds' },
  { id: 'connections', label: 'Connections' },
];

const SectionTitle = ({ title, description }) => (
  <div className="mb-5">
    <h2 className="text-2xl font-bold text-text-primary">{title}</h2>
    {description && <p className="text-sm text-text-muted mt-1">{description}</p>}
  </div>
);

const SettingsGroup = ({ title, children }) => (
  <div className="bg-bg-primary/70 border border-bg-hover rounded-xl overflow-hidden">
    {title && (
      <div className="px-5 py-3 border-b border-bg-hover bg-bg-tertiary/40">
        <h3 className="text-xs font-semibold tracking-wide uppercase text-text-muted">{title}</h3>
      </div>
    )}
    <div>{children}</div>
  </div>
);

const SettingRow = ({ label, description, children, danger = false }) => (
  <div className="px-5 py-4 border-b border-bg-hover last:border-b-0">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className={`text-sm font-medium ${danger ? 'text-danger' : 'text-text-primary'}`}>{label}</p>
        {description && <p className="text-xs text-text-muted mt-1">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  </div>
);

const Toggle = ({ enabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-11 h-6 rounded-full relative transition-colors ${enabled ? 'bg-accent' : 'bg-bg-hover'}`}
  >
    <span
      className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`}
    />
  </button>
);

export default function UserSettingsModal() {
  const {
    toggleSettings,
    settingsTab,
    setSettingsTab,
    fontSize,
    setFontSize,
    messageDensity,
    setMessageDensity,
    notificationsEnabled,
    setNotificationsEnabled,
    notificationContent,
    setNotificationContent,
    soundsEnabled,
    setSoundsEnabled,
  } = useUIStore();
  const { userId, publicKey } = useAuthStore();
  const { logout } = useAuth();
  const [fingerprint, setFingerprint] = useState('');

  React.useEffect(() => {
    if (publicKey) {
      getKeyFingerprint(publicKey).then(setFingerprint);
    }
  }, [publicKey]);

  return (
    <div className="fixed inset-0 bg-black/70 flex z-50">
      {/* Left nav */}
      <div className="w-56 bg-[#2b2d31] flex flex-col p-4 pt-16 overflow-y-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setSettingsTab(tab.id)}
            className={`text-left px-3 py-1.5 rounded text-sm mb-0.5 ${
              settingsTab === tab.id ? 'bg-bg-active text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <div className="border-t border-bg-hover my-2" />
        <button
          onClick={logout}
          className="text-left px-3 py-1.5 rounded text-sm text-danger hover:bg-danger/10"
        >
          Log Out
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 bg-[#313338] overflow-y-auto p-8 md:p-12 relative">
        {/* Close button */}
        <button
          onClick={toggleSettings}
          className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full border-2 border-text-muted text-text-muted hover:border-text-primary hover:text-text-primary"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {settingsTab === 'account' && (
          <div>
            <SectionTitle title="My Account" description="Manage your identity, credentials, and access." />
            <div className="bg-bg-primary/70 border border-bg-hover rounded-xl p-5">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-20 h-20 bg-accent rounded-full flex items-center justify-center text-2xl font-bold text-white">
                  {userId?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div>
                  <p className="text-text-primary font-semibold">User</p>
                  <p className="text-text-muted text-sm">ID: {userId?.slice(0, 8)}...</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-bg-tertiary/70 border border-bg-hover rounded-lg p-3">
                  <p className="text-xs text-text-muted uppercase mb-1">Username</p>
                  <p className="text-text-primary text-sm">Encrypted</p>
                </div>
                <div className="bg-bg-tertiary/70 border border-bg-hover rounded-lg p-3">
                  <p className="text-xs text-text-muted uppercase mb-1">Public Key Fingerprint</p>
                  <p className="text-text-primary text-sm font-mono">{fingerprint}</p>
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-4">
              <SettingsGroup title="Account Actions">
                <SettingRow label="Password" description="Change your account password.">
                  <button className="bg-accent hover:bg-accent-hover text-white text-sm px-4 py-2 rounded transition-colors">
                    Change Password
                  </button>
                </SettingRow>
                <SettingRow label="Two-Factor Authentication" description="Add another verification layer for logins.">
                  <button
                    onClick={() => { useUIStore.getState().toggleSettings(); useUIStore.getState().toggleTwoFactor(); }}
                    className="bg-bg-tertiary hover:bg-bg-hover text-text-primary text-sm px-4 py-2 rounded transition-colors"
                  >
                    Enable 2FA
                  </button>
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Danger Zone">
                <SettingRow label="Delete Account" description="Permanently remove account data from this device." danger>
                  <button className="text-sm text-danger hover:bg-danger/10 px-3 py-1.5 rounded border border-danger/40">
                    Delete Account
                  </button>
                </SettingRow>
              </SettingsGroup>
            </div>
          </div>
        )}

        {settingsTab === 'privacy' && (
          <div>
            <SectionTitle title="Privacy & Safety" description="Control message retention and contact permissions." />
            <SettingsGroup>
              <SettingRow label="Default Message TTL" description="Set automatic expiration for new messages.">
                <select className="bg-bg-tertiary text-text-primary text-sm rounded px-3 py-2 outline-none min-w-[160px]">
                  <option value="0">Never expire</option>
                  <option value="30">30 seconds</option>
                  <option value="60">1 minute</option>
                  <option value="300">5 minutes</option>
                  <option value="1800">30 minutes</option>
                  <option value="3600">1 hour</option>
                  <option value="86400">24 hours</option>
                </select>
              </SettingRow>

              <SettingRow label="Who can send you DMs" description="Restrict who can start new private chats.">
                <div className="flex flex-col gap-1 text-sm text-text-secondary">
                  {['Everyone', 'Friends Only', 'Nobody'].map(opt => (
                    <label key={opt} className="flex items-center gap-2">
                      <input type="radio" name="dms" className="accent-accent" />
                      {opt}
                    </label>
                  ))}
                </div>
              </SettingRow>

              <SettingRow label="Local History" description="Remove cached local message history." danger>
                <button className="bg-danger/10 text-danger text-sm px-4 py-2 rounded hover:bg-danger/20 transition-colors">
                  Clear History
                </button>
              </SettingRow>
            </SettingsGroup>
          </div>
        )}

        {settingsTab === 'security' && (
          <div>
            <SectionTitle title="Security" description="Review key material and control active sessions." />
            <SettingsGroup>
              <SettingRow
                label="Session Key Fingerprint"
                description="Verify this matches on both ends for authenticity."
              >
                <code className="text-accent text-xs font-mono bg-bg-tertiary px-3 py-2 rounded block max-w-[220px] truncate">
                  {fingerprint || 'No active session'}
                </code>
              </SettingRow>

              <SettingRow label="Public Key" description="Your current account public key.">
                <div className="text-right max-w-[320px]">
                  <code className="text-text-muted text-xs font-mono bg-bg-tertiary px-3 py-2 rounded block break-all text-left">
                    {publicKey || 'N/A'}
                  </code>
                  <button className="text-accent text-xs mt-2 hover:underline">Copy to clipboard</button>
                </div>
              </SettingRow>

              <SettingRow label="Active Sessions" description="Manage devices that currently have access.">
                <div className="flex items-center gap-3 px-3 py-2 bg-bg-tertiary rounded">
                  <div className="w-2 h-2 bg-success rounded-full" />
                  <div>
                    <p className="text-sm text-text-primary">This device</p>
                    <p className="text-xs text-text-muted">Current session</p>
                  </div>
                  <button className="ml-auto text-xs text-danger hover:underline">Revoke</button>
                </div>
              </SettingRow>
            </SettingsGroup>
          </div>
        )}

        {settingsTab === 'appearance' && (
          <div>
            <SectionTitle title="Appearance" description="Fine-tune readability and interface density." />
            <SettingsGroup>
              <SettingRow label="Font Size" description="Adjust global UI text size.">
                <div className="w-[220px]">
                  <input
                    type="range"
                    min={12}
                    max={24}
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                  <div className="flex justify-between text-xs text-text-muted mt-1">
                    <span>12px</span>
                    <span>{fontSize}px</span>
                    <span>24px</span>
                  </div>
                </div>
              </SettingRow>

              <SettingRow label="Message Density" description="Choose spacing between messages.">
                <div className="flex gap-2">
                  {['cozy', 'compact'].map(d => (
                    <button
                      key={d}
                      onClick={() => setMessageDensity(d)}
                      className={`px-4 py-2 rounded text-sm capitalize ${
                        messageDensity === d ? 'bg-accent text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </SettingRow>

              <SettingRow label="Theme" description="Dark mode is currently enforced for secure viewing.">
                <span className="text-xs text-text-muted">Dark only</span>
              </SettingRow>
            </SettingsGroup>
          </div>
        )}

        {settingsTab === 'notifications' && (
          <div>
            <SectionTitle title="Notifications" description="Choose what appears and how alerts sound." />
            <SettingsGroup>
              <SettingRow label="Desktop Notifications" description="Show native system notifications for new activity.">
                <Toggle enabled={notificationsEnabled} onClick={() => setNotificationsEnabled(!notificationsEnabled)} />
              </SettingRow>

              <SettingRow label="Sounds" description="Play alert sounds for messages and mentions.">
                <Toggle enabled={soundsEnabled} onClick={() => setSoundsEnabled(!soundsEnabled)} />
              </SettingRow>

              <SettingRow label="Notification Content" description="Control the amount of content shown in alerts.">
                <div className="flex flex-col gap-1 text-sm text-text-secondary">
                  {[
                    { v: 'preview', l: 'Show message preview' },
                    { v: 'sender', l: 'Show sender only' },
                    { v: 'none', l: 'Show nothing (count only)' },
                  ].map(opt => (
                    <label key={opt.v} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="notifContent"
                        className="accent-accent"
                        checked={notificationContent === opt.v}
                        onChange={() => setNotificationContent(opt.v)}
                      />
                      {opt.l}
                    </label>
                  ))}
                </div>
              </SettingRow>
            </SettingsGroup>
          </div>
        )}

        {settingsTab === 'keybinds' && (
          <div>
            <SectionTitle title="Keyboard Shortcuts" description="Quick actions available from anywhere in the app." />
            <div className="bg-bg-primary/70 border border-bg-hover rounded-xl divide-y divide-bg-hover overflow-hidden">
              {[
                ['Ctrl+K', 'Quick switcher'],
                ['Ctrl+,', 'Open settings'],
                ['Ctrl+Shift+M', 'Toggle mute'],
                ['Ctrl+Shift+D', 'Toggle deafen'],
                ['Ctrl+/', 'Show shortcuts'],
                ['Escape', 'Close modal'],
                ['Alt+Up/Down', 'Navigate channels'],
                ['Ctrl+W', 'Close DM'],
                ['Ctrl+T', 'New DM'],
                ['Ctrl+L', 'Lock app'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-text-secondary">{desc}</span>
                  <kbd className="bg-bg-tertiary text-text-primary text-xs font-mono px-2 py-1 rounded">{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        )}

        {settingsTab === 'connections' && (
          <div>
            <SectionTitle title="Connections" description="Configure your server and check connection health." />
            <SettingsGroup>
              <SettingRow label="Server URL" description="Change this for self-hosted environments.">
                <div className="w-[260px]">
                  <input
                    type="text"
                    defaultValue="http://localhost:4200"
                    className="w-full bg-bg-tertiary text-text-primary text-sm rounded px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </SettingRow>

              <SettingRow label="Connection Status" description="Current status for the active endpoint.">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-success">Connected</span>
                  <button className="text-sm text-accent hover:underline">Reconnect</button>
                </div>
              </SettingRow>
            </SettingsGroup>
          </div>
        )}
      </div>
    </div>
  );
}
