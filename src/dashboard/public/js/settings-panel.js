/**
 * Dashboard Settings Panel
 * Handles appearance, account, notifications, security, and admin settings
 */

class SettingsPanel {
    constructor() {
        this.settings = this.loadSettings();
        this.activeTab = 'appearance';
        
        this.init();
    }

    /**
     * Default settings
     */
    getDefaultSettings() {
        return {
            // Appearance
            theme: 'auto',
            accentColor: '#4ade80',
            compactMode: false,
            animations: true,
            sidebarCollapsed: false,
            language: 'en',
            timeFormat: '12hr',
            dateFormat: 'MM/DD/YYYY',
            
            // Clock Widget
            clockEnabled: true,
            clockPosition: 'top-right',
            clockSize: 'medium',
            clockShowSeconds: false,
            clockShowDate: true,
            clockShowTimezone: false,
            clockStyle: 'modern',
            
            // Settings Bobble Widget
            bobbleEnabled: true,
            bobblePosition: 'top-right',
            bobbleSize: 'medium',
            bobbleOpacity: 100,
            bobbleAutoHide: false,
            
            // Notifications
            dashboardAlerts: true,
            soundEffects: false,
            desktopNotifications: false,
            emailDigest: 'none',
            criticalOnly: false,
            
            // Security
            sessionTimeout: 30,
            require2FAForActions: false,
            auditMyActions: true,
            
            // Quick Actions
            quickActions: ['settings', 'theme', 'notifications', 'refresh', 'logout'],
            
            // Admin (guild-specific)
            guildDefaultTheme: null,
            forceGuildTheme: false
        };
    }

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        const stored = localStorage.getItem('dashboardSettings');
        if (stored) {
            try {
                return { ...this.getDefaultSettings(), ...JSON.parse(stored) };
            } catch (e) {
                console.error('Failed to parse settings:', e);
            }
        }
        return this.getDefaultSettings();
    }

    /**
     * Save settings to localStorage and server
     */
    async saveSettings() {
        localStorage.setItem('dashboardSettings', JSON.stringify(this.settings));
        
        // Also save to server for cross-device sync
        try {
            await fetch('/api/user/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.getCSRFToken()
                },
                credentials: 'include',
                body: JSON.stringify(this.settings)
            });
        } catch (e) {
            console.warn('Failed to sync settings to server:', e);
        }
        
        this.showToast('Settings saved!', 'success');
    }

    /**
     * Available quick actions
     */
    getAvailableQuickActions() {
        return [
            { id: 'settings', name: 'Settings', icon: 'fa-cog', desc: 'Open settings panel', action: () => this.open() },
            { id: 'dashboard', name: 'Dashboard', icon: 'fa-home', desc: 'Go to dashboard', href: '/dashboard' },
            { id: '2fa', name: '2FA', icon: 'fa-shield-alt', desc: '2FA settings', href: '/setup-2fa' },
            { id: 'help', name: 'Help', icon: 'fa-question-circle', desc: 'Get help', href: '/help' },
            { id: 'theme', name: 'Theme', icon: 'fa-palette', desc: 'Cycle theme', action: () => { 
                const themes = ['dark', 'light', 'auto'];
                const currentIndex = themes.indexOf(this.settings.theme || 'auto');
                const nextIndex = (currentIndex + 1) % themes.length;
                this.settings.theme = themes[nextIndex];
                localStorage.setItem('dashboardSettings', JSON.stringify(this.settings));
                this.applyTheme();
                this.updateThemeBadge();
                const themeName = themes[nextIndex] === 'auto' ? 'Auto (System)' : themes[nextIndex].charAt(0).toUpperCase() + themes[nextIndex].slice(1);
                this.showToast(`Theme: ${themeName}`, 'success');
            } },
            { id: 'profile', name: 'Profile', icon: 'fa-user', desc: 'View profile', action: () => { const userBtn = document.querySelector('.user-info'); if (userBtn) userBtn.click(); } },
            { id: 'notifications', name: 'Notifications', icon: 'fa-bell-slash', desc: 'Notification settings', action: () => { this.open(); setTimeout(() => { const notifTab = document.querySelector('[data-tab="notifications"]'); if (notifTab) notifTab.click(); }, 100); } },
            { id: 'darkmode', name: 'Dark Mode', icon: 'fa-moon', desc: 'Toggle dark mode', action: () => { const currentTheme = this.settings.theme; this.settings.theme = currentTheme === 'dark' ? 'light' : 'dark'; localStorage.setItem('dashboardSettings', JSON.stringify(this.settings)); this.applyTheme(); this.updateThemeBadge(); this.showToast(`Switched to ${this.settings.theme} mode`, 'success'); } },
            { id: 'language', name: 'Language', icon: 'fa-language', desc: 'Change language', action: () => { this.open(); setTimeout(() => { const appearanceTab = document.querySelector('[data-tab="appearance"]'); if (appearanceTab) appearanceTab.click(); }, 100); } },
            { id: 'security', name: 'Security', icon: 'fa-lock', desc: 'Security settings', action: () => { this.open(); setTimeout(() => { const securityTab = document.querySelector('[data-tab="security"]'); if (securityTab) securityTab.click(); }, 100); } },
            { id: 'logout', name: 'Logout', icon: 'fa-sign-out-alt', desc: 'Sign out', action: () => { if (confirm('Are you sure you want to logout?')) { document.cookie = 'dashboardToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'; localStorage.removeItem('dashboardToken'); localStorage.removeItem('selectedGuildId'); window.location.href = '/login'; } } },
            { id: 'refresh', name: 'Refresh', icon: 'fa-sync-alt', desc: 'Refresh dashboard', action: () => { if (typeof refreshDashboard === 'function') refreshDashboard(); else location.reload(); } }
        ];
    }

    /**
     * Get Quick Actions HTML for embedding in dashboard
     */
    getQuickActionsHTML() {
        const selectedActions = this.settings.quickActions || ['settings', 'theme', 'notifications', 'refresh', 'logout'];
        
        // Remove duplicates (in case of old settings)
        const uniqueActions = [...new Set(selectedActions)];
        
        const availableActions = this.getAvailableQuickActions();
        
        const actionsHTML = uniqueActions.map(actionId => {
            const action = availableActions.find(a => a.id === actionId);
            if (!action) return '';
            if (action.href) {
                return `
                    <a href="${action.href}" class="quick-action-item-horizontal">
                        <i class="fas ${action.icon}"></i>
                        <span>${action.name}</span>
                    </a>
                `;
            } else {
                return `
                    <div class="quick-action-item-horizontal" onclick="window.settingsPanel.executeQuickAction('${action.id}')">
                        <i class="fas ${action.icon}"></i>
                        <span>${action.name}</span>
                    </div>
                `;
            }
        }).join('');

        return `
            <div class="quick-actions-panel-bottom" id="quickActionsPanel">
                <div class="quick-actions-bottom-container">
                    <div class="quick-actions-header-inline">
                        <h3><i class="fas fa-bolt"></i> Quick Actions</h3>
                        <button class="quick-actions-edit-btn" title="Customize" onclick="event.stopPropagation(); window.settingsPanel.openQuickActionsEditor()">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <div class="quick-actions-grid-horizontal" id="quickActionsGrid">
                        ${actionsHTML}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Initialize the settings panel
     */
    init() {
        this.createModal();
        this.createSettingsBobble();
        this.createQuickActionsEditor();
        this.createClockWidget();
        this.applySettings();
        this.injectQuickActionsPanel();
        
        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (this.settings.theme === 'auto') {
                this.applyTheme();
            }
        });
    }

    /**
     * Create the clock widget
     */
    createClockWidget() {
        // Remove existing clock if any
        const existingClock = document.getElementById('dashboardClock');
        if (existingClock) existingClock.remove();

        // Create clock element
        const clock = document.createElement('div');
        clock.className = 'dashboard-clock';
        clock.id = 'dashboardClock';
        clock.innerHTML = `
            <div class="clock-time" id="clockTime">00:00</div>
            <div class="clock-date" id="clockDate"></div>
            <div class="clock-timezone" id="clockTimezone"></div>
        `;
        
        document.body.appendChild(clock);
        
        // Start the clock
        this.updateClock();
        this.clockInterval = setInterval(() => this.updateClock(), 1000);
    }

    /**
     * Update the clock display
     */
    updateClock() {
        const clock = document.getElementById('dashboardClock');
        const timeEl = document.getElementById('clockTime');
        const dateEl = document.getElementById('clockDate');
        const timezoneEl = document.getElementById('clockTimezone');
        
        if (!clock || !timeEl) return;

        const now = new Date();
        
        // Time formatting
        let hours = now.getHours();
        let minutes = now.getMinutes();
        let seconds = now.getSeconds();
        let ampm = '';
        
        if (this.settings.timeFormat === '12hr') {
            ampm = hours >= 12 ? ' PM' : ' AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
        }
        
        const timeStr = this.settings.clockShowSeconds 
            ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${ampm}`
            : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}${ampm}`;
        
        timeEl.textContent = timeStr;
        
        // Date formatting
        if (this.settings.clockShowDate && dateEl) {
            const day = now.getDate();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();
            const weekday = now.toLocaleDateString('en-US', { weekday: 'short' });
            
            let dateStr = '';
            switch (this.settings.dateFormat) {
                case 'DD/MM/YYYY':
                    dateStr = `${weekday}, ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
                    break;
                case 'YYYY-MM-DD':
                    dateStr = `${weekday}, ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    break;
                default:
                    dateStr = `${weekday}, ${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
            }
            dateEl.textContent = dateStr;
            dateEl.style.display = 'block';
        } else if (dateEl) {
            dateEl.style.display = 'none';
        }
        
        // Timezone
        if (this.settings.clockShowTimezone && timezoneEl) {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const offset = now.getTimezoneOffset();
            const offsetHours = Math.abs(Math.floor(offset / 60));
            const offsetMins = Math.abs(offset % 60);
            const offsetSign = offset <= 0 ? '+' : '-';
            timezoneEl.textContent = `${timezone} (UTC${offsetSign}${offsetHours}:${String(offsetMins).padStart(2, '0')})`;
            timezoneEl.style.display = 'block';
        } else if (timezoneEl) {
            timezoneEl.style.display = 'none';
        }
    }

    /**
     * Apply clock settings (position, size, visibility)
     */
    applyClockSettings() {
        const clock = document.getElementById('dashboardClock');
        if (!clock) return;
        
        // Visibility
        clock.style.display = this.settings.clockEnabled ? 'flex' : 'none';
        
        // Remove all position classes
        clock.classList.remove('clock-top-left', 'clock-top-center', 'clock-top-right', 
                              'clock-bottom-left', 'clock-bottom-center', 'clock-bottom-right',
                              'clock-sidebar-top', 'clock-sidebar-bottom');
        
        // Add position class
        clock.classList.add(`clock-${this.settings.clockPosition}`);
        
        // Remove all size classes
        clock.classList.remove('clock-tiny', 'clock-small', 'clock-medium', 'clock-large', 'clock-xlarge');
        
        // Add size class
        clock.classList.add(`clock-${this.settings.clockSize}`);
        
        // Remove all style classes
        clock.classList.remove('clock-style-minimal', 'clock-style-modern', 'clock-style-classic', 'clock-style-neon', 'clock-style-glassmorphic');
        
        // Add style class
        clock.classList.add(`clock-style-${this.settings.clockStyle}`);
    }

    /**
     * Apply bobble settings (position, size, opacity, auto-hide)
     */
    applyBobbleSettings() {
        const bobble = document.getElementById('settingsBobble');
        if (!bobble) return;
        
        // Visibility
        bobble.style.display = this.settings.bobbleEnabled ? 'flex' : 'none';
        
        // Position - set based on corner
        bobble.style.top = '';
        bobble.style.bottom = '';
        bobble.style.left = '';
        bobble.style.right = '';
        
        switch (this.settings.bobblePosition) {
            case 'top-left':
                bobble.style.top = '20px';
                bobble.style.left = '20px';
                break;
            case 'top-right':
                bobble.style.top = '20px';
                bobble.style.right = '20px';
                break;
            case 'bottom-left':
                bobble.style.bottom = '20px';
                bobble.style.left = '20px';
                break;
            case 'bottom-right':
                bobble.style.bottom = '20px';
                bobble.style.right = '20px';
                break;
        }
        
        // Clear saved drag position when switching to corner positioning
        localStorage.removeItem('settingsBobblePosition');
        
        // Size
        bobble.classList.remove('bobble-small', 'bobble-medium', 'bobble-large');
        bobble.classList.add(`bobble-${this.settings.bobbleSize}`);
        
        // Opacity
        bobble.style.opacity = this.settings.bobbleOpacity / 100;
        
        // Auto-hide
        if (this.settings.bobbleAutoHide) {
            bobble.classList.add('bobble-auto-hide');
        } else {
            bobble.classList.remove('bobble-auto-hide');
        }
    }

    /**
     * Create the draggable settings bobble
     */
    createSettingsBobble() {
        // Remove any existing bobbles first to prevent duplicates
        const existingBobble = document.getElementById('settingsBobble');
        if (existingBobble) {
            existingBobble.remove();
        }
        
        const bobble = document.createElement('div');
        bobble.className = 'settings-bobble';
        bobble.id = 'settingsBobble';
        bobble.innerHTML = `
            <i class="fas fa-cog"></i>
            <span class="bobble-tooltip">Settings</span>
        `;
        
        // Load saved position and clamp to current viewport
        const savedPos = localStorage.getItem('settingsBobblePosition');
        if (savedPos) {
            const pos = JSON.parse(savedPos);
            // Parse the saved pixel values
            let savedLeft = parseInt(pos.left) || 0;
            let savedTop = parseInt(pos.top) || 0;
            
            // Clamp to current viewport (bobble is ~48px, leave 10px margin)
            const bobbleSize = 48;
            const margin = 10;
            const maxLeft = window.innerWidth - bobbleSize - margin;
            const maxTop = window.innerHeight - bobbleSize - margin;
            
            const clampedLeft = Math.max(margin, Math.min(savedLeft, maxLeft));
            const clampedTop = Math.max(margin, Math.min(savedTop, maxTop));
            
            bobble.style.top = clampedTop + 'px';
            bobble.style.right = 'auto';
            bobble.style.left = clampedLeft + 'px';
            
            // Update saved position if it was clamped
            if (clampedLeft !== savedLeft || clampedTop !== savedTop) {
                localStorage.setItem('settingsBobblePosition', JSON.stringify({
                    left: clampedLeft + 'px',
                    top: clampedTop + 'px'
                }));
            }
        }
        
        // Re-clamp position on window resize
        window.addEventListener('resize', () => {
            this.clampBobblePosition(bobble);
        });
        
        // Click to open settings
        bobble.addEventListener('click', (e) => {
            if (!bobble.classList.contains('was-dragged')) {
                this.open();
            }
            bobble.classList.remove('was-dragged');
        });
        
        // Make draggable
        this.makeDraggable(bobble);
        
        document.body.appendChild(bobble);
    }

    /**
     * Make an element draggable
     */
    makeDraggable(element) {
        let isDragging = false;
        let startX, startY, startLeft, startTop;
        let hasMoved = false;

        const onMouseDown = (e) => {
            if (e.target.closest('.bobble-tooltip')) return;
            
            isDragging = true;
            hasMoved = false;
            element.classList.add('dragging');
            
            const rect = element.getBoundingClientRect();
            startX = e.clientX || e.touches?.[0]?.clientX;
            startY = e.clientY || e.touches?.[0]?.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            
            e.preventDefault();
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            
            const clientX = e.clientX || e.touches?.[0]?.clientX;
            const clientY = e.clientY || e.touches?.[0]?.clientY;
            
            const deltaX = clientX - startX;
            const deltaY = clientY - startY;
            
            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                hasMoved = true;
            }
            
            let newLeft = startLeft + deltaX;
            let newTop = startTop + deltaY;
            
            // Keep within viewport
            const maxLeft = window.innerWidth - element.offsetWidth;
            const maxTop = window.innerHeight - element.offsetHeight;
            
            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));
            
            element.style.left = newLeft + 'px';
            element.style.top = newTop + 'px';
            element.style.right = 'auto';
        };

        const onMouseUp = () => {
            if (!isDragging) return;
            
            isDragging = false;
            element.classList.remove('dragging');
            
            if (hasMoved) {
                element.classList.add('was-dragged');
                // Save position
                localStorage.setItem('settingsBobblePosition', JSON.stringify({
                    left: element.style.left,
                    top: element.style.top
                }));
            }
        };

        element.addEventListener('mousedown', onMouseDown);
        element.addEventListener('touchstart', onMouseDown, { passive: false });
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('touchmove', onMouseMove, { passive: false });
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchend', onMouseUp);
    }

    /**
     * Clamp bobble position to current viewport (called on window resize)
     */
    clampBobblePosition(bobble) {
        if (!bobble) return;
        
        const bobbleSize = 48;
        const margin = 10;
        const maxLeft = window.innerWidth - bobbleSize - margin;
        const maxTop = window.innerHeight - bobbleSize - margin;
        
        let currentLeft = parseInt(bobble.style.left) || margin;
        let currentTop = parseInt(bobble.style.top) || margin;
        
        const clampedLeft = Math.max(margin, Math.min(currentLeft, maxLeft));
        const clampedTop = Math.max(margin, Math.min(currentTop, maxTop));
        
        if (clampedLeft !== currentLeft || clampedTop !== currentTop) {
            bobble.style.left = clampedLeft + 'px';
            bobble.style.top = clampedTop + 'px';
            
            // Update saved position
            localStorage.setItem('settingsBobblePosition', JSON.stringify({
                left: clampedLeft + 'px',
                top: clampedTop + 'px'
            }));
        }
    }

    /**
     * Inject Quick Actions panel into the dashboard
     */
    injectQuickActionsPanel() {
        // Check if Quick Actions already exists
        if (document.getElementById('quickActionsPanel')) return;

        // Get selected quick actions (default set if none saved)
        const selectedActions = this.settings.quickActions || ['settings', 'users', 'logs', '2fa', 'security'];
        const availableActions = this.getAvailableQuickActions();

        const panel = document.createElement('div');
        panel.className = 'quick-actions-panel-bottom';
        panel.id = 'quickActionsPanel';
        panel.innerHTML = `
            <div class="quick-actions-bottom-container">
                <div class="quick-actions-header-inline">
                    <h3><i class="fas fa-bolt"></i> Quick Actions</h3>
                    <button class="quick-actions-edit-btn" title="Customize" onclick="event.stopPropagation(); settingsPanel.openQuickActionsEditor()">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
                <div class="quick-actions-grid-horizontal" id="quickActionsGrid">
                    ${selectedActions.map(actionId => {
                        const action = availableActions.find(a => a.id === actionId);
                        if (!action) return '';
                        if (action.href) {
                            return `
                                <a href="${action.href}" class="quick-action-item-horizontal">
                                    <i class="fas ${action.icon}"></i>
                                    <span>${action.name}</span>
                                </a>
                            `;
                        } else {
                            return `
                                <div class="quick-action-item-horizontal" onclick="settingsPanel.executeQuickAction('${action.id}')">
                                    <i class="fas ${action.icon}"></i>
                                    <span>${action.name}</span>
                                </div>
                            `;
                        }
                    }).join('')}
                </div>
            </div>
        `;

        // Insert at the bottom of dashboard content
        const quickActionsContainer = document.getElementById('quickActionsContainer');
        const dashboardContent = document.getElementById('dashboardContent');
        
        if (quickActionsContainer) {
            // Preferred: use dedicated container
            quickActionsContainer.appendChild(panel);
        } else if (dashboardContent) {
            // Fallback: append to dashboard content
            dashboardContent.appendChild(panel);
        } else {
            // Last resort: insert into main content area
            const mainContent = document.querySelector('.page-content') || document.querySelector('main');
            if (mainContent) {
                mainContent.appendChild(panel);
            }
        }
    }
    
    /**
     * Toggle Quick Actions panel collapsed state
     */
    toggleQuickActionsPanel() {
        const panel = document.getElementById('quickActionsPanel');
        if (panel) {
            panel.classList.toggle('collapsed');
            localStorage.setItem('quickActionsCollapsed', panel.classList.contains('collapsed'));
        }
    }

    /**
     * Execute a quick action by ID
     */
    executeQuickAction(actionId) {
        const actions = this.getAvailableQuickActions();
        const action = actions.find(a => a.id === actionId);
        if (action?.action) {
            action.action();
        }
    }

    /**
     * Create the Quick Actions editor modal
     */
    createQuickActionsEditor() {
        const editor = document.createElement('div');
        editor.className = 'quick-actions-editor';
        editor.id = 'quickActionsEditor';
        editor.innerHTML = `
            <div class="quick-actions-editor-content">
                <div class="quick-actions-editor-header">
                    <h3><i class="fas fa-edit"></i> Customize Quick Actions</h3>
                    <button class="settings-close" onclick="settingsPanel.closeQuickActionsEditor()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="quick-actions-editor-body">
                    <p class="available-actions-title">Select the actions you want in your Quick Actions panel:</p>
                    <div class="available-actions-list" id="availableActionsList">
                        <!-- Populated by JS -->
                    </div>
                </div>
                <div class="quick-actions-editor-footer">
                    <button class="btn-settings btn-secondary" onclick="settingsPanel.closeQuickActionsEditor()">
                        Cancel
                    </button>
                    <button class="btn-settings btn-primary" onclick="settingsPanel.saveQuickActions()">
                        <i class="fas fa-check"></i> Save
                    </button>
                </div>
            </div>
        `;

        // Close on overlay click
        editor.addEventListener('click', (e) => {
            if (e.target === editor) this.closeQuickActionsEditor();
        });

        document.body.appendChild(editor);
    }

    /**
     * Open the Quick Actions editor
     */
    openQuickActionsEditor() {
        const editor = document.getElementById('quickActionsEditor');
        const list = document.getElementById('availableActionsList');
        
        const selectedActions = this.settings.quickActions || ['settings', 'theme', 'users', 'logs', '2fa', 'security'];
        const availableActions = this.getAvailableQuickActions();

        list.innerHTML = availableActions.map(action => `
            <div class="available-action-item ${selectedActions.includes(action.id) ? 'selected' : ''}" 
                 data-action-id="${action.id}"
                 onclick="settingsPanel.toggleQuickAction(this, '${action.id}')">
                <i class="fas ${action.icon}"></i>
                <div class="action-info">
                    <div class="action-name">${action.name}</div>
                    <div class="action-desc">${action.desc}</div>
                </div>
            </div>
        `).join('');

        editor.classList.add('active');
    }

    /**
     * Close the Quick Actions editor
     */
    closeQuickActionsEditor() {
        document.getElementById('quickActionsEditor').classList.remove('active');
    }

    /**
     * Toggle a quick action selection
     */
    toggleQuickAction(element, actionId) {
        element.classList.toggle('selected');
    }

    /**
     * Save quick actions selection
     */
    saveQuickActions() {
        const selected = Array.from(document.querySelectorAll('.available-action-item.selected'))
            .map(el => el.dataset.actionId);
        
        this.settings.quickActions = selected;
        this.saveSettings();
        
        // Refresh the panel
        const panel = document.getElementById('quickActionsPanel');
        if (panel) {
            panel.remove();
            this.injectQuickActionsPanel();
        }
        
        this.closeQuickActionsEditor();
        this.showToast('Quick Actions updated!', 'success');
    }

    /**
     * Create the settings modal HTML
     */
    createModal() {
        const modal = document.createElement('div');
        modal.className = 'settings-overlay';
        modal.id = 'settingsModal';
        modal.innerHTML = `
            <div class="settings-modal">
                <div class="settings-header">
                    <h2><i class="fas fa-cog"></i> Settings</h2>
                    <button class="settings-close" onclick="settingsPanel.close()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="settings-tabs">
                    <button class="settings-tab active" data-tab="appearance" onclick="settingsPanel.switchTab('appearance')">
                        <i class="fas fa-palette"></i>
                        <span>Appearance</span>
                    </button>
                    <button class="settings-tab" data-tab="account" onclick="settingsPanel.switchTab('account')">
                        <i class="fas fa-user"></i>
                        <span>Account</span>
                    </button>
                    <button class="settings-tab" data-tab="notifications" onclick="settingsPanel.switchTab('notifications')">
                        <i class="fas fa-bell"></i>
                        <span>Notifications</span>
                    </button>
                    <button class="settings-tab" data-tab="security" onclick="settingsPanel.switchTab('security')">
                        <i class="fas fa-shield-alt"></i>
                        <span>Security</span>
                    </button>
                    <button class="settings-tab" data-tab="widgets" onclick="settingsPanel.switchTab('widgets')">
                        <i class="fas fa-th-large"></i>
                        <span>Widgets</span>
                    </button>
                </div>
                
                <div class="settings-content">
                    <!-- Appearance Tab -->
                    <div class="settings-section active" id="tab-appearance">
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-moon"></i> Theme
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Color Scheme</div>
                                    <div class="settings-item-desc">Choose your preferred color scheme</div>
                                </div>
                                <span class="current-theme-badge" id="currentThemeBadge">
                                    <i class="fas fa-${this.settings.theme === 'light' ? 'sun' : this.settings.theme === 'dark' ? 'moon' : 'wand-magic-sparkles'}"></i>
                                    ${this.settings.theme === 'light' ? 'Light' : this.settings.theme === 'dark' ? 'Dark' : 'Auto'}
                                </span>
                            </div>
                            <div class="theme-selector">
                                <div class="theme-option ${this.settings.theme === 'dark' ? 'active' : ''}" data-theme="dark" onclick="event.stopPropagation(); settingsPanel.setTheme('dark');">
                                    <div class="theme-preview theme-preview-dark"></div>
                                    <div class="theme-name"><i class="fas fa-moon"></i> Dark</div>
                                </div>
                                <div class="theme-option ${this.settings.theme === 'light' ? 'active' : ''}" data-theme="light" onclick="event.stopPropagation(); settingsPanel.setTheme('light');">
                                    <div class="theme-preview theme-preview-light"></div>
                                    <div class="theme-name"><i class="fas fa-sun"></i> Light</div>
                                </div>
                                <div class="theme-option ${this.settings.theme === 'auto' ? 'active' : ''}" data-theme="auto" onclick="event.stopPropagation(); settingsPanel.setTheme('auto');">
                                    <div class="theme-preview theme-preview-auto"></div>
                                    <div class="theme-name"><i class="fas fa-wand-magic-sparkles"></i> Auto</div>
                                </div>
                            </div>
                            <div class="settings-item" style="margin-top: 0.5rem;">
                                <div class="settings-item-info">
                                    <div class="settings-item-desc" style="font-size: 0.75rem; color: var(--text-muted);">
                                        <i class="fas fa-info-circle"></i> Auto uses the holiday theme selected by the site owner
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-paint-brush"></i> Accent Color
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Primary Color</div>
                                    <div class="settings-item-desc">Used for buttons and highlights</div>
                                </div>
                                <div class="color-picker-wrapper">
                                    <input type="color" class="color-picker" value="${this.settings.accentColor}" 
                                           onchange="settingsPanel.updateSetting('accentColor', this.value)">
                                    <div class="color-presets">
                                        <div class="color-preset" style="background: #4ade80" onclick="event.stopPropagation(); settingsPanel.setAccentColor('#4ade80')"></div>
                                        <div class="color-preset" style="background: #3b82f6" onclick="event.stopPropagation(); settingsPanel.setAccentColor('#3b82f6')"></div>
                                        <div class="color-preset" style="background: #8b5cf6" onclick="event.stopPropagation(); settingsPanel.setAccentColor('#8b5cf6')"></div>
                                        <div class="color-preset" style="background: #f59e0b" onclick="event.stopPropagation(); settingsPanel.setAccentColor('#f59e0b')"></div>
                                        <div class="color-preset" style="background: #ef4444" onclick="event.stopPropagation(); settingsPanel.setAccentColor('#ef4444')"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-sliders-h"></i> Display
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Compact Mode</div>
                                    <div class="settings-item-desc">Reduce spacing for more content</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" ${this.settings.compactMode ? 'checked' : ''} 
                                           onchange="settingsPanel.updateSetting('compactMode', this.checked)">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Animations</div>
                                    <div class="settings-item-desc">Enable smooth transitions</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" ${this.settings.animations ? 'checked' : ''} 
                                           onchange="settingsPanel.updateSetting('animations', this.checked)">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Time Format</div>
                                    <div class="settings-item-desc">How times are displayed</div>
                                </div>
                                <select class="settings-select" onchange="settingsPanel.updateSetting('timeFormat', this.value)">
                                    <option value="12hr" ${this.settings.timeFormat === '12hr' ? 'selected' : ''}>12 Hour (AM/PM)</option>
                                    <option value="24hr" ${this.settings.timeFormat === '24hr' ? 'selected' : ''}>24 Hour</option>
                                </select>
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Date Format</div>
                                    <div class="settings-item-desc">How dates are displayed</div>
                                </div>
                                <select class="settings-select" onchange="settingsPanel.updateSetting('dateFormat', this.value)">
                                    <option value="MM/DD/YYYY" ${this.settings.dateFormat === 'MM/DD/YYYY' ? 'selected' : ''}>MM/DD/YYYY</option>
                                    <option value="DD/MM/YYYY" ${this.settings.dateFormat === 'DD/MM/YYYY' ? 'selected' : ''}>DD/MM/YYYY</option>
                                    <option value="YYYY-MM-DD" ${this.settings.dateFormat === 'YYYY-MM-DD' ? 'selected' : ''}>YYYY-MM-DD</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Account Tab -->
                    <div class="settings-section" id="tab-account">
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-user-circle"></i> Profile
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Display Name</div>
                                    <div class="settings-item-desc">How you appear in logs</div>
                                </div>
                                <input type="text" class="settings-input" placeholder="Display Name" 
                                       id="displayName" style="width: 200px"
                                       onchange="settingsPanel.updateSetting('displayName', this.value)">
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Email</div>
                                    <div class="settings-item-desc">For notifications (optional)</div>
                                </div>
                                <input type="email" class="settings-input" placeholder="email@example.com" 
                                       id="userEmail" style="width: 250px"
                                       onchange="settingsPanel.updateSetting('email', this.value)">
                            </div>
                            <div class="settings-item" style="margin-top: 16px;">
                                <button class="btn-settings btn-primary" onclick="settingsPanel.updateProfile()">
                                    <i class="fas fa-save"></i> Update Profile
                                </button>
                            </div>
                        </div>
                        
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fab fa-discord"></i> Linked Discord
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label" id="linkedDiscord">Not linked</div>
                                    <div class="settings-item-desc">Your connected Discord account</div>
                                </div>
                                <button class="btn-settings btn-secondary" onclick="settingsPanel.relinkDiscord()">
                                    <i class="fas fa-sync"></i> Relink
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Notifications Tab -->
                    <div class="settings-section" id="tab-notifications">
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-bell"></i> Alerts
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Dashboard Alerts</div>
                                    <div class="settings-item-desc">Show toast notifications for events</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" ${this.settings.dashboardAlerts ? 'checked' : ''} 
                                           onchange="settingsPanel.updateSetting('dashboardAlerts', this.checked)">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Sound Effects</div>
                                    <div class="settings-item-desc">Play sounds on alerts</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" ${this.settings.soundEffects ? 'checked' : ''} 
                                           onchange="settingsPanel.updateSetting('soundEffects', this.checked)">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Desktop Notifications</div>
                                    <div class="settings-item-desc">Browser push notifications</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" ${this.settings.desktopNotifications ? 'checked' : ''} 
                                           onchange="settingsPanel.requestNotificationPermission(this)">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Critical Alerts Only</div>
                                    <div class="settings-item-desc">Only show high-severity notifications</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" ${this.settings.criticalOnly ? 'checked' : ''} 
                                           onchange="settingsPanel.updateSetting('criticalOnly', this.checked)">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-envelope"></i> Email
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Email Digest</div>
                                    <div class="settings-item-desc">Periodic security summary emails</div>
                                </div>
                                <select class="settings-select" onchange="settingsPanel.updateSetting('emailDigest', this.value)">
                                    <option value="none" ${this.settings.emailDigest === 'none' ? 'selected' : ''}>None</option>
                                    <option value="daily" ${this.settings.emailDigest === 'daily' ? 'selected' : ''}>Daily</option>
                                    <option value="weekly" ${this.settings.emailDigest === 'weekly' ? 'selected' : ''}>Weekly</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Security Tab -->
                    <div class="settings-section" id="tab-security">
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-key"></i> Two-Factor Authentication
                            </div>
                            <div class="twofa-status disabled" id="twofaStatus">
                                <div class="twofa-icon"><i class="fas fa-shield-alt"></i></div>
                                <div class="twofa-info">
                                    <div class="settings-item-label">2FA is disabled</div>
                                    <div class="settings-item-desc">Add an extra layer of security</div>
                                </div>
                                <button class="btn-settings btn-primary" onclick="settingsPanel.setup2FA()">
                                    <i class="fas fa-lock"></i> Enable 2FA
                                </button>
                            </div>
                        </div>
                        
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-clock"></i> Session
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Session Timeout</div>
                                    <div class="settings-item-desc">Auto logout after inactivity</div>
                                </div>
                                <select class="settings-select" onchange="settingsPanel.updateSetting('sessionTimeout', parseInt(this.value))">
                                    <option value="15" ${this.settings.sessionTimeout === 15 ? 'selected' : ''}>15 minutes</option>
                                    <option value="30" ${this.settings.sessionTimeout === 30 ? 'selected' : ''}>30 minutes</option>
                                    <option value="60" ${this.settings.sessionTimeout === 60 ? 'selected' : ''}>1 hour</option>
                                    <option value="240" ${this.settings.sessionTimeout === 240 ? 'selected' : ''}>4 hours</option>
                                    <option value="0" ${this.settings.sessionTimeout === 0 ? 'selected' : ''}>Never</option>
                                </select>
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Require 2FA for Actions</div>
                                    <div class="settings-item-desc">Extra verification for bans, settings changes</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" ${this.settings.require2FAForActions ? 'checked' : ''} 
                                           onchange="settingsPanel.updateSetting('require2FAForActions', this.checked)">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-database"></i> Data & Privacy
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Audit My Actions</div>
                                    <div class="settings-item-desc">Track your own dashboard activity</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" ${this.settings.auditMyActions ? 'checked' : ''} 
                                           onchange="settingsPanel.updateSetting('auditMyActions', this.checked)">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Export My Data</div>
                                    <div class="settings-item-desc">Download all your data</div>
                                </div>
                                <button class="btn-settings btn-secondary" onclick="settingsPanel.exportData()">
                                    <i class="fas fa-download"></i> Export
                                </button>
                            </div>
                            <div class="settings-item">
                                <div class="settings-item-info">
                                    <div class="settings-item-label">Delete My Data</div>
                                    <div class="settings-item-desc">Permanently remove your data</div>
                                </div>
                                <button class="btn-settings btn-danger" onclick="settingsPanel.deleteData()">
                                    <i class="fas fa-trash"></i> Delete
                                </button>
                            </div>
                        </div>
                        
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-laptop"></i> Active Sessions
                            </div>
                            <div class="session-list" id="sessionList">
                                <div class="session-item session-current" style="position: relative;">
                                    <div class="session-info">
                                        <div class="session-icon"><i class="fas fa-desktop"></i></div>
                                        <div class="session-details">
                                            <h4>This Device</h4>
                                            <p>Windows • Chrome • Now</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <button class="btn-settings btn-danger" style="margin-top: 12px" onclick="window.settingsPanel.revokeAllSessions()">
                                <i class="fas fa-sign-out-alt"></i> Sign out all other sessions
                            </button>
                        </div>
                        
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-history"></i> Login History
                            </div>
                            <div id="loginHistoryContainer" style="margin-top: 12px;">
                                <div style="text-align: center; padding: 1rem; opacity: 0.6;">
                                    <i class="fas fa-spinner fa-spin"></i> Loading...
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Widgets Tab -->
                    <div class="settings-section" id="tab-widgets">
                        <div class="settings-group">
                            <div class="settings-group-title">
                                <i class="fas fa-th-large"></i> Available Widgets
                            </div>
                            
                            <!-- Clock Widget -->
                            <div class="widget-item">
                                <div class="widget-main">
                                    <div class="widget-info">
                                        <i class="fas fa-clock"></i>
                                        <div class="widget-details">
                                            <h4>Clock Widget</h4>
                                            <p>Display a customizable clock on your dashboard</p>
                                        </div>
                                    </div>
                                    <div class="widget-controls">
                                        <label class="toggle-switch">
                                            <input type="checkbox" ${this.settings.clockEnabled ? 'checked' : ''} 
                                                   onchange="settingsPanel.updateSetting('clockEnabled', this.checked); settingsPanel.toggleWidgetAdvanced('clock', this.checked);">
                                            <span class="toggle-slider"></span>
                                        </label>
                                        <button class="btn-settings btn-secondary-small" onclick="settingsPanel.toggleWidgetAdvanced('clock')" title="Advanced Settings">
                                            <i class="fas fa-cog"></i>
                                        </button>
                                    </div>
                                </div>
                                <div class="widget-advanced" id="widget-advanced-clock" style="display: ${this.settings.clockEnabled ? 'block' : 'none'};">
                                    <div class="widget-advanced-content">
                                        <div class="settings-item">
                                            <div class="settings-item-info">
                                                <div class="settings-item-label">Position</div>
                                                <div class="settings-item-desc">Where the clock appears</div>
                                            </div>
                                            <select class="settings-select" onchange="settingsPanel.updateSetting('clockPosition', this.value)">
                                                <option value="top-left" ${this.settings.clockPosition === 'top-left' ? 'selected' : ''}>Top Left</option>
                                                <option value="top-center" ${this.settings.clockPosition === 'top-center' ? 'selected' : ''}>Top Center</option>
                                                <option value="top-right" ${this.settings.clockPosition === 'top-right' ? 'selected' : ''}>Top Right</option>
                                                <option value="bottom-left" ${this.settings.clockPosition === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
                                                <option value="bottom-center" ${this.settings.clockPosition === 'bottom-center' ? 'selected' : ''}>Bottom Center</option>
                                                <option value="bottom-right" ${this.settings.clockPosition === 'bottom-right' ? 'selected' : ''}>Bottom Right</option>
                                                <option value="sidebar-top" ${this.settings.clockPosition === 'sidebar-top' ? 'selected' : ''}>Inside Sidebar (Top)</option>
                                                <option value="sidebar-bottom" ${this.settings.clockPosition === 'sidebar-bottom' ? 'selected' : ''}>Inside Sidebar (Bottom)</option>
                                            </select>
                                        </div>
                                        <div class="settings-item">
                                            <div class="settings-item-info">
                                                <div class="settings-item-label">Size</div>
                                                <div class="settings-item-desc">Clock widget size</div>
                                            </div>
                                            <select class="settings-select" onchange="settingsPanel.updateSetting('clockSize', this.value)">
                                                <option value="tiny" ${this.settings.clockSize === 'tiny' ? 'selected' : ''}>Tiny</option>
                                                <option value="small" ${this.settings.clockSize === 'small' ? 'selected' : ''}>Small</option>
                                                <option value="medium" ${this.settings.clockSize === 'medium' ? 'selected' : ''}>Medium</option>
                                                <option value="large" ${this.settings.clockSize === 'large' ? 'selected' : ''}>Large</option>
                                                <option value="xlarge" ${this.settings.clockSize === 'xlarge' ? 'selected' : ''}>Extra Large</option>
                                            </select>
                                        </div>
                                        <div class="settings-item">
                                            <div class="settings-item-info">
                                                <div class="settings-item-label">Style</div>
                                                <div class="settings-item-desc">Visual appearance</div>
                                            </div>
                                            <select class="settings-select" onchange="settingsPanel.updateSetting('clockStyle', this.value)">
                                                <option value="minimal" ${this.settings.clockStyle === 'minimal' ? 'selected' : ''}>Minimal (Text Only)</option>
                                                <option value="modern" ${this.settings.clockStyle === 'modern' ? 'selected' : ''}>Modern (Rounded)</option>
                                                <option value="classic" ${this.settings.clockStyle === 'classic' ? 'selected' : ''}>Classic (Box)</option>
                                                <option value="neon" ${this.settings.clockStyle === 'neon' ? 'selected' : ''}>Neon Glow</option>
                                                <option value="glassmorphic" ${this.settings.clockStyle === 'glassmorphic' ? 'selected' : ''}>Glass Effect</option>
                                            </select>
                                        </div>
                                        <div class="settings-item">
                                            <div class="settings-item-info">
                                                <div class="settings-item-label">Show Seconds</div>
                                                <div class="settings-item-desc">Display seconds in the time</div>
                                            </div>
                                            <label class="toggle-switch">
                                                <input type="checkbox" ${this.settings.clockShowSeconds ? 'checked' : ''} 
                                                       onchange="settingsPanel.updateSetting('clockShowSeconds', this.checked)">
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="settings-item">
                                            <div class="settings-item-info">
                                                <div class="settings-item-label">Show Date</div>
                                                <div class="settings-item-desc">Display the current date</div>
                                            </div>
                                            <label class="toggle-switch">
                                                <input type="checkbox" ${this.settings.clockShowDate ? 'checked' : ''} 
                                                       onchange="settingsPanel.updateSetting('clockShowDate', this.checked)">
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="settings-item">
                                            <div class="settings-item-info">
                                                <div class="settings-item-label">Show Timezone</div>
                                                <div class="settings-item-desc">Display your timezone info</div>
                                            </div>
                                            <label class="toggle-switch">
                                                <input type="checkbox" ${this.settings.clockShowTimezone ? 'checked' : ''} 
                                                       onchange="settingsPanel.updateSetting('clockShowTimezone', this.checked)">
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Settings Bobble Widget -->
                            <div class="widget-item">
                                <div class="widget-main">
                                    <div class="widget-info">
                                        <i class="fas fa-cog"></i>
                                        <div class="widget-details">
                                            <h4>Settings Button</h4>
                                            <p>Customize the floating settings button appearance</p>
                                        </div>
                                    </div>
                                    <div class="widget-controls">
                                        <label class="toggle-switch">
                                            <input type="checkbox" ${this.settings.bobbleEnabled ? 'checked' : ''} 
                                                   onchange="settingsPanel.updateSetting('bobbleEnabled', this.checked); settingsPanel.toggleWidgetAdvanced('bobble', this.checked);">
                                            <span class="toggle-slider"></span>
                                        </label>
                                        <button class="btn-settings btn-secondary-small" onclick="settingsPanel.toggleWidgetAdvanced('bobble')" title="Advanced Settings">
                                            <i class="fas fa-cog"></i>
                                        </button>
                                    </div>
                                </div>
                                <div class="widget-advanced" id="widget-advanced-bobble" style="display: ${this.settings.bobbleEnabled ? 'block' : 'none'};">
                                    <div class="widget-advanced-content">
                                        <div class="settings-item">
                                            <div class="settings-item-info">
                                                <div class="settings-item-label">Position</div>
                                                <div class="settings-item-desc">Where the settings button appears</div>
                                            </div>
                                            <select class="settings-select" onchange="settingsPanel.updateSetting('bobblePosition', this.value)">
                                                <option value="top-left" ${this.settings.bobblePosition === 'top-left' ? 'selected' : ''}>Top Left</option>
                                                <option value="top-right" ${this.settings.bobblePosition === 'top-right' ? 'selected' : ''}>Top Right</option>
                                                <option value="bottom-left" ${this.settings.bobblePosition === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
                                                <option value="bottom-right" ${this.settings.bobblePosition === 'bottom-right' ? 'selected' : ''}>Bottom Right</option>
                                            </select>
                                        </div>
                                        <div class="settings-item">
                                            <div class="settings-item-info">
                                                <div class="settings-item-label">Size</div>
                                                <div class="settings-item-desc">Button size</div>
                                            </div>
                                            <select class="settings-select" onchange="settingsPanel.updateSetting('bobbleSize', this.value)">
                                                <option value="small" ${this.settings.bobbleSize === 'small' ? 'selected' : ''}>Small</option>
                                                <option value="medium" ${this.settings.bobbleSize === 'medium' ? 'selected' : ''}>Medium</option>
                                                <option value="large" ${this.settings.bobbleSize === 'large' ? 'selected' : ''}>Large</option>
                                            </select>
                                        </div>
                                        <div class="settings-item">
                                            <div class="settings-item-info">
                                                <div class="settings-item-label">Opacity</div>
                                                <div class="settings-item-desc">Button transparency (${this.settings.bobbleOpacity}%)</div>
                                            </div>
                                            <input type="range" min="20" max="100" value="${this.settings.bobbleOpacity}" 
                                                   class="settings-slider" 
                                                   oninput="settingsPanel.updateSetting('bobbleOpacity', parseInt(this.value)); this.previousElementSibling.querySelector('.settings-item-desc').textContent = 'Button transparency (' + this.value + '%)'">
                                        </div>
                                        <div class="settings-item">
                                            <div class="settings-item-info">
                                                <div class="settings-item-label">Auto-Hide</div>
                                                <div class="settings-item-desc">Hide button when not hovering</div>
                                            </div>
                                            <label class="toggle-switch">
                                                <input type="checkbox" ${this.settings.bobbleAutoHide ? 'checked' : ''} 
                                                       onchange="settingsPanel.updateSetting('bobbleAutoHide', this.checked)">
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                        </div>
                    </div>
                </div>
                
                <div class="settings-footer">
                    <button class="btn-settings btn-secondary" onclick="settingsPanel.resetToDefaults()">
                        <i class="fas fa-undo"></i> Reset to Defaults
                    </button>
                    <button class="btn-settings btn-primary" onclick="settingsPanel.saveSettings()">
                        <i class="fas fa-check"></i> Save Changes
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.close();
        });
        
        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                this.close();
            }
        });
    }

    /**
     * Open settings modal
     */
    open() {
        document.getElementById('settingsModal').classList.add('active');
        this.loadAccountInfo();
        this.check2FAStatus();
    }

    /**
     * Close settings modal
     */
    close() {
        document.getElementById('settingsModal').classList.remove('active');
    }

    /**
     * Switch active tab
     */
    switchTab(tabId) {
        // Update tab buttons
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabId);
        });
        
        // Update tab content
        document.querySelectorAll('.settings-section').forEach(section => {
            section.classList.toggle('active', section.id === `tab-${tabId}`);
        });
        
        this.activeTab = tabId;
        
        // Load data for specific tabs
        if (tabId === 'account') {
            this.loadUserProfile();
            this.loadActiveSessions();
        } else if (tabId === 'security') {
            this.loadLoginHistory();
        }
    }

    /**
     * Load user profile from server
     */
    async loadUserProfile() {
        try {
            const response = await fetch('/api/user/profile', {
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.profile) {
                    // Populate form fields
                    const displayNameInput = document.getElementById('displayName');
                    const emailInput = document.getElementById('userEmail');
                    const linkedDiscord = document.getElementById('linkedDiscord');
                    
                    if (displayNameInput) {
                        displayNameInput.value = data.profile.displayName || '';
                    }
                    if (emailInput) {
                        emailInput.value = data.profile.email || '';
                    }
                    if (linkedDiscord && data.profile.discordId) {
                        linkedDiscord.textContent = `${data.profile.username} (${data.profile.discordId})`;
                    } else if (linkedDiscord && data.profile.username) {
                        linkedDiscord.textContent = data.profile.username;
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load profile:', e);
        }
    }

    /**
     * Update a setting
     */
    updateSetting(key, value) {
        this.settings[key] = value;
        localStorage.setItem('dashboardSettings', JSON.stringify(this.settings));
        
        // Apply only the relevant setting that changed
        if (key.startsWith('clock')) {
            this.applyClockSettings();
        } else if (key.startsWith('bobble')) {
            this.applyBobbleSettings();
        } else if (key === 'theme') {
            this.applyTheme();
            this.updateThemeBadge();
        } else if (key === 'accentColor') {
            document.documentElement.style.setProperty('--cyber-accent', value);
        } else if (key === 'compactMode') {
            document.body.classList.toggle('compact-mode', value);
        } else if (key === 'animations') {
            document.body.classList.toggle('no-animations', !value);
        } else {
            // For other settings, apply all
            this.applySettings();
        }
    }

    /**
     * Set theme
     */
    setTheme(theme) {
        this.settings.theme = theme;
        localStorage.setItem('dashboardSettings', JSON.stringify(this.settings));
        
        // Update UI
        document.querySelectorAll('.theme-option').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.theme === theme);
        });
        
        this.applyTheme();
        this.updateThemeBadge();
    }

    /**
     * Apply theme to document
     */
    applyTheme() {
        let effectiveTheme = this.settings.theme;
        
        // Handle auto theme - use owner's selected theme from server
        if (effectiveTheme === 'auto') {
            // Use GuardianTheme's global theme (owner selected)
            if (window.GuardianTheme) {
                window.GuardianTheme.refresh();
                return; // Let global-theme.js handle it
            }
        }
        
        // For explicit dark/light modes
        if (effectiveTheme === 'dark' || effectiveTheme === 'light') {
            document.documentElement.setAttribute('data-theme', effectiveTheme);
            document.body.classList.remove('christmas-mode', 'halloween-mode', 'valentine-mode', 'independence-mode', 'stpatrick-mode', 'easter-mode');
            document.body.classList.remove('theme-christmas', 'theme-halloween', 'theme-valentine', 'theme-independence', 'theme-stpatrick', 'theme-easter');
            
            // Clear holiday theme CSS
            const themeLink = document.getElementById('dynamic-theme-stylesheet');
            if (themeLink) {
                themeLink.href = '';
            }
        }
    }

    /**
     * Update theme badge display
     */
    updateThemeBadge() {
        const badge = document.getElementById('currentThemeBadge');
        if (!badge) return;
        
        const themeNames = {
            dark: { name: 'Dark', icon: 'fa-moon' },
            light: { name: 'Light', icon: 'fa-sun' },
            auto: { name: 'Auto', icon: 'fa-wand-magic-sparkles' }
        };
        
        const theme = themeNames[this.settings.theme] || themeNames.auto;
        badge.innerHTML = `<i class="fas ${theme.icon}"></i> ${theme.name}`;
    }

    /**
     * Set accent color
     */
    setAccentColor(color) {
        this.settings.accentColor = color;
        localStorage.setItem('dashboardSettings', JSON.stringify(this.settings));
        document.documentElement.style.setProperty('--cyber-accent', color);
        
        // Update color picker
        const picker = document.querySelector('.color-picker');
        if (picker) picker.value = color;
        
        // Update preset selection
        document.querySelectorAll('.color-preset').forEach(preset => {
            preset.classList.toggle('active', preset.style.background === color);
        });
    }

    /**
     * Apply all settings
     */
    applySettings() {
        this.applyTheme();
        this.updateThemeBadge();
        
        // Accent color
        document.documentElement.style.setProperty('--cyber-accent', this.settings.accentColor);
        
        // Compact mode
        document.body.classList.toggle('compact-mode', this.settings.compactMode);
        
        // Animations
        document.body.classList.toggle('no-animations', !this.settings.animations);
        
        // Clock widget
        this.applyClockSettings();
        
        // Settings bobble
        this.applyBobbleSettings();
    }

    /**
     * Load account info
     */
    async loadAccountInfo() {
        try {
            const res = await fetch('/api/auth/me', { credentials: 'include' });
            if (res.ok) {
                const user = await res.json();
                document.getElementById('linkedDiscord').textContent = user.username || 'Not linked';
                if (document.getElementById('displayName')) {
                    document.getElementById('displayName').value = user.displayName || user.username || '';
                }
            }
        } catch (e) {
            console.warn('Failed to load account info:', e);
        }
    }

    /**
     * Check 2FA status for Discord OAuth users
     */
    async check2FAStatus() {
        try {
            const res = await fetch('/api/2fa/discord/status', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                const status = document.getElementById('twofaStatus');
                if (data.enabled) {
                    status.classList.remove('disabled');
                    status.classList.add('enabled');
                    status.innerHTML = `
                        <div class="twofa-icon"><i class="fas fa-shield-alt"></i></div>
                        <div class="twofa-info">
                            <div class="settings-item-label">2FA is enabled</div>
                            <div class="settings-item-desc">Your account is protected${data.backupCodesRemaining ? ` • ${data.backupCodesRemaining} backup codes remaining` : ''}</div>
                        </div>
                        <button class="btn-settings btn-secondary" onclick="settingsPanel.setup2FA()">
                            <i class="fas fa-cog"></i> Manage
                        </button>
                    `;
                }
            }
        } catch (e) {
            console.warn('Failed to check 2FA status:', e);
        }
    }

    /**
     * Reset to defaults
     */
    resetToDefaults() {
        if (confirm('Reset all settings to defaults?')) {
            this.settings = this.getDefaultSettings();
            localStorage.removeItem('dashboardSettings');
            this.applySettings();
            this.close();
            this.open(); // Reopen to refresh UI
            this.showToast('Settings reset to defaults', 'success');
        }
    }

    /**
     * Request notification permission
     */
    async requestNotificationPermission(checkbox) {
        if (checkbox.checked) {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                this.settings.desktopNotifications = true;
                this.showToast('Desktop notifications enabled', 'success');
            } else {
                checkbox.checked = false;
                this.showToast('Notification permission denied', 'error');
            }
        } else {
            this.settings.desktopNotifications = false;
        }
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            background: var(--cyber-secondary);
            border: 1px solid ${type === 'success' ? 'var(--success-green)' : type === 'error' ? 'var(--error-red)' : 'var(--cyber-accent)'};
            border-radius: 8px;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 10001;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Get CSRF token
     */
    getCSRFToken() {
        return document.querySelector('meta[name="csrf-token"]')?.content || '';
    }

    /**
     * Update user profile (display name, email)
     */
    async updateProfile() {
        const displayName = document.getElementById('displayName')?.value?.trim();
        const email = document.getElementById('userEmail')?.value?.trim();
        
        try {
            const response = await fetch('/api/user/profile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.getCSRFToken()
                },
                credentials: 'include',
                body: JSON.stringify({ displayName, email })
            });
            
            if (response.ok) {
                this.showToast('Profile updated successfully!', 'success');
            } else {
                const data = await response.json();
                this.showToast(data.error || 'Failed to update profile', 'error');
            }
        } catch (e) {
            console.error('Failed to update profile:', e);
            this.showToast('Failed to update profile', 'error');
        }
    }

    // 2FA Methods - redirect to new Discord user 2FA page
    setup2FA() { window.location.href = '/setup-2fa'; }
    disable2FA() { window.location.href = '/setup-2fa'; }
    
    // Other action methods
    relinkDiscord() { window.location.href = '/auth/discord'; }
    
    async loadActiveSessions() {
        try {
            const response = await fetch('/api/user/sessions', { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                const sessionList = document.getElementById('sessionList');
                if (!sessionList || !data.sessions) return;
                
                sessionList.innerHTML = data.sessions.map((session, index) => `
                    <div class="session-item ${session.current ? 'session-current' : ''}" style="position: relative;">
                        <div class="session-info">
                            <div class="session-icon">
                                <i class="fas ${this.getDeviceIcon(session.device)}"></i>
                            </div>
                            <div class="session-details">
                                <h4>${session.current ? 'This Device' : session.device || 'Unknown Device'}</h4>
                                <p>${session.browser || 'Unknown'} • ${session.os || 'Unknown'} • ${this.formatSessionTime(session.lastActive)}</p>
                                <p style="font-size: 11px; opacity: 0.6;">${session.ip ? `IP: ${this.maskIP(session.ip)}` : ''}</p>
                            </div>
                        </div>
                        ${!session.current ? `
                            <button class="btn-settings btn-danger-small" onclick="settingsPanel.revokeSession('${session.id}')" title="Sign out this session">
                                <i class="fas fa-times"></i>
                            </button>
                        ` : ''}
                    </div>
                `).join('');
            }
        } catch (e) {
            console.error('Failed to load sessions:', e);
        }
    }
    
    getDeviceIcon(device) {
        if (!device) return 'fa-desktop';
        const d = device.toLowerCase();
        if (d.includes('mobile') || d.includes('phone') || d.includes('android') || d.includes('ios')) return 'fa-mobile-alt';
        if (d.includes('tablet') || d.includes('ipad')) return 'fa-tablet-alt';
        if (d.includes('mac')) return 'fa-apple';
        return 'fa-desktop';
    }
    
    formatSessionTime(timestamp) {
        if (!timestamp) return 'Unknown';
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
        return date.toLocaleDateString();
    }
    
    maskIP(ip) {
        if (!ip) return '';
        const parts = ip.split('.');
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.***.***`;
        }
        return ip.substring(0, 8) + '***';
    }
    
    async revokeSession(sessionId) {
        if (!confirm('Sign out this session?')) return;
        try {
            const response = await fetch(`/api/user/sessions/${sessionId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (response.ok) {
                this.showToast('Session revoked', 'success');
                this.loadActiveSessions();
            } else {
                this.showToast('Failed to revoke session', 'error');
            }
        } catch (e) {
            this.showToast('Failed to revoke session', 'error');
        }
    }
    
    async revokeAllSessions() {
        if (!confirm('This will sign out ALL other sessions. Continue?')) return;
        try {
            const response = await fetch('/api/user/sessions/revoke-all', {
                method: 'POST',
                credentials: 'include'
            });
            if (response.ok) {
                this.showToast('All other sessions signed out', 'success');
                this.loadActiveSessions();
            } else {
                this.showToast('Failed to revoke sessions', 'error');
            }
        } catch (e) {
            this.showToast('Failed to revoke sessions', 'error');
        }
    }
    
    async loadLoginHistory() {
        const container = document.getElementById('loginHistoryContainer');
        if (!container) return;
        
        try {
            container.innerHTML = '<div style="text-align: center; padding: 1rem; opacity: 0.6;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
            
            const response = await fetch('/api/user/sessions', {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Failed to load sessions');
            }
            
            const data = await response.json();
            
            if (!data.success || !data.sessions || data.sessions.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 1rem; opacity: 0.6;">No login history found</div>';
                return;
            }
            
            container.innerHTML = `
                <div class="session-list">
                    ${data.sessions.map(session => `
                        <div class="session-item ${session.current ? 'session-current' : ''}" style="margin-bottom: 12px;">
                            <div class="session-info">
                                <div class="session-icon">
                                    <i class="fas ${session.device?.toLowerCase().includes('mobile') ? 'fa-mobile-alt' : 'fa-desktop'}"></i>
                                </div>
                                <div class="session-details">
                                    <h4>${session.device || 'Unknown Device'}${session.current ? ' <span style="color: var(--success); font-size: 0.85em;">(Current)</span>' : ''}</h4>
                                    <p>${session.browser || 'Unknown'} • ${session.os || 'Unknown'}</p>
                                    <p style="font-size: 0.85em; opacity: 0.7;">
                                        ${session.ip_address || 'Unknown IP'} • 
                                        ${session.created_at ? new Date(session.created_at).toLocaleString() : 'Unknown time'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
            
        } catch (error) {
            console.error('Error loading login history:', error);
            container.innerHTML = `
                <div style="text-align: center; padding: 1rem; color: var(--danger); opacity: 0.8;">
                    <i class="fas fa-exclamation-triangle"></i> Failed to load login history
                </div>
            `;
        }
    }
    
    async viewLoginHistory() {
        this.loadLoginHistory();
    }
    
    exportData() { window.location.href = '/api/user/export'; }
    deleteData() { if (confirm('This will permanently delete all your data. Are you sure?')) alert('Implement delete API'); }
    configureWebhook() { window.location.href = '/admin/webhooks'; }
    
    toggleWidgetAdvanced(widgetId, forceShow = null) {
        const advancedSection = document.getElementById(`widget-advanced-${widgetId}`);
        if (!advancedSection) return;
        
        if (forceShow !== null) {
            advancedSection.style.display = forceShow ? 'block' : 'none';
        } else {
            advancedSection.style.display = advancedSection.style.display === 'none' ? 'block' : 'none';
        }
    }
}

// Initialize settings panel when DOM is ready
let settingsPanel;
document.addEventListener('DOMContentLoaded', () => {
    console.log('[SettingsPanel] Initializing...');
    try {
        settingsPanel = new SettingsPanel();
        console.log('[SettingsPanel] ✅ Initialized successfully');
    } catch (e) {
        console.error('[SettingsPanel] ❌ Failed to initialize:', e);
    }
});

// Add toast animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    .no-animations * {
        animation: none !important;
        transition: none !important;
    }
    .compact-mode {
        --spacing-xs: 0.15rem;
        --spacing-sm: 0.35rem;
        --spacing-md: 0.75rem;
        --spacing-lg: 1rem;
        --spacing-xl: 1.5rem;
    }
`;
document.head.appendChild(style);

// Initialize settings panel when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.settingsPanel = new SettingsPanel();
    });
} else {
    window.settingsPanel = new SettingsPanel();
}
