/**
 * Premium Feature Gating System for DarkLock Dashboard
 * Handles premium/free tier feature visibility and access control
 */

// Premium tier definitions
const PREMIUM_TIERS = {
    free: {
        name: 'Free',
        features: [
            // FAIR MODEL: Most features are FREE
            'dashboard',           // Dashboard view
            'tickets',             // Full ticket system - FREE
            'analytics-basic',     // Analytics - FREE
            'analytics-advanced',  // Advanced analytics - FREE
            'logs-basic',          // Logs - FREE
            'logs-full',           // Full log history - FREE
            'welcome-basic',       // Welcome messages - FREE
            'custom-welcome',      // Custom welcome - FREE
            'help',                // Help & commands - FREE
            'anti-raid-basic',     // Anti-raid - FREE
            // Advanced anti-raid is premium
            'anti-spam-basic',     // Anti-spam - FREE
            // Advanced anti-spam is premium
            'anti-nuke',           // Anti-nuke - FREE
            // Anti-phishing is premium
            // Advanced moderation is premium
            'verification',        // Verification - FREE
            // Auto role is premium
            'backup',              // Backups - FREE
            'audit-log',           // Audit log - FREE
        ]
    },
    premium: {
        name: 'Premium',
        features: [
            // Premium-only advanced features:
            'console',             // Bot console access
            'access-generator',    // Access code generator
            'access-share',        // Access sharing
            'ai-features',         // AI-powered features
            'anti-phishing',       // Anti-phishing
            'autorole',            // Auto role & reaction roles
            'anti-raid-advanced',  // Advanced anti-raid settings
            'anti-spam-advanced',  // Advanced anti-spam settings
            'anti-nuke-advanced',  // Advanced anti-nuke settings
            'moderation-advanced', // Advanced moderation tools
            'tickets-advanced',    // Advanced ticket settings
            'welcome-advanced',    // Advanced welcome/goodbye options
            'verification-advanced', // Advanced verification options
            'api-access',          // API access
            'priority-support',    // Priority support
        ]
    }
};

// Feature to navigation mapping
const FEATURE_NAV_MAP = {
    'tickets': '/tickets',
    'analytics-advanced': '/analytics',
    'logs-full': '/dashboard/logs',
    'anti-raid-basic': '/setup/anti-raid',
    'anti-raid-advanced': '/setup/anti-raid',
    'anti-spam-basic': '/setup/anti-spam',
    'anti-spam-advanced': '/setup/anti-spam',
    'anti-nuke': '/setup/antinuke',
    'anti-phishing': '/setup/anti-phishing',
    'moderation-advanced': '/setup/moderation',
    'verification': '/setup/verification',
    'autorole': '/setup/autorole',
    'console': '/dashboard/console',
    'access-generator': '/access-generator',
    'access-share': '/access-share',
    'welcome-basic': '/setup/welcome',
    'custom-welcome': '/setup/welcome',
    'backup': '/backups',
};

// Premium-only features - FAIR MODEL: Only truly advanced features
const PREMIUM_ONLY_FEATURES = [
    'console',             // Premium: Bot console
    'access-generator',    // Premium: Access code generator
    'access-share',        // Premium: Access sharing
    'ai-features',         // Premium: AI-powered features
    'anti-phishing',       // Premium: Anti-phishing setup
    'autorole',            // Premium: Auto role & reaction roles
    // Advanced settings within free pages:
    'anti-raid-advanced',
    'anti-spam-advanced',
    'anti-nuke-advanced',
    'moderation-advanced',
    'tickets-advanced',
    'welcome-advanced',
    'verification-advanced'
];

// Navigation items that require premium - FAIR MODEL: Only truly advanced pages
const PREMIUM_NAV_ITEMS = [
    '/dashboard/console',   // Premium: Bot console
    '/access-generator',    // Premium: Access code generator
    '/access-share',        // Premium: Access sharing
    '/setup/anti-phishing', // Premium: Anti-phishing
    '/setup/autorole',      // Premium: Auto role & reaction roles
    // FREE: Other setup pages (anti-raid, anti-spam, antinuke, moderation, verification)
    // FREE: tickets, analytics, help, logs, backups
];

// Premium state
let userPremiumStatus = {
    isPremium: false,
    tier: 'free',
    expiresAt: null,
    features: PREMIUM_TIERS.free.features
};

/**
 * Initialize premium system
 */
async function initPremiumSystem() {
    console.log('[Premium] Initializing premium system...');
    await refreshPremiumState();

    // Re-apply when navigation changes
    window.addEventListener('popstate', () => refreshPremiumState());
    window.addEventListener('focus', () => refreshPremiumState());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshPremiumState();
    });

    // Patch history changes for SPA-like navigation
    const originalPushState = history.pushState;
    history.pushState = function () {
        originalPushState.apply(this, arguments);
        refreshPremiumState();
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
        originalReplaceState.apply(this, arguments);
        refreshPremiumState();
    };
}

async function refreshPremiumState() {
    await checkPremiumStatus();
    applyPremiumGating();
    applyPremiumToSettingsCards();
    enforcePremiumPage();
    updatePremiumBadge();
}

/**
 * Check user's premium status from server
 */
async function checkPremiumStatus() {
    try {
        const response = await fetch('/api/premium/status', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            userPremiumStatus = {
                isPremium: data.isPremium || false,
                tier: data.tier || 'free',
                expiresAt: data.expiresAt,
                features: data.isPremium ? 
                    [...PREMIUM_TIERS.free.features, ...PREMIUM_TIERS.premium.features] : 
                    PREMIUM_TIERS.free.features
            };
            console.log('[Premium] Status loaded:', userPremiumStatus);
        }
    } catch (error) {
        console.warn('[Premium] Could not fetch premium status:', error);
        // Default to free tier
        userPremiumStatus = {
            isPremium: false,
            tier: 'free',
            features: PREMIUM_TIERS.free.features
        };
    }
}

/**
 * Check if user has access to a feature
 */
function hasFeatureAccess(feature) {
    return userPremiumStatus.isPremium || PREMIUM_TIERS.free.features.includes(feature);
}

/**
 * Check if a nav path requires premium
 */
function requiresPremium(path) {
    return PREMIUM_NAV_ITEMS.some(premiumPath => path.includes(premiumPath));
}

/**
 * Apply premium gating to navigation items
 */
function applyPremiumGating() {
    console.log('[Premium] Applying premium gating. isPremium:', userPremiumStatus.isPremium);
    
    // Find all navigation items with data-premium-required or matching premium paths
    const navItems = document.querySelectorAll('.nav-item, .sidebar-nav a');
    
    navItems.forEach(item => {
        const href = item.getAttribute('href');
        const isPremiumRequired = item.dataset.premiumRequired === 'true';
        const isPremiumPath = href && requiresPremium(href);
        const isPremiumFeature = isPremiumRequired || isPremiumPath;
        
        if (isPremiumFeature && !userPremiumStatus.isPremium) {
            // Add premium lock styling
            item.classList.add('premium-locked');
            
            // Add lock icon if not already present
            if (!item.querySelector('.premium-lock-icon')) {
                const lockIcon = document.createElement('i');
                lockIcon.className = 'fas fa-lock premium-lock-icon';
                lockIcon.title = 'Premium Feature - Upgrade to unlock';
                item.appendChild(lockIcon);
            }
            
            // Override click behavior
            item.addEventListener('click', handleLockedFeatureClick);
            item.dataset.premiumLocked = 'true';
        } else {
            // Remove lock if user has premium
            item.classList.remove('premium-locked');
            const lockIcon = item.querySelector('.premium-lock-icon');
            if (lockIcon) lockIcon.remove();
            item.removeEventListener('click', handleLockedFeatureClick);
            item.dataset.premiumLocked = 'false';
        }
    });
    
    // Hide upgrade nav if user has premium
    const upgradeNav = document.querySelector('.premium-upgrade-nav');
    if (upgradeNav) {
        upgradeNav.style.display = userPremiumStatus.isPremium ? 'none' : '';
    }
    
    // Also apply to any settings cards or feature toggles on the page
    applyPremiumToSettingsCards();
}

function enforcePremiumPage() {
    const isPremiumPage = document.body?.dataset?.premiumPage === 'true' || requiresPremium(window.location.pathname);
    if (!isPremiumPage) return;

    if (userPremiumStatus.isPremium) {
        unlockPremiumPage();
        return;
    }

    lockPremiumPage();
}

function lockPremiumPage() {
    document.body.classList.add('premium-page-locked');

    // Disable inputs and buttons
    const inputs = document.querySelectorAll('input, select, button, textarea');
    inputs.forEach(input => {
        input.disabled = true;
        input.classList.add('premium-disabled');
    });

    // Block all form submissions
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', preventPremiumSubmit, true);
    });

    // Block clicks and keypresses for action elements
    document.addEventListener('click', preventPremiumInteraction, true);
    document.addEventListener('keydown', preventPremiumInteraction, true);

    // Add page overlay
    if (!document.getElementById('premiumPageOverlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'premiumPageOverlay';
        overlay.className = 'premium-page-overlay';
        overlay.innerHTML = `
            <div class="premium-page-overlay-content">
                <div class="premium-icon"><i class="fas fa-crown"></i></div>
                <h2>Premium Feature</h2>
                <p>This page is available to premium subscribers only.</p>
                <button class="btn-upgrade" onclick="showUpgradeModal()">Upgrade to Premium</button>
                <a class="btn-back" href="/dashboard">Back to Dashboard</a>
            </div>
        `;
        document.body.appendChild(overlay);
    }
}

function unlockPremiumPage() {
    document.body.classList.remove('premium-page-locked');
    const overlay = document.getElementById('premiumPageOverlay');
    if (overlay) overlay.remove();

    const inputs = document.querySelectorAll('input, select, button, textarea');
    inputs.forEach(input => {
        input.disabled = false;
        input.classList.remove('premium-disabled');
    });

    document.querySelectorAll('form').forEach(form => {
        form.removeEventListener('submit', preventPremiumSubmit, true);
    });

    document.removeEventListener('click', preventPremiumInteraction, true);
    document.removeEventListener('keydown', preventPremiumInteraction, true);
}

function preventPremiumSubmit(event) {
    event.preventDefault();
    event.stopPropagation();
    showUpgradeModal();
}

function preventPremiumInteraction(event) {
    if (!document.body.classList.contains('premium-page-locked')) return;
    const target = event.target;
    if (!target) return;

    // Allow clicking overlay buttons
    if (target.closest('#premiumPageOverlay')) return;

    event.preventDefault();
    event.stopPropagation();
    showUpgradeModal();
}

/**
 * Apply premium gating to settings cards
 */
function applyPremiumToSettingsCards() {
    // Find premium setting indicators
    const premiumSettings = document.querySelectorAll('[data-premium-feature]');
    
    premiumSettings.forEach(element => {
        const feature = element.dataset.premiumFeature;
        const isPremiumFeature = PREMIUM_ONLY_FEATURES.includes(feature);
        
        if (isPremiumFeature && !userPremiumStatus.isPremium) {
            element.classList.add('premium-locked-setting');
            
            // Disable inputs within
            const inputs = element.querySelectorAll('input, select, button, textarea');
            inputs.forEach(input => {
                input.disabled = true;
                input.classList.add('premium-disabled');
            });
            
            // Add overlay if not present
            if (!element.querySelector('.premium-overlay')) {
                const overlay = document.createElement('div');
                overlay.className = 'premium-overlay';
                overlay.innerHTML = `
                    <div class="premium-overlay-content">
                        <i class="fas fa-lock"></i>
                        <span>Premium Feature</span>
                        <button class="btn-upgrade-small" onclick="showUpgradeModal()">Upgrade</button>
                    </div>
                `;
                element.style.position = 'relative';
                element.appendChild(overlay);
            }
        } else {
            element.classList.remove('premium-locked-setting');
            const overlay = element.querySelector('.premium-overlay');
            if (overlay) overlay.remove();
            
            const inputs = element.querySelectorAll('input, select, button, textarea');
            inputs.forEach(input => {
                input.disabled = false;
                input.classList.remove('premium-disabled');
            });
        }
    });
}

/**
 * Handle click on locked feature
 */
function handleLockedFeatureClick(event) {
    if (this.dataset.premiumLocked === 'true') {
        event.preventDefault();
        event.stopPropagation();
        showUpgradeModal();
    }
}

/**
 * Show upgrade modal
 */
function showUpgradeModal() {
    // Check if modal already exists
    let modal = document.getElementById('premiumUpgradeModal');
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'premiumUpgradeModal';
        modal.className = 'premium-modal';
        modal.innerHTML = `
            <div class="premium-modal-backdrop" onclick="closePremiumModal()"></div>
            <div class="premium-modal-content">
                <button class="premium-modal-close" onclick="closePremiumModal()">&times;</button>
                <div class="premium-modal-header">
                    <div class="premium-icon">
                        <i class="fas fa-crown"></i>
                    </div>
                    <h2>Upgrade to Premium</h2>
                    <p>Unlock all advanced features and take your server security to the next level!</p>
                </div>
                <div class="premium-modal-body">
                    <div class="premium-features-grid">
                        <div class="premium-feature-item">
                            <i class="fas fa-radiation"></i>
                            <span>Anti-Nuke Protection</span>
                        </div>
                        <div class="premium-feature-item">
                            <i class="fas fa-fish"></i>
                            <span>Anti-Phishing</span>
                        </div>
                        <div class="premium-feature-item">
                            <i class="fas fa-gavel"></i>
                            <span>Advanced Moderation</span>
                        </div>
                        <div class="premium-feature-item">
                            <i class="fas fa-user-check"></i>
                            <span>Verification System</span>
                        </div>
                        <div class="premium-feature-item">
                            <i class="fas fa-terminal"></i>
                            <span>Bot Console</span>
                        </div>
                        <div class="premium-feature-item">
                            <i class="fas fa-ticket-alt"></i>
                            <span>Advanced Tickets</span>
                        </div>
                        <div class="premium-feature-item">
                            <i class="fas fa-chart-line"></i>
                            <span>Advanced Analytics</span>
                        </div>
                        <div class="premium-feature-item">
                            <i class="fas fa-shield-alt"></i>
                            <span>Priority Support</span>
                        </div>
                    </div>
                    
                    <div class="premium-pricing">
                        <div class="pricing-option" onclick="selectPlan('monthly')">
                            <div class="pricing-label">Monthly</div>
                            <div class="pricing-price">$4.99<span>/mo</span></div>
                        </div>
                        <div class="pricing-option recommended" onclick="selectPlan('yearly')">
                            <div class="pricing-badge">Best Value</div>
                            <div class="pricing-label">Yearly</div>
                            <div class="pricing-price">$49.99<span>/yr</span></div>
                            <div class="pricing-savings">Save $10!</div>
                        </div>
                    </div>
                </div>
                <div class="premium-modal-footer">
                    <button class="btn-secondary" onclick="closePremiumModal()">Maybe Later</button>
                    <button class="btn-premium" onclick="startCheckout()">
                        <i class="fas fa-crown"></i>
                        Upgrade Now
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Close premium modal
 */
function closePremiumModal() {
    const modal = document.getElementById('premiumUpgradeModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Selected plan for checkout
let selectedPlan = 'yearly';

/**
 * Select a pricing plan
 */
function selectPlan(plan) {
    selectedPlan = plan;
    document.querySelectorAll('.pricing-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    // Find the clicked element from the event or by matching plan
    const clickedOption = document.querySelector(`.pricing-option[onclick*="${plan}"]`);
    if (clickedOption) {
        clickedOption.classList.add('selected');
    }
}

/**
 * Start Stripe checkout
 */
async function startCheckout() {
    try {
        const guildId = currentGuildId || localStorage.getItem('selectedGuildId');
        
        const response = await fetch('/api/stripe/create-checkout-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                plan: selectedPlan,
                guildId: guildId
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            // Check if user already has premium
            if (data.subscription) {
                alert(`You already have an active ${data.subscription.plan} subscription! It renews on ${new Date(data.subscription.renewsAt).toLocaleDateString()}`);
            } else {
                alert('Error: ' + data.error);
            }
            return;
        }
        
        if (data.url) {
            window.location.href = data.url;
        }
    } catch (error) {
        console.error('[Premium] Checkout error:', error);
        alert('Failed to start checkout. Please try again.');
    }
}

/**
 * Add premium badge to user info
 */
function updatePremiumBadge() {
    const userRoleElement = document.getElementById('userRole');
    if (userRoleElement && userPremiumStatus.isPremium) {
        if (!userRoleElement.querySelector('.premium-badge')) {
            const badge = document.createElement('span');
            badge.className = 'premium-badge';
            badge.innerHTML = '<i class="fas fa-crown"></i> Premium';
            userRoleElement.appendChild(badge);
        }
    }
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Delay initialization to ensure other scripts load first
    setTimeout(() => {
        initPremiumSystem();
        updatePremiumBadge();
    }, 500);
});

// Export for external use
window.PremiumSystem = {
    check: checkPremiumStatus,
    hasAccess: hasFeatureAccess,
    showUpgrade: showUpgradeModal,
    isPremium: () => userPremiumStatus.isPremium,
    getStatus: () => userPremiumStatus
};
