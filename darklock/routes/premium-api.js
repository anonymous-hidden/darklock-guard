/**
 * Darklock Premium API Routes
 * Handles Stripe payments, license redemption, and premium status
 */

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const premiumManager = require('../utils/premium');
const db = require('../utils/database');
const emailService = require('../utils/email');

// Import requireAuth from dashboard routes
const { requireAuth } = require('./dashboard');

/**
 * Get current user's premium status
 */
router.get('/status', requireAuth, async (req, res) => {
    try {
        const status = await premiumManager.getPremiumStatus(req.user.id);
        res.json(status);
    } catch (error) {
        console.error('[Premium] Error getting status:', error);
        res.status(500).json({ error: 'Failed to get premium status' });
    }
});

/**
 * Get pricing information
 */
router.get('/pricing', async (req, res) => {
    try {
        const pricing = premiumManager.getPricing();
        const comparison = premiumManager.getFeatureComparison();
        res.json({ pricing, comparison });
    } catch (error) {
        console.error('[Premium] Error getting pricing:', error);
        res.status(500).json({ error: 'Failed to get pricing' });
    }
});

/**
 * Create Stripe checkout session
 */
router.post('/create-checkout', requireAuth, async (req, res) => {
    try {
        const { tier } = req.body;
        
        if (!tier || !['pro', 'enterprise'].includes(tier)) {
            return res.status(400).json({ error: 'Invalid tier' });
        }

        const tierConfig = premiumManager.tiers[tier];
        if (!tierConfig || !tierConfig.stripePriceId) {
            return res.status(400).json({ error: 'Tier not available' });
        }

        // Create or get Stripe customer
        let customerId;
        const premium = await db.getUserPremium(req.user.id);
        
        if (premium && premium.stripe_customer_id) {
            customerId = premium.stripe_customer_id;
        } else {
            const customer = await stripe.customers.create({
                email: req.user.email,
                metadata: {
                    userId: req.user.id.toString(),
                    username: req.user.username
                }
            });
            customerId = customer.id;
        }

        // Create checkout session
        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [{
                price: tierConfig.stripePriceId,
                quantity: 1
            }],
            mode: 'payment', // One-time payment (not subscription)
            success_url: `${process.env.APP_URL || 'http://localhost:5001'}/platform/premium-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.APP_URL || 'http://localhost:5001'}/platform/dashboard?payment=cancelled`,
            metadata: {
                userId: req.user.id.toString(),
                tier: tier,
                username: req.user.username,
                email: req.user.email
            }
        });

        res.json({ sessionId: session.id, url: session.url });
    } catch (error) {
        console.error('[Premium] Error creating checkout:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

/**
 * Premium success page (NO AUTH REQUIRED - handles Stripe redirects)
 * This page will activate premium and show the license code
 */
router.get('/success', async (req, res) => {
    try {
        const { session_id } = req.query;
        
        console.log('[Premium] Success page hit with session_id:', session_id);
        
        if (!session_id) {
            console.log('[Premium] No session_id provided');
            return res.redirect('/platform/dashboard?error=missing_session');
        }

        // Retrieve session from Stripe
        const session = await stripe.checkout.sessions.retrieve(session_id);
        
        console.log('[Premium] Session retrieved:', {
            status: session.payment_status,
            userId: session.metadata.userId,
            tier: session.metadata.tier
        });
        
        if (!session || session.payment_status !== 'paid') {
            console.log('[Premium] Payment not completed');
            return res.redirect('/platform/dashboard?error=payment_incomplete');
        }

        const userId = parseInt(session.metadata.userId);
        const tier = session.metadata.tier;
        const email = session.metadata.email;
        const username = session.metadata.username;

        // Check if already activated
        let licenseCode;
        const existingPremium = await db.getUserPremium(userId);
        
        if (existingPremium && existingPremium.tier === tier && existingPremium.payment_id === session.payment_intent) {
            // Already activated
            licenseCode = existingPremium.license_code;
            console.log(`[Premium] Already activated for user ${userId}`);
        } else {
            // Activate premium immediately
            console.log(`[Premium] Activating premium for user ${userId} (tier: ${tier})`);
            
            licenseCode = premiumManager.generateLicenseCode();
            
            // Activate premium
            await premiumManager.activatePremium(userId, tier, {
                licenseCode,
                stripeCustomerId: session.customer,
                stripePaymentIntent: session.payment_intent,
                expiresAt: null // Lifetime
            });

            // Record payment
            await db.recordPayment({
                userId,
                tier,
                amount: session.amount_total / 100, // Convert from cents
                currency: session.currency,
                stripeSessionId: session.id,
                stripePaymentIntent: session.payment_intent,
                status: 'completed'
            });

            // Send confirmation email
            try {
                await sendPremiumConfirmationEmail(email, username, tier, licenseCode);
                console.log(`[Premium] Confirmation email sent to ${email}`);
            } catch (emailError) {
                console.error('[Premium] Failed to send confirmation email:', emailError);
            }
        }

        // Render success page with license code
        console.log('[Premium] Rendering success page with license code:', licenseCode);
        res.send(renderSuccessPage(tier, licenseCode, username));
    } catch (error) {
        console.error('[Premium] Error processing payment success:', error);
        console.error('[Premium] Error stack:', error.stack);
        
        // Send error page instead of redirect so user can see what happened
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Payment Error</title></head>
            <body style="font-family: Arial; padding: 40px; text-align: center;">
                <h1>⚠️ Payment Processing Error</h1>
                <p>Your payment was received, but there was an error activating your premium account.</p>
                <p>Error: ${error.message}</p>
                <p>Please contact support with this error message.</p>
                <a href="/platform/dashboard" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #6366f1; color: white; text-decoration: none; border-radius: 5px;">Go to Dashboard</a>
            </body>
            </html>
        `);
    }
});

/**
 * Verify session API (for AJAX calls from dashboard)
 */
router.get('/verify-session', async (req, res) => {
    try {
        const { session_id } = req.query;
        
        if (!session_id) {
            return res.status(400).json({ error: 'Missing session ID' });
        }

        // Retrieve session from Stripe
        const session = await stripe.checkout.sessions.retrieve(session_id);
        
        if (!session || session.payment_status !== 'paid') {
            return res.json({ success: false, message: 'Payment not completed' });
        }

        const userId = parseInt(session.metadata.userId);
        
        // Get updated premium status
        const status = await premiumManager.getPremiumStatus(userId);

        res.json({
            success: true,
            premium: status
        });
    } catch (error) {
        console.error('[Premium] Error verifying session:', error);
        res.status(500).json({ error: 'Failed to verify session' });
    }
});

/**
 * Redeem license code
 */
router.post('/redeem', requireAuth, async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code || typeof code !== 'string') {
            return res.status(400).json({ error: 'Invalid license code' });
        }

        const result = await premiumManager.redeemCode(req.user.id, code.trim().toUpperCase());
        
        if (result.success) {
            res.json({
                success: true,
                tier: result.tier,
                message: `Premium ${result.tierName} activated!`
            });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('[Premium] Error redeeming code:', error);
        res.status(500).json({ error: 'Failed to redeem code' });
    }
});

/**
 * Stripe webhook handler
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('[Premium] Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                
                if (session.payment_status === 'paid') {
                    const userId = parseInt(session.metadata.userId);
                    const tier = session.metadata.tier;

                    console.log(`[Premium] Webhook: Payment completed for user ${userId} (tier: ${tier})`);

                    // Check if already activated (by success page)
                    const existing = await db.getUserPremium(userId);
                    if (existing && existing.payment_id === session.payment_intent) {
                        console.log('[Premium] Webhook: Premium already activated');
                        break;
                    }

                    // Activate premium (backup in case success page failed)
                    const licenseCode = premiumManager.generateLicenseCode();
                    
                    await premiumManager.activatePremium(userId, tier, {
                        licenseCode,
                        stripeCustomerId: session.customer,
                        stripePaymentIntent: session.payment_intent,
                        expiresAt: null
                    });

                    // Record payment
                    await db.recordPayment({
                        userId,
                        tier,
                        amount: session.amount_total / 100,
                        currency: session.currency,
                        stripeSessionId: session.id,
                        stripePaymentIntent: session.payment_intent,
                        status: 'completed'
                    });

                    console.log(`[Premium] Webhook: Premium activated for user ${userId}`);
                }
                break;
            }

            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object;
                console.log(`[Premium] Webhook: Payment failed:`, paymentIntent.id);
                break;
            }

            default:
                console.log(`[Premium] Webhook: Unhandled event type ${event.type}`);
        }

        res.json({ received: true });
    } catch (error) {
        console.error('[Premium] Webhook handler error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

/**
 * Cancel premium (for future subscription support)
 */
router.post('/cancel', requireAuth, async (req, res) => {
    try {
        await premiumManager.cancelPremium(req.user.id);
        res.json({ success: true, message: 'Premium cancelled' });
    } catch (error) {
        console.error('[Premium] Error cancelling:', error);
        res.status(500).json({ error: 'Failed to cancel premium' });
    }
});

/**
 * Render success page HTML
 */
function renderSuccessPage(tier, licenseCode, username) {
    const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Successful - Darklock ${tierName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 600px;
            width: 100%;
            overflow: hidden;
            animation: slideUp 0.5s ease-out;
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .header {
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }
        .success-icon {
            font-size: 64px;
            animation: checkmark 0.6s ease-out;
        }
        @keyframes checkmark {
            0% { transform: scale(0) rotate(-45deg); }
            50% { transform: scale(1.1) rotate(-45deg); }
            100% { transform: scale(1) rotate(0); }
        }
        .header h1 {
            font-size: 32px;
            margin: 20px 0 10px;
        }
        .header p {
            font-size: 18px;
            opacity: 0.9;
        }
        .content {
            padding: 40px;
        }
        .license-box {
            background: #f8f9fa;
            border: 2px dashed #6366f1;
            border-radius: 12px;
            padding: 30px;
            text-align: center;
            margin: 30px 0;
        }
        .license-label {
            font-size: 14px;
            color: #666;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .license-code {
            font-size: 32px;
            font-weight: bold;
            color: #6366f1;
            letter-spacing: 3px;
            font-family: 'Courier New', monospace;
            padding: 15px;
            background: white;
            border-radius: 8px;
            user-select: all;
            cursor: pointer;
        }
        .license-code:hover {
            background: #f0f0f0;
        }
        .copy-hint {
            font-size: 12px;
            color: #999;
            margin-top: 10px;
        }
        .info-box {
            background: #e8f5e9;
            border-left: 4px solid #4caf50;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
        }
        .info-box p {
            color: #2e7d32;
            line-height: 1.6;
        }
        .btn-primary {
            display: inline-block;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            color: white;
            padding: 16px 40px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 16px;
            margin: 20px 10px 10px;
            transition: transform 0.2s, box-shadow 0.2s;
            border: none;
            cursor: pointer;
        }
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(99, 102, 241, 0.3);
        }
        .features {
            margin: 30px 0;
        }
        .features h3 {
            color: #333;
            margin-bottom: 15px;
        }
        .feature-list {
            list-style: none;
            padding: 0;
        }
        .feature-list li {
            padding: 10px 0;
            padding-left: 30px;
            position: relative;
            color: #555;
        }
        .feature-list li:before {
            content: '✓';
            position: absolute;
            left: 0;
            color: #4caf50;
            font-weight: bold;
            font-size: 18px;
        }
        .footer {
            background: #f8f9fa;
            padding: 20px 40px;
            text-align: center;
            color: #666;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="success-icon">🎉</div>
            <h1>Payment Successful!</h1>
            <p>Welcome to Darklock ${tierName}, ${username}!</p>
        </div>
        
        <div class="content">
            <div class="info-box">
                <p><strong>✓ Your payment has been processed successfully</strong></p>
                <p>An email confirmation with your license code has been sent to your email address.</p>
            </div>
            
            <div class="license-box">
                <div class="license-label">Your License Code</div>
                <div class="license-code" onclick="copyLicense()" id="licenseCode">${licenseCode}</div>
                <div class="copy-hint">Click to copy</div>
            </div>
            
            <div class="features">
                <h3>🚀 What's Now Unlocked:</h3>
                <ul class="feature-list">
                    ${tier === 'pro' ? `
                        <li>Custom theme support</li>
                        <li>Advanced analytics dashboard</li>
                        <li>Full API access</li>
                        <li>Advanced anti-raid protection</li>
                        <li>Custom bot commands</li>
                        <li>Priority support</li>
                        <li>Up to 10 simultaneous sessions</li>
                    ` : `
                        <li>Everything in Pro</li>
                        <li>Custom branding</li>
                        <li>Data export tools</li>
                        <li>Unlimited servers</li>
                        <li>Beta features access</li>
                        <li>Enterprise support</li>
                        <li>Unlimited sessions</li>
                    `}
                </ul>
            </div>
            
            <div style="text-align: center;">
                <a href="/platform/auth/login?premium_activated=true" class="btn-primary">Go to Dashboard →</a>
            </div>
            
            <p style="color: #666; font-size: 14px; margin-top: 30px; text-align: center;">
                Save your license code in a safe place. You can use it to redeem your premium access if needed.
            </p>
        </div>
        
        <div class="footer">
            <p>Thank you for supporting Darklock! 🙏</p>
            <p>Questions? Contact our support team anytime.</p>
        </div>
    </div>
    
    <script>
        function copyLicense() {
            const code = document.getElementById('licenseCode').textContent;
            navigator.clipboard.writeText(code).then(() => {
                const elem = document.getElementById('licenseCode');
                const original = elem.style.background;
                elem.style.background = '#4caf50';
                elem.style.color = 'white';
                setTimeout(() => {
                    elem.style.background = original;
                    elem.style.color = '#6366f1';
                }, 300);
            });
        }
        
        // Auto-redirect to dashboard after 10 seconds
        setTimeout(() => {
            window.location.href = '/platform/auth/login?premium_activated=true';
        }, 10000);
    </script>
</body>
</html>`;
}

/**
 * Send premium confirmation email
 */
async function sendPremiumConfirmationEmail(email, username, tier, licenseCode) {
    const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
    
    const subject = `🎉 Welcome to Darklock ${tierName}!`;
    
    const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f4f4f4; }
        .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 0 20px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 40px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { padding: 40px 30px; }
        .license-box { background: #f8f9fa; border: 2px dashed #6366f1; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
        .license-code { font-size: 24px; font-weight: bold; color: #6366f1; letter-spacing: 2px; font-family: 'Courier New', monospace; }
        .features { background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .features h3 { margin-top: 0; color: #6366f1; }
        .features ul { margin: 0; padding-left: 20px; }
        .features li { margin: 8px 0; }
        .cta-button { display: inline-block; background: #6366f1; color: white; padding: 14px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: bold; }
        .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎉 Welcome to Darklock ${tierName}!</h1>
        </div>
        
        <div class="content">
            <p>Hey ${username},</p>
            
            <p>Thank you for upgrading to <strong>Darklock ${tierName}</strong>! Your account has been activated and all premium features are now unlocked.</p>
            
            <div class="license-box">
                <p style="margin: 0 0 10px 0; color: #666;">Your License Code:</p>
                <div class="license-code">${licenseCode}</div>
                <p style="margin: 10px 0 0 0; font-size: 12px; color: #666;">Keep this code safe for your records</p>
            </div>
            
            <div class="features">
                <h3>🚀 What's Unlocked:</h3>
                <ul>
                    ${tier === 'pro' ? `
                        <li>✨ Custom theme support</li>
                        <li>📊 Advanced analytics dashboard</li>
                        <li>🔌 Full API access</li>
                        <li>🛡️ Advanced anti-raid protection</li>
                        <li>⚡ Custom bot commands</li>
                        <li>🎯 Priority support</li>
                        <li>🔓 Up to 10 simultaneous sessions</li>
                    ` : `
                        <li>✨ Everything in Pro</li>
                        <li>🏢 Custom branding</li>
                        <li>📥 Data export tools</li>
                        <li>🌐 Unlimited servers</li>
                        <li>🧪 Beta features access</li>
                        <li>⚡ Enterprise support</li>
                        <li>🔓 Unlimited sessions</li>
                    `}
                </ul>
            </div>
            
            <p style="text-align: center;">
                <a href="${process.env.APP_URL || 'http://localhost:5001'}/platform/dashboard" class="cta-button">
                    Go to Dashboard →
                </a>
            </p>
            
            <p>Your premium features are active immediately. Log into your dashboard to start using them!</p>
            
            <p>If you have any questions or need assistance, our support team is here to help.</p>
            
            <p>Thanks for supporting Darklock! 🙏</p>
            
            <p>Best regards,<br><strong>The Darklock Team</strong></p>
        </div>
        
        <div class="footer">
            <p>© ${new Date().getFullYear()} Darklock Security Suite. All rights reserved.</p>
            <p>This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
    `;

    await emailService.send(email, subject, html);
}

module.exports = router;
