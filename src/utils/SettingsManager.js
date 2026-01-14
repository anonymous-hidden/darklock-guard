const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const EventEmitter = require('events');

class SettingsManager extends EventEmitter {
    constructor(bot) {
        super();
        this.bot = bot;
        this.activeListeners = new Map(); // Track active setting listeners for live updates
        this.defaultSettings = {
            // Security Settings
            security: {
                antiSpam: {
                    enabled: true,
                    maxMessages: 5,
                    timeWindow: 10, // seconds
                    muteTime: 300, // seconds
                    deleteMessages: true
                },
                antiRaid: {
                    enabled: true,
                    joinThreshold: 10, // joins in timeWindow
                    timeWindow: 60, // seconds
                    lockdownTime: 600, // seconds
                    actionType: 'lockdown' // kick, ban, lockdown
                },
                antiPhishing: {
                    enabled: true,
                    checkLinks: true,
                    strictMode: false,
                    actionType: 'delete' // delete, warn, timeout
                },
                automod: {
                    enabled: true,
                    filterProfanity: true,
                    filterInvites: true,
                    filterCaps: false,
                    capsPercentage: 80
                }
            },

            // Moderation Settings
            moderation: {
                warnings: {
                    enabled: true,
                    maxWarnings: 3,
                    autoAction: 'timeout', // timeout, kick, ban
                    expireDays: 30
                },
                timeout: {
                    defaultDuration: 600, // seconds
                    maxDuration: 2419200, // 28 days in seconds
                    requireReason: false
                },
                ban: {
                    deleteMessageDays: 1,
                    requireReason: false,
                    appealUrl: ''
                },
                purge: {
                    maxMessages: 100,
                    requireReason: false,
                    logPurges: true
                }
            },

            // Analytics Settings
            analytics: {
                enabled: true,
                trackMessages: true,
                trackCommands: true,
                trackVoice: true,
                trackReactions: true,
                trackJoinsLeaves: true,
                retentionDays: 90,
                detailedLogging: false
            },

            // Ticket System Settings
            tickets: {
                enabled: false,
                categoryId: null,
                staffRoleId: null,
                logChannelId: null,
                transcriptChannelId: null,
                supportMessage: 'Thank you for creating a ticket! Our staff will assist you shortly.',
                ticketLimit: 1,
                autoCloseHours: 48,
                requireReason: false,
                allowUserClose: true,
                dmTranscripts: true,
                includeAttachments: true,
                transcriptFormat: 'HTML',
                categories: []
            },

            // Logging Settings
            logging: {
                enabled: true,
                logChannel: null,
                events: {
                    messageDelete: true,
                    messageEdit: true,
                    messageBulkDelete: true,
                    memberJoin: true,
                    memberLeave: true,
                    memberBan: true,
                    memberUnban: true,
                    memberUpdate: true,
                    channelCreate: true,
                    channelDelete: true,
                    channelUpdate: true,
                    roleCreate: true,
                    roleDelete: true,
                    roleUpdate: true,
                    securityEvents: true,
                    settingsChange: true
                }
            },

            // Dashboard Settings
            dashboard: {
                enabled: true,
                updateInterval: 300, // seconds
                theme: 'dark',
                showPublicStats: false,
                featuredChannels: [],
                hideOfflineStaff: false
            },

            // Welcome Messages
            welcomeMessages: {
                join: {
                    enabled: false,
                    channelId: null,
                    message: 'Welcome {user} to {server}!'
                },
                leave: {
                    enabled: false,
                    channelId: null,
                    message: '{user} has left the server.'
                }
            }
        };
    }

    // Initialize settings for a guild
    async initializeGuild(guildId) {
        try {
            const existing = await this.bot.database.get(`
                SELECT * FROM guild_settings WHERE guild_id = ?
            `, [guildId]);

            if (!existing) {
                await this.bot.database.run(`
                    INSERT INTO guild_settings (guild_id, settings, created_at, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `, [guildId, JSON.stringify(this.defaultSettings)]);
                console.log(`⚙️ Initialized settings for guild ${guildId}`);
            }
        } catch (error) {
            this.bot.logger.error('Error initializing guild settings:', error);
        }
    }

    // Get settings for a guild
    async getSettings(guildId, category = null) {
        try {
            const result = await this.bot.database.get(`
                SELECT settings FROM guild_settings WHERE guild_id = ?
            `, [guildId]);

            if (!result) {
                await this.initializeGuild(guildId);
                return category ? this.defaultSettings[category] : this.defaultSettings;
            }

            const settings = JSON.parse(result.settings);
            return category ? settings[category] || this.defaultSettings[category] : settings;
        } catch (error) {
            this.bot.logger.error('Error getting settings:', error);
            return category ? this.defaultSettings[category] : this.defaultSettings;
        }
    }

    // Update settings for a guild with live update notification
    async updateSettings(guildId, category, newSettings, userId = 'System') {
        try {
            const currentSettings = await this.getSettings(guildId);
            const oldSettings = { ...currentSettings[category] };
            currentSettings[category] = { ...currentSettings[category], ...newSettings };

            await this.bot.database.run(`
                UPDATE guild_settings 
                SET settings = ?, updated_at = CURRENT_TIMESTAMP
                WHERE guild_id = ?
            `, [JSON.stringify(currentSettings), guildId]);

            // Emit live update event
            this.emit('settingsUpdated', {
                guildId,
                category,
                oldSettings,
                newSettings: currentSettings[category],
                timestamp: Date.now()
            });

            // Emit granular settingChanged events for each changed key so system-wide listeners react
            try {
                const flatten = (obj, prefix = '') => {
                    const out = [];
                    for (const k of Object.keys(obj || {})) {
                        const v = obj[k];
                        const keyPath = prefix ? `${prefix}.${k}` : k;
                        if (v && typeof v === 'object' && !Array.isArray(v)) {
                            out.push(...flatten(v, keyPath));
                        } else {
                            out.push({ key: keyPath, value: v });
                        }
                    }
                    return out;
                };

                const changes = flatten(newSettings);
                for (const ch of changes) {
                    try {
                        if (this.bot && typeof this.bot.emitSettingChange === 'function') {
                            // Compose a namespaced key: category.subkey[.subsub]
                            const composedKey = `${category}.${ch.key}`;
                            // Fire and forget; emitSettingChange is lightweight
                            try { this.bot.emitSettingChange(guildId, userId, composedKey, ch.value); } catch (e) { /* ignore */ }
                        }
                    } catch (e) {
                        this.bot.logger?.warn && this.bot.logger.warn('SettingsManager: failed to emit settingChange for', ch.key, e?.message || e);
                    }
                }
            } catch (e) {
                this.bot.logger?.warn && this.bot.logger.warn('SettingsManager: error emitting granular changes:', e?.message || e);
            }

            // Apply settings changes immediately to active modules
            await this.applySettingsLive(guildId, category, currentSettings[category]);

            return { success: true, settings: currentSettings[category] };
        } catch (error) {
            this.bot.logger.error('Error updating settings:', error);
            return { success: false, error: error.message };
        }
    }

    // Create interactive settings panel
    async createSettingsPanel(channel, category = null) {
        const guild = channel.guild;
        const settings = await this.getSettings(guild.id, category);

        if (category) {
            return this.createCategoryPanel(channel, category, settings);
        }

        try {
            const embed = new EmbedBuilder()
                .setTitle('⚙️ Server Settings')
                .setDescription('Select a category to configure your server settings.')
                .addFields([
                    { 
                        name: '🛡️ Security', 
                        value: 'Anti-spam, anti-raid, anti-phishing, automod settings', 
                        inline: false 
                    },
                    { 
                        name: '📊 Analytics', 
                        value: 'Data collection and tracking preferences', 
                        inline: false 
                    },
                    { 
                        name: '🎫 Tickets', 
                        value: 'Support ticket system configuration', 
                        inline: false 
                    },
                    { 
                        name: '📝 Logging', 
                        value: 'Event logging and audit trail settings', 
                        inline: false 
                    },
                    { 
                        name: '📱 Dashboard', 
                        value: 'Web dashboard appearance and features', 
                        inline: false 
                    }
                ])
                .setColor(0x00aa00)
                .setFooter({ text: 'Use the dropdown to select a settings category' });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('settings_category_select')
                .setPlaceholder('Choose a settings category...')
                .addOptions([
                    {
                        label: 'Security Settings',
                        description: 'Configure anti-spam, anti-raid, and automod',
                        value: 'security',
                        emoji: '🛡️'
                    },
                    {
                        label: 'Analytics Settings',
                        description: 'Data collection and tracking options',
                        value: 'analytics',
                        emoji: '📊'
                    },
                    {
                        label: 'Ticket Settings',
                        description: 'Support ticket system configuration',
                        value: 'tickets',
                        emoji: '🎫'
                    },
                    {
                        label: 'Logging Settings',
                        description: 'Event logging configuration',
                        value: 'logging',
                        emoji: '📝'
                    },
                    {
                        label: 'Dashboard Settings',
                        description: 'Web dashboard customization',
                        value: 'dashboard',
                        emoji: '📱'
                    }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            const message = await channel.send({ embeds: [embed], components: [row] });

            return { success: true, messageId: message.id };
        } catch (error) {
            this.bot.logger.error('Error creating settings panel:', error);
            return { success: false, error: error.message };
        }
    }

    // Create category-specific settings panel
    async createCategoryPanel(channel, category, settings) {
        const guild = channel.guild;

        try {
            let embed, components;

            switch (category) {
                case 'security':
                    ({ embed, components } = this.createSecurityPanel(settings));
                    break;
                case 'analytics':
                    ({ embed, components } = this.createAnalyticsPanel(settings));
                    break;
                case 'tickets':
                    ({ embed, components } = this.createTicketsPanel(settings));
                    break;
                case 'logging':
                    ({ embed, components } = this.createLoggingPanel(settings));
                    break;
                case 'dashboard':
                    ({ embed, components } = this.createDashboardPanel(settings));
                    break;
                default:
                    return { success: false, error: 'Invalid category' };
            }

            const message = await channel.send({ embeds: [embed], components });
            return { success: true, messageId: message.id };
        } catch (error) {
            this.bot.logger.error('Error creating category panel:', error);
            return { success: false, error: error.message };
        }
    }

    // Create security settings panel
    createSecurityPanel(settings) {
        const embed = new EmbedBuilder()
            .setTitle('🛡️ Security Settings')
            .setDescription('Configure your server\'s security and protection systems.')
            .addFields([
                {
                    name: '🚫 Anti-Spam',
                    value: `**Enabled:** ${settings.antiSpam.enabled ? 'Yes' : 'No'}
**Max Messages:** ${settings.antiSpam.maxMessages}
**Time Window:** ${settings.antiSpam.timeWindow}s
**Mute Duration:** ${settings.antiSpam.muteTime}s`,
                    inline: true
                },
                {
                    name: '⚡ Anti-Raid',
                    value: `**Enabled:** ${settings.antiRaid.enabled ? 'Yes' : 'No'}
**Join Threshold:** ${settings.antiRaid.joinThreshold}
**Time Window:** ${settings.antiRaid.timeWindow}s
**Action:** ${settings.antiRaid.actionType}`,
                    inline: true
                },
                {
                    name: '🎣 Anti-Phishing',
                    value: `**Enabled:** ${settings.antiPhishing.enabled ? 'Yes' : 'No'}
**Check Links:** ${settings.antiPhishing.checkLinks ? 'Yes' : 'No'}
**Strict Mode:** ${settings.antiPhishing.strictMode ? 'Yes' : 'No'}
**Action:** ${settings.antiPhishing.actionType}`,
                    inline: true
                },
                {
                    name: '🤖 AutoMod',
                    value: `**Enabled:** ${settings.automod.enabled ? 'Yes' : 'No'}
**Filter Profanity:** ${settings.automod.filterProfanity ? 'Yes' : 'No'}
**Filter Invites:** ${settings.automod.filterInvites ? 'Yes' : 'No'}
**Filter Caps:** ${settings.automod.filterCaps ? 'Yes' : 'No'}`,
                    inline: true
                }
            ])
            .setColor(0xff0000);

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('toggle_security_antispam')
                    .setLabel(`Anti-Spam: ${settings.antiSpam.enabled ? 'ON' : 'OFF'}`)
                    .setStyle(settings.antiSpam.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('toggle_security_antiraid')
                    .setLabel(`Anti-Raid: ${settings.antiRaid.enabled ? 'ON' : 'OFF'}`)
                    .setStyle(settings.antiRaid.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('toggle_security_antiphishing')
                    .setLabel(`Anti-Phishing: ${settings.antiPhishing.enabled ? 'ON' : 'OFF'}`)
                    .setStyle(settings.antiPhishing.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
            );

        const buttons2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('toggle_security_automod')
                    .setLabel(`AutoMod: ${settings.automod.enabled ? 'ON' : 'OFF'}`)
                    .setStyle(settings.automod.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('configure_security_thresholds')
                    .setLabel('Configure Thresholds')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('settings_back')
                    .setLabel('Back to Main')
                    .setStyle(ButtonStyle.Secondary)
            );

        return { embed, components: [buttons, buttons2] };
    }

    // Create analytics settings panel
    createAnalyticsPanel(settings) {
        const embed = new EmbedBuilder()
            .setTitle('📊 Analytics Settings')
            .setDescription('Configure data collection and analytics tracking.')
            .addFields([
                {
                    name: '📈 Tracking Options',
                    value: `**Messages:** ${settings.trackMessages ? '✅' : '❌'}
**Commands:** ${settings.trackCommands ? '✅' : '❌'}
**Voice Activity:** ${settings.trackVoice ? '✅' : '❌'}
**Reactions:** ${settings.trackReactions ? '✅' : '❌'}
**Joins/Leaves:** ${settings.trackJoinsLeaves ? '✅' : '❌'}`,
                    inline: true
                },
                {
                    name: '⚙️ Configuration',
                    value: `**Data Retention:** ${settings.retentionDays} days
**Detailed Logging:** ${settings.detailedLogging ? 'Enabled' : 'Disabled'}
**System Status:** ${settings.enabled ? 'Active' : 'Inactive'}`,
                    inline: true
                }
            ])
            .setColor(0x00aa00);

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('toggle_analytics_enabled')
                    .setLabel(`Analytics: ${settings.enabled ? 'ON' : 'OFF'}`)
                    .setStyle(settings.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('configure_analytics_tracking')
                    .setLabel('Configure Tracking')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('view_analytics_data')
                    .setLabel('View Data')
                    .setStyle(ButtonStyle.Secondary)
            );

        const buttons2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('configure_analytics_retention')
                    .setLabel('Data Retention')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('export_analytics_data')
                    .setLabel('Export Data')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('settings_back')
                    .setLabel('Back to Main')
                    .setStyle(ButtonStyle.Secondary)
            );

        return { embed, components: [buttons, buttons2] };
    }

    // Handle settings interactions
    async handleSettingsInteraction(interaction) {
        if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

        try {
            const customId = interaction.customId;
            const guild = interaction.guild;

            if (customId === 'settings_category_select') {
                const category = interaction.values[0];
                const settings = await this.getSettings(guild.id, category);
                const { embed, components } = this.createCategoryPanel(interaction.channel, category, settings);
                await interaction.update({ embeds: [embed], components });
            } else if (customId === 'settings_back') {
                await this.createSettingsPanel(interaction.channel);
                await interaction.update({ embeds: [], components: [] });
            } else if (customId.startsWith('toggle_')) {
                await this.handleToggleSetting(interaction, customId);
            } else if (customId.startsWith('configure_')) {
                await this.handleConfigureSetting(interaction, customId);
            }
        } catch (error) {
            this.bot.logger.error('Error handling settings interaction:', error);
            await interaction.reply({
                content: '❌ An error occurred while updating settings.',
                ephemeral: true
            });
        }
    }

    // Handle toggle settings
    async handleToggleSetting(interaction, customId) {
        const [, category, setting] = customId.split('_');
        const guild = interaction.guild;
        const currentSettings = await this.getSettings(guild.id, category);

        if (setting === 'enabled') {
            currentSettings.enabled = !currentSettings.enabled;
        } else {
            currentSettings[setting].enabled = !currentSettings[setting].enabled;
        }

        const result = await this.updateSettings(guild.id, category, currentSettings);
        
        if (result.success) {
            // Update the panel
            const { embed, components } = this.createCategoryPanel(interaction.channel, category, currentSettings);
            await interaction.update({ embeds: [embed], components });
        } else {
            await interaction.reply({
                content: '❌ Failed to update settings.',
                ephemeral: true
            });
        }
    }

    // Get setting value by path
    getSetting(guildId, path) {
        // This would be used by other components to get specific settings
        // Example: getSetting(guildId, 'security.antiSpam.enabled')
        return this.getSettings(guildId).then(settings => {
            return path.split('.').reduce((obj, key) => obj && obj[key], settings);
        });
    }

    // Apply settings changes to live modules immediately
    async applySettingsLive(guildId, category, settings) {
        try {
            switch (category) {
                case 'security':
                    if (this.bot.antiSpam) this.bot.antiSpam.updateConfig(guildId, settings.antiSpam);
                    if (this.bot.antiRaid) this.bot.antiRaid.updateConfig(guildId, settings.antiRaid);
                    if (this.bot.antiPhishing) this.bot.antiPhishing.updateConfig(guildId, settings.antiPhishing);
                    break;
                
                case 'analytics':
                    if (this.bot.analyticsManager) this.bot.analyticsManager.updateConfig(guildId, settings);
                    break;
                
                case 'tickets':
                    if (this.bot.enhancedTicketManager) this.bot.enhancedTicketManager.updateConfig(guildId, settings);
                    break;
                
                case 'logging':
                    // Update logging configuration
                    this.bot.logger.info(`📝 Logging settings updated for guild ${guildId}`);
                    break;
                
                case 'dashboard':
                    if (this.bot.dashboard) this.bot.dashboard.updateConfig(guildId, settings);
                    break;
            }
            
            this.bot.logger.info(`✅ Live settings applied for ${category} in guild ${guildId}`);
        } catch (error) {
            this.bot.logger.error('Error applying live settings:', error);
        }
    }

    // Subscribe to settings changes
    onSettingsChange(guildId, callback) {
        const listener = (data) => {
            if (data.guildId === guildId) {
                callback(data);
            }
        };
        this.on('settingsUpdated', listener);
        
        if (!this.activeListeners.has(guildId)) {
            this.activeListeners.set(guildId, []);
        }
        this.activeListeners.get(guildId).push(listener);
        
        return () => this.removeListener('settingsUpdated', listener);
    }
}

module.exports = SettingsManager;