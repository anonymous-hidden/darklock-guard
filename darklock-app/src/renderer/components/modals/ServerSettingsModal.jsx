import React, { useState, useEffect } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { useServerStore } from '../../store/serverStore';
import { config } from '../../config';

export default function ServerSettingsModal() {
  const { toggleServerSettings } = useUIStore();
  const { accessToken } = useAuthStore();
  const { currentServer, updateServer, removeServer } = useServerStore();
  const [tab, setTab] = useState('overview');
  const [name, setName] = useState(currentServer?.name || '');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [channels, setChannels] = useState([]);
  const [newChannel, setNewChannel] = useState({ name: '', type: 'text' });

  useEffect(() => {
    if (currentServer) {
      setName(currentServer.name);
      loadChannels();
      loadInvite();
    }
  }, [currentServer?.id]);

  const loadChannels = async () => {
    try {
      const res = await fetch(`${config.apiUrl}/api/servers/${currentServer.id}/channels`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) setChannels(await res.json());
    } catch {}
  };

  const loadInvite = async () => {
    if (currentServer?.inviteCode) {
      setInviteCode(currentServer.inviteCode);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${config.apiUrl}/api/servers/${currentServer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ name: name.trim() })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      updateServer(currentServer.id, { name: name.trim() });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateChannel = async () => {
    if (!newChannel.name.trim()) return;
    try {
      const res = await fetch(`${config.apiUrl}/api/servers/${currentServer.id}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ name: newChannel.name.trim(), type: newChannel.type })
      });
      if (res.ok) {
        setNewChannel({ name: '', type: 'text' });
        loadChannels();
      }
    } catch {}
  };

  const handleDeleteServer = async () => {
    if (confirmDelete !== currentServer.name) return;
    setLoading(true);
    try {
      const res = await fetch(`${config.apiUrl}/api/servers/${currentServer.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        removeServer(currentServer.id);
        toggleServerSettings();
      }
    } catch {}
    setLoading(false);
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'channels', label: 'Channels' },
    { id: 'members', label: 'Members' },
    { id: 'invites', label: 'Invites' },
    { id: 'delete', label: 'Delete Server' }
  ];

  if (!currentServer) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex z-50" onClick={toggleServerSettings}>
      <div className="flex w-full max-w-4xl m-auto h-[80vh] rounded-lg overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Left nav */}
        <div className="w-56 bg-[#2b2d31] p-4 flex flex-col">
          <h3 className="text-xs font-bold text-text-muted uppercase px-2 mb-2">
            {currentServer.name}
          </h3>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`text-left text-sm px-2 py-1.5 rounded mb-0.5 transition-colors ${
                tab === t.id
                  ? 'bg-[#404249] text-text-primary'
                  : t.id === 'delete'
                  ? 'text-danger hover:bg-danger/10'
                  : 'text-text-secondary hover:text-text-primary hover:bg-[#35373c]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 bg-[#313338] p-8 overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-text-primary">
              {tabs.find(t => t.id === tab)?.label}
            </h2>
            <button onClick={toggleServerSettings} className="text-text-muted hover:text-text-primary text-2xl">
              ✕
            </button>
          </div>

          {error && (
            <div className="mb-4 bg-danger/10 border border-danger/30 text-danger text-sm rounded px-3 py-2">
              {error}
            </div>
          )}

          {tab === 'overview' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">Server Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full max-w-sm bg-[#1e1f22] text-text-primary text-sm rounded px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent"
                  maxLength={100}
                />
              </div>
              <button
                onClick={handleSave}
                disabled={loading || name === currentServer.name}
                className="bg-accent hover:bg-accent-hover text-white text-sm font-medium px-4 py-2 rounded transition-colors disabled:opacity-50"
              >
                Save Changes
              </button>
            </div>
          )}

          {tab === 'channels' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  value={newChannel.name}
                  onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                  placeholder="channel-name"
                  className="flex-1 bg-[#1e1f22] text-text-primary text-sm rounded px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
                  maxLength={100}
                />
                <select
                  value={newChannel.type}
                  onChange={(e) => setNewChannel({ ...newChannel, type: e.target.value })}
                  className="bg-[#1e1f22] text-text-primary text-sm rounded px-3 py-2 outline-none"
                >
                  <option value="text"># Text</option>
                  <option value="voice">🔊 Voice</option>
                </select>
                <button
                  onClick={handleCreateChannel}
                  disabled={!newChannel.name.trim()}
                  className="bg-accent hover:bg-accent-hover text-white text-sm px-4 py-2 rounded disabled:opacity-50"
                >
                  Create
                </button>
              </div>
              <div className="space-y-1">
                {channels.map(ch => (
                  <div key={ch.id} className="flex items-center px-3 py-2 bg-[#2b2d31] rounded text-sm text-text-secondary">
                    <span className="mr-2 text-text-muted">{ch.type === 'voice' ? '🔊' : '#'}</span>
                    {ch.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'members' && (
            <div className="text-text-muted text-sm">
              <p>Members are listed in the members sidebar. Server-level role management is not yet implemented.</p>
            </div>
          )}

          {tab === 'invites' && (
            <div className="space-y-4">
              <p className="text-text-secondary text-sm">Share this invite code with others to let them join your server.</p>
              {inviteCode ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-[#1e1f22] text-accent px-3 py-2 rounded text-sm font-mono">
                    {inviteCode}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(inviteCode)}
                    className="bg-accent hover:bg-accent-hover text-white text-sm px-4 py-2 rounded"
                  >
                    Copy
                  </button>
                </div>
              ) : (
                <p className="text-text-muted text-sm">No invite code available.</p>
              )}
            </div>
          )}

          {tab === 'delete' && (
            <div className="space-y-4">
              <div className="bg-danger/10 border border-danger/30 rounded p-4">
                <h3 className="text-danger font-semibold mb-2">Danger Zone</h3>
                <p className="text-text-secondary text-sm mb-4">
                  This action is irreversible. All channels and data will be permanently deleted.
                </p>
                <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">
                  Type "{currentServer.name}" to confirm
                </label>
                <input
                  value={confirmDelete}
                  onChange={(e) => setConfirmDelete(e.target.value)}
                  className="w-full max-w-sm bg-[#1e1f22] text-text-primary text-sm rounded px-3 py-2.5 outline-none mb-3"
                />
                <button
                  onClick={handleDeleteServer}
                  disabled={confirmDelete !== currentServer.name || loading}
                  className="bg-danger hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded disabled:opacity-50"
                >
                  Delete Server
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
