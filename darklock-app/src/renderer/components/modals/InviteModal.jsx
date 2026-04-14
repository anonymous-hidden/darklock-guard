import React, { useState, useEffect } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { useServerStore } from '../../store/serverStore';
import { config } from '../../config';

export default function InviteModal() {
  const { toggleInviteModal, inviteServerId } = useUIStore();
  const { accessToken } = useAuthStore();
  const { servers, activeServerId } = useServerStore();
  const serverId = inviteServerId || activeServerId;
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const server = servers.find(s => s.id === serverId);

  useEffect(() => {
    if (server?.inviteCode) {
      setInviteCode(server.inviteCode);
      setLoading(false);
    } else if (serverId) {
      fetchInvite();
    }
  }, [serverId]);

  const fetchInvite = async () => {
    try {
      const res = await fetch(`${config.apiUrl}/api/servers/${serverId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setInviteCode(data.inviteCode || '');
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={toggleInviteModal}>
      <div className="bg-[#313338] w-full max-w-md rounded-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-text-primary">
              Invite friends to {server?.name || 'server'}
            </h2>
            <button onClick={toggleInviteModal} className="text-text-muted hover:text-text-primary text-xl">
              ✕
            </button>
          </div>

          {loading ? (
            <div className="text-text-muted text-sm text-center py-4">Loading invite...</div>
          ) : inviteCode ? (
            <div>
              <p className="text-text-secondary text-sm mb-3">
                Share this invite code with others to let them join.
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-[#1e1f22] rounded px-3 py-2.5 text-text-primary text-sm font-mono select-all">
                  {inviteCode}
                </div>
                <button
                  onClick={handleCopy}
                  className={`text-sm font-medium px-6 py-2.5 rounded transition-colors ${
                    copied
                      ? 'bg-success text-white'
                      : 'bg-accent hover:bg-accent-hover text-white'
                  }`}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-text-muted text-sm">No invite code available for this server.</p>
          )}
        </div>
      </div>
    </div>
  );
}
