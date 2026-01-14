/**
 * Warning Event Handler
 * Handles Discord client warnings
 */

module.exports = {
    name: 'warn',
    once: false,
    async execute(warning, bot) {
        bot.logger.warn('Discord client warning:', warning);
    }
};
