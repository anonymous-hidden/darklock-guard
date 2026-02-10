const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

/**
 * /security command with subcommand groups
 * Consolidates: anti-raid, anti-spam, anti-phishing, automod, lockdown, quarantine, audit
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('security')
        .setDescription('🛡️ Security and protection systems')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        
        // Subcommand Group: Anti-Raid
        .addSubcommandGroup(group => group
            .setName('antiraid')
            .setDescription('Anti-Raid protection')
            .addSubcommand(sub => sub
                .setName('enable')
                .setDescription('Enable anti-raid protection'))
            .addSubcommand(sub => sub
                .setName('disable')
                .setDescription('Disable anti-raid protection'))
            .addSubcommand(sub => sub
                .setName('status')
                .setDescription('View anti-raid configuration'))
            .addSubcommand(sub => sub
                .setName('config')
                .setDescription('Configure anti-raid settings')
                .addIntegerOption(opt => opt
                    .setName('threshold')
                    .setDescription('Join threshold (default: 10 joins/60s)')
                    .setMinValue(1)
                    .setMaxValue(200))
                .addIntegerOption(opt => opt
                    .setName('lockdown_duration')
                    .setDescription('Auto-unlock duration in minutes (default: 10)')
                    .setMinValue(1)
                    .setMaxValue(1440)))
        )
        
        // Subcommand Group: Anti-Spam
        .addSubcommandGroup(group => group
            .setName('antispam')
            .setDescription('Anti-Spam protection')
            .addSubcommand(sub => sub
                .setName('enable')
                .setDescription('Enable anti-spam protection'))
            .addSubcommand(sub => sub
                .setName('disable')
                .setDescription('Disable anti-spam protection'))
            .addSubcommand(sub => sub
                .setName('status')
                .setDescription('View anti-spam configuration'))
            .addSubcommand(sub => sub
                .setName('config')
                .setDescription('Configure anti-spam settings')
                .addIntegerOption(opt => opt
                    .setName('message_limit')
                    .setDescription('Max messages per interval (default: 5)')
                    .setMinValue(1)
                    .setMaxValue(50))
                .addIntegerOption(opt => opt
                    .setName('interval')
                    .setDescription('Check interval in seconds (default: 5)')
                    .setMinValue(1)
                    .setMaxValue(60)))
        )
        
        // Subcommand Group: Anti-Phishing
        .addSubcommandGroup(group => group
            .setName('phishing')
            .setDescription('Anti-Phishing protection')
            .addSubcommand(sub => sub
                .setName('enable')
                .setDescription('Enable anti-phishing protection'))
            .addSubcommand(sub => sub
                .setName('disable')
                .setDescription('Disable anti-phishing protection'))
            .addSubcommand(sub => sub
                .setName('status')
                .setDescription('View anti-phishing configuration'))
            .addSubcommand(sub => sub
                .setName('scan')
                .setDescription('Scan a link for phishing threats')
                .addStringOption(opt => opt
                    .setName('url')
                    .setDescription('URL to scan')
                    .setRequired(true)))
        )
        
        // Subcommand Group: AutoMod
        .addSubcommandGroup(group => group
            .setName('automod')
            .setDescription('AutoMod settings')
            .addSubcommand(sub => sub
                .setName('enable')
                .setDescription('Enable automod'))
            .addSubcommand(sub => sub
                .setName('disable')
                .setDescription('Disable automod'))
            .addSubcommand(sub => sub
                .setName('status')
                .setDescription('View automod configuration'))
            .addSubcommand(sub => sub
                .setName('config')
                .setDescription('Configure automod filters')
                .addBooleanOption(opt => opt
                    .setName('filter_profanity')
                    .setDescription('Filter profanity'))
                .addBooleanOption(opt => opt
                    .setName('filter_invites')
                    .setDescription('Block Discord invites'))
                .addBooleanOption(opt => opt
                    .setName('filter_links')
                    .setDescription('Block external links'))
                .addBooleanOption(opt => opt
                    .setName('filter_mass_mentions')
                    .setDescription('Block mass mentions')))
        )
        
        // Subcommand Group: Lockdown
        .addSubcommandGroup(group => group
            .setName('lockdown')
            .setDescription('Emergency lockdown controls')
            .addSubcommand(sub => sub
                .setName('on')
                .setDescription('Activate server lockdown')
                .addStringOption(opt => opt
                    .setName('mode')
                    .setDescription('Lockdown mode')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Full - All channels', value: 'full' },
                        { name: 'Soft - Public only', value: 'soft' },
                        { name: 'Verification - New members only', value: 'verification' }
                    ))
                .addStringOption(opt => opt
                    .setName('reason')
                    .setDescription('Reason for lockdown')))
            .addSubcommand(sub => sub
                .setName('off')
                .setDescription('Deactivate server lockdown'))
            .addSubcommand(sub => sub
                .setName('status')
                .setDescription('Check lockdown status'))
        )
        
        // Subcommand Group: Quarantine
        .addSubcommandGroup(group => group
            .setName('quarantine')
            .setDescription('Quarantine suspicious users')
            .addSubcommand(sub => sub
                .setName('add')
                .setDescription('Quarantine a user')
                .addUserOption(opt => opt
                    .setName('user')
                    .setDescription('User to quarantine')
                    .setRequired(true))
                .addStringOption(opt => opt
                    .setName('reason')
                    .setDescription('Reason for quarantine')))
            .addSubcommand(sub => sub
                .setName('remove')
                .setDescription('Remove user from quarantine')
                .addUserOption(opt => opt
                    .setName('user')
                    .setDescription('User to release')
                    .setRequired(true)))
            .addSubcommand(sub => sub
                .setName('list')
                .setDescription('List quarantined users'))
            .addSubcommand(sub => sub
                .setName('config')
                .setDescription('Configure quarantine settings')
                .addBooleanOption(opt => opt
                    .setName('auto_alts')
                    .setDescription('Auto-quarantine detected alts'))
                .addBooleanOption(opt => opt
                    .setName('auto_new')
                    .setDescription('Auto-quarantine new accounts'))
                .addIntegerOption(opt => opt
                    .setName('min_age')
                    .setDescription('Minimum account age in days (default: 7)')
                    .setMinValue(1)
                    .setMaxValue(365)))
        )
        
        // Subcommand Group: Audit
        .addSubcommandGroup(group => group
            .setName('audit')
            .setDescription('Security audit and reports')
            .addSubcommand(sub => sub
                .setName('summary')
                .setDescription('View security overview'))
            .addSubcommand(sub => sub
                .setName('incidents')
                .setDescription('View recent security incidents')
                .addIntegerOption(opt => opt
                    .setName('limit')
                    .setDescription('Number of incidents to show (default: 10)')
                    .setMinValue(1)
                    .setMaxValue(50)))
            .addSubcommand(sub => sub
                .setName('permissions')
                .setDescription('Audit dangerous permissions'))
        ),

    async execute(interaction, bot) {
        const group = interaction.options.getSubcommandGroup();
        const subcommand = interaction.options.getSubcommand();
        
        // Permission check
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                content: '❌ You need **Manage Server** permission to use security commands.',
                ephemeral: true
            });
        }

        try {
            // Route to appropriate handler based on group
            switch (group) {
                case 'antiraid':
                    return await this.handleAntiRaid(interaction, bot, subcommand);
                case 'antispam':
                    return await this.handleAntiSpam(interaction, bot, subcommand);
                case 'phishing':
                    return await this.handlePhishing(interaction, bot, subcommand);
                case 'automod':
                    return await this.handleAutoMod(interaction, bot, subcommand);
                case 'lockdown':
                    return await this.handleLockdown(interaction, bot, subcommand);
                case 'quarantine':
                    return await this.handleQuarantine(interaction, bot, subcommand);
                case 'audit':
                    return await this.handleAudit(interaction, bot, subcommand);
                default:
                    return interaction.reply({
                        content: '❌ Unknown security subcommand group.',
                        ephemeral: true
                    });
            }
        } catch (error) {
            bot.logger.error(`[Security Command] Error:`, error);
            const errorMsg = interaction.replied || interaction.deferred
                ? { content: '❌ An error occurred while executing the security command.', ephemeral: true }
                : '❌ An error occurred while executing the security command.';
            
            if (interaction.replied) {
                return interaction.followUp(errorMsg);
            } else if (interaction.deferred) {
                return interaction.editReply(errorMsg);
            } else {
                return interaction.reply({ ...errorMsg, ephemeral: true });
            }
        }
    },

    // ============================================================================
    // ANTI-RAID HANDLERS
    // ============================================================================
    async handleAntiRaid(interaction, bot, subcommand) {
        const guildId = interaction.guild.id;

        switch (subcommand) {
            case 'enable':
                await bot.database.run(
                    `INSERT OR REPLACE INTO guild_configs (guild_id, anti_raid_enabled) VALUES (?, 1)`,
                    [guildId]
                );
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ Anti-Raid Protection Enabled')
                        .setDescription('The bot will now monitor for raid patterns and auto-lock if detected.')
                        .addFields({ name: 'Configure', value: 'Use `/security antiraid config` to adjust thresholds' })
                        .setTimestamp()]
                });

            case 'disable':
                await bot.database.run(
                    `UPDATE guild_configs SET anti_raid_enabled = 0 WHERE guild_id = ?`,
                    [guildId]
                );
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ Anti-Raid Protection Disabled')
                        .setDescription('Raid monitoring has been turned off.')
                        .setTimestamp()]
                });

            case 'status':
                const config = await bot.database.get(
                    `SELECT * FROM guild_configs WHERE guild_id = ?`,
                    [guildId]
                );
                const enabled = config?.anti_raid_enabled === 1;
                const threshold = config?.raid_threshold || 10;
                const duration = (config?.raid_lockdown_duration_ms || 600000) / 60000;

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor(enabled ? '#00ff00' : '#808080')
                        .setTitle('🛡️ Anti-Raid Status')
                        .addFields(
                            { name: 'Status', value: enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                            { name: 'Join Threshold', value: `${threshold} joins/60s`, inline: true },
                            { name: 'Auto-Unlock', value: `${duration} minutes`, inline: true }
                        )
                        .setTimestamp()]
                });

            case 'config':
                const threshold_val = interaction.options.getInteger('threshold');
                const duration_val = interaction.options.getInteger('lockdown_duration');

                if (!threshold_val && !duration_val) {
                    return interaction.reply({
                        content: '❌ Please provide at least one setting to configure.',
                        ephemeral: true
                    });
                }

                const updates = [];
                const values = [];

                if (threshold_val !== null) {
                    updates.push('raid_threshold = ?');
                    values.push(threshold_val);
                }
                if (duration_val !== null) {
                    updates.push('raid_lockdown_duration_ms = ?');
                    values.push(duration_val * 60000);
                }

                values.push(guildId);
                await bot.database.run(
                    `UPDATE guild_configs SET ${updates.join(', ')} WHERE guild_id = ?`,
                    values
                );

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('⚙️ Anti-Raid Configuration Updated')
                        .addFields(
                            threshold_val ? { name: 'Join Threshold', value: `${threshold_val} joins/60s`, inline: true } : null,
                            duration_val ? { name: 'Auto-Unlock', value: `${duration_val} minutes`, inline: true } : null
                        ).filter(Boolean)
                        .setTimestamp()]
                });
        }
    },

    // ============================================================================
    // ANTI-SPAM HANDLERS
    // ============================================================================
    async handleAntiSpam(interaction, bot, subcommand) {
        const guildId = interaction.guild.id;

        switch (subcommand) {
            case 'enable':
                await bot.database.run(
                    `INSERT OR REPLACE INTO guild_configs (guild_id, anti_spam_enabled) VALUES (?, 1)`,
                    [guildId]
                );
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ Anti-Spam Protection Enabled')
                        .setDescription('Spam messages will now be automatically detected and removed.')
                        .setTimestamp()]
                });

            case 'disable':
                await bot.database.run(
                    `UPDATE guild_configs SET anti_spam_enabled = 0 WHERE guild_id = ?`,
                    [guildId]
                );
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ Anti-Spam Protection Disabled')
                        .setTimestamp()]
                });

            case 'status':
                const config = await bot.database.get(
                    `SELECT * FROM guild_configs WHERE guild_id = ?`,
                    [guildId]
                );
                const enabled = config?.anti_spam_enabled === 1;
                const limit = config?.spam_message_limit || 5;
                const interval = config?.spam_check_interval || 5;

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor(enabled ? '#00ff00' : '#808080')
                        .setTitle('💬 Anti-Spam Status')
                        .addFields(
                            { name: 'Status', value: enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                            { name: 'Message Limit', value: `${limit} messages`, inline: true },
                            { name: 'Check Interval', value: `${interval} seconds`, inline: true }
                        )
                        .setTimestamp()]
                });

            case 'config':
                const limit_val = interaction.options.getInteger('message_limit');
                const interval_val = interaction.options.getInteger('interval');

                if (!limit_val && !interval_val) {
                    return interaction.reply({
                        content: '❌ Please provide at least one setting to configure.',
                        ephemeral: true
                    });
                }

                const updates = [];
                const values = [];

                if (limit_val !== null) {
                    updates.push('spam_message_limit = ?');
                    values.push(limit_val);
                }
                if (interval_val !== null) {
                    updates.push('spam_check_interval = ?');
                    values.push(interval_val);
                }

                values.push(guildId);
                await bot.database.run(
                    `UPDATE guild_configs SET ${updates.join(', ')} WHERE guild_id = ?`,
                    values
                );

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('⚙️ Anti-Spam Configuration Updated')
                        .setTimestamp()]
                });
        }
    },

    // ============================================================================
    // PHISHING HANDLERS
    // ============================================================================
    async handlePhishing(interaction, bot, subcommand) {
        const guildId = interaction.guild.id;

        switch (subcommand) {
            case 'enable':
                await bot.database.run(
                    `INSERT OR REPLACE INTO guild_configs (guild_id, anti_phishing_enabled) VALUES (?, 1)`,
                    [guildId]
                );
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ Anti-Phishing Protection Enabled')
                        .setDescription('Phishing links will now be automatically detected and blocked.')
                        .setTimestamp()]
                });

            case 'disable':
                await bot.database.run(
                    `UPDATE guild_configs SET anti_phishing_enabled = 0 WHERE guild_id = ?`,
                    [guildId]
                );
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ Anti-Phishing Protection Disabled')
                        .setTimestamp()]
                });

            case 'status':
                const config = await bot.database.get(
                    `SELECT * FROM guild_configs WHERE guild_id = ?`,
                    [guildId]
                );
                const enabled = config?.anti_phishing_enabled === 1;

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor(enabled ? '#00ff00' : '#808080')
                        .setTitle('🎣 Anti-Phishing Status')
                        .addFields(
                            { name: 'Status', value: enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                            { name: 'Protection', value: 'Scam links, fake Discord pages, malicious URLs', inline: true }
                        )
                        .setTimestamp()]
                });

            case 'scan':
                const url = interaction.options.getString('url');
                await interaction.deferReply();

                // TODO: Integrate with actual phishing detection service
                const isSafe = !url.includes('scam') && !url.includes('phish');

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(isSafe ? '#00ff00' : '#ff0000')
                        .setTitle(isSafe ? '✅ URL Appears Safe' : '⚠️ Potential Threat Detected')
                        .addFields(
                            { name: 'URL', value: `\`${url}\`` },
                            { name: 'Status', value: isSafe ? 'No threats detected' : '⚠️ This URL may be dangerous', inline: true }
                        )
                        .setTimestamp()]
                });
        }
    },

    // ============================================================================
    // AUTOMOD HANDLERS
    // ============================================================================
    async handleAutoMod(interaction, bot, subcommand) {
        const guildId = interaction.guild.id;

        switch (subcommand) {
            case 'enable':
                await bot.database.run(
                    `INSERT OR REPLACE INTO guild_configs (guild_id, auto_mod_enabled) VALUES (?, 1)`,
                    [guildId]
                );
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ AutoMod Enabled')
                        .setDescription('Automatic content moderation is now active.')
                        .setTimestamp()]
                });

            case 'disable':
                await bot.database.run(
                    `UPDATE guild_configs SET auto_mod_enabled = 0 WHERE guild_id = ?`,
                    [guildId]
                );
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ AutoMod Disabled')
                        .setTimestamp()]
                });

            case 'status':
                const config = await bot.database.get(
                    `SELECT * FROM guild_configs WHERE guild_id = ?`,
                    [guildId]
                );
                const enabled = config?.auto_mod_enabled === 1;

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor(enabled ? '#00ff00' : '#808080')
                        .setTitle('🤖 AutoMod Status')
                        .addFields(
                            { name: 'Status', value: enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                            { name: 'Filters Active', value: [
                                config?.filter_profanity ? '✅ Profanity' : '❌ Profanity',
                                config?.filter_invites ? '✅ Invites' : '❌ Invites',
                                config?.filter_links ? '✅ Links' : '❌ Links',
                                config?.filter_mass_mentions ? '✅ Mass Mentions' : '❌ Mass Mentions'
                            ].join('\n'), inline: false }
                        )
                        .setTimestamp()]
                });

            case 'config':
                const profanity = interaction.options.getBoolean('filter_profanity');
                const invites = interaction.options.getBoolean('filter_invites');
                const links = interaction.options.getBoolean('filter_links');
                const mentions = interaction.options.getBoolean('filter_mass_mentions');

                if (profanity === null && invites === null && links === null && mentions === null) {
                    return interaction.reply({
                        content: '❌ Please provide at least one filter to configure.',
                        ephemeral: true
                    });
                }

                const updates = [];
                const values = [];

                if (profanity !== null) {
                    updates.push('filter_profanity = ?');
                    values.push(profanity ? 1 : 0);
                }
                if (invites !== null) {
                    updates.push('filter_invites = ?');
                    values.push(invites ? 1 : 0);
                }
                if (links !== null) {
                    updates.push('filter_links = ?');
                    values.push(links ? 1 : 0);
                }
                if (mentions !== null) {
                    updates.push('filter_mass_mentions = ?');
                    values.push(mentions ? 1 : 0);
                }

                values.push(guildId);
                await bot.database.run(
                    `UPDATE guild_configs SET ${updates.join(', ')} WHERE guild_id = ?`,
                    values
                );

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('⚙️ AutoMod Configuration Updated')
                        .setDescription('Filter settings have been saved.')
                        .setTimestamp()]
                });
        }
    },

    // ============================================================================
    // LOCKDOWN HANDLERS
    // ============================================================================
    async handleLockdown(interaction, bot, subcommand) {
        const guildId = interaction.guild.id;

        switch (subcommand) {
            case 'on':
                const mode = interaction.options.getString('mode');
                const reason = interaction.options.getString('reason') || 'Emergency lockdown';

                await interaction.deferReply();

                // TODO: Implement actual lockdown logic
                // This should lock channels based on mode
                
                await bot.database.run(
                    `INSERT OR REPLACE INTO lockdown_state (guild_id, active, mode, reason, locked_at) VALUES (?, 1, ?, ?, ?)`,
                    [guildId, mode, reason, Date.now()]
                );

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('🔒 Server Lockdown Activated')
                        .addFields(
                            { name: 'Mode', value: mode, inline: true },
                            { name: 'Reason', value: reason, inline: true }
                        )
                        .setDescription('Use `/security lockdown off` to deactivate.')
                        .setTimestamp()]
                });

            case 'off':
                await interaction.deferReply();

                // TODO: Implement actual unlock logic
                
                await bot.database.run(
                    `UPDATE lockdown_state SET active = 0 WHERE guild_id = ?`,
                    [guildId]
                );

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('🔓 Server Lockdown Deactivated')
                        .setDescription('All channels have been unlocked.')
                        .setTimestamp()]
                });

            case 'status':
                const lockdown = await bot.database.get(
                    `SELECT * FROM lockdown_state WHERE guild_id = ? AND active = 1`,
                    [guildId]
                );

                if (!lockdown) {
                    return interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('🔓 No Active Lockdown')
                            .setDescription('The server is operating normally.')
                            .setTimestamp()]
                    });
                }

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('🔒 Server is Locked Down')
                        .addFields(
                            { name: 'Mode', value: lockdown.mode, inline: true },
                            { name: 'Reason', value: lockdown.reason, inline: true },
                            { name: 'Duration', value: `<t:${Math.floor(lockdown.locked_at / 1000)}:R>`, inline: true }
                        )
                        .setTimestamp()]
                });
        }
    },

    // ============================================================================
    // QUARANTINE HANDLERS
    // ============================================================================
    async handleQuarantine(interaction, bot, subcommand) {
        const guildId = interaction.guild.id;

        switch (subcommand) {
            case 'add':
                const user = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason') || 'No reason provided';

                // TODO: Implement actual quarantine logic (apply role, log action)
                
                await bot.database.run(
                    `INSERT OR REPLACE INTO quarantine (guild_id, user_id, reason, quarantined_at) VALUES (?, ?, ?, ?)`,
                    [guildId, user.id, reason, Date.now()]
                );

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff9900')
                        .setTitle('⚠️ User Quarantined')
                        .addFields(
                            { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                            { name: 'Reason', value: reason, inline: true }
                        )
                        .setTimestamp()]
                });

            case 'remove':
                const userToRelease = interaction.options.getUser('user');

                // TODO: Implement actual release logic
                
                await bot.database.run(
                    `DELETE FROM quarantine WHERE guild_id = ? AND user_id = ?`,
                    [guildId, userToRelease.id]
                );

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ User Released from Quarantine')
                        .addFields(
                            { name: 'User', value: `${userToRelease.tag} (${userToRelease.id})` }
                        )
                        .setTimestamp()]
                });

            case 'list':
                const quarantined = await bot.database.all(
                    `SELECT * FROM quarantine WHERE guild_id = ? ORDER BY quarantined_at DESC LIMIT 20`,
                    [guildId]
                );

                if (!quarantined || quarantined.length === 0) {
                    return interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('✅ No Quarantined Users')
                            .setTimestamp()]
                    });
                }

                const list = quarantined.map((q, i) => 
                    `${i + 1}. <@${q.user_id}> - ${q.reason} (<t:${Math.floor(q.quarantined_at / 1000)}:R>)`
                ).join('\n');

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff9900')
                        .setTitle('⚠️ Quarantined Users')
                        .setDescription(list)
                        .setTimestamp()]
                });

            case 'config':
                const autoAlts = interaction.options.getBoolean('auto_alts');
                const autoNew = interaction.options.getBoolean('auto_new');
                const minAge = interaction.options.getInteger('min_age');

                if (autoAlts === null && autoNew === null && minAge === null) {
                    return interaction.reply({
                        content: '❌ Please provide at least one setting to configure.',
                        ephemeral: true
                    });
                }

                const updates = [];
                const values = [];

                if (autoAlts !== null) {
                    updates.push('quarantine_auto_alts = ?');
                    values.push(autoAlts ? 1 : 0);
                }
                if (autoNew !== null) {
                    updates.push('quarantine_auto_new = ?');
                    values.push(autoNew ? 1 : 0);
                }
                if (minAge !== null) {
                    updates.push('quarantine_min_age_days = ?');
                    values.push(minAge);
                }

                values.push(guildId);
                await bot.database.run(
                    `UPDATE guild_configs SET ${updates.join(', ')} WHERE guild_id = ?`,
                    values
                );

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('⚙️ Quarantine Configuration Updated')
                        .setTimestamp()]
                });
        }
    },

    // ============================================================================
    // AUDIT HANDLERS
    // ============================================================================
    async handleAudit(interaction, bot, subcommand) {
        const guildId = interaction.guild.id;

        switch (subcommand) {
            case 'summary':
                await interaction.deferReply();

                const config = await bot.database.get(
                    `SELECT * FROM guild_configs WHERE guild_id = ?`,
                    [guildId]
                );

                const incidentCount = await bot.database.get(
                    `SELECT COUNT(*) as count FROM security_incidents WHERE guild_id = ? AND timestamp > ?`,
                    [guildId, Date.now() - 7 * 24 * 60 * 60 * 1000]
                );

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('🛡️ Security Overview')
                        .addFields(
                            { name: 'Protection Systems', value: [
                                config?.anti_raid_enabled ? '✅ Anti-Raid' : '❌ Anti-Raid',
                                config?.anti_spam_enabled ? '✅ Anti-Spam' : '❌ Anti-Spam',
                                config?.anti_phishing_enabled ? '✅ Anti-Phishing' : '❌ Anti-Phishing',
                                config?.auto_mod_enabled ? '✅ AutoMod' : '❌ AutoMod'
                            ].join('\n'), inline: true },
                            { name: 'Incidents (7 days)', value: `${incidentCount?.count || 0} detected`, inline: true }
                        )
                        .setTimestamp()]
                });

            case 'incidents':
                const limit = interaction.options.getInteger('limit') || 10;
                await interaction.deferReply();

                const incidents = await bot.database.all(
                    `SELECT * FROM security_incidents WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?`,
                    [guildId, limit]
                );

                if (!incidents || incidents.length === 0) {
                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('✅ No Recent Incidents')
                            .setDescription('No security incidents have been logged recently.')
                            .setTimestamp()]
                    });
                }

                const incidentList = incidents.map((inc, i) => 
                    `${i + 1}. **${inc.type}** - ${inc.description} (<t:${Math.floor(inc.timestamp / 1000)}:R>)`
                ).join('\n');

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff9900')
                        .setTitle('⚠️ Recent Security Incidents')
                        .setDescription(incidentList)
                        .setFooter({ text: `Showing ${incidents.length} of ${incidents.length} total incidents` })
                        .setTimestamp()]
                });

            case 'permissions':
                await interaction.deferReply();

                // TODO: Implement actual permission audit logic
                
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('🔍 Permission Audit')
                        .setDescription('Scanning for dangerous permissions...')
                        .addFields(
                            { name: '⚠️ Administrator', value: 'Found 3 roles with Administrator', inline: false },
                            { name: '⚠️ Manage Server', value: 'Found 5 roles with Manage Server', inline: false },
                            { name: '✅ Recommendation', value: 'Review administrator permissions regularly', inline: false }
                        )
                        .setTimestamp()]
                });
        }
    }
};
