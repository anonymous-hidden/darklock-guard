/**
 * Message Reaction Add Event Handler
 * Handles reaction roles and analytics tracking
 */

module.exports = {
    name: 'messageReactionAdd',
    once: false,
    async execute(reaction, user, bot) {
        try {
            if (bot.analyticsManager && !user.bot) {
                await bot.analyticsManager.trackReaction(reaction, user);
            }
            
            // Reaction role handler
            if (!user.bot) {
                const reactionRoleHandler = require('../events/messageReactionAdd');
                await reactionRoleHandler.execute(reaction, user);
            }
        } catch (error) {
            bot.logger.error('Error in reaction handler:', error);
        }
    }
};
