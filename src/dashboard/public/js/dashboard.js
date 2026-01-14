// Dashboard JavaScript with Alpine.js
function dashboard() {
    return {
        // UI State
        activeTab: 'dashboard',
        sidebarCollapsed: false,
        darkMode: true,
        notifications: 3,
        
        // Server Data
        serverName: 'My Discord Server',
        serverIcon: 'https://cdn.discordapp.com/icons/123456789/a_abc123.gif',
        userAvatar: 'https://cdn.discordapp.com/avatars/123456789/abc123.png',
        
        // Security Data
        securityScore: 87,
        lockdownMode: false,
        invitesPaused: false,
        
        // Current Threats
        currentThreats: [
            {
                id: 1,
                title: 'Suspicious Joins',
                count: 3,
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
        
        // Recent Incidents
        recentIncidents: [
            {
                id: 1,
                time: Date.now() - 1800000, // 30 minutes ago
                description: 'Automatic raid protection triggered',
                status: 'resolved',
                statusIcon: 'fas fa-check'
            },
            {
                id: 2,
                time: Date.now() - 3600000, // 1 hour ago
                description: 'Spam filter blocked 5 messages',
                status: 'resolved',
                statusIcon: 'fas fa-check'
            },
            {
                id: 3,
                time: Date.now() - 7200000, // 2 hours ago
                description: 'New member failed verification',
                status: 'investigating',
                statusIcon: 'fas fa-eye'
            }
        ],
        
        // Setup Wizard
        wizardStep: 1,
        selectedServerType: null,
        
        // Server Types for Setup
        serverTypes: [
            {
                id: 'gaming',
                name: 'Gaming Community',
                description: 'For gaming servers with voice chat and casual atmosphere',
                icon: 'fas fa-gamepad',
                features: ['Anti-Spam', 'Voice Protection', 'Gaming Bots']
            },
            {
                id: 'crypto',
                name: 'Crypto / NFT',
                description: 'High security for crypto communities vulnerable to scams',
                icon: 'fab fa-bitcoin',
                features: ['Anti-Scam', 'Link Scanning', 'Phishing Protection']
            },
            {
                id: 'support',
                name: 'Support Server',
                description: 'Professional support server with ticket systems',
                icon: 'fas fa-headset',
                features: ['Professional Filters', 'Ticket Integration', 'Staff Tools']
            },
            {
                id: 'social',
                name: 'Private Social Group',
                description: 'Casual private community with friends and family',
                icon: 'fas fa-users',
                features: ['Basic Protection', 'Friend Verification', 'Simple Rules']
            },
            {
                id: 'highrisk',
                name: 'High-Risk Server',
                description: 'Maximum security for servers that attract attacks',
                icon: 'fas fa-shield-alt',
                features: ['Maximum Security', 'AI Detection', 'Real-time Monitoring']
            }
        ],
        
        // Member Settings
        memberSettings: {
            minAccountAge: 24,
            flagNewAccounts: true,
            requireCaptcha: false,
            autoAssignRole: true
        },
        
        // Charts
        activityChart: null,
        eventsChart: null,
        
        // Methods
        init() {
            this.initCharts();
            this.loadData();
            this.setupWebSocket();
        },
        
        setActiveTab(tab) {
            this.activeTab = tab;
            if (tab === 'setup-wizard') {
                this.wizardStep = 1;
            }
        },
        
        toggleTheme() {
            this.darkMode = !this.darkMode;
            document.body.classList.toggle('light-mode', !this.darkMode);
        },
        
        getScoreClass(score) {
            if (score >= 80) return 'excellent';
            if (score >= 60) return 'good';
            return 'poor';
        },
        
        getProtectionLevel(score) {
            if (score >= 90) return 'Excellent';
            if (score >= 80) return 'Very Good';
            if (score >= 70) return 'Good';
            if (score >= 60) return 'Fair';
            return 'Needs Improvement';
        },
        
        formatTime(timestamp) {
            const now = Date.now();
            const diff = now - timestamp;
            
            if (diff < 3600000) { // Less than 1 hour
                const minutes = Math.floor(diff / 60000);
                return `${minutes}m ago`;
            } else if (diff < 86400000) { // Less than 1 day
                const hours = Math.floor(diff / 3600000);
                return `${hours}h ago`;
            } else {
                const days = Math.floor(diff / 86400000);
                return `${days}d ago`;
            }
        },
        
        // Quick Actions
        async lockdownServer() {
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
                        this.lockdownMode ? 'Server lockdown activated' : 'Server lockdown deactivated',
                        this.lockdownMode ? 'warning' : 'success'
                    );
                } else {
                    throw new Error('Request failed');
                }
            } catch (error) {
                console.error('Lockdown error:', error);
                this.showNotification('Failed to toggle lockdown', 'error');
            }
        },
        
        async pauseInvites() {
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
                        this.invitesPaused ? 'Invites paused' : 'Invites resumed',
                        'info'
                    );
                } else {
                    throw new Error('Request failed');
                }
            } catch (error) {
                console.error('Invites error:', error);
                this.showNotification('Failed to toggle invites', 'error');
            }
        },
        
        async clearRaidFlags() {
            try {
                const response = await fetch('/api/raid-flags', {
                    method: 'DELETE',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    this.showNotification('Raid flags cleared', 'success');
                    this.loadData(); // Refresh data
                } else {
                    throw new Error('Request failed');
                }
            } catch (error) {
                console.error('Clear flags error:', error);
                this.showNotification('Failed to clear raid flags', 'error');
            }
        },
        
        // Setup Wizard
        nextStep() {
            if (this.wizardStep < 6) {
                this.wizardStep++;
            }
        },
        
        previousStep() {
            if (this.wizardStep > 1) {
                this.wizardStep--;
            }
        },
        
        async finishSetup() {
            try {
                const setupData = {
                    serverType: this.selectedServerType,
                    memberSettings: this.memberSettings
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
                    this.showNotification('Setup completed successfully!', 'success');
                    this.setActiveTab('dashboard');
                    this.loadData();
                } else {
                    throw new Error('Setup failed');
                }
            } catch (error) {
                console.error('Setup error:', error);
                this.showNotification('Setup failed. Please try again.', 'error');
            }
        },
        
        // Data Loading
        async loadData() {
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
                    throw new Error('Failed to load data');
                }
            } catch (error) {
                console.error('Failed to load dashboard data:', error);
            }
        },
        
        updateDashboardData(data) {
            if (data.securityScore) this.securityScore = data.securityScore;
            if (data.currentThreats) this.currentThreats = data.currentThreats;
            if (data.recentIncidents) this.recentIncidents = data.recentIncidents;
            if (data.serverName) this.serverName = data.serverName;
            if (data.serverIcon) this.serverIcon = data.serverIcon;
            
            // Update charts
            this.updateCharts(data);
        },
        
        // Charts
        initCharts() {
            const ctx1 = document.getElementById('activityChart');
            if (ctx1) {
                this.activityChart = new Chart(ctx1, {
                    type: 'line',
                    data: {
                        labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
                        datasets: [
                            {
                                label: 'Member Joins',
                                data: [5, 12, 8, 15, 22, 18],
                                borderColor: '#40C463',
                                backgroundColor: 'rgba(64, 196, 99, 0.1)',
                                fill: true
                            },
                            {
                                label: 'Messages',
                                data: [150, 220, 180, 280, 350, 290],
                                borderColor: '#5865F2',
                                backgroundColor: 'rgba(88, 101, 242, 0.1)',
                                fill: true
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                labels: {
                                    color: '#B0B3B8'
                                }
                            }
                        },
                        scales: {
                            x: {
                                ticks: { color: '#8A8D91' },
                                grid: { color: '#40444B' }
                            },
                            y: {
                                ticks: { color: '#8A8D91' },
                                grid: { color: '#40444B' }
                            }
                        }
                    }
                });
            }
            
            const ctx2 = document.getElementById('eventsChart');
            if (ctx2) {
                this.eventsChart = new Chart(ctx2, {
                    type: 'doughnut',
                    data: {
                        labels: ['Spam Blocked', 'Raids Stopped', 'Links Filtered', 'Users Verified'],
                        datasets: [{
                            data: [45, 8, 23, 156],
                            backgroundColor: [
                                '#E05252',
                                '#FFC947',
                                '#40C463',
                                '#5865F2'
                            ],
                            borderWidth: 2,
                            borderColor: '#1B1E23'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: {
                                    color: '#B0B3B8',
                                    padding: 20
                                }
                            }
                        }
                    }
                });
            }
        },
        
        updateCharts(data) {
            if (this.activityChart && data.activityData) {
                this.activityChart.data.datasets[0].data = data.activityData.joins;
                this.activityChart.data.datasets[1].data = data.activityData.messages;
                this.activityChart.update();
            }
            
            if (this.eventsChart && data.eventsData) {
                this.eventsChart.data.datasets[0].data = [
                    data.eventsData.spamBlocked,
                    data.eventsData.raidsStopped,
                    data.eventsData.linksFiltered,
                    data.eventsData.usersVerified
                ];
                this.eventsChart.update();
            }
        },
        
        // WebSocket for real-time updates
        setupWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.type === 'security_update') {
                    this.updateDashboardData(data.payload);
                } else if (data.type === 'notification') {
                    this.showNotification(data.message, data.level);
                }
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
            this.ws = ws;
        },
        
        // Notifications
        showNotification(message, type = 'info') {
            // Create notification element
            const notification = document.createElement('div');
            notification.className = `notification notification-${type}`;
            notification.innerHTML = `
                <i class="fas fa-${this.getNotificationIcon(type)}"></i>
                <span>${message}</span>
                <button onclick="this.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            `;
            
            // Add to page
            const container = document.querySelector('.notifications-container') || (() => {
                const div = document.createElement('div');
                div.className = 'notifications-container';
                document.body.appendChild(div);
                return div;
            })();
            
            container.appendChild(notification);
            
            // Auto-remove after 5 seconds
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 5000);
            
            this.notifications++;
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

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Any additional initialization code can go here
    console.log('Discord Security Dashboard loaded');
});
