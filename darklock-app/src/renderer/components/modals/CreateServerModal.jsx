import React, { useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { useServerStore } from '../../store/serverStore';
import { config } from '../../config';

export default function CreateServerModal() {
  const { toggleCreateServer } = useUIStore();
  const { accessToken } = useAuthStore();
  const { addServer } = useServerStore();
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [mode, setMode] = useState('create'); // 'create' | 'join'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${config.apiUrl}/api/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ name: name.trim() })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const server = await res.json();
      addServer(server);
      toggleCreateServer();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${config.apiUrl}/api/servers/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ inviteCode: inviteCode.trim() })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      addServer(data);
      toggleCreateServer();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={toggleCreateServer}>
      <div className="bg-[#313338] w-full max-w-md rounded-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6 text-center">
          <h2 className="text-2xl font-bold text-text-primary mb-1">
            {mode === 'create' ? 'Create a server' : 'Join a server'}
          </h2>
          <p className="text-text-muted text-sm">
            {mode === 'create'
              ? 'Your server is where you and your friends hang out. Create yours and start talking.'
              : 'Enter an invite code to join an existing server.'}
          </p>
        </div>

        {error && (
          <div className="mx-6 mb-4 bg-danger/10 border border-danger/30 text-danger text-sm rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="px-6 pb-4">
          {mode === 'create' ? (
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">Server Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#1e1f22] text-text-primary text-sm rounded px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent"
                placeholder="My Server"
                maxLength={100}
                autoFocus
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">Invite Code</label>
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="w-full bg-[#1e1f22] text-text-primary text-sm rounded px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent"
                placeholder="abc12345"
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="p-4 bg-[#2b2d31] rounded-b-lg flex items-center justify-between">
          <button
            onClick={() => setMode(mode === 'create' ? 'join' : 'create')}
            className="text-sm text-accent hover:underline"
          >
            {mode === 'create' ? 'Have an invite?' : 'Create a server instead'}
          </button>
          <button
            onClick={mode === 'create' ? handleCreate : handleJoin}
            disabled={loading || (mode === 'create' ? !name.trim() : !inviteCode.trim())}
            className="bg-accent hover:bg-accent-hover text-white text-sm font-medium px-6 py-2 rounded transition-colors disabled:opacity-50"
          >
            {loading ? 'Working...' : mode === 'create' ? 'Create' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}
