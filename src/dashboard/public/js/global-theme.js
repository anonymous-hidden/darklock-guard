/**
 * Global Theme Loader
 * Automatically loads the selected theme from the server for all pages
 * Include this script in any HTML page to enable dynamic theming
 */

(function() {
    'use strict';
    
    const DEFAULT_THEME = 'darklock'; // Default theme
    const THEME_STORAGE_KEY = 'DarkLock-theme';
    const THEME_CSS_ENDPOINT = '/api/v4/admin/theme/css';
    
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
        
        // Always use the API endpoint for theme CSS
        // The endpoint returns CSS based on the active theme in the database
        themeLink.href = THEME_CSS_ENDPOINT;
        
        // Remove any existing theme classes from body and add the new one
        if (document.body) {
            // Remove old theme classes
            document.body.classList.forEach(cls => {
                if (cls.endsWith('-mode') || cls.startsWith('theme-')) {
                    document.body.classList.remove(cls);
                }
            });
            // Add new theme class (e.g., christmas-mode, halloween-mode) if not 'none'
            if (themeName && themeName !== 'none') {
                document.body.classList.add(`${themeName}-mode`);
                document.body.classList.add(`theme-${themeName}`);
            }
        }
        
        // Store in localStorage for instant loading on next page
        try {
            localStorage.setItem(THEME_STORAGE_KEY, themeName || 'none');
        } catch (e) {
            console.warn('Could not save theme to localStorage:', e);
        }
        
        // Dispatch event for any listeners
        document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: themeName || 'none' } }));
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

    // ─── Page Transition Overlay ───────────────────────────────────────────
    (function initPageTransition() {
        const OVERLAY_ID = 'dl-page-transition';

        function createOverlay() {
            if (document.getElementById(OVERLAY_ID)) return;
            const el = document.createElement('div');
            el.id = OVERLAY_ID;
            el.innerHTML = `
                <div class="dl-pt-inner">
                    <div class="dl-pt-logo">
                        <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
                            <rect width="52" height="52" rx="14" fill="rgba(0,212,255,0.12)"/>
                            <path d="M26 10 L40 18 L40 34 L26 42 L12 34 L12 18 Z" fill="none" stroke="#00d4ff" stroke-width="2.5" stroke-linejoin="round"/>
                            <path d="M26 18 L33 22 L33 30 L26 34 L19 30 L19 22 Z" fill="rgba(0,212,255,0.15)" stroke="#00d4ff" stroke-width="1.5"/>
                            <circle cx="26" cy="26" r="3" fill="#00d4ff"/>
                        </svg>
                    </div>
                    <div class="dl-pt-name">DarkLock</div>
                    <div class="dl-pt-bar-track"><div class="dl-pt-bar"></div></div>
                </div>
            `;
            el.style.cssText = [
                'position:fixed','inset:0','z-index:99999',
                'background:#0a0a0f',
                'display:flex','align-items:center','justify-content:center',
                'opacity:1','transition:opacity 0.35s ease',
                'pointer-events:all'
            ].join(';');

            // inject styles once
            if (!document.getElementById('dl-pt-style')) {
                const s = document.createElement('style');
                s.id = 'dl-pt-style';
                s.textContent = `
                    #dl-page-transition.dl-pt-hidden{opacity:0!important;pointer-events:none!important}
                    .dl-pt-inner{display:flex;flex-direction:column;align-items:center;gap:16px}
                    .dl-pt-logo{animation:dl-pt-pulse 1.6s ease-in-out infinite}
                    .dl-pt-name{font-family:-apple-system,BlinkMacSystemFont,"Inter",sans-serif;font-size:1.25rem;font-weight:700;color:#fff;letter-spacing:.06em}
                    .dl-pt-bar-track{width:160px;height:3px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden}
                    .dl-pt-bar{height:100%;width:40%;background:linear-gradient(90deg,transparent,#00d4ff,transparent);border-radius:99px;animation:dl-pt-slide 1.1s ease-in-out infinite}
                    @keyframes dl-pt-slide{0%{transform:translateX(-160px)}100%{transform:translateX(400px)}}
                    @keyframes dl-pt-pulse{0%,100%{transform:scale(1);filter:drop-shadow(0 0 8px rgba(0,212,255,0.4))}50%{transform:scale(1.07);filter:drop-shadow(0 0 18px rgba(0,212,255,0.7))}}
                `;
                document.head.appendChild(s);
            }

            (document.body || document.documentElement).appendChild(el);
            return el;
        }

        function hideOverlay() {
            const el = document.getElementById(OVERLAY_ID);
            if (el) {
                el.classList.add('dl-pt-hidden');
                setTimeout(() => { el && el.remove(); }, 400);
            }
        }

        function showOverlay(cb) {
            let el = document.getElementById(OVERLAY_ID);
            if (!el) el = createOverlay();
            el.classList.remove('dl-pt-hidden');
            el.style.opacity = '1';
            el.style.pointerEvents = 'all';
            if (cb) setTimeout(cb, 200);
        }

        // Show overlay immediately (hides any white flash)
        createOverlay();

        // Hide once page is painted and ready (also hides the inline boot overlay)
        function hideAll() {
            hideOverlay();
            if (typeof window._DLBootHide === 'function') window._DLBootHide();
        }
        if (document.readyState === 'complete') {
            setTimeout(hideAll, 80);
        } else {
            window.addEventListener('load', () => setTimeout(hideAll, 80));
            document.addEventListener('DOMContentLoaded', () => setTimeout(hideAll, 300));
        }

        // Intercept same-origin link clicks to show transition before navigating
        document.addEventListener('click', function(e) {
            const a = e.target.closest('a[href]');
            if (!a) return;
            const href = a.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('javascript') ||
                a.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey) return;
            // Skip transition overlay when reduce motion is preferred
            const _rmActive = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
                (function() { try { const s = localStorage.getItem('dashboardSettings'); if (s) return !!JSON.parse(s).reduceMotion; } catch(_){} return false; })();
            if (_rmActive) return;
            try {
                const url = new URL(href, location.href);
                if (url.origin !== location.origin) return;
                // Same-origin navigation — show transition
                e.preventDefault();
                showOverlay(() => { location.href = href; });
            } catch(_) {
                // Transition failed — fall back to direct navigation
                location.href = href;
            }
        }, true);

        // Also show on browser back/forward
        window.addEventListener('pageshow', function(e) {
            if (e.persisted) hideOverlay();
        });
    })();
})();
