const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');

/**
 * /welcome — Unified welcome + goodbye configuration command.
 * Handles both systems in a single command.
 * Saves to both legacy (welcome_channel) and new (welcome_channel_id) columns
 * so settings are visible in the dashboard AND work for bot events.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Configure welcome & goodbye messages for your server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Set up welcome and goodbye messages in one step')
            .addChannelOption(opt => opt
                .setName('welcome_channel')
                .setDescription('Channel to send welcome messages in')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('welcome_message')
                .setDescription('Welcome message — variables: {user} {username} {server} {memberCount}')
                .setRequired(false))
            .addChannelOption(opt => opt
                .setName('goodbye_channel')
                .setDescription('Channel for goodbye messages (defaults to welcome channel)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
            .addStringOption(opt => opt
                .setName('goodbye_message')
                .setDescription('Goodbye message — variables: {user} {username} {server} {memberCount}')
                .setRequired(false)))

        .addSubcommand(sub => sub
            .setName('disable')
            .setDescription('Disable welcome or goodbye messages')
            .addStringOption(opt => opt
                .setName('type')
                .setDescription('Which system to disable (default: both)')
                .setRequired(false)
                .addChoices(
                    { name: 'Both', value: 'both' },
                    { name: 'Welcome only', value: 'welcome' },
                    { name: 'Goodbye only', value: 'goodbye' }
                )))

        .addSubcommand(sub => sub
            .setName('test')
            .setDescription('Send a test welcome or goodbye message')
            .addStringOption(opt => opt
                .setName('type')
                .setDescription('Which message to preview (default: welcome)')
                .setRequired(false)
                .addChoices(
                    { name: 'Welcome', value: 'welcome' },
                    { name: 'Goodbye', value: 'goodbye' }
                )))

        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('View the current welcome & goodbye configuration')),

    async execute(interaction, bot) {
        const sub = interaction.options.getSubcommand();
        try {
            switch (sub) {
                case 'setup':   return await this.handleSetup(interaction, bot);
                case 'disable': return await this.handleDisable(interaction, bot);
                case 'test':    return await this.handleTest(interaction, bot);
                case 'status':  return await this.handleStatus(interaction, bot);
            }
        } catch (error) {
            bot?.logger?.error('Error in /welcome command:', error);
            const msg = { content: '❌ An error occurred. Please try again.', ephemeral: true };
            if (interaction.replied || interaction.deferred) await interaction.editReply(msg);
            else await interaction.reply(msg);
        }
    },

    async handleSetup(interaction, bot) {
        await interaction.deferReply();
        const guildId = interaction.guild.id;

        const welcomeChannel = interaction.options.getChannel('welcome_channel');
        const goodbyeChannel = interaction.options.getChannel('goodbye_channel') || welcomeChannel;
        const welcomeMsg = interaction.options.getString('welcome_message') ||
            'Welcome {user} to **{server}**! You are member #{memberCount}! 🎉';
        const goodbyeMsg = interaction.options.getString('goodbye_message') ||
            'Goodbye {user}, thanks for being part of **{server}**! 👋';

        const me = interaction.guild.members.me;
        if (!welcomeChannel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) {
            return interaction.editReply({ content: `❌ I can't send messages in ${welcomeChannel}!` });
        }
        if (!goodbyeChannel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) {
            return interaction.editReply({ content: `❌ I can't send messages in ${goodbyeChannel}!` });
        }

        // Ensure *_id columns exist (safe no-op if already present)
        for (const col of [
            'welcome_channel_id TEXT', 'goodbye_channel_id TEXT',
            'welcome_embed_enabled BOOLEAN DEFAULT 0',
            'welcome_ping_user BOOLEAN DEFAULT 0',
            'goodbye_embed_enabled BOOLEAN DEFAULT 0'
        ]) {
            try { await bot.database.run(`ALTER TABLE guild_configs ADD COLUMN ${col}`); } catch (_) {}
        }

        // Save to BOTH column names so the dashboard AND bot events both see the data
        await bot.database.run(`
            INSERT INTO guild_configs (
                guild_id,
                welcome_enabled, welcome_channel, welcome_channel_id, welcome_message,
                goodbye_enabled, goodbye_channel, goodbye_channel_id, goodbye_message
            ) VALUES (?, 1, ?, ?, ?, 1, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                welcome_enabled      = 1,
                welcome_channel      = excluded.welcome_channel,
                welcome_channel_id   = excluded.welcome_channel_id,
                welcome_message      = excluded.welcome_message,
                goodbye_enabled      = 1,
                goodbye_channel      = excluded.goodbye_channel,
                goodbye_channel_id   = excluded.goodbye_channel_id,
                goodbye_message      = excluded.goodbye_message,
                updated_at           = CURRENT_TIMESTAMP
        `, [
            guildId,
            welcomeChannel.id, welcomeChannel.id, welcomeMsg,
            goodbyeChannel.id, goodbyeChannel.id, goodbyeMsg
        ]);

        try { await bot.database.invalidateConfigCache(guildId); } catch (_) {}
        try {
            if (typeof bot.emitSettingChange === 'function') {
                await bot.emitSettingChange(guildId, interaction.user.id, 'welcome_enabled', 1, null, 'configuration');
                await bot.emitSettingChange(guildId, interaction.user.id, 'goodbye_enabled', 1, null, 'configuration');
            }
        } catch (_) {}

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('✅ Welcome & Goodbye Configured')
            .addFields(
                { name: '👋 Welcome Channel', value: `${welcomeChannel}`, inline: true },
                { name: '🚪 Goodbye Channel', value: `${goodbyeChannel}`, inline: true },
                { name: '✅ Status', value: 'Both Enabled', inline: true },
                { name: '📝 Welcome Message', value: `\`\`\`${welcomeMsg.substring(0, 200)}\`\`\``, inline: false },
                { name: '📝 Goodbye Message', value: `\`\`\`${goodbyeMsg.substring(0, 200)}\`\`\``, inline: false },
                { name: '💡 Variables', value: '`{user}` mention · `{username}` name · `{server}` server name · `{memberCount}` count', inline: false }
            )
            .setFooter({ text: '/welcome test — preview  ·  /welcome status — view config  ·  /welcome disable — turn off' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },

    async handleDisable(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const guildId = interaction.guild.id;
        const type = interaction.options.getString('type') || 'both';

        if (type === 'both' || type === 'welcome') {
            await bot.database.run(
                'UPDATE guild_configs SET welcome_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?',
                [guildId]
            );
        }
        if (type === 'both' || type === 'goodbye') {
            await bot.database.run(
                'UPDATE guild_configs SET goodbye_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?',
                [guildId]
            );
        }
        try { await bot.database.invalidateConfigCache(guildId); } catch (_) {}

        const labels = { both: 'Welcome & Goodbye', welcome: 'Welcome', goodbye: 'Goodbye' };
        await interaction.editReply({ content: `⏸️ ${labels[type]} messages disabled. Use \`/welcome setup\` to re-enable.` });
    },

    async handleTest(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const guildId = interaction.guild.id;
        const type = interaction.options.getString('type') || 'welcome';

        const cfg = await bot.database.get(
            `SELECT welcome_enabled, welcome_channel, welcome_channel_id, welcome_message,
                    welcome_embed_enabled, welcome_ping_user,
                    goodbye_enabled, goodbye_channel, goodbye_channel_id, goodbye_message,
                    goodbye_embed_enabled
             FROM guild_configs WHERE guild_id = ?`,
            [guildId]
        );
        if (!cfg) return interaction.editReply({ content: '❌ Not configured yet. Use `/welcome setup` first.' });

        if (type === 'welcome') {
            const chId = cfg.welcome_channel_id || cfg.welcome_channel;
            if (!chId) return interaction.editReply({ content: '❌ Welcome channel not set. Run `/welcome setup` first.' });
            const channel = interaction.guild.channels.cache.get(chId);
            if (!channel) return interaction.editReply({ content: '❌ Welcome channel not found. Please run `/welcome setup` again.' });

            const msg = this.formatMessage(cfg.welcome_message || 'Welcome {user} to **{server}**! 🎉', interaction.member, interaction.guild);
            if (cfg.welcome_embed_enabled) {
                const embed = new EmbedBuilder().setColor('#00d4ff').setDescription(msg).setTimestamp();
                await channel.send({ content: cfg.welcome_ping_user ? interaction.user.toString() : undefined, embeds: [embed] });
            } else {
                await channel.send({ content: cfg.welcome_ping_user ? `${interaction.user.toString()} ${msg}` : msg });
            }
            await interaction.editReply({ content: `✅ Test welcome message sent to ${channel}!` });

        } else {
            const chId = cfg.goodbye_channel_id || cfg.goodbye_channel;
            if (!chId) return interaction.editReply({ content: '❌ Goodbye channel not set. Run `/welcome setup` first.' });
            const channel = interaction.guild.channels.cache.get(chId);
            if (!channel) return interaction.editReply({ content: '❌ Goodbye channel not found. Please run `/welcome setup` again.' });

            const msg = this.formatMessage(cfg.goodbye_message || 'Goodbye {user}! 👋', interaction.member, interaction.guild);
            if (cfg.goodbye_embed_enabled) {
                const embed = new EmbedBuilder().setColor('#ff6b6b').setDescription(msg).setTimestamp();
                await channel.send({ embeds: [embed] });
            } else {
                await channel.send({ content: msg });
            }
            await interaction.editReply({ content: `✅ Test goodbye message sent to ${channel}!` });
        }
    },

    async handleStatus(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const guildId = interaction.guild.id;

        const cfg = await bot.database.get(
            `SELECT welcome_enabled, welcome_channel, welcome_channel_id, welcome_message,
                    welcome_embed_enabled, welcome_ping_user, welcome_delete_after,
                    goodbye_enabled, goodbye_channel, goodbye_channel_id, goodbye_message,
                    goodbye_embed_enabled, goodbye_delete_after
             FROM guild_configs WHERE guild_id = ?`,
            [guildId]
        );

        const embed = new EmbedBuilder().setTitle('📋 Welcome & Goodbye Status').setTimestamp();
        const wChId = cfg?.welcome_channel_id || cfg?.welcome_channel;
        const gChId = cfg?.goodbye_channel_id || cfg?.goodbye_channel;

        if (!cfg || (!wChId && !gChId)) {
            embed.setColor('#6b7280')
                .setDescription('❌ Not configured yet.\nRun `/welcome setup #channel` to get started.');
        } else {
            const wCh  = wChId ? (interaction.guild.channels.cache.get(wChId) || `\`Unknown (${wChId})\``) : '`Not set`';
            const gCh  = gChId ? (interaction.guild.channels.cache.get(gChId) || `\`Unknown (${gChId})\``) : '`Not set`';

            let wMsg = cfg.welcome_message || 'Welcome {user} to **{server}**!';
            try { const p = JSON.parse(wMsg); wMsg = p.message || wMsg; } catch {}
            let gMsg = cfg.goodbye_message || 'Goodbye {user}!';
            try { const p = JSON.parse(gMsg); gMsg = p.message || gMsg; } catch {}

            embed.setColor(cfg.welcome_enabled || cfg.goodbye_enabled ? '#00d4ff' : '#6b7280')
                .addFields(
                    { name: '👋 Welcome', value: cfg.welcome_enabled ? '✅ Enabled' : '⏸️ Disabled', inline: true },
                    { name: '📌 Channel', value: `${wCh}`, inline: true },
                    { name: '🔧 Options', value: `Embed: ${cfg.welcome_embed_enabled ? 'Yes' : 'No'} · Ping: ${cfg.welcome_ping_user ? 'Yes' : 'No'}${cfg.welcome_delete_after > 0 ? ` · Auto-delete: ${cfg.welcome_delete_after}s` : ''}`, inline: true },
                    { name: '📝 Welcome Message', value: `\`\`\`${wMsg.substring(0, 200)}\`\`\``, inline: false },
                    { name: '🚪 Goodbye', value: cfg.goodbye_enabled ? '✅ Enabled' : '⏸️ Disabled', inline: true },
                    { name: '📌 Channel', value: `${gCh}`, inline: true },
                    { name: '🔧 Options', value: `Embed: ${cfg.goodbye_embed_enabled ? 'Yes' : 'No'}${cfg.goodbye_delete_after > 0 ? ` · Auto-delete: ${cfg.goodbye_delete_after}s` : ''}`, inline: true },
                    { name: '📝 Goodbye Message', value: `\`\`\`${gMsg.substring(0, 200)}\`\`\``, inline: false }
                );
        }

        await interaction.editReply({ embeds: [embed] });
    },

    /** Replace message template variables */
    formatMessage(template, member, guild) {
        let msg = template || '';
        try { const p = JSON.parse(msg); msg = p.message || template; } catch {}
        return msg
            .replace(/{user}/g, member.user.toString())
            .replace(/{username}/g, member.user.username)
            .replace(/{server}/g, guild.name)
            .replace(/{memberCount}/g, guild.memberCount.toString());
    }
};
