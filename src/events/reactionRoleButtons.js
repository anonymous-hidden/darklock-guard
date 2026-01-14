module.exports = async function handleReactionRoleButton(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('rr_')) return;
    
    try {
        await interaction.deferReply({ ephemeral: true });

        const [, panelId, roleId] = interaction.customId.split('_');
        
        // Get panel
        const panel = await interaction.client.database.get(
            'SELECT * FROM reaction_role_panels WHERE panel_id = ? AND guild_id = ?',
            [panelId, interaction.guild.id]
        );

        if (!panel) {
            return await interaction.editReply({ content: '❌ This panel no longer exists!' });
        }

        // Get role mapping
        const roleMapping = await interaction.client.database.get(
            'SELECT * FROM reaction_role_mappings WHERE panel_id = ? AND role_id = ?',
            [panelId, roleId]
        );

        if (!roleMapping) {
            return await interaction.editReply({ content: '❌ This role is no longer available!' });
        }

        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) {
            return await interaction.editReply({ content: '❌ Role not found!' });
        }

        const member = interaction.member;
        const hasRole = member.roles.cache.has(role.id);

        // Check if single mode - remove other roles from this panel
        if (!hasRole && panel.mode === 'single') {
            const allRoles = await interaction.client.database.all(
                'SELECT role_id FROM reaction_role_mappings WHERE panel_id = ?',
                [panel.panel_id]
            );

            let removedRoles = [];
            for (const r of allRoles) {
                if (r.role_id !== role.id && member.roles.cache.has(r.role_id)) {
                    const otherRole = interaction.guild.roles.cache.get(r.role_id);
                    if (otherRole) {
                        await member.roles.remove(otherRole).catch(console.error);
                        removedRoles.push(otherRole.name);
                    }
                }
            }

            if (removedRoles.length > 0) {
                await member.roles.add(role);
                return await interaction.editReply({ 
                    content: `✅ You've been given the **${role.name}** role!\n❌ Removed: ${removedRoles.join(', ')} (single role mode)` 
                });
            }
        }

        // Toggle the role
        if (hasRole) {
            await member.roles.remove(role);
            console.log(`Removed role ${role.name} from ${member.user.tag} via button`);
            await interaction.editReply({ content: `❌ The **${role.name}** role has been removed!` });
        } else {
            await member.roles.add(role);
            console.log(`Added role ${role.name} to ${member.user.tag} via button`);
            await interaction.editReply({ content: `✅ You've been given the **${role.name}** role!` });
        }
    } catch (error) {
        console.error('Error handling reaction role button:', error);
        
        if (interaction.deferred) {
            await interaction.editReply({ content: '❌ Failed to assign role. Please try again later.' });
        } else {
            await interaction.reply({ content: '❌ Failed to assign role. Please try again later.', ephemeral: true });
        }
    }
};
