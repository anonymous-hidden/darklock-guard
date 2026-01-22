/**
 * Translation Helper for Commands
 * 
 * This utility makes it easy for bot commands to use the language system.
 * 
 * USAGE:
 * 
 * const { getTranslator, t } = require('../../utils/translate');
 * 
 * // In command execute():
 * const tr = getTranslator(interaction, bot);
 * const message = tr('moderation.ban.success', { user: user.tag });
 * 
 * // Or use the simpler form if you have bot and guildId:
 * const message = t(bot, guildId, 'key', { vars });
 */

/**
 * Get a translator function bound to the current guild's language
 * @param {Interaction} interaction - Discord interaction
 * @param {Bot} bot - Bot instance
 * @returns {Function} Translator function: (key, vars?) => string
 */
function getTranslator(interaction, bot) {
    const guildId = interaction.guildId;
    
    return (key, vars = {}) => {
        // Try to use the bot's translation system
        if (bot?.languageSystem?.t) {
            return bot.languageSystem.t(guildId, key, vars);
        }
        
        // Fallback to client.languageSystem
        if (interaction.client?.languageSystem?.t) {
            return interaction.client.languageSystem.t(guildId, key, vars);
        }
        
        // Fallback to locale/index.js t() function
        try {
            const { t } = require('../../locale');
            const lang = bot?.languageSystem?.getLanguageSync?.(guildId) || 'en';
            return t(lang, key, vars);
        } catch (e) {
            // Final fallback: return key
            return key;
        }
    };
}

/**
 * Direct translation function
 * @param {Bot} bot - Bot instance
 * @param {string} guildId - Guild ID
 * @param {string} key - Translation key
 * @param {object} vars - Variables for interpolation
 * @returns {string} Translated string
 */
function t(bot, guildId, key, vars = {}) {
    if (bot?.languageSystem?.t) {
        return bot.languageSystem.t(guildId, key, vars);
    }
    
    // Fallback
    try {
        const locale = require('../../locale');
        return locale.t('en', key, vars);
    } catch (e) {
        return key;
    }
}

/**
 * Get available languages
 * @param {Bot} bot - Bot instance
 * @returns {Array} Array of language info objects
 */
function getLanguages(bot) {
    if (bot?.languageSystem?.getSupportedLanguages) {
        return bot.languageSystem.getSupportedLanguages();
    }
    
    return [
        { code: 'en', name: 'English', flag: '🇬🇧', native: 'English' },
        { code: 'es', name: 'Spanish', flag: '🇪🇸', native: 'Español' },
        { code: 'de', name: 'German', flag: '🇩🇪', native: 'Deutsch' },
        { code: 'fr', name: 'French', flag: '🇫🇷', native: 'Français' },
        { code: 'pt', name: 'Portuguese', flag: '🇧🇷', native: 'Português' }
    ];
}

/**
 * Get the current guild language (async)
 * @param {Bot} bot - Bot instance
 * @param {string} guildId - Guild ID
 * @returns {Promise<string>} Language code
 */
async function getGuildLanguage(bot, guildId) {
    if (bot?.languageSystem?.getLanguage) {
        return await bot.languageSystem.getLanguage(guildId);
    }
    return 'en';
}

/**
 * Get the current guild language (sync - uses cache)
 * @param {Bot} bot - Bot instance
 * @param {string} guildId - Guild ID
 * @returns {string} Language code
 */
function getGuildLanguageSync(bot, guildId) {
    if (bot?.languageSystem?.getLanguageSync) {
        return bot.languageSystem.getLanguageSync(guildId);
    }
    return 'en';
}

module.exports = {
    getTranslator,
    t,
    getLanguages,
    getGuildLanguage,
    getGuildLanguageSync
};
