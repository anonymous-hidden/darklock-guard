import React from 'react';
import { useServerStore } from '../../store/serverStore';

export default function MembersList({ getStatus }) {
  const { activeServerId, members } = useServerStore();
  const serverMembers = members[activeServerId] || [];

  const online = serverMembers.filter(m => getStatus(m.id) === 'online');
  const away = serverMembers.filter(m => getStatus(m.id) === 'away');
  const offline = serverMembers.filter(m => getStatus(m.id) === 'offline');

  const statusDot = (status) => {
    const colors = { online: 'bg-success', away: 'bg-warning', offline: 'bg-text-muted' };
    return colors[status] || colors.offline;
  };

  const roleLabel = (role) => {
    if (role === 'owner') return <span className="text-[10px] bg-warning/20 text-warning px-1 rounded">Owner</span>;
    if (role === 'admin') return <span className="text-[10px] bg-accent/20 text-accent px-1 rounded">Admin</span>;
    return null;
  };

  const renderGroup = (title, members, status) => {
    if (members.length === 0) return null;
    return (
      <div className="mb-4">
        <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wide px-2 mb-1">
          {title} — {members.length}
        </h3>
        {members.map(member => (
          <div
            key={member.id}
            className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-bg-hover cursor-pointer group"
          >
            <div className="relative">
              <div className={`w-8 h-8 bg-accent/40 rounded-full flex items-center justify-center text-xs font-medium text-text-primary ${status === 'offline' ? 'opacity-40' : ''}`}>
                {member.username_hash?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 ${statusDot(status)} rounded-full border-2 border-[#1e1f22]`} />
            </div>
            <div className="flex items-center gap-1 min-w-0">
              <span className={`text-sm truncate ${status === 'offline' ? 'text-text-muted' : 'text-text-secondary group-hover:text-text-primary'}`}>
                {member.username_hash?.slice(0, 8) || 'User'}
              </span>
              {roleLabel(member.role)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="w-60 bg-[#1e1f22] flex flex-col shrink-0 border-l border-[#1f2023]">
      <div className="flex-1 overflow-y-auto py-4">
        {renderGroup('Online', online, 'online')}
        {renderGroup('Away', away, 'away')}
        {renderGroup('Offline', offline, 'offline')}
        {serverMembers.length === 0 && (
          <p className="text-text-muted text-sm text-center px-4 mt-4">No members</p>
        )}
      </div>
    </div>
  );
}
