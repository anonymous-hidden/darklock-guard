const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    StringSelectMenuBuilder,
    ChannelType
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('channelaccess')
        .setDescription('Set up a button panel for granting channel access with role selection')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Create a channel access panel with a button')
                .addChannelOption(option =>
                    option
                        .setName('panel_channel')
                        .setDescription('Channel where the access button panel will be posted')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addChannelOption(option =>
                    option
                        .setName('target_channel')
                        .setDescription('Channel that users will gain access to')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory)
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('title')
                        .setDescription('Title for the access panel')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Description for the access panel')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('button_label')
                        .setDescription('Label for the access button (default: "Get Access")')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('button_emoji')
                        .setDescription('Emoji for the access button')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('color')
                        .setDescription('Embed color (hex code)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('addrole')
                .setDescription('Add a role option to an existing channel access panel')
                .addStringOption(option =>
                    option
                        .setName('panel_id')
                        .setDescription('The panel ID (shown when you created the panel)')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('Role to add as an option')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('label')
                        .setDescription('Display label for this role in the dropdown')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Description for this role option')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('emoji')
                        .setDescription('Emoji to show next to this role option')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('removerole')
                .setDescription('Remove a role option from a channel access panel')
                .addStringOption(option =>
                    option
                        .setName('panel_id')
                        .setDescription('The panel ID')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('Role to remove from the panel')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a channel access panel')
                .addStringOption(option =>
                    option
                        .setName('panel_id')
                        .setDescription('The panel ID to delete')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all channel access panels in this server')
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        
        if (focusedOption.name === 'panel_id') {
            try {
                const panels = await interaction.client.database.all(
                    'SELECT panel_id, title, target_channel_id FROM channel_access_panels WHERE guild_id = ?',
                    [interaction.guild.id]
                );
                
                const choices = panels.map(p => ({
                    name: `${p.title} (${p.panel_id})`,
                    value: p.panel_id
                })).filter(c => c.name.toLowerCase().includes(focusedOption.value.toLowerCase()));
                
                await interaction.respond(choices.slice(0, 25));
            } catch (error) {
                await interaction.respond([]);
            }
        }
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        // Ensure tables exist
        await this.ensureTables(interaction.client.database);

        switch (subcommand) {
            case 'setup':
                await this.setupPanel(interaction);
                break;
            case 'addrole':
                await this.addRole(interaction);
                break;
            case 'removerole':
                await this.removeRole(interaction);
                break;
            case 'delete':
                await this.deletePanel(interaction);
                break;
            case 'list':
                await this.listPanels(interaction);
                break;
        }
    },

    async ensureTables(database) {
        try {
            // Create channel access panels table
            await database.run(`
                CREATE TABLE IF NOT EXISTS channel_access_panels (
                    panel_id TEXT PRIMARY KEY,
                    guild_id TEXT NOT NULL,
                    panel_channel_id TEXT NOT NULL,
                    target_channel_id TEXT NOT NULL,
                    message_id TEXT,
                    title TEXT NOT NULL,
                    description TEXT,
                    button_label TEXT DEFAULT 'Get Access',
                    button_emoji TEXT,
                    embed_color TEXT DEFAULT '#5865F2',
                    created_by TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create channel access role options table
            await database.run(`
                CREATE TABLE IF NOT EXISTS channel_access_roles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    panel_id TEXT NOT NULL,
                    role_id TEXT NOT NULL,
                    label TEXT,
                    description TEXT,
                    emoji TEXT,
                    UNIQUE(panel_id, role_id)
                )
            `);
            
            console.log('[ChannelAccess] Database tables ensured');
        } catch (error) {
            console.error('[ChannelAccess] Error creating tables:', error);
            throw error;
        }
    },

    async setupPanel(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const panelChannel = interaction.options.getChannel('panel_channel');
            const targetChannel = interaction.options.getChannel('target_channel');
            const title = interaction.options.getString('title');
            const description = interaction.options.getString('description') || `Click the button below to select a role and gain access to ${targetChannel}!`;
            const buttonLabel = interaction.options.getString('button_label') || 'Get Access';
            const buttonEmoji = interaction.options.getString('button_emoji');
            const color = interaction.options.getString('color') || '#5865F2';

            // Generate unique panel ID
            const panelId = `ca_${interaction.guild.id}_${Date.now()}`;

            // Check bot permissions in panel channel
            const botMember = interaction.guild.members.me;
            if (!panelChannel.permissionsFor(botMember).has(['SendMessages', 'EmbedLinks'])) {
                return await interaction.editReply({
                    content: `❌ I don't have permission to send messages in ${panelChannel}!`
                });
            }

            // Check bot permissions to manage target channel
            if (!targetChannel.permissionsFor(botMember).has(['ManageChannels', 'ManageRoles'])) {
                return await interaction.editReply({
                    content: `❌ I don't have permission to manage permissions in ${targetChannel}! I need **Manage Channels** and **Manage Roles** permissions.`
                });
            }

            // Lock the target channel from @everyone
            try {
                await targetChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                    ViewChannel: false
                });
                console.log(`[ChannelAccess] Locked ${targetChannel.name} from @everyone`);
            } catch (permError) {
                console.error('[ChannelAccess] Failed to lock channel:', permError);
                return await interaction.editReply({
                    content: `❌ Failed to lock the target channel. Make sure I have proper permissions!`
                });
            }

            // Create the embed
            const embed = new EmbedBuilder()
                .setTitle(`🔐 ${title}`)
                .setDescription(description)
                .setColor(color)
                .addFields(
                    { name: '📢 Target Channel', value: `${targetChannel}`, inline: true },
                    { name: '📋 Available Roles', value: '*No roles added yet. Use `/channelaccess addrole` to add roles.*', inline: false }
                )
                .setFooter({ text: `Panel ID: ${panelId}` })
                .setTimestamp();

            // Create the button
            const button = new ButtonBuilder()
                .setCustomId(`channel_access_${panelId}`)
                .setLabel(buttonLabel)
                .setStyle(ButtonStyle.Primary);

            if (buttonEmoji) {
                button.setEmoji(buttonEmoji);
            }

            const row = new ActionRowBuilder().addComponents(button);

            // Send the panel message
            const panelMessage = await panelChannel.send({
                embeds: [embed],
                components: [row]
            });

            // Save to database
            await interaction.client.database.run(`
                INSERT INTO channel_access_panels (
                    panel_id, guild_id, panel_channel_id, target_channel_id, message_id,
                    title, description, button_label, button_emoji, embed_color, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                panelId,
                interaction.guild.id,
                panelChannel.id,
                targetChannel.id,
                panelMessage.id,
                title,
                description,
                buttonLabel,
                buttonEmoji,
                color,
                interaction.user.id
            ]);

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Channel Access Panel Created!')
                .setColor(0x00FF00)
                .setDescription(`Your channel access panel has been created in ${panelChannel}!`)
                .addFields(
                    { name: '🆔 Panel ID', value: `\`${panelId}\``, inline: true },
                    { name: '🎯 Target Channel', value: `${targetChannel}`, inline: true },
                    { name: '\u200b', value: '\u200b', inline: false },
                    { name: '📝 Next Steps', value: 
                        `**1.** Add roles with \`/channelaccess addrole panel_id:${panelId} role:@Role\`\n` +
                        `**2.** Make sure to configure channel permissions for the roles\n` +
                        `**3.** Users can now click the button to select a role and gain access!`
                    }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (error) {
            console.error('[ChannelAccess] Error setting up channel access panel:', error);
            console.error('[ChannelAccess] Error stack:', error.stack);
            await interaction.editReply({
                content: `❌ An error occurred while creating the panel: ${error.message || 'Unknown error'}`
            });
        }
    },

    async addRole(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const panelId = interaction.options.getString('panel_id');
            const role = interaction.options.getRole('role');
            const label = interaction.options.getString('label') || role.name;
            const description = interaction.options.getString('description');
            const emoji = interaction.options.getString('emoji');

            // Get the panel
            const panel = await interaction.client.database.get(
                'SELECT * FROM channel_access_panels WHERE panel_id = ? AND guild_id = ?',
                [panelId, interaction.guild.id]
            );

            if (!panel) {
                return await interaction.editReply({
                    content: '❌ Panel not found! Use `/channelaccess list` to see available panels.'
                });
            }

            // Check if role is already added
            const existingRole = await interaction.client.database.get(
                'SELECT * FROM channel_access_roles WHERE panel_id = ? AND role_id = ?',
                [panelId, role.id]
            );

            if (existingRole) {
                return await interaction.editReply({
                    content: `❌ The role **${role.name}** is already added to this panel!`
                });
            }

            // Check role count (Discord select menu limit is 25)
            const roleCount = await interaction.client.database.get(
                'SELECT COUNT(*) as count FROM channel_access_roles WHERE panel_id = ?',
                [panelId]
            );

            if (roleCount.count >= 25) {
                return await interaction.editReply({
                    content: '❌ Maximum of 25 roles per panel reached!'
                });
            }

            // Check if bot can manage this role
            const botMember = interaction.guild.members.me;
            if (role.position >= botMember.roles.highest.position) {
                return await interaction.editReply({
                    content: `❌ I cannot assign the **${role.name}** role because it's higher than or equal to my highest role!`
                });
            }

            // Add role to database
            await interaction.client.database.run(`
                INSERT INTO channel_access_roles (panel_id, role_id, label, description, emoji)
                VALUES (?, ?, ?, ?, ?)
            `, [panelId, role.id, label, description, emoji]);

            // Grant the role access to the target channel
            const targetChannel = interaction.guild.channels.cache.get(panel.target_channel_id);
            if (targetChannel) {
                try {
                    await targetChannel.permissionOverwrites.edit(role, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true
                    });
                    console.log(`[ChannelAccess] Granted ${role.name} access to ${targetChannel.name}`);
                } catch (permError) {
                    console.error('[ChannelAccess] Failed to set channel permissions:', permError);
                }
            }

            // Update the panel message
            await this.updatePanelMessage(interaction.client, panelId);

            await interaction.editReply({
                content: `✅ Successfully added **${role.name}** to the channel access panel!\n\n` +
                    `🔓 The role now has access to ${targetChannel || 'the target channel'}.`
            });

        } catch (error) {
            console.error('Error adding role to channel access panel:', error);
            await interaction.editReply({
                content: '❌ An error occurred while adding the role. Please try again.'
            });
        }
    },

    async removeRole(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const panelId = interaction.options.getString('panel_id');
            const role = interaction.options.getRole('role');

            // Get the panel
            const panel = await interaction.client.database.get(
                'SELECT * FROM channel_access_panels WHERE panel_id = ? AND guild_id = ?',
                [panelId, interaction.guild.id]
            );

            if (!panel) {
                return await interaction.editReply({
                    content: '❌ Panel not found!'
                });
            }

            // Check if role exists in panel
            const existingRole = await interaction.client.database.get(
                'SELECT * FROM channel_access_roles WHERE panel_id = ? AND role_id = ?',
                [panelId, role.id]
            );

            if (!existingRole) {
                return await interaction.editReply({
                    content: `❌ The role **${role.name}** is not in this panel!`
                });
            }

            // Remove role's access from the target channel
            const targetChannel = interaction.guild.channels.cache.get(panel.target_channel_id);
            if (targetChannel) {
                try {
                    await targetChannel.permissionOverwrites.delete(role);
                    console.log(`[ChannelAccess] Removed ${role.name} access from ${targetChannel.name}`);
                } catch (permError) {
                    console.error('[ChannelAccess] Failed to remove channel permissions:', permError);
                }
            }

            // Remove role from database
            await interaction.client.database.run(
                'DELETE FROM channel_access_roles WHERE panel_id = ? AND role_id = ?',
                [panelId, role.id]
            );

            // Update the panel message
            await this.updatePanelMessage(interaction.client, panelId);

            await interaction.editReply({
                content: `✅ Successfully removed **${role.name}** from the channel access panel!\n\n` +
                    `🔒 The role no longer has access to ${targetChannel || 'the target channel'}.`
            });

        } catch (error) {
            console.error('Error removing role from channel access panel:', error);
            await interaction.editReply({
                content: '❌ An error occurred while removing the role. Please try again.'
            });
        }
    },

    async deletePanel(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const panelId = interaction.options.getString('panel_id');

            // Get the panel
            const panel = await interaction.client.database.get(
                'SELECT * FROM channel_access_panels WHERE panel_id = ? AND guild_id = ?',
                [panelId, interaction.guild.id]
            );

            if (!panel) {
                return await interaction.editReply({
                    content: '❌ Panel not found!'
                });
            }

            // Try to delete the panel message
            try {
                const channel = interaction.guild.channels.cache.get(panel.panel_channel_id);
                if (channel) {
                    const message = await channel.messages.fetch(panel.message_id).catch(() => null);
                    if (message) {
                        await message.delete();
                    }
                }
            } catch (err) {
                // Message might already be deleted
            }

            // Get all roles from this panel and remove their permissions
            const panelRoles = await interaction.client.database.all(
                'SELECT role_id FROM channel_access_roles WHERE panel_id = ?',
                [panelId]
            );

            const targetChannel = interaction.guild.channels.cache.get(panel.target_channel_id);
            if (targetChannel) {
                // Remove all role permissions
                for (const roleData of panelRoles || []) {
                    try {
                        const role = interaction.guild.roles.cache.get(roleData.role_id);
                        if (role) {
                            await targetChannel.permissionOverwrites.delete(role);
                        }
                    } catch (err) {
                        // Role might not exist anymore
                    }
                }

                // Restore @everyone access
                try {
                    await targetChannel.permissionOverwrites.delete(interaction.guild.roles.everyone);
                    console.log(`[ChannelAccess] Restored @everyone access to ${targetChannel.name}`);
                } catch (err) {
                    // Ignore if can't restore
                }
            }

            // Delete from database (cascade will delete roles too)
            await interaction.client.database.run(
                'DELETE FROM channel_access_panels WHERE panel_id = ?',
                [panelId]
            );

            await interaction.client.database.run(
                'DELETE FROM channel_access_roles WHERE panel_id = ?',
                [panelId]
            );

            await interaction.editReply({
                content: `✅ Channel access panel **${panel.title}** has been deleted!\n\n` +
                    `🔓 The target channel has been unlocked and is now visible to everyone.`
            });

        } catch (error) {
            console.error('Error deleting channel access panel:', error);
            await interaction.editReply({
                content: '❌ An error occurred while deleting the panel. Please try again.'
            });
        }
    },

    async listPanels(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const panels = await interaction.client.database.all(
                'SELECT * FROM channel_access_panels WHERE guild_id = ?',
                [interaction.guild.id]
            );

            if (!panels || panels.length === 0) {
                return await interaction.editReply({
                    content: '📋 No channel access panels found in this server.\n\nCreate one with `/channelaccess setup`!'
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('📋 Channel Access Panels')
                .setColor(0x5865F2)
                .setDescription(`Found **${panels.length}** panel(s) in this server:`)
                .setTimestamp();

            for (const panel of panels.slice(0, 10)) { // Limit to 10 for embed field limit
                const panelChannel = interaction.guild.channels.cache.get(panel.panel_channel_id);
                const targetChannel = interaction.guild.channels.cache.get(panel.target_channel_id);
                
                const roleCount = await interaction.client.database.get(
                    'SELECT COUNT(*) as count FROM channel_access_roles WHERE panel_id = ?',
                    [panel.panel_id]
                );

                embed.addFields({
                    name: `🔐 ${panel.title}`,
                    value: 
                        `**ID:** \`${panel.panel_id}\`\n` +
                        `**Panel Channel:** ${panelChannel || 'Unknown'}\n` +
                        `**Target Channel:** ${targetChannel || 'Unknown'}\n` +
                        `**Roles:** ${roleCount.count}\n` +
                        `**Created:** <t:${Math.floor(new Date(panel.created_at).getTime() / 1000)}:R>`,
                    inline: false
                });
            }

            if (panels.length > 10) {
                embed.setFooter({ text: `Showing 10 of ${panels.length} panels` });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error listing channel access panels:', error);
            await interaction.editReply({
                content: '❌ An error occurred while listing panels. Please try again.'
            });
        }
    },

    async updatePanelMessage(client, panelId) {
        try {
            const panel = await client.database.get(
                'SELECT * FROM channel_access_panels WHERE panel_id = ?',
                [panelId]
            );

            if (!panel) return;

            const guild = client.guilds.cache.get(panel.guild_id);
            if (!guild) return;

            const channel = guild.channels.cache.get(panel.panel_channel_id);
            if (!channel) return;

            const message = await channel.messages.fetch(panel.message_id).catch(() => null);
            if (!message) return;

            // Get roles for this panel
            const roles = await client.database.all(
                'SELECT * FROM channel_access_roles WHERE panel_id = ?',
                [panelId]
            );

            const targetChannel = guild.channels.cache.get(panel.target_channel_id);

            // Build role list for embed
            let roleListText = '*No roles added yet. Use `/channelaccess addrole` to add roles.*';
            if (roles && roles.length > 0) {
                roleListText = roles.map(r => {
                    const role = guild.roles.cache.get(r.role_id);
                    const emoji = r.emoji || '•';
                    const desc = r.description ? ` - ${r.description}` : '';
                    return `${emoji} ${role ? role.toString() : 'Unknown Role'}${desc}`;
                }).join('\n');
            }

            const embed = new EmbedBuilder()
                .setTitle(`🔐 ${panel.title}`)
                .setDescription(panel.description)
                .setColor(panel.embed_color || '#5865F2')
                .addFields(
                    { name: '📢 Target Channel', value: targetChannel ? `${targetChannel}` : 'Unknown', inline: true },
                    { name: '📋 Available Roles', value: roleListText, inline: false }
                )
                .setFooter({ text: `Panel ID: ${panelId}` })
                .setTimestamp();

            // Update the button (disable if no roles)
            const button = new ButtonBuilder()
                .setCustomId(`channel_access_${panelId}`)
                .setLabel(panel.button_label || 'Get Access')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!roles || roles.length === 0);

            if (panel.button_emoji) {
                button.setEmoji(panel.button_emoji);
            }

            const row = new ActionRowBuilder().addComponents(button);

            await message.edit({
                embeds: [embed],
                components: [row]
            });

        } catch (error) {
            console.error('Error updating channel access panel message:', error);
        }
    }
};
