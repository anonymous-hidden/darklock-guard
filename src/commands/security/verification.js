const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verification')
        .setDescription('Set up and enable user verification')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Configure and enable verification system')
            .addChannelOption(opt => opt.setName('channel').setDescription('Verification channel').setRequired(true))
            .addChannelOption(opt => opt.setName('log_channel').setDescription('Channel to post moderation/verification logs').setRequired(true))
            .addRoleOption(opt => opt.setName('unverified_role').setDescription('Role for unverified members').setRequired(true))
            .addRoleOption(opt => opt.setName('verified_role').setDescription('Role for verified members').setRequired(true))
            .addStringOption(opt => opt.setName('method').setDescription('Verification method').addChoices(
                { name: 'Button Click', value: 'button' },
                { name: 'CAPTCHA Code', value: 'captcha' },
                { name: 'Emoji Reaction', value: 'reaction' },
                { name: 'Web Portal', value: 'web' },
                { name: 'Auto (Risk-based)', value: 'auto' }
            ).setRequired(true))
        ),

    async execute(interaction, bot) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'You need Manage Server or Administrator to configure verification.', ephemeral: true });
        }

        if (subcommand === 'setup') {
            try {
                await interaction.deferReply();

                const channel = interaction.options.getChannel('channel');
                const logChannel = interaction.options.getChannel('log_channel');
                const unverifiedRole = interaction.options.getRole('unverified_role');
                const verifiedRole = interaction.options.getRole('verified_role');
                const method = interaction.options.getString('method');

                // Update guild config with all verification settings
                await bot.database.run(`
                    INSERT INTO guild_configs (guild_id, verification_enabled, verification_method, unverified_role_id, verified_role_id, mod_log_channel)
                    VALUES (?, 1, ?, ?, ?, ?)
                    ON CONFLICT(guild_id) DO UPDATE SET
                        verification_enabled = 1,
                        verification_method = excluded.verification_method,
                        unverified_role_id = excluded.unverified_role_id,
                        verified_role_id = excluded.verified_role_id,
                        mod_log_channel = excluded.mod_log_channel,
                        updated_at = CURRENT_TIMESTAMP
                `, [guildId, method, unverifiedRole.id, verifiedRole.id, logChannel.id]);

                // Emit change for dynamic command sync
                if (typeof bot.emitSettingChange === 'function') {
                    await bot.emitSettingChange(guildId, interaction.user.id, 'verification_enabled', 1);
                }

                // Configure channel permissions
                // 1. Allow unverified role in verification channel
                await channel.permissionOverwrites.edit(unverifiedRole.id, {
                    ViewChannel: true,
                    SendMessages: true
                }).catch(() => {});

                // 2. Hide verification channel from verified role
                await channel.permissionOverwrites.edit(verifiedRole.id, {
                    ViewChannel: false
                }).catch(() => {});

                // 3. Restrict unverified from all other channels
                const textChannels = interaction.guild.channels.cache.filter(ch => ch.type === 0 && ch.id !== channel.id);
                for (const [, ch] of textChannels) {
                    await ch.permissionOverwrites.edit(unverifiedRole.id, {
                        ViewChannel: false,
                        SendMessages: false
                    }).catch(() => {});
                }

                // 4. Restrict categories too (inheritance)
                const categories = interaction.guild.channels.cache.filter(c => c.type === 4);
                for (const [, category] of categories) {
                    await category.permissionOverwrites.edit(unverifiedRole.id, {
                        ViewChannel: false
                    }).catch(() => {});
                }

                // Send setup instructions to verification channel
                const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                
                const instructionEmbed = new EmbedBuilder()
                    .setTitle('🔐 Welcome to DarkLock support server')
                    .setDescription(`Before you can access the rest of the server, please complete verification to confirm you're a real person.

**How to Verify:**
You should receive a DM with verification instructions. This helps us keep the community safe and free from bots and spam.

**What happens next:**
✅ You'll complete a quick verification step
✅ You'll receive the verified role automatically
✅ You'll gain access to all server channels

**Need Help?**
If you're having trouble verifying, please contact a staff member.

*Didn't receive a DM? Click the button below to verify manually.*

───────────────────────────────
*This verification system protects our community and only takes a few seconds.*`)
                    .setColor('#00d4ff')
                    .setTimestamp();

                const verifyButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('verify_button')
                            .setLabel('✅ Verify')
                            .setStyle(ButtonStyle.Success)
                    );

                await channel.send({ embeds: [instructionEmbed], components: [verifyButton] }).catch(() => {});

                const embed = new EmbedBuilder()
                    .setColor('#00d4ff')
                    .setTitle('✅ Verification System Configured')
                    .setDescription(`Verification is now **ENABLED** using **${method}** method.`)
                    .addFields(
                        { name: 'Verification Channel', value: channel.toString(), inline: false },
                        { name: 'Log Channel', value: logChannel.toString(), inline: false },
                        { name: 'Unverified Role', value: unverifiedRole.toString(), inline: true },
                        { name: 'Verified Role', value: verifiedRole.toString(), inline: true },
                        { name: 'Method', value: method, inline: true }
                    )
                    .setFooter({ text: 'Permissions configured: unverified users restricted to verification channel only' })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });

            } catch (error) {
                bot.logger?.error && bot.logger.error('Verification setup error:', error);
                if (interaction.deferred) {
                    await interaction.editReply({ content: '❌ An error occurred while setting up verification.' });
                } else {
                    await interaction.reply({ content: '❌ An error occurred while setting up verification.', ephemeral: true });
                }
            }
        }
    }
};
