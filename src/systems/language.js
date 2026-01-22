/**
 * AUTHORITATIVE Language System - REBUILT
 * 
 * This system provides a SINGLE SOURCE OF TRUTH for language settings.
 * 
 * ARCHITECTURE:
 * 1. Language is stored in DB (guild_language table)
 * 2. Language is cached in memory for performance
 * 3. ALL bot commands resolve language via getLanguage(guildId)
 * 4. ALL dashboard requests resolve language via API endpoint
 * 5. When language changes, cache is immediately updated
 * 
 * WHY THE OLD SYSTEM FAILED:
 * - Language was saved but commands didn't query it
 * - Commands hardcoded English strings
 * - Dashboard had its own translations that weren't synced
 * - No single authoritative translate() function
 * 
 * NEW DESIGN:
 * - bot.t(guildId, 'key') returns translated string
 * - This function is called on EVERY user-facing message
 * - Translations are loaded from /locale/*.json files
 * - Dashboard fetches language per-request and applies translations
 */

const fs = require('fs');
const path = require('path');

class LanguageSystem {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database?.db || null;
        
        // Supported languages
        this.supportedLanguages = ['en', 'es', 'de', 'fr', 'pt'];
        
        // In-memory cache: guildId -> languageCode
        this.cache = new Map();
        
        // Loaded translation files
        this.translations = {};
        
        // Load translations on construction
        this.loadTranslations();
    }

    /**
     * Load all translation files from /locale directory
     */
    loadTranslations() {
        const localeDir = path.join(__dirname, '../../locale');
        
        for (const lang of this.supportedLanguages) {
            const filePath = path.join(localeDir, `${lang}.json`);
            try {
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    this.translations[lang] = JSON.parse(content);
                } else {
                    this.translations[lang] = {};
                }
            } catch (e) {
                console.error(`[Language] Failed to load ${lang}.json:`, e.message);
                this.translations[lang] = {};
            }
        }
        
        // Ensure English is always available as fallback
        if (!this.translations.en || Object.keys(this.translations.en).length === 0) {
            this.translations.en = this.getDefaultTranslations();
        }
    }

    /**
     * Initialize the language system
     */
    async initialize() {
        await this.ensureTables();
        await this.loadCacheFromDB();
        this.bot.logger?.info('[Language] Language system initialized');
    }

    /**
     * Ensure database table exists
     */
    async ensureTables() {
        if (!this.db) return;
        
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

    /**
     * Load all guild languages into cache
     */
    async loadCacheFromDB() {
        if (!this.db) return;
        
        return new Promise((resolve, reject) => {
            this.db.all('SELECT guild_id, language FROM guild_language', [], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                for (const row of rows || []) {
                    this.cache.set(row.guild_id, row.language);
                }
                resolve();
            });
        });
    }

    /**
     * GET LANGUAGE - The authoritative source
     * Always returns a valid language code
     */
    async getLanguage(guildId) {
        if (!guildId) return 'en';
        
        // Check cache first
        if (this.cache.has(guildId)) {
            return this.cache.get(guildId);
        }
        
        // Query database
        if (this.db) {
            try {
                const row = await new Promise((resolve, reject) => {
                    this.db.get(
                        'SELECT language FROM guild_language WHERE guild_id = ?',
                        [guildId],
                        (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        }
                    );
                });
                
                const lang = row?.language || 'en';
                this.cache.set(guildId, lang);
                return lang;
            } catch (e) {
                this.bot.logger?.warn('[Language] DB query failed:', e.message);
            }
        }
        
        return 'en';
    }

    /**
     * GET LANGUAGE SYNC - For synchronous contexts
     * Uses cache only - call getLanguage() first if needed
     */
    getLanguageSync(guildId) {
        if (!guildId) return 'en';
        return this.cache.get(guildId) || 'en';
    }

    /**
     * SET LANGUAGE - Updates DB and cache
     */
    async setLanguage(guildId, language) {
        // Validate language
        if (!this.supportedLanguages.includes(language)) {
            return { 
                success: false, 
                error: `Language '${language}' is not supported. Available: ${this.supportedLanguages.join(', ')}` 
            };
        }

        // Update database
        if (this.db) {
            try {
                await new Promise((resolve, reject) => {
                    this.db.run(
                        `INSERT INTO guild_language (guild_id, language, updated_at)
                         VALUES (?, ?, CURRENT_TIMESTAMP)
                         ON CONFLICT(guild_id) DO UPDATE SET
                            language = excluded.language,
                            updated_at = CURRENT_TIMESTAMP`,
                        [guildId, language],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
            } catch (e) {
                this.bot.logger?.error('[Language] Failed to save language:', e);
                return { success: false, error: 'Database error' };
            }
        }

        // Update cache IMMEDIATELY
        this.cache.set(guildId, language);

        this.bot.logger?.info(`[Language] Guild ${guildId} language set to ${language}`);
        return { success: true, language };
    }

    /**
     * TRANSLATE - The main translation function
     * 
     * @param {string} guildId - Guild ID to get language for
     * @param {string} key - Translation key (supports dot notation: 'errors.notFound')
     * @param {object} vars - Variables to interpolate: {{name}} -> vars.name
     * @returns {string} Translated string or key as fallback
     */
    t(guildId, key, vars = {}) {
        const lang = this.getLanguageSync(guildId);
        return this.translate(lang, key, vars);
    }

    /**
     * TRANSLATE with explicit language
     */
    translate(lang, key, vars = {}) {
        // Get translation from target language
        let text = this.resolveKey(this.translations[lang], key);
        
        // Fallback to English
        if (!text && lang !== 'en') {
            text = this.resolveKey(this.translations.en, key);
        }
        
        // Final fallback: return key itself
        if (!text) {
            return key;
        }
        
        // Interpolate variables: {{name}} -> value
        return this.interpolate(text, vars);
    }

    /**
     * Resolve a dotted key path in translations object
     */
    resolveKey(obj, key) {
        if (!obj || !key) return null;
        
        // Direct key match
        if (typeof obj[key] === 'string') {
            return obj[key];
        }
        
        // Nested path: 'errors.notFound' -> obj.errors.notFound
        const parts = key.split('.');
        let current = obj;
        
        for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
                current = current[part];
            } else {
                return null;
            }
        }
        
        return typeof current === 'string' ? current : null;
    }

    /**
     * Interpolate variables into string
     * {{name}} -> vars.name
     */
    interpolate(text, vars) {
        if (!vars || Object.keys(vars).length === 0) {
            return text;
        }
        
        return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return key in vars ? String(vars[key]) : match;
        });
    }

    /**
     * Get language display info
     */
    getLanguageInfo(code) {
        const info = {
            en: { name: 'English', flag: '🇬🇧', native: 'English' },
            es: { name: 'Spanish', flag: '🇪🇸', native: 'Español' },
            de: { name: 'German', flag: '🇩🇪', native: 'Deutsch' },
            fr: { name: 'French', flag: '🇫🇷', native: 'Français' },
            pt: { name: 'Portuguese', flag: '🇧🇷', native: 'Português' }
        };
        return info[code] || { name: code, flag: '🌐', native: code };
    }

    /**
     * Get all supported languages with info
     */
    getSupportedLanguages() {
        return this.supportedLanguages.map(code => ({
            code,
            ...this.getLanguageInfo(code)
        }));
    }

    /**
     * Default translations (English) - used if locale file missing
     */
    getDefaultTranslations() {
        return {
            // Common
            "success": "Success",
            "error": "Error",
            "loading": "Loading...",
            "enabled": "Enabled",
            "disabled": "Disabled",
            
            // Errors
            "errors": {
                "generic": "An error occurred. Please try again.",
                "noPermission": "You don't have permission to do this.",
                "notFound": "Not found.",
                "invalidInput": "Invalid input provided.",
                "commandFailed": "Command execution failed.",
                "unknownCategory": "Unknown category."
            },
            
            // Commands
            "commands": {
                "help": {
                    "title": "DarkLock Help",
                    "description": "Select a category to see commands",
                    "backButton": "Back",
                    "ticketButton": "Create Ticket"
                },
                "language": {
                    "set": "Language has been set to {{language}}",
                    "current": "Current language: {{language}}",
                    "list": "Supported languages:",
                    "invalid": "Invalid language. Supported: {{languages}}"
                }
            },
            
            // Moderation
            "moderation": {
                "kick": "{{user}} has been kicked.",
                "ban": "{{user}} has been banned.",
                "timeout": "{{user}} has been timed out.",
                "warn": "{{user}} has been warned."
            },
            
            // Dashboard
            "dashboard": {
                "welcome": "Welcome to the dashboard",
                "settings": "Settings",
                "save": "Save",
                "saved": "Settings saved successfully"
            }
        };
    }
}

module.exports = LanguageSystem;
