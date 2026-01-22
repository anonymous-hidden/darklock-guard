const { AuditLogEvent } = require('discord.js');

// Cache to prevent spam-fetching audit logs
const lastAuditFetch = new Map();

module.exports = function setupAuditWatcher(client, bot = null) {

    client.on('channelDelete', async (channel) => {
        try {
            const guild = channel.guild;
            if (!guild) return;

            // Anti-spam check to avoid Discord rate limit
            const now = Date.now();
            const last = lastAuditFetch.get(guild.id) || 0;

            // Only fetch logs once per 1200ms per guild
            if (now - last < 1200) return;
            lastAuditFetch.set(guild.id, now);

            // Fetch the most recent CHANNEL_DELETE audit entry
            const logs = await guild.fetchAuditLogs({
                type: AuditLogEvent.ChannelDelete,
                limit: 1
            }).catch(() => null);

            const entry = logs?.entries.first();
            if (!entry) return;

            // Ensure the log is about THIS channel and not old
            const isRecent = Date.now() - entry.createdTimestamp < 5000;
            const isTarget = entry.target?.id === channel.id;

            if (!isRecent || !isTarget) return;

            const executor = entry.executor;
            if (!executor) return;

            // Emit event into your anti-nuke manager
            client.emit('antiNuke:channelDeleteBy', {
                guildId: guild.id,
                userId: executor.id
            });

            // Broadcast to dashboard console
            if (bot && typeof bot.broadcastConsole === 'function') {
                bot.broadcastConsole(guild.id, `[CHANNEL DELETE] #${channel.name} by ${executor.tag} (${executor.id})`);
            }

            console.log(`[AuditWatcher] Channel deleted by: ${executor.tag} (${executor.id})`);

        } catch (err) {
            console.error('[AuditWatcher] Error:', err);
        }
    });
};
