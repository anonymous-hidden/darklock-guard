/**
 * Message Reaction Remove Event Handler
 * Handles reaction role removal
 */

module.exports = {
    name: 'messageReactionRemove',
    once: false,
    async execute(reaction, user, bot) {
        try {
            if (!user.bot) {
                const reactionRoleRemoveHandler = require('../events/messageReactionRemove');
                await reactionRoleRemoveHandler.execute(reaction, user);
            }
        } catch (error) {
            bot.logger.error('Error in reaction remove handler:', error);
        }
    }
};
