/**
 * Settings Routes
 * Handles guild configuration, feature toggles, and admin settings
 */

const express = require('express');

/**
 * Create settings routes
 * @param {Object} dashboard - Dashboard instance
 */
function createSettingsRoutes(dashboard) {
    const router = express.Router();
    const authenticateToken = dashboard.authenticateToken.bind(dashboard);
    const validateCSRF = dashboard.validateCSRF.bind(dashboard);

    /**
     * Get guild settings
     */
    router.get('/guilds/:guildId/settings', authenticateToken, async (req, res) => {
        try {
            const { guildId } = req.params;
            
            const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'No access to this guild' });
            }

            const settings = await dashboard.bot.database.getGuildConfig(guildId);
            res.json(settings || {});
        } catch (error) {
            dashboard.bot.logger?.error('[Settings] Failed to get settings:', error);
            res.status(500).json({ error: 'Failed to retrieve settings' });
        }
    });

    /**
     * Update guild settings
     */
    router.put('/guilds/:guildId/settings', authenticateToken, validateCSRF, async (req, res) => {
        try {
            const { guildId } = req.params;
            const updates = req.body;

            const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'No access to this guild' });
            }

            // Validate settings before saving
            const validation = validateSettings(updates);
            if (!validation.valid) {
                return res.status(400).json({ error: validation.error });
            }

            await dashboard.bot.database.updateGuildConfig(guildId, updates);

            // Log the change
            if (dashboard.bot.logger) {
                await dashboard.bot.logger.logDashboardAction({
                    adminId: req.user.userId,
                    adminTag: req.user.username,
                    guildId,
                    eventType: 'settings_update',
                    afterData: updates
                });
            }

            res.json({ success: true, message: 'Settings updated' });
        } catch (error) {
            dashboard.bot.logger?.error('[Settings] Failed to update:', error);
            res.status(500).json({ error: 'Failed to update settings' });
        }
    });

    /**
     * Get feature toggles for a guild
     */
    router.get('/guilds/:guildId/features', authenticateToken, async (req, res) => {
        try {
            const { guildId } = req.params;

            const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'No access to this guild' });
            }

            const config = await dashboard.bot.database.getGuildConfig(guildId);
            
            // Use explicit boolean conversion - 1 = enabled, 0/null/undefined = disabled
            // This ensures OFF settings stay OFF (fixes ?? true bug that defaulted NULL to enabled)
            // FIXED: Use correct column names that actually exist in guild_configs table
            // Check BOTH column variants for compatibility (some features have duplicates)
            const features = {
                antiSpam: !!(config?.anti_spam_enabled || config?.antispam_enabled),
                antiRaid: !!(config?.anti_raid_enabled || config?.antiraid_enabled),
                antiNuke: !!config?.antinuke_enabled, // FIXED: was anti_nuke_enabled (phantom column)
                linkProtection: !!config?.anti_links_enabled, // FIXED: was link_protection_enabled (phantom)
                verification: !!config?.verification_enabled,
                logging: !!config?.logging_enabled,
                tickets: !!config?.tickets_enabled,
                welcomeMessages: !!config?.welcome_enabled,
                autoMod: !!(config?.auto_mod_enabled || config?.automod_enabled)
            };

            res.json({ features });
        } catch (error) {
            dashboard.bot.logger?.error('[Settings] Failed to get features:', error);
            res.status(500).json({ error: 'Failed to retrieve features' });
        }
    });

    /**
     * Toggle a feature for a guild
     */
    router.post('/guilds/:guildId/features/:feature', authenticateToken, validateCSRF, async (req, res) => {
        try {
            const { guildId, feature } = req.params;
            const { enabled } = req.body;

            const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'No access to this guild' });
            }

            // Map feature name to database column(s)
            // FIXED: Use correct column names that actually exist in guild_configs table
            // Some features write to BOTH columns for compatibility with different parts of codebase
            const featureMap = {
                antiSpam: ['anti_spam_enabled', 'antispam_enabled'], // Write to BOTH
                antiRaid: ['anti_raid_enabled', 'antiraid_enabled'], // Write to BOTH
                antiNuke: ['antinuke_enabled'], // FIXED: was anti_nuke_enabled (phantom)
                linkProtection: ['anti_links_enabled'], // FIXED: was link_protection_enabled (phantom)
                verification: ['verification_enabled'],
                logging: ['logging_enabled'],
                tickets: ['tickets_enabled'],
                welcomeMessages: ['welcome_enabled'],
                autoMod: ['auto_mod_enabled', 'automod_enabled'] // Write to BOTH
            };

            const columns = featureMap[feature];
            if (!columns) {
                return res.status(400).json({ error: `Unknown feature: ${feature}` });
            }

            // Build update object with all columns for this feature
            const updateData = {};
            for (const column of columns) {
                updateData[column] = enabled ? 1 : 0;
            }

            await dashboard.bot.database.updateGuildConfig(guildId, updateData);

            // Log the change
            if (dashboard.bot.logger) {
                await dashboard.bot.logger.logDashboardAction({
                    adminId: req.user.userId,
                    adminTag: req.user.username,
                    guildId,
                    eventType: 'feature_toggle',
                    afterData: { feature, enabled }
                });
            }

            res.json({ success: true, feature, enabled });
        } catch (error) {
            dashboard.bot.logger?.error('[Settings] Failed to toggle feature:', error);
            res.status(500).json({ error: 'Failed to toggle feature' });
        }
    });

    /**
     * Get moderation thresholds
     */
    router.get('/guilds/:guildId/thresholds', authenticateToken, async (req, res) => {
        try {
            const { guildId } = req.params;

            const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'No access to this guild' });
            }

            const config = await dashboard.bot.database.getGuildConfig(guildId);

            const thresholds = {
                spamMessageLimit: config?.spam_message_limit ?? 5,
                spamTimeWindow: config?.spam_time_window ?? 5000,
                raidJoinLimit: config?.raid_join_limit ?? 10,
                raidTimeWindow: config?.raid_time_window ?? 60000,
                mentionLimit: config?.mention_limit ?? 5,
                warningsForMute: config?.warnings_for_mute ?? 3,
                warningsForKick: config?.warnings_for_kick ?? 5,
                warningsForBan: config?.warnings_for_ban ?? 7
            };

            res.json({ thresholds });
        } catch (error) {
            dashboard.bot.logger?.error('[Settings] Failed to get thresholds:', error);
            res.status(500).json({ error: 'Failed to retrieve thresholds' });
        }
    });

    /**
     * Update moderation thresholds
     */
    router.put('/guilds/:guildId/thresholds', authenticateToken, validateCSRF, async (req, res) => {
        try {
            const { guildId } = req.params;
            const thresholds = req.body;

            const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'No access to this guild' });
            }

            // Validate thresholds
            const thresholdMap = {
                spamMessageLimit: 'spam_message_limit',
                spamTimeWindow: 'spam_time_window',
                raidJoinLimit: 'raid_join_limit',
                raidTimeWindow: 'raid_time_window',
                mentionLimit: 'mention_limit',
                warningsForMute: 'warnings_for_mute',
                warningsForKick: 'warnings_for_kick',
                warningsForBan: 'warnings_for_ban'
            };

            const updates = {};
            for (const [key, value] of Object.entries(thresholds)) {
                if (thresholdMap[key]) {
                    const numVal = parseInt(value, 10);
                    if (isNaN(numVal) || numVal < 0) {
                        return res.status(400).json({ error: `Invalid value for ${key}` });
                    }
                    updates[thresholdMap[key]] = numVal;
                }
            }

            await dashboard.bot.database.updateGuildConfig(guildId, updates);

            if (dashboard.bot.logger) {
                await dashboard.bot.logger.logDashboardAction({
                    adminId: req.user.userId,
                    adminTag: req.user.username,
                    guildId,
                    eventType: 'thresholds_update',
                    afterData: updates
                });
            }

            res.json({ success: true, message: 'Thresholds updated' });
        } catch (error) {
            dashboard.bot.logger?.error('[Settings] Failed to update thresholds:', error);
            res.status(500).json({ error: 'Failed to update thresholds' });
        }
    });

    /**
     * Export guild configuration
     */
    router.get('/guilds/:guildId/export', authenticateToken, async (req, res) => {
        try {
            const { guildId } = req.params;

            const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'No access to this guild' });
            }

            const config = await dashboard.bot.database.getGuildConfig(guildId);

            // Remove sensitive fields
            const exportData = { ...config };
            delete exportData.webhook_url;
            delete exportData.api_keys;

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="guild-${guildId}-config.json"`);
            res.json(exportData);
        } catch (error) {
            dashboard.bot.logger?.error('[Settings] Export failed:', error);
            res.status(500).json({ error: 'Failed to export configuration' });
        }
    });

    return router;
}

/**
 * Validate settings object
 */
function validateSettings(settings) {
    // Basic validation - ensure no SQL injection or invalid data
    const allowedKeys = [
        'prefix', 'language', 'timezone', 'log_channel', 'mod_role',
        'admin_role', 'mute_role', 'welcome_channel', 'welcome_message',
        'goodbye_channel', 'goodbye_message', 'auto_role'
    ];

    for (const key of Object.keys(settings)) {
        if (!allowedKeys.includes(key)) {
            // Allow feature toggles and threshold settings
            if (!key.endsWith('_enabled') && !key.includes('limit') && !key.includes('window')) {
                return { valid: false, error: `Unknown setting: ${key}` };
            }
        }
    }

    return { valid: true };
}

module.exports = createSettingsRoutes;
