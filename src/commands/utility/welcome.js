const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');

/**
 * @deprecated This command has been consolidated into /setup welcome
 * Use /setup welcome setup|disable|customize|test|status instead
 */
module.exports = {
    deprecated: true,
    newCommand: '/setup welcome',
    
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('⚠️ DEPRECATED → Use /setup welcome instead')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Set up (and enable) the welcome system')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Channel to send welcome messages')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Welcome message (use {user}, {server}, {memberCount})')
                        .setRequired(false))
                .addStringOption(option =>
                    option
                        .setName('goodbye_message')
                        .setDescription('Goodbye message (use {user}, {server}, {memberCount})')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('customize')
                .setDescription('Customize the welcome message')
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Welcome message (use {user}, {server}, {memberCount})')
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('embed_title')
                        .setDescription('Title for embed (leave empty for plain message)')
                        .setRequired(false))
                .addStringOption(option =>
                    option
                        .setName('embed_color')
                        .setDescription('Hex color for embed (e.g., #00d4ff)')
                        .setRequired(false))
                .addStringOption(option =>
                    option
                        .setName('image_url')
                        .setDescription('Image URL for welcome embed')
                        .setRequired(false))),

    async execute(interaction, bot) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'setup':
                    await this.handleSetup(interaction, bot);
                    break;
                case 'customize':
                    await this.handleCustomize(interaction, bot);
                    break;
            }
        } catch (error) {
            if (bot && bot.logger) {
                bot.logger.error('Error in welcome command:', error);
            } else {
                console.error('Error in welcome command:', error);
            }
            const errorEmbed = new EmbedBuilder()
                .setColor('#ef4444')
                .setTitle('❌ Error')
                .setDescription('An error occurred while processing the welcome command.')
                .setTimestamp();

            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    },

    async handleSetup(interaction, bot) {
        await interaction.deferReply();
        
        const channel = interaction.options.getChannel('channel');
        const customMessage = interaction.options.getString('message') || 
            'Welcome {user} to **{server}**! You are member #{memberCount}! 🎉';
        const goodbyeMessage = interaction.options.getString('goodbye_message') || 'Goodbye {user}, thanks for being part of **{server}**!';

        // Check if bot can send messages in the channel
        if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
            return interaction.editReply({
                content: '❌ I don\'t have permission to send messages in that channel!'
            });
        }

        // Update database
        // Ensure goodbye columns exist (fails silently if already there)
        try { await bot.database.run(`ALTER TABLE guild_configs ADD COLUMN goodbye_enabled BOOLEAN DEFAULT 0`); } catch (_) {}
        try { await bot.database.run(`ALTER TABLE guild_configs ADD COLUMN goodbye_channel TEXT`); } catch (_) {}
        try { await bot.database.run(`ALTER TABLE guild_configs ADD COLUMN goodbye_message TEXT DEFAULT 'Goodbye {user}, thanks for being part of {server}!'`); } catch (_) {}

        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, welcome_enabled, welcome_channel, welcome_message, goodbye_enabled, goodbye_channel, goodbye_message)
            VALUES (?, 1, ?, ?, 1, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                welcome_enabled = 1,
                welcome_channel = excluded.welcome_channel,
                welcome_message = excluded.welcome_message,
                goodbye_enabled = 1,
                goodbye_channel = excluded.goodbye_channel,
                goodbye_message = excluded.goodbye_message,
                updated_at = CURRENT_TIMESTAMP
        `, [interaction.guild.id, channel.id, customMessage, channel.id, goodbyeMessage]);

        // Invalidate config cache so new welcome/goodbye settings take effect immediately
        try {
            await bot.database.invalidateConfigCache(interaction.guild.id);
        } catch (e) {
            bot.logger?.warn && bot.logger.warn('Failed to invalidate config cache after welcome setup', e?.message || e);
        }

        // Emit setting change events
        try {
            if (typeof bot.emitSettingChange === 'function') {
                await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'welcome_enabled', 1, null, 'security');
                await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'welcome_channel', channel.id, null, 'configuration');
                await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'goodbye_enabled', 1, null, 'security');
                await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'goodbye_channel', channel.id, null, 'configuration');
            }
        } catch (e) {
            bot.logger?.warn && bot.logger.warn('emitSettingChange failed in welcome.setup:', e?.message || e);
        }

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('✅ Welcome System Configured')
            .setDescription(`Welcome messages will be sent to ${channel}`)
            .addFields(
                { name: 'Channel', value: `${channel}`, inline: true },
                { name: 'Status', value: '✅ Welcome & Goodbye Enabled', inline: true },
                { name: 'Welcome Message', value: `\`\`\`${customMessage}\`\`\``, inline: false },
                { name: 'Goodbye Message', value: `\`\`\`${goodbyeMessage}\`\`\``, inline: false }
            )
            .setFooter({ text: 'Use /welcome customize to change the welcome message' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },


    async handleCustomize(interaction, bot) {
        await interaction.deferReply();
        
        const message = interaction.options.getString('message');
        const embedTitle = interaction.options.getString('embed_title');
        const embedColor = interaction.options.getString('embed_color');
        const imageUrl = interaction.options.getString('image_url');

        const config = await bot.database.get(
            'SELECT welcome_channel FROM guild_configs WHERE guild_id = ?',
            [interaction.guild.id]
        );

        if (!config || !config.welcome_channel) {
            return interaction.reply({
                content: '❌ Welcome system not set up yet! Use `/welcome setup` first.',
                ephemeral: true
            });
        }

        // Build customization JSON
        const customization = {
            message: message,
            embedTitle: embedTitle || null,
            embedColor: embedColor || '#00d4ff',
            imageUrl: imageUrl || null
        };

        await bot.database.run(`
            UPDATE guild_configs 
            SET welcome_message = ?, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ?
        `, [JSON.stringify(customization), interaction.guild.id]);

        // Invalidate cache so the updated welcome message is used right away
        try {
            await bot.database.invalidateConfigCache(interaction.guild.id);
        } catch (e) {
            bot.logger?.warn && bot.logger.warn('Failed to invalidate config cache after welcome customize', e?.message || e);
        }

        try {
            if (typeof bot.emitSettingChange === 'function') {
                await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'welcome_message', JSON.stringify(customization), null, 'configuration');
            }
        } catch (e) {
            bot.logger?.warn && bot.logger.warn('emitSettingChange failed in welcome.customize:', e?.message || e);
        }

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('✅ Welcome Message Customized')
            .setDescription('Your welcome message has been updated!')
            .addFields(
                { name: 'Message', value: message, inline: false }
            )
            .setTimestamp();

        if (embedTitle) embed.addFields({ name: 'Embed Title', value: embedTitle, inline: true });
        if (embedColor) embed.addFields({ name: 'Color', value: embedColor, inline: true });
        if (imageUrl) embed.addFields({ name: 'Image', value: 'Custom image set', inline: true });

        await interaction.editReply({ embeds: [embed] });
    },


    async formatWelcomeMessage(configMessage, member, guild) {
        let customization;
        try {
            customization = JSON.parse(configMessage);
        } catch (e) {
            // Plain string message
            customization = { message: configMessage };
        }

        // Replace placeholders
        const message = customization.message
            .replace(/{user}/g, member.user.toString())
            .replace(/{username}/g, member.user.username)
            .replace(/{server}/g, guild.name)
            .replace(/{memberCount}/g, guild.memberCount.toString());

        // Build embed if customization exists
        if (customization.embedTitle || customization.embedColor || customization.imageUrl) {
            const embed = new EmbedBuilder()
                .setColor(customization.embedColor || '#00d4ff')
                .setDescription(message)
                .setTimestamp();

            if (customization.embedTitle) {
                embed.setTitle(customization.embedTitle);
            }

            if (customization.imageUrl) {
                embed.setImage(customization.imageUrl);
            }

            return { embeds: [embed] };
        }

        // Plain message
        return { content: message };
    }
};
