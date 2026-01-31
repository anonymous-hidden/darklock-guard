/**
 * Darklock Platform - Dashboard JavaScript
 * Single-page application with no reloads
 */

// Global state
let currentUser = null;
let currentPage = 'dashboard';

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    // Load user data
    await loadUserData();
    
    // Load user settings
    await loadUserSettings();
    
    // Apply saved settings (font scaling, high contrast)
    applySavedSettings();
    
    // Setup navigation
    setupNavigation();
    
    // Setup sidebar toggle
    setupSidebar();
    
    // Setup logout
    setupLogout();
    
    // Setup profile tabs
    setupProfileTabs();
    
    // Setup forms
    setupForms();
    
    // Setup modal
    setupModal();
    
    // Setup collapsible cards
    setupCollapsibleCards();
    
    // Setup language settings
    setupLanguageSettings();
    
    // Setup application launch handlers
    setupAppLaunchHandlers();
    
    // Load initial page data
    loadPageData('dashboard');
}

// ============================================================================
// APPLICATION LAUNCH
// ============================================================================

/**
 * Setup event handlers for application launch buttons
 */
function setupAppLaunchHandlers() {
    // Add click event for launch button
    document.addEventListener('click', function(event) {
        // Check if clicked element or its parent is a launch button
        const launchBtn = event.target.closest('a[href*="/platform/launch/"]');
        if (launchBtn) {
            event.preventDefault();
            const appName = launchBtn.href.split('/').pop();
            launchApplication(appName, launchBtn);
        }
    });
}

/**
 * Launch desktop application or prompt to download
 */
async function launchApplication(appName, button) {
    const originalText = button.innerHTML;
    
    // Show loading state
    button.classList.add('loading');
    button.innerHTML = `
        <span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span>
        Launching...
    `;
    
    // Add spin animation if not exists
    if (!document.getElementById('launch-spinner-style')) {
        const spinStyle = document.createElement('style');
        spinStyle.id = 'launch-spinner-style';
        spinStyle.textContent = `
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(spinStyle);
    }
    
    try {
        const response = await fetch(`/platform/launch/${appName}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            if (response.status === 404) {
                // Application not found - prompt to download
                showDownloadPrompt(appName, button, originalText);
                return;
            }
            if (response.status === 401) {
                // Not authenticated
                openModal('Authentication Required', '<p style="color: var(--text-secondary);">Please log in to launch applications.</p>');
                button.classList.remove('loading');
                button.innerHTML = originalText;
                return;
            }
            throw new Error(data.error || 'Failed to launch application');
        }
        
        // Success - show message
        button.classList.remove('loading');
        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; display: inline-block; vertical-align: middle; margin-right: 4px;">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            Launched
        `;
        
        // Reset button after 3 seconds
        setTimeout(() => {
            button.classList.remove('loading');
            button.innerHTML = originalText;
        }, 3000);
        
    } catch (err) {
        console.error('Failed to launch application:', err);
        
        // Show error
        button.classList.remove('loading');
        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; display: inline-block; vertical-align: middle; margin-right: 4px;">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            Failed
        `;
        
        // Show modal with error details
        openModal('Launch Failed', `<p style="color: var(--text-secondary);">${err.message}</p>`);
        
        // Reset button after 3 seconds
        setTimeout(() => {
            button.classList.remove('loading');
            button.innerHTML = originalText;
        }, 3000);
    }
}

/**
 * Show download prompt when application is not installed
 */
function showDownloadPrompt(appName, button, originalText) {
    button.classList.remove('loading');
    button.innerHTML = originalText;
    
    const appDisplayName = appName.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    
    const modalContent = `
        <p style="margin-bottom: 1.5rem; color: var(--text-secondary);">
            ${appDisplayName} is not installed on this computer. Would you like to download and install it?
        </p>
        <div style="display: flex; gap: 1rem; justify-content: flex-end;">
            <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
            <a href="/platform/download/${appName}" class="btn btn-primary" onclick="closeModal()">
                Download Now
            </a>
        </div>
    `;
    
    openModal(`${appDisplayName} Not Found`, modalContent);
}

// ============================================================================
// USER DATA
// ============================================================================
let userSettings = {};

async function loadUserData() {
    try {
        const response = await fetch('/platform/dashboard/api/me');
        const data = await response.json();
        
        if (data.success) {
            currentUser = data.user;
            updateUserDisplay();
        }
    } catch (err) {
        console.error('Failed to load user data:', err);
    }
}

async function loadUserSettings() {
    try {
        const response = await fetch('/platform/dashboard/api/settings');
        const data = await response.json();
        
        if (data.success && data.settings) {
            userSettings = data.settings;
            
            // Populate form fields with saved settings
            populateSettingsForm(userSettings);
            
            // Apply settings immediately
            applySettings(userSettings);
        }
    } catch (err) {
        console.error('Failed to load user settings:', err);
    }
}

function populateSettingsForm(settings) {
    // Language & Region
    if (settings.language) document.getElementById('language').value = settings.language;
    if (settings.autoDetectLanguage !== undefined) document.getElementById('autoDetectLanguage').checked = settings.autoDetectLanguage;
    if (settings.timezone) document.getElementById('timezone').value = settings.timezone;
    if (settings.autoDetectTimezone !== undefined) document.getElementById('autoDetectTimezone').checked = settings.autoDetectTimezone;
    if (settings.dateFormat) document.getElementById('dateFormat').value = settings.dateFormat;
    if (settings.timeFormat) document.getElementById('timeFormat').value = settings.timeFormat;
    
    // Platform
    if (settings.defaultLandingPage) document.getElementById('defaultLandingPage').value = settings.defaultLandingPage;
    if (settings.rememberLastApp !== undefined) document.getElementById('rememberLastApp').checked = settings.rememberLastApp;
    if (settings.autoSave !== undefined) document.getElementById('autoSave').checked = settings.autoSave;
    
    // Appearance
    if (settings.theme) document.getElementById('theme').value = settings.theme;
    if (settings.compactMode !== undefined) document.getElementById('compactMode').checked = settings.compactMode;
    if (settings.sidebarPosition) document.getElementById('sidebarPosition').value = settings.sidebarPosition;
    
    // Accessibility
    if (settings.fontScaling) document.getElementById('fontScaling').value = settings.fontScaling;
    if (settings.highContrast !== undefined) document.getElementById('highContrast').checked = settings.highContrast;
    if (settings.reducedMotion !== undefined) document.getElementById('reducedMotion').checked = settings.reducedMotion;
    if (settings.screenReaderSupport !== undefined) document.getElementById('screenReaderSupport').checked = settings.screenReaderSupport;
    
    // Notifications
    if (settings.emailNotifications !== undefined) document.getElementById('emailNotifications').checked = settings.emailNotifications;
    if (settings.pushNotifications !== undefined) document.getElementById('pushNotifications').checked = settings.pushNotifications;
    if (settings.soundEnabled !== undefined) document.getElementById('soundEnabled').checked = settings.soundEnabled;
    
    // Privacy & Security
    if (settings.activityTracking !== undefined) document.getElementById('activityTracking').checked = settings.activityTracking;
    if (settings.sessionTimeout) document.getElementById('sessionTimeout').value = settings.sessionTimeout;
    if (settings.require2FA !== undefined) document.getElementById('require2FA').checked = settings.require2FA;
    
    // Experimental
    if (settings.betaFeatures !== undefined) document.getElementById('betaFeatures').checked = settings.betaFeatures;
}

function updateUserDisplay() {
    if (!currentUser) return;
    
    // Update sidebar user info
    document.getElementById('userName').textContent = currentUser.username;
    document.getElementById('userRole').textContent = currentUser.role;
    
    // Update welcome message with personalized greeting
    const welcomeName = document.getElementById('welcomeName');
    if (welcomeName) {
        welcomeName.textContent = currentUser.username;
    }
    
    // Update welcome subtitle with time-based greeting
    const welcomeSubtitle = document.querySelector('.welcome-subtitle');
    if (welcomeSubtitle) {
        const hour = new Date().getHours();
        let greeting = 'Good evening';
        if (hour < 12) greeting = 'Good morning';
        else if (hour < 17) greeting = 'Good afternoon';
        welcomeSubtitle.textContent = `${greeting}, ${currentUser.username}! Here's your security overview.`;
    }
    
    // Update 2FA status in dashboard
    const stat2FA = document.getElementById('stat2FA');
    if (stat2FA) {
        stat2FA.textContent = currentUser.twoFactorEnabled ? 'Enabled' : 'Disabled';
        stat2FA.className = currentUser.twoFactorEnabled ? 'stat-value stat-success' : 'stat-value stat-warning';
    }
    
    // Update security checklist
    updateSecurityChecklist();
}

function updateSecurityChecklist() {
    const check2FA = document.getElementById('check2FA');
    if (check2FA) {
        const icon = check2FA.querySelector('.security-icon');
        const desc = check2FA.querySelector('.security-desc');
        
        if (currentUser.twoFactorEnabled) {
            check2FA.classList.add('complete');
            icon.classList.remove('pending');
            icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>`;
            desc.textContent = 'Two-factor authentication is enabled';
        } else {
            check2FA.classList.add('incomplete');
            icon.classList.add('pending');
            icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4M12 16h.01"/>
            </svg>`;
            desc.textContent = 'Enable 2FA for extra security';
        }
    }
}

// ============================================================================
// NAVIGATION
// ============================================================================
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            navigateTo(page);
        });
    });
}

function navigateTo(page) {
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    
    // Update page visibility
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === `page-${page}`);
    });
    
    // Update topbar title
    const titles = {
        dashboard: 'Dashboard',
        profile: 'Profile',
        apps: 'Applications',
        security: 'Security',
        account: 'Account',
        settings: 'Settings'
    };
    document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';
    
    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    
    // Load page data
    loadPageData(page);
    
    currentPage = page;
}

// Make navigateTo globally available
window.navigateTo = navigateTo;

function loadPageData(page) {
    switch (page) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'profile':
            loadProfileData();
            break;
        case 'apps':
            loadAppsData();
            break;
        case 'security':
            loadSecurityData();
            loadSessions();
            load2FAStatus();
            break;
        case 'account':
            loadAccountData();
            break;
        case 'settings':
            loadSettingsData();
            break;
    }
}

// ============================================================================
// SIDEBAR
// ============================================================================
function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    
    toggle?.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });
    
    // Close sidebar on overlay click (mobile)
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 1024) {
            if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        }
    });
}

// ============================================================================
// LOGOUT
// ============================================================================
function setupLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    
    logoutBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        
        try {
            const response = await fetch('/platform/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                window.location.href = data.redirect || '/platform';
            }
        } catch (err) {
            console.error('Logout error:', err);
            showToast('Failed to logout', 'error');
        }
    });
}

// ============================================================================
// PROFILE TABS
// ============================================================================
function setupProfileTabs() {
    const tabs = document.querySelectorAll('.profile-tab');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            
            // Update active tab
            tabs.forEach(t => t.classList.toggle('active', t === tab));
            
            // Update active panel
            document.querySelectorAll('.profile-panel').forEach(panel => {
                panel.classList.toggle('active', panel.id === `panel-${tabId}`);
            });
            
            // Load tab-specific data
            loadTabData(tabId);
        });
    });
}

function loadTabData(tab) {
    switch (tab) {
        case 'sessions':
            loadSessions();
            break;
        case '2fa':
            load2FAStatus();
            break;
    }
}

// ============================================================================
// DASHBOARD DATA
// ============================================================================
async function loadDashboardData() {
    // Load stats
    try {
        const [statsRes, sessionsRes] = await Promise.all([
            fetch('/platform/dashboard/api/stats', { credentials: 'include' }),
            fetch('/platform/auth/sessions', { credentials: 'include' })
        ]);
        
        const statsData = await statsRes.json();
        const sessionsData = await sessionsRes.json();
        
        if (statsData.success) {
            document.getElementById('statApps').textContent = statsData.stats.activeApps;
        }
        
        if (sessionsData.success) {
            document.getElementById('statSessions').textContent = sessionsData.sessions.length;
        }
        
        // Format last login
        if (currentUser?.lastLogin) {
            const lastLogin = new Date(currentUser.lastLogin);
            const now = new Date();
            const diff = now - lastLogin;
            
            let timeAgo;
            if (diff < 60000) timeAgo = 'Just now';
            else if (diff < 3600000) timeAgo = Math.floor(diff / 60000) + 'm ago';
            else if (diff < 86400000) timeAgo = Math.floor(diff / 3600000) + 'h ago';
            else timeAgo = Math.floor(diff / 86400000) + 'd ago';
            
            document.getElementById('statLastLogin').textContent = timeAgo;
        }
    } catch (err) {
        console.error('Error loading dashboard data:', err);
    }
}

// ============================================================================
// PROFILE DATA
// ============================================================================
function loadProfileData() {
    if (!currentUser) return;
    
    // Fill profile overview
    const profileUsernameDisplay = document.getElementById('profileUsernameDisplay');
    if (profileUsernameDisplay) profileUsernameDisplay.textContent = currentUser.username;
    
    const profileDisplayName = document.getElementById('profileDisplayName');
    if (profileDisplayName) profileDisplayName.textContent = currentUser.displayName || currentUser.username;
    
    const profileRoleBadge = document.getElementById('profileRoleBadge');
    if (profileRoleBadge) {
        profileRoleBadge.textContent = currentUser.role;
        profileRoleBadge.className = 'identity-badge ' + (currentUser.role === 'admin' ? 'admin' : '');
    }
    
    const profileCreatedDisplay = document.getElementById('profileCreatedDisplay');
    if (profileCreatedDisplay) {
        profileCreatedDisplay.textContent = new Date(currentUser.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
    
    // Load avatar if exists
    const profileAvatarPreview = document.getElementById('profileAvatarPreview');
    if (profileAvatarPreview && currentUser.avatar) {
        profileAvatarPreview.style.backgroundImage = `url(${currentUser.avatar})`;
        profileAvatarPreview.style.backgroundSize = 'cover';
        profileAvatarPreview.style.backgroundPosition = 'center';
        profileAvatarPreview.innerHTML = '';
    }
    
    // Fill personal info form
    const displayNameInput = document.getElementById('displayNameInput');
    if (displayNameInput) displayNameInput.value = currentUser.displayName || '';
    
    const profileEmailReadonly = document.getElementById('profileEmailReadonly');
    if (profileEmailReadonly) profileEmailReadonly.value = currentUser.email;
    
    // Set timezone if available
    const timezoneSelect = document.getElementById('timezoneSelect');
    if (timezoneSelect && currentUser.timezone) {
        timezoneSelect.value = currentUser.timezone;
    }
    
    // Set language if available
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect && currentUser.language) {
        languageSelect.value = currentUser.language;
    }
    
    // Load preferences
    if (currentUser.preferences) {
        const themeSelect = document.getElementById('themeSelect');
        if (themeSelect && currentUser.preferences.theme) {
            themeSelect.value = currentUser.preferences.theme;
        }
        
        const reducedMotionToggle = document.getElementById('reducedMotionToggle');
        if (reducedMotionToggle) {
            reducedMotionToggle.checked = currentUser.preferences.reducedMotion || false;
        }
        
        const compactLayoutToggle = document.getElementById('compactLayoutToggle');
        if (compactLayoutToggle) {
            compactLayoutToggle.checked = currentUser.preferences.compactLayout || false;
        }
    }
    
    // Load notification settings
    if (currentUser.notifications) {
        const securityAlertsToggle = document.getElementById('securityAlertsToggle');
        if (securityAlertsToggle) {
            securityAlertsToggle.checked = currentUser.notifications.securityAlerts !== false;
        }
        
        const productUpdatesToggle = document.getElementById('productUpdatesToggle');
        if (productUpdatesToggle) {
            productUpdatesToggle.checked = currentUser.notifications.productUpdates !== false;
        }
        
        const emailNotificationsToggle = document.getElementById('emailNotificationsToggle');
        if (emailNotificationsToggle) {
            emailNotificationsToggle.checked = currentUser.notifications.emailNotifications !== false;
        }
    }
}

// ============================================================================
// SESSIONS
// ============================================================================
async function loadSessions() {
    const container = document.getElementById('sessionsList');
    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading sessions...</span></div>';
    
    try {
        const response = await fetch('/platform/auth/sessions', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        // FIX: Update security overview sessions count
        const securitySessionsCount = document.getElementById('securitySessionsCount');
        if (securitySessionsCount && data.success) {
            securitySessionsCount.textContent = data.sessions.length;
        }
        
        if (data.success && data.sessions.length > 0) {
            container.innerHTML = `
                <div class="sessions-header">
                    <span>${data.sessions.length} active session${data.sessions.length > 1 ? 's' : ''}</span>
                    ${data.sessions.length > 1 ? '<button class="btn btn-danger btn-sm" onclick="revokeAllSessions()">Logout All Others</button>' : ''}
                </div>
                ${data.sessions.map(session => `
                <div class="session-item" data-session-id="${session.id}">
                    <div class="session-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                            <line x1="8" y1="21" x2="16" y2="21"/>
                            <line x1="12" y1="17" x2="12" y2="21"/>
                        </svg>
                    </div>
                    <div class="session-info">
                        <span class="session-device">${session.device}</span>
                        <div class="session-meta">
                            <span class="session-ip">${session.ip}</span>
                            <span>Last active: ${formatTimeAgo(session.lastActive)}</span>
                        </div>
                    </div>
                    ${session.current ? 
                        '<span class="session-current">Current Session</span>' : 
                        `<button class="btn btn-ghost btn-sm" onclick="revokeSession('${session.id}')" title="End this session">Revoke</button>`
                    }
                </div>
            `).join('')}`;
        } else {
            container.innerHTML = '<div class="empty-state"><span>No active sessions</span></div>';
        }
    } catch (err) {
        console.error('Error loading sessions:', err);
        container.innerHTML = '<div class="empty-state"><span>Failed to load sessions</span></div>';
    }
}

async function revokeSession(sessionId) {
    try {
        const response = await fetch(`/platform/auth/sessions/${sessionId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Session revoked successfully', 'success');
            loadSessions();
        } else {
            showToast(data.error || 'Failed to revoke session', 'error');
        }
    } catch (err) {
        console.error('Error revoking session:', err);
        showToast('Failed to revoke session', 'error');
    }
}

async function revokeAllSessions() {
    if (!confirm('This will log out all your other sessions. Continue?')) return;
    
    try {
        const response = await fetch('/platform/auth/sessions/revoke-all', {
            method: 'POST',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('All other sessions have been logged out', 'success');
            loadSessions();
        } else {
            showToast(data.error || 'Failed to revoke sessions', 'error');
        }
    } catch (err) {
        console.error('Error revoking sessions:', err);
        showToast('Failed to revoke sessions', 'error');
    }
}

window.revokeSession = revokeSession;
window.revokeAllSessions = revokeAllSessions;

// ============================================================================
// 2FA
// ============================================================================
async function load2FAStatus() {
    const container = document.getElementById('twoFactorContent');
    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading 2FA status...</span></div>';
    
    try {
        const response = await fetch('/platform/profile/api/2fa/status', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (data.twoFactor.enabled) {
                container.innerHTML = `
                    <div class="two-factor-enabled">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            <path d="M9 12l2 2 4-4"/>
                        </svg>
                        <h4>Two-Factor Authentication is Enabled</h4>
                        <p>Your account is protected with an additional layer of security.</p>
                        <button class="btn btn-danger" onclick="disable2FA()">Disable 2FA</button>
                    </div>
                `;
            } else {
                container.innerHTML = `
                    <div class="two-factor-disabled">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                        <h4>Two-Factor Authentication is Disabled</h4>
                        <p>Enable 2FA to add an extra layer of security to your account.</p>
                        <button class="btn btn-primary" onclick="setup2FA()">Enable 2FA</button>
                    </div>
                `;
            }
        }
    } catch (err) {
        console.error('Error loading 2FA status:', err);
        container.innerHTML = '<div class="empty-state"><span>Failed to load 2FA status</span></div>';
    }
}

async function setup2FA() {
    const container = document.getElementById('twoFactorContent');
    
    // First, ask for password verification
    container.innerHTML = `
        <div class="two-factor-setup">
            <h4>Verify Your Identity</h4>
            <p>Enter your password to begin 2FA setup.</p>
            <form class="verify-form" onsubmit="startSetup2FA(event)">
                <div class="form-group">
                    <label class="form-label">Password</label>
                    <input type="password" id="setup2FAPassword" class="form-input" placeholder="Enter your password" required>
                </div>
                <button type="submit" class="btn btn-primary btn-block">Continue</button>
                <button type="button" class="btn btn-ghost btn-block" onclick="load2FAStatus()">Cancel</button>
            </form>
        </div>
    `;
}

async function startSetup2FA(e) {
    e.preventDefault();
    
    const password = document.getElementById('setup2FAPassword').value;
    const container = document.getElementById('twoFactorContent');
    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Setting up 2FA...</span></div>';
    
    try {
        const response = await fetch('/platform/profile/api/2fa/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            container.innerHTML = `
                <div class="two-factor-setup">
                    <h4>Scan QR Code</h4>
                    <p>Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)</p>
                    <div class="qr-container">
                        <img src="${data.qrCode}" alt="2FA QR Code">
                    </div>
                    <div class="manual-entry">
                        <div class="manual-entry-label">Or enter this code manually:</div>
                        <div class="manual-entry-code">${data.secret}</div>
                    </div>
                    <form class="verify-form" onsubmit="verify2FA(event)">
                        <div class="form-group">
                            <label class="form-label">Verification Code</label>
                            <input type="text" id="verifyCode" class="form-input" placeholder="000000" maxlength="6" pattern="[0-9]*" inputmode="numeric" required>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block">Verify and Enable</button>
                    </form>
                </div>
            `;
        } else {
            showToast(data.error || 'Failed to setup 2FA', 'error');
            load2FAStatus();
        }
    } catch (err) {
        console.error('Error setting up 2FA:', err);
        showToast('Failed to setup 2FA', 'error');
        load2FAStatus();
    }
}

window.setup2FA = setup2FA;
window.startSetup2FA = startSetup2FA;

async function verify2FA(e) {
    e.preventDefault();
    
    const code = document.getElementById('verifyCode').value;
    
    try {
        const response = await fetch('/platform/profile/api/2fa/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Show backup codes
            const container = document.getElementById('twoFactorContent');
            container.innerHTML = `
                <div class="two-factor-enabled">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    <h4>Two-Factor Authentication Enabled!</h4>
                    <p>Save these backup codes in a safe place. You can use them to access your account if you lose your authenticator.</p>
                    <div class="backup-codes">
                        ${data.backupCodes.map(code => `<span class="backup-code">${code}</span>`).join('')}
                    </div>
                    <button class="btn btn-primary" onclick="load2FAStatus()">Done</button>
                </div>
            `;
            
            // Update user state
            currentUser.twoFactorEnabled = true;
            updateUserUI();
            
            showToast('Two-factor authentication enabled!', 'success');
        } else {
            showToast(data.error || 'Invalid verification code', 'error');
        }
    } catch (err) {
        console.error('Error verifying 2FA:', err);
        showToast('Failed to verify code', 'error');
    }
}

window.verify2FA = verify2FA;

async function disable2FA() {
    // Show modal with password and code input
    openModal('Disable Two-Factor Authentication', `
        <p style="margin-bottom: 1rem; color: var(--text-muted);">
            For security, you must verify your identity to disable 2FA.
        </p>
        <form id="disable2FAForm" style="display: flex; flex-direction: column; gap: 1rem;">
            <div class="form-group">
                <label class="form-label">Password</label>
                <input type="password" id="disable2FAPassword" class="form-input" placeholder="Enter your password" required>
            </div>
            <div class="form-group">
                <label class="form-label">Authenticator Code</label>
                <input type="text" id="disable2FACode" class="form-input" placeholder="000000" maxlength="6" pattern="[0-9]*" inputmode="numeric" required>
            </div>
            <button type="submit" class="btn btn-danger btn-block">Disable 2FA</button>
        </form>
    `);
    
    document.getElementById('disable2FAForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const password = document.getElementById('disable2FAPassword').value;
        const code = document.getElementById('disable2FACode').value;
        
        try {
            const response = await fetch('/platform/profile/api/2fa/disable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, code }),
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                closeModal();
                currentUser.twoFactorEnabled = false;
                updateUserUI();
                load2FAStatus();
                showToast('Two-factor authentication disabled', 'success');
            } else {
                showToast(data.error || 'Failed to disable 2FA', 'error');
            }
        } catch (err) {
            console.error('Error disabling 2FA:', err);
            showToast('Failed to disable 2FA', 'error');
        }
    });
}

window.disable2FA = disable2FA;

// ============================================================================
// APPS DATA
// ============================================================================
async function loadAppsData() {
    const container = document.getElementById('appsList');
    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading applications...</span></div>';
    
    try {
        const response = await fetch('/platform/dashboard/api/apps', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success && data.apps.length > 0) {
            container.innerHTML = data.apps.map(app => `
                <div class="dashboard-app-card ${app.status}" ${app.status === 'coming-soon' ? 'title="This application is under development"' : ''}>
                    <div class="app-card-header">
                        <div class="app-card-icon ${app.status === 'coming-soon' ? 'disabled' : ''}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                ${app.status === 'active' ? '<path d="M9 12l2 2 4-4"/>' : ''}
                            </svg>
                        </div>
                        <div class="app-card-info">
                            <h3 class="app-card-name">${app.name}</h3>
                            <span class="app-card-status ${app.status}">
                                ${app.status === 'active' ? '● Active' : 
                                  app.status === 'coming-soon' ? '◷ Coming Soon' : 
                                  app.status === 'beta' ? '⚡ Beta' : 'Unavailable'}
                            </span>
                        </div>
                    </div>
                    <p class="app-card-desc">${app.description}</p>
                    <div class="app-card-features">
                        ${app.features.map(f => `<span class="app-card-feature">${f}</span>`).join('')}
                    </div>
                    ${app.status === 'active' && app.url ? 
                        `<a href="${app.url}" class="btn btn-primary btn-block">Open Dashboard</a>` :
                        app.status === 'beta' && app.url ?
                        `<a href="${app.url}" class="btn btn-secondary btn-block">Try Beta</a>` :
                        `<div class="app-coming-soon-wrapper">
                            <button class="btn btn-ghost btn-block" disabled>Coming Soon</button>
                            <span class="app-tooltip">This feature is under development</span>
                        </div>`
                    }
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-state"><span>No applications available</span></div>';
        }
    } catch (err) {
        console.error('Error loading apps:', err);
        container.innerHTML = '<div class="empty-state"><span>Failed to load applications</span></div>';
    }
}

// ============================================================================
// SECURITY DATA
// ============================================================================
async function loadSecurityData() {
    // Load security info from API
    try {
        const response = await fetch('/platform/profile/api/security', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
            const security = data.security;
            
            // Update last login display
            const lastLoginInfo = document.getElementById('lastLoginInfo');
            if (lastLoginInfo) {
                lastLoginInfo.innerHTML = `
                    <div class="security-detail-item">
                        <span class="detail-label">Last Login</span>
                        <span class="detail-value">${formatTimeAgo(security.lastLogin)}</span>
                    </div>
                    <div class="security-detail-item">
                        <span class="detail-label">Login IP</span>
                        <span class="detail-value">${security.lastLoginIp || 'Unknown'}</span>
                    </div>
                    <div class="security-detail-item">
                        <span class="detail-label">Active Sessions</span>
                        <span class="detail-value">${security.activeSessions}</span>
                    </div>
                    <div class="security-detail-item">
                        <span class="detail-label">Password Changed</span>
                        <span class="detail-value">${formatTimeAgo(security.lastPasswordChange)}</span>
                    </div>
                    <div class="security-detail-item">
                        <span class="detail-label">2FA Status</span>
                        <span class="detail-value ${security.twoFactorEnabled ? 'text-success' : 'text-warning'}">${security.twoFactorEnabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                `;
            }
        }
    } catch (err) {
        console.error('Error loading security data:', err);
    }
    
    // Calculate security score
    let score = 50; // Base score
    const improvements = [];
    
    if (currentUser?.twoFactorEnabled) {
        score += 25;
    } else {
        improvements.push({ text: 'Enable two-factor authentication', points: '+25', action: "navigateTo('profile'); document.querySelector('[data-tab=\"2fa\"]')?.click();" });
    }
    
    score += 25; // Password (assuming strong since they registered)
    
    // Update score display
    const scoreNumber = document.getElementById('scoreNumber');
    const scoreCircle = document.querySelector('.score-circle circle:last-of-type');
    
    if (scoreNumber) scoreNumber.textContent = score;
    if (scoreCircle) {
        const circumference = 283;
        const offset = circumference - (score / 100) * circumference;
        scoreCircle.setAttribute('stroke-dashoffset', offset);
        
        // Color based on score
        if (score >= 75) {
            scoreCircle.setAttribute('stroke', 'var(--success)');
        } else if (score >= 50) {
            scoreCircle.setAttribute('stroke', 'var(--warning)');
        } else {
            scoreCircle.setAttribute('stroke', 'var(--danger)');
        }
    }
    
    // Update improvements list
    const improvementList = document.getElementById('improvementList');
    if (improvementList) {
        if (improvements.length > 0) {
            improvementList.innerHTML = improvements.map(item => `
                <div class="improvement-item" ${item.action ? `onclick="${item.action}" style="cursor: pointer;"` : ''}>
                    <span>${item.text}</span>
                    <span class="improvement-points">${item.points}</span>
                </div>
            `).join('');
        } else {
            improvementList.innerHTML = '<div class="improvement-item complete"><span>🛡️ Your account security is excellent!</span></div>';
        }
    }
    
    // Update security overview stats
    const security2FAStatus = document.getElementById('security2FAStatus');
    if (security2FAStatus) {
        security2FAStatus.textContent = currentUser?.twoFactorEnabled ? 'Enabled' : 'Disabled';
        security2FAStatus.className = 'security-stat-value ' + (currentUser?.twoFactorEnabled ? 'text-success' : 'text-warning');
    }
    
    const securitySessionsCount = document.getElementById('securitySessionsCount');
    // securitySessionsCount is updated by loadSessions() below
}

// ============================================================================
// ACCOUNT DATA
// ============================================================================
function loadAccountData() {
    if (!currentUser) return;
    
    // Fill current email
    const currentEmailDisplay = document.getElementById('currentEmailDisplay');
    if (currentEmailDisplay) currentEmailDisplay.value = currentUser.email;
    
    // Fill current username
    const currentUsernameDisplay = document.getElementById('currentUsernameDisplay');
    if (currentUsernameDisplay) currentUsernameDisplay.value = currentUser.username;
    
    // Check if 2FA is required for email changes
    const emailChange2FAGroup = document.getElementById('emailChange2FAGroup');
    if (emailChange2FAGroup && currentUser.twoFactorEnabled) {
        emailChange2FAGroup.style.display = 'block';
    }
    
    // Setup account forms
    setupAccountForms();
}

function setupAccountForms() {
    // Email change form
    const emailChangeForm = document.getElementById('emailChangeForm');
    emailChangeForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const newEmail = document.getElementById('newEmail').value;
        const password = document.getElementById('emailChangePassword').value;
        const totpCode = document.getElementById('emailChange2FACode')?.value;
        
        try {
            const response = await fetch('/platform/profile/api/email', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newEmail, password, totpCode }),
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                currentUser.email = newEmail;
                document.getElementById('currentEmailDisplay').value = newEmail;
                document.getElementById('newEmail').value = '';
                document.getElementById('emailChangePassword').value = '';
                if (document.getElementById('emailChange2FACode')) {
                    document.getElementById('emailChange2FACode').value = '';
                }
                showToast('Email updated successfully', 'success');
            } else {
                showToast(data.error || 'Failed to update email', 'error');
            }
        } catch (err) {
            console.error('Error updating email:', err);
            showToast('Failed to update email', 'error');
        }
    });
    
    // Username change form
    const usernameChangeForm = document.getElementById('usernameChangeForm');
    usernameChangeForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const newUsername = document.getElementById('newUsername').value;
        
        try {
            const response = await fetch('/platform/profile/api/username', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newUsername }),
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                currentUser.username = newUsername;
                document.getElementById('currentUsernameDisplay').value = newUsername;
                document.getElementById('newUsername').value = '';
                updateUserUI();
                showToast('Username updated successfully', 'success');
            } else {
                showToast(data.error || 'Failed to update username', 'error');
            }
        } catch (err) {
            console.error('Error updating username:', err);
            showToast('Failed to update username', 'error');
        }
    });
    
    // Export data button
    const exportDataBtn = document.getElementById('exportDataBtn');
    exportDataBtn?.addEventListener('click', async () => {
        try {
            const response = await fetch('/platform/profile/api/export', {
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Create and download JSON file
                const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `darklock-export-${currentUser.username}-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('Data exported successfully', 'success');
            } else {
                showToast(data.error || 'Failed to export data', 'error');
            }
        } catch (err) {
            console.error('Error exporting data:', err);
            showToast('Failed to export data', 'error');
        }
    });
    
    // Clear sessions button
    const clearSessionsBtn = document.getElementById('clearSessionsBtn');
    clearSessionsBtn?.addEventListener('click', async () => {
        if (!confirm('This will log out all other devices. Continue?')) return;
        
        try {
            const response = await fetch('/platform/auth/sessions/revoke-all', {
                method: 'POST',
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                showToast('All other sessions cleared', 'success');
            } else {
                showToast(data.error || 'Failed to clear sessions', 'error');
            }
        } catch (err) {
            console.error('Error clearing sessions:', err);
            showToast('Failed to clear sessions', 'error');
        }
    });
    
    // Disable account button
    const disableAccountBtn = document.getElementById('disableAccountBtn');
    disableAccountBtn?.addEventListener('click', () => {
        openModal('Disable Account', `
            <p style="margin-bottom: 1rem; color: var(--text-muted);">
                Disabling your account will prevent you from accessing Darklock until you reactivate it.
            </p>
            <form id="disableAccountForm" style="display: flex; flex-direction: column; gap: 1rem;">
                <div class="form-group">
                    <label class="form-label">Password</label>
                    <input type="password" id="disableAccountPassword" class="form-input" placeholder="Enter your password" required>
                </div>
                <button type="submit" class="btn btn-danger btn-block">Disable My Account</button>
            </form>
        `);
        
        document.getElementById('disableAccountForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('disableAccountPassword').value;
            
            try {
                const response = await fetch('/platform/profile/api/disable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                    credentials: 'include'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    window.location.href = '/platform';
                } else {
                    showToast(data.error || 'Failed to disable account', 'error');
                }
            } catch (err) {
                console.error('Error disabling account:', err);
                showToast('Failed to disable account', 'error');
            }
        });
    });
    
    // Delete account button
    const deleteAccountBtn = document.getElementById('deleteAccountBtn');
    deleteAccountBtn?.addEventListener('click', () => {
        openModal('Delete Account', `
            <p style="margin-bottom: 1rem; color: var(--accent-danger);">
                <strong>Warning:</strong> This action is permanent and cannot be undone. All your data will be deleted.
            </p>
            <form id="deleteAccountForm" style="display: flex; flex-direction: column; gap: 1rem;">
                <div class="form-group">
                    <label class="form-label">Type your username to confirm</label>
                    <input type="text" id="deleteConfirmUsername" class="form-input" placeholder="${currentUser.username}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Password</label>
                    <input type="password" id="deleteAccountPassword" class="form-input" placeholder="Enter your password" required>
                </div>
                ${currentUser.twoFactorEnabled ? `
                <div class="form-group">
                    <label class="form-label">2FA Code</label>
                    <input type="text" id="deleteAccount2FACode" class="form-input" placeholder="000000" maxlength="6" required>
                </div>
                ` : ''}
                <button type="submit" class="btn btn-danger btn-block">Permanently Delete Account</button>
            </form>
        `);
        
        document.getElementById('deleteAccountForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const confirmUsername = document.getElementById('deleteConfirmUsername').value;
            const password = document.getElementById('deleteAccountPassword').value;
            const totpCode = document.getElementById('deleteAccount2FACode')?.value;
            
            if (confirmUsername !== currentUser.username) {
                showToast('Username does not match', 'error');
                return;
            }
            
            try {
                const response = await fetch('/platform/profile/api/delete', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password, totpCode }),
                    credentials: 'include'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    window.location.href = '/platform';
                } else {
                    showToast(data.error || 'Failed to delete account', 'error');
                }
            } catch (err) {
                console.error('Error deleting account:', err);
                showToast('Failed to delete account', 'error');
            }
        });
    });
}

// ============================================================================
// SETTINGS DATA
// ============================================================================
function loadSettingsData() {
    // Check if currentUser exists
    if (!currentUser) {
        console.warn('loadSettingsData called but currentUser is null');
        return;
    }
    
    // Load settings from currentUser object (populated from database)
    const settings = currentUser.settings || {};
    
    // Default Landing Page
    const defaultLandingPage = document.getElementById('defaultLandingPage');
    if (defaultLandingPage && settings.defaultLandingPage) {
        defaultLandingPage.value = settings.defaultLandingPage;
    }
    
    // Remember Last App
    const rememberLastAppToggle = document.getElementById('rememberLastAppToggle');
    if (rememberLastAppToggle) {
        rememberLastAppToggle.checked = settings.rememberLastApp !== false; // Default true
    }
    
    // Font Scaling
    const fontScaling = document.getElementById('fontScaling');
    if (fontScaling) {
        const scale = settings.fontScaling || 'medium';
        fontScaling.value = scale;
        applyFontScaling(scale);
    }
    
    // High Contrast
    const highContrastToggle = document.getElementById('highContrastToggle');
    if (highContrastToggle) {
        const highContrast = settings.highContrast || false;
        highContrastToggle.checked = highContrast;
        applyHighContrast(highContrast);
    }
    
    // Beta Features
    const betaFeaturesToggle = document.getElementById('betaFeaturesToggle');
    if (betaFeaturesToggle) {
        betaFeaturesToggle.checked = settings.betaFeatures || false;
    }
}

function applyFontScaling(scale) {
    const scales = {
        small: '14px',
        medium: '16px',
        large: '18px',
        xlarge: '20px'
    };
    document.documentElement.style.setProperty('--base-font-size', scales[scale] || '16px');
}

function applyHighContrast(enabled) {
    if (enabled) {
        document.body.classList.add('high-contrast');
    } else {
        document.body.classList.remove('high-contrast');
    }
}

// Apply saved settings on page load
function applySavedSettings() {
    // FIX: Settings are loaded from currentUser.settings after user data loads
    // Only apply basic defaults here before user data is available
    // The actual settings will be applied by loadSettingsData() after user loads
    const tempSettings = {
        fontScaling: 'medium',
        highContrast: false
    };
    
    applyFontScaling(tempSettings.fontScaling);
    applyHighContrast(tempSettings.highContrast);
    
    // Note: Real settings from DB will override these after loadUserData() completes
}

// ============================================================================
// AVATAR UPLOAD
// ============================================================================
function setupAvatarUpload() {
    const changeAvatarBtn = document.getElementById('changeAvatarBtn');
    const avatarInput = document.getElementById('avatarUploadInput');
    const avatarPreview = document.getElementById('profileAvatarPreview');
    
    if (!changeAvatarBtn || !avatarInput) return;
    
    changeAvatarBtn.addEventListener('click', () => {
        avatarInput.click();
    });
    
    avatarInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Validate file type
        if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) {
            showToast('Please upload a PNG, JPEG, or WebP image', 'error');
            return;
        }
        
        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            showToast('Image must be smaller than 5MB', 'error');
            return;
        }
        
        // Preview the image
        const reader = new FileReader();
        reader.onload = (event) => {
            avatarPreview.style.backgroundImage = `url(${event.target.result})`;
            avatarPreview.style.backgroundSize = 'cover';
            avatarPreview.style.backgroundPosition = 'center';
            avatarPreview.innerHTML = ''; // Clear SVG
        };
        reader.readAsDataURL(file);
        
        // Upload to server
        const formData = new FormData();
        formData.append('avatar', file);
        
        try {
            const response = await fetch('/platform/api/profile/avatar', {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                if (currentUser) {
                    currentUser.avatar = data.avatarUrl;
                }
                showToast('Avatar updated successfully', 'success');
            } else {
                showToast(data.error || 'Failed to upload avatar', 'error');
                revertAvatarPreview(avatarPreview);
            }
        } catch (err) {
            console.error('Error uploading avatar:', err);
            showToast('Failed to upload avatar', 'error');
            revertAvatarPreview(avatarPreview);
        }
    });
}

function revertAvatarPreview(element) {
    element.style.backgroundImage = '';
    element.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
    </svg>`;
}

// ============================================================================
// PERSONAL INFO FORM
// ============================================================================
async function handlePersonalInfoSubmit(e) {
    e.preventDefault();
    
    const displayName = document.getElementById('displayNameInput').value;
    const timezone = document.getElementById('timezoneSelect').value;
    const language = document.getElementById('languageSelect').value;
    
    try {
        const response = await fetch('/platform/api/profile/info', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName, timezone, language }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (currentUser) {
                currentUser.displayName = displayName;
                currentUser.timezone = timezone;
                currentUser.language = language;
            }
            showToast('Personal info updated successfully', 'success');
        } else {
            showToast(data.error || 'Failed to update personal info', 'error');
        }
    } catch (err) {
        console.error('Error updating personal info:', err);
        showToast('Failed to update personal info', 'error');
    }
}

// ============================================================================
// PREFERENCES
// ============================================================================
function setupPreferences() {
    // Theme selector
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
        themeSelect.value = currentUser?.preferences?.theme || 'dark';
        themeSelect.addEventListener('change', async (e) => {
            await savePreference('theme', e.target.value);
            applyTheme(e.target.value);
        });
    }
    
    // Reduced motion toggle
    const reducedMotionToggle = document.getElementById('reducedMotionToggle');
    if (reducedMotionToggle) {
        reducedMotionToggle.checked = currentUser?.preferences?.reducedMotion || false;
        reducedMotionToggle.addEventListener('change', async (e) => {
            await savePreference('reducedMotion', e.target.checked);
            applyReducedMotion(e.target.checked);
        });
    }
    
    // Compact layout toggle
    const compactLayoutToggle = document.getElementById('compactLayoutToggle');
    if (compactLayoutToggle) {
        compactLayoutToggle.checked = currentUser?.preferences?.compactLayout || false;
        compactLayoutToggle.addEventListener('change', async (e) => {
            await savePreference('compactLayout', e.target.checked);
            applyCompactLayout(e.target.checked);
        });
    }
}

async function savePreference(key, value) {
    try {
        const response = await fetch('/platform/api/profile/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: value }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (!currentUser.preferences) currentUser.preferences = {};
            currentUser.preferences[key] = value;
            showToast('Preference saved', 'success');
        } else {
            showToast(data.error || 'Failed to save preference', 'error');
        }
    } catch (err) {
        console.error('Error saving preference:', err);
        showToast('Failed to save preference', 'error');
    }
}

function applyTheme(theme) {
    document.body.className = document.body.className.replace(/theme-\w+/g, '');
    if (theme !== 'dark') {
        document.body.classList.add(`theme-${theme}`);
    }
}

function applyReducedMotion(enabled) {
    if (enabled) {
        document.body.classList.add('reduced-motion');
    } else {
        document.body.classList.remove('reduced-motion');
    }
}

function applyCompactLayout(enabled) {
    if (enabled) {
        document.body.classList.add('compact-layout');
    } else {
        document.body.classList.remove('compact-layout');
    }
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================
function setupNotifications() {
    const securityAlertsToggle = document.getElementById('securityAlertsToggle');
    const productUpdatesToggle = document.getElementById('productUpdatesToggle');
    const emailNotificationsToggle = document.getElementById('emailNotificationsToggle');
    
    if (securityAlertsToggle) {
        securityAlertsToggle.checked = currentUser?.notifications?.securityAlerts !== false;
        securityAlertsToggle.addEventListener('change', (e) => {
            saveNotificationSetting('securityAlerts', e.target.checked);
        });
    }
    
    if (productUpdatesToggle) {
        productUpdatesToggle.checked = currentUser?.notifications?.productUpdates !== false;
        productUpdatesToggle.addEventListener('change', (e) => {
            saveNotificationSetting('productUpdates', e.target.checked);
        });
    }
    
    if (emailNotificationsToggle) {
        emailNotificationsToggle.checked = currentUser?.notifications?.emailNotifications !== false;
        emailNotificationsToggle.addEventListener('change', (e) => {
            saveNotificationSetting('emailNotifications', e.target.checked);
        });
    }
}

async function saveNotificationSetting(key, value) {
    try {
        const response = await fetch('/platform/api/profile/notifications', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: value }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (!currentUser.notifications) currentUser.notifications = {};
            currentUser.notifications[key] = value;
            showToast('Notification setting saved', 'success');
        } else {
            showToast(data.error || 'Failed to save setting', 'error');
        }
    } catch (err) {
        console.error('Error saving notification setting:', err);
        showToast('Failed to save setting', 'error');
    }
}

// ============================================================================
// SETTINGS PAGE
// ============================================================================
function setupSettings() {
    // Default landing page
    const defaultLandingPage = document.getElementById('defaultLandingPage');
    if (defaultLandingPage) {
        defaultLandingPage.value = currentUser?.settings?.defaultLandingPage || 'dashboard';
        defaultLandingPage.addEventListener('change', (e) => {
            saveSetting('defaultLandingPage', e.target.value);
        });
    }
    
    // Remember last app
    const rememberLastAppToggle = document.getElementById('rememberLastAppToggle');
    if (rememberLastAppToggle) {
        rememberLastAppToggle.checked = currentUser?.settings?.rememberLastApp !== false;
        rememberLastAppToggle.addEventListener('change', (e) => {
            saveSetting('rememberLastApp', e.target.checked);
        });
    }
    
    // Font scaling
    const fontScaling = document.getElementById('fontScaling');
    if (fontScaling) {
        fontScaling.value = currentUser?.settings?.fontScaling || 'medium';
        fontScaling.addEventListener('change', (e) => {
            saveSetting('fontScaling', e.target.value);
            applyFontScaling(e.target.value);
        });
    }
    
    // High contrast
    const highContrastToggle = document.getElementById('highContrastToggle');
    if (highContrastToggle) {
        highContrastToggle.checked = currentUser?.settings?.highContrast || false;
        highContrastToggle.addEventListener('change', (e) => {
            saveSetting('highContrast', e.target.checked);
            applyHighContrast(e.target.checked);
        });
    }
    
    // Beta features
    const betaFeaturesToggle = document.getElementById('betaFeaturesToggle');
    if (betaFeaturesToggle) {
        betaFeaturesToggle.checked = currentUser?.settings?.betaFeatures || false;
        betaFeaturesToggle.addEventListener('change', (e) => {
            saveSetting('betaFeatures', e.target.checked);
        });
    }
}

async function saveSetting(key, value) {
    try {
        const response = await fetch('/platform/api/profile/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: value }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (!currentUser.settings) currentUser.settings = {};
            currentUser.settings[key] = value;
            showToast('Setting saved', 'success');
        } else {
            showToast(data.error || 'Failed to save setting', 'error');
        }
    } catch (err) {
        console.error('Error saving setting:', err);
        showToast('Failed to save setting', 'error');
    }
}

function applyFontScaling(scale) {
    document.body.className = document.body.className.replace(/font-scale-\w+/g, '');
    if (scale !== 'medium') {
        document.body.classList.add(`font-scale-${scale}`);
    }
}

function applyHighContrast(enabled) {
    if (enabled) {
        document.body.classList.add('high-contrast');
    } else {
        document.body.classList.remove('high-contrast');
    }
}

// ============================================================================
// FORMS
// ============================================================================
function setupForms() {
    // Avatar upload
    setupAvatarUpload();
    
    // Personal info form
    const personalInfoForm = document.getElementById('personalInfoForm');
    personalInfoForm?.addEventListener('submit', handlePersonalInfoSubmit);
    
    // Preferences - wire up all toggles and selects
    setupPreferences();
    
    // Notifications - wire up toggles
    setupNotifications();
    
    // Settings page - wire up all controls
    setupSettings();
    
    // Profile form (legacy - keeping for compatibility)
    const profileForm = document.getElementById('profileForm');
    profileForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('profileUsername').value;
        const email = document.getElementById('profileEmail').value;
        
        try {
            const response = await fetch('/platform/profile/api/update', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email }),
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                currentUser.username = username;
                currentUser.email = email;
                updateUserUI();
                showToast('Profile updated successfully', 'success');
            } else {
                showToast(data.error || 'Failed to update profile', 'error');
            }
        } catch (err) {
            console.error('Error updating profile:', err);
            showToast('Failed to update profile', 'error');
        }
    });
    
    // Password form
    const passwordForm = document.getElementById('passwordForm');
    passwordForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmNewPassword').value;
        const totpCode = document.getElementById('passwordTotpCode')?.value;
        
        if (newPassword !== confirmPassword) {
            showToast('New passwords do not match', 'error');
            return;
        }
        
        try {
            const payload = { currentPassword, newPassword, confirmPassword };
            if (totpCode) payload.totpCode = totpCode;
            
            const response = await fetch('/platform/profile/api/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                passwordForm.reset();
                // Hide 2FA field if shown
                const totpField = document.getElementById('passwordTotpField');
                if (totpField) totpField.style.display = 'none';
                showToast('Password changed successfully. Other sessions logged out.', 'success');
            } else if (data.requires2FA) {
                // Show 2FA input field
                let totpField = document.getElementById('passwordTotpField');
                if (!totpField) {
                    const submitBtn = passwordForm.querySelector('button[type="submit"]');
                    const fieldHtml = `
                        <div class="form-group" id="passwordTotpField">
                            <label class="form-label">2FA Code</label>
                            <input type="text" id="passwordTotpCode" class="form-input" placeholder="000000" maxlength="6" pattern="[0-9]*" inputmode="numeric" required>
                            <span class="form-hint">Enter your authenticator code</span>
                        </div>
                    `;
                    submitBtn.insertAdjacentHTML('beforebegin', fieldHtml);
                } else {
                    totpField.style.display = 'block';
                }
                document.getElementById('passwordTotpCode')?.focus();
                showToast('Please enter your 2FA code', 'warning');
            } else {
                showToast(data.error || 'Failed to change password', 'error');
            }
        } catch (err) {
            console.error('Error changing password:', err);
            showToast('Failed to change password', 'error');
        }
    });
}

// ============================================================================
// MODAL
// ============================================================================
function setupModal() {
    const overlay = document.getElementById('modalOverlay');
    const closeBtn = document.getElementById('modalClose');
    
    closeBtn?.addEventListener('click', closeModal);
    overlay?.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

function openModal(title, content) {
    const overlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    
    modalTitle.textContent = title;
    modalBody.innerHTML = content;
    overlay.classList.add('active');
}

function closeModal() {
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.remove('active');
}

window.openModal = openModal;
window.closeModal = closeModal;

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
        error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
    };
    
    toast.innerHTML = `
        <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${icons[type] || icons.info}
        </svg>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

window.showToast = showToast;

// ============================================================================
// UTILITIES
// ============================================================================
function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' minutes ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' days ago';
    
    return date.toLocaleDateString();
}
// ============================================================================
// COLLAPSIBLE CARDS
// ============================================================================
function setupCollapsibleCards() {
    const headers = document.querySelectorAll('.card-header[data-toggle="collapse"]');
    
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const card = header.closest('.collapsible-card');
            card.classList.toggle('collapsed');
        });
    });
}

// ============================================================================
// LANGUAGE & REGION SETTINGS
// ============================================================================
function setupLanguageSettings() {
    const autoDetectToggle = document.getElementById('autoDetectLanguage');
    const languageSelect = document.getElementById('language');
    const timezoneSelect = document.getElementById('timezone');
    const autoDetectTimezoneToggle = document.getElementById('autoDetectTimezone');
    
    // Auto-detect language
    if (autoDetectToggle) {
        autoDetectToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                const browserLang = navigator.language.split('-')[0];
                const langMap = {
                    'en': 'en', 'es': 'es', 'fr': 'fr', 'de': 'de', 'it': 'it',
                    'pt': 'pt', 'ru': 'ru', 'zh': 'zh', 'ja': 'ja', 'ko': 'ko',
                    'ar': 'ar', 'hi': 'hi', 'nl': 'nl', 'pl': 'pl', 'tr': 'tr',
                    'sv': 'sv', 'no': 'no', 'da': 'da', 'fi': 'fi', 'cs': 'cs'
                };
                
                if (langMap[browserLang]) {
                    languageSelect.value = langMap[browserLang];
                    languageSelect.disabled = true;
                } else {
                    languageSelect.value = 'en';
                    languageSelect.disabled = true;
                }
                
                saveSettings();
            } else {
                languageSelect.disabled = false;
            }
        });
        
        // Initial check
        if (autoDetectToggle.checked) {
            autoDetectToggle.dispatchEvent(new Event('change'));
        }
    }
    
    // Auto-detect timezone
    if (autoDetectTimezoneToggle) {
        autoDetectTimezoneToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                try {
                    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                    timezoneSelect.value = userTimezone;
                    timezoneSelect.disabled = true;
                    saveSettings();
                } catch (error) {
                    console.error('Failed to detect timezone:', error);
                    autoDetectTimezoneToggle.checked = false;
                }
            } else {
                timezoneSelect.disabled = false;
            }
        });
        
        // Initial check
        if (autoDetectTimezoneToggle.checked) {
            autoDetectTimezoneToggle.dispatchEvent(new Event('change'));
        }
    }
    
    // Save settings on change
    const settingsInputs = document.querySelectorAll('.settings-sections select, .settings-sections input');
    settingsInputs.forEach(input => {
        input.addEventListener('change', saveSettings);
    });
}

// ============================================================================
// SAVE SETTINGS
// ============================================================================
async function saveSettings() {
    const settings = {
        // Language & Region
        language: document.getElementById('language')?.value,
        autoDetectLanguage: document.getElementById('autoDetectLanguage')?.checked,
        timezone: document.getElementById('timezone')?.value,
        autoDetectTimezone: document.getElementById('autoDetectTimezone')?.checked,
        dateFormat: document.getElementById('dateFormat')?.value,
        timeFormat: document.getElementById('timeFormat')?.value,
        
        // Platform
        defaultLandingPage: document.getElementById('defaultLandingPage')?.value,
        rememberLastApp: document.getElementById('rememberLastApp')?.checked,
        autoSave: document.getElementById('autoSave')?.checked,
        
        // Appearance
        theme: document.getElementById('theme')?.value,
        compactMode: document.getElementById('compactMode')?.checked,
        sidebarPosition: document.getElementById('sidebarPosition')?.value,
        
        // Accessibility
        fontScaling: document.getElementById('fontScaling')?.value,
        highContrast: document.getElementById('highContrast')?.checked,
        reducedMotion: document.getElementById('reducedMotion')?.checked,
        screenReaderSupport: document.getElementById('screenReaderSupport')?.checked,
        
        // Notifications
        emailNotifications: document.getElementById('emailNotifications')?.checked,
        pushNotifications: document.getElementById('pushNotifications')?.checked,
        soundEnabled: document.getElementById('soundEnabled')?.checked,
        
        // Privacy & Security
        activityTracking: document.getElementById('activityTracking')?.checked,
        sessionTimeout: document.getElementById('sessionTimeout')?.value,
        require2FA: document.getElementById('require2FA')?.checked,
        
        // Experimental
        betaFeatures: document.getElementById('betaFeatures')?.checked
    };
    
    try {
        const response = await fetch('/platform/dashboard/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });
        
        if (!response.ok) {
            throw new Error('Failed to save settings');
        }
        
        // Apply settings immediately
        applySettings(settings);
        
        showToast('Settings saved successfully', 'success');
    } catch (error) {
        console.error('Error saving settings:', error);
        showToast('Failed to save settings', 'error');
    }
}

// ============================================================================
// APPLY SETTINGS
// ============================================================================
function applySettings(settings) {
    // Theme
    if (settings.theme) {
        document.documentElement.setAttribute('data-theme', settings.theme);
    }
    
    // Font scaling
    if (settings.fontScaling) {
        document.body.style.fontSize = settings.fontScaling + '%';
    }
    
    // High contrast
    if (settings.highContrast) {
        document.body.classList.toggle('high-contrast', settings.highContrast);
    }
    
    // Reduced motion
    if (settings.reducedMotion) {
        document.body.classList.toggle('reduced-motion', settings.reducedMotion);
    }
    
    // Compact mode
    if (settings.compactMode !== undefined) {
        document.body.classList.toggle('compact-mode', settings.compactMode);
    }
}