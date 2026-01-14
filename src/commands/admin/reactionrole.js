const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactionroles')
        .setDescription('Manage self-assignable reaction roles')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Create and deploy a reaction role panel')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Channel to send the panel in')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('title')
                        .setDescription('Title for the panel')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Panel type')
                        .setRequired(true)
                        .addChoices(
                            { name: '👆 Buttons (Recommended)', value: 'button' },
                            { name: '😀 Reactions (Classic)', value: 'reaction' }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName('mode')
                        .setDescription('Role assignment mode')
                        .addChoices(
                            { name: 'Multiple Roles', value: 'multiple' },
                            { name: 'Single Role Only', value: 'single' }
                        )
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Description for the panel')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a role to the panel')
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('Role to add')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('emoji')
                        .setDescription('Emoji/reaction or button label')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Description for this role')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a role or entire panel')
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('Role to remove (leave empty to delete entire panel)')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'setup':
                await this.setupPanel(interaction);
                break;
            case 'add':
                await this.addRole(interaction);
                break;
            case 'delete':
                await this.deleteRole(interaction);
                break;
        }
    },


    async setupPanel(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const channel = interaction.options.getChannel('channel');
            const title = interaction.options.getString('title');
            const type = interaction.options.getString('type');
            const mode = interaction.options.getString('mode') || 'multiple';
            const description = interaction.options.getString('description') || `React to get your roles! ${mode === 'single' ? '⚠️ You can only have ONE role from this panel.' : ''}`;

            // Check if server already has a panel
            const existing = await interaction.client.database.get(
                'SELECT * FROM reaction_role_panels WHERE guild_id = ?',
                [interaction.guild.id]
            );

            if (existing) {
                return await interaction.editReply({ 
                    content: `❌ This server already has a reaction role panel!\n\nTo add more roles: \`/reactionroles add\`\nTo delete and start over: \`/reactionroles delete\`` 
                });
            }

            const panelId = `rr_${interaction.guild.id}`;

            // Create panel in database
            await interaction.client.database.run(`
                INSERT INTO reaction_role_panels (
                    panel_id, guild_id, type, title, description, mode, channel_id, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [panelId, interaction.guild.id, type, title, description, mode, channel.id, interaction.user.id]);

            const embed = new EmbedBuilder()
                .setTitle('✅ Reaction Role Panel Created')
                .setColor(0x06FFA5)
                .setDescription(`Successfully created a **${type === 'reaction' ? 'Reaction' : 'Button'}** panel in ${channel}!`)
                .addFields(
                    { name: '📝 Title', value: title, inline: true },
                    { name: '🎯 Mode', value: mode === 'single' ? 'Single Role' : 'Multiple Roles', inline: true },
                    { name: '\u200b', value: '\u200b', inline: false },
                    { name: '📖 Next Steps', value: `**1.** Add roles with \`/reactionroles add role:@Role emoji:🎮\`\n**2.** Panel will auto-update in ${channel}\n**3.** That's it! Users can now get roles!`, inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            
            // Create initial empty panel message
            await this.updatePanelMessage(interaction.client, panelId);
            
        } catch (error) {
            console.error('Error creating panel:', error);
            await interaction.editReply({ content: '❌ Failed to create panel.' });
        }
    },

    async addRole(interaction) {
        try {
            const role = interaction.options.getRole('role');
            const emoji = interaction.options.getString('emoji');
            const roleDescription = interaction.options.getString('description') || role.name;

            // Check if server has a panel
            const panel = await interaction.client.database.get(
                'SELECT * FROM reaction_role_panels WHERE guild_id = ?',
                [interaction.guild.id]
            );

            if (!panel) {
                return await interaction.reply({ 
                    content: '❌ No reaction role panel found! Create one first with `/reactionroles setup`', 
                    ephemeral: true 
                });
            }

            // Security checks
            if (role.managed) {
                return await interaction.reply({ content: '❌ Cannot assign managed roles (bot roles, boosts, etc).', ephemeral: true });
            }

            if (role.permissions.has(PermissionFlagsBits.Administrator) || 
                role.permissions.has(PermissionFlagsBits.ManageGuild) ||
                role.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return await interaction.reply({ content: '⚠️ Cannot assign roles with dangerous permissions!', ephemeral: true });
            }

            const botMember = interaction.guild.members.me;
            const botHighestRole = botMember.roles.highest;
            
            if (role.position >= botHighestRole.position) {
                return await interaction.reply({ content: '❌ Cannot assign roles higher than or equal to my highest role!', ephemeral: true });
            }

            // Check if role already exists
            const existing = await interaction.client.database.get(
                'SELECT * FROM reaction_role_mappings WHERE panel_id = ? AND role_id = ?',
                [panel.panel_id, role.id]
            );

            if (existing) {
                return await interaction.reply({ content: '❌ This role is already in the panel!', ephemeral: true });
            }

            // Add role to panel
            await interaction.client.database.run(`
                INSERT INTO reaction_role_mappings (
                    panel_id, role_id, emoji, description
                ) VALUES (?, ?, ?, ?)
            `, [panel.panel_id, role.id, emoji, roleDescription]);

            const embed = new EmbedBuilder()
                .setTitle('✅ Role Added')
                .setColor(0x06FFA5)
                .setDescription(`Successfully added ${role} to the reaction role panel!`)
                .addFields(
                    { name: 'Emoji/Label', value: emoji, inline: true },
                    { name: 'Description', value: roleDescription, inline: true }
                )
                .setFooter({ text: 'The panel has been automatically updated!' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });

            // Update the panel message
            await this.updatePanelMessage(interaction.client, panel.panel_id);
            
        } catch (error) {
            console.error('Error adding role:', error);
            await interaction.reply({ content: '❌ Failed to add role. Make sure the emoji is valid!', ephemeral: true });
        }
    },

    async deleteRole(interaction) {
        try {
            const role = interaction.options.getRole('role');

            // Get panel
            const panel = await interaction.client.database.get(
                'SELECT * FROM reaction_role_panels WHERE guild_id = ?',
                [interaction.guild.id]
            );

            if (!panel) {
                return await interaction.reply({ 
                    content: '❌ No reaction role panel found in this server!', 
                    ephemeral: true 
                });
            }

            if (!role) {
                // Delete entire panel
                try {
                    if (panel.channel_id && panel.message_id) {
                        const channel = await interaction.client.channels.fetch(panel.channel_id);
                        const message = await channel.messages.fetch(panel.message_id);
                        await message.delete();
                    }
                } catch (err) {
                    console.log('Could not delete panel message:', err.message);
                }

                await interaction.client.database.run('DELETE FROM reaction_role_mappings WHERE panel_id = ?', [panel.panel_id]);
                await interaction.client.database.run('DELETE FROM reaction_role_panels WHERE panel_id = ?', [panel.panel_id]);

                return await interaction.reply({ 
                    content: '✅ Deleted the entire reaction role panel and all its roles.', 
                    ephemeral: true 
                });
            }

            // Delete specific role
            const result = await interaction.client.database.run(
                'DELETE FROM reaction_role_mappings WHERE panel_id = ? AND role_id = ?',
                [panel.panel_id, role.id]
            );

            if (result.changes === 0) {
                return await interaction.reply({ content: '❌ Role not found in the panel!', ephemeral: true });
            }

            await interaction.reply({ 
                content: `✅ Removed ${role} from the panel. The panel has been updated automatically!`, 
                ephemeral: true 
            });

            // Update the panel message
            await this.updatePanelMessage(interaction.client, panel.panel_id);
            
        } catch (error) {
            console.error('Error deleting role:', error);
            await interaction.reply({ content: '❌ Failed to delete role/panel.', ephemeral: true });
        }
    },

    async updatePanelMessage(client, panelId) {
        try {
            // Get panel
            const panel = await client.database.get(
                'SELECT * FROM reaction_role_panels WHERE panel_id = ?',
                [panelId]
            );

            if (!panel) return;

            // Get roles
            const roles = await client.database.all(
                'SELECT * FROM reaction_role_mappings WHERE panel_id = ?',
                [panelId]
            );

            const guild = client.guilds.cache.get(panel.guild_id);
            if (!guild) return;

            const channel = await guild.channels.fetch(panel.channel_id).catch(() => null);
            if (!channel) return;

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(panel.title)
                .setDescription(panel.description)
                .setColor(0x00D4FF)
                .setTimestamp();

            if (roles.length === 0) {
                embed.addFields({ 
                    name: '📭 No Roles Yet', 
                    value: 'Use `/reactionroles add` to add roles to this panel!' 
                });
            } else {
                let rolesList = '';
                roles.forEach(r => {
                    const role = guild.roles.cache.get(r.role_id);
                    if (role) {
                        rolesList += `${r.emoji} - ${role} - *${r.description}*\n`;
                    }
                });
                embed.addFields({ name: '✨ Available Roles', value: rolesList });
            }

            if (panel.mode === 'single') {
                embed.setFooter({ text: '⚠️ You can only have ONE role from this panel at a time' });
            }

            let message;
            
            // Try to update existing message
            if (panel.message_id) {
                try {
                    message = await channel.messages.fetch(panel.message_id);
                    
                    if (panel.type === 'reaction') {
                        await message.edit({ embeds: [embed], components: [] });
                        // Clear old reactions
                        await message.reactions.removeAll().catch(() => {});
                        // Add new reactions
                        for (const r of roles) {
                            try {
                                await message.react(r.emoji);
                            } catch (err) {
                                console.error(`Failed to add reaction ${r.emoji}:`, err.message);
                            }
                        }
                    } else {
                        // Update buttons
                        const components = [];
                        const buttons = [];
                        
                        roles.forEach(r => {
                            const role = guild.roles.cache.get(r.role_id);
                            if (role) {
                                const button = new ButtonBuilder()
                                    .setCustomId(`rr_${panelId}_${role.id}`)
                                    .setStyle(ButtonStyle.Primary);
                                
                                // Check if emoji is an actual emoji or custom emoji
                                const emojiMatch = r.emoji.match(/<a?:\w+:(\d+)>|[\p{Emoji}]/u);
                                if (emojiMatch) {
                                    // It's an emoji - set as emoji, use role name as label
                                    button.setEmoji(r.emoji);
                                    button.setLabel(role.name.length > 80 ? role.name.substring(0, 77) + '...' : role.name);
                                } else {
                                    // It's text - use as label
                                    button.setLabel(r.emoji.length > 80 ? r.emoji.substring(0, 77) + '...' : r.emoji);
                                }
                                
                                buttons.push(button);
                                
                                if (buttons.length === 5) {
                                    components.push(new ActionRowBuilder().addComponents(...buttons.splice(0, 5)));
                                }
                            }
                        });
                        
                        if (buttons.length > 0) {
                            components.push(new ActionRowBuilder().addComponents(...buttons));
                        }
                        
                        await message.edit({ embeds: [embed], components });
                    }
                    return;
                } catch (err) {
                    console.log('Could not update message, creating new one:', err.message);
                }
            }

            // Create new message
            if (panel.type === 'reaction') {
                message = await channel.send({ embeds: [embed] });
                for (const r of roles) {
                    try {
                        await message.react(r.emoji);
                    } catch (err) {
                        console.error(`Failed to add reaction ${r.emoji}:`, err.message);
                    }
                }
            } else {
                const components = [];
                const buttons = [];
                
                roles.forEach(r => {
                    const role = guild.roles.cache.get(r.role_id);
                    if (role) {
                        const button = new ButtonBuilder()
                            .setCustomId(`rr_${panelId}_${role.id}`)
                            .setStyle(ButtonStyle.Primary);
                        
                        // Check if emoji is an actual emoji or custom emoji
                        const emojiMatch = r.emoji.match(/<a?:\w+:(\d+)>|[\p{Emoji}]/u);
                        if (emojiMatch) {
                            // It's an emoji - set as emoji, use role name as label
                            button.setEmoji(r.emoji);
                            button.setLabel(role.name.length > 80 ? role.name.substring(0, 77) + '...' : role.name);
                        } else {
                            // It's text - use as label
                            button.setLabel(r.emoji.length > 80 ? r.emoji.substring(0, 77) + '...' : r.emoji);
                        }
                        
                        buttons.push(button);
                        
                        if (buttons.length === 5) {
                            components.push(new ActionRowBuilder().addComponents(...buttons.splice(0, 5)));
                        }
                    }
                });
                
                if (buttons.length > 0) {
                    components.push(new ActionRowBuilder().addComponents(...buttons));
                }
                
                message = await channel.send({ embeds: [embed], components });
            }

            // Update panel with message ID
            await client.database.run(
                'UPDATE reaction_role_panels SET message_id = ?, deployed_at = CURRENT_TIMESTAMP WHERE panel_id = ?',
                [message.id, panelId]
            );
            
        } catch (error) {
            console.error('Error updating panel message:', error);
        }
    }
};
