/**
 * Centralized Environment Configuration
 * Single source of truth for all environment variable access
 * 
 * Usage:
 *   const env = require('./utils/EnvConfig');
 *   const port = env.get('WEB_PORT');
 *   if (env.isProduction()) { ... }
 */

class EnvConfig {
    constructor() {
        this.cache = new Map();
        
        // Schema defines all known env vars with types, defaults, and validation
        this.schema = {
            // ═══════════════════════════════════════════════════════════════
            // REQUIRED - Bot will not start without these
            // ═══════════════════════════════════════════════════════════════
            DISCORD_TOKEN: { 
                required: true, 
                type: 'string', 
                minLength: 50,
                description: 'Discord bot token'
            },
            DISCORD_CLIENT_ID: { 
                required: true, 
                type: 'string', 
                pattern: /^\d{17,20}$/,
                description: 'Discord application client ID'
            },
            DISCORD_CLIENT_SECRET: { 
                required: true, 
                type: 'string',
                description: 'Discord OAuth client secret'
            },
            JWT_SECRET: { 
                required: true, 
                type: 'string', 
                minLength: 32,
                description: 'Secret for signing JWT tokens'
            },
            
            // ═══════════════════════════════════════════════════════════════
            // ENVIRONMENT & MODE
            // ═══════════════════════════════════════════════════════════════
            NODE_ENV: { 
                default: 'development',
                type: 'string',
                enum: ['development', 'production', 'test']
            },
            PRODUCTION_MODE: { 
                default: false, 
                type: 'boolean',
                description: 'Enable production optimizations'
            },
            
            // ═══════════════════════════════════════════════════════════════
            // DATABASE
            // ═══════════════════════════════════════════════════════════════
            DB_PATH: { 
                default: './data/',
                type: 'string'
            },
            DB_NAME: { 
                default: 'security_bot.db',
                type: 'string'
            },
            
            // ═══════════════════════════════════════════════════════════════
            // WEB SERVER / DASHBOARD
            // ═══════════════════════════════════════════════════════════════
            PORT: {
                default: 3001,
                type: 'number',
                description: 'Primary port (used by hosting platforms)'
            },
            WEB_PORT: { 
                default: 3001, 
                type: 'number',
                description: 'Web dashboard port'
            },
            DASHBOARD_PORT: { 
                default: 3001, 
                type: 'number',
                description: 'Alias for WEB_PORT'
            },
            ENABLE_WEB_DASHBOARD: { 
                default: true,
                type: 'boolean'
            },
            DASHBOARD_ORIGIN: { 
                default: 'http://localhost:3001',
                type: 'string',
                description: 'CORS origin for dashboard'
            },
            DASHBOARD_URL: { 
                default: 'http://localhost:3001',
                type: 'string',
                description: 'Public URL for dashboard links'
            },
            DOMAIN: {
                default: null,
                type: 'string',
                description: 'Production domain'
            },
            RENDER_EXTERNAL_URL: {
                default: null,
                type: 'string',
                description: 'Render.com external URL'
            },
            
            // ═══════════════════════════════════════════════════════════════
            // DISCORD OAUTH
            // ═══════════════════════════════════════════════════════════════
            DISCORD_REDIRECT_URI: {
                default: null,
                type: 'string',
                description: 'OAuth redirect URI'
            },
            DISCORD_OAUTH_SCOPE: {
                default: 'identify email guilds',
                type: 'string'
            },
            
            // ═══════════════════════════════════════════════════════════════
            // SECURITY & AUTH
            // ═══════════════════════════════════════════════════════════════
            ADMIN_PASSWORD: {
                required: false,
                type: 'string',
                description: 'Hashed admin password'
            },
            INTERNAL_API_KEY: {
                required: false,
                type: 'string',
                description: 'Internal API authentication key'
            },
            AUDIT_ENCRYPTION_KEY: {
                required: false,
                type: 'string',
                description: 'Key for encrypting audit logs'
            },
            AUDIT_LOG_SECRET: {
                required: false,
                type: 'string',
                description: 'Alternative name for audit encryption key'
            },
            
            // ═══════════════════════════════════════════════════════════════
            // STRIPE (Optional - for billing)
            // ═══════════════════════════════════════════════════════════════
            STRIPE_SECRET: { 
                required: false,
                type: 'string'
            },
            STRIPE_PUBLISHABLE: { 
                required: false,
                type: 'string'
            },
            STRIPE_WEBHOOK_SECRET: { 
                required: false,
                type: 'string'
            },
            STRIPE_PRO_PRICE_ID: {
                required: false,
                type: 'string'
            },
            STRIPE_ENTERPRISE_PRICE_ID: {
                required: false,
                type: 'string'
            },
            
            // ═══════════════════════════════════════════════════════════════
            // EXTERNAL INTEGRATIONS (Optional)
            // ═══════════════════════════════════════════════════════════════
            SAFE_BROWSING_API_KEY: { 
                required: false,
                type: 'string',
                description: 'Google Safe Browsing API key'
            },
            URLVOID_API_KEY: {
                required: false,
                type: 'string',
                description: 'URLVoid reputation API key'
            },
            EXTERNAL_LOG_WEBHOOK_URL: {
                required: false,
                type: 'string',
                description: 'External webhook for log forwarding'
            },
            
            // ═══════════════════════════════════════════════════════════════
            // FEATURE FLAGS
            // ═══════════════════════════════════════════════════════════════
            SKIP_ENV_VALIDATION: {
                default: false,
                type: 'boolean',
                description: 'Skip environment validation (not recommended)'
            }
        };
    }

    /**
     * Get an environment variable with type coercion and defaults
     * @param {string} key - Environment variable name
     * @param {*} defaultOverride - Override the schema default
     * @returns {*} The value (typed appropriately)
     */
    get(key, defaultOverride = undefined) {
        // Check cache first
        if (this.cache.has(key) && defaultOverride === undefined) {
            return this.cache.get(key);
        }
        
        const spec = this.schema[key] || {};
        let value = process.env[key];
        
        // Use default if not set
        if (value === undefined || value === '') {
            value = defaultOverride !== undefined ? defaultOverride : spec.default;
        }
        
        // Type coercion
        if (value !== null && value !== undefined) {
            if (spec.type === 'boolean') {
                value = value === 'true' || value === '1' || value === true;
            } else if (spec.type === 'number') {
                const parsed = parseInt(value, 10);
                value = isNaN(parsed) ? spec.default : parsed;
            }
        }
        
        // Cache and return
        if (defaultOverride === undefined) {
            this.cache.set(key, value);
        }
        return value;
    }

    /**
     * Check if running in production mode
     */
    isProduction() {
        return this.get('PRODUCTION_MODE') || this.get('NODE_ENV') === 'production';
    }

    /**
     * Check if running in development mode
     */
    isDevelopment() {
        return !this.isProduction();
    }

    /**
     * Get the effective port for the web server
     */
    getPort() {
        return this.get('PORT') || this.get('DASHBOARD_PORT') || this.get('WEB_PORT') || 3001;
    }

    /**
     * Get the effective domain/origin
     */
    getDomain() {
        return this.get('DOMAIN') || 
               this.get('RENDER_EXTERNAL_URL') || 
               this.get('DASHBOARD_ORIGIN') ||
               `http://localhost:${this.getPort()}`;
    }

    /**
     * Validate all required environment variables
     * @returns {{isValid: boolean, errors: string[], warnings: string[]}}
     */
    validate() {
        const errors = [];
        const warnings = [];
        
        for (const [key, spec] of Object.entries(this.schema)) {
            const value = process.env[key];
            
            // Check required
            if (spec.required && (!value || value.trim() === '')) {
                errors.push(`${key} is required but not set`);
                continue;
            }
            
            // Skip further validation if not set and not required
            if (!value) continue;
            
            // Check minimum length
            if (spec.minLength && value.length < spec.minLength) {
                errors.push(`${key} must be at least ${spec.minLength} characters`);
            }
            
            // Check pattern
            if (spec.pattern && !spec.pattern.test(value)) {
                errors.push(`${key} has invalid format`);
            }
            
            // Check enum
            if (spec.enum && !spec.enum.includes(value)) {
                warnings.push(`${key} has unexpected value "${value}", expected one of: ${spec.enum.join(', ')}`);
            }
            
            // Check for placeholder values
            if (value.includes('your_') || value.includes('paste_') || value.includes('change_me')) {
                errors.push(`${key} appears to be a placeholder value`);
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Clear the cache (useful for testing)
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Get all environment variables as an object (for debugging)
     * Masks sensitive values
     */
    getAll(maskSensitive = true) {
        const result = {};
        const sensitiveKeys = ['TOKEN', 'SECRET', 'PASSWORD', 'KEY', 'API_KEY'];
        
        for (const key of Object.keys(this.schema)) {
            let value = this.get(key);
            
            if (maskSensitive && value && sensitiveKeys.some(s => key.includes(s))) {
                value = typeof value === 'string' ? `${value.substring(0, 4)}...` : '[MASKED]';
            }
            
            result[key] = value;
        }
        
        return result;
    }
}

// Export singleton instance
module.exports = new EnvConfig();
