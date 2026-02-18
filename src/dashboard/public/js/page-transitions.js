/**
 * Smooth page transitions for Darklock Dashboard
 * Adds fade-in/out effects when navigating between pages
 */
(function() {
    'use strict';

    // Fade in on page load
    document.documentElement.style.opacity = '0';
    document.documentElement.style.transition = 'opacity 0.2s ease-in-out';

    function fadeIn() {
        document.documentElement.style.opacity = '1';
    }

    // Fade in when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fadeIn);
    } else {
        fadeIn();
    }

    // Intercept navigation clicks for smooth transition
    document.addEventListener('click', function(e) {
        const link = e.target.closest('a[href]');
        if (!link) return;

        const href = link.getAttribute('href');
        
        // Skip external links, anchors, javascript:, and special links
        if (!href || 
            href.startsWith('#') || 
            href.startsWith('javascript:') || 
            href.startsWith('http') ||
            link.target === '_blank' ||
            e.ctrlKey || e.metaKey || e.shiftKey) {
            return;
        }

        // Skip if it's the current page
        if (href === window.location.pathname) {
            e.preventDefault();
            return;
        }

        e.preventDefault();
        document.documentElement.style.opacity = '0';
        
        setTimeout(function() {
            window.location.href = href;
        }, 180);
    });
})();
