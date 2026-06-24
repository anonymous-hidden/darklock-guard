/**
 * Darklock Platform - Dashboard JavaScript
 * Single-page application with no reloads
 */

// Global state
let currentUser = null;
let currentPage = 'dashboard';

function getCookieValue(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
}

function buildRequestHeaders({ includeJson = false } = {}) {
    const headers = {};
    if (includeJson) {
        headers['Content-Type'] = 'application/json';
    }

    const csrfToken = getCookieValue('_csrf_token');
    if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
    }

    return headers;
}

function getSettingsElement(id) {
    const settingsPage = document.getElementById('page-settings');
    return settingsPage ? settingsPage.querySelector(`#${id}`) : null;
}

function setAllInputsValue(id, value) {
    document.querySelectorAll(`#${id}`).forEach((el) => {
        if ('value' in el) {
            el.value = value;
        }
    });
}

function setAllInputsChecked(id, checked) {
    document.querySelectorAll(`#${id}`).forEach((el) => {
        if ('checked' in el) {
            el.checked = !!checked;
        }
    });
}

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
    
    // Setup all settings handlers
    setupAllSettingsHandlers();
    
    // Setup application launch handlers
    setupAppLaunchHandlers();
    
    // Load initial page data
    loadPageData('dashboard');
    
    // Initialize translations after everything is loaded
    if (currentUser && currentUser.language) {
        await window.i18n.init(currentUser.language);
    } else {
        await window.i18n.init('en');
    }
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
            console.debug('[i18n] Loaded user data', {
                userId: currentUser?.id,
                language: currentUser?.language,
                timezone: currentUser?.timezone
            });
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
            if (currentUser) {
                currentUser.settings = { ...(currentUser.settings || {}), ...userSettings };
            }
            console.debug('[i18n] Loaded user settings', {
                language: userSettings?.language,
                autoDetectLanguage: userSettings?.autoDetectLanguage
            });
            
            // Populate form fields with saved settings
            populateSettingsForm(userSettings);
            
            // Apply settings immediately
            await applySettings(userSettings);
        }
    } catch (err) {
        console.error('Failed to load user settings:', err);
    }
}

function populateSettingsForm(settings) {
    const effective = settings || {};

    // Language & Region
    if (effective.language) {
        setAllInputsValue('languageSelect', effective.language);
        setAllInputsValue('settingsLanguageSelect', effective.language);
        console.debug('[i18n] populateSettingsForm applied language', effective.language);
    }
    if (effective.autoDetectLanguage !== undefined) setAllInputsChecked('autoDetectLanguageToggle', effective.autoDetectLanguage);
    if (effective.timezone) setAllInputsValue('timezoneSelect', effective.timezone);
    if (effective.dateFormat) setAllInputsValue('dateFormatSelect', effective.dateFormat);
    if (effective.timeFormat) setAllInputsValue('timeFormatSelect', effective.timeFormat);
    
    // Platform
    if (effective.defaultLandingPage) setAllInputsValue('defaultLandingPage', effective.defaultLandingPage);
    if (effective.rememberLastApp !== undefined) setAllInputsChecked('rememberLastAppToggle', effective.rememberLastApp);
    if (effective.autoSave !== undefined) setAllInputsChecked('autoSaveToggle', effective.autoSave);
    
    // Appearance
    if (effective.theme) setAllInputsValue('themeSelect', effective.theme);
    if (effective.compactMode !== undefined) setAllInputsChecked('compactModeToggle', effective.compactMode);
    if (effective.sidebarPosition) setAllInputsValue('sidebarPosition', effective.sidebarPosition);
    
    // Accessibility
    if (effective.fontScaling) setAllInputsValue('fontScaling', effective.fontScaling);
    if (effective.highContrast !== undefined) setAllInputsChecked('highContrastToggle', effective.highContrast);
    if (effective.reducedMotion !== undefined) setAllInputsChecked('reducedMotionToggle', effective.reducedMotion);
    if (effective.screenReaderSupport !== undefined) setAllInputsChecked('screenReaderToggle', effective.screenReaderSupport);
    
    // Notifications
    if (effective.emailNotifications !== undefined) setAllInputsChecked('emailNotificationsToggle', effective.emailNotifications);
    if (effective.pushNotifications !== undefined) setAllInputsChecked('pushNotificationsToggle', effective.pushNotifications);
    if (effective.soundEnabled !== undefined) setAllInputsChecked('soundNotificationsToggle', effective.soundEnabled);
    
    // Privacy & Security
    if (effective.activityTracking !== undefined) setAllInputsChecked('activityTrackingToggle', effective.activityTracking);
    if (effective.sessionTimeout) setAllInputsValue('sessionTimeoutSelect', String(effective.sessionTimeout));
    if (effective.require2FA !== undefined) setAllInputsChecked('require2FAToggle', effective.require2FA);
    
    // Experimental
    if (effective.betaFeatures !== undefined) setAllInputsChecked('betaFeaturesToggle', effective.betaFeatures);
}

function updateUserDisplay() {
    if (!currentUser) return;
    
    // Update sidebar user info - remove i18n attribute so translation doesn't overwrite
    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');
    if (userNameEl) {
        userNameEl.removeAttribute('data-i18n');
        userNameEl.textContent = currentUser.username;
    }
    if (userRoleEl) {
        userRoleEl.removeAttribute('data-i18n');
        userRoleEl.textContent = currentUser.role;
    }
    
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
    
    // Update 2FA status in dashboard (hide entirely for OAuth users)
    const stat2FACard = document.getElementById('stat2FA')?.closest('.stat-card') || document.getElementById('stat2FA')?.closest('.overview-stat');
    const stat2FA = document.getElementById('stat2FA');
    if (currentUser.oauthProvider) {
        if (stat2FACard) stat2FACard.style.display = 'none';
        else if (stat2FA) stat2FA.closest('[class*="stat"]') && (stat2FA.closest('[class*="stat"]').style.display = 'none');
    } else if (stat2FA) {
        stat2FA.textContent = currentUser.twoFactorEnabled ? 'Enabled' : 'Disabled';
        stat2FA.className = currentUser.twoFactorEnabled ? 'stat-value stat-success' : 'stat-value stat-warning';
    }
    
    // Update security checklist
    updateSecurityChecklist();
}

function updateSecurityChecklist() {
    const check2FA = document.getElementById('check2FA');
    if (check2FA) {
        // Hide 2FA checklist item for OAuth users
        if (currentUser && currentUser.oauthProvider) {
            check2FA.style.display = 'none';
            return;
        }
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
            if (page) navigateTo(page);
        });
    });

    // Event delegation fallback (ensures clicks work even if bindings fail)
    document.addEventListener('click', (e) => {
        const target = e.target.closest('.nav-item[data-page]');
        if (!target) return;
        e.preventDefault();
        const page = target.dataset.page;
        if (page) navigateTo(page);
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
        downloads: 'App Downloads',
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
                credentials: 'include',
                headers: buildRequestHeaders()
            });

            let data = null;
            try {
                data = await response.json();
            } catch {
                data = null;
            }

            if (response.ok && (!data || data.success !== false)) {
                window.location.href = (data && data.redirect) || '/platform';
                return;
            }

            throw new Error((data && data.error) || 'Logout failed');
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

    // Load recent activity
    loadDashboardRecentActivity();

    // Load service status
    loadServiceStatus();
}

async function loadDashboardRecentActivity() {
    const container = document.getElementById('dashboardRecentActivity');
    if (!container) return;

    try {
        const response = await fetch('/platform/dashboard/api/activity', { credentials: 'include' });
        const data = await response.json();

        if (data.success && data.activity && data.activity.length > 0) {
            container.innerHTML = `<div class="activity-timeline">
                ${data.activity.slice(0, 8).map(item => {
                    const type = item.action?.includes('login') ? 'login' : 
                                 item.action?.includes('security') || item.action?.includes('password') || item.action?.includes('2fa') ? 'security' :
                                 item.action?.includes('setting') || item.action?.includes('profile') ? 'settings' : 'info';
                    return `<div class="activity-item">
                        <div class="activity-dot ${type}"></div>
                        <div class="activity-content">
                            <div class="activity-text">${escapeHtmlSafe(item.action || item.description || 'Activity')}</div>
                            <div class="activity-time">${formatTimeAgo(item.timestamp || item.date)}</div>
                        </div>
                    </div>`;
                }).join('')}
            </div>`;
        } else {
            container.innerHTML = `<div class="activity-timeline">
                <div class="activity-item">
                    <div class="activity-dot login"></div>
                    <div class="activity-content">
                        <div class="activity-text">Logged in to platform</div>
                        <div class="activity-time">${currentUser?.lastLogin ? formatTimeAgo(currentUser.lastLogin) : 'Just now'}</div>
                    </div>
                </div>
                <div class="activity-item">
                    <div class="activity-dot security"></div>
                    <div class="activity-content">
                        <div class="activity-text">Account created</div>
                        <div class="activity-time">${currentUser?.createdAt ? formatTimeAgo(currentUser.createdAt) : 'Previously'}</div>
                    </div>
                </div>
            </div>`;
        }
    } catch (err) {
        console.error('Error loading recent activity:', err);
        container.innerHTML = '<div class="empty-state"><span>No recent activity</span></div>';
    }
}

async function loadServiceStatus() {
    const botIndicator = document.getElementById('botServiceIndicator');
    const botStatus = document.getElementById('botServiceStatus');
    if (!botIndicator || !botStatus) return;

    // Web platform is always online if we're here
    botIndicator.className = 'service-indicator checking';
    botStatus.textContent = 'Checking...';

    try {
        const response = await fetch('/health', { credentials: 'include' });
        if (response.ok) {
            botIndicator.className = 'service-indicator online';
            botStatus.textContent = 'Operational';
        } else {
            botIndicator.className = 'service-indicator offline';
            botStatus.textContent = 'Degraded';
        }
    } catch {
        // If health endpoint doesn't exist, check if bot dashboard loads
        try {
            const res = await fetch('/dashboard', { method: 'HEAD', credentials: 'include' });
            if (res.ok) {
                botIndicator.className = 'service-indicator online';
                botStatus.textContent = 'Operational';
            } else {
                botIndicator.className = 'service-indicator offline';
                botStatus.textContent = 'Unavailable';
            }
        } catch {
            botIndicator.className = 'service-indicator offline';
            botStatus.textContent = 'Unavailable';
        }
    }
}

function escapeHtmlSafe(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ============================================================================
// PROFILE DATA
// ============================================================================
function loadProfileData() {
    if (!currentUser) return;
    
    // === Profile Hero Section ===
    // Banner
    const profileBanner = document.getElementById('profileBanner');
    const removeBannerBtn = document.getElementById('removeBannerBtn');
    if (profileBanner && currentUser.banner) {
        profileBanner.style.backgroundImage = `url(${currentUser.banner})`;
        if (removeBannerBtn) removeBannerBtn.style.display = 'block';
    }
    
    // Avatar in hero
    const profileAvatarHero = document.getElementById('profileAvatarHero');
    if (profileAvatarHero && currentUser.avatar) {
        profileAvatarHero.style.backgroundImage = `url(${currentUser.avatar})`;
        profileAvatarHero.style.backgroundSize = 'cover';
        profileAvatarHero.style.backgroundPosition = 'center';
        const svgEl = profileAvatarHero.querySelector('svg');
        if (svgEl) svgEl.style.display = 'none';
        const removeAvatarBtn = document.getElementById('removeAvatarBtn');
        if (removeAvatarBtn) removeAvatarBtn.style.display = 'inline-flex';
    }
    
    // Hero name, username, role
    const profileHeroName = document.getElementById('profileHeroName');
    if (profileHeroName) profileHeroName.textContent = currentUser.displayName || currentUser.username;
    
    const profileHeroUsername = document.getElementById('profileHeroUsername');
    if (profileHeroUsername) profileHeroUsername.textContent = '@' + currentUser.username;
    
    const profileHeroRole = document.getElementById('profileHeroRole');
    if (profileHeroRole) {
        profileHeroRole.textContent = currentUser.role || 'User';
        if (currentUser.role === 'admin') {
            profileHeroRole.style.background = 'rgba(210, 153, 34, 0.1)';
            profileHeroRole.style.color = '#d29922';
            profileHeroRole.style.borderColor = 'rgba(210, 153, 34, 0.3)';
        }
    }
    
    // === Account Overview Section ===
    const profileUsernameDisplay = document.getElementById('profileUsernameDisplay');
    if (profileUsernameDisplay) profileUsernameDisplay.textContent = currentUser.username;
    
    const profileRoleBadge = document.getElementById('profileRoleBadge');
    if (profileRoleBadge) {
        profileRoleBadge.textContent = currentUser.role || 'User';
    }
    
    const profileCreatedDisplay = document.getElementById('profileCreatedDisplay');
    if (profileCreatedDisplay && currentUser.createdAt) {
        profileCreatedDisplay.textContent = new Date(currentUser.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
    
    const profileLastLoginDisplay = document.getElementById('profileLastLoginDisplay');
    if (profileLastLoginDisplay && currentUser.lastLogin) {
        profileLastLoginDisplay.textContent = formatTimeAgo(currentUser.lastLogin);
    }
    
    const profile2FAStatus = document.getElementById('profile2FAStatus');
    if (profile2FAStatus) {
        const enabled = currentUser.twoFactorEnabled;
        profile2FAStatus.textContent = enabled ? 'Enabled' : 'Disabled';
        profile2FAStatus.style.color = enabled ? '#3fb950' : '#f85149';
    }
    
    // === Personal Info Form ===
    const displayNameInput = document.getElementById('displayNameInput');
    if (displayNameInput) displayNameInput.value = currentUser.displayName || '';
    
    const profileEmailReadonly = document.getElementById('profileEmailReadonly');
    if (profileEmailReadonly) profileEmailReadonly.value = currentUser.email;
    
    const timezoneSelect = document.getElementById('timezoneSelect');
    if (timezoneSelect && currentUser.timezone) {
        timezoneSelect.value = currentUser.timezone;
    }
    
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect && currentUser.language) {
        languageSelect.value = currentUser.language;
    }
    
    // Also set settings language select if available
    const settingsLanguageSelect = document.getElementById('settingsLanguageSelect');
    if (settingsLanguageSelect && currentUser.language) {
        settingsLanguageSelect.value = currentUser.language;
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
    
    // === Profile Card Preview ===
    updateProfileCardPreview();
    
    // === Connected Services ===
    loadConnectedServices();
}

// Update the profile card preview widget
function updateProfileCardPreview() {
    if (!currentUser) return;
    
    const previewBanner = document.getElementById('previewBanner');
    if (previewBanner && currentUser.banner) {
        previewBanner.style.backgroundImage = `url(${currentUser.banner})`;
    }
    
    const previewAvatar = document.getElementById('previewAvatar');
    if (previewAvatar && currentUser.avatar) {
        previewAvatar.style.backgroundImage = `url(${currentUser.avatar})`;
        previewAvatar.style.backgroundSize = 'cover';
        previewAvatar.style.backgroundPosition = 'center';
        const svg = previewAvatar.querySelector('svg');
        if (svg) svg.style.display = 'none';
    }
    
    const previewDisplayName = document.getElementById('previewDisplayName');
    if (previewDisplayName) previewDisplayName.textContent = currentUser.displayName || currentUser.username;
    
    const previewUsername = document.getElementById('previewUsername');
    if (previewUsername) previewUsername.textContent = '@' + currentUser.username;
    
    const previewRoleBadge = document.getElementById('previewRoleBadge');
    if (previewRoleBadge) {
        previewRoleBadge.textContent = currentUser.role || 'User';
        if (currentUser.role === 'admin') {
            previewRoleBadge.style.background = 'rgba(210, 153, 34, 0.1)';
            previewRoleBadge.style.color = '#d29922';
            previewRoleBadge.style.borderColor = 'rgba(210, 153, 34, 0.3)';
        }
    }
    
    const preview2FABadge = document.getElementById('preview2FABadge');
    if (preview2FABadge) {
        preview2FABadge.style.display = currentUser.twoFactorEnabled ? 'inline-block' : 'none';
    }
    
    const previewMemberSince = document.getElementById('previewMemberSince');
    if (previewMemberSince && currentUser.createdAt) {
        previewMemberSince.textContent = 'Member since ' + new Date(currentUser.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    }
}

// Load connected Darklock services
function loadConnectedServices() {
    const container = document.getElementById('connectedServices');
    if (!container) return;
    
    const services = [
        { name: 'Darklock Dashboard', icon: 'shield', color: '#7c6aef', synced: true, desc: 'This platform' },
        { name: 'Discord Security Bot', icon: 'bot', color: '#5865F2', synced: true, desc: 'Discord server protection' },
        { name: 'Darklock Guard', icon: 'lock', color: '#3fb950', synced: !!currentUser.avatar, desc: 'Desktop security app' },
        { name: 'Secure Channel', icon: 'message', color: '#b4a6f6', synced: false, desc: 'Encrypted messaging' },
        { name: 'Darklock VPN', icon: 'globe', color: '#d29922', synced: false, desc: 'Secure network tunnel' }
    ];
    
    const iconSvgs = {
        shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
        bot: '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/>',
        lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
        message: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
        globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 014 10 15 15 0 01-4 10 15 15 0 01-4-10A15 15 0 0112 2z"/>'
    };
    
    container.innerHTML = services.map(svc => `
        <div class="connected-service-item">
            <div class="connected-service-icon" style="background: ${svc.color}15; color: ${svc.color};">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px;">${iconSvgs[svc.icon]}</svg>
            </div>
            <div class="connected-service-info">
                <div class="connected-service-name">${svc.name}</div>
                <div class="connected-service-status">${svc.desc}</div>
            </div>
            <span class="sync-badge ${svc.synced ? 'synced' : 'not-synced'}">${svc.synced ? 'Synced' : 'Not Synced'}</span>
        </div>
    `).join('');
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
    const section = document.getElementById('twoFactorSection');
    const container = document.getElementById('twoFactorContent');

    // Google/Discord OAuth users don't use 2FA — hide the section entirely
    if (currentUser && currentUser.oauthProvider) {
        if (section) section.style.display = 'none';
        return;
    }

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
    
    // OAuth users (Google/Discord) skip password — go straight to setup
    if (currentUser && currentUser.oauthProvider) {
        startSetup2FA(null);
        return;
    }
    
    // Password users: verify identity first
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
    if (e) e.preventDefault();
    
    const passwordEl = document.getElementById('setup2FAPassword');
    const password = passwordEl ? passwordEl.value : undefined;
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
    const container = document.getElementById('appsGrid');
    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading applications...</span></div>';
    
    // Icon SVGs for each app type
    const appIcons = {
        'shield-check': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
        'monitor-shield': '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M12 7l3 2v2.5c0 1.5-1.5 3-3 3.5-1.5-.5-3-2-3-3.5V9l3-2z"/>',
        'message-lock': '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><rect x="9" y="8" width="6" height="5" rx="1"/><path d="M10 8V6.5a2 2 0 014 0V8"/>',
        'globe-lock': '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 014 10 15 15 0 01-4 10 15 15 0 01-4-10A15 15 0 0112 2z"/>',
        'radar': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
        'lock-keyhole': '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="12" cy="16" r="1"/>',
        'dns-shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><circle cx="12" cy="10" r="1"/><circle cx="12" cy="14" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>',
        'cloud-lock': '<path d="M18 10a6.5 6.5 0 00-12.2-2A4.5 4.5 0 006.5 17H18a4 4 0 000-8z"/><rect x="10" y="12" width="4" height="4" rx="0.5"/><path d="M11 12v-1a1 1 0 012 0v1"/>'
    };
    
    try {
        const response = await fetch('/platform/dashboard/api/apps', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success && data.apps.length > 0) {
            container.innerHTML = data.apps.map(app => {
                const iconSvg = appIcons[app.icon] || appIcons['shield-check'];
                
                // Build action buttons based on app status and available URLs
                let actions = '';
                if (app.status === 'active') {
                    if (app.externalUrl) {
                        actions += `<a href="${app.externalUrl}" target="_blank" class="btn btn-primary btn-sm">Open Dashboard</a>`;
                    } else if (app.url) {
                        actions += `<a href="${app.url}" class="btn btn-primary btn-sm">Open Dashboard</a>`;
                    }
                    if (app.downloadUrl) {
                        actions += `<a href="${app.downloadUrl}" class="btn btn-ghost btn-sm">Download</a>`;
                    }
                } else if (app.status === 'beta') {
                    if (app.url) {
                        actions += `<a href="${app.url}" target="_blank" class="btn btn-secondary btn-sm">Try Beta</a>`;
                    }
                } else {
                    actions += `<button class="btn btn-ghost btn-sm" disabled>Coming Soon</button>`;
                }
                
                return `
                <div class="app-card-unified">
                    <div class="app-card-top">
                        <div class="app-icon-wrap ${app.status}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${iconSvg}</svg>
                        </div>
                        <div class="app-title-area">
                            <h3>${escapeHtmlSafe(app.name)}</h3>
                            <span class="app-status-badge ${app.status}">
                                ${app.status === 'active' ? 'Active' : 
                                  app.status === 'coming-soon' ? 'Coming Soon' : 
                                  app.status === 'beta' ? 'Beta' : 'Unavailable'}
                            </span>
                            ${app.category ? `<span style="font-size: 0.6875rem; color: var(--text-muted); margin-left: 0.5rem;">${escapeHtmlSafe(app.category)}</span>` : ''}
                        </div>
                    </div>
                    <p class="app-description">${escapeHtmlSafe(app.description)}</p>
                    <div class="app-features-list">
                        ${(app.features || []).map(f => `<span class="app-feature-tag">${escapeHtmlSafe(f)}</span>`).join('')}
                    </div>
                    <div class="app-card-actions">${actions}</div>
                </div>`;
            }).join('');
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
        const password = document.getElementById('usernameChangePassword')?.value;
        
        if (!password) {
            showToast('Password is required', 'error');
            return;
        }
        
        try {
            const response = await fetch('/platform/profile/api/username', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: newUsername, password }),
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                currentUser.username = data.username || newUsername;
                document.getElementById('currentUsernameDisplay').value = currentUser.username;
                document.getElementById('newUsername').value = '';
                if (document.getElementById('usernameChangePassword')) {
                    document.getElementById('usernameChangePassword').value = '';
                }
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
            
            if (response.ok) {
                // Get the JSON data
                const data = await response.json();
                
                // Create and download JSON file
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
                const data = await response.json();
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
    if (!currentUser && Object.keys(userSettings).length === 0) {
        console.warn('loadSettingsData called but user data is unavailable');
        return;
    }

    const settings = {
        ...(currentUser?.settings || {}),
        ...(userSettings || {})
    };

    populateSettingsForm(settings);
    applySettings(settings);
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
    const settings = {
        ...(currentUser?.settings || {}),
        ...(userSettings || {})
    };

    applyFontScaling(settings.fontScaling || 'medium');
    applyHighContrast(!!settings.highContrast);
    if (settings.reducedMotion !== undefined) {
        document.body.classList.toggle('reduced-motion', !!settings.reducedMotion);
    }
    if (settings.compactMode !== undefined) {
        document.body.classList.toggle('compact-mode', !!settings.compactMode);
    }
}

// ============================================================================
// AVATAR UPLOAD
// ============================================================================
function setupAvatarUpload() {
    // === Avatar Upload (Hero Section) ===
    const avatarHero = document.getElementById('profileAvatarHero');
    const avatarInput = document.getElementById('avatarUploadInput');
    const removeAvatarBtn = document.getElementById('removeAvatarBtn');
    
    if (avatarHero && avatarInput) {
        avatarHero.addEventListener('click', (e) => {
            if (e.target.closest('#avatarUploadInput')) return;
            avatarInput.click();
        });
        
        avatarInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) {
                showToast('Please upload a PNG, JPEG, or WebP image', 'error');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                showToast('Image must be smaller than 5MB', 'error');
                return;
            }
            
            // Preview immediately
            const reader = new FileReader();
            reader.onload = (event) => {
                avatarHero.style.backgroundImage = `url(${event.target.result})`;
                avatarHero.style.backgroundSize = 'cover';
                avatarHero.style.backgroundPosition = 'center';
                const svg = avatarHero.querySelector('svg:not(.avatar-hover-overlay svg)');
                if (svg) svg.style.display = 'none';
            };
            reader.readAsDataURL(file);
            
            const formData = new FormData();
            formData.append('avatar', file);
            
            try {
                const response = await fetch('/platform/profile/api/avatar', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });
                const data = await response.json();
                if (data.success) {
                    if (currentUser) currentUser.avatar = data.avatarUrl;
                    if (removeAvatarBtn) removeAvatarBtn.style.display = 'inline-flex';
                    updateProfileCardPreview();
                    showToast('Avatar updated successfully', 'success');
                } else {
                    showToast(data.error || 'Failed to upload avatar', 'error');
                    revertAvatarPreview(avatarHero);
                }
            } catch (err) {
                console.error('Error uploading avatar:', err);
                showToast('Failed to upload avatar', 'error');
                revertAvatarPreview(avatarHero);
            }
            avatarInput.value = '';
        });
    }
    
    // Remove avatar
    if (removeAvatarBtn) {
        removeAvatarBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/platform/profile/api/avatar', {
                    method: 'DELETE',
                    credentials: 'include'
                });
                const data = await response.json();
                if (data.success) {
                    if (currentUser) currentUser.avatar = null;
                    revertAvatarPreview(avatarHero);
                    removeAvatarBtn.style.display = 'none';
                    updateProfileCardPreview();
                    showToast('Avatar removed', 'success');
                }
            } catch (err) {
                showToast('Failed to remove avatar', 'error');
            }
        });
    }
    
    // === Banner Upload ===
    const bannerEl = document.getElementById('profileBanner');
    const bannerInput = document.getElementById('bannerUploadInput');
    const removeBannerBtn = document.getElementById('removeBannerBtn');
    
    if (bannerEl && bannerInput) {
        bannerEl.addEventListener('click', (e) => {
            if (e.target.closest('#bannerUploadInput') || e.target.closest('#removeBannerBtn')) return;
            bannerInput.click();
        });
        
        bannerInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) {
                showToast('Please upload a PNG, JPEG, or WebP image', 'error');
                return;
            }
            if (file.size > 8 * 1024 * 1024) {
                showToast('Banner image must be smaller than 8MB', 'error');
                return;
            }
            
            // Preview
            const reader = new FileReader();
            reader.onload = (event) => {
                bannerEl.style.backgroundImage = `url(${event.target.result})`;
            };
            reader.readAsDataURL(file);
            
            const formData = new FormData();
            formData.append('banner', file);
            
            try {
                const response = await fetch('/platform/profile/api/banner', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });
                const data = await response.json();
                if (data.success) {
                    if (currentUser) currentUser.banner = data.bannerUrl;
                    if (removeBannerBtn) removeBannerBtn.style.display = 'block';
                    updateProfileCardPreview();
                    showToast('Banner updated successfully', 'success');
                } else {
                    showToast(data.error || 'Failed to upload banner', 'error');
                    bannerEl.style.backgroundImage = currentUser?.banner ? `url(${currentUser.banner})` : '';
                }
            } catch (err) {
                console.error('Error uploading banner:', err);
                showToast('Failed to upload banner', 'error');
                bannerEl.style.backgroundImage = currentUser?.banner ? `url(${currentUser.banner})` : '';
            }
            bannerInput.value = '';
        });
    }
    
    // Remove banner
    if (removeBannerBtn) {
        removeBannerBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const response = await fetch('/platform/profile/api/banner', {
                    method: 'DELETE',
                    credentials: 'include'
                });
                const data = await response.json();
                if (data.success) {
                    if (currentUser) currentUser.banner = null;
                    bannerEl.style.backgroundImage = '';
                    removeBannerBtn.style.display = 'none';
                    updateProfileCardPreview();
                    showToast('Banner removed', 'success');
                }
            } catch (err) {
                showToast('Failed to remove banner', 'error');
            }
        });
    }
}

function revertAvatarPreview(element) {
    element.style.backgroundImage = '';
    const svg = element.querySelector('svg:not(.avatar-hover-overlay svg)');
    if (svg) svg.style.display = '';
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
        const response = await fetch('/platform/profile/api/info', {
            method: 'PUT',
            headers: buildRequestHeaders({ includeJson: true }),
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
            // Refresh hero section and profile preview
            const profileHeroName = document.getElementById('profileHeroName');
            if (profileHeroName) profileHeroName.textContent = displayName || currentUser.username;
            updateProfileCardPreview();
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
    const profilePage = document.getElementById('page-profile');

    // Theme selector
    const themeSelect = profilePage?.querySelector('#themeSelect');
    if (themeSelect) {
        themeSelect.value = currentUser?.preferences?.theme || 'dark';
        themeSelect.addEventListener('change', async (e) => {
            await savePreference('theme', e.target.value);
            applyTheme(e.target.value);
        });
    }
    
    // Reduced motion toggle
    const reducedMotionToggle = profilePage?.querySelector('#reducedMotionToggle');
    if (reducedMotionToggle) {
        reducedMotionToggle.checked = currentUser?.preferences?.reducedMotion || false;
        reducedMotionToggle.addEventListener('change', async (e) => {
            await savePreference('reducedMotion', e.target.checked);
            applyReducedMotion(e.target.checked);
        });
    }
    
    // Compact layout toggle
    const compactLayoutToggle = profilePage?.querySelector('#compactLayoutToggle');
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
        const response = await fetch('/platform/profile/api/preferences', {
            method: 'PUT',
            headers: buildRequestHeaders({ includeJson: true }),
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
    const profilePage = document.getElementById('page-profile');
    const securityAlertsToggle = profilePage?.querySelector('#securityAlertsToggle');
    const productUpdatesToggle = profilePage?.querySelector('#productUpdatesToggle');
    const emailNotificationsToggle = profilePage?.querySelector('#emailNotificationsToggle');
    
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
        const response = await fetch('/platform/profile/api/notifications', {
            method: 'PUT',
            headers: buildRequestHeaders({ includeJson: true }),
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
    // Settings listeners are attached in setupAllSettingsHandlers.
    // This ensures values are in sync when forms initialize.
    loadSettingsData();
}

async function saveSetting(key, value) {
    try {
        const response = await fetch('/platform/dashboard/api/settings', {
            method: 'POST',
            headers: buildRequestHeaders({ includeJson: true }),
            body: JSON.stringify({ [key]: value }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (!currentUser.settings) currentUser.settings = {};
            currentUser.settings[key] = value;
            userSettings = { ...(userSettings || {}), [key]: value };
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
    const profileLanguageSelect = document.querySelector('#page-profile #languageSelect');
    const settingsLanguageSelect = getSettingsElement('settingsLanguageSelect');
    const autoDetectToggle = getSettingsElement('autoDetectLanguageToggle');
    
    // Function to save language
    const saveLanguage = async (language) => {
        try {
            console.debug('[i18n] Saving language', { language });

            const saved = await saveUserSetting('language', language);
            if (saved) {
                console.debug('[i18n] Language saved successfully', { language });
                // Save to localStorage for instant access
                localStorage.setItem('language', language);
                
                // Update both select elements
                if (profileLanguageSelect && profileLanguageSelect.value !== language) {
                    profileLanguageSelect.value = language;
                }
                if (settingsLanguageSelect && settingsLanguageSelect.value !== language) {
                    settingsLanguageSelect.value = language;
                }

                if (currentUser) {
                    currentUser.language = language;
                }

                if (window.i18n && typeof window.i18n.setLanguage === 'function') {
                    await window.i18n.setLanguage(language);
                }
                
                // Show success message
                showToast('Language updated', 'success');
            } else {
                console.debug('[i18n] Language save failed');
                showToast('Failed to save language', 'error');
            }
        } catch (err) {
            console.error('Error saving language:', err);
            showToast('Failed to save language', 'error');
        }
    };
    
    // Language change handler for profile section
    if (profileLanguageSelect) {
        profileLanguageSelect.addEventListener('change', async (e) => {
            const language = e.target.value;
            await saveLanguage(language);
        });
    }
    
    // Language change handler for settings section
    if (settingsLanguageSelect) {
        settingsLanguageSelect.addEventListener('change', async (e) => {
            const language = e.target.value;
            await saveLanguage(language);
        });
    }
    
    // Auto-detect language
    if (autoDetectToggle) {
        autoDetectToggle.addEventListener('change', async (e) => {
            if (e.target.checked) {
                const browserLang = navigator.language.split('-')[0];
                const langMap = {
                    'en': 'en', 'es': 'es', 'fr': 'fr', 'de': 'de', 'it': 'it',
                    'pt': 'pt', 'ru': 'ru', 'zh': 'zh', 'ja': 'ja', 'ko': 'ko',
                    'ar': 'ar', 'hi': 'hi', 'nl': 'nl', 'pl': 'pl', 'tr': 'tr',
                    'sv': 'sv', 'no': 'no', 'da': 'da', 'fi': 'fi', 'cs': 'cs'
                };
                
                const detectedLang = langMap[browserLang] || 'en';
                console.debug('[i18n] Auto-detect language', { browserLang, detectedLang });
                
                // Update both select elements
                if (profileLanguageSelect) profileLanguageSelect.value = detectedLang;
                if (settingsLanguageSelect) settingsLanguageSelect.value = detectedLang;
                
                await saveUserSetting('autoDetectLanguage', true);

                // Trigger save
                await saveLanguage(detectedLang);
                
                // Disable language selects when auto-detect is enabled
                if (profileLanguageSelect) profileLanguageSelect.disabled = true;
                if (settingsLanguageSelect) settingsLanguageSelect.disabled = true;
            } else {
                await saveUserSetting('autoDetectLanguage', false);

                // Enable language selects when auto-detect is disabled
                if (profileLanguageSelect) profileLanguageSelect.disabled = false;
                if (settingsLanguageSelect) settingsLanguageSelect.disabled = false;
            }
        });
    }
}

// ============================================================================
// SAVE SETTINGS
// ============================================================================
async function saveSettings() {
    const settings = gatherAllSettings();
    
    try {
        const response = await fetch('/platform/dashboard/api/settings', {
            method: 'POST',
            headers: buildRequestHeaders({ includeJson: true }),
            credentials: 'include',
            body: JSON.stringify(settings)
        });
        
        const data = await response.json();
        
        if (data.success) {
            userSettings = { ...(userSettings || {}), ...settings };
            if (currentUser) {
                currentUser.settings = { ...(currentUser.settings || {}), ...settings };
            }
            showToast('Settings saved', 'success');
        } else {
            showToast(data.error || 'Failed to save settings', 'error');
        }
    } catch (err) {
        console.error('Error saving settings:', err);
        showToast('Failed to save settings', 'error');
    }
}

/**
 * Gather all settings from form elements
 */
function gatherAllSettings() {
    const settingsPage = document.getElementById('page-settings');
    const getValue = (id, fallback) => settingsPage?.querySelector(`#${id}`)?.value ?? fallback;
    const getChecked = (id, fallback = false) => {
        const el = settingsPage?.querySelector(`#${id}`);
        return el ? !!el.checked : fallback;
    };

    return {
        // Language & Region
        language: getValue('settingsLanguageSelect', currentUser?.language || 'en'),
        autoDetectLanguage: getChecked('autoDetectLanguageToggle', false),
        timezone: getValue('timezoneSelect', 'auto'),
        dateFormat: getValue('dateFormatSelect', 'MM/DD/YYYY'),
        timeFormat: getValue('timeFormatSelect', '12h'),
        
        // Platform
        defaultLandingPage: getValue('defaultLandingPage', 'dashboard'),
        rememberLastApp: getChecked('rememberLastAppToggle', true),
        autoSave: getChecked('autoSaveToggle', true),
        
        // Appearance
        theme: getValue('themeSelect', 'dark'),
        compactMode: getChecked('compactModeToggle', false),
        sidebarPosition: getValue('sidebarPosition', 'left'),
        
        // Accessibility
        fontScaling: getValue('fontScaling', 'medium'),
        highContrast: getChecked('highContrastToggle', false),
        reducedMotion: getChecked('reducedMotionToggle', false),
        screenReaderSupport: getChecked('screenReaderToggle', false),
        
        // Notifications
        emailNotifications: getChecked('emailNotificationsToggle', true),
        pushNotifications: getChecked('pushNotificationsToggle', false),
        soundEnabled: getChecked('soundNotificationsToggle', true),

        // Privacy & Security
        activityTracking: getChecked('activityTrackingToggle', true),
        sessionTimeout: getValue('sessionTimeoutSelect', '60'),
        require2FA: getChecked('require2FAToggle', false),

        // Experimental
        betaFeatures: getChecked('betaFeaturesToggle', false)
    };
}

/**
 * Save a single user setting
 */
async function saveUserSetting(key, value) {
    try {
        const settings = { [key]: value };
        
        const response = await fetch('/platform/dashboard/api/settings', {
            method: 'POST',
            headers: buildRequestHeaders({ includeJson: true }),
            credentials: 'include',
            body: JSON.stringify(settings)
        });
        
        const data = await response.json();
        
        if (data.success) {
            userSettings = { ...(userSettings || {}), [key]: value };
            if (currentUser) {
                currentUser.settings = { ...(currentUser.settings || {}), [key]: value };
                if (key === 'language') {
                    currentUser.language = value;
                }
            }
            return true;
        }

        if (!data.success) {
            console.error('Failed to save setting:', data.error);
        }
    } catch (err) {
        console.error('Error saving setting:', err);
    }

    return false;
}

/**
 * Wire up all settings toggles and selects
 */
function setupAllSettingsHandlers() {
    const toggleSettingMap = {
        rememberLastAppToggle: 'rememberLastApp',
        autoSaveToggle: 'autoSave',
        compactModeToggle: 'compactMode',
        highContrastToggle: 'highContrast',
        reducedMotionToggle: 'reducedMotion',
        screenReaderToggle: 'screenReaderSupport',
        emailNotificationsToggle: 'emailNotifications',
        pushNotificationsToggle: 'pushNotifications',
        soundNotificationsToggle: 'soundEnabled',
        activityTrackingToggle: 'activityTracking',
        require2FAToggle: 'require2FA',
        betaFeaturesToggle: 'betaFeatures'
    };

    Object.entries(toggleSettingMap).forEach(([id, key]) => {
        const toggle = getSettingsElement(id);
        if (!toggle) return;

        toggle.addEventListener('change', async (e) => {
            const saved = await saveUserSetting(key, e.target.checked);
            if (!saved) {
                showToast('Failed to save setting', 'error');
                return;
            }

            if (id === 'highContrastToggle') {
                applyHighContrast(e.target.checked);
            }
            if (id === 'reducedMotionToggle') {
                applyReducedMotion(e.target.checked);
            }
            if (id === 'compactModeToggle') {
                document.body.classList.toggle('compact-mode', e.target.checked);
            }

            showToast('Setting saved', 'success');
        });
    });

    const selectSettingMap = {
        timezoneSelect: 'timezone',
        dateFormatSelect: 'dateFormat',
        timeFormatSelect: 'timeFormat',
        defaultLandingPage: 'defaultLandingPage',
        themeSelect: 'theme',
        sidebarPosition: 'sidebarPosition',
        fontScaling: 'fontScaling',
        sessionTimeoutSelect: 'sessionTimeout'
    };

    Object.entries(selectSettingMap).forEach(([id, key]) => {
        const select = getSettingsElement(id);
        if (!select) return;

        select.addEventListener('change', async (e) => {
            const saved = await saveUserSetting(key, e.target.value);
            if (!saved) {
                showToast('Failed to save setting', 'error');
                return;
            }

            if (id === 'themeSelect') {
                applyTheme(e.target.value);
            }
            if (id === 'fontScaling') {
                applyFontScaling(e.target.value);
            }

            showToast('Setting saved', 'success');
        });
    });
}
// ============================================================================
// APPLY SETTINGS
// ============================================================================
async function applySettings(settings) {
    // Language
    if (settings.language && window.i18n) {
        console.debug('[i18n] applySettings calling setLanguage', settings.language);
        await window.i18n.setLanguage(settings.language);
    }
    
    // Theme
    if (settings.theme) {
        document.documentElement.setAttribute('data-theme', settings.theme);
    }
    
    // Font scaling
    if (settings.fontScaling) {
        applyFontScaling(settings.fontScaling);
    }
    
    // High contrast
    if (settings.highContrast !== undefined) {
        document.body.classList.toggle('high-contrast', settings.highContrast);
    }
    
    // Reduced motion
    if (settings.reducedMotion !== undefined) {
        document.body.classList.toggle('reduced-motion', settings.reducedMotion);
    }
    
    // Compact mode
    if (settings.compactMode !== undefined) {
        document.body.classList.toggle('compact-mode', settings.compactMode);
    }
}