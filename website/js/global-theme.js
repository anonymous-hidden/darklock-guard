/**
 * Global Theme Loader
 * Automatically loads the selected theme from the server for all pages
 * Include this script in any HTML page to enable dynamic theming
 */

(function() {
    'use strict';
    
    const DEFAULT_THEME = 'christmas';
    const THEME_STORAGE_KEY = 'DarkLock-theme';
    const THEME_CSS_PATH = '/css/themes/';
    
    /**
     * Create and inject the theme stylesheet link
     */
    function createThemeLink() {
        let themeLink = document.getElementById('dynamic-theme-stylesheet');
        if (!themeLink) {
            themeLink = document.createElement('link');
            themeLink.id = 'dynamic-theme-stylesheet';
            themeLink.rel = 'stylesheet';
            // Insert after other stylesheets but before closing </head>
            document.head.appendChild(themeLink);
        }
        return themeLink;
    }
    
    /**
     * Apply a theme by updating the stylesheet href
     */
    function applyTheme(themeName) {
        const themeLink = createThemeLink();
        themeLink.href = `${THEME_CSS_PATH}${themeName}.css`;
        
        // Remove any existing theme classes from body and add the new one
        if (document.body) {
            // Remove old theme classes
            document.body.classList.forEach(cls => {
                if (cls.endsWith('-mode') || cls.startsWith('theme-')) {
                    document.body.classList.remove(cls);
                }
            });
            // Add new theme class (e.g., christmas-mode, halloween-mode)
            document.body.classList.add(`${themeName}-mode`);
            document.body.classList.add(`theme-${themeName}`);
        }
        
        // Store in localStorage for instant loading on next page
        try {
            localStorage.setItem(THEME_STORAGE_KEY, themeName);
        } catch (e) {
            console.warn('Could not save theme to localStorage:', e);
        }
        
        // Dispatch event for any listeners
        document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: themeName } }));
    }
    
    /**
     * Get cached theme from localStorage for instant loading
     */
    function getCachedTheme() {
        try {
            return localStorage.getItem(THEME_STORAGE_KEY);
        } catch (e) {
            return null;
        }
    }
    
    /**
     * Fetch the current theme from the server
     */
    async function fetchCurrentTheme() {
        try {
            const response = await fetch('/api/current-theme');
            if (response.ok) {
                const data = await response.json();
                return data.theme || DEFAULT_THEME;
            }
        } catch (e) {
            console.warn('Could not fetch theme from server:', e);
        }
        return null;
    }
    
    /**
     * Initialize the theme system
     */
    async function initTheme() {
        // 1. First, apply cached theme instantly (prevents flash of unstyled content)
        const cachedTheme = getCachedTheme();
        if (cachedTheme) {
            applyTheme(cachedTheme);
        } else {
            // Apply default theme while fetching
            applyTheme(DEFAULT_THEME);
        }
        
        // 2. Then fetch the actual theme from server and update if different
        const serverTheme = await fetchCurrentTheme();
        if (serverTheme && serverTheme !== cachedTheme) {
            applyTheme(serverTheme);
        }
    }
    
    // Expose functions globally for manual theme changes
    window.GuardianTheme = {
        apply: applyTheme,
        fetch: fetchCurrentTheme,
        getCached: getCachedTheme,
        refresh: initTheme
    };
    
    /**
     * Load the theme effects script dynamically
     */
    function loadThemeEffects() {
        // Check if already loaded
        if (document.getElementById('theme-effects-script')) return;
        
        const script = document.createElement('script');
        script.id = 'theme-effects-script';
        // Determine correct path based on current location
        const isWebsite = window.location.pathname.includes('.html') || window.location.pathname === '/';
        const scriptPath = isWebsite ? 'js/theme-effects.js' : '/js/theme-effects.js';
        script.src = scriptPath;
        
        script.onload = function() {
            console.log('✅ Theme effects loaded successfully');
        };
        
        script.onerror = function() {
            console.error('❌ Failed to load theme effects from:', scriptPath);
            // Try alternate path if first fails
            if (script.src.includes('js/theme-effects.js')) {
                const altScript = document.createElement('script');
                altScript.id = 'theme-effects-script';
                altScript.src = '/js/theme-effects.js';
                (document.body || document.head).appendChild(altScript);
            }
        };
        
        // Append to body or head, whichever exists
        (document.body || document.head).appendChild(script);
    }
    
    // Initialize on DOM ready or immediately if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initTheme();
            loadThemeEffects();
        });
    } else {
        initTheme();
        loadThemeEffects();
    }
    
    // Also run immediately for fastest possible theme application
    initTheme();
})();
