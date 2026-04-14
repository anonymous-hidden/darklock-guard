/**
 * DiscordLogger — Event Logging System
 * 
 * Sends rich embeds to configured Discord channels when events happen:
 * - Message edits (log_edits toggle)
 * - Message deletes (log_deletes toggle)
 * - Member joins / leaves (log_members toggle)
 * - Role updates (log_roles toggle)
 * - Channel create/delete (log_channels toggle)
 * - Moderation actions to mod_log_channel
 * 
 * Channel resolution order:
 *   specialized channel → log_channel_id fallback
 * All channels come from guild_configs, toggles from guild_customization.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');

class DiscordLogger {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database;
        // Cache guild config + customization to avoid DB hammering
        this._configCache = new Map();   // guildId → { config, custom, expire }
        this.CACHE_TTL = 30 * 1000;      // 30 seconds
    }

    // ── Internal helpers ────────────────────────────────────────────────

    async _getGuildSettings(guildId) {
        const cached = this._configCache.get(guildId);
        if (cached && Date.now() < cached.expire) return cached;

        const config = await this.db.getGuildConfig(guildId).catch(() => ({})) || {};
        const custom = await this.db.get(
            'SELECT * FROM guild_customization WHERE guild_id = ?', [guildId]
        ).catch(() => null) || {};

        // Parse notification_settings JSON blob if present
        let notif = {};
        try {
            if (config.notification_settings) {
                notif = typeof config.notification_settings === 'string'
                    ? JSON.parse(config.notification_settings)
                    : config.notification_settings;
            }
        } catch (_) {}

        const result = { config, custom, notif, expire: Date.now() + this.CACHE_TTL };
        this._configCache.set(guildId, result);
        return result;
    }

    /** Resolve the best log channel for a given category */
    async _getLogChannel(guild, category = 'general') {
        const { config, notif } = await this._getGuildSettings(guild.id);

        const tryChannel = (id) => {
            if (!id) return null;
            const ch = guild.channels.cache.get(String(id));
            if (ch && ch.isTextBased() && ch.permissionsFor(guild.members.me)?.has('SendMessages')) return ch;
            return null;
        };

        // Category-specific channels (from notification_settings JSON)
        if (category === 'messages') {
            const ch = tryChannel(notif.message_log_channel);
            if (ch) return ch;
        }
        if (category === 'members') {
            const ch = tryChannel(notif.join_leave_channel);
            if (ch) return ch;
        }
        if (category === 'automod') {
            const ch = tryChannel(notif.automod_log_channel);
            if (ch) return ch;
        }
        if (category === 'mod') {
            const ch = tryChannel(config.mod_log_channel);
            if (ch) return ch;
        }
        if (category === 'server') {
            const ch = tryChannel(notif.server_changes_channel);
            if (ch) return ch;
        }

        // Fall back to the general log channel
        return tryChannel(config.log_channel_id);
    }

    async _send(guild, category, embed) {
        try {
            const channel = await this._getLogChannel(guild, category);
            if (!channel) return false;
            await channel.send({ embeds: [embed] });
            return true;
        } catch (err) {
            this.bot.logger?.debug(`[DiscordLogger] Failed to send ${category} log: ${err.message}`);
            return false;
        }
    }

    // ── Public logging methods ───────────────────────────────────────────

    /**
     * Log a deleted message
     */
    async logMessageDelete(message) {
        if (!message.guild || message.author?.bot) return;

        const { custom } = await this._getGuildSettings(message.guild.id);
        if (!custom.log_deletes && custom.log_deletes !== undefined) return;

        const content = message.content?.substring(0, 1024) || '*[No text content]*';
        const attachments = message.attachments?.size > 0
            ? [...message.attachments.values()].map(a => a.url).join('\n').substring(0, 512)
            : null;

        const embed = new EmbedBuilder()
            .setColor('#e74c3c')
            .setTitle('🗑️ Message Deleted')
            .addFields(
                { name: '👤 Author', value: message.author ? `${message.author.username}\n<@${message.author.id}>\n\`${message.author.id}\`` : '*Unknown*', inline: true },
                { name: '📍 Channel', value: `<#${message.channelId}>\n\`${message.channelId}\``, inline: true },
                { name: '📝 Content', value: content }
            )
            .setFooter({ text: `Message ID: ${message.id}` })
            .setTimestamp();

        if (message.author?.displayAvatarURL) {
            embed.setThumbnail(message.author.displayAvatarURL({ dynamic: true }));
        }
        if (attachments) {
            embed.addFields({ name: '📎 Attachments', value: attachments });
        }

        await this._send(message.guild, 'messages', embed);
    }

    /**
     * Log an edited message
     */
    async logMessageEdit(oldMessage, newMessage) {
        if (!newMessage.guild || newMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return;

        const { custom } = await this._getGuildSettings(newMessage.guild.id);
        if (!custom.log_edits && custom.log_edits !== undefined) return;

        const oldContent = oldMessage.content?.substring(0, 512) || '*[Content unavailable]*';
        const newContent = newMessage.content?.substring(0, 512) || '*[No content]*';

        const embed = new EmbedBuilder()
            .setColor('#f39c12')
            .setTitle('✏️ Message Edited')
            .addFields(
                { name: '👤 Author', value: `${newMessage.author.username}\n<@${newMessage.author.id}>`, inline: true },
                { name: '📍 Channel', value: `<#${newMessage.channelId}>`, inline: true },
                { name: '🔗 Jump to Message', value: `[Click here](${newMessage.url})`, inline: true },
                { name: '📝 Before', value: oldContent },
                { name: '📝 After', value: newContent }
            )
            .setThumbnail(newMessage.author.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `Message ID: ${newMessage.id}` })
            .setTimestamp();

        await this._send(newMessage.guild, 'messages', embed);
    }

    /**
     * Log a member joining
     */
    async logMemberJoin(member) {
        const { custom, notif } = await this._getGuildSettings(member.guild.id);
        if (!custom.log_members && custom.log_members !== undefined) return;

        const accountAge = Date.now() - member.user.createdTimestamp;
        const days = Math.floor(accountAge / 86400000);
        const isNew = days < 7;

        const embed = new EmbedBuilder()
            .setColor(isNew ? '#e74c3c' : '#2ecc71')
            .setTitle(`📥 Member Joined${isNew ? ' ⚠️ New Account' : ''}`)
            .addFields(
                { name: '👤 User', value: `${member.user.username}\n<@${member.id}>\n\`${member.id}\``, inline: true },
                { name: '🏠 Member Count', value: `${member.guild.memberCount}`, inline: true },
                { name: '📅 Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
            )
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `User ID: ${member.id}` })
            .setTimestamp();

        if (isNew) {
            embed.addFields({ name: '⚠️ Warning', value: `Account is only **${days} day${days === 1 ? '' : 's'}** old` });
        }

        await this._send(member.guild, 'members', embed);
    }

    /**
     * Log a member leaving
     */
    async logMemberLeave(member) {
        const { custom } = await this._getGuildSettings(member.guild.id);
        if (!custom.log_members && custom.log_members !== undefined) return;

        const joinedAt = member.joinedAt
            ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
            : '*Unknown*';
        const roles = member.roles.cache
            .filter(r => r.name !== '@everyone')
            .map(r => `<@&${r.id}>`)
            .join(', ') || '*None*';

        const embed = new EmbedBuilder()
            .setColor('#7f8c8d')
            .setTitle('📤 Member Left')
            .addFields(
                { name: '👤 User', value: `${member.user.username}\n<@${member.id}>\n\`${member.id}\``, inline: true },
                { name: '🏠 Remaining', value: `${member.guild.memberCount}`, inline: true },
                { name: '📅 Joined At', value: joinedAt, inline: true },
                { name: '🏷️ Roles', value: roles.substring(0, 1024) }
            )
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `User ID: ${member.id}` })
            .setTimestamp();

        await this._send(member.guild, 'members', embed);
    }

    /**
     * Log a moderation action (ban, kick, warn, timeout, etc.)
     * Used by moderation commands and auto-mod systems.
     */
    async logModAction(guild, { action, target, moderator, reason, duration, details } = {}) {
        const { custom } = await this._getGuildSettings(guild.id);
        if (!custom.mod_logging && custom.mod_logging !== undefined) return;

        const colors = {
            ban: '#e74c3c', kick: '#e67e22', timeout: '#f39c12',
            warn: '#f1c40f', unban: '#2ecc71', unmute: '#2ecc71',
            purge: '#3498db', lockdown: '#9b59b6'
        };

        const icons = {
            ban: '🔨', kick: '👢', timeout: '🔇', warn: '⚠️',
            unban: '✅', unmute: '🔊', purge: '🗑️', lockdown: '🔒'
        };

        const actionStr = action?.toLowerCase() || 'action';
        const embed = new EmbedBuilder()
            .setColor(colors[actionStr] || '#5865F2')
            .setTitle(`${icons[actionStr] || '⚖️'} Moderation: ${action?.toUpperCase() || 'ACTION'}`)
            .addFields(
                { name: '👤 Target', value: target ? `${target.username || target.username || target.id}\n<@${target.id}>` : '*Unknown*', inline: true },
                { name: '🛡️ Moderator', value: moderator ? `${moderator.username || moderator.username}\n<@${moderator.id}>` : '*Automatic*', inline: true },
                { name: '📋 Reason', value: reason || '*No reason provided*', inline: false }
            )
            .setTimestamp();

        if (duration) embed.addFields({ name: '⏱️ Duration', value: String(duration), inline: true });
        if (details) embed.addFields({ name: '📎 Details', value: String(details).substring(0, 1024) });

        if (target?.displayAvatarURL) {
            embed.setThumbnail(target.displayAvatarURL({ dynamic: true }));
        }

        await this._send(guild, 'mod', embed);
    }

    /**
     * Log a role creation or deletion
     */
    async logRoleEvent(role, type) {
        const { custom } = await this._getGuildSettings(role.guild.id);
        if (!custom.log_roles) return;

        const embed = new EmbedBuilder()
            .setColor(type === 'create' ? '#2ecc71' : '#e74c3c')
            .setTitle(type === 'create' ? '➕ Role Created' : '➖ Role Deleted')
            .addFields(
                { name: '🏷️ Role', value: `${role.name}\n\`${role.id}\``, inline: true },
                { name: '🎨 Color', value: role.hexColor || '#000000', inline: true },
                { name: '📊 Position', value: String(role.position), inline: true }
            )
            .setFooter({ text: `Role ID: ${role.id}` })
            .setTimestamp();

        await this._send(role.guild, 'server', embed);
    }

    /**
     * Log a channel creation or deletion
     */
    async logChannelEvent(channel, type) {
        const { custom } = await this._getGuildSettings(channel.guild.id);
        if (!custom.log_channels) return;

        const typeNames = { 0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement', 13: 'Stage', 15: 'Forum' };

        const embed = new EmbedBuilder()
            .setColor(type === 'create' ? '#2ecc71' : '#e74c3c')
            .setTitle(type === 'create' ? '➕ Channel Created' : '➖ Channel Deleted')
            .addFields(
                { name: '📌 Name', value: `#${channel.name}`, inline: true },
                { name: '📂 Type', value: typeNames[channel.type] || 'Unknown', inline: true },
                { name: '🗂️ Category', value: channel.parent?.name || '*None*', inline: true }
            )
            .setFooter({ text: `Channel ID: ${channel.id}` })
            .setTimestamp();

        await this._send(channel.guild, 'server', embed);
    }

    /** Invalidate cache for a guild (call when settings change) */
    invalidateCache(guildId) {
        this._configCache.delete(guildId);
    }
}

module.exports = DiscordLogger;
