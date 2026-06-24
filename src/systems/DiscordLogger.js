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

const { EmbedBuilder, AuditLogEvent } = require('discord.js');

class DiscordLogger {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database;
        // Cache guild config + customization to avoid DB hammering
        this._configCache = new Map();   // guildId → { config, custom, expire }
        this.CACHE_TTL = 30 * 1000;      // 30 seconds
        this._burst = new Map();         // guildId:category → recent send timestamps
        this._suppressed = new Map();    // guildId:category → suppress-until timestamp
        this.BURST_WINDOW_MS = 60 * 1000;
        this.BURST_LIMITS = {
            messages: 8,
            members: 12,
            server: 8,
            voice: 3,
            mod: 12,
            automod: 12
        };
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

        const canSendLog = (ch) => {
            if (!ch || !ch.isTextBased()) return false;
            const perms = ch.permissionsFor(guild.members.me);
            return perms?.has('SendMessages') && perms?.has('EmbedLinks');
        };

        const tryChannel = async (id) => {
            if (!id) return null;
            const ch = guild.channels.cache.get(String(id)) || await guild.channels.fetch(String(id)).catch(() => null);
            if (canSendLog(ch)) return ch;
            return null;
        };

        // Category-specific channels (from notification_settings JSON)
        if (category === 'messages') {
            const ch = await tryChannel(notif.message_log_channel);
            if (ch) return ch;
        }
        if (category === 'members') {
            const ch = await tryChannel(notif.join_leave_channel);
            if (ch) return ch;
        }
        if (category === 'automod') {
            const ch = await tryChannel(notif.automod_log_channel || config.automod_log_channel || config.security_log_channel);
            if (ch) return ch;
        }
        if (category === 'mod') {
            const ch = await tryChannel(config.mod_log_channel);
            if (ch) return ch;
        }
        if (category === 'server') {
            const ch = await tryChannel(notif.server_changes_channel);
            if (ch) return ch;
        }

        // Fall back to the general log channel
        const configured = await tryChannel(config.log_channel_id);
        if (configured) return configured;

        return guild.channels.cache.find(ch => {
            if (!canSendLog(ch)) return false;
            const name = String(ch.name || '').toLowerCase();
            return ['security-log', 'security-logs', 'mod-log', 'mod-logs', 'audit-log', 'audit-logs', 'logs']
                .some(token => name.includes(token));
        }) || null;
    }

    _settingEnabled(settings, toggleKey, eventKey, defaultValue = false) {
        const custom = settings?.custom || {};
        const granular = settings?.notif?.granular_events || {};

        if (eventKey && Object.prototype.hasOwnProperty.call(granular, eventKey)) {
            return !!granular[eventKey];
        }

        if (toggleKey && custom[toggleKey] !== undefined && custom[toggleKey] !== null) {
            return !!custom[toggleKey];
        }

        return defaultValue;
    }

    _allowBurst(guildId, category) {
        const limit = this.BURST_LIMITS[category];
        if (!limit) return true;

        const key = `${guildId}:${category}`;
        const now = Date.now();
        const cutoff = now - this.BURST_WINDOW_MS;
        const recent = (this._burst.get(key) || []).filter(ts => ts > cutoff);

        if (recent.length >= limit) {
            this._burst.set(key, recent);
            return false;
        }

        recent.push(now);
        this._burst.set(key, recent);
        return true;
    }

    _isSuppressed(guildId, category) {
        const now = Date.now();
        const specific = this._suppressed.get(`${guildId}:${category}`) || 0;
        const all = this._suppressed.get(`${guildId}:*`) || 0;
        return now < specific || now < all;
    }

    suppress(guildId, category = '*', ms = 60000) {
        this._suppressed.set(`${guildId}:${category}`, Date.now() + ms);
    }

    async _send(guild, category, embed) {
        try {
            if (this._isSuppressed(guild.id, category)) return false;
            if (!this._allowBurst(guild.id, category)) return false;
            const channel = await this._getLogChannel(guild, category);
            if (!channel) return false;
            await channel.send({ embeds: [embed] });
            return true;
        } catch (err) {
            this.bot.logger?.debug(`[DiscordLogger] Failed to send ${category} log: ${err.message}`);
            return false;
        }
    }

    _clip(value, max = 1024, fallback = '*None*') {
        const text = String(value || '').trim();
        if (!text) return fallback;
        return text.length > max ? `${text.slice(0, max - 3)}...` : text;
    }

    _userLabel(user, idFallback = null) {
        const id = user?.id || idFallback;
        if (!id) return '*Unresolved user*';
        const name = user?.tag || user?.username || user?.globalName || 'Unknown user';
        return `${name}\n<@${id}>\n\`${id}\``;
    }

    _executorLabel(audit) {
        if (audit?.user) return this._userLabel(audit.user);
        return '*Not resolved from audit log*';
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async _executor(guild, type, targetId) {
        if (!type || !guild.members.me?.permissions?.has('ViewAuditLog')) return null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                if (attempt > 0) await this._sleep(850);
                const logs = await guild.fetchAuditLogs({ type, limit: 8 });
                const entry = logs.entries.find(e => {
                    const age = Date.now() - e.createdTimestamp;
                    const targetMatches = !targetId ||
                        e.target?.id === targetId ||
                        e.extra?.id === targetId ||
                        e.changes?.some(change => String(change?.new || change?.old || '') === String(targetId));
                    return age < 30000 && targetMatches;
                });
                if (entry) return { user: entry.executor, reason: entry.reason, id: entry.id };
            } catch (err) {
                this.bot.logger?.debug(`[DiscordLogger] Audit lookup failed: ${err.message}`);
                return null;
            }
        }
        return null;
    }

    // ── Public logging methods ───────────────────────────────────────────

    /**
     * Log a deleted message
     */
    async logMessageDelete(message) {
        if (!message.guild || message.author?.bot) return;

        const settings = await this._getGuildSettings(message.guild.id);
        if (!this._settingEnabled(settings, 'log_deletes', 'message_delete', false)) return;

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

        const settings = await this._getGuildSettings(newMessage.guild.id);
        if (!this._settingEnabled(settings, 'log_edits', 'message_edit', false)) return;

        const oldContent = oldMessage.content?.substring(0, 512) || '*[Content unavailable]*';
        const newContent = newMessage.content?.substring(0, 512) || '*[No content]*';

        const embed = new EmbedBuilder()
            .setColor('#f39c12')
            .setTitle(' Message Edited')
            .addFields(
                { name: ' Author', value: `${newMessage.author.username}\n<@${newMessage.author.id}>`, inline: true },
                { name: ' Channel', value: `<#${newMessage.channelId}>`, inline: true },
                { name: ' Jump to Message', value: `[Click here](${newMessage.url})`, inline: true },
                { name: ' Before', value: oldContent },
                { name: ' After', value: newContent }
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
        const settings = await this._getGuildSettings(member.guild.id);
        if (!this._settingEnabled(settings, 'log_members', 'join', true)) return;

        const accountAge = Date.now() - member.user.createdTimestamp;
        const days = Math.floor(accountAge / 86400000);
        const isNew = days < 7;

        const embed = new EmbedBuilder()
            .setColor(isNew ? '#e74c3c' : '#2ecc71')
            .setTitle(` Member Joined${isNew ? ' ⚠️ New Account' : ''}`)
            .addFields(
                { name: ' User', value: `${member.user.username}\n<@${member.id}>\n\`${member.id}\``, inline: true },
                { name: ' Member Count', value: `${member.guild.memberCount}`, inline: true },
                { name: ' Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
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
        const settings = await this._getGuildSettings(member.guild.id);
        if (!this._settingEnabled(settings, 'log_members', 'leave', true)) return;

        const joinedAt = member.joinedAt
            ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
            : '*Unknown*';
        const roles = member.roles.cache
            .filter(r => r.name !== '@everyone')
            .map(r => `<@&${r.id}>`)
            .join(', ') || '*None*';

        const embed = new EmbedBuilder()
            .setColor('#7f8c8d')
            .setTitle(' Member Left')
            .addFields(
                { name: ' User', value: `${member.user.username}\n<@${member.id}>\n\`${member.id}\``, inline: true },
                { name: ' Remaining', value: `${member.guild.memberCount}`, inline: true },
                { name: ' Joined At', value: joinedAt, inline: true },
                { name: ' Roles', value: roles.substring(0, 1024) }
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
        const settings = await this._getGuildSettings(guild.id);
        const actionKey = action ? String(action).toLowerCase() : 'mod_action';
        if (!this._settingEnabled(settings, 'mod_logging', actionKey, true)) return;

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
        const titleAction = String(action || 'action').replace(/_/g, ' ').toUpperCase();
        const embed = new EmbedBuilder()
            .setColor(colors[actionStr] || '#5865F2')
            .setTitle(`${icons[actionStr] || '⚖️'} Moderation Action`)
            .setDescription(`**${titleAction}** was recorded for this server.`)
            .addFields(
                { name: 'Target', value: this._userLabel(target, target?.id), inline: true },
                { name: 'Actor', value: moderator ? this._userLabel(moderator, moderator.id) : '*Automatic system action*', inline: true },
                { name: 'Reason', value: this._clip(reason, 1024, '*No reason provided*'), inline: false }
            )
            .setFooter({ text: `DarkLock logs • ${titleAction}` })
            .setTimestamp();

        if (duration) embed.addFields({ name: '⏱️ Duration', value: String(duration), inline: true });
        if (details) embed.addFields({ name: 'Details', value: this._clip(details) });

        if (target?.displayAvatarURL) {
            embed.setThumbnail(target.displayAvatarURL({ dynamic: true }));
        }

        await this._send(guild, 'mod', embed);
    }

    /**
     * Log a role creation or deletion
     */
    async logRoleEvent(role, type, oldRole = null) {
        const settings = await this._getGuildSettings(role.guild.id);
        if (!this._settingEnabled(settings, 'log_roles', 'role_update', false)) return;
        const actionType = type === 'create' ? AuditLogEvent.RoleCreate : type === 'delete' ? AuditLogEvent.RoleDelete : AuditLogEvent.RoleUpdate;
        const audit = await this._executor(role.guild, actionType, role.id);

        const embed = new EmbedBuilder()
            .setColor(type === 'create' ? '#2ecc71' : type === 'delete' ? '#e74c3c' : '#f39c12')
            .setTitle(type === 'create' ? '➕ Role Created' : type === 'delete' ? '➖ Role Deleted' : '✏️ Role Updated')
            .addFields(
                { name: ' Role', value: `${role.name}\n\`${role.id}\``, inline: true },
                { name: ' Color', value: role.hexColor || '#000000', inline: true },
                { name: ' Position', value: String(role.position), inline: true }
            )
            .setFooter({ text: `Role ID: ${role.id}` })
            .setTimestamp();

        if (oldRole && oldRole.name !== role.name) embed.addFields({ name: 'Name Changed', value: `${oldRole.name} → ${role.name}` });
        if (oldRole && oldRole.permissions.bitfield !== role.permissions.bitfield) {
            embed.addFields({ name: 'Permissions Changed', value: 'Role permissions were updated.' });
        }
        embed.addFields({ name: 'Executor', value: this._executorLabel(audit), inline: true });
        if (audit?.reason) embed.addFields({ name: 'Reason', value: this._clip(audit.reason) });

        await this._send(role.guild, 'server', embed);
    }

    /**
     * Log a channel creation or deletion
     */
    async logChannelEvent(channel, type, oldChannel = null) {
        const settings = await this._getGuildSettings(channel.guild.id);
        if (!this._settingEnabled(settings, 'log_channels', `channel_${type}`, false)) return;
        const actionType = type === 'create' ? AuditLogEvent.ChannelCreate : type === 'delete' ? AuditLogEvent.ChannelDelete : AuditLogEvent.ChannelUpdate;
        const audit = await this._executor(channel.guild, actionType, channel.id);

        const typeNames = { 0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement', 13: 'Stage', 15: 'Forum' };

        const embed = new EmbedBuilder()
            .setColor(type === 'create' ? '#2ecc71' : type === 'delete' ? '#e74c3c' : '#f39c12')
            .setTitle(type === 'create' ? '➕ Channel Created' : type === 'delete' ? '➖ Channel Deleted' : '✏️ Channel Updated')
            .addFields(
                { name: ' Name', value: `#${channel.name}`, inline: true },
                { name: ' Type', value: typeNames[channel.type] || 'Unknown', inline: true },
                { name: ' Category', value: channel.parent?.name || '*None*', inline: true }
            )
            .setFooter({ text: `Channel ID: ${channel.id}` })
            .setTimestamp();

        if (oldChannel && oldChannel.name !== channel.name) embed.addFields({ name: 'Name Changed', value: `#${oldChannel.name} → #${channel.name}` });
        embed.addFields({ name: 'Executor', value: this._executorLabel(audit), inline: true });
        if (audit?.reason) embed.addFields({ name: 'Reason', value: this._clip(audit.reason) });

        await this._send(channel.guild, 'server', embed);
    }

    async logBanEvent(ban, type) {
        const settings = await this._getGuildSettings(ban.guild.id);
        if (!this._settingEnabled(settings, 'mod_logging', type, true)) return;

        const audit = await this._executor(ban.guild, type === 'ban' ? AuditLogEvent.MemberBanAdd : AuditLogEvent.MemberBanRemove, ban.user.id);
        const embed = new EmbedBuilder()
            .setColor(type === 'ban' ? '#e74c3c' : '#2ecc71')
            .setTitle(type === 'ban' ? '🔨 Member Banned' : '✅ Member Unbanned')
            .addFields(
                { name: 'Target', value: this._userLabel(ban.user), inline: true },
                { name: 'Executor', value: this._executorLabel(audit), inline: true },
                { name: 'Reason', value: this._clip(audit?.reason || ban.reason, 1024, '*No reason provided*') }
            )
            .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
        await this._send(ban.guild, 'mod', embed);
    }

    async logMemberUpdate(oldMember, newMember) {
        const settings = await this._getGuildSettings(newMember.guild.id);
        const changes = [];
        if (oldMember.nickname !== newMember.nickname && this._settingEnabled(settings, 'log_members', 'nickname', false)) {
            changes.push(`Nickname: ${oldMember.nickname || oldMember.user.username} → ${newMember.nickname || newMember.user.username}`);
        }
        if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp &&
            this._settingEnabled(settings, 'mod_logging', 'timeout', false)) {
            changes.push(newMember.communicationDisabledUntilTimestamp
                ? `Timeout until <t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:F>`
                : 'Timeout removed');
        }
        if (!changes.length) return;

        const audit = await this._executor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
        const embed = new EmbedBuilder()
            .setColor('#f39c12')
            .setTitle(' Member Updated')
            .addFields(
                { name: 'Target', value: `${newMember.user.username}\n<@${newMember.id}>`, inline: true },
                { name: 'Changes', value: changes.join('\n').substring(0, 1024), inline: false }
            )
            .setTimestamp();
        if (audit?.user) embed.addFields({ name: 'Executor', value: `${audit.user.username}\n<@${audit.user.id}>`, inline: true });
        else embed.addFields({ name: 'Executor', value: '*Not resolved from audit log*', inline: true });
        if (audit?.reason) embed.addFields({ name: 'Reason', value: this._clip(audit.reason) });
        await this._send(newMember.guild, 'members', embed);
    }

    async logInviteEvent(invite, type) {
        const settings = await this._getGuildSettings(invite.guild.id);
        if (!this._settingEnabled(settings, null, `invite_${type}`, false)) return;

        const audit = await this._executor(invite.guild, type === 'create' ? AuditLogEvent.InviteCreate : AuditLogEvent.InviteDelete, invite.code);
        const embed = new EmbedBuilder()
            .setColor(type === 'create' ? '#2ecc71' : '#e74c3c')
            .setTitle(type === 'create' ? '✉️ Invite Created' : '✉️ Invite Deleted')
            .addFields(
                { name: 'Code', value: `\`${invite.code}\``, inline: true },
                { name: 'Channel', value: invite.channel ? `${invite.channel}` : '*Unknown*', inline: true },
                { name: 'Inviter', value: invite.inviter ? `${invite.inviter.username}\n<@${invite.inviter.id}>` : (audit?.user ? `${audit.user.username}\n<@${audit.user.id}>` : '*Unknown*'), inline: true }
            )
            .setTimestamp();
        await this._send(invite.guild, 'server', embed);
    }

    async logWebhookUpdate(channel) {
        const settings = await this._getGuildSettings(channel.guild.id);
        if (!this._settingEnabled(settings, null, 'webhook_update', true)) return;

        const audit = await this._executor(channel.guild, AuditLogEvent.WebhookUpdate, channel.id);
        const embed = new EmbedBuilder()
            .setColor('#f39c12')
            .setTitle(' Webhook Updated')
            .addFields(
                { name: 'Channel', value: `${channel}\n\`${channel.id}\``, inline: true },
                { name: 'Executor', value: audit?.user ? `${audit.user.username}\n<@${audit.user.id}>` : '*Unknown*', inline: true }
            )
            .setTimestamp();
        if (audit?.reason) embed.addFields({ name: 'Reason', value: audit.reason.substring(0, 1024) });
        await this._send(channel.guild, 'server', embed);
    }

    async logGuildUpdate(oldGuild, newGuild) {
        const settings = await this._getGuildSettings(newGuild.id);
        if (!this._settingEnabled(settings, null, 'guild_update', true)) return;

        const changes = [];
        if (oldGuild.name !== newGuild.name) changes.push(`Name: ${oldGuild.name} → ${newGuild.name}`);
        if (oldGuild.verificationLevel !== newGuild.verificationLevel) changes.push(`Verification level: ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
        if (!changes.length) return;
        const audit = await this._executor(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
        const embed = new EmbedBuilder()
            .setColor('#f39c12')
            .setTitle(' Server Updated')
            .addFields({ name: 'Changes', value: changes.join('\n').substring(0, 1024) })
            .setTimestamp();
        if (audit?.user) embed.addFields({ name: 'Executor', value: `${audit.user.username}\n<@${audit.user.id}>`, inline: true });
        await this._send(newGuild, 'server', embed);
    }

    async logThreadEvent(thread, type, oldThread = null) {
        const settings = await this._getGuildSettings(thread.guild.id);
        if (!this._settingEnabled(settings, null, `thread_${type}`, false)) return;

        const embed = new EmbedBuilder()
            .setColor(type === 'create' ? '#2ecc71' : type === 'delete' ? '#e74c3c' : '#f39c12')
            .setTitle(type === 'create' ? '🧵 Thread Created' : type === 'delete' ? '🧵 Thread Deleted' : '🧵 Thread Updated')
            .addFields(
                { name: 'Thread', value: `${thread.name}\n\`${thread.id}\``, inline: true },
                { name: 'Parent', value: thread.parent ? `${thread.parent}` : '*Unknown*', inline: true }
            )
            .setTimestamp();
        if (oldThread && oldThread.name !== thread.name) embed.addFields({ name: 'Name Changed', value: `${oldThread.name} → ${thread.name}` });
        await this._send(thread.guild, 'server', embed);
    }

    async logVoiceState(oldState, newState) {
        const guild = newState.guild || oldState.guild;
        const member = newState.member || oldState.member;
        if (!guild || !member) return;
        const settings = await this._getGuildSettings(guild.id);
        if (!this._settingEnabled(settings, null, 'voice', false)) return;

        const oldChannel = oldState.channel;
        const newChannel = newState.channel;
        if (oldChannel?.id === newChannel?.id) return;
        const action = !oldChannel ? 'joined' : !newChannel ? 'left' : 'moved';
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🔊 Voice State Updated')
            .addFields(
                { name: 'Member', value: `${member.user.username}\n<@${member.id}>`, inline: true },
                { name: 'Action', value: action, inline: true },
                { name: 'Channel', value: newChannel ? `${newChannel}` : `${oldChannel}`, inline: true }
            )
            .setTimestamp();
        if (action === 'moved') embed.addFields({ name: 'Move', value: `${oldChannel} → ${newChannel}` });
        await this._send(guild, 'voice', embed);
    }

    /** Invalidate cache for a guild (call when settings change) */
    invalidateCache(guildId) {
        this._configCache.delete(guildId);
    }
}

module.exports = DiscordLogger;
