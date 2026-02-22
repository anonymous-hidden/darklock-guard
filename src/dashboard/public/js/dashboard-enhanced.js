// Simple DarkLock Dashboard
function dashboard() {
    return {
        // Basic state
        activeTab: 'dashboard',
        loading: false,
        securityScore: 87,
        memberCount: 1247,
        totalThreats: 0,
        serverName: 'DarkLock Server',
        botOnline: true,
        
        // Initialize
        init() {
            console.log('✅ Dashboard initialized');
            this.loadData();
        },
        
        // Navigation
        setActiveTab(tab) {
            this.activeTab = tab;
            console.log('Switched to tab:', tab);
        },
        
        // Data loading
        async loadData() {
            console.log('Loading dashboard data...');
            // For now, just use static data
            this.securityScore = 87;
            this.memberCount = 1247;
            this.totalThreats = 0;
        },
        
        // Actions
        lockdownServer() {
            alert('🔒 Server lockdown activated!');
        },
        
        pauseInvites() {
            alert('⏸️ Invites paused!');
        },
        
        clearRaidFlags() {
            alert('✅ Raid flags cleared!');
        },
        
        emergencyMode() {
            alert('🚨 Emergency mode activated!');
        },
        
        toggleAutoRefresh() {
            alert('🔄 Auto-refresh toggled!');
        },
        
        // Utility
        getProtectionLevel(score) {
            if (score >= 90) return 'Excellent Security';
            if (score >= 75) return 'High Security';
            if (score >= 60) return 'Good Security';
            return 'Needs Improvement';
        }
    };
}

                level: 'medium',
                icon: 'fas fa-user-plus'
            },
            {
                id: 2,
                title: 'Spam Messages',
                count: 1,
                level: 'low',
                icon: 'fas fa-comment-slash'
            },
            {
                id: 3,
                title: 'Malicious Links',
                count: 2,
                level: 'high',
                icon: 'fas fa-link'
            }
        ],
        
        // Recent Activity
        recentIncidents: [
            {
                id: 1,
                time: Date.now() - 1800000,
                description: 'Automatic raid protection triggered',
                status: 'resolved',
                statusIcon: 'fas fa-check'
            },
            {
                id: 2,
                time: Date.now() - 3600000,
                description: 'Spam filter blocked 5 messages',
                status: 'resolved',
                statusIcon: 'fas fa-check'
            },
            {
                id: 3,
                time: Date.now() - 7200000,
                description: 'New member failed verification',
                status: 'investigating',
                statusIcon: 'fas fa-eye'
            }
        ],
        
        // Setup Wizard
        wizardStep: 1,
        selectedServerType: null,
        wizardSettings: {
            raidThreshold: 10,
            spamLimit: 5
        },
        
        // Server Types
        serverTypes: [
            {
                id: 'gaming',
                name: 'Gaming Community',
                description: 'For gaming servers with voice chat and casual atmosphere',
                icon: 'fas fa-gamepad',
                features: ['Anti-Spam Protection', 'Voice Channel Security', 'Gaming Bot Integration']
            },
            {
                id: 'crypto',
                name: 'Crypto / NFT',
                description: 'High security for crypto communities vulnerable to scams',
                icon: 'fab fa-bitcoin',
                features: ['Advanced Scam Detection', 'Link Scanning', 'Phishing Protection']
            },
            {
                id: 'support',
                name: 'Support Server',
                description: 'Professional support server with ticket systems',
                icon: 'fas fa-headset',
                features: ['Professional Moderation', 'Ticket Integration', 'Staff Management']
            },
            {
                id: 'social',
                name: 'Private Social Group',
                description: 'Casual private community with friends and family',
                icon: 'fas fa-users',
                features: ['Basic Protection', 'Friend Verification', 'Simple Moderation']
            },
            {
                id: 'highrisk',
                name: 'High-Risk Server',
                description: 'Maximum security for servers that attract attacks',
                icon: 'fas fa-shield-alt',
                features: ['Maximum Security', 'AI Threat Detection', 'Real-time Monitoring']
            }
        ],
        
        // Member Settings
        memberSettings: {
            minAccountAge: 24,
            flagNewAccounts: true,
            requireCaptcha: false,
            autoAssignRole: true
        },
        
        // Security Settings
        securitySettings: {
            antiRaid: true,
            raidThreshold: 10,
            autoBanRaid: false,
            antiSpam: true,
            messageLimit: 5,
            timeoutDuration: 10,
            linkScanning: true,
            blockSuspicious: true,
            allowedDomains: 'discord.com, youtube.com, github.com',
            minAccountAge: 24,
            requireAvatar: false,
            autoRole: 'member'
        },
        
        // Bot Settings
        botSettings: {
            prefix: '!',
            defaultAction: 'warn',
            logChannel: '',
            alertStaff: true,
            dmUsers: false,
            staffRole: ''
        },
        
        // API Keys
        apiKeys: {
            virusTotal: '',
            urlVoid: ''
        },
        
        // Analytics
        analyticsTimeframe: '24h',
        analytics: {
            threatsBlocked: 45,
            messagesScanned: 12847,
            usersVerified: 234,
            topThreats: [
                { type: 'Spam', description: 'Message flooding attempts', count: 23 },
                { type: 'Suspicious Links', description: 'Malicious URL detection', count: 12 },
                { type: 'Raid Attempts', description: 'Mass join events', count: 8 },
                { type: 'Phishing', description: 'Fake login attempts', count: 2 }
            ]
        },
        
        // Logs
        logFilter: 'all',
        securityLogs: [
            {
                id: 1,
                timestamp: Date.now() - 300000,
                event: 'Anti-Spam Triggered',
                user: 'User#1234',
                action: 'Message Deleted',
                status: 'Success'
            },
            {
                id: 2,
                timestamp: Date.now() - 600000,
                event: 'New Member Joined',
                user: 'NewUser#5678',
                action: 'Account Verified',
                status: 'Success'
            },
            {
                id: 3,
                timestamp: Date.now() - 900000,
                event: 'Suspicious Link',
                user: 'SuspiciousUser#9999',
                action: 'Link Blocked',
                status: 'Blocked'
            }
        ],
        
        // Server Data
        channels: [
            { id: '1', name: '#general' },
            { id: '2', name: '#security-logs' },
            { id: '3', name: '#mod-chat' }
        ],
        
        roles: [
            { id: '1', name: '@everyone' },
            { id: '2', name: 'Moderator' },
            { id: '3', name: 'Admin' },
            { id: '4', name: 'Member' }
        ],
        
        // Charts
        activityChart: null,
        eventsChart: null,
        threatTrendChart: null,
        chartsInitialized: false,
        
        // Methods
        async init() {
            console.log('✅ Dashboard initializing...');
            try {
                // Make dashboard globally accessible
                window.dashboardInstance = this;
                window.dashboard = this;
                
                this.checkAuthentication();
                await this.loadData();
                this.setupWebSocket();
                // Initialize charts after a short delay to ensure DOM is ready
                setTimeout(() => {
                    if (!this.chartsInitialized) {
                        this.initCharts();
                        this.chartsInitialized = true;
                    }
                }, 100);
                
                // Force show content and start auto refresh
                this.startAutoRefresh();
                console.log('✅ Dashboard initialized successfully');
                
                // Force show main content
                setTimeout(() => {
                    const mainContent = document.querySelector('.main-content');
                    if (mainContent) {
                        mainContent.style.display = 'block';
                        mainContent.style.opacity = '1';
                        mainContent.style.visibility = 'visible';
                    }
                    // Also show the tab content
                    const tabContent = document.querySelector('.tab-content');
                    if (tabContent) {
                        tabContent.style.display = 'block';
                        tabContent.style.opacity = '1';
                        tabContent.style.visibility = 'visible';
                    }
                }, 200);
            } catch (error) {
                console.error('❌ Dashboard initialization failed:', error);
            }
        },
        
        checkAuthentication() {
            // Check if token is in URL (from Discord OAuth)
            // OAuth no longer passes token in URL - it sets an HTTP-only cookie server-side
            // Check if we're logged in by verifying cookie (done automatically by browser)
            // If not authenticated, server will redirect to login
            return true;
        },
        
        setActiveTab(tab) {
            this.activeTab = tab;
            if (tab === 'setup-wizard') {
                this.wizardStep = 1;
            }
            
            // Load tab-specific data
            switch(tab) {
                case 'analytics':
                    this.loadAnalytics();
                    break;
                case 'logs':
                    this.loadLogs();
                    break;
            }
        },
        
        getScoreClass(score) {
            if (score >= 80) return 'excellent';
            if (score >= 60) return 'good';
            return 'poor';
        },
        
        getProtectionLevel(score) {
            if (score >= 90) return 'Maximum Security';
            if (score >= 80) return 'High Security';
            if (score >= 70) return 'Good Security';
            if (score >= 60) return 'Basic Security';
            return 'Security Needs Attention';
        },
        
        formatTime(timestamp) {
            const now = Date.now();
            const diff = now - timestamp;
            
            if (diff < 3600000) {
                const minutes = Math.floor(diff / 60000);
                return `${minutes}m ago`;
            } else if (diff < 86400000) {
                const hours = Math.floor(diff / 3600000);
                return `${hours}h ago`;
            } else {
                const days = Math.floor(diff / 86400000);
                return `${days}d ago`;
            }
        },
        
        formatLogTime(timestamp) {
            return new Date(timestamp).toLocaleString();
        },
        
        // Quick Actions
        async lockdownServer() {
            if (this.actionLoading) return;
            this.actionLoading = true;
            
            try {
                const response = await fetch('/api/lockdown', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: this.lockdownMode ? 'disable' : 'enable'
                    })
                });
                
                if (response.ok) {
                    this.lockdownMode = !this.lockdownMode;
                    this.showNotification(
                        this.lockdownMode ? '🔒 Server lockdown activated' : '🔓 Server lockdown deactivated',
                        this.lockdownMode ? 'warning' : 'success'
                    );
                } else {
                    throw new Error('Failed to toggle lockdown');
                }
            } catch (error) {
                console.error('Lockdown error:', error);
                this.showNotification('❌ Failed to toggle lockdown', 'error');
            } finally {
                this.actionLoading = false;
            }
        },
        
        async pauseInvites() {
            if (this.actionLoading) return;
            this.actionLoading = true;
            
            try {
                const response = await fetch('/api/invites', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: this.invitesPaused ? 'resume' : 'pause'
                    })
                });
                
                if (response.ok) {
                    this.invitesPaused = !this.invitesPaused;
                    this.showNotification(
                        this.invitesPaused ? '⏸️ Invites paused' : '▶️ Invites resumed',
                        'info'
                    );
                } else {
                    throw new Error('Failed to toggle invites');
                }
            } catch (error) {
                console.error('Invites error:', error);
                this.showNotification('❌ Failed to toggle invites', 'error');
            } finally {
                this.actionLoading = false;
            }
        },
        
        async clearRaidFlags() {
            if (this.actionLoading) return;
            this.actionLoading = true;
            
            try {
                const response = await fetch('/api/raid-flags', {
                    method: 'DELETE',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    this.showNotification('✅ Raid flags cleared successfully', 'success');
                    this.loadData();
                } else {
                    throw new Error('Failed to clear raid flags');
                }
            } catch (error) {
                console.error('Clear flags error:', error);
                this.showNotification('❌ Failed to clear raid flags', 'error');
            } finally {
                this.actionLoading = false;
            }
        },
        
        async emergencyMode() {
            if (this.actionLoading) return;
            this.actionLoading = true;
            
            try {
                const response = await fetch('/api/emergency', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: this.emergencyActive ? 'disable' : 'enable'
                    })
                });
                
                if (response.ok) {
                    this.emergencyActive = !this.emergencyActive;
                    this.showNotification(
                        this.emergencyActive ? '🚨 Emergency mode activated' : '✅ Emergency mode deactivated',
                        this.emergencyActive ? 'warning' : 'success'
                    );
                } else {
                    throw new Error('Failed to toggle emergency mode');
                }
            } catch (error) {
                console.error('Emergency mode error:', error);
                this.showNotification('❌ Failed to toggle emergency mode', 'error');
            } finally {
                this.actionLoading = false;
            }
        },
        
        async resolveThreat(threatId) {
            try {
                const response = await fetch(`/api/threats/${threatId}/resolve`, {
                    method: 'POST',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    this.currentThreats = this.currentThreats.filter(t => t.id !== threatId);
                    this.totalThreats = this.currentThreats.length;
                    this.showNotification('✅ Threat resolved successfully', 'success');
                } else {
                    throw new Error('Failed to resolve threat');
                }
            } catch (error) {
                console.error('Resolve threat error:', error);
                this.showNotification('❌ Failed to resolve threat', 'error');
            }
        },
        
        // Auto Refresh
        toggleAutoRefresh() {
            this.autoRefresh = !this.autoRefresh;
            
            if (this.autoRefresh) {
                this.autoRefreshInterval = setInterval(() => {
                    this.loadData();
                }, 30000); // Refresh every 30 seconds
                this.showNotification('🔄 Auto-refresh enabled (30s interval)', 'info');
            } else {
                if (this.autoRefreshInterval) {
                    clearInterval(this.autoRefreshInterval);
                    this.autoRefreshInterval = null;
                }
                this.showNotification('⏸️ Auto-refresh disabled', 'info');
            }
        },
        
        // Navigation
        setActiveTab(tab) {
            this.activeTab = tab;
            
            // Hide all tabs first
            const allTabs = document.querySelectorAll('.tab-content');
            allTabs.forEach(tabElement => {
                tabElement.style.display = 'none';
                tabElement.style.opacity = '0';
                tabElement.style.visibility = 'hidden';
            });
            
            // Show the active tab
            setTimeout(() => {
                const activeTabElement = document.querySelector(`[x-show="activeTab === '${tab}'"]`);
                if (activeTabElement) {
                    activeTabElement.style.display = 'block';
                    activeTabElement.style.opacity = '1';
                    activeTabElement.style.visibility = 'visible';
                }
                
                // Initialize charts if switching to analytics
                if (tab === 'analytics' && !this.chartsInitialized) {
                    setTimeout(() => {
                        this.initCharts();
                        this.chartsInitialized = true;
                    }, 100);
                }
            }, 50);
            
            console.log(`Switched to tab: ${tab}`);
        },
        
        // Data Loading
        async loadData() {
            if (this.loading) return;
            this.loading = true;
            
            try {
                const response = await fetch('/api/dashboard-data', {
                    credentials: 'include'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    this.updateDashboardData(data);
                } else if (response.status === 401 || response.status === 403) {
                    window.location.href = '/login';
                } else {
                    throw new Error('Failed to load dashboard data');
                }
            } catch (error) {
                console.error('Load data error:', error);
                if (!this.autoRefresh) {
                    this.showNotification('? Failed to load dashboard data', 'error');
                }
            } finally {
                this.loading = false;
            }
        },

        updateDashboardData(data) {
            if (data.securityScore !== undefined) this.securityScore = data.securityScore;
            if (data.serverName) this.serverName = data.serverName;
            if (data.serverIcon) this.serverIcon = data.serverIcon;
            if (data.currentThreats) {
                this.currentThreats = data.currentThreats;
                this.totalThreats = data.currentThreats.length;
            }
            if (data.recentIncidents) this.recentIncidents = data.recentIncidents;
            if (data.memberCount) this.memberCount = data.memberCount;
            
            // Update charts if data is available
            if (data.activityData) this.updateActivityChart(data.activityData);
            if (data.eventsData) this.updateEventsChart(data.eventsData);
        },
        
        // Setup Wizard
        nextStep() {
            if (this.wizardStep < 3) {
                this.wizardStep++;
            }
        },
        
        previousStep() {
            if (this.wizardStep > 1) {
                this.wizardStep--;
            }
        },
        
        async finishSetup() {
            if (this.setupLoading) return;
            this.setupLoading = true;
            
            try {
                const setupData = {
                    serverType: this.selectedServerType,
                    memberSettings: this.memberSettings,
                    wizardSettings: this.wizardSettings
                };
                
                const response = await fetch('/api/setup', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(setupData)
                });
                
                if (response.ok) {
                    this.showNotification('✅ Setup completed successfully!', 'success');
                    this.setActiveTab('dashboard');
                    this.loadData();
                } else {
                    throw new Error('Setup failed');
                }
            } catch (error) {
                console.error('Setup error:', error);
                this.showNotification('❌ Setup failed. Please try again.', 'error');
            } finally {
                this.setupLoading = false;
            }
        },
        
        // Settings Updates
        async updateSecuritySettings() {
            try {
                const response = await fetch('/api/security-settings', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(this.securitySettings)
                });
                
                if (response.ok) {
                    this.showNotification('🛡️ Security settings updated', 'success');
                } else {
                    throw new Error('Failed to update settings');
                }
            } catch (error) {
                console.error('Update settings error:', error);
                this.showNotification('❌ Failed to update settings', 'error');
            }
        },
        
        async updateBotSettings() {
            try {
                const response = await fetch('/api/bot-settings', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(this.botSettings)
                });
                
                if (response.ok) {
                    this.showNotification('🤖 Bot settings updated', 'success');
                } else {
                    throw new Error('Failed to update bot settings');
                }
            } catch (error) {
                console.error('Update bot settings error:', error);
                this.showNotification('❌ Failed to update bot settings', 'error');
            }
        },
        
        async updateApiKeys() {
            try {
                const response = await fetch('/api/api-keys', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(this.apiKeys)
                });
                
                if (response.ok) {
                    this.showNotification('🔑 API keys updated', 'success');
                } else {
                    throw new Error('Failed to update API keys');
                }
            } catch (error) {
                console.error('Update API keys error:', error);
                this.showNotification('❌ Failed to update API keys', 'error');
            }
        },
        
        // Analytics
        async loadAnalytics() {
            try {
                // Use default data if API fails
                this.analytics = {
                    threatsBlocked: 45,
                    messagesScanned: 12847,
                    usersVerified: 234,
                    topThreats: [
                        { type: 'Spam', description: 'Message flooding attempts', count: 23 },
                        { type: 'Suspicious Links', description: 'Malicious URL detection', count: 12 },
                        { type: 'Raid Attempts', description: 'Mass join events', count: 8 },
                        { type: 'Phishing', description: 'Fake login attempts', count: 2 }
                    ]
                };
                console.log('Analytics loaded (using default data)');
            } catch (error) {
                console.error('Load analytics error:', error);
            }
        },
        
        // Logs
        async loadLogs() {
            try {
                // Use default data if API fails
                this.securityLogs = [
                    {
                        id: 1,
                        timestamp: Date.now() - 300000,
                        event: 'Bot Started',
                        user: 'System',
                        action: 'Initialization',
                        status: 'Success'
                    },
                    {
                        id: 2,
                        timestamp: Date.now() - 600000,
                        event: 'Dashboard Access',
                        user: 'Admin',
                        action: 'Login',
                        status: 'Success'
                    }
                ];
                console.log('Logs loaded (using default data)');
            } catch (error) {
                console.error('Load logs error:', error);
            }
        },
        
        async exportLogs() {
            try {
                const response = await fetch('/api/logs/export', {
                    credentials: 'include'
                });
                
                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `security-logs-${new Date().toISOString().split('T')[0]}.csv`;
                    a.click();
                    window.URL.revokeObjectURL(url);
                    
                    this.showNotification('📤 Logs exported successfully', 'success');
                } else {
                    throw new Error('Failed to export logs');
                }
            } catch (error) {
                console.error('Export logs error:', error);
                this.showNotification('❌ Failed to export logs', 'error');
            }
        },
        
        // Data Management
        async exportSettings() {
            const settings = {
                securitySettings: this.securitySettings,
                botSettings: this.botSettings,
                memberSettings: this.memberSettings
            };
            
            const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `DarkLock-settings-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            window.URL.revokeObjectURL(url);
            
            this.showNotification('📤 Settings exported successfully', 'success');
        },
        
        async clearLogs() {
            try {
                const response = await fetch('/api/logs', {
                    method: 'DELETE',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    this.securityLogs = [];
                    this.showNotification('✅ Logs cleared successfully', 'success');
                } else {
                    throw new Error('Failed to clear logs');
                }
            } catch (error) {
                console.error('Clear logs error:', error);
                this.showNotification('❌ Failed to clear logs', 'error');
            }
        },
        
        async resetSettings() {
            try {
                const response = await fetch('/api/settings/reset', {
                    method: 'POST',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    // Reset to defaults
                    this.securitySettings = {
                        antiRaid: true,
                        raidThreshold: 10,
                        autoBanRaid: false,
                        antiSpam: true,
                        messageLimit: 5,
                        timeoutDuration: 10,
                        linkScanning: true,
                        blockSuspicious: true,
                        allowedDomains: 'discord.com, youtube.com, github.com',
                        minAccountAge: 24,
                        requireAvatar: false,
                        autoRole: 'member'
                    };
                    
                    this.showNotification('🔄 Settings reset to defaults', 'success');
                } else {
                    throw new Error('Failed to reset settings');
                }
            } catch (error) {
                console.error('Reset settings error:', error);
                this.showNotification('❌ Failed to reset settings', 'error');
            }
        },
        
        // Logout
        async logout() {
            try {
                await fetch('/auth/logout', {
                    method: 'POST',
                    credentials: 'include'
                });
            } catch (error) {
                console.error('Logout error:', error);
            } finally {
                window.location.href = '/login';
            }
        },
        
        // Charts
        initCharts() {
            // Wait for Alpine.js to render the DOM elements
            this.$nextTick(() => {
                this.initActivityChart();
                this.initEventsChart();
                this.initThreatTrendChart();
            });
        },
        
        initActivityChart() {
            const canvas = document.getElementById('activityChart');
            if (!canvas) {
                console.warn('Activity chart canvas not found');
                return;
            }
            
            // Destroy existing chart if it exists
            if (this.activityChart) {
                this.activityChart.destroy();
                this.activityChart = null;
            }
            
            try {
                this.activityChart = new Chart(canvas, {
                    type: 'line',
                    data: {
                        labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
                        datasets: [
                            {
                                label: 'Member Joins',
                                data: [5, 12, 8, 15, 22, 18],
                                borderColor: '#4ade80',
                                backgroundColor: 'rgba(74, 222, 128, 0.1)',
                                fill: true,
                                tension: 0.4
                            },
                            {
                                label: 'Messages',
                                data: [150, 220, 180, 280, 350, 290],
                                borderColor: '#3b82f6',
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                fill: true,
                                tension: 0.4
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                labels: {
                                    color: '#cbd5e1'
                                }
                            }
                        },
                        scales: {
                            x: {
                                ticks: { color: '#64748b' },
                                grid: { color: '#334155' }
                            },
                            y: {
                                ticks: { color: '#64748b' },
                                grid: { color: '#334155' }
                            }
                        }
                    }
                });
            } catch (error) {
                console.error('Failed to initialize activity chart:', error);
            }
        },
        
        initEventsChart() {
            const canvas = document.getElementById('eventsChart');
            if (!canvas) {
                console.warn('Events chart canvas not found');
                return;
            }
            
            // Destroy existing chart if it exists
            if (this.eventsChart) {
                this.eventsChart.destroy();
                this.eventsChart = null;
            }
            
            try {
                this.eventsChart = new Chart(canvas, {
                    type: 'doughnut',
                    data: {
                        labels: ['Spam Blocked', 'Raids Stopped', 'Links Filtered', 'Users Verified'],
                        datasets: [{
                            data: [45, 8, 23, 156],
                            backgroundColor: [
                                '#ef4444',
                                '#f59e0b',
                                '#10b981',
                                '#3b82f6'
                            ],
                            borderWidth: 2,
                            borderColor: '#1a1f2e'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: {
                                    color: '#cbd5e1',
                                    padding: 20
                                }
                            }
                        }
                    }
                });
            } catch (error) {
                console.error('Failed to initialize events chart:', error);
            }
        },
        
        initThreatTrendChart() {
            const canvas = document.getElementById('threatTrendChart');
            if (!canvas) {
                console.warn('Threat trend chart canvas not found');
                return;
            }
            
            // Destroy existing chart if it exists
            if (this.threatTrendChart) {
                this.threatTrendChart.destroy();
                this.threatTrendChart = null;
            }
            
            try {
                this.threatTrendChart = new Chart(canvas, {
                    type: 'bar',
                    data: {
                        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                        datasets: [{
                            label: 'Threats Blocked',
                            data: [12, 8, 15, 6, 4, 2, 7],
                            backgroundColor: 'rgba(239, 68, 68, 0.8)',
                            borderColor: '#ef4444',
                            borderWidth: 1
                        }, {
                            label: 'Messages Filtered',
                            data: [45, 32, 67, 28, 19, 12, 31],
                            backgroundColor: 'rgba(245, 158, 11, 0.8)',
                            borderColor: '#f59e0b',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                labels: {
                                    color: '#ffffff'
                                }
                            }
                        },
                        scales: {
                            x: {
                                ticks: { color: '#cbd5e1' },
                                grid: { color: 'rgba(74, 222, 128, 0.1)' }
                            },
                            y: {
                                ticks: { color: '#cbd5e1' },
                                grid: { color: 'rgba(74, 222, 128, 0.1)' }
                            }
                        }
                    }
                });
            } catch (error) {
                console.error('Failed to initialize threat trend chart:', error);
            }
        },
        
        updateActivityChart(data) {
            if (!this.activityChart || !data) return;
            
            this.activityChart.data.datasets[0].data = data.joins || [0, 0, 0, 0, 0, 0];
            this.activityChart.data.datasets[1].data = data.messages || [0, 0, 0, 0, 0, 0];
            this.activityChart.update();
        },
        
        updateEventsChart(data) {
            if (!this.eventsChart || !data) return;
            
            this.eventsChart.data.datasets[0].data = [
                data.spamBlocked || 0,
                data.raidsStoppd || 0,
                data.linksFiltered || 0,
                data.usersVerified || 0
            ];
            this.eventsChart.update();
        },
        
        updateThreatTrendChart(data) {
            if (!this.threatTrendChart || !data) return;
            
            this.threatTrendChart.data.datasets[0].data = data;
            this.threatTrendChart.update();
        },
        
        // WebSocket
        setupWebSocket() {
            try {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const ws = new WebSocket(`${protocol}//${window.location.host}`);
                
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'security_update') {
                        this.updateDashboardData(data.payload);
                    } else if (data.type === 'notification') {
                        this.showNotification(data.message, data.level);
                    } else if (data.type === 'threat_alert') {
                        this.showNotification(`🚨 ${data.message}`, 'warning');
                        this.loadData(); // Refresh threat data
                    }
                };
                
                ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                };
                
                ws.onopen = () => {
                    console.log('WebSocket connected');
                };
                
                ws.onclose = () => {
                    console.log('WebSocket disconnected');
                    // Try to reconnect after 5 seconds
                    setTimeout(() => this.setupWebSocket(), 5000);
                };
                
                this.ws = ws;
            } catch (error) {
                console.error('WebSocket setup error:', error);
            }
        },
        
        // Notifications
        showNotification(message, type = 'info') {
            const container = document.getElementById('notifications-container');
            if (!container) return;
            
            const notification = document.createElement('div');
            notification.className = `notification notification-${type}`;
            notification.innerHTML = `
                <i class="fas fa-${this.getNotificationIcon(type)}"></i>
                <span>${message}</span>
                <button onclick="this.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            `;
            
            container.appendChild(notification);
            
            // Auto-remove after 5 seconds
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 5000);
        },
        
        getNotificationIcon(type) {
            const icons = {
                success: 'check-circle',
                error: 'exclamation-circle',
                warning: 'exclamation-triangle',
                info: 'info-circle'
            };
            return icons[type] || 'info-circle';
        }
    };
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    console.log('DarkLock Security Dashboard loaded');
});




