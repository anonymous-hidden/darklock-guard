const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');

/**
 * @deprecated This command has been consolidated into /setup goodbye
 * Use /setup goodbye setup|disable|customize|test|status instead
 */
module.exports = {
    deprecated: true,
    newCommand: '/setup goodbye',
    
    data: new SlashCommandBuilder()
        .setName('goodbye')
        .setDescription('⚠️ DEPRECATED → Use /setup goodbye instead')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Set up the goodbye system')
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Channel to send goodbye messages')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('message')
                .setDescription('Goodbye message (use {user}, {server}, {memberCount})')
                .setRequired(false)))
        .addSubcommand(sub => sub
            .setName('enable')
            .setDescription('Enable goodbye messages'))
        .addSubcommand(sub => sub
            .setName('disable')
            .setDescription('Disable goodbye messages'))
        .addSubcommand(sub => sub
            .setName('customize')
            .setDescription('Customize the goodbye message (Pro will override default)')
            .addStringOption(opt => opt
                .setName('message')
                .setDescription('Goodbye message (use {user}, {server}, {memberCount})')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('embed_title')
                .setDescription('Title for embed (optional)')
                .setRequired(false))
            .addStringOption(opt => opt
                .setName('embed_color')
                .setDescription('Hex color for embed (e.g., #ff6b6b)')
                .setRequired(false))
            .addStringOption(opt => opt
                .setName('image_url')
                .setDescription('Image URL for goodbye embed')
                .setRequired(false)))
        .addSubcommand(sub => sub
            .setName('test')
            .setDescription('Test the goodbye message'))
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('View current goodbye configuration')),

    async execute(interaction, bot) {
        const sub = interaction.options.getSubcommand();
        try {
            if (sub === 'setup') return this.handleSetup(interaction, bot);
            if (sub === 'enable') return this.handleEnable(interaction, bot);
            if (sub === 'disable') return this.handleDisable(interaction, bot);
            if (sub === 'customize') return this.handleCustomize(interaction, bot);
            if (sub === 'test') return this.handleTest(interaction, bot);
            if (sub === 'status') return this.handleStatus(interaction, bot);
        } catch (error) {
            bot.logger?.error && bot.logger.error('Goodbye command error:', error);
            const embed = new EmbedBuilder().setColor('#ef4444').setTitle('❌ Error').setDescription('An error occurred while processing the goodbye command.');
            if (interaction.deferred || interaction.replied) return interaction.editReply({ embeds: [embed] });
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
    },

    async handleSetup(interaction, bot) {
        await interaction.deferReply();
        const channel = interaction.options.getChannel('channel', true);
        const message = interaction.options.getString('message') || 'Goodbye {user}, thanks for being part of **{server}**!';

        if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
            return interaction.editReply({ content: "❌ I don't have permission to send messages in that channel!" });
        }

        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, goodbye_enabled, goodbye_channel, goodbye_message)
            VALUES (?, 1, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                goodbye_enabled = 1,
                goodbye_channel = excluded.goodbye_channel,
                goodbye_message = excluded.goodbye_message,
                updated_at = CURRENT_TIMESTAMP
        `, [interaction.guild.id, channel.id, message]);

        const embed = new EmbedBuilder()
            .setColor('#ff6b6b')
            .setTitle('✅ Goodbye System Configured')
            .setDescription(`Goodbye messages will be sent to ${channel}`)
            .addFields(
                { name: 'Channel', value: `${channel}`, inline: true },
                { name: 'Status', value: '✅ Enabled', inline: true },
                { name: 'Message', value: `\`\`\`${message}\`\`\``, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },

    async handleEnable(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const cfg = await bot.database.get('SELECT goodbye_channel FROM guild_configs WHERE guild_id = ?', [interaction.guild.id]);
        if (!cfg || !cfg.goodbye_channel) return interaction.editReply({ content: '❌ Goodbye system not set up yet! Use `/goodbye setup` first.' });

        await bot.database.run('UPDATE guild_configs SET goodbye_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [interaction.guild.id]);
        await interaction.editReply({ content: '✅ Goodbye messages enabled.' });
    },

    async handleDisable(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        await bot.database.run('UPDATE guild_configs SET goodbye_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [interaction.guild.id]);
        await interaction.editReply({ content: '⏸️ Goodbye messages disabled.' });
    },

    async handleCustomize(interaction, bot) {
        await interaction.deferReply();
        const message = interaction.options.getString('message', true);
        const embedTitle = interaction.options.getString('embed_title');
        const embedColor = interaction.options.getString('embed_color');
        const imageUrl = interaction.options.getString('image_url');

        const cfg = await bot.database.get('SELECT goodbye_channel FROM guild_configs WHERE guild_id = ?', [interaction.guild.id]);
        if (!cfg || !cfg.goodbye_channel) return interaction.editReply({ content: '❌ Goodbye system not set up yet! Use `/goodbye setup` first.' });

        const customization = { message, embedTitle: embedTitle || null, embedColor: embedColor || '#ff6b6b', imageUrl: imageUrl || null };
        await bot.database.run('UPDATE guild_configs SET goodbye_message = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [JSON.stringify(customization), interaction.guild.id]);

        const embed = new EmbedBuilder().setColor('#ff6b6b').setTitle('✅ Goodbye Message Customized').setDescription('Your goodbye message has been updated!').addFields({ name: 'Message', value: message });
        if (embedTitle) embed.addFields({ name: 'Embed Title', value: embedTitle, inline: true });
        if (embedColor) embed.addFields({ name: 'Color', value: embedColor, inline: true });
        if (imageUrl) embed.addFields({ name: 'Image', value: 'Custom image set', inline: true });
        await interaction.editReply({ embeds: [embed] });
    },

    async handleTest(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const cfg = await bot.database.get('SELECT goodbye_enabled, goodbye_channel, goodbye_message FROM guild_configs WHERE guild_id = ?', [interaction.guild.id]);
        if (!cfg || !cfg.goodbye_channel) return interaction.editReply({ content: '❌ Goodbye system not set up yet! Use `/goodbye setup` first.' });
        const channel = interaction.guild.channels.cache.get(cfg.goodbye_channel);
        if (!channel) return interaction.editReply({ content: '❌ Goodbye channel not found! Please set up again.' });

        const preview = await this.formatGoodbyeMessage(cfg.goodbye_message || 'Goodbye {user}, thanks for being part of **{server}**!', interaction.member, interaction.guild);
        await channel.send(preview);
        await interaction.editReply({ content: `✅ Test goodbye message sent to ${channel}!` });
    },

    async handleStatus(interaction, bot) {
        await interaction.deferReply();
        const cfg = await bot.database.get('SELECT goodbye_enabled, goodbye_channel, goodbye_message FROM guild_configs WHERE guild_id = ?', [interaction.guild.id]);
        const embed = new EmbedBuilder().setColor(cfg?.goodbye_enabled ? '#ff6b6b' : '#6b7280').setTitle('📋 Goodbye System Status').setTimestamp();
        if (!cfg || !cfg.goodbye_channel) {
            embed.setDescription('❌ Goodbye system is not configured').addFields({ name: 'Setup', value: 'Use `/goodbye setup` to configure' });
        } else {
            const channel = interaction.guild.channels.cache.get(cfg.goodbye_channel);
            let messagePreview = cfg.goodbye_message;
            try { const parsed = JSON.parse(cfg.goodbye_message); messagePreview = parsed.message || messagePreview; } catch {}
            embed.setDescription(cfg.goodbye_enabled ? '✅ Enabled' : '⏸️ Disabled').addFields(
                { name: 'Channel', value: channel ? `${channel}` : '❌ Not Found', inline: true },
                { name: 'Status', value: cfg.goodbye_enabled ? '✅ Active' : '⏸️ Inactive', inline: true },
                { name: 'Message Preview', value: `\`\`\`${(messagePreview || '').substring(0,200)}\`\`\``, inline: false }
            );
        }
        await interaction.editReply({ embeds: [embed] });
    },

    async formatGoodbyeMessage(configMessage, member, guild) {
        let customization;
        try { customization = JSON.parse(configMessage); } catch { customization = { message: configMessage }; }
        const { EmbedBuilder } = require('discord.js');
        const message = (customization.message || 'Goodbye {user}, thanks for being part of **{server}**!')
            .replace(/{user}/g, member.user.username)
            .replace(/{username}/g, member.user.username)
            .replace(/{mention}/g, member.user.toString())
            .replace(/{server}/g, guild.name)
            .replace(/{guild}/g, guild.name)
            .replace(/{memberCount}/g, guild.memberCount.toString());
        if (customization.embedTitle || customization.embedColor || customization.imageUrl) {
            const embed = new EmbedBuilder().setColor(customization.embedColor || '#ff6b6b').setDescription(message).setTimestamp();
            if (customization.embedTitle) embed.setTitle(customization.embedTitle);
            if (customization.imageUrl) embed.setImage(customization.imageUrl);
            return { embeds: [embed] };
        }
        return { content: message };
    }
};
