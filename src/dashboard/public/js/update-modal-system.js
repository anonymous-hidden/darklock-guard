/**
 * Dashboard Update Modal System
 * Handles version checking and modal display for dashboard updates
 * Fail-safe design ensures modal never permanently blocks the dashboard
 */

// ========================================
// CONFIGURATION
// ========================================

const CURRENT_DASHBOARD_VERSION = "2.0.0";
const VERSION_STORAGE_KEY = "dashboard_last_seen_version";
const VERSION_API_ENDPOINT = "/api/version"; // Optional: fetch from backend

// ========================================
// CORE FUNCTIONS
// ========================================

/**
 * Show the update modal
 */
function showUpdateModal() {
    // Prevent double-show: if another modal instance already set the global flag, skip
    try {
        if (window.__updateModalActive) {
            console.log('[UPDATE MODAL] Another update modal is already active; skipping show');
            return;
        }
        window.__updateModalActive = true;
    } catch (e) {}
    const modal = document.getElementById('updateModal');
    if (!modal) {
        console.warn('[UPDATE MODAL] Modal element not found');
        return;
    }
    
    try {
        modal.classList.add('show');
        // Do not prevent background scrolling; keep modal non-blocking
        console.log(`[UPDATE MODAL] Showing version ${CURRENT_DASHBOARD_VERSION}`);
        
        // FAIL-SAFE: Auto-hide after 2 minutes if user doesn't interact
        setTimeout(() => {
            if (modal.classList.contains('show')) {
                console.warn('[UPDATE MODAL] Auto-hiding after timeout');
                hideUpdateModal();
            }
        }, 120000); // 2 minutes
    } catch (error) {
        console.error('[UPDATE MODAL] Error showing modal:', error);
        hideUpdateModal(); // Fail-safe: hide on error
    }
}

/**
 * Hide the update modal and save version to localStorage
 */
function hideUpdateModal() {
    const modal = document.getElementById('updateModal');
    if (!modal) return;
    
    try {
        modal.classList.remove('show');
        
        // Save current version to localStorage
        localStorage.setItem(VERSION_STORAGE_KEY, CURRENT_DASHBOARD_VERSION);
        console.log(`[UPDATE MODAL] Hidden and saved version ${CURRENT_DASHBOARD_VERSION}`);
    } catch (error) {
        console.error('[UPDATE MODAL] Error hiding modal:', error);
        // Force hide even if localStorage fails
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
    try { window.__updateModalActive = false; } catch (e) {}
}

/**
 * Check if modal should be shown based on version comparison
 * @returns {boolean} True if modal should be shown
 */
function shouldShowUpdateModal() {
    try {
        const lastSeenVersion = localStorage.getItem(VERSION_STORAGE_KEY);
        
        // First time user or version changed
        if (!lastSeenVersion || lastSeenVersion !== CURRENT_DASHBOARD_VERSION) {
            console.log(`[UPDATE MODAL] New version detected: ${lastSeenVersion} → ${CURRENT_DASHBOARD_VERSION}`);
            return true;
        }
        
        console.log(`[UPDATE MODAL] User already saw version ${CURRENT_DASHBOARD_VERSION}`);
        return false;
    } catch (error) {
        console.error('[UPDATE MODAL] Error checking version:', error);
        return false; // Fail-safe: don't show on error
    }
}

/**
 * Fetch version from backend API (optional)
 * @returns {Promise<string|null>} Version string or null on error
 */
async function fetchVersionFromAPI() {
    try {
        const response = await fetch(VERSION_API_ENDPOINT, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            // Timeout after 5 seconds
            signal: AbortSignal.timeout(5000)
        });
        
        if (!response.ok) {
            console.warn(`[UPDATE MODAL] API returned ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        return data.version || null;
    } catch (error) {
        console.warn('[UPDATE MODAL] API fetch failed (non-critical):', error.message);
        return null; // Fail-safe: use hardcoded version
    }
}

/**
 * Initialize update modal system
 * Call this in your dashboard init() function
 */
async function initUpdateModal() {
    console.log('[UPDATE MODAL] Initializing...');
    
    try {
        // Optional: Try to fetch version from API first
        // const apiVersion = await fetchVersionFromAPI();
        // const versionToCheck = apiVersion || CURRENT_DASHBOARD_VERSION;
        
        // For now, use hardcoded version
        const versionToCheck = CURRENT_DASHBOARD_VERSION;
        
        // Check if we should show the modal
        if (shouldShowUpdateModal()) {
            // Small delay to ensure dashboard has loaded
            setTimeout(() => {
                showUpdateModal();
            }, 500);
        }
        
        // Attach click handler to OK button
        const okButton = document.getElementById('updateModalOK');
        if (okButton) {
            okButton.addEventListener('click', hideUpdateModal);
        } else {
            console.warn('[UPDATE MODAL] OK button not found');
        }
        
        // Click backdrop to close (optional)
        const modal = document.getElementById('updateModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                // Only close if clicking the overlay, not the modal content
                if (e.target === modal) {
                    hideUpdateModal();
                }
            });
        }
        
        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && modal.classList.contains('show')) {
                hideUpdateModal();
            }
        });
        
        console.log('[UPDATE MODAL] Initialized successfully');
    } catch (error) {
        console.error('[UPDATE MODAL] Initialization error:', error);
        // Fail-safe: ensure modal is hidden
        const modal = document.getElementById('updateModal');
        if (modal) {
            modal.classList.remove('show');
        }
    }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Force show modal (for testing or manual trigger)
 */
function forceShowUpdateModal() {
    showUpdateModal();
}

/**
 * Reset version (for testing)
 */
function resetUpdateModalVersion() {
    localStorage.removeItem(VERSION_STORAGE_KEY);
    console.log('[UPDATE MODAL] Version reset');
}

// ========================================
// EXPORT (if using modules)
// ========================================

// If using ES6 modules:
// export { initUpdateModal, showUpdateModal, hideUpdateModal, forceShowUpdateModal, resetUpdateModalVersion };

// If using in browser directly, these are now global functions
// For console debugging: window.forceShowUpdateModal = forceShowUpdateModal;
window.forceShowUpdateModal = forceShowUpdateModal;
window.resetUpdateModalVersion = resetUpdateModalVersion;
