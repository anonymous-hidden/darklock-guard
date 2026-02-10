/**
 * Environment Variable Validator
 * Validates and sanitizes environment variables on startup
 */

class EnvValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    /**
     * Validate all required environment variables
     */
    validate() {
        this.errors = [];
        this.warnings = [];

        // Critical validations
        this.validateDiscordToken();
        this.validateDiscordClientId();
        this.validateJWTSecret();
        this.validateAdminPassword();
        this.validateClientSecrets();
        this.validateInternalApiKey();
        this.validateOAuthStateSecret();
        this.validateStripeKeys();
        
        // Optional but recommended
        this.validateOptionalIntegrations();
        this.validateAuditEncryptionKey();
        this.validateDatabaseConfig();
        this.validatePortConfig();
        
        return {
            isValid: this.errors.length === 0,
            errors: this.errors,
            warnings: this.warnings
        };
    }

    /**
     * Validate Discord bot token
     */
    validateDiscordToken() {
        const token = process.env.DISCORD_TOKEN;
        
        if (!token) {
            this.errors.push('DISCORD_TOKEN is required');
            return;
        }

        // Discord tokens should be at least 50 characters
        if (token.length < 50) {
            this.errors.push('DISCORD_TOKEN appears to be invalid (too short)');
        }

        // Check if it's a placeholder
        if (token.includes('your_') || token.includes('paste_')) {
            this.errors.push('DISCORD_TOKEN appears to be a placeholder value');
        }
    }

    /**
     * Validate Discord client id format
     */
    validateDiscordClientId() {
        const clientId = process.env.DISCORD_CLIENT_ID?.trim();
        if (!clientId) {
            this.errors.push('DISCORD_CLIENT_ID is required for OAuth and slash command registration');
            return;
        }
        if (!/^\d{17,20}$/.test(clientId)) {
            this.errors.push('DISCORD_CLIENT_ID must be numeric (17-20 digits)');
        }
    }

    /**
     * Validate JWT secret for dashboard authentication
     */
    validateJWTSecret() {
        const secret = process.env.JWT_SECRET;
        
        if (!secret) {
            this.errors.push('JWT_SECRET is required for dashboard security');
            return;
        }

        if (secret.length < 32) {
            this.warnings.push('JWT_SECRET should be at least 32 characters for security');
        }

        if (secret === 'your_jwt_secret_here' || secret === 'change_me') {
            this.errors.push('JWT_SECRET is using a default/placeholder value - this is a security risk!');
        }
    }

    /**
     * Validate admin password
     */
    validateAdminPassword() {
        const password = process.env.ADMIN_PASSWORD;
        
        if (!password) {
            this.errors.push('ADMIN_PASSWORD is required for dashboard login');
            return;
        }

        if (password.length < 8) {
            this.warnings.push('ADMIN_PASSWORD should be at least 8 characters');
        }

        if (password === 'admin' || password === 'password' || password === '12345678') {
            this.errors.push('ADMIN_PASSWORD is using a weak/common password - change it immediately!');
        }

        if (password === 'your_admin_password_here') {
            this.warnings.push('ADMIN_PASSWORD appears to be a placeholder value');
        }

        // Check if it's already hashed (bcrypt starts with $2a$, $2b$, or $2y$)
        if (password.startsWith('$2')) {
            console.log('✓ ADMIN_PASSWORD is hashed');
        } else {
            this.warnings.push('ADMIN_PASSWORD is not hashed - consider using bcrypt hash');
        }
    }

    /**
     * Validate Discord OAuth secrets
     */
    validateClientSecrets() {
        const clientId = process.env.DISCORD_CLIENT_ID?.trim();
        const clientSecret = process.env.DISCORD_CLIENT_SECRET;

        if (!clientId) {
            this.warnings.push('DISCORD_CLIENT_ID not set - OAuth login will not work');
        } else if (!/^\d{17,20}$/.test(clientId)) {
            this.warnings.push('DISCORD_CLIENT_ID format appears invalid');
        }

        if (!clientSecret) {
            this.warnings.push('DISCORD_CLIENT_SECRET not set - OAuth login will not work');
        } else if (clientSecret.length < 20) {
            this.warnings.push('DISCORD_CLIENT_SECRET appears too short');
        }
    }

    /**
     * Validate internal API key for bot-to-dashboard communication
     */
    validateInternalApiKey() {
        const key = process.env.INTERNAL_API_KEY;
        if (!key) {
            this.errors.push('INTERNAL_API_KEY is required - bot event and settings sync endpoints will be disabled without it');
            return;
        }
        if (key === 'change-this-key' || key === 'your_api_key_here') {
            this.errors.push('INTERNAL_API_KEY is using a default/placeholder value - this is a critical security risk!');
        }
        if (key.length < 32) {
            this.warnings.push('INTERNAL_API_KEY should be at least 32 characters for security');
        }
    }

    /**
     * Validate OAuth state secret for CSRF protection
     */
    validateOAuthStateSecret() {
        const secret = process.env.OAUTH_STATE_SECRET;
        if (!secret && !process.env.JWT_SECRET) {
            this.errors.push('OAUTH_STATE_SECRET (or JWT_SECRET) is required for OAuth CSRF protection - OAuth login will be disabled');
            return;
        }
        if (!secret) {
            this.warnings.push('OAUTH_STATE_SECRET not set - falling back to JWT_SECRET for OAuth state signing');
        }
    }

    /**
     * Validate Stripe payment keys
     */
    validateStripeKeys() {
        const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
        const secretKey = process.env.STRIPE_SECRET_KEY;
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!publishableKey && !secretKey) {
            this.warnings.push('STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY not set - payment features will be disabled');
            return;
        }
        if (publishableKey && !publishableKey.startsWith('pk_')) {
            this.warnings.push('STRIPE_PUBLISHABLE_KEY should start with pk_');
        }
        if (secretKey && !secretKey.startsWith('sk_')) {
            this.warnings.push('STRIPE_SECRET_KEY should start with sk_');
        }
        if (!webhookSecret) {
            this.warnings.push('STRIPE_WEBHOOK_SECRET not set - Stripe webhook verification will be disabled');
        }
    }

    /**
     * Validate optional integrations (disable features if absent)
     */
    validateOptionalIntegrations() {
        const optionalKeys = [
            { key: 'OPENAI_API_KEY', feature: 'AI responses' },
            { key: 'VIRUSTOTAL_API_KEY', feature: 'VirusTotal link scanning' },
            { key: 'URLVOID_API_KEY', feature: 'URLVoid reputation checks' },
            { key: 'SAFE_BROWSING_API_KEY', feature: 'Google Safe Browsing checks' }
        ];

        optionalKeys.forEach(({ key, feature }) => {
            const value = process.env[key];
            if (!value) {
                this.warnings.push(`${key} missing - ${feature} will be disabled`);
            } else if (value.startsWith('your_') || value.startsWith('replace-with')) {
                this.warnings.push(`${key} looks like a placeholder - ${feature} will be disabled until a real key is set`);
            }
        });
    }

    /**
     * Validate audit log encryption secret
     */
    validateAuditEncryptionKey() {
        const key = process.env.AUDIT_ENCRYPTION_KEY;
        if (!key) {
            this.warnings.push('AUDIT_ENCRYPTION_KEY missing - forensic/audit payloads will not be encrypted at rest');
            return;
        }
        if (key.length < 32) {
            this.warnings.push('AUDIT_ENCRYPTION_KEY should be at least 32 characters for strong encryption');
        }
    }

    /**
     * Validate database configuration
     */
    validateDatabaseConfig() {
        const dbPath = process.env.DB_PATH || './data/';
        const dbName = process.env.DB_NAME || 'security_bot.db';

        // Check for path traversal attempts
        if (dbPath.includes('..') || dbName.includes('..')) {
            this.errors.push('Database path contains path traversal characters (..)');
        }

        // Ensure database path is relative or in safe location
        if (dbPath.startsWith('/') && !dbPath.startsWith(process.cwd())) {
            this.warnings.push('Database path is absolute - ensure it points to a safe location');
        }
    }

    /**
     * Validate port configuration
     */
    validatePortConfig() {
        const port = process.env.PORT || process.env.WEB_PORT;
        
        if (port) {
            const portNum = parseInt(port);
            if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
                this.warnings.push('PORT value is invalid - should be between 1 and 65535');
            }
            if (portNum < 1024 && process.getuid && process.getuid() !== 0) {
                this.warnings.push('PORT is below 1024 - may require root privileges');
            }
        }
    }

    /**
     * Sanitize environment variables to prevent injection
     */
    sanitize() {
        // Remove any potentially dangerous characters from string env vars
        const stringVars = ['DB_PATH', 'DB_NAME', 'WEB_HOST'];
        
        stringVars.forEach(varName => {
            const value = process.env[varName];
            if (value && typeof value === 'string') {
                // Remove shell metacharacters
                const sanitized = value.replace(/[;|&$`<>'"\\]/g, '');
                if (sanitized !== value) {
                    console.warn(`⚠️  Sanitized ${varName}: removed shell metacharacters`);
                    process.env[varName] = sanitized;
                }
            }
        });

        // Trim whitespace/CRLF from critical auth values
        const trimVars = [
            'DISCORD_TOKEN',
            'BOT_TOKEN',
            'DISCORD_CLIENT_ID',
            'DISCORD_CLIENT_SECRET',
            'ADMIN_PASSWORD'
        ];

        trimVars.forEach(varName => {
            const value = process.env[varName];
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed !== value) {
                    process.env[varName] = trimmed;
                }
            }
        });
    }

    /**
     * Generate a secure random string for secrets
     */
    static generateSecret(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
        let result = '';
        const crypto = require('crypto');
        const randomBytes = crypto.randomBytes(length);
        
        for (let i = 0; i < length; i++) {
            result += chars[randomBytes[i] % chars.length];
        }
        
        return result;
    }

    /**
     * Print validation report
     */
    printReport() {
        console.log('\n🔒 Environment Security Validation\n');
        
        if (this.errors.length > 0) {
            console.log('❌ ERRORS (must be fixed):');
            this.errors.forEach(error => console.log(`   • ${error}`));
            console.log('');
        }

        if (this.warnings.length > 0) {
            console.log('⚠️  WARNINGS (recommended to fix):');
            this.warnings.forEach(warning => console.log(`   • ${warning}`));
            console.log('');
        }

        if (this.errors.length === 0 && this.warnings.length === 0) {
            console.log('✅ All environment variables are properly configured\n');
        }

        return this.errors.length === 0;
    }
}

module.exports = EnvValidator;
