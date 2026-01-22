/**
 * Shared Server Selector Component
 * Include this on sub-pages to get server switching functionality
 * 
 * Usage:
 *   <script src="/js/server-selector.js"></script>
 *   <div id="server-selector-container"></div>
 * 
 * The component will:
 * 1. Fetch user's accessible servers
 * 2. Render a dropdown selector
 * 3. Sync with localStorage (selectedGuildId)
 * 4. Reload page data when server changes
 */

(function() {
    'use strict';

    // State
    let servers = [];
    let currentGuildId = null;
    let onServerChange = null;

    // Initialize on DOM ready
    document.addEventListener('DOMContentLoaded', initServerSelector);

    async function initServerSelector() {
        // Get current guild from URL or localStorage
        const urlParams = new URLSearchParams(window.location.search);
        currentGuildId = urlParams.get('guild') || localStorage.getItem('selectedGuildId');

        // Find container
        const container = document.getElementById('server-selector-container');
        if (!container) {
            console.log('[ServerSelector] No container found, skipping');
            return;
        }

        // Render initial loading state
        container.innerHTML = `
            <div class="server-selector-wrapper">
                <div class="server-selector-current" id="ss-current">
                    <div class="server-icon-placeholder loading">...</div>
                    <span class="server-name">Loading servers...</span>
                    <i class="fas fa-chevron-down"></i>
                </div>
                <div class="server-selector-dropdown" id="ss-dropdown" style="display: none;">
                </div>
            </div>
        `;

        // Add styles if not already present
        if (!document.getElementById('server-selector-styles')) {
            const styles = document.createElement('style');
            styles.id = 'server-selector-styles';
            styles.textContent = `
                .server-selector-wrapper {
                    position: relative;
                    min-width: 200px;
                }
                .server-selector-current {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 15px;
                    background: var(--bg-surface, rgba(0,0,0,0.2));
                    border: 1px solid var(--border-color, rgba(255,255,255,0.1));
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .server-selector-current:hover {
                    background: var(--bg-hover, rgba(255,255,255,0.05));
                    border-color: var(--color-primary, #6366f1);
                }
                .server-selector-current .server-icon {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    object-fit: cover;
                }
                .server-selector-current .server-icon-placeholder {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: var(--color-primary, #6366f1);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    color: white;
                }
                .server-selector-current .server-icon-placeholder.loading {
                    background: rgba(255,255,255,0.1);
                    animation: pulse 1s infinite;
                }
                .server-selector-current .server-name {
                    flex: 1;
                    font-weight: 500;
                    color: var(--color-text, #e2e8f0);
                }
                .server-selector-current i {
                    color: var(--color-text-muted, #94a3b8);
                    transition: transform 0.2s ease;
                }
                .server-selector-wrapper.open .server-selector-current i {
                    transform: rotate(180deg);
                }
                .server-selector-dropdown {
                    position: absolute;
                    top: calc(100% + 5px);
                    left: 0;
                    right: 0;
                    background: var(--bg-card, #1e293b);
                    border: 1px solid var(--border-color, rgba(255,255,255,0.1));
                    border-radius: 8px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                    z-index: 1000;
                    max-height: 300px;
                    overflow-y: auto;
                }
                .server-selector-option {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 15px;
                    cursor: pointer;
                    transition: background 0.15s ease;
                }
                .server-selector-option:hover {
                    background: var(--bg-hover, rgba(255,255,255,0.05));
                }
                .server-selector-option.selected {
                    background: var(--color-primary-alpha, rgba(99, 102, 241, 0.2));
                }
                .server-selector-option .server-icon {
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    object-fit: cover;
                }
                .server-selector-option .server-icon-placeholder {
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    background: var(--color-primary, #6366f1);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    font-weight: bold;
                    color: white;
                }
                .server-selector-option .server-info {
                    flex: 1;
                }
                .server-selector-option .server-info .name {
                    font-weight: 500;
                    color: var(--color-text, #e2e8f0);
                }
                .server-selector-option .server-info .members {
                    font-size: 11px;
                    color: var(--color-text-muted, #94a3b8);
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `;
            document.head.appendChild(styles);
        }

        // Load servers
        await loadServers();

        // Setup event handlers
        setupEvents();
    }

    async function loadServers() {
        try {
            const response = await fetch('/api/servers/list', {
                credentials: 'include'
            });
            
            if (!response.ok) throw new Error('Failed to fetch servers');
            
            const data = await response.json();
            servers = data.servers || [];

            renderServers();
        } catch (error) {
            console.error('[ServerSelector] Error loading servers:', error);
            const dropdown = document.getElementById('ss-dropdown');
            if (dropdown) {
                dropdown.innerHTML = `
                    <div class="server-selector-option" style="color: #ef4444;">
                        <i class="fas fa-exclamation-triangle"></i>
                        <span>Failed to load servers</span>
                    </div>
                `;
            }
        }
    }

    function renderServers() {
        const current = document.getElementById('ss-current');
        const dropdown = document.getElementById('ss-dropdown');

        if (servers.length === 0) {
            current.innerHTML = `
                <div class="server-icon-placeholder">?</div>
                <span class="server-name">No servers available</span>
            `;
            dropdown.innerHTML = `
                <div class="server-selector-option">
                    <span>No servers found. Make sure the bot is in your server.</span>
                </div>
            `;
            return;
        }

        // Find selected server
        let selected = servers.find(s => s.id === currentGuildId);
        if (!selected) {
            selected = servers[0];
            currentGuildId = selected.id;
            localStorage.setItem('selectedGuildId', currentGuildId);
            // Update URL
            const url = new URL(window.location);
            url.searchParams.set('guild', currentGuildId);
            window.history.replaceState({}, '', url);
        }

        // Render current selection
        current.innerHTML = `
            ${selected.icon 
                ? `<img src="${selected.icon}" alt="" class="server-icon" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                   <div class="server-icon-placeholder" style="display:none;">${selected.name.charAt(0).toUpperCase()}</div>`
                : `<div class="server-icon-placeholder">${selected.name.charAt(0).toUpperCase()}</div>`
            }
            <span class="server-name">${escapeHtml(selected.name)}</span>
            <i class="fas fa-chevron-down"></i>
        `;

        // Render dropdown options
        dropdown.innerHTML = servers.map(server => `
            <div class="server-selector-option ${server.id === currentGuildId ? 'selected' : ''}" data-server-id="${server.id}">
                ${server.icon 
                    ? `<img src="${server.icon}" alt="" class="server-icon" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                       <div class="server-icon-placeholder" style="display:none;">${server.name.charAt(0).toUpperCase()}</div>`
                    : `<div class="server-icon-placeholder">${server.name.charAt(0).toUpperCase()}</div>`
                }
                <div class="server-info">
                    <div class="name">${escapeHtml(server.name)}</div>
                    <div class="members">${(server.memberCount || 0).toLocaleString()} members</div>
                </div>
            </div>
        `).join('');
    }

    function setupEvents() {
        const wrapper = document.querySelector('.server-selector-wrapper');
        const current = document.getElementById('ss-current');
        const dropdown = document.getElementById('ss-dropdown');

        // Toggle dropdown
        current.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = wrapper.classList.contains('open');
            if (isOpen) {
                closeDropdown();
            } else {
                openDropdown();
            }
        });

        // Select server
        dropdown.addEventListener('click', (e) => {
            const option = e.target.closest('.server-selector-option');
            if (!option) return;
            
            const serverId = option.dataset.serverId;
            if (serverId && serverId !== currentGuildId) {
                selectServer(serverId);
            }
            closeDropdown();
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) {
                closeDropdown();
            }
        });
    }

    function openDropdown() {
        const wrapper = document.querySelector('.server-selector-wrapper');
        const dropdown = document.getElementById('ss-dropdown');
        wrapper.classList.add('open');
        dropdown.style.display = 'block';
    }

    function closeDropdown() {
        const wrapper = document.querySelector('.server-selector-wrapper');
        const dropdown = document.getElementById('ss-dropdown');
        wrapper.classList.remove('open');
        dropdown.style.display = 'none';
    }

    function selectServer(serverId) {
        const server = servers.find(s => s.id === serverId);
        if (!server) return;

        currentGuildId = serverId;
        localStorage.setItem('selectedGuildId', serverId);

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('guild', serverId);
        
        // Re-render
        renderServers();

        // Notify callback if set
        if (typeof onServerChange === 'function') {
            onServerChange(serverId, server);
        }

        // Navigate to new URL (reload page with new guild)
        window.location.href = url.toString();
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Expose API for external use
    window.ServerSelector = {
        getCurrentGuildId: () => currentGuildId,
        getServers: () => servers,
        refresh: loadServers,
        onServerChange: (callback) => { onServerChange = callback; }
    };
})();
