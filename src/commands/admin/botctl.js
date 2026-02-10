/**
 * /botctl - Bot Control Command (HARDWARE GATED)
 * Requires RFID presence for shutdown/restart operations
 * 
 * SECURITY: This command is protected by hardware presence verification
 * Admin must have physical access to authorized RFID card
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const rfid = require('../../hardware/rfid_client');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botctl')
        .setDescription('🔐 Bot control (requires RFID presence)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('View bot status and hardware gate state')
        )
        .addSubcommand(sub => sub
            .setName('shutdown')
            .setDescription('🚨 Shutdown bot (REQUIRES RFID PRESENCE)')
            .addStringOption(opt => opt
                .setName('confirmation')
                .setDescription('Type SHUTDOWN to confirm')
                .setRequired(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('restart')
            .setDescription('🔄 Restart bot (REQUIRES RFID PRESENCE)')
            .addStringOption(opt => opt
                .setName('confirmation')
                .setDescription('Type RESTART to confirm')
                .setRequired(true)
            )
        ),

    async execute(interaction, bot) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'status':
                return this.showStatus(interaction, bot);
            case 'shutdown':
                return this.shutdown(interaction, bot);
            case 'restart':
                return this.restart(interaction, bot);
        }
    },

    async showStatus(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Query RFID hardware status
            const rfidHealth = await rfid.getHealth();
            const rfidState = rfidHealth.state || {};
            
            const embed = new EmbedBuilder()
                .setTitle('🤖 Bot Control Status')
                .setColor(bot.client.user.accentColor || 0x5865F2)
                .setTimestamp();

            // Bot status
            const uptime = this.formatUptime(bot.client.uptime);
            const guilds = bot.client.guilds.cache.size;
            const users = bot.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);

            embed.addFields(
                { 
                    name: '📊 Bot Status', 
                    value: `**Uptime:** ${uptime}\n**Guilds:** ${guilds}\n**Users:** ${users.toLocaleString()}`,
                    inline: true 
                }
            );

            // RFID hardware status
            if (rfidHealth.available) {
                const gateEmoji = rfidState.present ? '🔓' : '🔒';
                const gateState = rfidState.present ? 'PRESENT ✓' : 'ABSENT';
                const lastSeen = rfidState.last_seen ? `<t:${Math.floor(new Date(rfidState.last_seen).getTime() / 1000)}:R>` : 'Never';
                const uidPreview = rfidState.uid_hash ? `${rfidState.uid_hash.substring(0, 12)}...` : 'N/A';

                embed.addFields(
                    { 
                        name: `${gateEmoji} RFID Hardware Gate`, 
                        value: `**State:** ${gateState}\n**Last Seen:** ${lastSeen}\n**UID Hash:** \`${uidPreview}\`\n**Allowlist:** ${rfidState.allowlist_size || 0} authorized`,
                        inline: true 
                    }
                );

                // Add stats if available
                if (rfidHealth.stats) {
                    const stats = rfidHealth.stats;
                    embed.addFields({
                        name: '📈 Security Statistics',
                        value: `**Total Scans:** ${stats.scans_total || 0}\n**Valid Reads:** ${stats.valid_reads || 0}\n**Denied:** ${stats.denied_reads || 0}\n**Auth Checks:** ${stats.auth_checks || 0}\n**Shutdown Checks:** ${stats.shutdown_checks || 0}`,
                        inline: false
                    });
                }
            } else {
                embed.addFields(
                    { 
                        name: '⚠️ RFID Hardware Gate', 
                        value: `**Status:** UNAVAILABLE\n**Error:** ${rfidHealth.error || 'Service not running'}\n⚠️ **FAIL-CLOSED:** All privileged operations denied`,
                        inline: true 
                    }
                );
            }

            // Permissions
            embed.addFields({
                name: '🔐 Required for Shutdown/Restart',
                value: '✓ Administrator role\n✓ **Physical RFID presence**\n✓ Confirmation keyword',
                inline: false
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            bot.logger.error('Bot status error:', error);
            await interaction.editReply({
                content: '❌ Failed to retrieve bot status',
                ephemeral: true
            });
        }
    },

    async shutdown(interaction, bot) {
        const confirmation = interaction.options.getString('confirmation');

        if (confirmation !== 'SHUTDOWN') {
            return interaction.reply({
                content: '❌ Confirmation failed. Type `SHUTDOWN` exactly to confirm.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // CRITICAL: Trigger RFID scan — LCD shows "BOT SHUTDOWN / Scan your card"
            bot.logger.info(`Shutdown requested by ${interaction.user.tag} - triggering RFID scan...`);
            await interaction.editReply('🔒 **Scan your RFID card on the hardware gateway now...** (15s timeout)');
            const rfidCheck = await rfid.scanShutdown();

            if (!rfidCheck.allowed) {
                const embed = new EmbedBuilder()
                    .setTitle('🔒 Physical Presence Required')
                    .setDescription(rfidCheck.reason)
                    .setColor(0xFF0000)
                    .addFields({
                        name: '📋 Instructions',
                        value: '1. Locate authorized RFID card\n2. Hold card near RC522 reader\n3. Wait for PRESENT status (use `/botctl status`)\n4. Retry this command **while card is present**',
                        inline: false
                    })
                    .addFields({
                        name: '⚠️ Security Notice',
                        value: 'This is hardware-enforced protection. The card **must remain present** during the shutdown request.',
                        inline: false
                    })
                    .setFooter({ text: 'RFID Security Gate - FAIL-CLOSED' })
                    .setTimestamp();

                // Log denial
                bot.logger.warn(`🚨 SHUTDOWN DENIED for ${interaction.user.tag} - ${rfidCheck.reason}`);

                return interaction.editReply({ embeds: [embed] });
            }

            // RFID VERIFIED - Log critical action
            bot.logger.critical(`🚨 BOT SHUTDOWN AUTHORIZED by ${interaction.user.tag} (${interaction.user.id})`);
            bot.logger.critical(`   RFID Hash: ${rfidCheck.uid_hash}`);
            bot.logger.critical(`   Timestamp: ${new Date().toISOString()}`);

            // Confirm to user
            await interaction.editReply({
                content: `✅ **Physical presence verified**\n\n🚨 Shutting down bot in 3 seconds...\n\n` +
                        `**RFID Hash:** \`${rfidCheck.uid_hash?.substring(0, 16)}...\`\n` +
                        `**Authorized by:** ${interaction.user.tag}\n\n` +
                        `⚠️ This action cannot be undone remotely. Bot must be restarted manually or via process manager.`,
                ephemeral: true
            });

            // Give time for response to send
            setTimeout(async () => {
                try {
                    bot.logger.critical('='.repeat(60));
                    bot.logger.critical('BOT SHUTDOWN INITIATED');
                    bot.logger.critical('='.repeat(60));
                    await bot.shutdown();
                    process.exit(0);
                } catch (error) {
                    bot.logger.error('Shutdown error:', error);
                    process.exit(1);
                }
            }, 3000);

        } catch (error) {
            bot.logger.error('Shutdown command error:', error);
            await interaction.editReply({
                content: `❌ Failed to execute shutdown.\n**Error:** ${error.message}\n\nCheck logs for details.`,
                ephemeral: true
            });
        }
    },

    async restart(interaction, bot) {
        const confirmation = interaction.options.getString('confirmation');

        if (confirmation !== 'RESTART') {
            return interaction.reply({
                content: '❌ Confirmation failed. Type `RESTART` exactly to confirm.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // CRITICAL: Trigger RFID scan — LCD shows "BOT SHUTDOWN / Scan your card"
            bot.logger.info(`Restart requested by ${interaction.user.tag} - triggering RFID scan...`);
            await interaction.editReply('🔒 **Scan your RFID card on the hardware gateway now...** (15s timeout)');
            const rfidCheck = await rfid.scanShutdown();

            if (!rfidCheck.allowed) {
                const embed = new EmbedBuilder()
                    .setTitle('🔒 Physical Presence Required')
                    .setDescription(rfidCheck.reason)
                    .setColor(0xFF0000)
                    .addFields({
                        name: '📋 Instructions',
                        value: '1. Locate authorized RFID card\n2. Hold card near RC522 reader\n3. Wait for PRESENT status (use `/botctl status`)\n4. Retry this command **while card is present**',
                        inline: false
                    })
                    .setFooter({ text: 'RFID Security Gate - FAIL-CLOSED' })
                    .setTimestamp();

                // Log denial
                bot.logger.warn(`🔄 RESTART DENIED for ${interaction.user.tag} - ${rfidCheck.reason}`);

                return interaction.editReply({ embeds: [embed] });
            }

            // RFID VERIFIED - Log critical action
            bot.logger.critical(`🔄 BOT RESTART AUTHORIZED by ${interaction.user.tag} (${interaction.user.id})`);
            bot.logger.critical(`   RFID Hash: ${rfidCheck.uid_hash}`);
            bot.logger.critical(`   Timestamp: ${new Date().toISOString()}`);

            // Confirm to user
            await interaction.editReply({
                content: `✅ **Physical presence verified**\n\n🔄 Restarting bot in 3 seconds...\n\n` +
                        `**RFID Hash:** \`${rfidCheck.uid_hash?.substring(0, 16)}...\`\n` +
                        `**Authorized by:** ${interaction.user.tag}\n\n` +
                        `⏳ Bot will reconnect automatically if managed by systemd/PM2.`,
                ephemeral: true
            });

            // Give time for response to send
            setTimeout(async () => {
                try {
                    bot.logger.critical('='.repeat(60));
                    bot.logger.critical('BOT RESTART INITIATED');
                    bot.logger.critical('='.repeat(60));
                    await bot.shutdown();
                    process.exit(0); // Process manager will restart
                } catch (error) {
                    bot.logger.error('Restart error:', error);
                    process.exit(1);
                }
            }, 3000);

        } catch (error) {
            bot.logger.error('Restart command error:', error);
            await interaction.editReply({
                content: `❌ Failed to execute restart.\n**Error:** ${error.message}\n\nCheck logs for details.`,
                ephemeral: true
            });
        }
    },

    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
};
