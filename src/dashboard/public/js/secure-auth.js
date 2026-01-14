/**
 * Secure Authentication Client Library
 * 
 * SECURITY FEATURES:
 * - No localStorage token storage
 * - HTTP-only cookie authentication
 * - CSRF token handling
 * - Automatic session expiration
 * - Secure API requests with credentials
 * 
 * USAGE:
 * 
 * // Initialize (fetches CSRF token)
 * await SecureAuth.init();
 * 
 * // Make authenticated API calls
 * const data = await SecureAuth.fetch('/api/endpoint', {
 *     method: 'POST',
 *     body: JSON.stringify({ data: 'value' })
 * });
 * 
 * // Check if user is authenticated
 * const isAuth = await SecureAuth.isAuthenticated();
 * 
 * // Logout
 * await SecureAuth.logout();
 */

window.SecureAuth = (function() {
    'use strict';
    
    let csrfToken = null;
    let sessionExpiry = null;
    
    // Initialize - fetch CSRF token and check session
    async function init() {
        try {
            const response = await fetch('/api/csrf-token', {
                method: 'GET',
                credentials: 'include', // Include cookies
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                csrfToken = data.csrfToken;
                sessionExpiry = data.expiresAt;
                
                // Set up session expiration check
                if (sessionExpiry) {
                    setupSessionExpiryCheck();
                }
                
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('[SecureAuth] Init failed:', error);
            return false;
        }
    }
    
    // Setup automatic session expiry handling
    function setupSessionExpiryCheck() {
        const checkInterval = 60000; // Check every minute
        
        setInterval(() => {
            if (sessionExpiry && Date.now() >= sessionExpiry) {
                handleSessionExpired();
            }
        }, checkInterval);
        
        // Also warn 5 minutes before expiry
        const warningTime = sessionExpiry - (5 * 60 * 1000);
        const timeUntilWarning = warningTime - Date.now();
        
        if (timeUntilWarning > 0) {
            setTimeout(() => {
                showSessionWarning();
            }, timeUntilWarning);
        }
    }
    
    // Handle session expiration
    function handleSessionExpired() {
        // Clear any client-side state
        sessionExpiry = null;
        csrfToken = null;
        
        // Show notification
        showNotification('Your session has expired. Please log in again.', 'warning');
        
        // Redirect to login after a short delay
        setTimeout(() => {
            window.location.href = '/login?expired=true';
        }, 2000);
    }
    
    // Show session expiration warning
    function showSessionWarning() {
        showNotification('Your session will expire in 5 minutes.', 'info');
    }
    
    // Secure fetch wrapper
    async function secureFetch(url, options = {}) {
        // Ensure CSRF token is loaded
        if (!csrfToken) {
            await init();
        }
        
        // Default options
        const defaultOptions = {
            credentials: 'include', // CRITICAL: Include cookies
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };
        
        // Merge options
        const mergedOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...options.headers
            }
        };
        
        // Add CSRF token for non-GET requests
        if (csrfToken && mergedOptions.method && mergedOptions.method !== 'GET') {
            mergedOptions.headers['X-CSRF-Token'] = csrfToken;
        }
        
        try {
            const response = await fetch(url, mergedOptions);
            
            // Handle 401 Unauthorized - session expired or invalid
            if (response.status === 401) {
                handleSessionExpired();
                throw new Error('Session expired');
            }
            
            // Handle 403 Forbidden - CSRF or permissions issue
            if (response.status === 403) {
                // Try to get the actual error from response
                let errorMessage = 'Access forbidden';
                try {
                    const errorData = await response.clone().json();
                    errorMessage = errorData.error || errorMessage;
                    console.error('[SecureAuth] 403 Error details:', errorData);
                } catch (e) {
                    console.error('[SecureAuth] 403 - Could not parse error body');
                }
                // Try to refresh CSRF token
                await init();
                throw new Error(errorMessage);
            }
            
            return response;
        } catch (error) {
            console.error('[SecureAuth] Fetch error:', error);
            throw error;
        }
    }
    
    // Check if user is authenticated
    async function isAuthenticated() {
        try {
            const response = await secureFetch('/api/auth/check');
            return response.ok;
        } catch {
            return false;
        }
    }
    
    // Get current user info (from server, not JWT)
    async function getCurrentUser() {
        try {
            const response = await secureFetch('/api/auth/me');
            if (response.ok) {
                return await response.json();
            }
            return null;
        } catch {
            return null;
        }
    }
    
    // Logout - SERVER ONLY (no client-side cookie/localStorage manipulation)
    async function logout() {
        try {
            // POST to server logout endpoint - server destroys session & clears cookies
            await fetch('/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } catch (error) {
            console.error('[SecureAuth] Logout error:', error);
        }
        // Always redirect to login (server handles all cleanup)
        window.location.href = '/login.html?logout=true';
    }
    
    // Show notification (simple implementation - customize as needed)
    function showNotification(message, type = 'info') {
        // Check if there's a notification system already
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
            return;
        }
        
        // Fallback: simple alert or console
        if (type === 'error' || type === 'warning') {
            console.warn('[Session]', message);
        } else {
            console.info('[Session]', message);
        }
    }
    
    // Check if bot is ready (used to prevent errors during startup)
    async function checkBotReady(maxRetries = 10, retryDelay = 2000) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch('/health', {
                    method: 'GET',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.botReady) {
                        console.log('[SecureAuth] Bot is ready');
                        return true;
                    }
                    console.log(`[SecureAuth] Bot starting... (${i + 1}/${maxRetries})`);
                }
            } catch (error) {
                console.warn('[SecureAuth] Health check failed:', error.message);
            }
            
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
        
        console.warn('[SecureAuth] Bot may not be fully ready');
        return false;
    }
    
    // Public API
    return {
        init,
        fetch: secureFetch,
        isAuthenticated,
        getCurrentUser,
        logout,
        checkBotReady
    };
})();

// Auto-initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Only init if not on login page
        if (!window.location.pathname.includes('/login')) {
            SecureAuth.init().catch(err => {
                console.error('[SecureAuth] Auto-init failed:', err);
            });
        }
    });
} else {
    if (!window.location.pathname.includes('/login')) {
        SecureAuth.init().catch(err => {
            console.error('[SecureAuth] Auto-init failed:', err);
        });
    }
}
