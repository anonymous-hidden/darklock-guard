/**
 * Simple i18n (internationalization) module for Darklock Dashboard
 * Loads translation files and applies them to the UI
 */

class I18n {
    constructor() {
        this.currentLanguage = 'en';
        this.translations = {};
        this.fallbackLanguage = 'en';
    }

    /**
     * Initialize i18n with user's preferred language
     * @param {string} language - Language code (en, es, fr, de, pt)
     */
    async init(language = 'en') {
        this.currentLanguage = language;
        console.debug('[i18n] init start', { language });
        await this.loadTranslations(language);
        
        // Load fallback if not English
        if (language !== 'en' && !this.translations[language]) {
            await this.loadTranslations('en');
        }
        
        this.applyTranslations();
        console.debug('[i18n] init complete', { language: this.currentLanguage });
    }

    /**
     * Load translation file from server
     * @param {string} language - Language code
     */
    async loadTranslations(language) {
        try {
            const response = await fetch(`/platform/static/locales/${language}.json`);
            if (response.ok) {
                this.translations[language] = await response.json();
                console.log(`✓ Loaded ${language} translations`);
                return true;
            } else {
                console.warn(`✗ Failed to load ${language} translations`);
                return false;
            }
        } catch (error) {
            console.error(`Error loading ${language} translations:`, error);
            return false;
        }
    }

    /**
     * Get translation by key (supports dot notation)
     * @param {string} key - Translation key (e.g., "nav.profile")
     * @param {object} params - Optional parameters for string interpolation
     * @returns {string} Translated text or key if not found
     */
    t(key, params = {}) {
        // Try current language first
        let text = this.getNestedValue(this.translations[this.currentLanguage], key);
        
        // Fall back to English if translation not found
        if (!text && this.currentLanguage !== this.fallbackLanguage) {
            text = this.getNestedValue(this.translations[this.fallbackLanguage], key);
        }
        
        // Return key if still not found
        if (!text) {
            console.warn(`Translation not found: ${key}`);
            return key;
        }
        
        // Replace parameters if provided
        return this.interpolate(text, params);
    }

    /**
     * Get nested object value by dot notation key
     * @param {object} obj - Object to search
     * @param {string} key - Dot notation key
     * @returns {any} Value or null
     */
    getNestedValue(obj, key) {
        if (!obj) return null;
        return key.split('.').reduce((current, prop) => current?.[prop], obj);
    }

    /**
     * Simple string interpolation
     * @param {string} text - Text with {{placeholders}}
     * @param {object} params - Key-value pairs to replace
     * @returns {string} Interpolated text
     */
    interpolate(text, params) {
        return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return params[key] !== undefined ? params[key] : match;
        });
    }

    /**
     * Apply translations to all elements with data-i18n attribute
     */
    applyTranslations() {
        const elements = document.querySelectorAll('[data-i18n]');
        
        console.log(`[i18n] Applying translations to ${elements.length} elements for language: ${this.currentLanguage}`);
        
        elements.forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translatedText = this.t(key);
            
            // Handle different element types
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                if (element.hasAttribute('placeholder')) {
                    element.placeholder = translatedText;
                }
                if (element.type === 'button' || element.type === 'submit') {
                    element.value = translatedText;
                }
            } else {
                element.textContent = translatedText;
            }
        });
        
        console.log(`✓ Applied translations for ${this.currentLanguage}`);
    }

    /**
     * Change language and reload translations
     * @param {string} language - New language code
     */
    async setLanguage(language) {
        if (language === this.currentLanguage) return;
        
        this.currentLanguage = language;
        
        // Load translations if not already cached
        if (!this.translations[language]) {
            await this.loadTranslations(language);
        }
        
        this.applyTranslations();
    }

    /**
     * Get current language
     * @returns {string} Current language code
     */
    getLanguage() {
        return this.currentLanguage;
    }

    /**
     * Get available languages
     * @returns {array} Array of language codes
     */
    getAvailableLanguages() {
        return ['en', 'es', 'fr', 'de', 'pt'];
    }
}

// Create global instance
window.i18n = new I18n();
