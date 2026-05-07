import React, { useState, useEffect } from 'react';

const API = 'http://127.0.0.1:8950/api';

export default function MemoriesPanel({ onClose }) {
  const [profile, setProfile] = useState({});
  const [memories, setMemories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/memory/profile`).then(r => r.json()).catch(() => ({})),
      fetch(`${API}/memory/recent?count=50`).then(r => r.json()).catch(() => []),
    ]).then(([prof, mems]) => {
      setProfile(prof || {});
      setMemories(Array.isArray(mems) ? mems : []);
      setLoading(false);
    });
  }, []);

  const doSearch = () => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    fetch(`${API}/memory/search?q=${encodeURIComponent(searchQuery)}`)
      .then(r => r.json())
      .then(data => setSearchResults(Array.isArray(data) ? data : []))
      .catch(() => setSearchResults([]));
  };

  const profileEntries = Object.entries(profile).filter(([k]) => !k.startsWith('_'));
  const displayMemories = searchResults !== null ? searchResults : memories;

  return (
    <div className="memories-panel">
      <div className="memories-header">
        <h2>◈ Memories</h2>
        <button className="memories-close" onClick={onClose}>✕</button>
      </div>

      {loading ? (
        <div className="memories-loading">Loading memories...</div>
      ) : (
        <>
          {/* User Profile Facts */}
          {profileEntries.length > 0 && (
            <div className="memories-section">
              <h3>▸ What I Know About You</h3>
              <div className="memories-facts">
                {profileEntries.map(([key, value]) => (
                  <div key={key} className="memory-fact">
                    <span className="memory-fact-key">{key}</span>
                    <span className="memory-fact-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <div className="memories-search">
            <input
              className="memories-search-input"
              type="text"
              placeholder="Search memories..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
            />
            <button className="memories-search-btn" onClick={doSearch}>⌕</button>
            {searchResults !== null && (
              <button className="memories-search-clear" onClick={() => { setSearchQuery(''); setSearchResults(null); }}>
                Clear
              </button>
            )}
          </div>

          {/* Long-term Memories */}
          <div className="memories-section">
            <h3>{searchResults !== null ? `⌕ Results (${displayMemories.length})` : `▸ Long-Term Memories (${displayMemories.length})`}</h3>
            {displayMemories.length === 0 ? (
              <div className="memories-empty">
                {searchResults !== null ? 'No memories match that search.' : 'No memories stored yet. Chat with Nova and memories will form over time.'}
              </div>
            ) : (
              <div className="memories-list">
                {displayMemories.map((m, i) => (
                  <div key={m.id || i} className="memory-item">
                    <div className="memory-item-header">
                      <span className="memory-item-category">{m.category || '—'}</span>
                      <span className="memory-item-importance">
                        {'★'.repeat(Math.min(m.importance || 0, 5))}
                        {'☆'.repeat(5 - Math.min(m.importance || 0, 5))}
                      </span>
                    </div>
                    <div className="memory-item-key">{m.key}</div>
                    <div className="memory-item-value">{m.value}</div>
                    <div className="memory-item-meta">
                      {m.created_at && <span>{new Date(m.created_at).toLocaleDateString()}</span>}
                      {m.access_count > 0 && <span>recalled {m.access_count}×</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
