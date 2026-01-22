const { Events } = require('discord.js');

module.exports = {
    name: Events.MessageReactionRemove,
    
    async execute(reaction, user) {
        // Ignore bot reactions
        if (user.bot) return;

        // Handle partial reactions
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Error fetching reaction:', error);
                return;
            }
        }

        try {
            const client = reaction.client;
            const message = reaction.message;
            const guild = message.guild;
            
            if (!guild) return;

            // Check if this is a reaction role message
            const panel = await client.database.get(
                'SELECT * FROM reaction_role_panels WHERE message_id = ? AND guild_id = ? AND type = ?',
                [message.id, guild.id, 'reaction']
            );

            if (!panel) return;

            // Get the role mapping for this emoji
            const emoji = reaction.emoji.toString();
            const roleMapping = await client.database.get(
                'SELECT * FROM reaction_role_mappings WHERE panel_id = ? AND emoji = ?',
                [panel.panel_id, emoji]
            );

            if (!roleMapping) return;

            const member = await guild.members.fetch(user.id);
            const role = guild.roles.cache.get(roleMapping.role_id);

            if (!role) return;

            // Remove the role
            if (member.roles.cache.has(role.id)) {
                await member.roles.remove(role);
                console.log(`Removed role ${role.name} from ${user.tag} via reaction roles`);
                
                // Try to DM the user
                try {
                    await user.send(`❌ The **${role.name}** role has been removed from you in **${guild.name}**.`);
                } catch (err) {
                    // User has DMs disabled
                }
            }
        } catch (error) {
            console.error('Error handling reaction role remove:', error);
        }
    }
};
