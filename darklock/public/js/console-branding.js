/**
 * Darklock Console Branding
 * Fun branded console messages
 */

(function() {
    'use strict';
    
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
    
    // Security warning
    console.log('%c⚠️  SECURITY WARNING', styles.warning);
    console.log('%cIf someone told you to paste something here, it\'s probably a scam!', 'color: #f87171; font-size: 13px;');
    console.log('%cPasting unknown code can give attackers access to your account.', 'color: #fca5a5; font-size: 12px;');
    console.log('');
    
    // Developer info
    console.log('%c👨‍💻 Developer Tools', 'color: #60a5fa; font-weight: bold;');
    console.log('%cInterested in what\'s under the hood? Check out:', 'color: #94a3b8;');
    console.log('%c  • GitHub: %chttps://github.com/darklock-security', 'color: #94a3b8;', 'color: #60a5fa;');
    console.log('%c  • Docs: %chttps://docs.darklock.dev', 'color: #94a3b8;', 'color: #60a5fa;');
    console.log('%c  • API: %chttps://api.darklock.dev', 'color: #94a3b8;', 'color: #60a5fa;');
    console.log('');
    
    // Easter egg
    console.log('%c🎮 Easter Egg Hint:', 'color: #a78bfa; font-weight: bold;');
    console.log('%cTry typing %cdarklock.konami()%c in the console...', 'color: #94a3b8;', 'color: #7c3aed; font-family: monospace;', 'color: #94a3b8;');
    console.log('');
    
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #7c3aed;');
    console.log('');
    
    // Global Darklock object with fun utilities
    window.darklock = {
        version: '2.5.0',
        
        konami: function() {
            console.clear();
            const frames = [
                '🔒 D A R K L O C K 🔒',
                '🔓 D A R K L O C K 🔓',
                '🔒 D A R K L O C K 🔒',
                '🔓 D A R K L O C K 🔓',
                '🔒 D A R K L O C K 🔒'
            ];
            
            let i = 0;
            const interval = setInterval(() => {
                console.clear();
                console.log('%c' + frames[i], 'color: #7c3aed; font-size: 48px; font-weight: bold; text-align: center; animation: pulse 1s infinite;');
                console.log('');
                console.log('%c🎉 KONAMI CODE ACTIVATED! 🎉', 'color: #fbbf24; font-size: 24px; font-weight: bold;');
                console.log('');
                console.log('%cYou found the secret! Here\'s your reward:', 'color: #a78bfa; font-size: 14px;');
                console.log('%c🏆 Achievement Unlocked: Console Wizard', 'color: #fbbf24; font-size: 14px;');
                console.log('%c⭐ +100 XP - Security Expert', 'color: #10b981; font-size: 14px;');
                console.log('%c💎 Bonus: Lifetime Pro Access (Just kidding! 😄)', 'color: #60a5fa; font-size: 14px;');
                
                i++;
                if (i >= frames.length) {
                    clearInterval(interval);
                    setTimeout(() => {
                        console.log('');
                        console.log('%cThanks for being awesome! 🚀', 'color: #a78bfa; font-size: 16px;');
                    }, 1000);
                }
            }, 200);
        },
        
        stats: function() {
            const stats = {
                'Platform Version': '2.5.0',
                'Uptime': new Date().toLocaleTimeString(),
                'Protected Since': '2024',
                'Threats Blocked': '∞',
                'Coffee Consumed': '☕☕☕☕☕',
                'User Awesomeness': '100%'
            };
            console.table(stats);
        },
        
        ascii: function(text) {
            const chars = {
                'A': ['  ██  ', ' ████ ', '██  ██', '██████', '██  ██'],
                'B': ['█████ ', '██  ██', '█████ ', '██  ██', '█████ '],
                'C': [' ████ ', '██  ██', '██    ', '██  ██', ' ████ '],
                'D': ['█████ ', '██  ██', '██  ██', '██  ██', '█████ '],
                'E': ['██████', '██    ', '████  ', '██    ', '██████'],
                ' ': ['      ', '      ', '      ', '      ', '      ']
            };
            
            text = text.toUpperCase();
            for (let row = 0; row < 5; row++) {
                let line = '';
                for (let char of text) {
                    line += (chars[char] || chars[' '])[row] + '  ';
                }
                console.log('%c' + line, 'color: #7c3aed; font-family: monospace;');
            }
        },
        
        theme: function(color) {
            document.documentElement.style.setProperty('--accent-primary', color);
            console.log('%c🎨 Theme updated to ' + color, 'color: ' + color + '; font-weight: bold;');
        },
        
        matrix: function() {
            console.log('%cInitiating Matrix mode...', 'color: #10b981; font-family: monospace;');
            const chars = '01アイウエオカキクケコサシスセソタチツテト';
            for (let i = 0; i < 20; i++) {
                let line = '';
                for (let j = 0; j < 60; j++) {
                    line += chars[Math.floor(Math.random() * chars.length)];
                }
                console.log('%c' + line, 'color: #10b981; font-family: monospace; font-size: 10px;');
            }
        },
        
        help: function() {
            console.log('%c🔧 Available Commands:', 'color: #7c3aed; font-size: 16px; font-weight: bold;');
            console.log('');
            console.log('%cdarklock.konami()%c      - Activate the secret code', 'color: #60a5fa; font-family: monospace;', 'color: #94a3b8;');
            console.log('%cdarklock.stats()%c       - Show platform statistics', 'color: #60a5fa; font-family: monospace;', 'color: #94a3b8;');
            console.log('%cdarklock.ascii("TEXT")%c - Generate ASCII art', 'color: #60a5fa; font-family: monospace;', 'color: #94a3b8;');
            console.log('%cdarklock.theme("#color")%c- Change accent color', 'color: #60a5fa; font-family: monospace;', 'color: #94a3b8;');
            console.log('%cdarklock.matrix()%c      - Enter the Matrix', 'color: #60a5fa; font-family: monospace;', 'color: #94a3b8;');
            console.log('%cdarklock.help()%c        - Show this help message', 'color: #60a5fa; font-family: monospace;', 'color: #94a3b8;');
            console.log('');
            console.log('%cHave fun exploring! 🚀', 'color: #a78bfa;');
        }
    };
    
    // Add konami code listener
    let konamiIndex = 0;
    const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    
    document.addEventListener('keydown', (e) => {
        if (e.key === konamiCode[konamiIndex]) {
            konamiIndex++;
            if (konamiIndex === konamiCode.length) {
                darklock.konami();
                konamiIndex = 0;
            }
        } else {
            konamiIndex = 0;
        }
    });
    
})();
