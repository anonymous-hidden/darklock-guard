const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

/**
 * /mod command - Consolidates all moderation actions
 * Replaces: ban, kick, timeout, warn, strike, purge, slowmode, lock, unlock, unban, redact
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('mod')
        .setDescription('🔨 Moderation actions')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        
        .addSubcommand(sub => sub
            .setName('ban')
            .setDescription('Ban a user from the server')
            .addUserOption(opt => opt.setName('user').setDescription('User to ban').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Ban reason'))
            .addIntegerOption(opt => opt.setName('delete_days').setDescription('Days of messages to delete (0-7)').setMinValue(0).setMaxValue(7)))
        
        .addSubcommand(sub => sub
            .setName('kick')
            .setDescription('Kick a user from the server')
            .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Kick reason')))
        
        .addSubcommand(sub => sub
            .setName('timeout')
            .setDescription('Timeout a user')
            .addUserOption(opt => opt.setName('user').setDescription('User to timeout').setRequired(true))
            .addIntegerOption(opt => opt.setName('duration').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
            .addStringOption(opt => opt.setName('reason').setDescription('Timeout reason')))
        
        .addSubcommand(sub => sub
            .setName('warn')
            .setDescription('Warn a user')
            .addUserOption(opt => opt.setName('user').setDescription('User to warn').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Warning reason').setRequired(true)))
        
        .addSubcommand(sub => sub
            .setName('strike')
            .setDescription('Issue a strike to a user')
            .addUserOption(opt => opt.setName('user').setDescription('User to strike').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Strike reason').setRequired(true))
            .addIntegerOption(opt => opt.setName('severity').setDescription('Severity level (1-3)').setMinValue(1).setMaxValue(3)))
        
        .addSubcommand(sub => sub
            .setName('purge')
            .setDescription('Delete multiple messages')
            .addIntegerOption(opt => opt.setName('amount').setDescription('Number of messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
            .addUserOption(opt => opt.setName('user').setDescription('Only delete messages from this user'))
            .addBooleanOption(opt => opt.setName('bots').setDescription('Only delete bot messages')))
        
        .addSubcommand(sub => sub
            .setName('slowmode')
            .setDescription('Set channel slowmode')
            .addIntegerOption(opt => opt.setName('seconds').setDescription('Slowmode delay (0 to disable)').setRequired(true).setMinValue(0).setMaxValue(21600))
            .addChannelOption(opt => opt.setName('channel').setDescription('Channel (default: current)')))
        
        .addSubcommand(sub => sub
            .setName('lock')
            .setDescription('Lock a channel')
            .addChannelOption(opt => opt.setName('channel').setDescription('Channel to lock (default: current)'))
            .addStringOption(opt => opt.setName('reason').setDescription('Lock reason')))
        
        .addSubcommand(sub => sub
            .setName('unlock')
            .setDescription('Unlock a channel')
            .addChannelOption(opt => opt.setName('channel').setDescription('Channel to unlock (default: current)')))
        
        .addSubcommand(sub => sub
            .setName('unban')
            .setDescription('Unban a user')
            .addStringOption(opt => opt.setName('user_id').setDescription('User ID to unban').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Unban reason')))
        
        .addSubcommand(sub => sub
            .setName('redact')
            .setDescription('Delete a message by ID')
            .addStringOption(opt => opt.setName('message_id').setDescription('Message ID to delete').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Deletion reason'))),

    async execute(interaction, bot) {
        const subcommand = interaction.options.getSubcommand();

        // Route to appropriate handler
        switch (subcommand) {
            case 'ban':
                return await this.handleBan(interaction, bot);
            case 'kick':
                return await this.handleKick(interaction, bot);
            case 'timeout':
                return await this.handleTimeout(interaction, bot);
            case 'warn':
                return await this.handleWarn(interaction, bot);
            case 'strike':
                return await this.handleStrike(interaction, bot);
            case 'purge':
                return await this.handlePurge(interaction, bot);
            case 'slowmode':
                return await this.handleSlowmode(interaction, bot);
            case 'lock':
                return await this.handleLock(interaction, bot);
            case 'unlock':
                return await this.handleUnlock(interaction, bot);
            case 'unban':
                return await this.handleUnban(interaction, bot);
            case 'redact':
                return await this.handleRedact(interaction, bot);
            default:
                return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
        }
    },

    async handleBan(interaction, bot) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: '❌ You need **Ban Members** permission.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const deleteDays = interaction.options.getInteger('delete_days') || 0;

        try {
            await interaction.guild.members.ban(user.id, { deleteMessageSeconds: deleteDays * 86400, reason });
            
            // Log to database
            await bot.database.run(
                `INSERT INTO mod_cases (guild_id, user_id, moderator_id, type, reason, timestamp) VALUES (?, ?, ?, 'BAN', ?, ?)`,
                [interaction.guild.id, user.id, interaction.user.id, reason, Date.now()]
            );

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🔨 User Banned')
                    .addFields(
                        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                        { name: 'Moderator', value: interaction.user.tag, inline: true },
                        { name: 'Reason', value: reason }
                    )
                    .setTimestamp()]
            });
        } catch (error) {
            bot.logger.error('[Mod Ban] Error:', error);
            return interaction.reply({ content: `❌ Failed to ban user: ${error.message}`, ephemeral: true });
        }
    },

    async handleKick(interaction, bot) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return interaction.reply({ content: '❌ You need **Kick Members** permission.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            const member = await interaction.guild.members.fetch(user.id);
            await member.kick(reason);
            
            await bot.database.run(
                `INSERT INTO mod_cases (guild_id, user_id, moderator_id, type, reason, timestamp) VALUES (?, ?, ?, 'KICK', ?, ?)`,
                [interaction.guild.id, user.id, interaction.user.id, reason, Date.now()]
            );

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('👢 User Kicked')
                    .addFields(
                        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                        { name: 'Moderator', value: interaction.user.tag, inline: true },
                        { name: 'Reason', value: reason }
                    )
                    .setTimestamp()]
            });
        } catch (error) {
            bot.logger.error('[Mod Kick] Error:', error);
            return interaction.reply({ content: `❌ Failed to kick user: ${error.message}`, ephemeral: true });
        }
    },

    async handleTimeout(interaction, bot) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: '❌ You need **Timeout Members** permission.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const duration = interaction.options.getInteger('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            const member = await interaction.guild.members.fetch(user.id);
            await member.timeout(duration * 60 * 1000, reason);
            
            await bot.database.run(
                `INSERT INTO mod_cases (guild_id, user_id, moderator_id, type, reason, duration, timestamp) VALUES (?, ?, ?, 'TIMEOUT', ?, ?, ?)`,
                [interaction.guild.id, user.id, interaction.user.id, reason, duration, Date.now()]
            );

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ffcc00')
                    .setTitle('⏱️ User Timed Out')
                    .addFields(
                        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                        { name: 'Duration', value: `${duration} minutes`, inline: true },
                        { name: 'Reason', value: reason }
                    )
                    .setTimestamp()]
            });
        } catch (error) {
            bot.logger.error('[Mod Timeout] Error:', error);
            return interaction.reply({ content: `❌ Failed to timeout user: ${error.message}`, ephemeral: true });
        }
    },

    async handleWarn(interaction, bot) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');

        try {
            await bot.database.run(
                `INSERT INTO mod_cases (guild_id, user_id, moderator_id, type, reason, timestamp) VALUES (?, ?, ?, 'WARN', ?, ?)`,
                [interaction.guild.id, user.id, interaction.user.id, reason, Date.now()]
            );

            // Count total warnings
            const warnings = await bot.database.get(
                `SELECT COUNT(*) as count FROM mod_cases WHERE guild_id = ? AND user_id = ? AND type = 'WARN'`,
                [interaction.guild.id, user.id]
            );

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ffcc00')
                    .setTitle('⚠️ User Warned')
                    .addFields(
                        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                        { name: 'Total Warnings', value: `${warnings.count}`, inline: true },
                        { name: 'Reason', value: reason }
                    )
                    .setTimestamp()]
            });
        } catch (error) {
            bot.logger.error('[Mod Warn] Error:', error);
            return interaction.reply({ content: `❌ Failed to warn user: ${error.message}`, ephemeral: true });
        }
    },

    async handleStrike(interaction, bot) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const severity = interaction.options.getInteger('severity') || 1;

        try {
            await bot.database.run(
                `INSERT INTO mod_cases (guild_id, user_id, moderator_id, type, reason, severity, timestamp) VALUES (?, ?, ?, 'STRIKE', ?, ?, ?)`,
                [interaction.guild.id, user.id, interaction.user.id, reason, severity, Date.now()]
            );

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('⚡ Strike Issued')
                    .addFields(
                        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                        { name: 'Severity', value: `Level ${severity}`, inline: true },
                        { name: 'Reason', value: reason }
                    )
                    .setTimestamp()]
            });
        } catch (error) {
            bot.logger.error('[Mod Strike] Error:', error);
            return interaction.reply({ content: `❌ Failed to issue strike: ${error.message}`, ephemeral: true });
        }
    },

    async handlePurge(interaction, bot) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: '❌ You need **Manage Messages** permission.', ephemeral: true });
        }

        const amount = interaction.options.getInteger('amount');
        const targetUser = interaction.options.getUser('user');
        const botsOnly = interaction.options.getBoolean('bots') || false;

        await interaction.deferReply({ ephemeral: true });

        try {
            const messages = await interaction.channel.messages.fetch({ limit: amount + 1 });
            let filtered = [...messages.values()].slice(1); // Skip the command message

            if (targetUser) {
                filtered = filtered.filter(m => m.author.id === targetUser.id);
            }
            if (botsOnly) {
                filtered = filtered.filter(m => m.author.bot);
            }

            await interaction.channel.bulkDelete(filtered, true);

            return interaction.editReply({
                content: `✅ Successfully deleted ${filtered.length} message(s).`
            });
        } catch (error) {
            bot.logger.error('[Mod Purge] Error:', error);
            return interaction.editReply({ content: `❌ Failed to purge messages: ${error.message}` });
        }
    },

    async handleSlowmode(interaction, bot) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ content: '❌ You need **Manage Channels** permission.', ephemeral: true });
        }

        const seconds = interaction.options.getInteger('seconds');
        const channel = interaction.options.getChannel('channel') || interaction.channel;

        try {
            await channel.setRateLimitPerUser(seconds);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('🐢 Slowmode Updated')
                    .addFields(
                        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                        { name: 'Delay', value: seconds === 0 ? 'Disabled' : `${seconds} seconds`, inline: true }
                    )
                    .setTimestamp()]
            });
        } catch (error) {
            bot.logger.error('[Mod Slowmode] Error:', error);
            return interaction.reply({ content: `❌ Failed to set slowmode: ${error.message}`, ephemeral: true });
        }
    },

    async handleLock(interaction, bot) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ content: '❌ You need **Manage Channels** permission.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: false
            });

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🔒 Channel Locked')
                    .addFields(
                        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                        { name: 'Reason', value: reason }
                    )
                    .setTimestamp()]
            });
        } catch (error) {
            bot.logger.error('[Mod Lock] Error:', error);
            return interaction.reply({ content: `❌ Failed to lock channel: ${error.message}`, ephemeral: true });
        }
    },

    async handleUnlock(interaction, bot) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ content: '❌ You need **Manage Channels** permission.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel') || interaction.channel;

        try {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: null
            });

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('🔓 Channel Unlocked')
                    .addFields(
                        { name: 'Channel', value: `<#${channel.id}>` }
                    )
                    .setTimestamp()]
            });
        } catch (error) {
            bot.logger.error('[Mod Unlock] Error:', error);
            return interaction.reply({ content: `❌ Failed to unlock channel: ${error.message}`, ephemeral: true });
        }
    },

    async handleUnban(interaction, bot) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: '❌ You need **Ban Members** permission.', ephemeral: true });
        }

        const userId = interaction.options.getString('user_id');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            await interaction.guild.members.unban(userId, reason);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('✅ User Unbanned')
                    .addFields(
                        { name: 'User ID', value: userId, inline: true },
                        { name: 'Reason', value: reason }
                    )
                    .setTimestamp()]
            });
        } catch (error) {
            bot.logger.error('[Mod Unban] Error:', error);
            return interaction.reply({ content: `❌ Failed to unban user: ${error.message}`, ephemeral: true });
        }
    },

    async handleRedact(interaction, bot) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: '❌ You need **Manage Messages** permission.', ephemeral: true });
        }

        const messageId = interaction.options.getString('message_id');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            const message = await interaction.channel.messages.fetch(messageId);
            await message.delete();

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('🗑️ Message Deleted')
                    .addFields(
                        { name: 'Message ID', value: messageId, inline: true },
                        { name: 'Reason', value: reason }
                    )
                    .setTimestamp()],
                ephemeral: true
            });
        } catch (error) {
            bot.logger.error('[Mod Redact] Error:', error);
            return interaction.reply({ content: `❌ Failed to delete message: ${error.message}`, ephemeral: true });
        }
    }
};
