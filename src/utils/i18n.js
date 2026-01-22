/**
 * i18n Helper - Localization enforcement utility
 * Provides type-safe translation function with fallback chain
 */

const fs = require('fs');
const path = require('path');

const LOCALE_DIR = path.join(__dirname, '../../locale');
const DEFAULT_LANG = 'en';
const SUPPORTED_LANGS = ['en', 'es', 'de', 'fr', 'pt'];

// Cache loaded locales
const localeCache = new Map();

// ═══════════════════════════════════════════════════════════════════
// LOCALE LOADING
// ═══════════════════════════════════════════════════════════════════

/**
 * Load a locale file
 */
function loadLocale(lang) {
    if (localeCache.has(lang)) {
        return localeCache.get(lang);
    }

    const filePath = path.join(LOCALE_DIR, `${lang}.json`);
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(content);
        localeCache.set(lang, parsed);
        return parsed;
    } catch (err) {
        console.warn(`Failed to load locale ${lang}:`, err.message);
        localeCache.set(lang, {});
        return {};
    }
}

/**
 * Preload all supported locales
 */
function preloadLocales() {
    for (const lang of SUPPORTED_LANGS) {
        loadLocale(lang);
    }
}

/**
 * Reload locales (useful after updates)
 */
function reloadLocales() {
    localeCache.clear();
    preloadLocales();
}

// ═══════════════════════════════════════════════════════════════════
// TRANSLATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve a dotted key path in an object
 * @example resolveKey({ a: { b: 'value' } }, 'a.b') => 'value'
 */
function resolveKey(obj, key) {
    if (!obj || !key) return undefined;

    // Direct key match
    if (key in obj) return obj[key];

    // Dotted path resolution
    const parts = key.split('.');
    let current = obj;

    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        } else {
            return undefined;
        }
    }

    return typeof current === 'string' ? current : undefined;
}

/**
 * Interpolate variables into a template string
 * Supports {{variable}} and {variable} syntax
 */
function interpolate(template, vars) {
    if (!vars || typeof template !== 'string') return template;

    return template
        // Handle {{var}} syntax
        .replace(/\{\{(\w+)\}\}/g, (_, key) => 
            key in vars ? String(vars[key]) : `{{${key}}}`
        )
        // Handle {var} syntax
        .replace(/\{(\w+)\}/g, (_, key) => 
            key in vars ? String(vars[key]) : `{${key}}`
        );
}

/**
 * Main translation function
 * 
 * @param {string} lang - Language code (en, es, de, fr, pt)
 * @param {string} key - Translation key (supports dotted notation)
 * @param {Object} vars - Variables for interpolation
 * @returns {string} Translated string or key if not found
 * 
 * @example
 * t('en', 'moderation.warn.title') => '⚠️ Warning Issued'
 * t('es', 'verification.dm.welcome', { server: 'MyServer' }) => 'Bienvenido a MyServer!'
 */
function t(lang, key, vars = {}) {
    // Normalize language
    const normalizedLang = (lang || DEFAULT_LANG).toLowerCase().slice(0, 2);
    const targetLang = SUPPORTED_LANGS.includes(normalizedLang) ? normalizedLang : DEFAULT_LANG;

    // Try target language
    const targetLocale = loadLocale(targetLang);
    let template = resolveKey(targetLocale, key);

    // Fallback to English if not found
    if (!template && targetLang !== DEFAULT_LANG) {
        const defaultLocale = loadLocale(DEFAULT_LANG);
        template = resolveKey(defaultLocale, key);
    }

    // Return key if no translation found (helps identify missing keys)
    if (!template) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn(`Missing translation: ${key} (${targetLang})`);
        }
        return key;
    }

    return interpolate(template, vars);
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FACTORIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a translator bound to a specific language
 * 
 * @param {string} lang - Language code
 * @returns {Function} Bound translation function
 * 
 * @example
 * const tr = createTranslator('es');
 * tr('moderation.warn.title') => '⚠️ Advertencia Emitida'
 */
function createTranslator(lang) {
    return (key, vars) => t(lang, key, vars);
}

/**
 * Create a translator that reads language from context
 * 
 * @param {Function} langGetter - Function that returns current language
 * @returns {Function} Context-aware translation function
 * 
 * @example
 * const tr = createContextTranslator(() => guild.language || 'en');
 * tr('moderation.warn.title')
 */
function createContextTranslator(langGetter) {
    return (key, vars) => t(langGetter(), key, vars);
}

/**
 * Create a translator for Express request/response
 * Reads language from: req.query.lang > req.user.language > req.guild.language > 'en'
 * 
 * @param {Object} req - Express request object
 * @returns {Function} Request-scoped translation function
 */
function createRequestTranslator(req) {
    const lang = req.query?.lang 
        || req.user?.language 
        || req.guildConfig?.language 
        || DEFAULT_LANG;
    
    return createTranslator(lang);
}

// ═══════════════════════════════════════════════════════════════════
// EXPRESS MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════

/**
 * Express middleware to attach translator to request
 * 
 * @example
 * app.use(i18nMiddleware());
 * // Then in routes:
 * res.json({ message: req.t('success.saved') });
 */
function i18nMiddleware() {
    return (req, res, next) => {
        req.t = createRequestTranslator(req);
        next();
    };
}

// ═══════════════════════════════════════════════════════════════════
// VALIDATION & DEBUG
// ═══════════════════════════════════════════════════════════════════

/**
 * Get all keys from a locale
 */
function getAllKeys(lang = DEFAULT_LANG) {
    const locale = loadLocale(lang);
    const keys = [];

    function traverse(obj, prefix = '') {
        for (const [key, value] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'object' && value !== null) {
                traverse(value, fullKey);
            } else {
                keys.push(fullKey);
            }
        }
    }

    traverse(locale);
    return keys;
}

/**
 * Find missing translations compared to base locale
 */
function findMissingTranslations(lang) {
    const baseKeys = getAllKeys(DEFAULT_LANG);
    const targetKeys = new Set(getAllKeys(lang));

    return baseKeys.filter(key => !targetKeys.has(key));
}

/**
 * Validate all locales for completeness
 */
function validateLocales() {
    const results = {};

    for (const lang of SUPPORTED_LANGS) {
        if (lang === DEFAULT_LANG) continue;
        
        const missing = findMissingTranslations(lang);
        results[lang] = {
            complete: missing.length === 0,
            missing,
            missingCount: missing.length
        };
    }

    return results;
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

// Preload on import
preloadLocales();

module.exports = {
    // Core
    t,
    loadLocale,
    reloadLocales,
    
    // Factories
    createTranslator,
    createContextTranslator,
    createRequestTranslator,
    
    // Middleware
    i18nMiddleware,
    
    // Validation
    getAllKeys,
    findMissingTranslations,
    validateLocales,
    
    // Constants
    DEFAULT_LANG,
    SUPPORTED_LANGS
};
