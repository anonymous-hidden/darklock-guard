const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Get detailed information about a user')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to get information about')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();
        
        const target = interaction.options.getUser('target') || interaction.user;
        const member = interaction.guild.members.cache.get(target.id);

        const userEmbed = new EmbedBuilder()
            .setTitle(`👤 User Information`)
            .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
            .setColor('#00d4ff')
            .setTimestamp();

        // Basic user info
        userEmbed.addFields(
            { name: 'Username', value: target.tag, inline: true },
            { name: 'User ID', value: target.id, inline: true },
            { name: 'Account Created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:F>`, inline: false }
        );

        if (member) {
            // Server-specific info
            userEmbed.addFields(
                { name: 'Server Nickname', value: member.nickname || 'None', inline: true },
                { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`, inline: false }
            );

            // Roles
            const roles = member.roles.cache
                .filter(role => role.id !== interaction.guild.id)
                .sort((a, b) => b.position - a.position)
                .map(role => role.toString());

            if (roles.length > 0) {
                const rolesText = roles.length > 10 
                    ? roles.slice(0, 10).join(', ') + ` and ${roles.length - 10} more...`
                    : roles.join(', ');
                userEmbed.addFields({ name: `Roles (${roles.length})`, value: rolesText, inline: false });
            } else {
                userEmbed.addFields({ name: 'Roles', value: 'None', inline: false });
            }

            // Permissions
            if (member.permissions.has(PermissionFlagsBits.Administrator)) {
                userEmbed.addFields({ name: 'Key Permissions', value: '👑 Administrator', inline: true });
            } else {
                const keyPerms = [];
                if (member.permissions.has(PermissionFlagsBits.ManageGuild)) keyPerms.push('Manage Server');
                if (member.permissions.has(PermissionFlagsBits.ManageChannels)) keyPerms.push('Manage Channels');
                if (member.permissions.has(PermissionFlagsBits.ManageRoles)) keyPerms.push('Manage Roles');
                if (member.permissions.has(PermissionFlagsBits.BanMembers)) keyPerms.push('Ban Members');
                if (member.permissions.has(PermissionFlagsBits.KickMembers)) keyPerms.push('Kick Members');
                if (member.permissions.has(PermissionFlagsBits.ManageMessages)) keyPerms.push('Manage Messages');

                userEmbed.addFields({ 
                    name: 'Key Permissions', 
                    value: keyPerms.length > 0 ? keyPerms.join(', ') : 'None', 
                    inline: false 
                });
            }

            // Status
            const presence = member.presence;
            if (presence) {
                let statusText = 'Unknown';
                let statusEmoji = '❓';
                
                switch (presence.status) {
                    case 'online':
                        statusText = 'Online';
                        statusEmoji = '🟢';
                        break;
                    case 'idle':
                        statusText = 'Away';
                        statusEmoji = '🟡';
                        break;
                    case 'dnd':
                        statusText = 'Do Not Disturb';
                        statusEmoji = '🔴';
                        break;
                    case 'offline':
                        statusText = 'Offline';
                        statusEmoji = '⚫';
                        break;
                }

                userEmbed.addFields({ name: 'Status', value: `${statusEmoji} ${statusText}`, inline: true });

                // Activities
                if (presence.activities && presence.activities.length > 0) {
                    const activity = presence.activities[0];
                    let activityText = activity.name;
                    
                    if (activity.type === 0) activityText = `Playing ${activity.name}`;
                    else if (activity.type === 1) activityText = `Streaming ${activity.name}`;
                    else if (activity.type === 2) activityText = `Listening to ${activity.name}`;
                    else if (activity.type === 3) activityText = `Watching ${activity.name}`;
                    else if (activity.type === 5) activityText = `Competing in ${activity.name}`;

                    userEmbed.addFields({ name: 'Activity', value: activityText, inline: true });
                }
            }

            // Boost info
            if (member.premiumSince) {
                userEmbed.addFields({ 
                    name: '💎 Server Booster', 
                    value: `Since <t:${Math.floor(member.premiumSince.getTime() / 1000)}:F>`, 
                    inline: false 
                });
            }

            // Timeout info
            if (member.communicationDisabledUntil) {
                userEmbed.addFields({ 
                    name: '🔇 Timed Out', 
                    value: `Until <t:${Math.floor(member.communicationDisabledUntil.getTime() / 1000)}:F>`, 
                    inline: false 
                });
            }
        } else {
            userEmbed.addFields({ name: 'Server Member', value: 'Not in this server', inline: false });
        }

        // Account age
        const accountAge = Date.now() - target.createdTimestamp;
        const days = Math.floor(accountAge / (1000 * 60 * 60 * 24));
        userEmbed.addFields({ name: 'Account Age', value: `${days} days old`, inline: true });

        // Get warning count if database is available
        const bot = interaction.client.bot;
        if (bot && bot.database && member) {
            try {
                const warnings = await bot.database.getUserWarnings(target.id, interaction.guild.id);
                if (warnings && warnings.length > 0) {
                    userEmbed.addFields({ name: '⚠️ Warnings', value: `${warnings.length}`, inline: true });
                }
            } catch (error) {
                // Database error, continue without warnings
            }
        }

        await interaction.editReply({ embeds: [userEmbed] });

        // Log command usage to dashboard
        try {
            const bot = interaction.client.bot;
            if (bot && bot.dashboardLogger) {
                await bot.dashboardLogger.logCommandUsage(
                    'userinfo',
                    interaction.user.id,
                    interaction.user.username,
                    interaction.guild.id,
                    interaction.guild.name,
                    { targetUser: target.username, targetId: target.id }
                );
            }
        } catch (error) {
            // Silent fail - don't break command if logging fails
            console.error('Dashboard logging failed for userinfo command:', error);
        }
    },
};