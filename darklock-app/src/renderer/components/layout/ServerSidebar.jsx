import React from 'react';
import { useUIStore } from '../../store/uiStore';

export default function ServerSidebar({ servers, activeServerId, onSelectServer }) {
  const toggleCreateServer = useUIStore(s => s.toggleCreateServer);
  const toggleNovaCommandCenter = useUIStore(s => s.toggleNovaCommandCenter);
  const showNova = useUIStore(s => s.showNovaCommandCenter);

  return (
    <div className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-2 overflow-y-auto shrink-0">
      {/* DarkLock logo */}
      <button className="w-12 h-12 bg-bg-tertiary rounded-2xl hover:rounded-xl hover:bg-accent transition-all flex items-center justify-center group">
        <svg className="w-6 h-6 text-text-primary group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </button>

      {/* Divider */}
      <div className="w-8 h-[2px] bg-bg-hover rounded-full" />

      {/* Nova AI Command Center button */}
      <div className="relative group">
        {showNova && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[10px] w-2 h-10 bg-white rounded-r-full" />
        )}
        <button
          onClick={toggleNovaCommandCenter}
          className={`w-12 h-12 rounded-2xl hover:rounded-xl transition-all flex items-center justify-center group ${
            showNova
              ? 'bg-gradient-to-br from-accent to-[#eb459e] rounded-xl'
              : 'bg-bg-tertiary hover:bg-gradient-to-br hover:from-accent hover:to-[#eb459e]'
          }`}
          title="Nova Command Center"
        >
          <span className="text-lg">🤖</span>
        </button>
        <div className="absolute left-16 top-1/2 -translate-y-1/2 bg-[#111214] text-white text-sm px-3 py-2 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
          Nova Command Center
        </div>
      </div>

      {/* Divider */}
      <div className="w-8 h-[2px] bg-bg-hover rounded-full" />

      {/* Server list */}
      {servers.map(server => (
        <div key={server.id} className="relative group">
          {/* Active indicator */}
          {activeServerId === server.id && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[10px] w-2 h-10 bg-white rounded-r-full" />
          )}
          <button
            onClick={() => onSelectServer(server.id)}
            className={`w-12 h-12 rounded-2xl hover:rounded-xl transition-all flex items-center justify-center text-sm font-semibold text-white ${
              activeServerId === server.id
                ? 'bg-accent rounded-xl'
                : 'bg-bg-tertiary hover:bg-accent'
            }`}
            title={server.name}
          >
            {server.name.charAt(0).toUpperCase()}
          </button>
          {/* Hover tooltip */}
          <div className="absolute left-16 top-1/2 -translate-y-1/2 bg-[#111214] text-white text-sm px-3 py-2 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
            {server.name}
          </div>
        </div>
      ))}

      {/* Add server */}
      <button
        onClick={toggleCreateServer}
        className="w-12 h-12 bg-bg-tertiary rounded-2xl hover:rounded-xl hover:bg-success transition-all flex items-center justify-center group"
        title="Add a server"
      >
        <svg className="w-5 h-5 text-success group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
}
