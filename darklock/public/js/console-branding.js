/**
 * Darklock Console Branding
 * Fun branded console messages
 * Only displays when debug mode is enabled
 */

(function() {
    'use strict';
    
    // Wait for debug controller to initialize
    async function displayBranding() {
        // Check if debug mode is enabled
        try {
            const response = await fetch('/api/v4/admin/settings', {
                credentials: 'include'
            }).catch(() => null);
            
            if (!response || !response.ok) {
                return; // Don't show branding if can't check debug mode
            }
            
            const data = await response.json();
            const debugEnabled = data.debug?.enabled === true;
            
            if (!debugEnabled) {
                return; // Don't show branding if debug mode is off
            }
        } catch (err) {
            return; // Don't show branding on error
        }
        
        // Darklock ASCII Art
        const logo = `
    ██████╗  █████╗ ██████╗ ██╗  ██╗██╗      ██████╗  ██████╗██╗  ██╗
    ██╔══██╗██╔══██╗██╔══██╗██║ ██╔╝██║     ██╔═══██╗██╔════╝██║ ██╔╝
    ██║  ██║███████║██████╔╝█████╔╝ ██║     ██║   ██║██║     █████╔╝ 
    ██║  ██║██╔══██║██╔══██╗██╔═██╗ ██║     ██║   ██║██║     ██╔═██╗ 
    ██████╔╝██║  ██║██║  ██║██║  ██╗███████╗╚██████╔╝╚██████╗██║  ██╗
    ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝
        `;
        
        // Color styles
        const styles = {
            title: 'color: #7c3aed; font-size: 20px; font-weight: bold; text-shadow: 2px 2px 4px rgba(124, 58, 237, 0.3);',
            subtitle: 'color: #a78bfa; font-size: 14px; font-weight: normal;',
            logo: 'color: #7c3aed; font-weight: bold; font-family: monospace;',
            warning: 'color: #ef4444; font-size: 16px; font-weight: bold;',
            info: 'color: #8b5cf6; font-size: 12px;',
            link: 'color: #60a5fa; font-size: 12px;',
            emoji: 'font-size: 18px;',
            badge: 'background: linear-gradient(90deg, #7c3aed 0%, #a78bfa 100%); color: white; padding: 4px 12px; border-radius: 4px; font-weight: bold;'
        };
        
        // Display branding
        console.log('%c' + logo, styles.logo);
        console.log('%c🔒 Darklock Security Platform %cv2.5.0', styles.title, styles.badge);
        console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #7c3aed;');
        console.log('');
        
        // Welcome message
        console.log('%c👋 Hey there, security enthusiast!', styles.info);
        console.log('%cWelcome to the Darklock Platform - protecting Discord communities since 2024.', 'color: #a78bfa; font-size: 12px;');
        console.log('');
        
        // Fun facts
        console.log('%c⚡ Fun Fact:', 'color: #fbbf24; font-weight: bold;');
        console.log('%cThis platform is powered by %cAI-driven threat detection%c, %creal-time monitoring%c, and %clots of coffee ☕', 
            'color: #94a3b8;', 'color: #7c3aed; font-weight: bold;', 'color: #94a3b8;', 
            'color: #7c3aed; font-weight: bold;', 'color: #94a3b8;', 'color: #7c3aed; font-weight: bold;');
        console.log('');
        
        // Security warning (always show this part)
        console.warn('%c⚠️  SECURITY WARNING', styles.warning);
        console.warn('%cIf someone told you to paste something here, it\'s probably a scam!', 'color: #f87171; font-size: 13px;');
        console.warn('%cPasting unknown code can give attackers access to your account.', 'color: #fca5a5; font-size: 12px;');
        console.log('');
        
        // Developer info
        console.log('%c👨‍💻 Developer Tools', 'color: #60a5fa; font-weight: bold;');
        console.log('%cInterested in what\'s under the hood? Check out:', 'color: #94a3b8;');
        console.log('%c  • GitHub: %chttps://github.com/anonymous-hidden?tab=repositories', 'color: #94a3b8;', 'color: #60a5fa;');
        console.log('%c  • Docs: %chttps://docs.darklock.dev', 'color: #94a3b8;', 'color: #60a5fa;');
        console.log('%c  • API: %chttps://api.darklock.dev', 'color: #94a3b8;', 'color: #60a5fa;');
        console.log('');

        console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #7c3aed;');
        console.log('');
    }
    
    // Display branding after page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', displayBranding);
    } else {
        displayBranding();
    }

})();
