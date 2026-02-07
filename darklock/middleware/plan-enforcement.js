/**
 * Darklock Platform - Plan Enforcement Middleware
 * Server-side enforcement of Free vs Pro plan features
 * 
 * CRITICAL: All feature restrictions must be enforced server-side
 * UI restrictions are for UX only - not security
 */

const db = require('../utils/database');
const premiumManager = require('../utils/premium');

/**
 * Feature definitions for each plan
 */
const PLAN_FEATURES = {
    free: {
        maxSessions: 3,
        maxDevices: 2,
        exportData: false,
        customAvatar: true,
        apiAccess: false,
        prioritySupport: false,
        advancedSecurity: false,
        twoFactor: true,
        profileCustomization: false,
        dataRetention: 30, // days
        maxFileSize: 5 * 1024 * 1024, // 5MB
        features: [
            'basic_profile',
            'password_change',
            'session_management',
            'basic_2fa',
            'avatar_upload'
        ]
    },
    pro: {
        maxSessions: 10,
        maxDevices: 5,
        exportData: true,
        customAvatar: true,
        apiAccess: true,
        prioritySupport: true,
        advancedSecurity: true,
        twoFactor: true,
        profileCustomization: true,
        dataRetention: 365, // days
        maxFileSize: 50 * 1024 * 1024, // 50MB
        features: [
            'basic_profile',
            'password_change',
            'session_management',
            'basic_2fa',
            'advanced_2fa',
            'avatar_upload',
            'custom_avatar',
            'profile_customization',
            'data_export',
            'api_access',
            'priority_support',
            'advanced_security',
            'backup_codes',
            'security_notifications'
        ]
    }
};

/**
 * Get user's current plan
 * @param {string} userId 
 * @returns {Promise<string>} 'free' or 'pro'
 */
async function getUserPlan(userId) {
    try {
        // Check if premium manager is available
        if (!premiumManager || typeof premiumManager.getPremiumStatus !== 'function') {
            console.warn('[Plan Enforcement] Premium manager not available, defaulting to free');
            return 'free';
        }
        
        const status = await premiumManager.getPremiumStatus(userId);
        return status.tier || 'free';
    } catch (err) {
        console.error('[Plan Enforcement] Error getting plan:', err);
        return 'free'; // Default to free on error
    }
}

/**
 * Get plan features for a user
 * @param {string} userId 
 * @returns {Promise<object>} Plan features object
 */
async function getUserFeatures(userId) {
    const plan = await getUserPlan(userId);
    return PLAN_FEATURES[plan] || PLAN_FEATURES.free;
}

/**
 * Check if user has access to a specific feature
 * @param {string} userId 
 * @param {string} feature 
 * @returns {Promise<boolean>}
 */
async function hasFeature(userId, feature) {
    const features = await getUserFeatures(userId);
    return features.features.includes(feature);
}

/**
 * Middleware: Require Pro plan
 * Returns 403 if user doesn't have Pro
 */
function requirePro(req, res, next) {
    return async function(req, res, next) {
        try {
            const plan = await getUserPlan(req.user.userId);
            
            if (plan !== 'pro') {
                return res.status(403).json({
                    success: false,
                    error: 'This feature requires a Pro plan',
                    requiresPro: true,
                    currentPlan: plan,
                    upgradeUrl: '/platform/premium'
                });
            }
            
            next();
        } catch (err) {
            console.error('[Plan Enforcement] Error in requirePro:', err);
            res.status(500).json({
                success: false,
                error: 'Failed to verify plan status'
            });
        }
    };
}

/**
 * Middleware: Require specific feature
 * Returns 403 if user doesn't have the feature
 */
function requireFeature(featureName) {
    return async function(req, res, next) {
        try {
            const hasAccess = await hasFeature(req.user.userId, featureName);
            
            if (!hasAccess) {
                const plan = await getUserPlan(req.user.userId);
                return res.status(403).json({
                    success: false,
                    error: `This feature requires a Pro plan`,
                    requiresFeature: featureName,
                    currentPlan: plan,
                    upgradeUrl: '/platform/premium'
                });
            }
            
            next();
        } catch (err) {
            console.error('[Plan Enforcement] Error in requireFeature:', err);
            res.status(500).json({
                success: false,
                error: 'Failed to verify feature access'
            });
        }
    };
}

/**
 * Check session limit enforcement
 */
async function enforceSessionLimit(req, res, next) {
    try {
        const features = await getUserFeatures(req.user.userId);
        const sessions = await db.getUserSessions(req.user.userId);
        const activeSessions = sessions.filter(s => !s.revoked_at);
        
        if (activeSessions.length >= features.maxSessions) {
            return res.status(429).json({
                success: false,
                error: `Session limit reached (${features.maxSessions} max)`,
                requiresUpgrade: true,
                currentPlan: await getUserPlan(req.user.userId)
            });
        }
        
        next();
    } catch (err) {
        console.error('[Plan Enforcement] Error enforcing session limit:', err);
        next(); // Allow on error
    }
}

/**
 * Check file size limit
 */
function enforceFileSizeLimit(req, res, next) {
    return async function(req, res, next) {
        try {
            if (!req.file) {
                return next();
            }
            
            const features = await getUserFeatures(req.user.userId);
            
            if (req.file.size > features.maxFileSize) {
                return res.status(413).json({
                    success: false,
                    error: `File too large. Maximum size: ${Math.round(features.maxFileSize / 1024 / 1024)}MB`,
                    maxSize: features.maxFileSize,
                    requiresUpgrade: features.maxFileSize < PLAN_FEATURES.pro.maxFileSize
                });
            }
            
            next();
        } catch (err) {
            console.error('[Plan Enforcement] Error enforcing file size:', err);
            next(); // Allow on error
        }
    };
}

/**
 * Attach plan info to request
 * Adds req.userPlan and req.userFeatures
 */
async function attachPlanInfo(req, res, next) {
    try {
        if (req.user && req.user.userId) {
            req.userPlan = await getUserPlan(req.user.userId);
            req.userFeatures = await getUserFeatures(req.user.userId);
        }
        next();
    } catch (err) {
        console.error('[Plan Enforcement] Error attaching plan info:', err);
        next(); // Continue without plan info
    }
}

module.exports = {
    PLAN_FEATURES,
    getUserPlan,
    getUserFeatures,
    hasFeature,
    requirePro,
    requireFeature,
    enforceSessionLimit,
    enforceFileSizeLimit,
    attachPlanInfo
};
