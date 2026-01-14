/**
 * Anti-Nuke Event Handlers v2.0
 * Extracted from bot.js - handles role, channel, ban, and webhook events for anti-nuke protection
 * Integrates with live snapshot system for instant restoration
 */

/**
 * Handle role creation for anti-nuke tracking
 * @param {Role} role 
 * @param {SecurityBot} bot 
 */
async function handleRoleCreate(role, bot) {
    if (!bot.antiNuke) return;
    
    const guild = role.guild;
    bot.logger.debug(`Role created: ${role.name} in ${guild.name}`);
    
    // UPDATE LIVE SNAPSHOT - critical for restoration
    if (typeof bot.antiNuke.updateRoleSnapshot === 'function') {
        bot.antiNuke.updateRoleSnapshot(role);
    }
    
    // Broadcast to dashboard console
    if (typeof bot.broadcastConsole === 'function') {
        bot.broadcastConsole(guild.id, `[ROLE CREATE] ${role.name} (${role.id})`);
    }
    
    // Get audit log to find who created the role
    const auditLogs = await guild.fetchAuditLogs({
        type: 30, // ROLE_CREATE
        limit: 1
    }).catch(() => null);
    
    if (!auditLogs) return;
    
    const entry = auditLogs.entries.first();
    if (!entry || !entry.executor) return;
    
    // Skip old audit log entries (more than 5 seconds old)
    if (Date.now() - entry.createdTimestamp > 5000) return;
    
    const userId = entry.executor.id;
    if (userId === bot.client.user.id) return; // Ignore bot's own actions
    
    // Track the action
    const result = await bot.antiNuke.trackAction(guild, userId, 'roleCreate', {
        roleId: role.id,
        roleName: role.name,
        permissions: role.permissions.bitfield.toString()
    });
    
    if (result.violated) {
        await bot.antiNuke.handleViolation(guild, userId, result);
    }

    if (bot.forensicsManager) {
        await bot.forensicsManager.logAuditEvent({
            guildId: guild.id,
            eventType: 'role_create',
            eventCategory: 'role',
            executor: entry.executor,
            target: { id: role.id, name: role.name, type: 'role' },
            changes: { permissions: role.permissions.bitfield.toString() },
            afterState: { name: role.name, permissions: role.permissions.bitfield.toString() },
            canReplay: true
        });
    }

    if (bot.antiNukeManager) {
        const tracked = bot.antiNukeManager.track(guild.id, userId, 'role_create', { id: role.id });
        if (tracked?.triggered) {
            await bot.antiNukeManager.mitigate(guild, userId);
        }
    }
}

/**
 * Handle role deletion for anti-nuke tracking
 * @param {Role} role 
 * @param {SecurityBot} bot 
 */
async function handleRoleDelete(role, bot) {
    if (!bot.antiNuke) return;
    
    const guild = role.guild;
    bot.logger.debug(`Role deleted: ${role.name} in ${guild.name}`);
    
    // NOTE: Keep snapshot until we confirm it wasn't us restoring
    // The snapshot will be used for restoration if needed
    
    // Broadcast to dashboard console
    if (typeof bot.broadcastConsole === 'function') {
        bot.broadcastConsole(guild.id, `[ROLE DELETE] ${role.name} (${role.id})`);
    }
    
    const auditLogs = await guild.fetchAuditLogs({
        type: 32, // ROLE_DELETE
        limit: 1
    }).catch(() => null);
    
    if (!auditLogs) return;
    
    const entry = auditLogs.entries.first();
    if (!entry || !entry.executor) return;
    
    // Skip old audit log entries
    if (Date.now() - entry.createdTimestamp > 5000) return;
    
    const userId = entry.executor.id;
    if (userId === bot.client.user.id) return;
    
    const result = await bot.antiNuke.trackAction(guild, userId, 'roleDelete', {
        roleId: role.id,
        roleName: role.name
    });
    
    if (result.violated) {
        await bot.antiNuke.handleViolation(guild, userId, result);
    }

    if (bot.forensicsManager) {
        await bot.forensicsManager.logAuditEvent({
            guildId: guild.id,
            eventType: 'role_delete',
            eventCategory: 'role',
            executor: entry.executor,
            target: { id: role.id, name: role.name, type: 'role' },
            beforeState: { name: role.name },
            reason: result?.violated ? 'anti-nuke violation tracked' : null,
            canReplay: true
        });
    }

    if (bot.antiNukeManager) {
        const tracked = bot.antiNukeManager.track(guild.id, userId, 'role_delete', { id: role.id });
        if (tracked?.triggered) {
            await bot.antiNukeManager.mitigate(guild, userId);
        }
    }
}

/**
 * Handle channel creation for anti-nuke tracking
 * @param {GuildChannel} channel 
 * @param {SecurityBot} bot 
 */
async function handleChannelCreate(channel, bot) {
    if (!bot.antiNuke) {
        bot.logger.warn('⚠️ Anti-nuke module not initialized');
        return;
    }
    if (!channel.guild) return; // DM channels
    
    const guild = channel.guild;
    bot.logger.info(`🔔 Channel created: ${channel.name} (${channel.id}) in ${guild.name}`);
    
    // UPDATE LIVE SNAPSHOT - critical for restoration
    if (typeof bot.antiNuke.updateChannelSnapshot === 'function') {
        bot.antiNuke.updateChannelSnapshot(channel);
    }
    
    // Broadcast to dashboard console
    if (typeof bot.broadcastConsole === 'function') {
        bot.broadcastConsole(guild.id, `[CHANNEL CREATE] #${channel.name} (${channel.id})`);
    }
    
    const auditLogs = await guild.fetchAuditLogs({
        type: 10, // CHANNEL_CREATE
        limit: 1
    }).catch(err => {
        bot.logger.error('❌ Failed to fetch audit logs:', err.message);
        return null;
    });
    
    if (!auditLogs) {
        bot.logger.warn('⚠️ No audit logs available for channel creation');
        return;
    }
    
    const entry = auditLogs.entries.first();
    if (!entry) {
        bot.logger.warn('⚠️ No audit log entry found');
        return;
    }
    if (!entry.executor) {
        bot.logger.warn('⚠️ No executor in audit log entry');
        return;
    }
    
    // Skip old audit log entries (more than 5 seconds old)
    if (Date.now() - entry.createdTimestamp > 5000) return;
    
    const userId = entry.executor.id;
    bot.logger.info(`👤 Channel creator: ${entry.executor.tag} (${userId})`);
    
    if (userId === bot.client.user.id) {
        bot.logger.debug('ℹ️ Ignoring own action');
        return;
    }
    
    bot.logger.info(`🔍 Tracking channel creation by ${entry.executor.tag}`);
    const result = await bot.antiNuke.trackAction(guild, userId, 'channelCreate', {
        channelId: channel.id,
        channelName: channel.name,
        channelType: channel.type
    });
    
    bot.logger.info(`📊 Anti-nuke result:`, {
        violated: result.violated,
        count: result.count,
        limit: result.limit
    });
    
    if (result.violated) {
        bot.logger.warn(`🚨 VIOLATION DETECTED! Taking action against ${entry.executor.tag}`);
        await bot.antiNuke.handleViolation(guild, userId, result);
    }
    if (bot.forensicsManager) {
        await bot.forensicsManager.logAuditEvent({
            guildId: guild.id,
            eventType: 'channel_create',
            eventCategory: 'channel',
            executor: entry.executor,
            target: { id: channel.id, name: channel.name, type: 'channel' },
            changes: { channelType: channel.type },
            afterState: { name: channel.name, type: channel.type },
            canReplay: true
        });
    }

    if (bot.antiNukeManager) {
        const tracked = bot.antiNukeManager.track(guild.id, userId, 'channel_create', { id: channel.id });
        if (tracked?.triggered) {
            await bot.antiNukeManager.mitigate(guild, userId);
        }
    }
}

/**
 * Handle channel deletion for anti-nuke tracking
 * @param {GuildChannel} channel 
 * @param {SecurityBot} bot 
 */
async function handleChannelDelete(channel, bot) {
    if (!bot.antiNuke) return;
    if (!channel.guild) return;
    
    const guild = channel.guild;
    bot.logger.debug(`Channel deleted: ${channel.name} in ${guild.name}`);
    
    // NOTE: Keep snapshot until we confirm it wasn't us restoring
    // The snapshot will be used for restoration if needed
    
    // Broadcast to dashboard console
    if (typeof bot.broadcastConsole === 'function') {
        bot.broadcastConsole(guild.id, `[CHANNEL DELETE] #${channel.name} (${channel.id})`);
    }
    
    const auditLogs = await guild.fetchAuditLogs({
        type: 12, // CHANNEL_DELETE
        limit: 1
    }).catch(() => null);
    
    if (!auditLogs) return;
    
    const entry = auditLogs.entries.first();
    if (!entry || !entry.executor) return;
    
    // Skip old audit log entries
    if (Date.now() - entry.createdTimestamp > 5000) return;
    
    const userId = entry.executor.id;
    if (userId === bot.client.user.id) return;
    
    const result = await bot.antiNuke.trackAction(guild, userId, 'channelDelete', {
        channelId: channel.id,
        channelName: channel.name
    });
    
    if (result.violated) {
        await bot.antiNuke.handleViolation(guild, userId, result);
    }
    if (bot.forensicsManager) {
        await bot.forensicsManager.logAuditEvent({
            guildId: guild.id,
            eventType: 'channel_delete',
            eventCategory: 'channel',
            executor: entry.executor,
            target: { id: channel.id, name: channel.name, type: 'channel' },
            beforeState: { name: channel.name, type: channel.type },
            canReplay: true
        });
    }

    if (bot.antiNukeManager) {
        const tracked = bot.antiNukeManager.track(guild.id, userId, 'channel_delete', { id: channel.id });
        if (tracked?.triggered) {
            await bot.antiNukeManager.mitigate(guild, userId);
        }
    }
}

/**
 * Handle ban add for anti-nuke tracking
 * @param {GuildBan} ban 
 * @param {SecurityBot} bot 
 */
async function handleBanAdd(ban, bot) {
    if (!bot.antiNuke) return;
    
    const guild = ban.guild;
    bot.logger.debug(`Ban added: ${ban.user.tag} in ${guild.name}`);
    
    // Broadcast to dashboard console
    if (typeof bot.broadcastConsole === 'function') {
        bot.broadcastConsole(guild.id, `[BAN ADD] ${ban.user.tag} (${ban.user.id})`);
    }
    
    const auditLogs = await guild.fetchAuditLogs({
        type: 22, // MEMBER_BAN_ADD
        limit: 1
    }).catch(() => null);
    
    if (!auditLogs) return;
    
    const entry = auditLogs.entries.first();
    if (!entry || !entry.executor) return;
    
    // Skip old audit log entries
    if (Date.now() - entry.createdTimestamp > 5000) return;
    
    const userId = entry.executor.id;
    if (userId === bot.client.user.id) return;
    
    const result = await bot.antiNuke.trackAction(guild, userId, 'banAdd', {
        targetId: ban.user.id,
        targetTag: ban.user.tag
    });
    
    if (result.violated) {
        await bot.antiNuke.handleViolation(guild, userId, result);
    }
    if (bot.forensicsManager) {
        await bot.forensicsManager.logAuditEvent({
            guildId: guild.id,
            eventType: 'ban_add',
            eventCategory: 'moderation',
            executor: entry.executor,
            target: { id: ban.user.id, name: ban.user.tag, type: 'user' },
            reason: entry.reason || null,
            changes: { action: 'ban' }
        });
    }
}

/**
 * Handle webhook update for anti-nuke tracking
 * @param {GuildChannel} channel 
 * @param {SecurityBot} bot 
 */
async function handleWebhookUpdate(channel, bot) {
    if (!bot.antiNuke) return;
    if (!channel.guild) return;
    
    const guild = channel.guild;
    
    // Broadcast to dashboard console
    if (typeof bot.broadcastConsole === 'function') {
        bot.broadcastConsole(guild.id, `[WEBHOOK UPDATE] #${channel.name} (${channel.id})`);
    }
    
    const auditLogs = await guild.fetchAuditLogs({
        type: 50, // WEBHOOK_CREATE
        limit: 1
    }).catch(() => null);
    
    if (!auditLogs) return;
    
    const entry = auditLogs.entries.first();
    if (!entry || !entry.executor) return;
    if (Date.now() - entry.createdTimestamp > 5000) return; // Only recent webhooks
    
    const userId = entry.executor.id;
    if (userId === bot.client.user.id) return;
    
    const result = await bot.antiNuke.trackAction(guild, userId, 'webhookCreate', {
        webhookId: entry.target?.id,
        channelId: channel.id,
        channelName: channel.name
    });
    
    if (result.violated) {
        await bot.antiNuke.handleViolation(guild, userId, result);
    }
    if (bot.forensicsManager) {
        await bot.forensicsManager.logAuditEvent({
            guildId: guild.id,
            eventType: 'webhook_create',
            eventCategory: 'integration',
            executor: entry.executor,
            target: { id: entry.target?.id || channel.id, name: channel.name, type: 'webhook' },
            changes: { channelId: channel.id },
            canReplay: true
        });
    }
}

/**
 * Handle role update for anti-nuke tracking (permission escalation detection)
 * @param {Role} oldRole 
 * @param {Role} newRole 
 * @param {SecurityBot} bot 
 */
async function handleRoleUpdate(oldRole, newRole, bot) {
    if (!bot.antiNuke) return;
    
    const guild = newRole.guild;
    
    // UPDATE LIVE SNAPSHOT
    if (typeof bot.antiNuke.updateRoleSnapshot === 'function') {
        bot.antiNuke.updateRoleSnapshot(newRole);
    }
    
    // Check for dangerous permission grants
    const dangerousPerms = [
        { flag: 8n, name: 'Administrator' },
        { flag: 32n, name: 'ManageGuild' },
        { flag: 16n, name: 'ManageChannels' },
        { flag: 268435456n, name: 'ManageRoles' },
        { flag: 4n, name: 'BanMembers' },
        { flag: 2n, name: 'KickMembers' },
        { flag: 536870912n, name: 'ManageWebhooks' }
    ];
    
    const oldPerms = oldRole.permissions.bitfield;
    const newPerms = newRole.permissions.bitfield;
    
    // Check if any dangerous permission was added
    const addedDangerous = dangerousPerms.filter(p => 
        !(oldPerms & p.flag) && (newPerms & p.flag)
    );
    
    if (addedDangerous.length === 0) return;
    
    // Broadcast to dashboard console
    if (typeof bot.broadcastConsole === 'function') {
        bot.broadcastConsole(guild.id, `[ROLE UPDATE] ${newRole.name} - Added: ${addedDangerous.map(p => p.name).join(', ')}`);
    }
    
    const auditLogs = await guild.fetchAuditLogs({
        type: 31, // ROLE_UPDATE
        limit: 1
    }).catch(() => null);
    
    if (!auditLogs) return;
    
    const entry = auditLogs.entries.first();
    if (!entry || !entry.executor) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;
    
    const userId = entry.executor.id;
    if (userId === bot.client.user.id) return;
    
    // Track dangerous permission grants
    const result = await bot.antiNuke.trackAction(guild, userId, 'roleUpdate', {
        roleId: newRole.id,
        roleName: newRole.name,
        addedPerms: addedDangerous.map(p => p.name)
    });
    
    if (result.violated) {
        await bot.antiNuke.handleViolation(guild, userId, result);
    }
}

/**
 * Handle member kick for anti-nuke tracking
 * @param {GuildMember} member 
 * @param {SecurityBot} bot 
 */
async function handleMemberRemove(member, bot) {
    if (!bot.antiNuke) return;
    
    const guild = member.guild;
    
    // Check audit log to see if this was a kick
    const auditLogs = await guild.fetchAuditLogs({
        type: 20, // MEMBER_KICK
        limit: 1
    }).catch(() => null);
    
    if (!auditLogs) return;
    
    const entry = auditLogs.entries.first();
    if (!entry || !entry.executor) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;
    if (entry.target?.id !== member.id) return; // Make sure it's for this member
    
    const userId = entry.executor.id;
    if (userId === bot.client.user.id) return;
    
    // Broadcast to dashboard console
    if (typeof bot.broadcastConsole === 'function') {
        bot.broadcastConsole(guild.id, `[MEMBER KICK] ${member.user.tag} by ${entry.executor.tag}`);
    }
    
    const result = await bot.antiNuke.trackAction(guild, userId, 'memberKick', {
        targetId: member.id,
        targetTag: member.user.tag
    });
    
    if (result.violated) {
        await bot.antiNuke.handleViolation(guild, userId, result);
    }
}

/**
 * Handle bot addition for anti-nuke tracking
 * @param {GuildMember} member 
 * @param {SecurityBot} bot 
 */
async function handleBotAdd(member, bot) {
    if (!member.user.bot) return;
    if (!bot.antiNuke) return;
    
    const guild = member.guild;
    
    // Broadcast to dashboard console
    if (typeof bot.broadcastConsole === 'function') {
        bot.broadcastConsole(guild.id, `[BOT ADD] ${member.user.tag} (${member.user.id})`);
    }
    
    const auditLogs = await guild.fetchAuditLogs({
        type: 28, // BOT_ADD
        limit: 1
    }).catch(() => null);
    
    if (!auditLogs) return;
    
    const entry = auditLogs.entries.first();
    if (!entry || !entry.executor) return;
    if (Date.now() - entry.createdTimestamp > 10000) return; // 10 second window for bot additions
    
    const userId = entry.executor.id;
    if (userId === bot.client.user.id) return;
    
    const result = await bot.antiNuke.trackAction(guild, userId, 'botAdd', {
        botId: member.id,
        botTag: member.user.tag
    });
    
    if (result.violated) {
        // For bot flood, also kick the added bots
        try {
            if (member.kickable) {
                await member.kick('Anti-nuke: Suspicious bot flood detected');
            }
        } catch (e) {
            bot.logger.error('Failed to kick suspicious bot:', e.message);
        }
        await bot.antiNuke.handleViolation(guild, userId, result);
    }
}

/**
 * Handle channel update for snapshot maintenance
 * @param {GuildChannel} oldChannel 
 * @param {GuildChannel} newChannel 
 * @param {SecurityBot} bot 
 */
async function handleChannelUpdate(oldChannel, newChannel, bot) {
    if (!bot.antiNuke) return;
    if (!newChannel.guild) return;
    
    // UPDATE LIVE SNAPSHOT
    if (typeof bot.antiNuke.updateChannelSnapshot === 'function') {
        bot.antiNuke.updateChannelSnapshot(newChannel);
    }
}

module.exports = {
    handleRoleCreate,
    handleRoleDelete,
    handleRoleUpdate,
    handleChannelCreate,
    handleChannelDelete,
    handleChannelUpdate,
    handleBanAdd,
    handleMemberRemove,
    handleBotAdd,
    handleWebhookUpdate
};
