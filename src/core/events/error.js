/**
 * Error Event Handler
 * Handles Discord client errors
 */

module.exports = {
    name: 'error',
    once: false,
    async execute(error, bot) {
        bot.logger.error('Discord client error:', error);
    }
};
