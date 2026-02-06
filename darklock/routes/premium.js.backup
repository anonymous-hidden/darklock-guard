/**
 * Darklock Premium System
 * Manages premium subscriptions, feature access, and license codes
 * 
 * Features:
 * - Premium tier management (Free, Pro, Enterprise)
 * - Feature gating with lock icons
 * - License code generation and redemption
 * - Stripe payment integration
 */

const crypto = require('crypto');
const db = require('./database');

// Premium tier definitions
const PREMIUM_TIERS = {
    free: {
        id: 'free',
        name: 'Free',
        price: 0,
        features: {
            // Dashboard features
            basicDashboard: true,
            customTheme: false,
            advancedAnalytics: false,
            prioritySupport: false,
            apiAccess: false,
            customBranding: false,
            multipleDevices: false,
            exportData: false,
            
            // Bot features (if applicable)
            basicModeration: true,
            advancedAntiRaid: false,
            customCommands: false,
            unlimitedServers: false,
            premiumSupport: false,
            
            // Settings restrictions
            maxSessions: 2,
            sessionTimeout: true, // Can't disable
            activityTracking: true, // Can't disable
            betaFeatures: false
        }
    },
    pro: {
        id: 'pro',
        name: 'Pro',
        price: 9.99,
        stripePriceId: process.env.STRIPE_PRO_PRICE_ID,
        features: {
            basicDashboard: true,
            customTheme: true,
            advancedAnalytics: true,
            prioritySupport: true,
            apiAccess: true,
            customBranding: false,
            multipleDevices: true,
            exportData: true,
            
            basicModeration: true,
            advancedAntiRaid: true,
            customCommands: true,
            unlimitedServers: false,
            premiumSupport: true,
            
            maxSessions: 10,
            sessionTimeout: false,
            activityTracking: false,
            betaFeatures: true
        }
    },
    enterprise: {
        id: 'enterprise',
        name: 'Enterprise',
        price: 29.99,
        stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
        features: {
            basicDashboard: true,
            customTheme: true,
            advancedAnalytics: true,
            prioritySupport: true,
            apiAccess: true,
            customBranding: true,
            multipleDevices: true,
            exportData: true,
            
            basicModeration: true,
            advancedAntiRaid: true,
            customCommands: true,
            unlimitedServers: true,
            premiumSupport: true,
            
            maxSessions: 50,
            sessionTimeout: false,
            activityTracking: false,
            betaFeatures: true
        }
    }
};

// Feature display names and descriptions for UI
const FEATURE_INFO = {
    customTheme: {
        name: 'Custom Themes',
        description: 'Customize your dashboard appearance',
        icon: 'palette'
    },
    advancedAnalytics: {
        name: 'Advanced Analytics',
        description: 'Detailed insights and reports',
        icon: 'chart'
    },
    prioritySupport: {
        name: 'Priority Support',
        description: '24/7 priority customer support',
        icon: 'headset'
    },
    apiAccess: {
        name: 'API Access',
        description: 'Full REST API access',
        icon: 'code'
    },
    customBranding: {
        name: 'Custom Branding',
        description: 'White-label your dashboard',
        icon: 'brand'
    },
    multipleDevices: {
        name: 'Multiple Devices',
        description: 'Connect unlimited devices',
        icon: 'devices'
    },
    exportData: {
        name: 'Data Export',
        description: 'Export all your data',
        icon: 'download'
    },
    advancedAntiRaid: {
        name: 'Advanced Anti-Raid',
        description: 'Enhanced raid protection',
        icon: 'shield'
    },
    customCommands: {
        name: 'Custom Commands',
        description: 'Create custom bot commands',
        icon: 'terminal'
    },
    unlimitedServers: {
        name: 'Unlimited Servers',
        description: 'No server limits',
        icon: 'server'
    },
    betaFeatures: {
        name: 'Beta Features',
        description: 'Early access to new features',
        icon: 'flask'
    }
};

// Locked settings for free users
const LOCKED_SETTINGS = {
    free: [
        'sessionTimeout',        // Can't change session timeout
        'activityTracking',      // Can't disable tracking
        'pushNotifications',     // No push notifications
        'customBranding',        // No custom branding
        'exportData',            // No data export
        'betaFeatures'           // No beta features
    ],
    pro: [
        'customBranding',        // Still no custom branding on Pro
    ],
    enterprise: []               // Everything unlocked
};

class PremiumManager {
    constructor() {
        this.tiers = PREMIUM_TIERS;
        this.featureInfo = FEATURE_INFO;
        this.lockedSettings = LOCKED_SETTINGS;
    }

    /**
     * Generate a unique license code
     * Format: DRKL-XXXX-XXXX-XXXX
     */
    generateLicenseCode() {
        const segments = [];
        for (let i = 0; i < 3; i++) {
            segments.push(crypto.randomBytes(2).toString('hex').toUpperCase());
        }
        return `DRKL-${segments.join('-')}`;
    }

    /**
     * Get user's premium tier
     */
    async getUserTier(userId) {
        try {
            const premium = await db.getUserPremium(userId);
            if (!premium || !premium.tier || premium.expires_at) {
                // Check if expired
                if (premium && premium.expires_at && new Date(premium.expires_at) < new Date()) {
                    return 'free';
                }
            }
            return premium?.tier || 'free';
        } catch (err) {
            console.error('[Premium] Error getting user tier:', err);
            return 'free';
        }
    }

    /**
     * Get full premium status for a user
     */
    async getPremiumStatus(userId) {
        try {
            const premium = await db.getUserPremium(userId);
            const tier = premium?.tier || 'free';
            const tierConfig = this.tiers[tier] || this.tiers.free;

            return {
                tier,
                tierName: tierConfig.name,
                isPremium: tier !== 'free',
                features: tierConfig.features,
                expiresAt: premium?.expires_at || null,
                licenseCode: premium?.license_code || null,
                stripeCustomerId: premium?.stripe_customer_id || null,
                stripeSubscriptionId: premium?.stripe_subscription_id || null,
                purchasedAt: premium?.purchased_at || null
            };
        } catch (err) {
            console.error('[Premium] Error getting premium status:', err);
            return {
                tier: 'free',
                tierName: 'Free',
                isPremium: false,
                features: this.tiers.free.features,
                expiresAt: null
            };
        }
    }

    /**
     * Check if user has access to a specific feature
     */
    async hasFeature(userId, featureName) {
        const status = await this.getPremiumStatus(userId);
        return status.features[featureName] === true;
    }

    /**
     * Get locked settings for user's tier
     */
    async getLockedSettings(userId) {
        const tier = await this.getUserTier(userId);
        return this.lockedSettings[tier] || this.lockedSettings.free;
    }

    /**
     * Activate premium for a user
     */
    async activatePremium(userId, tier, options = {}) {
        const {
            licenseCode = this.generateLicenseCode(),
            stripeCustomerId = null,
            stripeSubscriptionId = null,
            expiresAt = null // null = lifetime, or Date for subscription
        } = options;

        const now = new Date().toISOString();

        await db.savePremium({
            userId,
            tier,
            licenseCode,
            stripeCustomerId,
            stripeSubscriptionId,
            purchasedAt: now,
            expiresAt,
            active: 1
        });

        return {
            success: true,
            tier,
            licenseCode,
            expiresAt
        };
    }

    /**
     * Redeem a license code
     */
    async redeemCode(userId, code) {
        try {
            // Find the code
            const license = await db.getLicenseByCode(code);
            
            if (!license) {
                return { success: false, error: 'Invalid license code' };
            }

            if (license.redeemed_by) {
                return { success: false, error: 'This code has already been redeemed' };
            }

            if (license.expires_at && new Date(license.expires_at) < new Date()) {
                return { success: false, error: 'This license code has expired' };
            }

            // Redeem the code
            await db.redeemLicense(code, userId);

            // Activate premium
            await this.activatePremium(userId, license.tier, {
                licenseCode: code,
                expiresAt: license.subscription_expires_at || null
            });

            return {
                success: true,
                tier: license.tier,
                tierName: this.tiers[license.tier]?.name || 'Premium',
                message: `Successfully activated ${this.tiers[license.tier]?.name || 'Premium'}!`
            };
        } catch (err) {
            console.error('[Premium] Error redeeming code:', err);
            return { success: false, error: 'Failed to redeem code' };
        }
    }

    /**
     * Create a new license code (admin function)
     */
    async createLicenseCode(tier, options = {}) {
        const code = this.generateLicenseCode();
        const now = new Date().toISOString();

        await db.createLicense({
            code,
            tier,
            createdAt: now,
            expiresAt: options.expiresAt || null,
            subscriptionExpiresAt: options.subscriptionExpiresAt || null,
            createdBy: options.createdBy || 'system'
        });

        return {
            success: true,
            code,
            tier
        };
    }

    /**
     * Cancel premium subscription
     */
    async cancelPremium(userId) {
        await db.cancelPremium(userId);
        return { success: true };
    }

    /**
     * Get pricing information
     */
    getPricing() {
        return Object.entries(this.tiers).map(([id, tier]) => ({
            id,
            name: tier.name,
            price: tier.price,
            features: Object.entries(tier.features)
                .filter(([key, value]) => value === true && this.featureInfo[key])
                .map(([key]) => ({
                    id: key,
                    ...this.featureInfo[key]
                }))
        }));
    }

    /**
     * Get feature comparison for pricing page
     */
    getFeatureComparison() {
        const features = Object.keys(this.featureInfo);
        return features.map(featureId => ({
            id: featureId,
            ...this.featureInfo[featureId],
            free: this.tiers.free.features[featureId] || false,
            pro: this.tiers.pro.features[featureId] || false,
            enterprise: this.tiers.enterprise.features[featureId] || false
        }));
    }
}

// Singleton instance
const premiumManager = new PremiumManager();

module.exports = premiumManager;
module.exports.PREMIUM_TIERS = PREMIUM_TIERS;
module.exports.FEATURE_INFO = FEATURE_INFO;
module.exports.LOCKED_SETTINGS = LOCKED_SETTINGS;
