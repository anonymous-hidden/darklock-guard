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
        // CRITICAL: Defer immediately to prevent 3-second timeout
        await interaction.deferReply({ flags: 64 }); // 64 = MessageFlags.Ephemeral

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply({ content: 'You need Manage Server or Administrator to configure verification.' });
        }

        if (subcommand === 'setup') {
            try {

                const channel = interaction.options.getChannel('channel');
                const logChannel = interaction.options.getChannel('log_channel');
                const unverifiedRole = interaction.options.getRole('unverified_role');
                const verifiedRole = interaction.options.getRole('verified_role');
                const method = interaction.options.getString('method');

                // Update guild config with all verification settings
                await bot.database.run(`
                    INSERT INTO guild_configs (guild_id, verification_enabled, verification_method, unverified_role_id, verified_role_id, mod_log_channel, verification_channel_id)
                    VALUES (?, 1, ?, ?, ?, ?, ?)
                    ON CONFLICT(guild_id) DO UPDATE SET
                        verification_enabled = 1,
                        verification_method = excluded.verification_method,
                        unverified_role_id = excluded.unverified_role_id,
                        verified_role_id = excluded.verified_role_id,
                        mod_log_channel = excluded.mod_log_channel,
                        verification_channel_id = excluded.verification_channel_id,
                        updated_at = CURRENT_TIMESTAMP
                `, [guildId, method, unverifiedRole.id, verifiedRole.id, logChannel.id, channel.id]);

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

                // 3. Restrict unverified from all other channels (text/voice/stage/forum/media)
                const blockedTypes = new Set([
                    0,  // GUILD_TEXT
                    2,  // GUILD_VOICE
                    5,  // GUILD_ANNOUNCEMENT
                    13, // GUILD_STAGE_VOICE
                    15, // GUILD_FORUM
                    16  // GUILD_MEDIA
                ]);

                const otherChannels = interaction.guild.channels.cache.filter(ch => blockedTypes.has(ch.type) && ch.id !== channel.id);
                for (const [, ch] of otherChannels) {
                    await ch.permissionOverwrites.edit(unverifiedRole.id, {
                        ViewChannel: false,
                        SendMessages: false,
                        SendMessagesInThreads: false,
                        Connect: false,
                        Speak: false
                    }).catch(() => {});
                }

                // 4. Restrict categories too (inheritance)
                const categories = interaction.guild.channels.cache.filter(c => c.type === 4);
                for (const [, category] of categories) {
                    await category.permissionOverwrites.edit(unverifiedRole.id, {
                        ViewChannel: false
                    }).catch(() => {});
                }

                // Send setup instructions to verification channel based on method
                const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                
                let instructionEmbed;
                let verifyButton;

                // Delete old verification bot messages in the channel to avoid stale buttons
                try {
                    const oldMessages = await channel.messages.fetch({ limit: 50 });
                    const botMessages = oldMessages.filter(m =>
                        m.author.id === interaction.client.user.id &&
                        m.embeds.some(e => (e.title || '').includes('Verification'))
                    );
                    if (botMessages.size > 0) {
                        await channel.bulkDelete(botMessages, true).catch(() => {
                            // Fallback: delete individually (messages older than 14 days can't be bulk deleted)
                            botMessages.forEach(m => m.delete().catch(() => {}));
                        });
                    }
                } catch (cleanupErr) {
                    bot.logger?.warn?.(`[verification] Failed to clean old messages: ${cleanupErr.message}`);
                }
                
                if (method === 'web') {
                    // Web portal verification — use a regular button so each user
                    // gets their own personal token-based link (ephemeral reply)
                    instructionEmbed = new EmbedBuilder()
                        .setTitle('🔐 Welcome to Server Verification')
                        .setDescription(`Before you can access the rest of the server, please complete verification to confirm you're a real person.

**How to Verify:**
Click the **Verify via Web Portal** button below. You'll receive a personal link to our secure verification portal. Complete the quick verification process to gain access to the server.

**What happens next:**
✅ Click the button to get your personal verification link
✅ Open the portal and complete the verification
✅ You'll receive the verified role automatically
✅ You'll gain access to all server channels

**Need Help?**
If you're having trouble verifying, please contact a staff member.

───────────────────────────────
*This verification system protects our community and only takes a few seconds.*`)
                        .setColor('#00d4ff')
                        .setTimestamp();

                    verifyButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('verify_button')
                                .setLabel('🔗 Verify via Web Portal')
                                .setStyle(ButtonStyle.Primary)
                        );
                } else if (method === 'button' || method === 'auto') {
                    // Simple button click verification
                    instructionEmbed = new EmbedBuilder()
                        .setTitle('🔐 Welcome to Server Verification')
                        .setDescription(`Before you can access the rest of the server, please complete verification to confirm you're a real person.

**How to Verify:**
Simply click the **✅ Verify** button below to gain access to the server.

**What happens next:**
✅ Click the verify button
✅ You'll receive the verified role automatically
✅ You'll gain access to all server channels

**Need Help?**
If you're having trouble verifying, please contact a staff member.

───────────────────────────────
*This verification system protects our community and only takes a few seconds.*`)
                        .setColor('#00d4ff')
                        .setTimestamp();

                    verifyButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('verify_button')
                                .setLabel('✅ Verify')
                                .setStyle(ButtonStyle.Success)
                        );
                } else if (method === 'captcha' || method === 'code') {
                    // Captcha/code verification
                    instructionEmbed = new EmbedBuilder()
                        .setTitle('🔐 Welcome to Server Verification')
                        .setDescription(`Before you can access the rest of the server, please complete verification to confirm you're a real person.

**How to Verify:**
1. Click the **🔐 Get Code** button below
2. You'll receive a verification code in your DMs
3. Click the button again and enter the code

**What happens next:**
✅ Get your unique verification code
✅ Enter the code to verify
✅ You'll receive the verified role automatically
✅ You'll gain access to all server channels

**Need Help?**
If you're having trouble verifying or didn't receive a DM, please contact a staff member.

───────────────────────────────
*This verification system protects our community and only takes a few seconds.*`)
                        .setColor('#00d4ff')
                        .setTimestamp();

                    verifyButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('verify_button')
                                .setLabel('🔐 Get Code / Enter Code')
                                .setStyle(ButtonStyle.Primary)
                        );
                } else if (method === 'reaction' || method === 'emoji') {
                    // Emoji reaction verification
                    instructionEmbed = new EmbedBuilder()
                        .setTitle('🔐 Welcome to Server Verification')
                        .setDescription(`Before you can access the rest of the server, please complete verification to confirm you're a real person.

**How to Verify:**
1. Click the **🎯 Start Verification** button below
2. You'll receive a DM with emoji options
3. React with the correct emoji to verify

**What happens next:**
✅ Start the emoji challenge
✅ React with the correct emoji in your DMs
✅ You'll receive the verified role automatically
✅ You'll gain access to all server channels

**Need Help?**
If you're having trouble verifying or didn't receive a DM, please contact a staff member.

───────────────────────────────
*This verification system protects our community and only takes a few seconds.*`)
                        .setColor('#00d4ff')
                        .setTimestamp();

                    verifyButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('verify_button')
                                .setLabel('🎯 Start Verification')
                                .setStyle(ButtonStyle.Primary)
                        );
                } else {
                    // Fallback to button verification for unknown methods
                    instructionEmbed = new EmbedBuilder()
                        .setTitle('🔐 Welcome to Server Verification')
                        .setDescription(`Before you can access the rest of the server, please complete verification to confirm you're a real person.

**How to Verify:**
Click the **Verify** button below to complete the verification process.

**Need Help?**
If you're having trouble verifying, please contact a staff member.

───────────────────────────────
*This verification system protects our community and only takes a few seconds.*`)
                        .setColor('#00d4ff')
                        .setTimestamp();

                    verifyButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('verify_button')
                                .setLabel('✅ Verify')
                                .setStyle(ButtonStyle.Success)
                        );
                }

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
