/**
 * Billing Routes
 * Handles Stripe integration, subscriptions, and payment management
 */

const express = require('express');

/**
 * Create billing routes
 * @param {Object} dashboard - Dashboard instance
 */
function createBillingRoutes(dashboard) {
    const router = express.Router();
    const authenticateToken = dashboard.authenticateToken.bind(dashboard);
    const validateCSRF = dashboard.validateCSRF.bind(dashboard);

    /**
     * Get subscription status for a guild
     */
    router.get('/guilds/:guildId/subscription', authenticateToken, async (req, res) => {
        try {
            const { guildId } = req.params;
            
            // Check guild access
            const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'No access to this guild' });
            }

            const subscription = await dashboard.getGuildSubscription(guildId);
            res.json(subscription || { status: 'none', tier: 'free' });
        } catch (error) {
            dashboard.bot.logger?.error('[Billing] Failed to get subscription:', error);
            res.status(500).json({ error: 'Failed to retrieve subscription status' });
        }
    });

    /**
     * Get available subscription plans
     */
    router.get('/billing/plans', authenticateToken, (req, res) => {
        const plans = [
            {
                id: 'free',
                name: 'Free',
                price: 0,
                priceLabel: '$0',
                interval: null,
                features: [
                    'Basic moderation',
                    'Standard anti-spam',
                    'Anti-raid detection',
                    'Welcome messages'
                ]
            },
            {
                id: 'pro',
                name: 'Pro',
                price: null,
                priceLabel: 'Shown in Stripe Checkout',
                interval: null,
                stripePriceConfigured: Boolean(dashboard.billingConfig?.proPriceId),
                features: [
                    'Pro-gated bot commands',
                    'Anti-nuke and webhook protection commands',
                    'Anti-phishing and automod command access',
                    'Server backup and analytics commands',
                    'Guild subscription synced from Stripe webhooks'
                ]
            }
        ];

        res.json({ plans });
    });

    /**
     * Get Stripe customer portal URL
     */
    router.post('/billing/portal', authenticateToken, validateCSRF, async (req, res) => {
        try {
            const portalUrl = await dashboard.createCustomerPortalSession(req.user.userId);
            res.json({ url: portalUrl });
        } catch (error) {
            dashboard.bot.logger?.error('[Billing] Portal session failed:', error);
            res.status(500).json({ error: 'Failed to create portal session' });
        }
    });

    /**
     * Create checkout session for subscription
     */
    router.post('/billing/checkout', authenticateToken, validateCSRF, async (req, res) => {
        try {
            const { guildId, planId } = req.body;

            if (!guildId || !planId) {
                return res.status(400).json({ error: 'Guild ID and plan ID required' });
            }

            if (String(planId).toLowerCase() !== 'pro') {
                return res.status(400).json({ error: 'Only the Pro plan is available for checkout' });
            }

            const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'No access to this guild' });
            }

            const session = await dashboard.createCheckoutSession({
                userId: req.user.userId,
                guildId,
                planId
            });

            res.json({ sessionId: session.id, url: session.url });
        } catch (error) {
            dashboard.bot.logger?.error('[Billing] Checkout failed:', error);
            res.status(500).json({ error: 'Failed to create checkout session' });
        }
    });

    /**
     * Cancel subscription
     */
    router.post('/billing/cancel', authenticateToken, validateCSRF, async (req, res) => {
        try {
            const { guildId } = req.body;

            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID required' });
            }

            const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'No access to this guild' });
            }

            await dashboard.cancelSubscription(guildId);
            res.json({ success: true, message: 'Subscription cancelled' });
        } catch (error) {
            dashboard.bot.logger?.error('[Billing] Cancel failed:', error);
            res.status(500).json({ error: 'Failed to cancel subscription' });
        }
    });

    /**
     * Get billing history
     */
    router.get('/billing/history', authenticateToken, async (req, res) => {
        try {
            const { guildId } = req.query;
            
            if (guildId) {
                const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
                if (!hasAccess) {
                    return res.status(403).json({ error: 'No access to this guild' });
                }
            }

            const history = await dashboard.getBillingHistory(req.user.userId, guildId);
            res.json({ history: history || [] });
        } catch (error) {
            dashboard.bot.logger?.error('[Billing] History fetch failed:', error);
            res.status(500).json({ error: 'Failed to retrieve billing history' });
        }
    });

    return router;
}

module.exports = createBillingRoutes;
