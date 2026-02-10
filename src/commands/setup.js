const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

/**
 * /setup command - Server configuration and onboarding
 * Consolidates: wizard, serversetup, language, onboarding, autorole, permissions, welcome, goodbye
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('⚙️ Server configuration and setup')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        
        .addSubcommand(sub => sub
            .setName('start')
            .setDescription('Start interactive setup wizard'))
        
        .addSubcommand(sub => sub
            .setName('language')
            .setDescription('Set server language')
            .addStringOption(opt => opt
                .setName('lang')
                .setDescription('Language to use')
                .setRequired(true)
                .addChoices(
                    { name: '🇺🇸 English', value: 'en' },
                    { name: '🇪🇸 Español', value: 'es' },
                    { name: '🇫🇷 Français', value: 'fr' },
                    { name: '🇩🇪 Deutsch', value: 'de' },
                    { name: '🇯🇵 日本語', value: 'ja' }
                )))
        
        .addSubcommand(sub => sub
            .setName('verification')
            .setDescription('Configure member verification')
            .addBooleanOption(opt => opt
                .setName('enabled')
                .setDescription('Enable verification')
                .setRequired(true))
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Verification channel'))
            .addRoleOption(opt => opt
                .setName('verified_role')
                .setDescription('Role to grant after verification')))
        
        .addSubcommand(sub => sub
            .setName('roles')
            .setDescription('Configure auto-roles')
            .addRoleOption(opt => opt
                .setName('role')
                .setDescription('Role to auto-assign')
                .setRequired(true))
            .addBooleanOption(opt => opt
                .setName('on_join')
                .setDescription('Assign on member join (default: true)')))
        
        .addSubcommand(sub => sub
            .setName('welcome')
            .setDescription('Configure welcome messages')
            .addBooleanOption(opt => opt
                .setName('enabled')
                .setDescription('Enable welcome messages')
                .setRequired(true))
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Welcome channel'))
            .addStringOption(opt => opt
                .setName('message')
                .setDescription('Welcome message (use {user}, {server})')))
        
        .addSubcommand(sub => sub
            .setName('goodbye')
            .setDescription('Configure goodbye messages')
            .addBooleanOption(opt => opt
                .setName('enabled')
                .setDescription('Enable goodbye messages')
                .setRequired(true))
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Goodbye channel'))
            .addStringOption(opt => opt
                .setName('message')
                .setDescription('Goodbye message (use {user}, {server})')))
        
        .addSubcommand(sub => sub
            .setName('tickets')
            .setDescription('Configure ticket system')
            .addBooleanOption(opt => opt
                .setName('enabled')
                .setDescription('Enable tickets')
                .setRequired(true))
            .addChannelOption(opt => opt
                .setName('category')
                .setDescription('Tickets category'))
            .addRoleOption(opt => opt
                .setName('staff_role')
                .setDescription('Staff role for tickets')))
        
        .addSubcommand(sub => sub
            .setName('logging')
            .setDescription('Configure audit logging')
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Log channel')
                .setRequired(true))
            .addBooleanOption(opt => opt
                .setName('log_moderation')
                .setDescription('Log moderation actions'))
            .addBooleanOption(opt => opt
                .setName('log_joins')
                .setDescription('Log member joins/leaves')))
        
        .addSubcommand(sub => sub
            .setName('view')
            .setDescription('View current server configuration')),

    async execute(interaction, bot) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You need **Administrator** permission to use setup commands.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        try {
            // Ensure guild config row exists before any setup operation
            const guildId = interaction.guild.id;
            const existing = await bot.database.get('SELECT guild_id FROM guild_configs WHERE guild_id = ?', [guildId]);
            if (!existing) {
                await bot.database.run('INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)', [guildId]);
            }

            switch (subcommand) {
                case 'start':
                    return await this.handleStart(interaction, bot);
                case 'language':
                    return await this.handleLanguage(interaction, bot);
                case 'verification':
                    return await this.handleVerification(interaction, bot);
                case 'roles':
                    return await this.handleRoles(interaction, bot);
                case 'welcome':
                    return await this.handleWelcome(interaction, bot);
                case 'goodbye':
                    return await this.handleGoodbye(interaction, bot);
                case 'tickets':
                    return await this.handleTickets(interaction, bot);
                case 'logging':
                    return await this.handleLogging(interaction, bot);
                case 'view':
                    return await this.handleView(interaction, bot);
                default:
                    return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
            }
        } catch (error) {
            bot.logger.error('[Setup Command] Error:', error);
            const errorMsg = { content: '❌ An error occurred during setup.', ephemeral: true };
            
            if (interaction.replied) {
                return interaction.followUp(errorMsg);
            } else if (interaction.deferred) {
                return interaction.editReply(errorMsg);
            } else {
                return interaction.reply(errorMsg);
            }
        }
    },

    async handleStart(interaction, bot) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🚀 Setup Wizard')
                .setDescription('Welcome to the server setup wizard!')
                .addFields(
                    { name: '1️⃣ Set Language', value: '`/setup language`' },
                    { name: '2️⃣ Configure Verification', value: '`/setup verification`' },
                    { name: '3️⃣ Setup Welcome Messages', value: '`/setup welcome`' },
                    { name: '4️⃣ Configure Auto-Roles', value: '`/setup roles`' },
                    { name: '5️⃣ Enable Tickets', value: '`/setup tickets`' },
                    { name: '6️⃣ Setup Logging', value: '`/setup logging`' }
                )
                .setFooter({ text: 'Use /setup view to see current configuration' })
                .setTimestamp()]
        });
    },

    async handleLanguage(interaction, bot) {
        const lang = interaction.options.getString('lang');
        const guildId = interaction.guild.id;

        await bot.database.run(
            `INSERT INTO guild_configs (guild_id, language) VALUES (?, ?)
             ON CONFLICT(guild_id) DO UPDATE SET language = ?, updated_at = CURRENT_TIMESTAMP`,
            [guildId, lang, lang]
        );

        const langNames = {
            'en': '🇺🇸 English',
            'es': '🇪🇸 Español',
            'fr': '🇫🇷 Français',
            'de': '🇩🇪 Deutsch',
            'ja': '🇯🇵 日本語'
        };

        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Language Updated')
                .setDescription(`Server language set to ${langNames[lang]}`)
                .setTimestamp()]
        });
    },

    async handleVerification(interaction, bot) {
        const enabled = interaction.options.getBoolean('enabled');
        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('verified_role');
        const guildId = interaction.guild.id;

        const updates = ['verification_enabled = ?'];
        const values = [enabled ? 1 : 0];

        if (channel) {
            updates.push('verification_channel_id = ?');
            values.push(channel.id);
        }
        if (role) {
            updates.push('verified_role_id = ?');
            values.push(role.id);
        }

        values.push(guildId);

        await bot.database.run(
            `UPDATE guild_configs SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
            values
        );

        const fields = [
            channel ? { name: 'Channel', value: `<#${channel.id}>`, inline: true } : null,
            role ? { name: 'Verified Role', value: `<@&${role.id}>`, inline: true } : null
        ].filter(Boolean);

        const embed = new EmbedBuilder()
            .setColor(enabled ? '#00ff00' : '#ff0000')
            .setTitle(enabled ? '✅ Verification Enabled' : '❌ Verification Disabled')
            .setTimestamp();
        if (fields.length > 0) embed.addFields(fields);

        return interaction.reply({ embeds: [embed] });
    },

    async handleRoles(interaction, bot) {
        const role = interaction.options.getRole('role');
        const onJoin = interaction.options.getBoolean('on_join') ?? true;
        const guildId = interaction.guild.id;

        await bot.database.run(
            `INSERT INTO auto_roles (guild_id, role_id, on_join) VALUES (?, ?, ?)`,
            [guildId, role.id, onJoin ? 1 : 0]
        );

        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Auto-Role Added')
                .addFields(
                    { name: 'Role', value: `<@&${role.id}>`, inline: true },
                    { name: 'Trigger', value: onJoin ? 'On Join' : 'Manual', inline: true }
                )
                .setTimestamp()]
        });
    },

    async handleWelcome(interaction, bot) {
        const enabled = interaction.options.getBoolean('enabled');
        const channel = interaction.options.getChannel('channel');
        const message = interaction.options.getString('message');
        const guildId = interaction.guild.id;

        const updates = ['welcome_enabled = ?'];
        const values = [enabled ? 1 : 0];

        if (channel) {
            updates.push('welcome_channel = ?');
            values.push(channel.id);
        }
        if (message) {
            updates.push('welcome_message = ?');
            values.push(message);
        }

        values.push(guildId);

        await bot.database.run(
            `UPDATE guild_configs SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
            values
        );

        const fields = [
            channel ? { name: 'Channel', value: `<#${channel.id}>` } : null,
            message ? { name: 'Message Preview', value: message } : null
        ].filter(Boolean);

        const embed = new EmbedBuilder()
            .setColor(enabled ? '#00ff00' : '#ff0000')
            .setTitle(enabled ? '✅ Welcome Messages Enabled' : '❌ Welcome Messages Disabled')
            .setTimestamp();
        if (fields.length > 0) embed.addFields(fields);

        return interaction.reply({ embeds: [embed] });
    },

    async handleGoodbye(interaction, bot) {
        const enabled = interaction.options.getBoolean('enabled');
        const channel = interaction.options.getChannel('channel');
        const message = interaction.options.getString('message');
        const guildId = interaction.guild.id;

        const updates = ['goodbye_enabled = ?'];
        const values = [enabled ? 1 : 0];

        if (channel) {
            updates.push('goodbye_channel = ?');
            values.push(channel.id);
        }
        if (message) {
            updates.push('goodbye_message = ?');
            values.push(message);
        }

        values.push(guildId);

        await bot.database.run(
            `UPDATE guild_configs SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
            values
        );

        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(enabled ? '#00ff00' : '#ff0000')
                .setTitle(enabled ? '✅ Goodbye Messages Enabled' : '❌ Goodbye Messages Disabled')
                .setTimestamp()]
        });
    },

    async handleTickets(interaction, bot) {
        const enabled = interaction.options.getBoolean('enabled');
        const category = interaction.options.getChannel('category');
        const staffRole = interaction.options.getRole('staff_role');
        const guildId = interaction.guild.id;

        const updates = ['tickets_enabled = ?'];
        const values = [enabled ? 1 : 0];

        if (category) {
            updates.push('ticket_category = ?');
            values.push(category.id);
        }
        if (staffRole) {
            updates.push('ticket_staff_role = ?');
            values.push(staffRole.id);
        }

        values.push(guildId);

        await bot.database.run(
            `UPDATE guild_configs SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
            values
        );

        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(enabled ? '#00ff00' : '#ff0000')
                .setTitle(enabled ? '✅ Tickets Enabled' : '❌ Tickets Disabled')
                .setTimestamp()]
        });
    },

    async handleLogging(interaction, bot) {
        const channel = interaction.options.getChannel('channel');
        const logModeration = interaction.options.getBoolean('log_moderation') ?? true;
        const logJoins = interaction.options.getBoolean('log_joins') ?? true;
        const guildId = interaction.guild.id;

        await bot.database.run(
            `UPDATE guild_configs SET log_channel_id = ?, log_moderation = ?, log_joins = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
            [channel.id, logModeration ? 1 : 0, logJoins ? 1 : 0, guildId]
        );

        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Logging Configured')
                .addFields(
                    { name: 'Log Channel', value: `<#${channel.id}>` },
                    { name: 'Logging', value: [
                        logModeration ? '✅ Moderation' : '❌ Moderation',
                        logJoins ? '✅ Joins/Leaves' : '❌ Joins/Leaves'
                    ].join('\n') }
                )
                .setTimestamp()]
        });
    },

    async handleView(interaction, bot) {
        const guildId = interaction.guild.id;
        
        const config = await bot.database.get(
            `SELECT * FROM guild_configs WHERE guild_id = ?`,
            [guildId]
        );

        if (!config) {
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('⚠️ No Configuration Found')
                    .setDescription('Run `/setup start` to begin setup.')
                    .setTimestamp()],
                ephemeral: true
            });
        }

        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('⚙️ Server Configuration')
                .addFields(
                    { name: 'Language', value: config.language || 'en', inline: true },
                    { name: 'Verification', value: config.verification_enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                    { name: 'Welcome', value: config.welcome_enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                    { name: 'Tickets', value: config.tickets_enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                    { name: 'Logging', value: config.log_channel_id ? `<#${config.log_channel_id}>` : 'Not set', inline: true }
                )
                .setTimestamp()]
        });
    }
};
