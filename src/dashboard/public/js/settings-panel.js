/**
 * DarkLock Dashboard Settings Panel v2.0
 * Professional settings system for all dashboard pages
 * Tabs: Appearance, Account, Notifications, Security, Accessibility, Data & Privacy, Widgets
 */

class SettingsPanel {
    constructor() {
        this.settings = this._loadSettings();
        this.activeTab = 'appearance';
        this._clockInterval = null;
        this._initialized = false;
        this._init();
    }

    /* ─── Default Settings ──────────────────────────────────── */
    _defaults() {
        return {
            // Appearance
            theme: 'dark',
            accentColor: '#00d4ff',
            compactMode: false,
            animations: true,
            glassEffects: true,
            timeFormat: '12hr',
            dateFormat: 'MM/DD/YYYY',
            fontScale: 100,
            sidebarCollapsed: false,

            // Notifications
            dashboardAlerts: true,
            soundEffects: false,
            desktopNotifications: false,
            emailDigest: 'none',
            criticalOnly: false,
            notificationPosition: 'bottom-right',
            notificationDuration: 3,

            // Security
            sessionTimeout: 30,
            require2FAForActions: false,
            auditMyActions: true,
            loginAlerts: true,
            ipWhitelist: '',

            // Accessibility
            reduceMotion: false,
            highContrast: false,
            largeText: false,
            screenReaderMode: false,
            keyboardShortcuts: true,

            // Data & Privacy
            analyticsOptIn: true,
            shareUsageData: false,
            autoDeleteLogs: 'never',

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
            bobblePosition: 'bottom-right',
            bobbleSize: 'medium',
            bobbleOpacity: 100,
            bobbleAutoHide: false,

            // Quick Actions
            quickActions: ['settings', 'theme', 'notifications', 'refresh', 'logout']
        };
    }

    /* ─── Settings I/O ──────────────────────────────────────── */
    _loadSettings() {
        try {
            const stored = localStorage.getItem('dashboardSettings');
            if (stored) return { ...this._defaults(), ...JSON.parse(stored) };
        } catch (e) { console.error('[Settings] Parse error:', e); }
        return this._defaults();
    }

    async saveSettings() {
        localStorage.setItem('dashboardSettings', JSON.stringify(this.settings));
        try {
            await fetch('/api/user/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this._csrf() },
                credentials: 'include',
                body: JSON.stringify(this.settings)
            });
        } catch (e) { console.warn('[Settings] Server sync failed:', e); }
        this._toast('Settings saved', 'success');
    }

    updateSetting(key, value) {
        this.settings[key] = value;
        localStorage.setItem('dashboardSettings', JSON.stringify(this.settings));

        // Live-apply relevant setting
        if (key.startsWith('clock'))       return this._applyClockSettings();
        if (key.startsWith('bobble'))      return this._applyBobbleSettings();
        if (key === 'theme')               return (this._applyTheme(), this._updateThemeBadge());
        if (key === 'accentColor')         return this._applyAccentColor(value);
        if (key === 'compactMode')         return document.body.classList.toggle('compact-mode', value);
        if (key === 'animations')          return document.body.classList.toggle('no-animations', !value);
        if (key === 'glassEffects')        return document.body.classList.toggle('no-glass', !value);
        if (key === 'fontScale')           return (document.documentElement.style.fontSize = value + '%');
        if (key === 'reduceMotion') {
            document.body.classList.toggle('reduce-motion', value);
            window.dispatchEvent(new CustomEvent('DLReduceMotion', { detail: { active: value } }));
            return;
        }
        if (key === 'highContrast')        return document.body.classList.toggle('high-contrast', value);
        if (key === 'largeText')           return document.body.classList.toggle('large-text', value);

        this._applyAll();
    }

    /* ─── Initialization ─────────────────────────────────────── */
    _init() {
        if (this._initialized) return;
        this._initialized = true;
        this._createModal();
        this._createBobble();
        this._createClockWidget();
        this._applyAll();

        // System theme listener
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (this.settings.theme === 'auto') this._applyTheme();
        });

        console.log('[SettingsPanel] v2.0 initialized');
    }

    /* ─── Modal Creation ─────────────────────────────────────── */
    _createModal() {
        const existing = document.getElementById('settingsModal');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.className = 'sp-overlay';
        el.id = 'settingsModal';
        el.innerHTML = `
        <div class="sp-modal">
            <div class="sp-header">
                <div class="sp-header-left">
                    <div class="sp-logo"><i class="fas fa-cog"></i></div>
                    <div>
                        <h2>Settings</h2>
                        <span class="sp-subtitle">Customize your DarkLock experience</span>
                    </div>
                </div>
                <button class="sp-close" id="spClose" aria-label="Close settings">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <div class="sp-body">
                <nav class="sp-sidebar">
                    <button class="sp-nav active" data-tab="appearance"><i class="fas fa-palette"></i><span>Appearance</span></button>
                    <button class="sp-nav" data-tab="account"><i class="fas fa-user-circle"></i><span>Account</span></button>
                    <button class="sp-nav" data-tab="notifications"><i class="fas fa-bell"></i><span>Notifications</span></button>
                    <button class="sp-nav" data-tab="security"><i class="fas fa-shield-alt"></i><span>Security</span></button>
                    <button class="sp-nav" data-tab="accessibility"><i class="fas fa-universal-access"></i><span>Accessibility</span></button>
                    <button class="sp-nav" data-tab="privacy"><i class="fas fa-user-secret"></i><span>Data & Privacy</span></button>
                    <button class="sp-nav" data-tab="widgets"><i class="fas fa-th-large"></i><span>Widgets</span></button>
                    <div class="sp-nav-divider"></div>
                    <button class="sp-nav sp-nav-danger" id="spResetBtn"><i class="fas fa-undo"></i><span>Reset All</span></button>
                </nav>

                <div class="sp-content">
                    ${this._tabAppearance()}
                    ${this._tabAccount()}
                    ${this._tabNotifications()}
                    ${this._tabSecurity()}
                    ${this._tabAccessibility()}
                    ${this._tabPrivacy()}
                    ${this._tabWidgets()}
                </div>
            </div>

            <div class="sp-footer">
                <div class="sp-footer-info"><i class="fas fa-info-circle"></i> Changes auto-apply. Click Save to sync across devices.</div>
                <div class="sp-footer-actions">
                    <button class="sp-btn sp-btn-ghost" id="spCancelBtn">Cancel</button>
                    <button class="sp-btn sp-btn-primary" id="spSaveBtn"><i class="fas fa-check"></i> Save</button>
                </div>
            </div>
        </div>`;

        document.body.appendChild(el);

        // Event Delegation
        el.addEventListener('click', (e) => {
            if (e.target === el) this.close();
        });
        document.getElementById('spClose').addEventListener('click', () => this.close());
        document.getElementById('spCancelBtn').addEventListener('click', () => this.close());
        document.getElementById('spSaveBtn').addEventListener('click', () => this.saveSettings());
        document.getElementById('spResetBtn').addEventListener('click', () => this._resetToDefaults());

        // Tab navigation
        el.querySelectorAll('.sp-nav[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && el.classList.contains('active')) this.close();
        });
    }

    /* ─── Tab HTML Generators ────────────────────────────────── */
    _tabAppearance() {
        return `
        <div class="sp-tab active" id="tab-appearance">
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-moon"></i> Theme</div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Color Scheme</div><div class="sp-desc">Choose your preferred look</div></div>
                    <span class="sp-badge" id="currentThemeBadge"><i class="fas fa-moon"></i> Dark</span>
                </div>
                <div class="sp-theme-grid">
                    <div class="sp-theme-card ${this.settings.theme === 'dark' ? 'active' : ''}" data-theme="dark" onclick="window.settingsPanel.setTheme('dark')">
                        <div class="sp-theme-preview sp-tp-dark"></div>
                        <div class="sp-theme-name"><i class="fas fa-moon"></i> Dark</div>
                    </div>
                    <div class="sp-theme-card ${this.settings.theme === 'light' ? 'active' : ''}" data-theme="light" onclick="window.settingsPanel.setTheme('light')">
                        <div class="sp-theme-preview sp-tp-light"></div>
                        <div class="sp-theme-name"><i class="fas fa-sun"></i> Light</div>
                    </div>
                    <div class="sp-theme-card ${this.settings.theme === 'auto' ? 'active' : ''}" data-theme="auto" onclick="window.settingsPanel.setTheme('auto')">
                        <div class="sp-theme-preview sp-tp-auto"></div>
                        <div class="sp-theme-name"><i class="fas fa-wand-magic-sparkles"></i> Auto</div>
                    </div>
                </div>
            </div>

            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-paint-brush"></i> Accent Color</div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Primary Color</div><div class="sp-desc">Used for highlights and interactive elements</div></div>
                    <div class="sp-color-group">
                        <div class="sp-color-dot ${this.settings.accentColor === '#00d4ff' ? 'active' : ''}" style="background:#00d4ff" onclick="window.settingsPanel.setAccentColor('#00d4ff')"></div>
                        <div class="sp-color-dot ${this.settings.accentColor === '#4ade80' ? 'active' : ''}" style="background:#4ade80" onclick="window.settingsPanel.setAccentColor('#4ade80')"></div>
                        <div class="sp-color-dot ${this.settings.accentColor === '#3b82f6' ? 'active' : ''}" style="background:#3b82f6" onclick="window.settingsPanel.setAccentColor('#3b82f6')"></div>
                        <div class="sp-color-dot ${this.settings.accentColor === '#8b5cf6' ? 'active' : ''}" style="background:#8b5cf6" onclick="window.settingsPanel.setAccentColor('#8b5cf6')"></div>
                        <div class="sp-color-dot ${this.settings.accentColor === '#f59e0b' ? 'active' : ''}" style="background:#f59e0b" onclick="window.settingsPanel.setAccentColor('#f59e0b')"></div>
                        <div class="sp-color-dot ${this.settings.accentColor === '#ef4444' ? 'active' : ''}" style="background:#ef4444" onclick="window.settingsPanel.setAccentColor('#ef4444')"></div>
                        <div class="sp-color-dot ${this.settings.accentColor === '#ec4899' ? 'active' : ''}" style="background:#ec4899" onclick="window.settingsPanel.setAccentColor('#ec4899')"></div>
                        <input type="color" class="sp-color-input" value="${this.settings.accentColor}" onchange="window.settingsPanel.setAccentColor(this.value)">
                    </div>
                </div>
            </div>

            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-sliders-h"></i> Display</div>
                ${this._toggle('Compact Mode', 'Tighter spacing for dense layouts', 'compactMode')}
                ${this._toggle('Animations', 'Smooth transitions and effects', 'animations')}
                ${this._toggle('Glass Effects', 'Blur & transparency overlays', 'glassEffects')}
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Font Scale</div><div class="sp-desc">Adjust base text size (${this.settings.fontScale}%)</div></div>
                    <input type="range" class="sp-range" min="80" max="130" step="5" value="${this.settings.fontScale}" oninput="window.settingsPanel.updateSetting('fontScale', parseInt(this.value)); this.closest('.sp-row').querySelector('.sp-desc').textContent='Adjust base text size ('+this.value+'%)'">
                </div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Time Format</div><div class="sp-desc">Clock and timestamp display</div></div>
                    <select class="sp-select" onchange="window.settingsPanel.updateSetting('timeFormat', this.value)">
                        <option value="12hr" ${this.settings.timeFormat === '12hr' ? 'selected' : ''}>12 Hour (AM/PM)</option>
                        <option value="24hr" ${this.settings.timeFormat === '24hr' ? 'selected' : ''}>24 Hour</option>
                    </select>
                </div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Date Format</div><div class="sp-desc">How dates appear on the dashboard</div></div>
                    <select class="sp-select" onchange="window.settingsPanel.updateSetting('dateFormat', this.value)">
                        <option value="MM/DD/YYYY" ${this.settings.dateFormat === 'MM/DD/YYYY' ? 'selected' : ''}>MM/DD/YYYY</option>
                        <option value="DD/MM/YYYY" ${this.settings.dateFormat === 'DD/MM/YYYY' ? 'selected' : ''}>DD/MM/YYYY</option>
                        <option value="YYYY-MM-DD" ${this.settings.dateFormat === 'YYYY-MM-DD' ? 'selected' : ''}>YYYY-MM-DD</option>
                    </select>
                </div>
            </div>
        </div>`;
    }

    _tabAccount() {
        return `
        <div class="sp-tab" id="tab-account">
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-user"></i> Profile</div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Display Name</div><div class="sp-desc">How you appear in logs and chats</div></div>
                    <input type="text" class="sp-input" id="spDisplayName" placeholder="Your name" style="width:200px">
                </div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Email</div><div class="sp-desc">For notifications (optional)</div></div>
                    <input type="email" class="sp-input" id="spEmail" placeholder="email@example.com" style="width:250px">
                </div>
                <div class="sp-row" style="justify-content:flex-end">
                    <button class="sp-btn sp-btn-primary" onclick="window.settingsPanel._updateProfile()"><i class="fas fa-save"></i> Update Profile</button>
                </div>
            </div>
            <div class="sp-section">
                <div class="sp-section-header"><i class="fab fa-discord"></i> Linked Discord</div>
                <div class="sp-row">
                    <div class="sp-row-info">
                        <div class="sp-label" id="spLinkedDiscord">Loading...</div>
                        <div class="sp-desc">Your connected Discord account</div>
                    </div>
                    <button class="sp-btn sp-btn-ghost" onclick="window.location.href='/auth/discord'"><i class="fas fa-sync"></i> Relink</button>
                </div>
            </div>
        </div>`;
    }

    _tabNotifications() {
        return `
        <div class="sp-tab" id="tab-notifications">
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-bell"></i> Alert Preferences</div>
                ${this._toggle('Dashboard Alerts', 'Toast notifications for events', 'dashboardAlerts')}
                ${this._toggle('Sound Effects', 'Play audio on alerts', 'soundEffects')}
                ${this._toggle('Desktop Notifications', 'Browser push notifications', 'desktopNotifications', 'window.settingsPanel._requestNotifPerm(this)')}
                ${this._toggle('Critical Only', 'Only high-severity alerts', 'criticalOnly')}
            </div>
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-envelope"></i> Email Digest</div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Frequency</div><div class="sp-desc">Periodic summary emails</div></div>
                    <select class="sp-select" onchange="window.settingsPanel.updateSetting('emailDigest', this.value)">
                        <option value="none" ${this.settings.emailDigest === 'none' ? 'selected' : ''}>Disabled</option>
                        <option value="daily" ${this.settings.emailDigest === 'daily' ? 'selected' : ''}>Daily</option>
                        <option value="weekly" ${this.settings.emailDigest === 'weekly' ? 'selected' : ''}>Weekly</option>
                        <option value="monthly" ${this.settings.emailDigest === 'monthly' ? 'selected' : ''}>Monthly</option>
                    </select>
                </div>
            </div>
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-map-marker-alt"></i> Toast Position</div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Location</div><div class="sp-desc">Where toasts appear on screen</div></div>
                    <select class="sp-select" onchange="window.settingsPanel.updateSetting('notificationPosition', this.value)">
                        <option value="top-right" ${this.settings.notificationPosition === 'top-right' ? 'selected' : ''}>Top Right</option>
                        <option value="top-left" ${this.settings.notificationPosition === 'top-left' ? 'selected' : ''}>Top Left</option>
                        <option value="bottom-right" ${this.settings.notificationPosition === 'bottom-right' ? 'selected' : ''}>Bottom Right</option>
                        <option value="bottom-left" ${this.settings.notificationPosition === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
                    </select>
                </div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Duration</div><div class="sp-desc">Seconds before auto-dismiss</div></div>
                    <select class="sp-select" onchange="window.settingsPanel.updateSetting('notificationDuration', parseInt(this.value))">
                        <option value="2" ${this.settings.notificationDuration === 2 ? 'selected' : ''}>2 seconds</option>
                        <option value="3" ${this.settings.notificationDuration === 3 ? 'selected' : ''}>3 seconds</option>
                        <option value="5" ${this.settings.notificationDuration === 5 ? 'selected' : ''}>5 seconds</option>
                        <option value="10" ${this.settings.notificationDuration === 10 ? 'selected' : ''}>10 seconds</option>
                    </select>
                </div>
            </div>
        </div>`;
    }

    _tabSecurity() {
        return `
        <div class="sp-tab" id="tab-security">
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-key"></i> Two-Factor Authentication</div>
                <div class="sp-2fa-card" id="sp2faStatus">
                    <div class="sp-2fa-icon"><i class="fas fa-shield-alt"></i></div>
                    <div class="sp-2fa-info">
                        <div class="sp-label">2FA Status</div>
                        <div class="sp-desc">Loading...</div>
                    </div>
                    <button class="sp-btn sp-btn-primary" onclick="window.location.href='/setup-2fa'"><i class="fas fa-lock"></i> Manage 2FA</button>
                </div>
            </div>
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-clock"></i> Session Management</div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Session Timeout</div><div class="sp-desc">Auto-logout after inactivity</div></div>
                    <select class="sp-select" onchange="window.settingsPanel.updateSetting('sessionTimeout', parseInt(this.value))">
                        <option value="15" ${this.settings.sessionTimeout === 15 ? 'selected' : ''}>15 minutes</option>
                        <option value="30" ${this.settings.sessionTimeout === 30 ? 'selected' : ''}>30 minutes</option>
                        <option value="60" ${this.settings.sessionTimeout === 60 ? 'selected' : ''}>1 hour</option>
                        <option value="240" ${this.settings.sessionTimeout === 240 ? 'selected' : ''}>4 hours</option>
                        <option value="0" ${this.settings.sessionTimeout === 0 ? 'selected' : ''}>Never</option>
                    </select>
                </div>
                ${this._toggle('Require 2FA for Actions', 'Extra verification for bans and settings', 'require2FAForActions')}
                ${this._toggle('Login Alerts', 'Notify on new device logins', 'loginAlerts')}
            </div>
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-laptop"></i> Active Sessions</div>
                <div id="spSessionList" class="sp-session-list">
                    <div class="sp-loader"><i class="fas fa-spinner fa-spin"></i> Loading sessions...</div>
                </div>
                <button class="sp-btn sp-btn-danger" style="margin-top:12px" onclick="window.settingsPanel._revokeAll()">
                    <i class="fas fa-sign-out-alt"></i> Sign Out All Other Sessions
                </button>
            </div>
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-history"></i> Login History</div>
                <div id="spLoginHistory" class="sp-session-list">
                    <div class="sp-loader"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
                </div>
            </div>
        </div>`;
    }

    _tabAccessibility() {
        return `
        <div class="sp-tab" id="tab-accessibility">
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-universal-access"></i> Motion & Visual</div>
                ${this._toggle('Reduce Motion', 'Minimize animations for comfort', 'reduceMotion')}
                ${this._toggle('High Contrast', 'Stronger text/background contrast', 'highContrast')}
                ${this._toggle('Large Text', 'Increase default font sizes', 'largeText')}
            </div>
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-keyboard"></i> Input</div>
                ${this._toggle('Keyboard Shortcuts', 'Enable hotkeys (Ctrl+, for settings)', 'keyboardShortcuts')}
                ${this._toggle('Screen Reader Mode', 'Enhanced ARIA labels', 'screenReaderMode')}
            </div>
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-info-circle"></i> Keyboard Shortcuts Reference</div>
                <div class="sp-shortcuts-grid">
                    <div class="sp-shortcut"><kbd>Ctrl</kbd> + <kbd>,</kbd><span>Open Settings</span></div>
                    <div class="sp-shortcut"><kbd>Esc</kbd><span>Close Modal</span></div>
                    <div class="sp-shortcut"><kbd>Ctrl</kbd> + <kbd>D</kbd><span>Toggle Dark Mode</span></div>
                    <div class="sp-shortcut"><kbd>Ctrl</kbd> + <kbd>/</kbd><span>Search</span></div>
                </div>
            </div>
        </div>`;
    }

    _tabPrivacy() {
        return `
        <div class="sp-tab" id="tab-privacy">
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-chart-bar"></i> Usage & Analytics</div>
                ${this._toggle('Audit My Actions', 'Log your dashboard activity', 'auditMyActions')}
                ${this._toggle('Anonymous Analytics', 'Help improve DarkLock', 'analyticsOptIn')}
                ${this._toggle('Share Usage Data', 'Contribute anonymous feature usage', 'shareUsageData')}
            </div>
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-trash-alt"></i> Auto-Cleanup</div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Auto-Delete Logs</div><div class="sp-desc">Automatically purge old activity logs</div></div>
                    <select class="sp-select" onchange="window.settingsPanel.updateSetting('autoDeleteLogs', this.value)">
                        <option value="never" ${this.settings.autoDeleteLogs === 'never' ? 'selected' : ''}>Never</option>
                        <option value="30d" ${this.settings.autoDeleteLogs === '30d' ? 'selected' : ''}>After 30 days</option>
                        <option value="90d" ${this.settings.autoDeleteLogs === '90d' ? 'selected' : ''}>After 90 days</option>
                        <option value="1y" ${this.settings.autoDeleteLogs === '1y' ? 'selected' : ''}>After 1 year</option>
                    </select>
                </div>
            </div>
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-database"></i> Your Data</div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Export All Data</div><div class="sp-desc">Download everything we store about you</div></div>
                    <button class="sp-btn sp-btn-ghost" onclick="window.location.href='/api/user/export'"><i class="fas fa-download"></i> Export</button>
                </div>
                <div class="sp-row">
                    <div class="sp-row-info"><div class="sp-label">Delete All Data</div><div class="sp-desc">Permanently erase your data — cannot be undone</div></div>
                    <button class="sp-btn sp-btn-danger" onclick="window.settingsPanel._deleteData()"><i class="fas fa-trash"></i> Delete</button>
                </div>
            </div>
        </div>`;
    }

    _tabWidgets() {
        return `
        <div class="sp-tab" id="tab-widgets">
            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-clock"></i> Clock Widget</div>
                ${this._toggle('Enable Clock', 'Show a customizable clock overlay', 'clockEnabled')}
                <div class="sp-widget-opts" id="spClockOpts" style="display:${this.settings.clockEnabled ? 'block' : 'none'}">
                    <div class="sp-row">
                        <div class="sp-row-info"><div class="sp-label">Position</div></div>
                        <select class="sp-select" onchange="window.settingsPanel.updateSetting('clockPosition', this.value)">
                            <option value="top-left" ${this.settings.clockPosition === 'top-left' ? 'selected' : ''}>Top Left</option>
                            <option value="top-center" ${this.settings.clockPosition === 'top-center' ? 'selected' : ''}>Top Center</option>
                            <option value="top-right" ${this.settings.clockPosition === 'top-right' ? 'selected' : ''}>Top Right</option>
                            <option value="bottom-left" ${this.settings.clockPosition === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
                            <option value="bottom-center" ${this.settings.clockPosition === 'bottom-center' ? 'selected' : ''}>Bottom Center</option>
                            <option value="bottom-right" ${this.settings.clockPosition === 'bottom-right' ? 'selected' : ''}>Bottom Right</option>
                        </select>
                    </div>
                    <div class="sp-row">
                        <div class="sp-row-info"><div class="sp-label">Size</div></div>
                        <select class="sp-select" onchange="window.settingsPanel.updateSetting('clockSize', this.value)">
                            <option value="tiny" ${this.settings.clockSize === 'tiny' ? 'selected' : ''}>Tiny</option>
                            <option value="small" ${this.settings.clockSize === 'small' ? 'selected' : ''}>Small</option>
                            <option value="medium" ${this.settings.clockSize === 'medium' ? 'selected' : ''}>Medium</option>
                            <option value="large" ${this.settings.clockSize === 'large' ? 'selected' : ''}>Large</option>
                            <option value="xlarge" ${this.settings.clockSize === 'xlarge' ? 'selected' : ''}>Extra Large</option>
                        </select>
                    </div>
                    <div class="sp-row">
                        <div class="sp-row-info"><div class="sp-label">Style</div></div>
                        <select class="sp-select" onchange="window.settingsPanel.updateSetting('clockStyle', this.value)">
                            <option value="minimal" ${this.settings.clockStyle === 'minimal' ? 'selected' : ''}>Minimal</option>
                            <option value="modern" ${this.settings.clockStyle === 'modern' ? 'selected' : ''}>Modern</option>
                            <option value="classic" ${this.settings.clockStyle === 'classic' ? 'selected' : ''}>Classic</option>
                            <option value="neon" ${this.settings.clockStyle === 'neon' ? 'selected' : ''}>Neon Glow</option>
                            <option value="glassmorphic" ${this.settings.clockStyle === 'glassmorphic' ? 'selected' : ''}>Glass</option>
                        </select>
                    </div>
                    ${this._toggle('Show Seconds', 'Display seconds in time', 'clockShowSeconds')}
                    ${this._toggle('Show Date', 'Show current date', 'clockShowDate')}
                    ${this._toggle('Show Timezone', 'Show timezone info', 'clockShowTimezone')}
                </div>
            </div>

            <div class="sp-section">
                <div class="sp-section-header"><i class="fas fa-cog"></i> Settings Button</div>
                ${this._toggle('Enable Settings Button', 'Floating gear icon', 'bobbleEnabled')}
                <div class="sp-widget-opts" id="spBobbleOpts" style="display:${this.settings.bobbleEnabled ? 'block' : 'none'}">
                    <div class="sp-row">
                        <div class="sp-row-info"><div class="sp-label">Position</div></div>
                        <select class="sp-select" onchange="window.settingsPanel.updateSetting('bobblePosition', this.value)">
                            <option value="top-left" ${this.settings.bobblePosition === 'top-left' ? 'selected' : ''}>Top Left</option>
                            <option value="top-right" ${this.settings.bobblePosition === 'top-right' ? 'selected' : ''}>Top Right</option>
                            <option value="bottom-left" ${this.settings.bobblePosition === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
                            <option value="bottom-right" ${this.settings.bobblePosition === 'bottom-right' ? 'selected' : ''}>Bottom Right</option>
                        </select>
                    </div>
                    <div class="sp-row">
                        <div class="sp-row-info"><div class="sp-label">Size</div></div>
                        <select class="sp-select" onchange="window.settingsPanel.updateSetting('bobbleSize', this.value)">
                            <option value="small" ${this.settings.bobbleSize === 'small' ? 'selected' : ''}>Small</option>
                            <option value="medium" ${this.settings.bobbleSize === 'medium' ? 'selected' : ''}>Medium</option>
                            <option value="large" ${this.settings.bobbleSize === 'large' ? 'selected' : ''}>Large</option>
                        </select>
                    </div>
                    <div class="sp-row">
                        <div class="sp-row-info"><div class="sp-label">Opacity</div><div class="sp-desc">${this.settings.bobbleOpacity}%</div></div>
                        <input type="range" class="sp-range" min="20" max="100" value="${this.settings.bobbleOpacity}" oninput="window.settingsPanel.updateSetting('bobbleOpacity', parseInt(this.value)); this.closest('.sp-row').querySelector('.sp-desc').textContent=this.value+'%'">
                    </div>
                    ${this._toggle('Auto-Hide', 'Fade when not hovering', 'bobbleAutoHide')}
                </div>
            </div>
        </div>`;
    }

    /* ─── Reusable Toggle Generator ──────────────────────────── */
    _toggle(label, desc, key, customOnchange) {
        const onchange = customOnchange || `window.settingsPanel.updateSetting('${key}', this.checked)`;
        // Special handling for widget sub-options visibility
        let extra = '';
        if (key === 'clockEnabled') extra = `;var o=document.getElementById('spClockOpts');if(o)o.style.display=this.checked?'block':'none'`;
        if (key === 'bobbleEnabled') extra = `;var o=document.getElementById('spBobbleOpts');if(o)o.style.display=this.checked?'block':'none'`;

        return `
        <div class="sp-row">
            <div class="sp-row-info"><div class="sp-label">${label}</div><div class="sp-desc">${desc}</div></div>
            <label class="sp-toggle">
                <input type="checkbox" ${this.settings[key] ? 'checked' : ''} onchange="${onchange}${extra}">
                <span class="sp-toggle-track"><span class="sp-toggle-thumb"></span></span>
            </label>
        </div>`;
    }

    /* ─── Open / Close ───────────────────────────────────────── */
    open() {
        const modal = document.getElementById('settingsModal');
        if (!modal) return;
        modal.classList.add('active');
        this._loadAccountInfo();
        this._check2FA();
        this._loadSessions();
        this._loadLoginHistory();
    }

    close() {
        const modal = document.getElementById('settingsModal');
        if (modal) modal.classList.remove('active');
    }

    switchTab(tabId) {
        const modal = document.getElementById('settingsModal');
        if (!modal) return;
        modal.querySelectorAll('.sp-nav[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
        modal.querySelectorAll('.sp-tab').forEach(t => t.classList.toggle('active', t.id === `tab-${tabId}`));
        this.activeTab = tabId;
    }

    /* ─── Theme & Accent ─────────────────────────────────────── */
    setTheme(theme) {
        this.settings.theme = theme;
        localStorage.setItem('dashboardSettings', JSON.stringify(this.settings));
        document.querySelectorAll('.sp-theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === theme));
        this._applyTheme();
        this._updateThemeBadge();
    }

    _applyTheme() {
        let t = this.settings.theme;
        if (t === 'auto') {
            if (window.GuardianTheme) { window.GuardianTheme.refresh(); return; }
            t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', t);
        // Strip any previously-applied seasonal theme classes.
        const seasonalSuffix = '-mode';
        [...document.body.classList].forEach(cls => {
            if (cls.endsWith(seasonalSuffix)) document.body.classList.remove(cls);
        });
    }

    _updateThemeBadge() {
        const badge = document.getElementById('currentThemeBadge');
        if (!badge) return;
        const map = { dark: ['fa-moon', 'Dark'], light: ['fa-sun', 'Light'], auto: ['fa-wand-magic-sparkles', 'Auto'] };
        const [icon, name] = map[this.settings.theme] || map.dark;
        badge.innerHTML = `<i class="fas ${icon}"></i> ${name}`;
    }

    setAccentColor(color) {
        this.settings.accentColor = color;
        localStorage.setItem('dashboardSettings', JSON.stringify(this.settings));
        this._applyAccentColor(color);
        const inp = document.querySelector('.sp-color-input');
        if (inp) inp.value = color;
        document.querySelectorAll('.sp-color-dot').forEach(d => {
            d.classList.toggle('active', d.style.background === color || d.style.backgroundColor === color);
        });
    }

    // Apply the accent color to every CSS variable the dashboard reads from.
    // Previously only --cyber-accent was set, so --ds-primary / --color-primary
    // never updated and the color picker appeared to do nothing on most pages.
    _applyAccentColor(color) {
        const root = document.documentElement.style;
        root.setProperty('--cyber-accent', color);
        root.setProperty('--color-primary', color);
        root.setProperty('--ds-primary', color);
        root.setProperty('--ds-accent', color);
    }

    /* ─── Apply All Settings ─────────────────────────────────── */
    _applyAll() {
        this._applyTheme();
        this._updateThemeBadge();
        this._applyAccentColor(this.settings.accentColor);
        document.body.classList.toggle('compact-mode', this.settings.compactMode);
        document.body.classList.toggle('no-animations', !this.settings.animations);
        document.body.classList.toggle('no-glass', !this.settings.glassEffects);
        document.body.classList.toggle('reduce-motion', this.settings.reduceMotion);
        window.dispatchEvent(new CustomEvent('DLReduceMotion', { detail: { active: !!this.settings.reduceMotion } }));
        document.body.classList.toggle('high-contrast', this.settings.highContrast);
        document.body.classList.toggle('large-text', this.settings.largeText);
        if (this.settings.fontScale !== 100) document.documentElement.style.fontSize = this.settings.fontScale + '%';
        this._applyClockSettings();
        this._applyBobbleSettings();
    }

    /* ─── Clock Widget ───────────────────────────────────────── */
    _createClockWidget() {
        const old = document.getElementById('dashboardClock');
        if (old) old.remove();
        if (this._clockInterval) { clearInterval(this._clockInterval); this._clockInterval = null; }

        const clock = document.createElement('div');
        clock.className = 'dashboard-clock';
        clock.id = 'dashboardClock';
        clock.innerHTML = `<div class="clock-time" id="clockTime">00:00</div><div class="clock-date" id="clockDate"></div><div class="clock-timezone" id="clockTimezone"></div>`;
        document.body.appendChild(clock);

        this._updateClock();
        this._clockInterval = setInterval(() => this._updateClock(), 1000);
    }

    _updateClock() {
        const timeEl = document.getElementById('clockTime');
        const dateEl = document.getElementById('clockDate');
        const tzEl   = document.getElementById('clockTimezone');
        if (!timeEl) return;

        const now = new Date();
        let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds(), ampm = '';

        if (this.settings.timeFormat === '12hr') {
            ampm = h >= 12 ? ' PM' : ' AM';
            h = h % 12 || 12;
        }
        const pad = n => String(n).padStart(2, '0');
        timeEl.textContent = this.settings.clockShowSeconds
            ? `${pad(h)}:${pad(m)}:${pad(s)}${ampm}`
            : `${pad(h)}:${pad(m)}${ampm}`;

        if (this.settings.clockShowDate && dateEl) {
            const day = now.getDate(), month = now.getMonth() + 1, year = now.getFullYear();
            const wd = now.toLocaleDateString('en-US', { weekday: 'short' });
            const fmts = {
                'DD/MM/YYYY': `${wd}, ${pad(day)}/${pad(month)}/${year}`,
                'YYYY-MM-DD': `${wd}, ${year}-${pad(month)}-${pad(day)}`,
                'MM/DD/YYYY': `${wd}, ${pad(month)}/${pad(day)}/${year}`
            };
            dateEl.textContent = fmts[this.settings.dateFormat] || fmts['MM/DD/YYYY'];
            dateEl.style.display = 'block';
        } else if (dateEl) dateEl.style.display = 'none';

        if (this.settings.clockShowTimezone && tzEl) {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const off = now.getTimezoneOffset();
            const oh = Math.abs(Math.floor(off / 60)), om = Math.abs(off % 60);
            tzEl.textContent = `${tz} (UTC${off <= 0 ? '+' : '-'}${oh}:${pad(om)})`;
            tzEl.style.display = 'block';
        } else if (tzEl) tzEl.style.display = 'none';
    }

    _applyClockSettings() {
        const c = document.getElementById('dashboardClock');
        if (!c) return;
        c.style.display = this.settings.clockEnabled ? 'flex' : 'none';
        c.className = 'dashboard-clock';
        c.classList.add(`clock-${this.settings.clockPosition}`, `clock-${this.settings.clockSize}`, `clock-style-${this.settings.clockStyle}`);
    }

    /* ─── Settings Bobble ────────────────────────────────────── */
    _createBobble() {
        const old = document.getElementById('settingsBobble');
        if (old) old.remove();

        const b = document.createElement('div');
        b.className = 'sp-bobble';
        b.id = 'settingsBobble';
        b.innerHTML = `<i class="fas fa-cog"></i><span class="sp-bobble-tip">Settings</span>`;

        // Restore position
        const saved = localStorage.getItem('settingsBobblePosition');
        if (saved) {
            try {
                const pos = JSON.parse(saved);
                b.style.top = pos.top; b.style.left = pos.left; b.style.right = 'auto';
            } catch(e) {}
        }

        b.addEventListener('click', (e) => {
            if (!b.classList.contains('was-dragged')) this.open();
            b.classList.remove('was-dragged');
        });

        this._makeDraggable(b);
        document.body.appendChild(b);
        this._applyBobbleSettings();

        // Re-clamp on resize
        window.addEventListener('resize', () => this._clampBobble(b));
    }

    _applyBobbleSettings() {
        const b = document.getElementById('settingsBobble');
        if (!b) return;
        b.style.display = this.settings.bobbleEnabled ? 'flex' : 'none';

        // Only apply corner position if no saved drag position
        if (!localStorage.getItem('settingsBobblePosition')) {
            b.style.top = ''; b.style.bottom = ''; b.style.left = ''; b.style.right = '';
            const pos = this.settings.bobblePosition;
            if (pos.includes('top')) b.style.top = '20px'; else b.style.bottom = '20px';
            if (pos.includes('left')) b.style.left = '20px'; else b.style.right = '20px';
        }

        b.className = 'sp-bobble';
        b.classList.add(`bobble-${this.settings.bobbleSize}`);
        b.style.opacity = this.settings.bobbleOpacity / 100;
        b.classList.toggle('bobble-auto-hide', this.settings.bobbleAutoHide);
    }

    _makeDraggable(el) {
        let dragging = false, moved = false, sx, sy, sl, st;

        const down = (e) => {
            if (e.target.closest('.sp-bobble-tip')) return;
            dragging = true; moved = false;
            el.classList.add('dragging');
            const r = el.getBoundingClientRect();
            sx = e.clientX || e.touches?.[0]?.clientX;
            sy = e.clientY || e.touches?.[0]?.clientY;
            sl = r.left; st = r.top;
            e.preventDefault();
        };
        const move = (e) => {
            if (!dragging) return;
            const cx = e.clientX || e.touches?.[0]?.clientX, cy = e.clientY || e.touches?.[0]?.clientY;
            if (Math.abs(cx - sx) > 5 || Math.abs(cy - sy) > 5) moved = true;
            let nl = Math.max(0, Math.min(sl + cx - sx, window.innerWidth - el.offsetWidth));
            let nt = Math.max(0, Math.min(st + cy - sy, window.innerHeight - el.offsetHeight));
            el.style.left = nl + 'px'; el.style.top = nt + 'px'; el.style.right = 'auto';
        };
        const up = () => {
            if (!dragging) return;
            dragging = false; el.classList.remove('dragging');
            if (moved) {
                el.classList.add('was-dragged');
                localStorage.setItem('settingsBobblePosition', JSON.stringify({ left: el.style.left, top: el.style.top }));
            }
        };

        el.addEventListener('mousedown', down);
        el.addEventListener('touchstart', down, { passive: false });
        document.addEventListener('mousemove', move);
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('mouseup', up);
        document.addEventListener('touchend', up);
    }

    _clampBobble(b) {
        if (!b) return;
        const max_l = window.innerWidth - b.offsetWidth - 10, max_t = window.innerHeight - b.offsetHeight - 10;
        let l = parseInt(b.style.left) || 10, t = parseInt(b.style.top) || 10;
        b.style.left = Math.max(10, Math.min(l, max_l)) + 'px';
        b.style.top = Math.max(10, Math.min(t, max_t)) + 'px';
    }

    /* ─── Account Methods ────────────────────────────────────── */
    async _loadAccountInfo() {
        try {
            const res = await fetch('/api/auth/me', { credentials: 'include' });
            if (res.ok) {
                const user = await res.json();
                const ld = document.getElementById('spLinkedDiscord');
                if (ld) ld.textContent = user.username || 'Not linked';
                const dn = document.getElementById('spDisplayName');
                if (dn) dn.value = user.displayName || user.username || '';
            }
        } catch(e) { console.warn('[Settings] Account load failed:', e); }

        try {
            const res = await fetch('/api/user/profile', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.profile) {
                    const dn = document.getElementById('spDisplayName');
                    const em = document.getElementById('spEmail');
                    const ld = document.getElementById('spLinkedDiscord');
                    if (dn && data.profile.displayName) dn.value = data.profile.displayName;
                    if (em && data.profile.email) em.value = data.profile.email;
                    if (ld && data.profile.discordId) ld.textContent = `${data.profile.username} (${data.profile.discordId})`;
                }
            }
        } catch(e) {}
    }

    async _updateProfile() {
        const dn = document.getElementById('spDisplayName')?.value?.trim();
        const em = document.getElementById('spEmail')?.value?.trim();
        try {
            const res = await fetch('/api/user/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this._csrf() },
                credentials: 'include',
                body: JSON.stringify({ displayName: dn, email: em })
            });
            this._toast(res.ok ? 'Profile updated!' : 'Update failed', res.ok ? 'success' : 'error');
        } catch(e) { this._toast('Update failed', 'error'); }
    }

    /* ─── 2FA ────────────────────────────────────────────────── */
    async _check2FA() {
        try {
            const res = await fetch('/api/2fa/discord/status', { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            const card = document.getElementById('sp2faStatus');
            if (!card) return;
            if (data.enabled) {
                card.className = 'sp-2fa-card enabled';
                card.querySelector('.sp-label').textContent = '2FA is enabled';
                card.querySelector('.sp-desc').textContent = `Your account is protected${data.backupCodesRemaining ? ` — ${data.backupCodesRemaining} backup codes` : ''}`;
            } else {
                card.className = 'sp-2fa-card';
                card.querySelector('.sp-label').textContent = '2FA is disabled';
                card.querySelector('.sp-desc').textContent = 'Add an extra layer of security';
            }
        } catch(e) {}
    }

    /* ─── Sessions ───────────────────────────────────────────── */
    async _loadSessions() {
        try {
            const res = await fetch('/api/user/sessions', { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            const list = document.getElementById('spSessionList');
            if (!list || !data.sessions) return;
            list.innerHTML = data.sessions.map(s => `
                <div class="sp-session ${s.current ? 'sp-session-current' : ''}">
                    <div class="sp-session-icon"><i class="fas ${this._deviceIcon(s.device)}"></i></div>
                    <div class="sp-session-info">
                        <div class="sp-label">${s.current ? 'This Device' : (s.device || 'Unknown')}</div>
                        <div class="sp-desc">${s.browser || 'Unknown'} · ${s.os || 'Unknown'} · ${this._timeAgo(s.lastActive)}</div>
                    </div>
                    ${!s.current ? `<button class="sp-btn sp-btn-danger sp-btn-sm" onclick="window.settingsPanel._revokeSession('${s.id}')"><i class="fas fa-times"></i></button>` : '<span class="sp-current-badge">Active</span>'}
                </div>
            `).join('');
        } catch(e) {
            const list = document.getElementById('spSessionList');
            if (list) list.innerHTML = '<div class="sp-desc" style="padding:1rem;text-align:center">Unable to load sessions</div>';
        }
    }

    async _loadLoginHistory() {
        const el = document.getElementById('spLoginHistory');
        if (!el) return;
        try {
            const res = await fetch('/api/user/sessions', { credentials: 'include' });
            if (!res.ok) throw new Error();
            const data = await res.json();
            if (!data.sessions?.length) { el.innerHTML = '<div class="sp-desc" style="padding:1rem;text-align:center">No history</div>'; return; }
            el.innerHTML = data.sessions.map(s => `
                <div class="sp-session">
                    <div class="sp-session-icon"><i class="fas ${this._deviceIcon(s.device)}"></i></div>
                    <div class="sp-session-info">
                        <div class="sp-label">${s.device || 'Unknown'} ${s.current ? '<span style="color:var(--cyber-accent)">(current)</span>' : ''}</div>
                        <div class="sp-desc">${s.browser || ''} · ${s.ip_address || s.ip || ''} · ${s.created_at ? new Date(s.created_at).toLocaleString() : ''}</div>
                    </div>
                </div>
            `).join('');
        } catch(e) { el.innerHTML = '<div class="sp-desc" style="padding:1rem;text-align:center">Unable to load</div>'; }
    }

    async _revokeSession(id) {
        if (!confirm('Sign out this session?')) return;
        try {
            const res = await fetch(`/api/user/sessions/${id}`, { method: 'DELETE', credentials: 'include' });
            this._toast(res.ok ? 'Session revoked' : 'Failed', res.ok ? 'success' : 'error');
            if (res.ok) this._loadSessions();
        } catch(e) { this._toast('Failed', 'error'); }
    }

    async _revokeAll() {
        if (!confirm('Sign out ALL other sessions?')) return;
        try {
            const res = await fetch('/api/user/sessions/revoke-all', { method: 'POST', credentials: 'include' });
            this._toast(res.ok ? 'All other sessions signed out' : 'Failed', res.ok ? 'success' : 'error');
            if (res.ok) this._loadSessions();
        } catch(e) { this._toast('Failed', 'error'); }
    }

    /* ─── Data Methods ───────────────────────────────────────── */
    async _deleteData() {
        const msg = 'Type DELETE to permanently erase all your data.';
        const input = prompt(msg);
        if (input !== 'DELETE') return;
        try {
            const res = await fetch('/api/user/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this._csrf() },
                credentials: 'include',
                body: JSON.stringify({ confirm: 'DELETE' })
            });
            if (res.ok) {
                this._toast('Data deleted — signing out...', 'success');
                setTimeout(() => { window.location.href = '/logout'; }, 1500);
            } else {
                const err = await res.json().catch(() => ({}));
                this._toast(err.error || 'Delete failed', 'error');
            }
        } catch (e) {
            this._toast('Delete failed', 'error');
        }
    }

    async _requestNotifPerm(checkbox) {
        if (checkbox.checked) {
            const perm = await Notification.requestPermission();
            if (perm === 'granted') {
                this.updateSetting('desktopNotifications', true);
                this._toast('Desktop notifications enabled', 'success');
            } else { checkbox.checked = false; this._toast('Permission denied', 'error'); }
        } else {
            this.updateSetting('desktopNotifications', false);
        }
    }

    _resetToDefaults() {
        if (!confirm('Reset ALL settings to defaults?')) return;
        this.settings = this._defaults();
        localStorage.removeItem('dashboardSettings');
        localStorage.removeItem('settingsBobblePosition');
        this._applyAll();
        this.close();
        // Rebuild modal with fresh defaults
        this._initialized = false;
        this._createModal();
        this._createBobble();
        this._initialized = true;
        this._toast('Settings reset', 'success');
    }

    /* ─── Utilities ──────────────────────────────────────────── */
    _csrf() { return document.querySelector('meta[name="csrf-token"]')?.content || ''; }

    _deviceIcon(d) {
        if (!d) return 'fa-desktop';
        const l = d.toLowerCase();
        if (l.match(/mobile|phone|android|ios/)) return 'fa-mobile-alt';
        if (l.match(/tablet|ipad/)) return 'fa-tablet-alt';
        return 'fa-desktop';
    }

    _timeAgo(ts) {
        if (!ts) return 'Unknown';
        const diff = Date.now() - new Date(ts).getTime();
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return Math.floor(diff / 86400000) + 'd ago';
    }

    _toast(message, type = 'info') {
        const t = document.createElement('div');
        t.className = 'sp-toast sp-toast-' + type;
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
        t.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;

        // Position based on setting
        const pos = this.settings.notificationPosition || 'bottom-right';
        t.style.position = 'fixed';
        t.style.zIndex = '10001';
        if (pos.includes('top')) t.style.top = '20px'; else t.style.bottom = '20px';
        if (pos.includes('left')) t.style.left = '20px'; else t.style.right = '20px';

        document.body.appendChild(t);
        const dur = (this.settings.notificationDuration || 3) * 1000;
        setTimeout(() => { t.classList.add('sp-toast-out'); setTimeout(() => t.remove(), 350); }, dur);
    }
}

/* ─── Single Clean Initialization ────────────────────────────── */
(function() {
    function boot() {
        if (window.settingsPanel) return;
        try {
            window.settingsPanel = new SettingsPanel();
        } catch(e) {
            console.error('[SettingsPanel] Init failed:', e);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // Keyboard shortcut: Ctrl+, to open settings
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === ',') {
            e.preventDefault();
            if (window.settingsPanel) window.settingsPanel.open();
        }
    });
})();
