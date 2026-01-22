const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('schedule')
        .setDescription('Schedule actions to be executed later')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('unban')
                .setDescription('Schedule an unban')
                .addStringOption(opt =>
                    opt.setName('user_id')
                        .setDescription('User ID to unban')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('duration')
                        .setDescription('Time until unban (e.g., 1h, 30m, 1d, 1w)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('unmute')
                .setDescription('Schedule an unmute')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to unmute')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('duration')
                        .setDescription('Time until unmute (e.g., 1h, 30m, 1d)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('role')
                .setDescription('Schedule a role change')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to modify')
                        .setRequired(true)
                )
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Role to add/remove')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('Add or remove the role')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Add', value: 'add' },
                            { name: 'Remove', value: 'remove' }
                        )
                )
                .addStringOption(opt =>
                    opt.setName('duration')
                        .setDescription('Time until action (e.g., 1h, 30m, 1d)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('announcement')
                .setDescription('Schedule an announcement')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to post in')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('Message to send')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('duration')
                        .setDescription('Time until posting (e.g., 1h, 30m, 1d)')
                        .setRequired(true)
                )
                .addBooleanOption(opt =>
                    opt.setName('embed')
                        .setDescription('Send as embed')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('repeat')
                        .setDescription('Repeat interval (e.g., 1d, 1w)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('reminder')
                .setDescription('Set a reminder')
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('Reminder message')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('duration')
                        .setDescription('Time until reminder (e.g., 1h, 30m, 1d)')
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel for reminder (defaults to current)')
                        .setRequired(false)
                )
                .addUserOption(opt =>
                    opt.setName('mention')
                        .setDescription('User to mention')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('lock')
                .setDescription('Schedule a channel lock')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to lock')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('duration')
                        .setDescription('Time until lock (e.g., 1h, 30m, 1d)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('unlock')
                .setDescription('Schedule a channel unlock')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to unlock')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('duration')
                        .setDescription('Time until unlock (e.g., 1h, 30m, 1d)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View scheduled actions')
                .addStringOption(opt =>
                    opt.setName('status')
                        .setDescription('Filter by status')
                        .addChoices(
                            { name: 'Pending', value: 'pending' },
                            { name: 'Completed', value: 'completed' },
                            { name: 'Failed', value: 'failed' },
                            { name: 'Cancelled', value: 'cancelled' }
                        )
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('cancel')
                .setDescription('Cancel a scheduled action')
                .addIntegerOption(opt =>
                    opt.setName('id')
                        .setDescription('Action ID to cancel')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const scheduler = interaction.client.scheduledActions;

        if (!scheduler) {
            return interaction.reply({
                content: '❌ Scheduled actions system is not available.',
                ephemeral: true
            });
        }

        switch (subcommand) {
            case 'unban':
                return this.scheduleUnban(interaction, scheduler);
            case 'unmute':
                return this.scheduleUnmute(interaction, scheduler);
            case 'role':
                return this.scheduleRole(interaction, scheduler);
            case 'announcement':
                return this.scheduleAnnouncement(interaction, scheduler);
            case 'reminder':
                return this.scheduleReminder(interaction, scheduler);
            case 'lock':
                return this.scheduleLock(interaction, scheduler);
            case 'unlock':
                return this.scheduleUnlock(interaction, scheduler);
            case 'list':
                return this.listActions(interaction, scheduler);
            case 'cancel':
                return this.cancelAction(interaction, scheduler);
        }
    },

    async scheduleUnban(interaction, scheduler) {
        const userId = interaction.options.getString('user_id');
        const durationStr = interaction.options.getString('duration');

        const duration = scheduler.parseDuration(durationStr);
        if (!duration) {
            return interaction.reply({
                content: '❌ Invalid duration format. Use: 1h, 30m, 1d, 1w, 1M',
                ephemeral: true
            });
        }

        const executeAt = new Date(Date.now() + duration.ms);

        const action = await scheduler.createAction({
            guildId: interaction.guild.id,
            actionType: 'unban',
            targetId: userId,
            targetType: 'user',
            scheduledBy: interaction.user.id,
            executeAt
        });

        const embed = new EmbedBuilder()
            .setTitle('⏰ Unban Scheduled')
            .setColor(0x00FF00)
            .addFields(
                { name: 'User ID', value: userId, inline: true },
                { name: 'Scheduled By', value: interaction.user.tag, inline: true },
                { name: 'Execute At', value: `<t:${Math.floor(executeAt.getTime() / 1000)}:F>`, inline: false },
                { name: 'Action ID', value: `#${action.id}`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async scheduleUnmute(interaction, scheduler) {
        const user = interaction.options.getUser('user');
        const durationStr = interaction.options.getString('duration');

        const duration = scheduler.parseDuration(durationStr);
        if (!duration) {
            return interaction.reply({
                content: '❌ Invalid duration format. Use: 1h, 30m, 1d, 1w, 1M',
                ephemeral: true
            });
        }

        const executeAt = new Date(Date.now() + duration.ms);

        const action = await scheduler.createAction({
            guildId: interaction.guild.id,
            actionType: 'unmute',
            targetId: user.id,
            targetType: 'user',
            scheduledBy: interaction.user.id,
            executeAt
        });

        const embed = new EmbedBuilder()
            .setTitle('⏰ Unmute Scheduled')
            .setColor(0x00FF00)
            .addFields(
                { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                { name: 'Execute At', value: `<t:${Math.floor(executeAt.getTime() / 1000)}:F>`, inline: true },
                { name: 'Action ID', value: `#${action.id}`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async scheduleRole(interaction, scheduler) {
        const user = interaction.options.getUser('user');
        const role = interaction.options.getRole('role');
        const action = interaction.options.getString('action');
        const durationStr = interaction.options.getString('duration');

        const duration = scheduler.parseDuration(durationStr);
        if (!duration) {
            return interaction.reply({
                content: '❌ Invalid duration format. Use: 1h, 30m, 1d, 1w, 1M',
                ephemeral: true
            });
        }

        const executeAt = new Date(Date.now() + duration.ms);

        const scheduled = await scheduler.createAction({
            guildId: interaction.guild.id,
            actionType: action === 'add' ? 'add_role' : 'remove_role',
            targetId: user.id,
            targetType: 'user',
            metadata: { role_id: role.id, role_name: role.name },
            scheduledBy: interaction.user.id,
            executeAt
        });

        const embed = new EmbedBuilder()
            .setTitle(`⏰ Role ${action === 'add' ? 'Addition' : 'Removal'} Scheduled`)
            .setColor(0x00FF00)
            .addFields(
                { name: 'User', value: `${user.tag}`, inline: true },
                { name: 'Role', value: `${role}`, inline: true },
                { name: 'Action', value: action === 'add' ? 'Add' : 'Remove', inline: true },
                { name: 'Execute At', value: `<t:${Math.floor(executeAt.getTime() / 1000)}:F>`, inline: true },
                { name: 'Action ID', value: `#${scheduled.id}`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async scheduleAnnouncement(interaction, scheduler) {
        const channel = interaction.options.getChannel('channel');
        const message = interaction.options.getString('message');
        const durationStr = interaction.options.getString('duration');
        const useEmbed = interaction.options.getBoolean('embed') ?? false;
        const repeatStr = interaction.options.getString('repeat');

        const duration = scheduler.parseDuration(durationStr);
        if (!duration) {
            return interaction.reply({
                content: '❌ Invalid duration format. Use: 1h, 30m, 1d, 1w, 1M',
                ephemeral: true
            });
        }

        let repeatInterval = null;
        let repeatUnit = null;
        if (repeatStr) {
            const repeat = scheduler.parseDuration(repeatStr);
            if (repeat) {
                repeatInterval = repeat.value;
                repeatUnit = repeat.unit;
            }
        }

        const executeAt = new Date(Date.now() + duration.ms);

        const action = await scheduler.createAction({
            guildId: interaction.guild.id,
            actionType: 'announcement',
            channelId: channel.id,
            message,
            metadata: { embed: useEmbed },
            scheduledBy: interaction.user.id,
            executeAt,
            repeatInterval,
            repeatUnit
        });

        const embed = new EmbedBuilder()
            .setTitle('⏰ Announcement Scheduled')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Channel', value: `${channel}`, inline: true },
                { name: 'Execute At', value: `<t:${Math.floor(executeAt.getTime() / 1000)}:F>`, inline: true },
                { name: 'Embed', value: useEmbed ? 'Yes' : 'No', inline: true },
                { name: 'Repeat', value: repeatStr || 'No', inline: true },
                { name: 'Action ID', value: `#${action.id}`, inline: true }
            )
            .setDescription(`**Message:**\n${message.slice(0, 200)}${message.length > 200 ? '...' : ''}`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async scheduleReminder(interaction, scheduler) {
        const message = interaction.options.getString('message');
        const durationStr = interaction.options.getString('duration');
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const mention = interaction.options.getUser('mention');

        const duration = scheduler.parseDuration(durationStr);
        if (!duration) {
            return interaction.reply({
                content: '❌ Invalid duration format. Use: 1h, 30m, 1d, 1w, 1M',
                ephemeral: true
            });
        }

        const executeAt = new Date(Date.now() + duration.ms);

        const action = await scheduler.createAction({
            guildId: interaction.guild.id,
            actionType: 'reminder',
            targetId: mention?.id || interaction.user.id,
            channelId: channel.id,
            message,
            metadata: { scheduled_by_tag: interaction.user.tag },
            scheduledBy: interaction.user.id,
            executeAt
        });

        const embed = new EmbedBuilder()
            .setTitle('⏰ Reminder Set')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Channel', value: `${channel}`, inline: true },
                { name: 'Remind At', value: `<t:${Math.floor(executeAt.getTime() / 1000)}:F>`, inline: true },
                { name: 'Mention', value: mention ? `${mention}` : 'You', inline: true },
                { name: 'Action ID', value: `#${action.id}`, inline: true }
            )
            .setDescription(`**Message:**\n${message}`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async scheduleLock(interaction, scheduler) {
        const channel = interaction.options.getChannel('channel');
        const durationStr = interaction.options.getString('duration');

        const duration = scheduler.parseDuration(durationStr);
        if (!duration) {
            return interaction.reply({
                content: '❌ Invalid duration format. Use: 1h, 30m, 1d, 1w, 1M',
                ephemeral: true
            });
        }

        const executeAt = new Date(Date.now() + duration.ms);

        const action = await scheduler.createAction({
            guildId: interaction.guild.id,
            actionType: 'lock_channel',
            channelId: channel.id,
            scheduledBy: interaction.user.id,
            executeAt
        });

        await interaction.reply({
            content: `⏰ Channel ${channel} will be locked <t:${Math.floor(executeAt.getTime() / 1000)}:R> (Action #${action.id})`,
            ephemeral: true
        });
    },

    async scheduleUnlock(interaction, scheduler) {
        const channel = interaction.options.getChannel('channel');
        const durationStr = interaction.options.getString('duration');

        const duration = scheduler.parseDuration(durationStr);
        if (!duration) {
            return interaction.reply({
                content: '❌ Invalid duration format. Use: 1h, 30m, 1d, 1w, 1M',
                ephemeral: true
            });
        }

        const executeAt = new Date(Date.now() + duration.ms);

        const action = await scheduler.createAction({
            guildId: interaction.guild.id,
            actionType: 'unlock_channel',
            channelId: channel.id,
            scheduledBy: interaction.user.id,
            executeAt
        });

        await interaction.reply({
            content: `⏰ Channel ${channel} will be unlocked <t:${Math.floor(executeAt.getTime() / 1000)}:R> (Action #${action.id})`,
            ephemeral: true
        });
    },

    async listActions(interaction, scheduler) {
        const status = interaction.options.getString('status');
        const actions = await scheduler.getGuildActions(interaction.guild.id, status, 15);

        if (actions.length === 0) {
            return interaction.reply({
                content: '📋 No scheduled actions found.',
                ephemeral: true
            });
        }

        const statusEmoji = {
            'pending': '⏳',
            'completed': '✅',
            'failed': '❌',
            'cancelled': '🚫'
        };

        const embed = new EmbedBuilder()
            .setTitle('📋 Scheduled Actions')
            .setColor(0x5865F2)
            .setTimestamp();

        let description = '';
        for (const action of actions) {
            const emoji = statusEmoji[action.status] || '❓';
            const execTime = new Date(action.execute_at);
            description += `${emoji} **#${action.id}** - ${action.action_type}\n`;
            description += `   <t:${Math.floor(execTime.getTime() / 1000)}:R> | By <@${action.scheduled_by}>\n`;
        }

        embed.setDescription(description);
        embed.setFooter({ text: `Showing ${actions.length} actions` });

        await interaction.reply({ embeds: [embed] });
    },

    async cancelAction(interaction, scheduler) {
        const actionId = interaction.options.getInteger('id');

        const action = await scheduler.getAction(actionId);
        if (!action) {
            return interaction.reply({
                content: '❌ Action not found.',
                ephemeral: true
            });
        }

        if (action.guild_id !== interaction.guild.id) {
            return interaction.reply({
                content: '❌ Action not found in this server.',
                ephemeral: true
            });
        }

        if (action.status !== 'pending') {
            return interaction.reply({
                content: `❌ Cannot cancel action with status: ${action.status}`,
                ephemeral: true
            });
        }

        const cancelled = await scheduler.cancelAction(actionId);

        if (cancelled) {
            await interaction.reply({
                content: `✅ Cancelled action #${actionId} (${action.action_type})`,
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: '❌ Failed to cancel action.',
                ephemeral: true
            });
        }
    }
};
