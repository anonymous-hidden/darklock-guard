/**
 * Voice State Update Event Handler
 * Tracks voice activity for analytics and monitoring
 */

module.exports = {
    name: 'voiceStateUpdate',
    once: false,
    async execute(oldState, newState, bot) {
        try {
            // Voice monitoring system
            if (bot.voiceMonitor) {
                await bot.voiceMonitor.handleVoiceUpdate(oldState, newState);
            }

            // Analytics tracking
            if (bot.analyticsManager) {
                await bot.analyticsManager.trackVoiceActivity(oldState, newState);
            }
        } catch (error) {
            bot.logger.error('Error in voice state handler:', error);
        }
    }
};
