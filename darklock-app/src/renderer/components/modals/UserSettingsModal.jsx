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

export default function UserSettingsModal() {
  const { toggleSettings, settingsTab, setSettingsTab, fontSize, setFontSize, messageDensity, setMessageDensity, notificationsEnabled, soundsEnabled } = useUIStore();
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
      <div className="flex-1 bg-[#313338] overflow-y-auto p-16 pt-12 relative">
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
            <h2 className="text-xl font-bold text-text-primary mb-6">My Account</h2>
            <div className="bg-bg-primary rounded-lg p-4">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-20 h-20 bg-accent rounded-full flex items-center justify-center text-2xl font-bold text-white">
                  {userId?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div>
                  <p className="text-text-primary font-semibold">User</p>
                  <p className="text-text-muted text-sm">ID: {userId?.slice(0, 8)}...</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-bg-tertiary rounded p-3">
                  <p className="text-xs text-text-muted uppercase mb-1">Username</p>
                  <p className="text-text-primary text-sm">Encrypted</p>
                </div>
                <div className="bg-bg-tertiary rounded p-3">
                  <p className="text-xs text-text-muted uppercase mb-1">Public Key Fingerprint</p>
                  <p className="text-text-primary text-sm font-mono">{fingerprint}</p>
                </div>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              <button className="bg-accent hover:bg-accent-hover text-white text-sm px-4 py-2 rounded transition-colors">
                Change Password
              </button>
              <button
                onClick={() => { useUIStore.getState().toggleSettings(); useUIStore.getState().toggleTwoFactor(); }}
                className="bg-bg-primary hover:bg-bg-hover text-text-primary text-sm px-4 py-2 rounded transition-colors ml-2"
              >
                Enable 2FA
              </button>
            </div>
            <div className="mt-8 border-t border-bg-hover pt-4">
              <h3 className="text-sm font-semibold text-danger mb-2">Danger Zone</h3>
              <button className="text-sm text-danger hover:bg-danger/10 px-3 py-1.5 rounded border border-danger/40">
                Delete Account
              </button>
            </div>
          </div>
        )}

        {settingsTab === 'privacy' && (
          <div>
            <h2 className="text-xl font-bold text-text-primary mb-6">Privacy & Safety</h2>
            <div className="space-y-4">
              <div className="bg-bg-primary rounded-lg p-4">
                <h3 className="text-sm font-semibold text-text-primary mb-2">Default Message TTL</h3>
                <select className="bg-bg-tertiary text-text-primary text-sm rounded px-3 py-2 outline-none">
                  <option value="0">Never expire</option>
                  <option value="30">30 seconds</option>
                  <option value="60">1 minute</option>
                  <option value="300">5 minutes</option>
                  <option value="1800">30 minutes</option>
                  <option value="3600">1 hour</option>
                  <option value="86400">24 hours</option>
                </select>
              </div>
              <div className="bg-bg-primary rounded-lg p-4">
                <h3 className="text-sm font-semibold text-text-primary mb-2">Who can send you DMs</h3>
                <div className="space-y-2">
                  {['Everyone', 'Friends Only', 'Nobody'].map(opt => (
                    <label key={opt} className="flex items-center gap-2 text-sm text-text-secondary">
                      <input type="radio" name="dms" className="accent-accent" />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>
              <button className="bg-danger/10 text-danger text-sm px-4 py-2 rounded hover:bg-danger/20 transition-colors">
                Clear Local Message History
              </button>
            </div>
          </div>
        )}

        {settingsTab === 'security' && (
          <div>
            <h2 className="text-xl font-bold text-text-primary mb-6">Security</h2>
            <div className="space-y-4">
              <div className="bg-bg-primary rounded-lg p-4">
                <h3 className="text-sm font-semibold text-text-primary mb-1">Session Key Fingerprint</h3>
                <p className="text-text-muted text-xs mb-2">Verify this matches on both ends for authenticity</p>
                <code className="text-accent text-sm font-mono bg-bg-tertiary px-3 py-2 rounded block">{fingerprint || 'No active session'}</code>
              </div>
              <div className="bg-bg-primary rounded-lg p-4">
                <h3 className="text-sm font-semibold text-text-primary mb-1">Public Key</h3>
                <code className="text-text-muted text-xs font-mono bg-bg-tertiary px-3 py-2 rounded block break-all">{publicKey || 'N/A'}</code>
                <button className="text-accent text-xs mt-2 hover:underline">Copy to clipboard</button>
              </div>
              <div className="bg-bg-primary rounded-lg p-4">
                <h3 className="text-sm font-semibold text-text-primary mb-2">Active Sessions</h3>
                <div className="flex items-center gap-3 p-2 bg-bg-tertiary rounded">
                  <div className="w-2 h-2 bg-success rounded-full" />
                  <div>
                    <p className="text-sm text-text-primary">This device</p>
                    <p className="text-xs text-text-muted">Current session</p>
                  </div>
                  <button className="ml-auto text-xs text-danger hover:underline">Revoke</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {settingsTab === 'appearance' && (
          <div>
            <h2 className="text-xl font-bold text-text-primary mb-6">Appearance</h2>
            <div className="space-y-4">
              <div className="bg-bg-primary rounded-lg p-4">
                <h3 className="text-sm font-semibold text-text-primary mb-3">Font Size</h3>
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
              <div className="bg-bg-primary rounded-lg p-4">
                <h3 className="text-sm font-semibold text-text-primary mb-3">Message Density</h3>
                <div className="flex gap-3">
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
              </div>
              <div className="bg-bg-primary rounded-lg p-4">
                <p className="text-text-muted text-sm">🌙 Dark mode only — light mode is disabled for your security.</p>
              </div>
            </div>
          </div>
        )}

        {settingsTab === 'notifications' && (
          <div>
            <h2 className="text-xl font-bold text-text-primary mb-6">Notifications</h2>
            <div className="space-y-4">
              <label className="flex items-center justify-between bg-bg-primary rounded-lg p-4">
                <span className="text-sm text-text-primary">Desktop Notifications</span>
                <div className={`w-10 h-6 rounded-full relative cursor-pointer ${notificationsEnabled ? 'bg-accent' : 'bg-bg-hover'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${notificationsEnabled ? 'left-[18px]' : 'left-0.5'}`} />
                </div>
              </label>
              <label className="flex items-center justify-between bg-bg-primary rounded-lg p-4">
                <span className="text-sm text-text-primary">Sounds</span>
                <div className={`w-10 h-6 rounded-full relative cursor-pointer ${soundsEnabled ? 'bg-accent' : 'bg-bg-hover'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${soundsEnabled ? 'left-[18px]' : 'left-0.5'}`} />
                </div>
              </label>
              <div className="bg-bg-primary rounded-lg p-4">
                <h3 className="text-sm font-semibold text-text-primary mb-2">Notification Content</h3>
                <div className="space-y-2">
                  {[{ v: 'preview', l: 'Show message preview' }, { v: 'sender', l: 'Show sender only' }, { v: 'none', l: 'Show nothing (count only)' }].map(opt => (
                    <label key={opt.v} className="flex items-center gap-2 text-sm text-text-secondary">
                      <input type="radio" name="notifContent" className="accent-accent" />
                      {opt.l}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {settingsTab === 'keybinds' && (
          <div>
            <h2 className="text-xl font-bold text-text-primary mb-6">Keyboard Shortcuts</h2>
            <div className="bg-bg-primary rounded-lg divide-y divide-bg-hover">
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
            <h2 className="text-xl font-bold text-text-primary mb-6">Connections</h2>
            <div className="space-y-4">
              <div className="bg-bg-primary rounded-lg p-4">
                <h3 className="text-sm font-semibold text-text-primary mb-2">Server URL</h3>
                <input
                  type="text"
                  defaultValue="http://localhost:4200"
                  className="w-full bg-bg-tertiary text-text-primary text-sm rounded px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
                />
                <p className="text-xs text-text-muted mt-1">Change for self-hosted servers</p>
              </div>
              <div className="bg-bg-primary rounded-lg p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">Connection Status</h3>
                  <p className="text-xs text-success">Connected</p>
                </div>
                <button className="text-sm text-accent hover:underline">Reconnect</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
