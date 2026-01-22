// Comprehensive DarkLock Dashboard
function dashboard() {
    return {
        // Basic state
        activeTab: 'dashboard',
        loading: false,
        actionLoading: false,
        setupLoading: false,
        showWizard: false,
        wizardMode: 'easy', // 'easy' or 'advanced'
        
        // Dashboard data
        securityScore: 87,
        memberCount: 1247,
        totalThreats: 156,
        serverName: 'My Discord Server',
        serverIcon: 'https://cdn.discordapp.com/embed/avatars/0.png',
        botOnline: true,
        uptime: '7 days, 14 hours',
        
        // Real-time stats
        stats: {
            messagesScanned: 12847,
            threatsBlocked: 156,
            usersVerified: 234,
            linksBlocked: 89,
            spamBlocked: 67,
            raidsStopped: 3,
            phishingBlocked: 12,
            malwareBlocked: 8
        },
        
        // Security data
        currentThreats: [
            { id: 1, type: 'Suspicious Link', user: 'BadActor#1234', severity: 'high', time: '2 min ago' },
            { id: 2, type: 'Spam Detection', user: 'Spammer#5678', severity: 'medium', time: '5 min ago' },
            { id: 3, type: 'Raid Attempt', user: 'Multiple Users', severity: 'critical', time: '1 hour ago' }
        ],
        
        recentIncidents: [
            { id: 1, type: 'Phishing Link', action: 'Deleted & Warned', user: 'User#1234', time: '10 min ago' },
            { id: 2, type: 'Mass Join', action: 'Auto-banned 5 users', user: 'System', time: '1 hour ago' },
            { id: 3, type: 'Spam Messages', action: 'Timeout 10min', user: 'Spammer#5678', time: '2 hours ago' }
        ],
        
        blockedLinks: [
            { url: 'malicious-site.com', reason: 'Malware', blocked: '15 times', lastSeen: '5 min ago' },
            { url: 'phishing-discord.net', reason: 'Phishing', blocked: '8 times', lastSeen: '1 hour ago' },
            { url: 'spam-link.xyz', reason: 'Spam', blocked: '23 times', lastSeen: '3 hours ago' }
        ],
        
        filteredMessages: [
            { content: 'Buy cheap N***o here!', user: 'Spammer#1234', reason: 'Profanity + Spam', time: '2 min ago' },
            { content: 'Free Discord Nitro: bit.ly/fake-link', user: 'Scammer#5678', reason: 'Suspicious Link', time: '15 min ago' },
            { content: '@everyone JOIN MY SERVER NOW!!!', user: 'Advertiser#9999', reason: 'Mass Mention + Caps', time: '1 hour ago' }
        ],
        
        securityLogs: [
            { id: 1, level: 'warning', event: 'Suspicious link blocked', user: 'BadActor#1234', details: 'Blocked malicious-site.com', time: '2024-11-17 14:23:15' },
            { id: 2, level: 'critical', event: 'Raid attempt detected', user: 'System', details: 'Mass join of 15 users in 30 seconds', time: '2024-11-17 13:45:32' },
            { id: 3, level: 'info', event: 'User verified', user: 'NewMember#5678', details: 'Passed account age check', time: '2024-11-17 12:18:45' }
        ],
        
        // Settings
        securitySettings: {
            antiRaid: true,
            raidThreshold: 10,
            autoBanRaid: true,
            raidCooldown: 300,
            antiSpam: true,
            messageLimit: 5,
            timeWindow: 10,
            timeoutDuration: 600,
            linkScanning: true,
            blockSuspicious: true,
            allowedDomains: 'discord.com, youtube.com, github.com, twitch.tv',
            minAccountAge: 24,
            requireAvatar: false,
            autoRole: '',
            antiPhishing: true,
            malwareProtection: true,
            profanityFilter: true,
            massmentionProtection: true,
            capsFilter: true,
            emojiSpamProtection: true
        },
        
        // Advanced settings
        advancedSettings: {
            logRetention: 30,
            backupFrequency: 'daily',
            alertThreshold: 5,
            autoModSensitivity: 'medium',
            whitelistBypass: true,
            escalationRules: true,
            customFilters: '',
            apiRateLimit: 100,
            debugMode: false,
            experimentalFeatures: false
        },
        
        // Analytics
        analytics: {
            threatsBlocked: 156,
            messagesScanned: 12847,
            usersVerified: 234,
            topThreats: [
                { name: 'Spam Messages', count: 67, trend: '+12%' },
                { name: 'Suspicious Links', count: 45, trend: '+8%' },
                { name: 'Profanity', count: 34, trend: '-3%' },
                { name: 'Mass Mentions', count: 23, trend: '+15%' }
            ],
            hourlyStats: {
                labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
                threats: [12, 8, 15, 23, 31, 18],
                messages: [145, 89, 234, 456, 378, 267]
            },
            weeklyTrends: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                data: [23, 19, 31, 28, 35, 42, 38]
            }
        },
        analyticsTimeframe: '7d',
        
        // Logs
        logFilter: 'all',
        
        // Bot settings
        botSettings: {
            prefix: '!',
            defaultAction: 'warn',
            logChannel: 'security-logs',
            alertStaff: true,
            dmUsers: false,
            staffRole: 'Moderator',
            muteRole: 'Muted',
            autoDelete: true,
            showWarnings: true
        },
        
        // Data arrays
        channels: [
            { id: '123', name: 'general' },
            { id: '456', name: 'security-logs' },
            { id: '789', name: 'mod-chat' }
        ],
        roles: [
            { id: '111', name: 'Admin' },
            { id: '222', name: 'Moderator' },
            { id: '333', name: 'Member' },
            { id: '444', name: 'Muted' }
        ],
        
        // API Keys
        apiKeys: {
            virusTotal: '',
            urlVoid: '',
            googleSafeBrowsing: '',
            customApi: ''
        },
        
        // Wizard
        wizardStep: 1,
        selectedServerType: null,
        serverTypes: [
            { id: 'gaming', name: 'Gaming Community' },
            { id: 'business', name: 'Business/Professional' },
            { id: 'educational', name: 'Educational' },
            { id: 'general', name: 'General Community' }
        ],
        memberSettings: {
            minAccountAge: 24,
            flagNewAccounts: true,
            requireCaptcha: false,
            autoAssignRole: false
        },
        wizardSettings: {
            raidThreshold: 10,
            spamLimit: 5
        },
        
        // Initialize
        init() {
            console.log('🚀 Dashboard initialized');
            window.dashboardInstance = this;
            this.loadData();
            this.startAutoRefresh();
        },
        
        // Navigation
        setActiveTab(tab) {
            this.activeTab = tab;
            console.log('✅ Switching to tab:', tab);
            
            // Hide all tab contents first
            document.querySelectorAll('.tab-content > div').forEach(el => {
                el.style.display = 'none';
            });
            
            // Show the selected tab content
            const targetTab = document.getElementById(`${tab}-tab`);
            if (targetTab) {
                targetTab.style.display = 'block';
                console.log('✅ Tab content shown:', tab);
            }
            
            // Update sidebar active state
            document.querySelectorAll('.sidebar-nav button').forEach(btn => {
                btn.classList.remove('active');
            });
            
            const activeBtn = document.querySelector(`button[onclick*="'${tab}'"]`);
            if (activeBtn) {
                activeBtn.classList.add('active');
            }
            
            // Load data for specific tabs
            if (tab === 'analytics') {
                this.loadAnalytics();
            } else if (tab === 'logs') {
                this.loadLogs();
            }
        },
        
        switchTab(tab) {
            this.setActiveTab(tab);
        },
                if (activeTab) {
                    activeTab.style.display = 'block';
                    activeTab.style.opacity = '1';
                    activeTab.style.visibility = 'visible';
                }
            }, 10);
        },
        
        // Data loading
        async loadData() {
            if (this.loading) return;
            this.loading = true;
            
            try {
                // Fetch real data from the bot
                const response = await fetch('/api/dashboard-data', {
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    this.securityScore = data.securityScore || 87;
                    this.memberCount = data.memberCount || 1247;
                    this.totalThreats = data.totalThreats || 0;
                    this.serverName = data.serverName || 'DarkLock Server';
                    this.botOnline = data.botOnline !== false;
                } else {
                    console.warn('Using fallback data');
                }
            } catch (error) {
                console.warn('Failed to fetch data, using fallback');
            } finally {
                this.loading = false;
            }
        },
        
        // Auto refresh
        startAutoRefresh() {
            setInterval(() => {
                this.loadData();
            }, 30000); // Refresh every 30 seconds
        },
        
        // Action methods
        async lockdownServer() {
            try {
                const response = await fetch('/api/actions/lockdown', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.ok) {
                    alert('🔒 Server lockdown activated!');
                    this.loadData();
                } else {
                    alert('❌ Failed to activate lockdown');
                }
            } catch (error) {
                alert('🔒 Lockdown mode would be activated here!');
            }
        },
        
        async pauseInvites() {
            try {
                const response = await fetch('/api/actions/pause-invites', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.ok) {
                    alert('⏸️ Invites paused!');
                    this.loadData();
                } else {
                    alert('❌ Failed to pause invites');
                }
            } catch (error) {
                alert('⏸️ Invites would be paused here!');
            }
        },
        
        async clearRaidFlags() {
            try {
                const response = await fetch('/api/actions/clear-raids', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.ok) {
                    alert('🧹 Raid flags cleared!');
                    this.loadData();
                } else {
                    alert('❌ Failed to clear raid flags');
                }
            } catch (error) {
                alert('🧹 Raid flags would be cleared here!');
            }
        },
        
        async emergencyMode() {
            try {
                const response = await fetch('/api/actions/emergency', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.ok) {
                    alert('🚨 Emergency mode activated!');
                    this.loadData();
                } else {
                    alert('❌ Failed to activate emergency mode');
                }
            } catch (error) {
                alert('🚨 Emergency mode would be activated here!');
            }
        },
        
        toggleAutoRefresh() {
            alert('🔄 Auto-refresh is always enabled!');
        },
        
        // Security methods
        updateSecuritySettings() {
            console.log('Security settings updated');
        },
        
        // Analytics methods
        loadAnalytics() {
            console.log('Loading analytics for:', this.analyticsTimeframe);
        },
        
        // Log methods
        loadLogs() {
            console.log('Loading logs with filter:', this.logFilter);
        },
        
        // Bot settings methods
        updateBotSettings() {
            console.log('Bot settings updated');
        },
        
        updateApiKeys() {
            console.log('API keys updated');
        },
        
        // Wizard methods
        nextStep() {
            if (this.wizardStep < 3) this.wizardStep++;
        },
        
        previousStep() {
            if (this.wizardStep > 1) this.wizardStep--;
        },
        
        finishSetup() {
            alert('Setup completed!');
        },
        
        // Utility functions
        getProtectionLevel(score) {
            if (score >= 90) return 'Excellent Security';
            if (score >= 75) return 'High Security';
            if (score >= 60) return 'Good Security';
            return 'Needs Improvement';
        }
    };
}

// Global navigation functions for onclick handlers
function setActiveTab(tab) {
    console.log('Setting active tab:', tab);
    if (window.dashboardInstance) {
        window.dashboardInstance.setActiveTab(tab);
    }
}

function performAction(action) {
    console.log('Performing action:', action);
    if (window.dashboardInstance) {
        switch(action) {
            case 'lockdown':
                window.dashboardInstance.lockdownServer();
                break;
            case 'pauseInvites':
                window.dashboardInstance.pauseInvites();
                break;
            case 'clearRaidFlags':
                window.dashboardInstance.clearRaidFlags();
                break;
            case 'emergencyMode':
                window.dashboardInstance.emergencyMode();
                break;
            case 'loadData':
                window.dashboardInstance.loadData();
                break;
            case 'toggleAutoRefresh':
                window.dashboardInstance.toggleAutoRefresh();
                break;
            default:
                alert(`Action: ${action} - Feature coming soon!`);
        }
    }
}
