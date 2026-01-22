const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invites')
        .setDescription('Invite tracking commands')
        .addSubcommand(sub =>
            sub.setName('check')
                .setDescription('Check invite stats for a user')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to check (defaults to yourself)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('View the invite leaderboard')
        )
        .addSubcommand(sub =>
            sub.setName('who')
                .setDescription('Check who invited a user')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to check')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List users invited by someone')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to check (defaults to yourself)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('bonus')
                .setDescription('Add or remove bonus invites (Admin only)')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to modify')
                        .setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt.setName('amount')
                        .setDescription('Amount to add (negative to remove)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('reset')
                .setDescription('Reset invite stats (Admin only)')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to reset (leave empty to reset all)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Setup invite tracking (Admin only)')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to log invite events')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('toggle')
                .setDescription('Enable or disable invite tracking (Admin only)')
                .addBooleanOption(opt =>
                    opt.setName('enabled')
                        .setDescription('Enable or disable')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const tracker = interaction.client.inviteTracker;

        if (!tracker) {
            return interaction.reply({
                content: '❌ Invite tracking system is not available.',
                ephemeral: true
            });
        }

        switch (subcommand) {
            case 'check':
                return this.checkInvites(interaction, tracker);
            case 'leaderboard':
                return this.showLeaderboard(interaction, tracker);
            case 'who':
                return this.whoInvited(interaction, tracker);
            case 'list':
                return this.listInvited(interaction, tracker);
            case 'bonus':
                return this.addBonus(interaction, tracker);
            case 'reset':
                return this.resetStats(interaction, tracker);
            case 'setup':
                return this.setup(interaction, tracker);
            case 'toggle':
                return this.toggle(interaction, tracker);
        }
    },

    async checkInvites(interaction, tracker) {
        const user = interaction.options.getUser('user') || interaction.user;
        const stats = await tracker.getInviterStats(interaction.guild.id, user.id);
        
        const effective = stats.regular_invites + stats.bonus_invites - stats.fake_invites - stats.left_invites;

        const embed = new EmbedBuilder()
            .setTitle(`📊 Invite Stats for ${user.tag}`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setColor(0x5865F2)
            .addFields(
                { name: '✨ Total Invites', value: `**${effective}**`, inline: true },
                { name: '📥 Regular', value: `${stats.regular_invites}`, inline: true },
                { name: '🎁 Bonus', value: `${stats.bonus_invites}`, inline: true },
                { name: '🤖 Fake', value: `${stats.fake_invites}`, inline: true },
                { name: '📤 Left', value: `${stats.left_invites}`, inline: true },
                { name: '📈 Total Tracked', value: `${stats.total_invites}`, inline: true }
            )
            .setFooter({ text: `Effective = Regular + Bonus - Fake - Left` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async showLeaderboard(interaction, tracker) {
        const leaderboard = await tracker.getLeaderboard(interaction.guild.id, 15);

        if (leaderboard.length === 0) {
            return interaction.reply({
                content: '📊 No invite data available yet.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏆 Invite Leaderboard`)
            .setColor(0xFFD700)
            .setTimestamp();

        let description = '';
        for (let i = 0; i < leaderboard.length; i++) {
            const entry = leaderboard[i];
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
            description += `${medal} <@${entry.inviter_id}> - **${entry.effective_invites}** invites\n`;
            description += `   ↳ ${entry.regular_invites} regular, ${entry.bonus_invites} bonus, ${entry.fake_invites} fake, ${entry.left_invites} left\n`;
        }

        embed.setDescription(description);
        await interaction.reply({ embeds: [embed] });
    },

    async whoInvited(interaction, tracker) {
        const user = interaction.options.getUser('user');
        const inviterId = await tracker.getInviter(interaction.guild.id, user.id);

        if (!inviterId) {
            return interaction.reply({
                content: `❓ Could not determine who invited ${user.tag}.`,
                ephemeral: true
            });
        }

        const inviter = await interaction.client.users.fetch(inviterId).catch(() => null);
        const joinRecord = await tracker.getJoinRecord(interaction.guild.id, user.id);

        const embed = new EmbedBuilder()
            .setTitle(`📋 Invite Info for ${user.tag}`)
            .setColor(0x5865F2)
            .addFields(
                { name: 'Invited By', value: inviter ? `${inviter.tag} (${inviter.id})` : inviterId, inline: false },
                { name: 'Join Type', value: joinRecord?.join_type || 'Unknown', inline: true },
                { name: 'Invite Code', value: joinRecord?.invite_code || 'Unknown', inline: true },
                { name: 'Account Age at Join', value: `${joinRecord?.account_age_days || 'Unknown'} days`, inline: true }
            )
            .setTimestamp();

        if (joinRecord?.is_fake) {
            embed.setDescription('⚠️ This account was flagged as suspicious at join time');
        }

        await interaction.reply({ embeds: [embed] });
    },

    async listInvited(interaction, tracker) {
        const user = interaction.options.getUser('user') || interaction.user;
        const invited = await tracker.getInvitedUsers(interaction.guild.id, user.id);

        if (invited.length === 0) {
            return interaction.reply({
                content: `📋 ${user.tag} hasn't invited anyone yet.`,
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`📋 Users Invited by ${user.tag}`)
            .setColor(0x5865F2)
            .setTimestamp();

        // Show first 20
        const displayed = invited.slice(0, 20);
        let description = '';

        for (const record of displayed) {
            const status = record.left_at ? '❌ Left' : '✅ Still here';
            const fake = record.is_fake ? '⚠️' : '';
            description += `<@${record.user_id}> ${fake} - ${status}\n`;
        }

        if (invited.length > 20) {
            description += `\n... and ${invited.length - 20} more`;
        }

        embed.setDescription(description);
        embed.setFooter({ text: `Total: ${invited.length} users invited` });

        await interaction.reply({ embeds: [embed] });
    },

    async addBonus(interaction, tracker) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You need Administrator permission to manage bonus invites.',
                ephemeral: true
            });
        }

        const user = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        await tracker.addBonusInvites(interaction.guild.id, user.id, amount);

        const stats = await tracker.getInviterStats(interaction.guild.id, user.id);

        await interaction.reply({
            content: `✅ ${amount >= 0 ? 'Added' : 'Removed'} **${Math.abs(amount)}** bonus invites ${amount >= 0 ? 'to' : 'from'} ${user.tag}.\nNew bonus total: **${stats.bonus_invites}**`,
            ephemeral: true
        });
    },

    async resetStats(interaction, tracker) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You need Administrator permission to reset invite stats.',
                ephemeral: true
            });
        }

        const user = interaction.options.getUser('user');

        if (user) {
            await tracker.resetInviterStats(interaction.guild.id, user.id);
            await interaction.reply({
                content: `✅ Reset invite stats for ${user.tag}.`,
                ephemeral: true
            });
        } else {
            await tracker.resetInviterStats(interaction.guild.id);
            await interaction.reply({
                content: `✅ Reset all invite stats for this server.`,
                ephemeral: true
            });
        }
    },

    async setup(interaction, tracker) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You need Administrator permission to setup invite tracking.',
                ephemeral: true
            });
        }

        const channel = interaction.options.getChannel('channel');

        await tracker.setLogChannel(interaction.guild.id, channel.id);
        await tracker.setEnabled(interaction.guild.id, true);
        
        // Cache invites for this guild
        await tracker.cacheGuildInvites(interaction.guild);

        await interaction.reply({
            content: `✅ Invite tracking has been set up!\n📋 Log channel: ${channel}\n\nJoin and leave events will now be logged with invite information.`,
            ephemeral: true
        });
    },

    async toggle(interaction, tracker) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You need Administrator permission to toggle invite tracking.',
                ephemeral: true
            });
        }

        const enabled = interaction.options.getBoolean('enabled');

        await tracker.setEnabled(interaction.guild.id, enabled);

        if (enabled) {
            await tracker.cacheGuildInvites(interaction.guild);
        }

        await interaction.reply({
            content: `✅ Invite tracking has been **${enabled ? 'enabled' : 'disabled'}**.`,
            ephemeral: true
        });
    }
};
