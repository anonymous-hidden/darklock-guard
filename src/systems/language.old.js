/**
 * Multi-Language Support System
 * Per-guild language settings with extensive translation support
 */

const { t, loadLocale } = require('../../locale');

class LanguageSystem {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
        this.supportedLanguages = ['en', 'es', 'de', 'fr', 'pt'];
        this.guildLanguageCache = new Map();
    }

    async initialize() {
        await this.ensureTables();
        await this.loadCache();
        this.bot.logger.info('LanguageSystem initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS guild_language (
                    guild_id TEXT PRIMARY KEY,
                    language TEXT DEFAULT 'en',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async loadCache() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT guild_id, language FROM guild_language', [], (err, rows) => {
                if (err) reject(err);
                else {
                    for (const row of rows || []) {
                        this.guildLanguageCache.set(row.guild_id, row.language);
                    }
                    resolve();
                }
            });
        });
    }

    // Get language for a guild
    async getLanguage(guildId) {
        if (this.guildLanguageCache.has(guildId)) {
            return this.guildLanguageCache.get(guildId);
        }

        const lang = await new Promise((resolve, reject) => {
            this.db.get(
                'SELECT language FROM guild_language WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.language || 'en');
                }
            );
        });

        this.guildLanguageCache.set(guildId, lang);
        return lang;
    }

    // Set language for a guild
    async setLanguage(guildId, language) {
        if (!this.supportedLanguages.includes(language)) {
            return { success: false, error: `Language '${language}' not supported` };
        }

        await new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO guild_language (guild_id, language, updated_at)
                 VALUES (?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(guild_id) DO UPDATE SET
                    language = ?,
                    updated_at = CURRENT_TIMESTAMP`,
                [guildId, language, language],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });

        this.guildLanguageCache.set(guildId, language);
        return { success: true, language };
    }

    // Get translation for a guild
    translate(guildId, key, vars = {}) {
        const lang = this.guildLanguageCache.get(guildId) || 'en';
        return t(lang, key, vars);
    }

    // Shortcut method
    t(guildId, key, vars = {}) {
        return this.translate(guildId, key, vars);
    }

    // Get language display name
    getLanguageName(code) {
        const names = {
            en: 'English',
            es: 'Español',
            de: 'Deutsch',
            fr: 'Français',
            pt: 'Português'
        };
        return names[code] || code;
    }

    // Get language flag emoji
    getLanguageFlag(code) {
        const flags = {
            en: '🇬🇧',
            es: '🇪🇸',
            de: '🇩🇪',
            fr: '🇫🇷',
            pt: '🇧🇷'
        };
        return flags[code] || '🌐';
    }

    // Get all supported languages
    getSupportedLanguages() {
        return this.supportedLanguages.map(code => ({
            code,
            name: this.getLanguageName(code),
            flag: this.getLanguageFlag(code)
        }));
    }
}

module.exports = LanguageSystem;
