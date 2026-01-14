const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('modmail')
        .setDescription('ModMail system commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Setup ModMail system')
                .addChannelOption(opt =>
                    opt.setName('category')
                        .setDescription('Category for ticket channels')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt.setName('log_channel')
                        .setDescription('Channel for ticket logs')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addRoleOption(opt =>
                    opt.setName('staff_role')
                        .setDescription('Role that can see tickets')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('greeting')
                        .setDescription('Custom greeting message for users')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('toggle')
                .setDescription('Enable or disable ModMail')
                .addBooleanOption(opt =>
                    opt.setName('enabled')
                        .setDescription('Enable or disable')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('close')
                .setDescription('Close the current ticket')
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Reason for closing')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('reply')
                .setDescription('Reply to the ticket')
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('Message to send')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('snippet')
                .setDescription('Manage canned responses')
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('Action to perform')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Add', value: 'add' },
                            { name: 'Use', value: 'use' },
                            { name: 'List', value: 'list' },
                            { name: 'Delete', value: 'delete' }
                        )
                )
                .addStringOption(opt =>
                    opt.setName('name')
                        .setDescription('Snippet name')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('content')
                        .setDescription('Snippet content (for add)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('anonymous')
                .setDescription('Toggle anonymous staff replies')
                .addBooleanOption(opt =>
                    opt.setName('enabled')
                        .setDescription('Enable anonymous replies')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('config')
                .setDescription('View ModMail configuration')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const modmail = interaction.client.modmail;

        if (!modmail) {
            return interaction.reply({
                content: '❌ ModMail system is not available.',
                ephemeral: true
            });
        }

        switch (subcommand) {
            case 'setup':
                return this.setup(interaction, modmail);
            case 'toggle':
                return this.toggle(interaction, modmail);
            case 'close':
                return this.close(interaction, modmail);
            case 'reply':
                return this.reply(interaction, modmail);
            case 'snippet':
                return this.snippet(interaction, modmail);
            case 'anonymous':
                return this.anonymous(interaction, modmail);
            case 'config':
                return this.viewConfig(interaction, modmail);
        }
    },

    async setup(interaction, modmail) {
        const category = interaction.options.getChannel('category');
        const logChannel = interaction.options.getChannel('log_channel');
        const staffRole = interaction.options.getRole('staff_role');
        const greeting = interaction.options.getString('greeting');

        await modmail.setup(interaction.guild.id, {
            categoryId: category.id,
            logChannelId: logChannel.id,
            staffRoleId: staffRole.id,
            greetingMessage: greeting
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ ModMail Configured')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Category', value: `${category}`, inline: true },
                { name: 'Log Channel', value: `${logChannel}`, inline: true },
                { name: 'Staff Role', value: `${staffRole}`, inline: true }
            )
            .setDescription('Users can now DM the bot to create support tickets!')
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async toggle(interaction, modmail) {
        const enabled = interaction.options.getBoolean('enabled');
        await modmail.setEnabled(interaction.guild.id, enabled);

        await interaction.reply({
            content: `✅ ModMail has been **${enabled ? 'enabled' : 'disabled'}**.`,
            ephemeral: true
        });
    },

    async close(interaction, modmail) {
        const reason = interaction.options.getString('reason');
        
        // Check if this is a ticket channel
        const ticket = await modmail.getTicketByChannel(interaction.channel.id);
        if (!ticket) {
            return interaction.reply({
                content: '❌ This command can only be used in a ModMail ticket channel.',
                ephemeral: true
            });
        }

        await interaction.reply('🔒 Closing ticket...');
        await modmail.closeTicket(ticket.id, interaction.user.id, reason);
    },

    async reply(interaction, modmail) {
        const message = interaction.options.getString('message');
        
        // Check if this is a ticket channel
        const ticket = await modmail.getTicketByChannel(interaction.channel.id);
        if (!ticket) {
            return interaction.reply({
                content: '❌ This command can only be used in a ModMail ticket channel.',
                ephemeral: true
            });
        }

        // Create a fake message object
        const fakeMessage = {
            author: interaction.user,
            content: message,
            attachments: new Map(),
            react: () => Promise.resolve()
        };

        const success = await modmail.forwardToUser(fakeMessage, ticket.id);

        if (success) {
            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: interaction.user.tag, 
                    iconURL: interaction.user.displayAvatarURL({ dynamic: true }) 
                })
                .setDescription(message)
                .setColor(0x00FF00)
                .setFooter({ text: 'Staff → User' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } else {
            await interaction.reply({
                content: '❌ Failed to send message to user.',
                ephemeral: true
            });
        }
    },

    async snippet(interaction, modmail) {
        const action = interaction.options.getString('action');
        const name = interaction.options.getString('name');
        const content = interaction.options.getString('content');

        switch (action) {
            case 'add':
                if (!name || !content) {
                    return interaction.reply({
                        content: '❌ Please provide both name and content for the snippet.',
                        ephemeral: true
                    });
                }
                await modmail.addSnippet(interaction.guild.id, name, content, interaction.user.id);
                await interaction.reply({
                    content: `✅ Snippet **${name}** has been saved.`,
                    ephemeral: true
                });
                break;

            case 'use':
                if (!name) {
                    return interaction.reply({
                        content: '❌ Please provide the snippet name.',
                        ephemeral: true
                    });
                }
                const snippet = await modmail.getSnippet(interaction.guild.id, name);
                if (!snippet) {
                    return interaction.reply({
                        content: '❌ Snippet not found.',
                        ephemeral: true
                    });
                }

                // Check if in ticket channel
                const ticket = await modmail.getTicketByChannel(interaction.channel.id);
                if (!ticket) {
                    return interaction.reply({
                        content: '❌ This command can only be used in a ModMail ticket channel.',
                        ephemeral: true
                    });
                }

                const fakeMessage = {
                    author: interaction.user,
                    content: snippet.content,
                    attachments: new Map(),
                    react: () => Promise.resolve()
                };

                const success = await modmail.forwardToUser(fakeMessage, ticket.id);
                if (success) {
                    const embed = new EmbedBuilder()
                        .setAuthor({ 
                            name: interaction.user.tag, 
                            iconURL: interaction.user.displayAvatarURL({ dynamic: true }) 
                        })
                        .setDescription(snippet.content)
                        .setColor(0x00FF00)
                        .setFooter({ text: `Staff → User | Snippet: ${name}` })
                        .setTimestamp();

                    await interaction.reply({ embeds: [embed] });
                }
                break;

            case 'list':
                const snippets = await modmail.listSnippets(interaction.guild.id);
                if (snippets.length === 0) {
                    return interaction.reply({
                        content: '📋 No snippets saved.',
                        ephemeral: true
                    });
                }

                const embed = new EmbedBuilder()
                    .setTitle('📋 ModMail Snippets')
                    .setColor(0x5865F2)
                    .setDescription(snippets.map(s => `**${s.name}**: ${s.content.slice(0, 50)}${s.content.length > 50 ? '...' : ''}`).join('\n'))
                    .setTimestamp();

                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;

            case 'delete':
                if (!name) {
                    return interaction.reply({
                        content: '❌ Please provide the snippet name to delete.',
                        ephemeral: true
                    });
                }
                const deleted = await modmail.deleteSnippet(interaction.guild.id, name);
                await interaction.reply({
                    content: deleted ? `✅ Snippet **${name}** deleted.` : '❌ Snippet not found.',
                    ephemeral: true
                });
                break;
        }
    },

    async anonymous(interaction, modmail) {
        const enabled = interaction.options.getBoolean('enabled');
        
        await new Promise((resolve, reject) => {
            modmail.db.run(
                `UPDATE modmail_config SET anonymous_staff = ? WHERE guild_id = ?`,
                [enabled ? 1 : 0, interaction.guild.id],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        await interaction.reply({
            content: `✅ Anonymous staff replies **${enabled ? 'enabled' : 'disabled'}**.`,
            ephemeral: true
        });
    },

    async viewConfig(interaction, modmail) {
        const config = await modmail.getConfig(interaction.guild.id);

        if (!config) {
            return interaction.reply({
                content: '❌ ModMail is not configured. Use `/modmail setup` first.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('⚙️ ModMail Configuration')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Status', value: config.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Category', value: config.category_id ? `<#${config.category_id}>` : 'Not set', inline: true },
                { name: 'Log Channel', value: config.log_channel_id ? `<#${config.log_channel_id}>` : 'Not set', inline: true },
                { name: 'Staff Role', value: config.staff_role_id ? `<@&${config.staff_role_id}>` : 'Not set', inline: true },
                { name: 'Anonymous Staff', value: config.anonymous_staff ? 'Yes' : 'No', inline: true }
            )
            .setTimestamp();

        if (config.greeting_message) {
            embed.addFields({ name: 'Greeting', value: config.greeting_message.slice(0, 200), inline: false });
        }

        await interaction.reply({ embeds: [embed] });
    }
};
