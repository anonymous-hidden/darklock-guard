import React, { useState } from 'react';
import { useNovaStore } from '../../store/novaStore';

export default function MemoryPanel() {
  const memories = useNovaStore(s => s.memories);
  const recentMemories = useNovaStore(s => s.recentMemories);
  const refreshMemories = useNovaStore(s => s.refreshMemories);
  const searchMemories = useNovaStore(s => s.searchMemories);
  const [tab, setTab] = useState('profile'); // 'profile' | 'recent' | 'search'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    const results = await searchMemories(searchQuery);
    setSearchResults(results);
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <span>🧬</span> Nova's Memory
        </h3>
        <button
          onClick={refreshMemories}
          className="text-xs text-text-muted hover:text-text-primary transition-colors"
        >↻</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-2">
        {['profile', 'recent', 'search'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${
              tab === t
                ? 'text-accent border-b-2 border-accent'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t === 'profile' ? `What Nova Knows (${memories.length})` : t === 'recent' ? 'Recent' : 'Search'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {tab === 'profile' && (
          <div className="space-y-2">
            {memories.length === 0 ? (
              <div className="text-text-muted text-xs text-center py-4">
                Nova hasn't learned anything about you yet.
                <br />Chat with her and she'll start remembering.
              </div>
            ) : (
              memories.map((mem, i) => (
                <div key={i} className="p-2 rounded-lg bg-bg-primary text-xs">
                  <span className="text-accent font-medium">{mem.key}:</span>{' '}
                  <span className="text-text-secondary">{typeof mem.value === 'string' ? mem.value : JSON.stringify(mem.value)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'recent' && (
          <div className="space-y-2">
            {recentMemories.length === 0 ? (
              <div className="text-text-muted text-xs text-center py-4">No recent memory activity.</div>
            ) : (
              recentMemories.map((mem, i) => (
                <div key={i} className="p-2 rounded-lg bg-bg-primary text-xs">
                  <div className="text-text-secondary">{typeof mem === 'string' ? mem : mem.content || mem.value || JSON.stringify(mem)}</div>
                  {mem.timestamp && (
                    <div className="text-text-muted mt-1 text-[10px]">
                      {new Date(mem.timestamp).toLocaleString()}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'search' && (
          <div>
            <div className="flex gap-2 mb-3">
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Search Nova's memories..."
                className="flex-1 bg-bg-primary text-text-primary text-xs rounded-lg px-3 py-2 border border-border focus:border-accent outline-none"
              />
              <button
                onClick={handleSearch}
                className="px-3 py-2 bg-accent text-white text-xs rounded-lg hover:bg-accent-hover"
              >Search</button>
            </div>
            <div className="space-y-2">
              {searchResults.map((r, i) => (
                <div key={i} className="p-2 rounded-lg bg-bg-primary text-xs text-text-secondary">
                  {typeof r === 'string' ? r : r.content || r.value || JSON.stringify(r)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
