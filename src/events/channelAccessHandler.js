const { 
    ActionRowBuilder, 
    StringSelectMenuBuilder,
    EmbedBuilder
} = require('discord.js');

module.exports = {
    name: 'interactionCreate',
    
    async execute(interaction, bot) {
        // Handle channel access button clicks
        if (interaction.isButton() && interaction.customId.startsWith('channel_access_')) {
            await handleChannelAccessButton(interaction, bot);
            return;
        }

        // Handle channel access role selection
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('channel_access_select_')) {
            await handleChannelAccessSelect(interaction, bot);
            return;
        }
    }
};

async function handleChannelAccessButton(interaction, bot) {
    try {
        const panelId = interaction.customId.replace('channel_access_', '');

        // Get the panel
        const panel = await bot.database.get(
            'SELECT * FROM channel_access_panels WHERE panel_id = ? AND guild_id = ?',
            [panelId, interaction.guild.id]
        );

        if (!panel) {
            return await interaction.reply({
                content: '❌ This access panel no longer exists!',
                ephemeral: true
            });
        }

        // Get available roles for this panel
        const roles = await bot.database.all(
            'SELECT * FROM channel_access_roles WHERE panel_id = ?',
            [panelId]
        );

        if (!roles || roles.length === 0) {
            return await interaction.reply({
                content: '❌ No roles are configured for this access panel yet. Please contact an administrator.',
                ephemeral: true
            });
        }

        // Build the select menu options
        const selectOptions = [];
        const member = interaction.member;

        for (const roleData of roles) {
            const role = interaction.guild.roles.cache.get(roleData.role_id);
            if (!role) continue;

            const hasRole = member.roles.cache.has(role.id);
            
            const option = {
                label: roleData.label || role.name,
                value: roleData.role_id,
                description: roleData.description || (hasRole ? '✓ You have this role' : 'Click to get this role')
            };

            // Add emoji if configured
            if (roleData.emoji) {
                // Check if it's a custom emoji (has : in it) or unicode
                if (roleData.emoji.includes(':')) {
                    // Custom emoji format: <:name:id> or <a:name:id>
                    const match = roleData.emoji.match(/<a?:(\w+):(\d+)>/);
                    if (match) {
                        option.emoji = { id: match[2], name: match[1] };
                    }
                } else {
                    option.emoji = roleData.emoji;
                }
            }

            selectOptions.push(option);
        }

        if (selectOptions.length === 0) {
            return await interaction.reply({
                content: '❌ No valid roles found for this panel. Please contact an administrator.',
                ephemeral: true
            });
        }

        // Create the select menu
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`channel_access_select_${panelId}`)
            .setPlaceholder('🔐 Select a role to get channel access...')
            .addOptions(selectOptions)
            .setMinValues(1)
            .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        // Get target channel info
        const targetChannel = interaction.guild.channels.cache.get(panel.target_channel_id);

        const embed = new EmbedBuilder()
            .setTitle('🔐 Select a Role')
            .setDescription(
                `Select a role from the dropdown below to gain access to ${targetChannel || 'the target channel'}.\n\n` +
                `**Note:** If you already have a role from this panel, selecting another will replace it.`
            )
            .setColor(panel.embed_color || '#5865F2')
            .setFooter({ text: 'This message will expire in 60 seconds' });

        // Show current roles from this panel that user has
        const currentRoles = roles.filter(r => member.roles.cache.has(r.role_id));
        if (currentRoles.length > 0) {
            const currentRoleNames = currentRoles.map(r => {
                const role = interaction.guild.roles.cache.get(r.role_id);
                return role ? role.name : 'Unknown';
            }).join(', ');
            embed.addFields({
                name: '✅ Your Current Role(s)',
                value: currentRoleNames,
                inline: false
            });
        }

        await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });

    } catch (error) {
        console.error('Error handling channel access button:', error);
        
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ An error occurred. Please try again later.',
                ephemeral: true
            });
        }
    }
}

async function handleChannelAccessSelect(interaction, bot) {
    try {
        await interaction.deferUpdate();

        const panelId = interaction.customId.replace('channel_access_select_', '');
        const selectedRoleId = interaction.values[0];

        // Get the panel
        const panel = await bot.database.get(
            'SELECT * FROM channel_access_panels WHERE panel_id = ? AND guild_id = ?',
            [panelId, interaction.guild.id]
        );

        if (!panel) {
            return await interaction.editReply({
                content: '❌ This access panel no longer exists!',
                embeds: [],
                components: []
            });
        }

        // Get all roles for this panel
        const panelRoles = await bot.database.all(
            'SELECT * FROM channel_access_roles WHERE panel_id = ?',
            [panelId]
        );

        const selectedRole = interaction.guild.roles.cache.get(selectedRoleId);
        if (!selectedRole) {
            return await interaction.editReply({
                content: '❌ The selected role no longer exists!',
                embeds: [],
                components: []
            });
        }

        const member = interaction.member;
        const hasSelectedRole = member.roles.cache.has(selectedRoleId);

        // If user already has this exact role, remove it (toggle behavior)
        if (hasSelectedRole) {
            try {
                await member.roles.remove(selectedRole);
                
                console.log(`[ChannelAccess] Removed role ${selectedRole.name} from ${member.user.tag}`);

                const embed = new EmbedBuilder()
                    .setTitle('❌ Role Removed')
                    .setDescription(`The **${selectedRole.name}** role has been removed.\n\nYou may lose access to certain channels.`)
                    .setColor(0xFF6B6B)
                    .setTimestamp();

                return await interaction.editReply({
                    embeds: [embed],
                    components: []
                });

            } catch (error) {
                console.error('Error removing role:', error);
                return await interaction.editReply({
                    content: '❌ Failed to remove the role. Please contact an administrator.',
                    embeds: [],
                    components: []
                });
            }
        }

        // Remove any other roles from this panel that the user has (single role mode)
        const removedRoles = [];
        for (const roleData of panelRoles) {
            if (roleData.role_id !== selectedRoleId && member.roles.cache.has(roleData.role_id)) {
                const roleToRemove = interaction.guild.roles.cache.get(roleData.role_id);
                if (roleToRemove) {
                    try {
                        await member.roles.remove(roleToRemove);
                        removedRoles.push(roleToRemove.name);
                    } catch (err) {
                        console.error(`Failed to remove role ${roleToRemove.name}:`, err);
                    }
                }
            }
        }

        // Add the selected role
        try {
            await member.roles.add(selectedRole);
            
            console.log(`[ChannelAccess] Added role ${selectedRole.name} to ${member.user.tag}`);

            const targetChannel = interaction.guild.channels.cache.get(panel.target_channel_id);
            
            const embed = new EmbedBuilder()
                .setTitle('✅ Access Granted!')
                .setDescription(
                    `You've been given the **${selectedRole.name}** role!\n\n` +
                    `You should now have access to ${targetChannel || 'the target channel'}.`
                )
                .setColor(0x00FF00)
                .setTimestamp();

            if (removedRoles.length > 0) {
                embed.addFields({
                    name: '🔄 Replaced Roles',
                    value: removedRoles.join(', '),
                    inline: false
                });
            }

            // Add a helpful tip
            embed.addFields({
                name: '💡 Tip',
                value: 'Click the button again and select the same role to remove it.',
                inline: false
            });

            await interaction.editReply({
                embeds: [embed],
                components: []
            });

        } catch (error) {
            console.error('Error adding role:', error);
            
            let errorMessage = '❌ Failed to assign the role.';
            if (error.code === 50013) {
                errorMessage += ' The bot may not have permission to manage this role.';
            }
            
            await interaction.editReply({
                content: errorMessage,
                embeds: [],
                components: []
            });
        }

    } catch (error) {
        console.error('Error handling channel access select:', error);
        
        try {
            await interaction.editReply({
                content: '❌ An error occurred. Please try again later.',
                embeds: [],
                components: []
            });
        } catch (e) {
            // Ignore if we can't edit
        }
    }
}

// Export the handlers separately for use elsewhere if needed
module.exports.handleChannelAccessButton = handleChannelAccessButton;
module.exports.handleChannelAccessSelect = handleChannelAccessSelect;
