const fs = require('fs');
const path = require('path');

class ConfigManager {
    constructor() {
        this.config = {};
        this.configPath = path.join(__dirname, '../../config.json');
    }

    async loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const configData = fs.readFileSync(this.configPath, 'utf8');
                this.config = JSON.parse(configData);
            } else {
                // Create default configuration
                await this.createDefaultConfig();
            }
            
            console.log('⚙️  Configuration loaded successfully');
        } catch (error) {
            console.error('❌ Failed to load configuration:', error);
            await this.createDefaultConfig();
        }
    }

    async createDefaultConfig() {
        const defaultConfig = {
            // Security Settings
            security: {
                antiRaid: {
                    enabled: true,
                    threshold: 10,
                    timeWindow: 60, // seconds
                    lockdownDuration: 300, // seconds
                    autoKick: true,
                    notifyMods: true
                },
                antiSpam: {
                    enabled: true,
                    maxMessages: 5,
                    timeWindow: 10, // seconds
                    maxDuplicates: 3,
                    maxMentions: 5,
                    maxEmojis: 10,
                    maxLinks: 2
                },
                antiMaliciousLinks: {
                    enabled: true,
                    quarantine: true,
                    scanTimeout: 5000,
                    checkShorteners: true,
                    autoDelete: true
                },
                antiPhishing: {
                    enabled: true,
                    similarityThreshold: 0.8,
                    checkUsernames: true,
                    checkMessages: true,
                    dmProtection: true
                },
                userVerification: {
                    enabled: true,
                    minAccountAge: 24, // hours
                    requireCaptcha: true,
                    vpnDetection: false,
                    autoKickNewAccounts: false
                }
            },

            // Moderation Settings
            moderation: {
                roleAuditing: {
                    enabled: true,
                    requireApproval: ['ADMINISTRATOR', 'MANAGE_GUILD', 'MANAGE_ROLES'],
                    alertChannel: null,
                    autoBackup: true
                },
                channelProtection: {
                    enabled: true,
                    protectSystemChannels: true,
                    requireConfirmation: true,
                    autoRestore: true
                },
                elevatedActions: {
                    requireMultipleApprovals: true,
                    minimumApprovers: 2,
                    actions: ['MASS_BAN', 'ROLE_DELETE', 'CHANNEL_DELETE']
                }
            },

            // Logging Settings
            logging: {
                enabled: true,
                retentionDays: 30,
                logMessages: true,
                logJoins: true,
                logRoles: true,
                logChannels: true,
                logModerationActions: true,
                redactSensitiveContent: true
            },

            // Backup Settings
            backup: {
                enabled: true,
                autoBackup: true,
                backupInterval: 24, // hours
                retentionDays: 7,
                includeMessages: false,
                includeRoles: true,
                includeChannels: true,
                includePermissions: true
            },

            // Dashboard Settings
            dashboard: {
                enabled: true,
                port: 3000,
                host: 'localhost',
                requireAuth: true,
                sessionTimeout: 3600 // seconds
            },

            // AI/ML Settings
            ai: {
                toxicityFilter: {
                    enabled: true,
                    threshold: 0.7,
                    autoDelete: true,
                    autoTimeout: false
                },
                behaviorAnalysis: {
                    enabled: true,
                    trackPatterns: true,
                    riskScoring: true,
                    alertThreshold: 80
                }
            },

            // Integration Settings
            integrations: {
                virusTotal: {
                    enabled: false,
                    apiKey: null
                },
                urlVoid: {
                    enabled: false,
                    apiKey: null
                },
                safeBrowsing: {
                    enabled: false,
                    apiKey: null
                }
            },

            // Rate Limiting
            rateLimits: {
                commands: {
                    user: 10, // per minute
                    global: 100 // per minute
                },
                api: {
                    requests: 1000, // per minute
                    burst: 50
                }
            }
        };

        this.config = defaultConfig;
        await this.saveConfig();
    }

    async saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
            console.log('💾 Configuration saved successfully');
        } catch (error) {
            console.error('❌ Failed to save configuration:', error);
        }
    }

    get(path, defaultValue = null) {
        const keys = path.split('.');
        let current = this.config;
        
        for (const key of keys) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                return defaultValue;
            }
        }
        
        return current;
    }

    set(path, value) {
        const keys = path.split('.');
        let current = this.config;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!(key in current) || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        
        current[keys[keys.length - 1]] = value;
    }

    async updateConfig(path, value) {
        this.set(path, value);
        await this.saveConfig();
    }

    getSecurityConfig() {
        return this.get('security', {});
    }

    getModerationConfig() {
        return this.get('moderation', {});
    }

    getLoggingConfig() {
        return this.get('logging', {});
    }

    getBackupConfig() {
        return this.get('backup', {});
    }

    getDashboardConfig() {
        return this.get('dashboard', {});
    }

    getAIConfig() {
        return this.get('ai', {});
    }

    getIntegrationsConfig() {
        return this.get('integrations', {});
    }

    getRateLimitsConfig() {
        return this.get('rateLimits', {});
    }
}

module.exports = ConfigManager;