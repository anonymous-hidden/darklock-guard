const REQUIRED_ENV = [
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'JWT_SECRET',
    'ADMIN_PASSWORD',
    'AUDIT_ENCRYPTION_KEY'
];

const PLACEHOLDER_PATTERNS = ['your_', 'paste_', 'changeme', 'change_me', 'placeholder'];

class EnvironmentGuard {
    constructor(logger = console) {
        this.logger = logger;
    }

    isPlaceholder(value) {
        if (!value) return false;
        const lower = value.toLowerCase();
        return PLACEHOLDER_PATTERNS.some(p => lower.includes(p));
    }

    validate() {
        const violations = [];

        if (process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_ENV !== 'true') {
            violations.push('NODE_ENV is "development" in production context');
        }

        if (process.env.NODE_OPTIONS && process.env.NODE_OPTIONS.trim().length > 0) {
            const allowed = process.env.ALLOWED_NODE_OPTIONS || '';
            if (!allowed || process.env.NODE_OPTIONS.trim() !== allowed.trim()) {
                violations.push('NODE_OPTIONS is set unexpectedly');
            }
        }

        if (process.env.NODE_PATH && process.env.NODE_PATH.trim().length > 0) {
            violations.push('NODE_PATH must not be set');
        }

        for (const key of REQUIRED_ENV) {
            const val = process.env[key];
            if (!val || val.trim().length === 0) {
                violations.push(`${key} is required`);
                continue;
            }
            if (this.isPlaceholder(val)) {
                violations.push(`${key} contains a placeholder value`);
            }
        }

        return violations;
    }
}

module.exports = EnvironmentGuard;
