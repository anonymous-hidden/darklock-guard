/**
 * Darklock Premium Client-Side JavaScript
 * Handles premium UI updates, Stripe checkout, and license redemption
 */

// Premium state
let premiumStatus = {
    tier: 'free',
    isPremium: false,
    features: {},
    lockedSettings: [],
    licenseCode: null
};

// Stripe publishable key
const STRIPE_KEY = 'pk_test_51SXAqORvlraeSG12Gpcj1fdq0ZjAydaggaORKe676HeTVySp34WsLfN0epNmxFQDu9n7lbTm23Nu7l64phP5P9z800uS1ISgLr';
let stripeInstance = null;

/**
 * Initialize premium system
 */
async function initPremium() {
    try {
        // Load Stripe.js if not already loaded
        if (!window.Stripe && STRIPE_KEY) {
            await loadStripeJs();
        }
        if (window.Stripe && STRIPE_KEY) {
            stripeInstance = window.Stripe(STRIPE_KEY);
        }

        // Fetch premium status
        await fetchPremiumStatus();

        // Apply premium locks to settings
        applyPremiumLocks();

        // Update premium UI
        updatePremiumUI();

        // Check for payment success in URL
        checkPaymentResult();

    } catch (err) {
        console.error('[Premium] Initialization error:', err);
    }
}

/**
 * Load Stripe.js dynamically
 */
function loadStripeJs() {
    return new Promise((resolve, reject) => {
        if (window.Stripe) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://js.stripe.com/v3/';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

/**
 * Fetch premium status from server
 */
async function fetchPremiumStatus() {
    try {
        const response = await fetch('/platform/premium/status', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            console.warn('[Premium] Status endpoint not available');
            return;
        }

        const data = await response.json();
        if (data.success) {
            premiumStatus = {
                tier: data.premium.tier,
                tierName: data.premium.tierName,
                isPremium: data.premium.isPremium,
                features: data.premium.features,
                expiresAt: data.premium.expiresAt,
                licenseCode: data.premium.licenseCode,
                lockedSettings: data.lockedSettings || []
            };
        }
    } catch (err) {
        console.warn('[Premium] Error fetching status:', err);
    }
}

/**
 * Update all premium-related UI elements
 */
function updatePremiumUI() {
    // Update nav badge
    const navBadge = document.getElementById('premiumNavBadge');
    if (navBadge) {
        if (premiumStatus.isPremium) {
            navBadge.textContent = premiumStatus.tierName.toUpperCase();
            navBadge.className = `premium-badge ${premiumStatus.tier}`;
            navBadge.style.display = 'inline-flex';
        } else {
            navBadge.style.display = 'none';
        }
    }

    // Update current plan card
    const currentPlanCard = document.getElementById('currentPlanCard');
    const currentPlanName = document.getElementById('currentPlanName');
    const currentPlanBadge = document.getElementById('currentPlanBadge');
    
    if (currentPlanName) {
        currentPlanName.textContent = premiumStatus.tierName || 'Free';
    }

    if (currentPlanBadge) {
        currentPlanBadge.textContent = premiumStatus.tierName?.toUpperCase() || 'FREE';
        currentPlanBadge.className = `premium-badge ${premiumStatus.tier}`;
        currentPlanBadge.style.display = 'inline-flex';
    }

    if (currentPlanCard && premiumStatus.isPremium) {
        currentPlanCard.classList.add('premium');
    }

    // Update license display
    const licenseDisplay = document.getElementById('licenseDisplay');
    const userLicenseCode = document.getElementById('userLicenseCode');
    if (licenseDisplay && premiumStatus.licenseCode) {
        licenseDisplay.style.display = 'flex';
        if (userLicenseCode) {
            userLicenseCode.textContent = premiumStatus.licenseCode;
        }
    }

    // Update plan expiry
    const planExpiry = document.getElementById('planExpiry');
    const planExpiryDate = document.getElementById('planExpiryDate');
    if (planExpiry && premiumStatus.expiresAt) {
        planExpiry.style.display = 'block';
        if (planExpiryDate) {
            planExpiryDate.textContent = new Date(premiumStatus.expiresAt).toLocaleDateString();
        }
    }

    // Only update pricing elements if they exist (premium page)
    if (document.querySelector('.pricing-card')) {
        updatePricingButtons();
        updateCurrentPlanFeatures();
        loadPaymentHistory();
    }
}

/**
 * Update pricing card buttons based on current tier
 */
function updatePricingButtons() {
    document.querySelectorAll('.pricing-card').forEach(card => {
        const tier = card.dataset.tier;
        const button = card.querySelector('.btn-select-plan');
        
        if (!button) return;

        if (tier === premiumStatus.tier) {
            button.textContent = 'Current Plan';
            button.disabled = true;
            button.className = 'btn-select-plan btn-ghost';
        } else if (tier === 'free') {
            button.textContent = 'Current Plan';
            button.disabled = !premiumStatus.isPremium;
        } else if (premiumStatus.isPremium) {
            // Already has premium
            if (tier === 'pro' && premiumStatus.tier === 'enterprise') {
                button.textContent = 'Downgrade';
                button.disabled = true;
            } else if (tier === 'enterprise' && premiumStatus.tier === 'pro') {
                button.textContent = 'Upgrade to Enterprise';
                button.disabled = false;
            }
        }
    });
}

/**
 * Update the current plan features list
 */
function updateCurrentPlanFeatures() {
    const featuresContainer = document.getElementById('currentPlanFeatures');
    if (!featuresContainer) return;

    const featuresList = [
        { key: 'basicDashboard', name: 'Basic Dashboard', icon: 'layout' },
        { key: 'customTheme', name: 'Custom Themes', icon: 'palette' },
        { key: 'advancedAnalytics', name: 'Advanced Analytics', icon: 'chart' },
        { key: 'prioritySupport', name: 'Priority Support', icon: 'headset' },
        { key: 'apiAccess', name: 'API Access', icon: 'code' },
        { key: 'multipleDevices', name: 'Multiple Devices', icon: 'devices' },
        { key: 'betaFeatures', name: 'Beta Features', icon: 'flask' }
    ];

    featuresContainer.innerHTML = featuresList.map(feature => {
        const hasFeature = premiumStatus.features[feature.key];
        return `
            <div class="plan-feature ${hasFeature ? '' : 'locked'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${hasFeature 
                        ? '<polyline points="20 6 9 17 4 12"/>'
                        : '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'}
                </svg>
                <span>${feature.name}</span>
            </div>
        `;
    }).join('');
}

/**
 * Apply premium locks to settings
 */
function applyPremiumLocks() {
    if (premiumStatus.isPremium) {
        // Remove all locks for premium users
        document.querySelectorAll('.setting-item.premium-locked').forEach(item => {
            item.classList.remove('premium-locked');
            const lock = item.querySelector('.premium-lock');
            if (lock) lock.remove();
        });
        return;
    }

    // Settings that should be locked for free users
    const lockedSettingIds = [
        'pushNotificationsToggle',
        'betaFeaturesToggle',
        'customBranding',
        'sessionTimeoutSelect'
    ];

    lockedSettingIds.forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;

        const settingItem = element.closest('.setting-item');
        if (!settingItem || settingItem.classList.contains('premium-locked')) return;

        // Add locked class
        settingItem.classList.add('premium-locked');

        // Add lock icon
        const titleElement = settingItem.querySelector('.setting-title');
        if (titleElement && !titleElement.querySelector('.premium-lock')) {
            const lockIcon = document.createElement('span');
            lockIcon.className = 'premium-lock';
            lockIcon.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
                <span class="premium-tooltip">Premium feature - Upgrade to unlock</span>
            `;
            lockIcon.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateTo('premium');
            };
            titleElement.appendChild(lockIcon);
        }
    });

    // Add upgrade banner in settings
    addUpgradeBanner();
}

/**
 * Add upgrade banner to settings page
 */
function addUpgradeBanner() {
    if (premiumStatus.isPremium) return;

    const settingsPage = document.getElementById('page-settings');
    if (!settingsPage) return;

    // Check if banner already exists
    if (settingsPage.querySelector('.premium-upgrade-banner')) return;

    const banner = document.createElement('div');
    banner.className = 'premium-upgrade-banner';
    banner.innerHTML = `
        <div class="banner-content">
            <div class="banner-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
            </div>
            <div class="banner-text">
                <h4>Unlock Premium Features</h4>
                <p>Get access to custom themes, advanced analytics, and more!</p>
            </div>
        </div>
        <a href="#" class="btn-upgrade" onclick="navigateTo('premium'); return false;">
            Upgrade Now
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
            </svg>
        </a>
    `;

    // Insert after page header
    const pageHeader = settingsPage.querySelector('.page-header');
    if (pageHeader && pageHeader.nextSibling) {
        pageHeader.parentNode.insertBefore(banner, pageHeader.nextSibling);
    }
}

/**
 * Load payment history
 */
async function loadPaymentHistory() {
    const historyList = document.getElementById('historyList');
    const noHistory = document.getElementById('noPaymentHistory');
    
    if (!historyList) return;

    try {
        const response = await fetch('/platform/premium/history', {
            credentials: 'include'
        });
        
        if (!response.ok) return;

        const data = await response.json();
        if (data.success && data.payments && data.payments.length > 0) {
            if (noHistory) noHistory.style.display = 'none';
            
            historyList.innerHTML = data.payments.map(payment => `
                <div class="history-item">
                    <div class="item-info">
                        <div class="item-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        </div>
                        <div class="item-details">
                            <h4>${payment.tier.charAt(0).toUpperCase() + payment.tier.slice(1)} Plan</h4>
                            <p>${new Date(payment.created_at).toLocaleDateString()} • ${payment.license_code || 'N/A'}</p>
                        </div>
                    </div>
                    <div class="item-amount">$${(payment.amount / 100).toFixed(2)}</div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('[Premium] Error loading payment history:', err);
    }
}

/**
 * Select a plan and initiate Stripe checkout
 */
async function selectPlan(tier) {
    if (tier === 'free' || tier === premiumStatus.tier) return;

    // Show loading state
    const button = document.querySelector(`.pricing-card[data-tier="${tier}"] .btn-select-plan`);
    const originalText = button.textContent;
    button.textContent = 'Processing...';
    button.disabled = true;

    try {
        const response = await fetch('/platform/premium/create-checkout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ tier })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to create checkout session');
        }

        // Redirect to Stripe Checkout
        if (data.url) {
            window.location.href = data.url;
        } else if (stripeInstance && data.sessionId) {
            const { error } = await stripeInstance.redirectToCheckout({
                sessionId: data.sessionId
            });
            if (error) throw error;
        }

    } catch (err) {
        console.error('[Premium] Checkout error:', err);
        showToast(err.message || 'Failed to start checkout', 'error');
        
        // Reset button
        button.textContent = originalText;
        button.disabled = false;
    }
}

/**
 * Redeem a license code
 */
async function redeemLicenseCode(event) {
    event.preventDefault();

    const input = document.getElementById('licenseCodeInput');
    const resultDiv = document.getElementById('redeemResult');
    const code = input.value.trim();

    if (!code) {
        showRedeemResult('Please enter a license code', 'error');
        return;
    }

    // Show loading
    const button = document.querySelector('#redeemForm button');
    const originalText = button.textContent;
    button.textContent = 'Redeeming...';
    button.disabled = true;

    try {
        const response = await fetch('/platform/premium/redeem', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ code })
        });

        const data = await response.json();

        if (data.success) {
            showRedeemResult(`🎉 ${data.message}`, 'success');
            input.value = '';
            
            // Update premium status
            if (data.premium) {
                premiumStatus = {
                    ...premiumStatus,
                    ...data.premium
                };
                updatePremiumUI();
                applyPremiumLocks();
            }

            // Show celebration
            showToast('Premium unlocked! 🎉', 'success');
        } else {
            showRedeemResult(data.error || 'Failed to redeem code', 'error');
        }
    } catch (err) {
        console.error('[Premium] Redeem error:', err);
        showRedeemResult('An error occurred. Please try again.', 'error');
    } finally {
        button.textContent = originalText;
        button.disabled = false;
    }
}

/**
 * Show redeem result message
 */
function showRedeemResult(message, type) {
    const resultDiv = document.getElementById('redeemResult');
    if (!resultDiv) return;

    resultDiv.style.display = 'block';
    resultDiv.style.padding = '12px 16px';
    resultDiv.style.borderRadius = '8px';
    resultDiv.style.fontSize = '14px';

    if (type === 'success') {
        resultDiv.style.background = 'rgba(16, 185, 129, 0.1)';
        resultDiv.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        resultDiv.style.color = '#10b981';
    } else {
        resultDiv.style.background = 'rgba(239, 68, 68, 0.1)';
        resultDiv.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        resultDiv.style.color = '#ef4444';
    }

    resultDiv.textContent = message;

    // Auto-hide after 5 seconds
    setTimeout(() => {
        resultDiv.style.display = 'none';
    }, 5000);
}

/**
 * Copy license code to clipboard
 */
function copyLicenseCode() {
    const code = document.getElementById('userLicenseCode')?.textContent;
    if (!code) return;

    navigator.clipboard.writeText(code).then(() => {
        showToast('License code copied!', 'success');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
}

/**
 * Check for payment result in URL params
 */
function checkPaymentResult() {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const sessionId = params.get('session_id');

    if (payment === 'success') {
        showToast('🎉 Payment successful! Your premium features are now active.', 'success');
        
        // Verify the session and update UI
        if (sessionId) {
            verifyPaymentSession(sessionId);
        }

        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Navigate to premium page
        setTimeout(() => navigateTo('premium'), 500);
    } else if (payment === 'cancelled') {
        showToast('Payment was cancelled', 'info');
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

/**
 * Verify payment session
 */
async function verifyPaymentSession(sessionId) {
    try {
        const response = await fetch(`/platform/premium/verify-session?session_id=${sessionId}`, {
            credentials: 'include'
        });
        
        const data = await response.json();
        if (data.success && data.premium) {
            premiumStatus = {
                ...premiumStatus,
                ...data.premium
            };
            updatePremiumUI();
            applyPremiumLocks();
        }
    } catch (err) {
        console.error('[Premium] Session verification error:', err);
    }
}

/**
 * Format license code input
 */
document.addEventListener('DOMContentLoaded', () => {
    const licenseInput = document.getElementById('licenseCodeInput');
    if (licenseInput) {
        licenseInput.addEventListener('input', (e) => {
            let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            
            // Format as DRKL-XXXX-XXXX-XXXX
            if (value.length > 0) {
                const parts = [];
                if (value.length >= 4) {
                    parts.push(value.substring(0, 4));
                    value = value.substring(4);
                } else {
                    parts.push(value);
                    value = '';
                }
                
                while (value.length > 0) {
                    parts.push(value.substring(0, 4));
                    value = value.substring(4);
                }
                
                e.target.value = parts.join('-');
            }
        });
    }
});

// Export functions for global access
window.selectPlan = selectPlan;
window.redeemLicenseCode = redeemLicenseCode;
window.copyLicenseCode = copyLicenseCode;
window.initPremium = initPremium;
