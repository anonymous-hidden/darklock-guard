/**
 * Darklock Platform - Environment Validator
 * 
 * SECURITY CRITICAL: This module ensures all required secrets are present
 * and meet minimum security requirements. The application will fail-fast
 * if any required environment variable is missing or weak.
 * 
 * NO FALLBACKS. NO DEFAULTS. NO EXCEPTIONS.
 */

'use strict';

/**
 * Require an environment variable with minimum length validation
 * @param {string} name - Environment variable name
 * @param {number} minLength - Minimum required length (default: 64)
 * @returns {string} - The validated environment variable value
 * @throws {Error} - Exits process if validation fails
 */
function requireEnv(name, minLength = 64) {
    const value = process.env[name];
    
    if (!value) {
        console.error(`[FATAL] Missing required environment variable: ${name}`);
        console.error(`[FATAL] This is a security-critical configuration. The application cannot start without it.`);
        process.exit(1);
    }
    
    if (value.length < minLength) {
        console.error(`[FATAL] Environment variable ${name} is too short (${value.length} chars, minimum: ${minLength})`);
        console.error(`[FATAL] Generate a secure secret with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`);
        process.exit(1);
    }
    
    return value;
}

/**
 * Validate that two secrets are different (prevents secret reuse)
 * @param {string} secret1Name - First secret name
 * @param {string} secret1Value - First secret value
 * @param {string} secret2Name - Second secret name
 * @param {string} secret2Value - Second secret value
 */
function requireDifferentSecrets(secret1Name, secret1Value, secret2Name, secret2Value) {
    if (secret1Value === secret2Value) {
        console.error(`[FATAL] ${secret1Name} and ${secret2Name} must be different secrets`);
        console.error(`[FATAL] Using the same secret for user and admin tokens is a security risk`);
        process.exit(1);
    }
}

/**
 * Get JWT secret for user tokens (validates on first call)
 * @returns {string} - The validated JWT secret
 */
let _jwtSecret = null;
function getJwtSecret() {
    if (!_jwtSecret) {
        _jwtSecret = requireEnv('JWT_SECRET', 64);
    }
    return _jwtSecret;
}

/**
 * Get JWT secret for admin tokens (validates on first call)
 * @returns {string} - The validated admin JWT secret
 */
let _adminJwtSecret = null;
function getAdminJwtSecret() {
    if (!_adminJwtSecret) {
        _adminJwtSecret = requireEnv('ADMIN_JWT_SECRET', 64);
        
        // Ensure admin secret is different from user secret
        const userSecret = getJwtSecret();
        requireDifferentSecrets('JWT_SECRET', userSecret, 'ADMIN_JWT_SECRET', _adminJwtSecret);
    }
    return _adminJwtSecret;
}

/**
 * Validate all required secrets at startup
 * Call this once during application initialization
 */
function validateAllSecrets() {
    console.log('[Security] Validating required environment secrets...');
    
    // Validate both secrets exist and are different
    const jwtSecret = getJwtSecret();
    const adminJwtSecret = getAdminJwtSecret();
    
    console.log('[Security] ✅ JWT_SECRET validated (length: ' + jwtSecret.length + ')');
    console.log('[Security] ✅ ADMIN_JWT_SECRET validated (length: ' + adminJwtSecret.length + ')');
    console.log('[Security] ✅ Secrets are unique');
    
    return { jwtSecret, adminJwtSecret };
}

module.exports = {
    requireEnv,
    requireDifferentSecrets,
    getJwtSecret,
    getAdminJwtSecret,
    validateAllSecrets
};
