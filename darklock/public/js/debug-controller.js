/**
 * Frontend Debug Controller
 * Controls console logging based on admin debug mode setting
 * Include this script at the top of all pages to enable debug mode control
 */

(function() {
    'use strict';
    
    let debugEnabled = false;
    
    // Store original console methods
    const originalConsole = {
        log: console.log,
        info: console.info,
        debug: console.debug,
        warn: console.warn,
        error: console.error
    };
    
    /**
     * Fetch debug mode setting from server
     */
    async function fetchDebugMode() {
        try {
            // Use admin API v4 endpoint
            const response = await fetch('/api/v4/admin/settings', {
                credentials: 'include'
            }).catch(() => null);
            
            if (response && response.ok) {
                const data = await response.json();
                debugEnabled = data.debug?.enabled === true;
                return;
            }
            
            // Fallback: check if there's a public debug endpoint or default to off
            debugEnabled = false;
        } catch (err) {
            // If we can't check, default to disabled
            debugEnabled = false;
        }
    }
    
    /**
     * Override console methods to respect debug mode
     */
    function overrideConsole() {
        // Override log, info, debug - only show when debug enabled
        console.log = function(...args) {
            if (debugEnabled) {
                originalConsole.log.apply(console, args);
            }
        };
        
        console.info = function(...args) {
            if (debugEnabled) {
                originalConsole.info.apply(console, args);
            }
        };
        
        console.debug = function(...args) {
            if (debugEnabled) {
                originalConsole.debug.apply(console, args);
            }
        };
        
        // warn and error always show
        console.warn = function(...args) {
            originalConsole.warn.apply(console, args);
        };
        
        console.error = function(...args) {
            originalConsole.error.apply(console, args);
        };
    }
    
    /**
     * Restore original console methods
     */
    function restoreConsole() {
        console.log = originalConsole.log;
        console.info = originalConsole.info;
        console.debug = originalConsole.debug;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
    }
    
    /**
     * Initialize debug controller
     */
    async function init() {
        await fetchDebugMode();
        overrideConsole();
        
        // Log status (using original console to bypass override)
        if (debugEnabled) {
            originalConsole.log('[Debug Controller] Debug mode ENABLED - console logs visible');
        } else {
            originalConsole.warn('[Debug Controller] Debug mode DISABLED - console logs hidden');
        }
    }
    
    // Export to window for manual control
    window.debugController = {
        init,
        enable: () => {
            debugEnabled = true;
            originalConsole.log('[Debug Controller] Debug mode manually ENABLED');
        },
        disable: () => {
            debugEnabled = false;
            originalConsole.warn('[Debug Controller] Debug mode manually DISABLED');
        },
        isEnabled: () => debugEnabled,
        restore: restoreConsole
    };
    
    // Auto-initialize on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
