/**
 * Guild Settings Routes
 * Handles guild configuration, feature toggles, and settings management
 */

const express = require('express');
const { t } = require('../../../locale');

class GuildRoutes {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.bot = dashboard.bot;
        this.router = express.Router();
        
        this.setupRoutes();
    }

    setupRoutes() {
        const auth = this.dashboard.middleware.authenticateToken.bind(this.dashboard.middleware);
        const guildAccess = this.dashboard.middleware.requireGuildAccess.bind(this.dashboard.middleware);

        // Get list of user's guilds
        this.router.get('/list', auth, this.getGuildList.bind(this));
        
        // Get guild configuration
        this.router.get('/:guildId/config', auth, guildAccess, this.getGuildConfig.bind(this));
        
        // Update guild configuration
        this.router.post('/:guildId/config', auth, guildAccess, this.updateGuildConfig.bind(this));
        
        // Get guild statistics
        this.router.get('/:guildId/stats', auth, guildAccess, this.getGuildStats.bind(this));
        
        // Get guild channels
        this.router.get('/:guildId/channels', auth, guildAccess, this.getGuildChannels.bind(this));
        
        // Get guild roles
        this.router.get('/:guildId/roles', auth, guildAccess, this.getGuildRoles.bind(this));
        
        // Feature toggles
        this.router.post('/:guildId/features', auth, guildAccess, this.updateFeatures.bind(this));
        this.router.get('/:guildId/features', auth, guildAccess, this.getFeatures.bind(this));
        
        // Security settings
        this.router.get('/:guildId/security', auth, guildAccess, this.getSecuritySettings.bind(this));
        this.router.post('/:guildId/security', auth, guildAccess, this.updateSecuritySettings.bind(this));
        
        // Verification settings
        this.router.get('/:guildId/verification', auth, guildAccess, this.getVerificationSettings.bind(this));
        this.router.post('/:guildId/verification', auth, guildAccess, this.updateVerificationSettings.bind(this));
    }

    /**
     * Get list of guilds user has access to
     */
    async getGuildList(req, res) {
        try {
            const session = this.dashboard.getSession(req.user.sessionId);
            const botGuilds = this.bot.client.guilds.cache;
            
            const guilds = [];
            
            for (const guildId of (session?.guilds || [])) {
                const guild = botGuilds.get(guildId);
                if (guild) {
                    guilds.push({
                        id: guild.id,
                        name: guild.name,
                        icon: guild.iconURL({ size: 128 }),
                        memberCount: guild.memberCount,
                        owner: guild.ownerId === req.user.userId
                    });
                }
            }

            res.json({ guilds });
        } catch (error) {
            this.bot.logger?.error('Error getting guild list:', error);
            res.status(500).json({ error: 'Failed to get guild list' });
        }
    }

    /**
     * Get guild configuration
     */
    async getGuildConfig(req, res) {
        try {
            const { guildId } = req.params;
            const config = await this.bot.database.getGuildConfig(guildId);
            const guild = this.bot.client.guilds.cache.get(guildId);

            res.json({
                guildId,
                guildName: guild?.name,
                guildIcon: guild?.iconURL({ size: 128 }),
                memberCount: guild?.memberCount,
                config: this.sanitizeConfig(config)
            });
        } catch (error) {
            this.bot.logger?.error('Error getting guild config:', error);
            res.status(500).json({ error: 'Failed to get configuration' });
        }
    }

    /**
     * Update guild configuration
     */
    async updateGuildConfig(req, res) {
        try {
            const { guildId } = req.params;
            const updates = req.body;

            // Validate and sanitize updates
            const allowedFields = [
                'welcome_enabled', 'welcome_channel', 'welcome_message',
                'goodbye_enabled', 'goodbye_channel', 'goodbye_message',
                'mod_log_channel', 'log_channel_id', 'alert_channel',
                'mod_role_id', 'admin_role_id',
                'language'
            ];

            const sanitizedUpdates = {};
            for (const [key, value] of Object.entries(updates)) {
                if (allowedFields.includes(key)) {
                    sanitizedUpdates[key] = value;
                }
            }

            if (Object.keys(sanitizedUpdates).length === 0) {
                return res.status(400).json({ error: 'No valid fields to update' });
            }

            await this.bot.database.updateGuildConfig(guildId, sanitizedUpdates);
            
            // Emit setting change event
            if (typeof this.bot.emitSettingChange === 'function') {
                for (const [key, value] of Object.entries(sanitizedUpdates)) {
                    await this.bot.emitSettingChange(guildId, req.user.userId, key, value);
                }
            }

            res.json({ success: true, message: 'Configuration updated' });
        } catch (error) {
            this.bot.logger?.error('Error updating guild config:', error);
            res.status(500).json({ error: 'Failed to update configuration' });
        }
    }

    /**
     * Get guild statistics
     */
    async getGuildStats(req, res) {
        try {
            const { guildId } = req.params;
            const guild = this.bot.client.guilds.cache.get(guildId);

            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            // Get various stats
            const [
                warningCount,
                ticketCount,
                incidentCount,
                verificationCount
            ] = await Promise.all([
                this.bot.database.get(
                    'SELECT COUNT(*) as count FROM warnings WHERE guild_id = ?', [guildId]
                ).catch(() => ({ count: 0 })),
                this.bot.database.get(
                    'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ?', [guildId]
                ).catch(() => ({ count: 0 })),
                this.bot.database.get(
                    'SELECT COUNT(*) as count FROM security_incidents WHERE guild_id = ?', [guildId]
                ).catch(() => ({ count: 0 })),
                this.bot.database.get(
                    'SELECT COUNT(*) as count FROM verification_queue WHERE guild_id = ?', [guildId]
                ).catch(() => ({ count: 0 }))
            ]);

            res.json({
                members: {
                    total: guild.memberCount,
                    online: guild.members.cache.filter(m => m.presence?.status === 'online').size,
                    bots: guild.members.cache.filter(m => m.user.bot).size
                },
                channels: {
                    total: guild.channels.cache.size,
                    text: guild.channels.cache.filter(c => c.type === 0).size,
                    voice: guild.channels.cache.filter(c => c.type === 2).size
                },
                moderation: {
                    warnings: warningCount?.count || 0,
                    tickets: ticketCount?.count || 0,
                    incidents: incidentCount?.count || 0
                },
                verification: {
                    pending: verificationCount?.count || 0
                },
                createdAt: guild.createdAt
            });
        } catch (error) {
            this.bot.logger?.error('Error getting guild stats:', error);
            res.status(500).json({ error: 'Failed to get statistics' });
        }
    }

    /**
     * Get guild channels for dropdowns
     */
    async getGuildChannels(req, res) {
        try {
            const { guildId } = req.params;
            const { type } = req.query;
            const guild = this.bot.client.guilds.cache.get(guildId);

            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            let channels = guild.channels.cache;
            
            if (type === 'text') {
                channels = channels.filter(c => c.type === 0);
            } else if (type === 'voice') {
                channels = channels.filter(c => c.type === 2);
            } else if (type === 'category') {
                channels = channels.filter(c => c.type === 4);
            }

            const channelList = channels.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                parentId: c.parentId
            })).sort((a, b) => a.name.localeCompare(b.name));

            res.json({ channels: channelList });
        } catch (error) {
            this.bot.logger?.error('Error getting guild channels:', error);
            res.status(500).json({ error: 'Failed to get channels' });
        }
    }

    /**
     * Get guild roles for dropdowns
     */
    async getGuildRoles(req, res) {
        try {
            const { guildId } = req.params;
            const guild = this.bot.client.guilds.cache.get(guildId);

            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            const roles = guild.roles.cache
                .filter(r => !r.managed && r.id !== guild.id)
                .map(r => ({
                    id: r.id,
                    name: r.name,
                    color: r.hexColor,
                    position: r.position,
                    permissions: r.permissions.bitfield.toString()
                }))
                .sort((a, b) => b.position - a.position);

            res.json({ roles });
        } catch (error) {
            this.bot.logger?.error('Error getting guild roles:', error);
            res.status(500).json({ error: 'Failed to get roles' });
        }
    }

    /**
     * Get feature toggles
     */
    async getFeatures(req, res) {
        try {
            const { guildId } = req.params;
            const config = await this.bot.database.getGuildConfig(guildId);

            res.json({
                features: {
                    antiraid: !!config?.antiraid_enabled,
                    antispam: !!config?.antispam_enabled,
                    antinuke: !!config?.antinuke_enabled,
                    antiphishing: !!config?.antiphishing_enabled,
                    antilinks: !!config?.anti_links_enabled,
                    verification: !!config?.verification_enabled,
                    welcome: !!config?.welcome_enabled,
                    tickets: !!config?.tickets_enabled,
                    automod: !!config?.auto_mod_enabled,
                    autorole: !!config?.autorole_enabled,
                    wordFilter: !!config?.word_filter_enabled,
                    altDetection: !!config?.alt_detection_enabled,
                    modmail: !!config?.modmail_enabled
                }
            });
        } catch (error) {
            this.bot.logger?.error('Error getting features:', error);
            res.status(500).json({ error: 'Failed to get features' });
        }
    }

    /**
     * Update feature toggles
     */
    async updateFeatures(req, res) {
        try {
            const { guildId } = req.params;
            const { feature, enabled } = req.body;

            const featureMap = {
                antiraid: 'antiraid_enabled',
                antispam: 'antispam_enabled',
                antinuke: 'antinuke_enabled',
                antiphishing: 'antiphishing_enabled',
                antilinks: 'anti_links_enabled',
                verification: 'verification_enabled',
                welcome: 'welcome_enabled',
                tickets: 'tickets_enabled',
                automod: 'auto_mod_enabled',
                autorole: 'autorole_enabled',
                wordFilter: 'word_filter_enabled',
                altDetection: 'alt_detection_enabled',
                modmail: 'modmail_enabled'
            };

            const dbField = featureMap[feature];
            if (!dbField) {
                return res.status(400).json({ error: 'Invalid feature' });
            }

            await this.bot.database.updateGuildConfig(guildId, {
                [dbField]: enabled ? 1 : 0
            });

            // Emit setting change
            if (typeof this.bot.emitSettingChange === 'function') {
                await this.bot.emitSettingChange(guildId, req.user.userId, dbField, enabled ? 1 : 0);
            }

            res.json({ success: true, feature, enabled });
        } catch (error) {
            this.bot.logger?.error('Error updating feature:', error);
            res.status(500).json({ error: 'Failed to update feature' });
        }
    }

    /**
     * Get security settings
     */
    async getSecuritySettings(req, res) {
        try {
            const { guildId } = req.params;
            const config = await this.bot.database.getGuildConfig(guildId);

            res.json({
                antiraid: {
                    enabled: !!config?.antiraid_enabled,
                    threshold: config?.raid_threshold || 10,
                    lockdownDuration: config?.raid_lockdown_duration_ms || 600000,
                    accountAgeHours: config?.account_age_hours || 24
                },
                antispam: {
                    enabled: !!config?.antispam_enabled,
                    threshold: config?.spam_threshold || 5,
                    action: config?.spam_action || 'delete',
                    floodMid: config?.antispam_flood_mid || 8,
                    floodHigh: config?.antispam_flood_high || 12,
                    duplicateMid: config?.antispam_duplicate_mid || 3,
                    duplicateHigh: config?.antispam_duplicate_high || 5
                },
                antinuke: {
                    enabled: !!config?.antinuke_enabled,
                    roleLimit: config?.antinuke_role_limit || 3,
                    channelLimit: config?.antinuke_channel_limit || 3,
                    banLimit: config?.antinuke_ban_limit || 5,
                    punishment: config?.antinuke_punishment || 'kick',
                    whitelist: this.parseJSON(config?.antinuke_whitelist, [])
                }
            });
        } catch (error) {
            this.bot.logger?.error('Error getting security settings:', error);
            res.status(500).json({ error: 'Failed to get security settings' });
        }
    }

    /**
     * Update security settings
     */
    async updateSecuritySettings(req, res) {
        try {
            const { guildId } = req.params;
            const { section, settings } = req.body;

            const updates = {};

            if (section === 'antiraid') {
                if (settings.enabled !== undefined) updates.antiraid_enabled = settings.enabled ? 1 : 0;
                if (settings.threshold !== undefined) updates.raid_threshold = parseInt(settings.threshold);
                if (settings.lockdownDuration !== undefined) updates.raid_lockdown_duration_ms = parseInt(settings.lockdownDuration);
                if (settings.accountAgeHours !== undefined) updates.account_age_hours = parseInt(settings.accountAgeHours);
            } else if (section === 'antispam') {
                if (settings.enabled !== undefined) updates.antispam_enabled = settings.enabled ? 1 : 0;
                if (settings.threshold !== undefined) updates.spam_threshold = parseInt(settings.threshold);
                if (settings.action !== undefined) updates.spam_action = settings.action;
            } else if (section === 'antinuke') {
                if (settings.enabled !== undefined) updates.antinuke_enabled = settings.enabled ? 1 : 0;
                if (settings.roleLimit !== undefined) updates.antinuke_role_limit = parseInt(settings.roleLimit);
                if (settings.channelLimit !== undefined) updates.antinuke_channel_limit = parseInt(settings.channelLimit);
                if (settings.punishment !== undefined) updates.antinuke_punishment = settings.punishment;
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'No valid settings to update' });
            }

            await this.bot.database.updateGuildConfig(guildId, updates);

            res.json({ success: true, message: 'Security settings updated' });
        } catch (error) {
            this.bot.logger?.error('Error updating security settings:', error);
            res.status(500).json({ error: 'Failed to update security settings' });
        }
    }

    /**
     * Get verification settings
     */
    async getVerificationSettings(req, res) {
        try {
            const { guildId } = req.params;
            const config = await this.bot.database.getGuildConfig(guildId);

            res.json({
                enabled: !!config?.verification_enabled,
                method: config?.verification_method || 'auto',
                profile: config?.verification_profile || 'standard',
                channelId: config?.verification_channel_id,
                verifiedRoleId: config?.verified_role_id,
                unverifiedRoleId: config?.unverified_role_id,
                minAccountAgeDays: config?.verification_min_account_age_days || 0,
                autoKickUnverified: !!config?.auto_kick_unverified,
                manualApproval: !!config?.manual_approval_enabled
            });
        } catch (error) {
            this.bot.logger?.error('Error getting verification settings:', error);
            res.status(500).json({ error: 'Failed to get verification settings' });
        }
    }

    /**
     * Update verification settings
     */
    async updateVerificationSettings(req, res) {
        try {
            const { guildId } = req.params;
            const settings = req.body;

            const updates = {};
            
            if (settings.enabled !== undefined) updates.verification_enabled = settings.enabled ? 1 : 0;
            if (settings.method) updates.verification_method = settings.method;
            if (settings.profile) updates.verification_profile = settings.profile;
            if (settings.channelId) updates.verification_channel_id = settings.channelId;
            if (settings.verifiedRoleId) updates.verified_role_id = settings.verifiedRoleId;
            if (settings.unverifiedRoleId) updates.unverified_role_id = settings.unverifiedRoleId;
            if (settings.minAccountAgeDays !== undefined) {
                updates.verification_min_account_age_days = parseInt(settings.minAccountAgeDays);
            }
            if (settings.autoKickUnverified !== undefined) {
                updates.auto_kick_unverified = settings.autoKickUnverified ? 1 : 0;
            }

            await this.bot.database.updateGuildConfig(guildId, updates);

            res.json({ success: true, message: 'Verification settings updated' });
        } catch (error) {
            this.bot.logger?.error('Error updating verification settings:', error);
            res.status(500).json({ error: 'Failed to update verification settings' });
        }
    }

    /**
     * Sanitize config to remove sensitive data
     */
    sanitizeConfig(config) {
        if (!config) return {};
        
        const sanitized = { ...config };
        
        // Remove internal fields
        delete sanitized.created_at;
        delete sanitized.updated_at;
        
        return sanitized;
    }

    /**
     * Safely parse JSON
     */
    parseJSON(str, defaultValue) {
        try {
            return JSON.parse(str);
        } catch {
            return defaultValue;
        }
    }

    getRouter() {
        return this.router;
    }
}

module.exports = GuildRoutes;
