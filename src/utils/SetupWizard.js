const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder,
    ChannelType,
    PermissionFlagsBits 
} = require('discord.js');

class SetupWizard {
    constructor(bot) {
        this.bot = bot;
        this.activeSetups = new Map(); // Track ongoing setup sessions
    }

    // Start the setup wizard for a guild
    async startSetup(interaction, forceRestart = false) {
        const guild = interaction.guild;
        const user = interaction.user;

        // Check if user has admin permissions
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({
                content: '❌ You need Administrator permissions to run the setup wizard.',
                ephemeral: true
            });
            return;
        }

        // Check if setup is already in progress
        if (this.activeSetups.has(guild.id) && !forceRestart) {
            await interaction.reply({
                content: '⚠️ Setup wizard is already in progress! Use `/setup restart` to restart it.',
                ephemeral: true
            });
            return;
        }

        try {
            // Initialize setup session
            const setupData = {
                guildId: guild.id,
                userId: user.id,
                step: 0,
                data: {},
                startedAt: Date.now()
            };

            this.activeSetups.set(guild.id, setupData);

            // Start with welcome step
            await this.showWelcomeStep(interaction);
        } catch (error) {
            this.bot.logger.error('Error starting setup wizard:', error);
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.editReply({
                        content: '❌ Failed to start setup wizard. Please try `/setup wizard start`.',
                        embeds: [],
                        components: []
                    });
                } else {
                    await interaction.reply({
                        content: '❌ Failed to start setup wizard. Please try `/setup wizard start`.',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                this.bot.logger.error('Could not send error message:', replyError);
            }
        }
    }

    // Welcome step
    async showWelcomeStep(interaction) {
        const botAvatar = this.bot.user?.displayAvatarURL() || 'https://cdn.discordapp.com/embed/avatars/0.png';
        
        const embed = new EmbedBuilder()
            .setTitle('🚀 Welcome to Bot Setup Wizard!')
            .setDescription(`Hi ${interaction.user}! I'll help you set up your server with all the essential features.`)
            .addFields([
                { name: '📋 What we\'ll configure:', value: '• Security system (anti-spam, anti-raid)\n• Command permissions & roles\n• Analytics and logging\n• Ticket support system\n• Dashboard settings\n• Channel setup\n• Bot preferences', inline: false },
                { name: '⏱️ Estimated time:', value: '8-12 minutes', inline: true },
                { name: '🔧 Requirements:', value: 'Administrator permissions', inline: true },
                { name: '💡 Tip:', value: 'You can skip any step and configure it later!', inline: false }
            ])
            .setColor(0x00ff00)
            .setThumbnail(botAvatar)
            .setFooter({ text: 'Step 1/8 • Setup Wizard' });

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_continue')
                    .setLabel('Let\'s Get Started!')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🚀'),
                new ButtonBuilder()
                    .setCustomId('setup_cancel')
                    .setLabel('Cancel Setup')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ embeds: [embed], components: [buttons] });
        } else {
            await interaction.reply({ embeds: [embed], components: [buttons], ephemeral: false });
        }
    }

    // Channel setup step
    async showChannelSetupStep(interaction) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        setupData.step = 1;

        const embed = new EmbedBuilder()
            .setTitle('📂 Channel Setup')
            .setDescription('Let\'s set up the essential channels for your bot to function properly.')
            .addFields([
                { name: '📝 Log Channel', value: 'Where I\'ll send security alerts and event logs', inline: false },
                { name: '🎫 Ticket Category', value: 'Category where support tickets will be created', inline: false },
                { name: '📋 Transcript Channel', value: 'Where ticket transcripts will be saved', inline: false },
                { name: '🎯 Current Selection', value: 'None selected yet', inline: false }
            ])
            .setColor(0x0099ff)
            .setFooter({ text: 'Step 2/8 • Channel Setup' });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('setup_channel_select')
            .setPlaceholder('Choose a channel type to configure...')
            .addOptions([
                {
                    label: 'Log Channel',
                    description: 'Set the main logging channel',
                    value: 'log_channel',
                    emoji: '📝'
                },
                {
                    label: 'Ticket Category',
                    description: 'Set the ticket category',
                    value: 'ticket_category',
                    emoji: '🎫'
                },
                {
                    label: 'Transcript Channel',
                    description: 'Set the transcript channel',
                    value: 'transcript_channel',
                    emoji: '📋'
                }
            ]);

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_channel_auto')
                    .setLabel('Auto-Create Channels')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚡'),
                new ButtonBuilder()
                    .setCustomId('setup_channel_skip')
                    .setLabel('Skip for Now')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⏭️'),
                new ButtonBuilder()
                    .setCustomId('setup_channel_next')
                    .setLabel('Continue')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('➡️')
            );

        await interaction.editReply({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(selectMenu), buttons]
        });
    }

    // Security setup step
    async showSecuritySetupStep(interaction) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        setupData.step = 2;

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Security Configuration')
            .setDescription('Configure your server\'s security systems to protect against spam, raids, and other threats.')
            .addFields([
                { 
                    name: '🚫 Anti-Spam Protection', 
                    value: 'Automatically detects and handles message spam\n**Recommended:** Enabled', 
                    inline: true 
                },
                { 
                    name: '⚡ Anti-Raid Protection', 
                    value: 'Protects against mass join attacks\n**Recommended:** Enabled', 
                    inline: true 
                },
                { 
                    name: '🎣 Anti-Phishing', 
                    value: 'Blocks malicious links and scams\n**Recommended:** Enabled', 
                    inline: true 
                },
                { 
                    name: '🤖 AutoMod', 
                    value: 'Filters inappropriate content automatically\n**Recommended:** Enabled', 
                    inline: true 
                }
            ])
            .setColor(0xff6600)
            .setFooter({ text: 'Step 3/8 • Security Setup' });

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_security_recommended')
                    .setLabel('Use Recommended Settings')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('⭐'),
                new ButtonBuilder()
                    .setCustomId('setup_security_custom')
                    .setLabel('Custom Configuration')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚙️'),
                new ButtonBuilder()
                    .setCustomId('setup_security_skip')
                    .setLabel('Skip Security')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⏭️')
            );

        const nextButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_security_next')
                    .setLabel('Continue to Permissions')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('➡️')
            );

        await interaction.editReply({
            embeds: [embed],
            components: [buttons, nextButton]
        });
    }

    // Permissions/Roles setup step
    async showPermissionsSetupStep(interaction) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        setupData.step = 3.5;

        const roles = interaction.guild.roles.cache
            .filter(r => !r.managed && r.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .first(10);

        const embed = new EmbedBuilder()
            .setTitle('🔐 Command Permissions Setup')
            .setDescription('Control which roles can use bot commands. Choose roles for moderation, analytics, and admin access.')
            .addFields([
                { 
                    name: '👮 Moderation Group', 
                    value: 'Can use: ban, kick, timeout, warn, purge\n**Who should have this?** Moderators', 
                    inline: true 
                },
                { 
                    name: '📊 Analytics Group', 
                    value: 'Can use: analytics, reports, stats\n**Who should have this?** Analysts, Admins', 
                    inline: true 
                },
                { 
                    name: '🎫 Tickets Group', 
                    value: 'Can use: ticket management, categories\n**Who should have this?** Support staff', 
                    inline: true 
                },
                { 
                    name: '⚡ Detected Roles', 
                    value: roles.length ? roles.map(r => r.toString()).join(', ') : 'No roles found', 
                    inline: false 
                }
            ])
            .setColor(0xffaa00)
            .setFooter({ text: 'Step 4/8 • Permissions Setup' });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('setup_permissions_group')
            .setPlaceholder('Choose a command group to configure...')
            .addOptions([
                { label: 'Moderation', value: 'moderation', emoji: '👮' },
                { label: 'Security', value: 'security', emoji: '🛡️' },
                { label: 'Analytics', value: 'analytics', emoji: '📊' },
                { label: 'Tickets', value: 'tickets', emoji: '🎫' },
                { label: 'Admin', value: 'admin', emoji: '⚙️' }
            ]);

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_permissions_auto')
                    .setLabel('Auto-Detect Roles')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚡'),
                new ButtonBuilder()
                    .setCustomId('setup_permissions_skip')
                    .setLabel('Skip for Now')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⏭️'),
                new ButtonBuilder()
                    .setCustomId('setup_permissions_next')
                    .setLabel('Continue')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('➡️')
            );

        await interaction.editReply({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(selectMenu), buttons]
        });
    }

    // Analytics setup step
    async showAnalyticsSetupStep(interaction) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        setupData.step = 3;

        const embed = new EmbedBuilder()
            .setTitle('📊 Analytics Configuration')
            .setDescription('Set up data collection to track your server\'s activity and growth.')
            .addFields([
                { 
                    name: '📈 What gets tracked:', 
                    value: '• Message activity\n• Command usage\n• Member joins/leaves\n• Voice activity\n• User engagement', 
                    inline: true 
                },
                { 
                    name: '🔒 Privacy:', 
                    value: '• No personal data stored\n• Anonymized statistics\n• GDPR compliant\n• Can be disabled anytime', 
                    inline: true 
                },
                { 
                    name: '💡 Benefits:', 
                    value: '• Growth insights\n• Activity patterns\n• Popular content\n• Member retention data', 
                    inline: true 
                }
            ])
            .setColor(0x00aa00)
            .setFooter({ text: 'Step 5/8 • Analytics Setup' });

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_analytics_enable')
                    .setLabel('Enable Analytics')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('📊'),
                new ButtonBuilder()
                    .setCustomId('setup_analytics_minimal')
                    .setLabel('Minimal Tracking')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📉'),
                new ButtonBuilder()
                    .setCustomId('setup_analytics_disable')
                    .setLabel('Disable Analytics')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

        const nextButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_analytics_next')
                    .setLabel('Continue to Tickets')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('➡️')
            );

        await interaction.editReply({
            embeds: [embed],
            components: [buttons, nextButton]
        });
    }

    // Ticket system setup step
    async showTicketSetupStep(interaction) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        setupData.step = 4;

        const embed = new EmbedBuilder()
            .setTitle('🎫 Ticket System Setup')
            .setDescription('Configure a professional support ticket system for your server.')
            .addFields([
                { 
                    name: '✨ Features included:', 
                    value: '• Multiple ticket categories\n• Staff claiming system\n• Automatic transcripts\n• User ratings\n• Priority levels', 
                    inline: true 
                },
                { 
                    name: '⚙️ Requirements:', 
                    value: '• Staff role (optional)\n• Ticket category\n• Log channel\n• Transcript channel', 
                    inline: true 
                }
            ])
            .setColor(0xaa00ff)
            .setFooter({ text: 'Step 6/8 • Ticket System' });

        const staffRoles = interaction.guild.roles.cache
            .filter(role => role.name.toLowerCase().includes('staff') || 
                           role.name.toLowerCase().includes('mod') || 
                           role.name.toLowerCase().includes('support'))
            .first(5);

        if (staffRoles.length > 0) {
            const roleList = staffRoles.map(role => role.toString()).join('\n');
            embed.addFields({ name: '👥 Detected Staff Roles:', value: roleList, inline: false });
        }

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_tickets_enable')
                    .setLabel('Enable Tickets')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🎫'),
                new ButtonBuilder()
                    .setCustomId('setup_tickets_configure')
                    .setLabel('Configure Options')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚙️'),
                new ButtonBuilder()
                    .setCustomId('setup_tickets_skip')
                    .setLabel('Skip for Now')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⏭️')
            );

        const nextButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_tickets_next')
                    .setLabel('Continue to Dashboard')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('➡️')
            );

        await interaction.editReply({
            embeds: [embed],
            components: [buttons, nextButton]
        });
    }

    // Dashboard setup step
    async showDashboardSetupStep(interaction) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        setupData.step = 6.5;

        const embed = new EmbedBuilder()
            .setTitle('📱 Dashboard Configuration')
            .setDescription('Set up the web dashboard for easy management and monitoring.')
            .addFields([
                { 
                    name: '🌐 Dashboard Features', 
                    value: '• Real-time server stats\n• Security monitoring\n• Analytics graphs\n• Ticket management\n• Settings control', 
                    inline: true 
                },
                { 
                    name: '⚙️ Options', 
                    value: '• Theme (Dark/Light)\n• Public stats visibility\n• Update frequency\n• Featured channels', 
                    inline: true 
                },
                { 
                    name: '🔗 Access', 
                    value: `Dashboard URL: ${process.env.DASHBOARD_URL || 'Set in environment'}\nLogin via Discord OAuth`, 
                    inline: false 
                }
            ])
            .setColor(0x5865F2)
            .setFooter({ text: 'Step 7/8 • Dashboard Setup' });

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_dashboard_dark')
                    .setLabel('Dark Theme')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🌙'),
                new ButtonBuilder()
                    .setCustomId('setup_dashboard_light')
                    .setLabel('Light Theme')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('☀️'),
                new ButtonBuilder()
                    .setCustomId('setup_dashboard_public')
                    .setLabel('Public Stats')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('👁️')
            );

        const nextButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_dashboard_skip')
                    .setLabel('Skip')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⏭️'),
                new ButtonBuilder()
                    .setCustomId('setup_dashboard_next')
                    .setLabel('Continue')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('➡️')
            );

        await interaction.editReply({
            embeds: [embed],
            components: [buttons, nextButton]
        });
    }

    // Bot configuration step
    async showBotConfigStep(interaction) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        setupData.step = 7.5;

        const embed = new EmbedBuilder()
            .setTitle('🤖 Bot Configuration')
            .setDescription('Final customization options for bot behavior and preferences.')
            .addFields([
                { 
                    name: '🔔 Notification Settings', 
                    value: '• DM notifications for actions\n• Alert staff on incidents\n• Announcement channel', 
                    inline: true 
                },
                { 
                    name: '⚙️ Behavior Options', 
                    value: '• Auto-mod strictness\n• Logging verbosity\n• Command cooldowns', 
                    inline: true 
                },
                { 
                    name: '🌍 Localization', 
                    value: '• Language: English\n• Timezone: Auto-detect\n• Date format', 
                    inline: true 
                }
            ])
            .setColor(0x57F287)
            .setFooter({ text: 'Step 8/8 • Bot Configuration' });

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_config_balanced')
                    .setLabel('Balanced Settings')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('⚖️'),
                new ButtonBuilder()
                    .setCustomId('setup_config_strict')
                    .setLabel('Strict Mode')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId('setup_config_relaxed')
                    .setLabel('Relaxed Mode')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('😌')
            );

        const nextButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_config_skip')
                    .setLabel('Use Defaults')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⏭️'),
                new ButtonBuilder()
                    .setCustomId('setup_config_next')
                    .setLabel('Finish Setup')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✨')
            );

        await interaction.editReply({
            embeds: [embed],
            components: [buttons, nextButton]
        });
    }

    // Final step - completion
    async showCompletionStep(interaction) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        setupData.step = 5;

        const guild = interaction.guild;
        const timeElapsed = Math.round((Date.now() - setupData.startedAt) / 1000 / 60);

        const embed = new EmbedBuilder()
            .setTitle('🎉 Setup Complete!')
            .setDescription(`Congratulations! Your server **${guild.name}** is now fully configured and ready to go!`)
            .addFields([
                { 
                    name: '✅ What\'s been set up:', 
                    value: this.getCompletionSummary(setupData.data), 
                    inline: false 
                },
                { 
                    name: '🚀 Next Steps:', 
                    value: '• Test the features\n• Invite your members\n• Check the dashboard\n• Customize further in settings', 
                    inline: true 
                },
                { 
                    name: '📚 Useful Commands:', 
                    value: '• `/dashboard` - View web dashboard\n• `/settings` - Modify configuration\n• `/help` - Get help\n• `/stats` - View server stats', 
                    inline: true 
                },
                { 
                    name: '⏱️ Setup Time:', 
                    value: `${timeElapsed} minute${timeElapsed !== 1 ? 's' : ''}`, 
                    inline: true 
                }
            ])
            .setColor(0x00ff00)
            .setThumbnail(guild.iconURL() || this.bot.user.displayAvatarURL())
            .setFooter({ text: 'Complete! • Thank you for using DarkLock!' });

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_dashboard')
                    .setLabel('View Dashboard')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📊'),
                new ButtonBuilder()
                    .setCustomId('setup_help')
                    .setLabel('Get Help')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📚'),
                new ButtonBuilder()
                    .setCustomId('setup_finish')
                    .setLabel('All Done!')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✨')
            );

        await interaction.editReply({
            embeds: [embed],
            components: [buttons]
        });

        // Clean up setup session
        setTimeout(() => {
            this.activeSetups.delete(guild.id);
        }, 300000); // 5 minutes
    }

    // Handle setup interactions
    async handleSetupInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

        const customId = interaction.customId;
        const guild = interaction.guild;
        const setupData = this.activeSetups.get(guild.id);

        if (!setupData) {
            await interaction.reply({
                content: '❌ No active setup session found. Please run `/setup` to start.',
                ephemeral: true
            });
            return;
        }

        // Verify user is the same as who started setup
        if (setupData.userId !== interaction.user.id) {
            await interaction.reply({
                content: '❌ Only the user who started the setup can control it.',
                ephemeral: true
            });
            return;
        }

        try {
            if (customId === 'setup_continue') {
                await this.showChannelSetupStep(interaction);
            } else if (customId === 'setup_cancel') {
                await this.cancelSetup(interaction);
            } else if (customId === 'setup_channel_next') {
                await this.showSecuritySetupStep(interaction);
            } else if (customId === 'setup_security_next') {
                await this.showPermissionsSetupStep(interaction);
            } else if (customId === 'setup_permissions_next') {
                await this.showAnalyticsSetupStep(interaction);
            } else if (customId === 'setup_analytics_next') {
                await this.showTicketSetupStep(interaction);
            } else if (customId === 'setup_tickets_next') {
                await this.showDashboardSetupStep(interaction);
            } else if (customId === 'setup_dashboard_next') {
                await this.showBotConfigStep(interaction);
            } else if (customId === 'setup_config_next') {
                await this.showCompletionStep(interaction);
            } else if (customId === 'setup_finish') {
                await this.finishSetup(interaction);
            } else if (customId.startsWith('setup_channel_')) {
                await this.handleChannelSetup(interaction, customId);
            } else if (customId.startsWith('setup_security_')) {
                await this.handleSecuritySetup(interaction, customId);
            } else if (customId.startsWith('setup_analytics_')) {
                await this.handleAnalyticsSetup(interaction, customId);
            } else if (customId.startsWith('setup_tickets_')) {
                await this.handleTicketSetup(interaction, customId);
            } else if (customId.startsWith('setup_permissions_')) {
                await this.handlePermissionsSetup(interaction, customId);
            } else if (customId.startsWith('setup_dashboard_')) {
                await this.handleDashboardSetup(interaction, customId);
            } else if (customId.startsWith('setup_config_')) {
                await this.handleBotConfigSetup(interaction, customId);
            }
        } catch (error) {
            this.bot.logger.error('Error handling setup interaction:', error);
            await interaction.reply({
                content: '❌ An error occurred during setup.',
                ephemeral: true
            });
        }
    }

    // Auto-create essential channels
    async autoCreateChannels(guild) {
        try {
            const channels = {};

            // Ensure a support staff role exists
            let supportRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('support'));
            if (!supportRole) {
                supportRole = await guild.roles.create({
                    name: 'Support Staff',
                    permissions: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageMessages,
                        PermissionFlagsBits.ModerateMembers
                    ],
                    reason: 'Setup Wizard: create support staff role'
                });
            }

            // Create bot-logs channel
            const logChannel = await guild.channels.create({
                name: 'bot-logs',
                type: ChannelType.GuildText,
                topic: 'Automated bot logs and security alerts',
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.SendMessages]
                    },
                    {
                        id: supportRole.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
                    }
                ]
            });
            channels.logChannel = logChannel.id;

            // Create support category
            const supportCategory = await guild.channels.create({
                name: 'Support',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: supportRole.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]
                    }
                ]
            });
            channels.ticketCategory = supportCategory.id;

            // Information category (staff post, everyone view)
            const infoCategory = await guild.channels.create({
                name: 'Information',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        allow: [PermissionFlagsBits.ViewChannel],
                        deny: [PermissionFlagsBits.SendMessages]
                    },
                    {
                        id: supportRole.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.ManageMessages
                        ]
                    }
                ]
            });
            channels.infoCategory = infoCategory.id;

            // Announcements channel inside Information
            const announcements = await guild.channels.create({
                name: 'announcements',
                type: ChannelType.GuildText,
                parent: infoCategory.id,
                topic: 'Server announcements and updates',
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        allow: [PermissionFlagsBits.ViewChannel],
                        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
                    },
                    {
                        id: supportRole.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageMessages
                        ]
                    }
                ]
            });
            channels.announcements = announcements.id;

            // Create ticket-transcripts channel
            const transcriptChannel = await guild.channels.create({
                name: 'ticket-transcripts',
                type: ChannelType.GuildText,
                parent: supportCategory.id,
                topic: 'Ticket transcripts and support history',
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    },
                    {
                        id: supportRole.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageMessages
                        ]
                    }
                ]
            });
            channels.transcriptChannel = transcriptChannel.id;

            return channels;
        } catch (error) {
            this.bot.logger.error('Error auto-creating channels:', error);
            throw error;
        }
    }

    // Utility methods
    async handleChannelSetup(interaction, customId) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        
        if (customId === 'setup_channel_auto') {
            await interaction.deferUpdate();
            try {
                const channels = await this.autoCreateChannels(interaction.guild);
                setupData.data.channels = channels;
                await interaction.followUp({ content: '✅ Channels created successfully!', ephemeral: true });
            } catch (error) {
                await interaction.followUp({ content: '❌ Failed to create channels. Check my permissions.', ephemeral: true });
            }
        } else if (customId === 'setup_channel_skip') {
            await interaction.deferUpdate();
        }
    }

    async handleSecuritySetup(interaction, customId) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        
        if (customId === 'setup_security_recommended') {
            await interaction.deferUpdate();
            setupData.data.security = {
                antiSpam: true,
                antiRaid: true,
                antiPhishing: true,
                automod: true
            };
            await this.bot.settingsManager.updateSettings(interaction.guild.id, 'security', {
                antiSpam: { enabled: true },
                antiRaid: { enabled: true },
                antiPhishing: { enabled: true },
                automod: { enabled: true }
            });
            await interaction.followUp({ content: '✅ Security configured with recommended settings!', ephemeral: true });
        } else if (customId === 'setup_security_skip') {
            await interaction.deferUpdate();
        }
    }

    async handlePermissionsSetup(interaction, customId) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        
        if (customId === 'setup_permissions_auto') {
            await interaction.deferUpdate();
            try {
                // Auto-detect mod/staff roles
                const modRoles = interaction.guild.roles.cache
                    .filter(r => r.name.toLowerCase().includes('mod') || 
                               r.name.toLowerCase().includes('staff') ||
                               r.permissions.has(PermissionFlagsBits.ModerateMembers))
                    .map(r => r.id);

                if (modRoles.length > 0 && this.bot.permissionManager) {
                    await this.bot.permissionManager.setRoles(interaction.guild.id, 'group', 'moderation', modRoles);
                    await this.bot.permissionManager.setRoles(interaction.guild.id, 'group', 'security', modRoles);
                    setupData.data.permissions = { moderation: modRoles, security: modRoles };
                    await interaction.followUp({ content: `✅ Assigned moderation access to ${modRoles.length} role(s)!`, ephemeral: true });
                } else {
                    await interaction.followUp({ content: 'ℹ️ No mod roles detected. You can configure this later with `/permissions`.', ephemeral: true });
                }
            } catch (error) {
                this.bot.logger.error('Error auto-configuring permissions:', error);
                await interaction.followUp({ content: '❌ Failed to configure permissions.', ephemeral: true });
            }
        } else if (customId === 'setup_permissions_skip') {
            await interaction.deferUpdate();
        }
    }

    async handleAnalyticsSetup(interaction, customId) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        
        if (customId === 'setup_analytics_enable') {
            await interaction.deferUpdate();
            setupData.data.analytics = { enabled: true, level: 'full' };
            await this.bot.settingsManager.updateSettings(interaction.guild.id, 'analytics', {
                enabled: true,
                trackMessages: true,
                trackCommands: true,
                trackVoice: true
            });
            await interaction.followUp({ content: '✅ Analytics enabled with full tracking!', ephemeral: true });
        } else if (customId === 'setup_analytics_minimal') {
            await interaction.deferUpdate();
            setupData.data.analytics = { enabled: true, level: 'minimal' };
            await this.bot.settingsManager.updateSettings(interaction.guild.id, 'analytics', {
                enabled: true,
                trackMessages: true,
                trackCommands: true
            });
            await interaction.followUp({ content: '✅ Analytics enabled with minimal tracking!', ephemeral: true });
        } else if (customId === 'setup_analytics_disable') {
            await interaction.deferUpdate();
            setupData.data.analytics = { enabled: false };
        }
    }

    async handleTicketSetup(interaction, customId) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        
        if (customId === 'setup_tickets_enable') {
            await interaction.deferUpdate();
            setupData.data.tickets = { enabled: true };
            await this.bot.settingsManager.updateSettings(interaction.guild.id, 'tickets', {
                enabled: true
            });
            await interaction.followUp({ content: '✅ Ticket system enabled!', ephemeral: true });
        } else if (customId === 'setup_tickets_skip') {
            await interaction.deferUpdate();
        }
    }

    async handleDashboardSetup(interaction, customId) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        
        if (customId === 'setup_dashboard_dark') {
            await interaction.deferUpdate();
            setupData.data.dashboard = { theme: 'dark' };
            await this.bot.settingsManager.updateSettings(interaction.guild.id, 'dashboard', { theme: 'dark' });
            await interaction.followUp({ content: '🌙 Dark theme selected!', ephemeral: true });
        } else if (customId === 'setup_dashboard_light') {
            await interaction.deferUpdate();
            setupData.data.dashboard = { theme: 'light' };
            await this.bot.settingsManager.updateSettings(interaction.guild.id, 'dashboard', { theme: 'light' });
            await interaction.followUp({ content: '☀️ Light theme selected!', ephemeral: true });
        } else if (customId === 'setup_dashboard_public') {
            await interaction.deferUpdate();
            if (!setupData.data.dashboard) setupData.data.dashboard = {};
            setupData.data.dashboard.publicStats = true;
            await this.bot.settingsManager.updateSettings(interaction.guild.id, 'dashboard', { showPublicStats: true });
            await interaction.followUp({ content: '👁️ Public stats enabled!', ephemeral: true });
        } else if (customId === 'setup_dashboard_skip') {
            await interaction.deferUpdate();
        }
    }

    async handleBotConfigSetup(interaction, customId) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        
        if (customId === 'setup_config_balanced') {
            await interaction.deferUpdate();
            setupData.data.botConfig = { mode: 'balanced' };
            await interaction.followUp({ content: '⚖️ Balanced settings applied!', ephemeral: true });
        } else if (customId === 'setup_config_strict') {
            await interaction.deferUpdate();
            setupData.data.botConfig = { mode: 'strict' };
            await this.bot.settingsManager.updateSettings(interaction.guild.id, 'security', {
                antiSpam: { enabled: true, maxMessages: 3, timeWindow: 5 },
                antiRaid: { enabled: true, joinThreshold: 5 }
            });
            await interaction.followUp({ content: '🔒 Strict mode activated!', ephemeral: true });
        } else if (customId === 'setup_config_relaxed') {
            await interaction.deferUpdate();
            setupData.data.botConfig = { mode: 'relaxed' };
            await this.bot.settingsManager.updateSettings(interaction.guild.id, 'security', {
                antiSpam: { enabled: true, maxMessages: 10, timeWindow: 15 },
                antiRaid: { enabled: true, joinThreshold: 20 }
            });
            await interaction.followUp({ content: '😌 Relaxed mode activated!', ephemeral: true });
        } else if (customId === 'setup_config_skip') {
            await interaction.deferUpdate();
        }
    }

    // Utility methods
    getCompletionSummary(setupData) {
        const features = [];
        if (setupData.security) features.push('🛡️ Security Protection');
        if (setupData.permissions) features.push('🔐 Role Permissions');
        if (setupData.analytics) features.push('📊 Analytics Tracking');
        if (setupData.tickets) features.push('🎫 Ticket System');
        if (setupData.channels) features.push('📂 Essential Channels');
        if (setupData.dashboard) features.push('📱 Dashboard Settings');
        if (setupData.botConfig) features.push('🤖 Bot Configuration');
        
        return features.length > 0 ? features.join('\n') : '• Basic bot configuration';
    }

    async cancelSetup(interaction) {
        this.activeSetups.delete(interaction.guild.id);
        
        const embed = new EmbedBuilder()
            .setTitle('❌ Setup Cancelled')
            .setDescription('Setup wizard has been cancelled. You can restart it anytime with `/setup`.')
            .setColor(0xff0000);

        await interaction.update({ embeds: [embed], components: [] });
    }

    async finishSetup(interaction) {
        const setupData = this.activeSetups.get(interaction.guild.id);
        
        // Save setup completion to database
        await this.bot.database.run(`
            INSERT OR REPLACE INTO setup_wizard (guild_id, completed_at, setup_data)
            VALUES (?, CURRENT_TIMESTAMP, ?)
        `, [interaction.guild.id, JSON.stringify(setupData.data)]);

        this.activeSetups.delete(interaction.guild.id);

        const embed = new EmbedBuilder()
            .setTitle('✨ Setup Complete!')
            .setDescription('Your server is now configured and ready to use. Welcome aboard!')
            .setColor(0x00ff00);

        await interaction.update({ embeds: [embed], components: [] });
    }
}

module.exports = SetupWizard;
