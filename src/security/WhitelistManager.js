const { EmbedBuilder, PermissionsBitField } = require('discord.js');

/**
 * Comprehensive Whitelist System
 * Allows trusted entities to bypass security layers
 */
class WhitelistManager {
    constructor(database, client) {
        this.db = database;
        this.client = client;
        this.cache = new Map(); // Cache whitelists per guild
    }

    /**
     * Add entity to whitelist
     */
    async addToWhitelist(guildId, type, targetId, targetName, addedBy, reason, options = {}) {
        const {
            bypassAntispam = true,
            bypassAntinuke = true,
            bypassAntiraid = true,
            bypassVerification = true,
            expiresAt = null
        } = options;

        try {
            await this.db.run(`
                INSERT OR REPLACE INTO whitelists (
                    guild_id, whitelist_type, target_id, target_name,
                    added_by, reason,
                    bypass_antispam, bypass_antinuke, bypass_antiraid, bypass_verification,
                    expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                guildId, type, targetId, targetName,
                addedBy, reason,
                bypassAntispam ? 1 : 0,
                bypassAntinuke ? 1 : 0,
                bypassAntiraid ? 1 : 0,
                bypassVerification ? 1 : 0,
                expiresAt
            ]);

            // Clear cache for this guild
            this.cache.delete(guildId);

            console.log(`✅ Added ${type} ${targetId} to whitelist in guild ${guildId}`);
            return { success: true };
        } catch (error) {
            console.error('Failed to add to whitelist:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove from whitelist
     */
    async removeFromWhitelist(guildId, type, targetId) {
        try {
            await this.db.run(`
                DELETE FROM whitelists
                WHERE guild_id = ? AND whitelist_type = ? AND target_id = ?
            `, [guildId, type, targetId]);

            // Clear cache
            this.cache.delete(guildId);

            console.log(`✅ Removed ${type} ${targetId} from whitelist in guild ${guildId}`);
            return { success: true };
        } catch (error) {
            console.error('Failed to remove from whitelist:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if entity is whitelisted
     */
    async isWhitelisted(guildId, type, targetId, layer = null) {
        const whitelist = await this.getWhitelist(guildId, type, targetId);
        
        if (!whitelist) return false;
        if (!whitelist.active) return false;
        
        // Check expiration
        if (whitelist.expires_at) {
            const expiresAt = new Date(whitelist.expires_at);
            if (expiresAt < new Date()) {
                await this.removeFromWhitelist(guildId, type, targetId);
                return false;
            }
        }

        // Check specific layer bypass
        if (layer) {
            switch (layer) {
                case 'antispam':
                    return whitelist.bypass_antispam === 1;
                case 'antinuke':
                    return whitelist.bypass_antinuke === 1;
                case 'antiraid':
                    return whitelist.bypass_antiraid === 1;
                case 'verification':
                    return whitelist.bypass_verification === 1;
                default:
                    return true;
            }
        }

        return true;
    }

    /**
     * Get whitelist entry
     */
    async getWhitelist(guildId, type, targetId) {
        return await this.db.get(`
            SELECT * FROM whitelists
            WHERE guild_id = ? AND whitelist_type = ? AND target_id = ? AND active = 1
        `, [guildId, type, targetId]);
    }

    /**
     * Get all whitelists for a guild
     */
    async getAllWhitelists(guildId, type = null) {
        let query = `SELECT * FROM whitelists WHERE guild_id = ? AND active = 1`;
        const params = [guildId];

        if (type) {
            query += ' AND whitelist_type = ?';
            params.push(type);
        }

        query += ' ORDER BY created_at DESC';

        return await this.db.all(query, params);
    }

    /**
     * Whitelist a role (all members bypass protections)
     */
    async whitelistRole(guild, roleId, addedBy, reason = 'Trusted role') {
        const role = guild.roles.cache.get(roleId);
        if (!role) {
            return { success: false, error: 'Role not found' };
        }

        return await this.addToWhitelist(
            guild.id,
            'role',
            roleId,
            role.name,
            addedBy,
            reason
        );
    }

    /**
     * Whitelist a user
     */
    async whitelistUser(guild, userId, addedBy, reason = 'Trusted user') {
        const member = await guild.members.fetch(userId).catch(() => null);
        const userName = member ? member.user.tag : userId;

        return await this.addToWhitelist(
            guild.id,
            'user',
            userId,
            userName,
            addedBy,
            reason
        );
    }

    /**
     * Whitelist a channel
     */
    async whitelistChannel(guild, channelId, addedBy, reason = 'Trusted channel') {
        const channel = guild.channels.cache.get(channelId);
        if (!channel) {
            return { success: false, error: 'Channel not found' };
        }

        return await this.addToWhitelist(
            guild.id,
            'channel',
            channelId,
            channel.name,
            addedBy,
            reason
        );
    }

    /**
     * Whitelist a bot
     */
    async whitelistBot(guild, botId, addedBy, reason = 'Trusted bot') {
        const bot = await guild.members.fetch(botId).catch(() => null);
        if (!bot || !bot.user.bot) {
            return { success: false, error: 'Bot not found' };
        }

        return await this.addToWhitelist(
            guild.id,
            'bot',
            botId,
            bot.user.tag,
            addedBy,
            reason
        );
    }

    /**
     * Check if user has whitelisted role
     */
    async hasWhitelistedRole(guildId, member) {
        const whitelists = await this.getAllWhitelists(guildId, 'role');
        
        for (const whitelist of whitelists) {
            if (member.roles.cache.has(whitelist.target_id)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if user bypasses a specific layer
     */
    async bypassesLayer(guild, member, layer) {
        // Check user whitelist
        if (await this.isWhitelisted(guild.id, 'user', member.id, layer)) {
            return true;
        }

        // Check bot whitelist
        if (member.user.bot && await this.isWhitelisted(guild.id, 'bot', member.id, layer)) {
            return true;
        }

        // Check role whitelist
        if (await this.hasWhitelistedRole(guild.id, member)) {
            return true;
        }

        // Check if user has admin permissions (always bypass)
        if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return true;
        }

        return false;
    }

    /**
     * Check if action should bypass security
     */
    async shouldBypassSecurity(guild, member, channel = null, layer = null) {
        // Check member whitelist
        if (await this.bypassesLayer(guild, member, layer)) {
            return true;
        }

        // Check channel whitelist
        if (channel && await this.isWhitelisted(guild.id, 'channel', channel.id, layer)) {
            return true;
        }

        return false;
    }

    /**
     * Get whitelist statistics
     */
    async getWhitelistStats(guildId) {
        const stats = await this.db.get(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN whitelist_type = 'user' THEN 1 ELSE 0 END) as users,
                SUM(CASE WHEN whitelist_type = 'role' THEN 1 ELSE 0 END) as roles,
                SUM(CASE WHEN whitelist_type = 'channel' THEN 1 ELSE 0 END) as channels,
                SUM(CASE WHEN whitelist_type = 'bot' THEN 1 ELSE 0 END) as bots
            FROM whitelists
            WHERE guild_id = ? AND active = 1
        `, [guildId]);

        return stats || { total: 0, users: 0, roles: 0, channels: 0, bots: 0 };
    }

    /**
     * Clean up expired whitelists
     */
    async cleanupExpired() {
        await this.db.run(`
            UPDATE whitelists
            SET active = 0
            WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
        `);

        this.cache.clear();
    }

    /**
     * Generate whitelist embed for display
     */
    async generateWhitelistEmbed(guild) {
        const whitelists = await this.getAllWhitelists(guild.id);
        const stats = await this.getWhitelistStats(guild.id);

        const embed = new EmbedBuilder()
            .setTitle('🔓 Server Whitelist')
            .setDescription(`Total whitelisted entities: **${stats.total}**`)
            .setColor(0x00FF00)
            .setTimestamp();

        if (stats.users > 0) {
            const users = whitelists.filter(w => w.whitelist_type === 'user').slice(0, 10);
            embed.addFields({
                name: `👥 Whitelisted Users (${stats.users})`,
                value: users.map(w => `• ${w.target_name} - ${w.reason}`).join('\n') || 'None',
                inline: false
            });
        }

        if (stats.roles > 0) {
            const roles = whitelists.filter(w => w.whitelist_type === 'role').slice(0, 10);
            embed.addFields({
                name: `🎭 Whitelisted Roles (${stats.roles})`,
                value: roles.map(w => `• ${w.target_name} - ${w.reason}`).join('\n') || 'None',
                inline: false
            });
        }

        if (stats.channels > 0) {
            const channels = whitelists.filter(w => w.whitelist_type === 'channel').slice(0, 10);
            embed.addFields({
                name: `📝 Whitelisted Channels (${stats.channels})`,
                value: channels.map(w => `• ${w.target_name} - ${w.reason}`).join('\n') || 'None',
                inline: false
            });
        }

        if (stats.bots > 0) {
            const bots = whitelists.filter(w => w.whitelist_type === 'bot').slice(0, 10);
            embed.addFields({
                name: `🤖 Whitelisted Bots (${stats.bots})`,
                value: bots.map(w => `• ${w.target_name} - ${w.reason}`).join('\n') || 'None',
                inline: false
            });
        }

        return embed;
    }
}

module.exports = WhitelistManager;
