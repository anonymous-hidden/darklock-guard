const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strike')
        .setDescription('Strike/points system management')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Add a strike to a user')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('User to strike')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for the strike')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('type')
                .setDescription('Type of offense')
                .setRequired(false)
                .addChoices(
                    { name: 'Minor (1pt)', value: 'minor' },
                    { name: 'Spam (1pt)', value: 'spam' },
                    { name: 'Toxicity (2pts)', value: 'toxicity' },
                    { name: 'Advertising (2pts)', value: 'advertising' },
                    { name: 'Moderate (2pts)', value: 'moderate' },
                    { name: 'Harassment (3pts)', value: 'harassment' },
                    { name: 'NSFW (3pts)', value: 'nsfw' },
                    { name: 'Slur/Hate Speech (4pts)', value: 'slur' },
                    { name: 'Severe (4pts)', value: 'severe' },
                    { name: 'Scam (5pts)', value: 'scam' },
                    { name: 'Raid (5pts)', value: 'raid' }
                ))
            .addIntegerOption(opt => opt
                .setName('points')
                .setDescription('Custom point value (overrides type)')
                .setMinValue(1)
                .setMaxValue(100))
            .addStringOption(opt => opt
                .setName('evidence')
                .setDescription('Evidence (message link, image URL, etc.)')))
        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Remove a specific strike')
            .addIntegerOption(opt => opt
                .setName('strike_id')
                .setDescription('Strike ID to remove')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for removal')))
        .addSubcommand(sub => sub
            .setName('clear')
            .setDescription('Clear all strikes for a user')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('User to clear strikes for')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for clearing')))
        .addSubcommand(sub => sub
            .setName('check')
            .setDescription('Check strikes for a user')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('User to check')
                .setRequired(true))
            .addBooleanOption(opt => opt
                .setName('all')
                .setDescription('Include removed/expired strikes')))
        .addSubcommand(sub => sub
            .setName('leaderboard')
            .setDescription('View users with most strike points'))
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Setup the strike system')
            .addChannelOption(opt => opt
                .setName('log_channel')
                .setDescription('Channel to log strikes')
                .setRequired(true))
            .addIntegerOption(opt => opt
                .setName('decay_days')
                .setDescription('Days until strikes decay (0 = never)')
                .setMinValue(0)
                .setMaxValue(365)))
        .addSubcommand(sub => sub
            .setName('thresholds')
            .setDescription('View or manage strike thresholds'))
        .addSubcommand(sub => sub
            .setName('setthreshold')
            .setDescription('Set an action threshold')
            .addIntegerOption(opt => opt
                .setName('points')
                .setDescription('Points required to trigger')
                .setRequired(true)
                .setMinValue(1))
            .addStringOption(opt => opt
                .setName('action')
                .setDescription('Action to take')
                .setRequired(true)
                .addChoices(
                    { name: 'Warn', value: 'warn' },
                    { name: 'Timeout', value: 'timeout' },
                    { name: 'Kick', value: 'kick' },
                    { name: 'Ban', value: 'ban' }
                ))
            .addIntegerOption(opt => opt
                .setName('duration')
                .setDescription('Duration in minutes (for timeout)')
                .setMinValue(1)
                .setMaxValue(40320)))
        .addSubcommand(sub => sub
            .setName('removethreshold')
            .setDescription('Remove a threshold')
            .addIntegerOption(opt => opt
                .setName('points')
                .setDescription('Points threshold to remove')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('offenses')
            .setDescription('View configured offense point values')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const strikeSystem = interaction.client.strikeSystem;

        if (!strikeSystem) {
            return interaction.reply({ content: '❌ Strike system is not initialized.', ephemeral: true });
        }

        switch (sub) {
            case 'add':
                return this.handleAdd(interaction, strikeSystem);
            case 'remove':
                return this.handleRemove(interaction, strikeSystem);
            case 'clear':
                return this.handleClear(interaction, strikeSystem);
            case 'check':
                return this.handleCheck(interaction, strikeSystem);
            case 'leaderboard':
                return this.handleLeaderboard(interaction, strikeSystem);
            case 'setup':
                return this.handleSetup(interaction, strikeSystem);
            case 'thresholds':
                return this.handleThresholds(interaction, strikeSystem);
            case 'setthreshold':
                return this.handleSetThreshold(interaction, strikeSystem);
            case 'removethreshold':
                return this.handleRemoveThreshold(interaction, strikeSystem);
            case 'offenses':
                return this.handleOffenses(interaction, strikeSystem);
        }
    },

    async handleAdd(interaction, strikeSystem) {
        const config = await strikeSystem.getConfig(interaction.guildId);
        if (!config?.enabled) {
            return interaction.reply({ content: '❌ Strike system is not setup. Use `/strike setup` first.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const offenseType = interaction.options.getString('type');
        const customPoints = interaction.options.getInteger('points');
        const evidence = interaction.options.getString('evidence');

        if (user.id === interaction.user.id) {
            return interaction.reply({ content: '❌ You cannot strike yourself.', ephemeral: true });
        }

        if (user.bot) {
            return interaction.reply({ content: '❌ You cannot strike bots.', ephemeral: true });
        }

        await interaction.deferReply();

        const result = await strikeSystem.addStrike(interaction.guildId, user.id, interaction.user.id, {
            reason,
            offenseType,
            points: customPoints,
            evidence
        });

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Strike Added')
            .setColor(0xFFA500)
            .addFields(
                { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                { name: 'Points Added', value: `+${result.points}`, inline: true },
                { name: 'Total Points', value: `${result.totalPoints}`, inline: true },
                { name: 'Strike ID', value: `#${result.strikeId}`, inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setTimestamp();

        if (offenseType) {
            embed.addFields({ name: 'Offense Type', value: offenseType, inline: true });
        }

        if (result.actionTaken) {
            embed.addFields({ name: '⚡ Auto-Action Triggered', value: result.actionTaken, inline: false });
            embed.setColor(0xFF0000);
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleRemove(interaction, strikeSystem) {
        const strikeId = interaction.options.getInteger('strike_id');
        const reason = interaction.options.getString('reason');

        await interaction.deferReply();

        // Get strike info first
        const strike = await new Promise((resolve, reject) => {
            strikeSystem.db.get(
                'SELECT * FROM user_strikes WHERE id = ? AND guild_id = ?',
                [strikeId, interaction.guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!strike) {
            return interaction.editReply({ content: '❌ Strike not found.', embeds: [] });
        }

        if (strike.removed) {
            return interaction.editReply({ content: '❌ Strike is already removed.', embeds: [] });
        }

        const success = await strikeSystem.removeStrike(strikeId, interaction.user.id, reason);
        await strikeSystem.updateUserTotals(interaction.guildId, strike.user_id);

        if (success) {
            const embed = new EmbedBuilder()
                .setTitle('✅ Strike Removed')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'Strike ID', value: `#${strikeId}`, inline: true },
                    { name: 'User', value: `<@${strike.user_id}>`, inline: true },
                    { name: 'Original Points', value: `${strike.points}`, inline: true }
                )
                .setTimestamp();

            if (reason) {
                embed.addFields({ name: 'Removal Reason', value: reason, inline: false });
            }

            return interaction.editReply({ embeds: [embed] });
        } else {
            return interaction.editReply({ content: '❌ Failed to remove strike.', embeds: [] });
        }
    },

    async handleClear(interaction, strikeSystem) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');

        await interaction.deferReply();

        const count = await strikeSystem.clearStrikes(interaction.guildId, user.id, interaction.user.id, reason);

        const embed = new EmbedBuilder()
            .setTitle('🧹 Strikes Cleared')
            .setColor(0x00FF00)
            .addFields(
                { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                { name: 'Strikes Cleared', value: `${count}`, inline: true }
            )
            .setTimestamp();

        if (reason) {
            embed.addFields({ name: 'Reason', value: reason, inline: false });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleCheck(interaction, strikeSystem) {
        const user = interaction.options.getUser('user');
        const includeAll = interaction.options.getBoolean('all') ?? false;

        await interaction.deferReply();

        const totals = await strikeSystem.getUserTotals(interaction.guildId, user.id);
        const strikes = await strikeSystem.getUserStrikes(interaction.guildId, user.id, includeAll);

        const embed = new EmbedBuilder()
            .setTitle(`📋 Strike Record: ${user.tag}`)
            .setColor(totals.active_points > 0 ? 0xFFA500 : 0x00FF00)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: 'Active Points', value: `${totals.active_points}`, inline: true },
                { name: 'Active Strikes', value: `${totals.active_strikes}`, inline: true },
                { name: 'Total (All Time)', value: `${totals.total_points} pts / ${totals.total_strikes} strikes`, inline: true }
            )
            .setTimestamp();

        if (strikes.length > 0) {
            const strikeList = strikes.slice(0, 10).map(s => {
                const status = s.removed ? '❌' : (s.expires_at && new Date(s.expires_at) < new Date() ? '⏰' : '✅');
                return `${status} **#${s.id}** - ${s.points}pts - ${s.reason || 'No reason'} (${new Date(s.created_at).toLocaleDateString()})`;
            }).join('\n');

            embed.addFields({ name: 'Recent Strikes', value: strikeList, inline: false });

            if (strikes.length > 10) {
                embed.setFooter({ text: `Showing 10 of ${strikes.length} strikes` });
            }
        } else {
            embed.addFields({ name: 'Strikes', value: 'No strikes on record', inline: false });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleLeaderboard(interaction, strikeSystem) {
        await interaction.deferReply();

        const leaders = await strikeSystem.getLeaderboard(interaction.guildId, 10);

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Strike Leaderboard')
            .setColor(0xFFA500)
            .setTimestamp();

        if (leaders.length === 0) {
            embed.setDescription('No users have active strikes!');
        } else {
            const list = await Promise.all(leaders.map(async (entry, i) => {
                const user = await interaction.client.users.fetch(entry.user_id).catch(() => null);
                const name = user ? user.tag : `Unknown (${entry.user_id})`;
                return `**${i + 1}.** ${name} - **${entry.active_points}** points (${entry.active_strikes} strikes)`;
            }));

            embed.setDescription(list.join('\n'));
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleSetup(interaction, strikeSystem) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Only administrators can setup the strike system.', ephemeral: true });
        }

        const logChannel = interaction.options.getChannel('log_channel');
        const decayDays = interaction.options.getInteger('decay_days') ?? 30;

        await interaction.deferReply();

        await strikeSystem.setup(interaction.guildId, {
            logChannelId: logChannel.id,
            decayDays
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ Strike System Setup')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Log Channel', value: `<#${logChannel.id}>`, inline: true },
                { name: 'Strike Decay', value: decayDays > 0 ? `${decayDays} days` : 'Disabled', inline: true }
            )
            .setDescription('Default offense values and thresholds have been configured.\nUse `/strike offenses` and `/strike thresholds` to view them.')
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    },

    async handleThresholds(interaction, strikeSystem) {
        await interaction.deferReply();

        const thresholds = await strikeSystem.getThresholds(interaction.guildId);

        const embed = new EmbedBuilder()
            .setTitle('⚡ Strike Thresholds')
            .setColor(0xFF6600)
            .setTimestamp();

        if (thresholds.length === 0) {
            embed.setDescription('No thresholds configured.');
        } else {
            const list = thresholds.map(t => {
                let action = t.action_type;
                if (t.action_type === 'timeout' && t.action_duration) {
                    action += ` (${Math.floor(t.action_duration / 60)} mins)`;
                }
                return `**${t.points_required} points** → ${action.charAt(0).toUpperCase() + action.slice(1)}`;
            }).join('\n');

            embed.setDescription(list);
        }

        embed.setFooter({ text: 'Use /strike setthreshold to modify' });

        return interaction.editReply({ embeds: [embed] });
    },

    async handleSetThreshold(interaction, strikeSystem) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Only administrators can modify thresholds.', ephemeral: true });
        }

        const points = interaction.options.getInteger('points');
        const action = interaction.options.getString('action');
        const duration = interaction.options.getInteger('duration');

        await interaction.deferReply();

        const durationSeconds = action === 'timeout' && duration ? duration * 60 : null;
        await strikeSystem.setThreshold(interaction.guildId, points, action, durationSeconds);

        const embed = new EmbedBuilder()
            .setTitle('✅ Threshold Set')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Points', value: `${points}`, inline: true },
                { name: 'Action', value: action.charAt(0).toUpperCase() + action.slice(1), inline: true }
            )
            .setTimestamp();

        if (durationSeconds) {
            embed.addFields({ name: 'Duration', value: `${duration} minutes`, inline: true });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleRemoveThreshold(interaction, strikeSystem) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Only administrators can modify thresholds.', ephemeral: true });
        }

        const points = interaction.options.getInteger('points');

        await interaction.deferReply();

        const removed = await strikeSystem.removeThreshold(interaction.guildId, points);

        if (removed) {
            return interaction.editReply({ content: `✅ Threshold at ${points} points removed.` });
        } else {
            return interaction.editReply({ content: `❌ No threshold found at ${points} points.` });
        }
    },

    async handleOffenses(interaction, strikeSystem) {
        await interaction.deferReply();

        const offenses = await strikeSystem.getAllOffenseValues(interaction.guildId);

        const embed = new EmbedBuilder()
            .setTitle('📋 Offense Point Values')
            .setColor(0x0099FF)
            .setTimestamp();

        if (offenses.length === 0) {
            embed.setDescription('No offense values configured. Run `/strike setup` first.');
        } else {
            const list = offenses.map(o => 
                `**${o.offense_type}** - ${o.points} point${o.points !== 1 ? 's' : ''}\n↳ ${o.description || 'No description'}`
            ).join('\n\n');

            embed.setDescription(list);
        }

        return interaction.editReply({ embeds: [embed] });
    }
};
