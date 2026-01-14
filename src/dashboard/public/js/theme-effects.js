/**
 * Theme Effects & Easter Eggs
 * Fun animations and hidden features for all holiday themes
 */

(function() {
    'use strict';

    // ==========================================
    // CONFIGURATION
    // ==========================================
    const CONFIG = {
        particleCount: 25,
        easterEggTimeout: 300,
        konamiCode: ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'],
        secretWords: {
            christmas: ['hohoho', 'santa', 'jingle'],
            halloween: ['trick', 'boo', 'spooky'],
            easter: ['bunny', 'eggs', 'hop'],
            valentines: ['love', 'cupid', 'heart'],
            newyear: ['2026', 'cheers', 'party'],
            stpatricks: ['lucky', 'gold', 'shamrock'],
            thanksgiving: ['gobble', 'thankful', 'feast'],
            july4th: ['freedom', 'liberty', 'usa'],
            pride: ['pride', 'rainbow', 'love'],
            spring: ['bloom', 'flowers'],
            summer: ['beach', 'sunny'],
            autumn: ['cozy', 'leaves'],
            winter: ['snow', 'frost']
        }
    };

    // State
    let currentTheme = 'default-dark';
    let effectsContainer = null;
    let konamiProgress = 0;
    let typedKeys = '';
    let clickCounts = {};
    let idleTimer = null;
    let isPartyMode = false;

    // ==========================================
    // INITIALIZATION
    // ==========================================
    function init() {
        detectTheme();
        createEffectsContainer();
        setupEventListeners();
        startThemeEffects();
        startIdleDetection();
        
        // Listen for theme changes
        document.addEventListener('themeChanged', (e) => {
            currentTheme = e.detail.theme;
            resetEffects();
            startThemeEffects();
        });

        console.log('🎉 Theme Effects loaded! Try finding the easter eggs...');
    }

    function detectTheme() {
        const themeLink = document.getElementById('dynamic-theme-stylesheet');
        if (themeLink && themeLink.href) {
            const match = themeLink.href.match(/themes\/([^.]+)\.css/);
            if (match) {
                currentTheme = match[1];
            }
        }
        // Also check localStorage
        const cached = localStorage.getItem('DarkLock-theme');
        if (cached) currentTheme = cached;
    }

    function createEffectsContainer() {
        // Remove existing
        const existing = document.getElementById('theme-effects-container');
        if (existing) existing.remove();

        effectsContainer = document.createElement('div');
        effectsContainer.id = 'theme-effects-container';
        effectsContainer.className = 'theme-effects-container';
        effectsContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 9999;
            overflow: hidden;
        `;
        document.body.appendChild(effectsContainer);
    }

    function resetEffects() {
        if (effectsContainer) {
            effectsContainer.innerHTML = '';
        }
        document.body.classList.remove('party-mode', 'secret-activated');
    }

    // ==========================================
    // EVENT LISTENERS
    // ==========================================
    function setupEventListeners() {
        // Konami Code detection
        document.addEventListener('keydown', handleKeyDown);
        
        // Click tracking for easter eggs
        document.addEventListener('click', handleClick);
        
        // Mouse movement for cursor trails
        document.addEventListener('mousemove', handleMouseMove);
        
        // Reset idle timer on activity
        ['mousemove', 'keydown', 'click', 'scroll'].forEach(event => {
            document.addEventListener(event, resetIdleTimer);
        });
    }

    function handleKeyDown(e) {
        // Guard against uninitialized CONFIG
        if (!CONFIG || !CONFIG.konamiCode) return;
        
        // Konami code check
        if (e.code === CONFIG.konamiCode[konamiProgress]) {
            konamiProgress++;
            if (konamiProgress === CONFIG.konamiCode.length) {
                triggerKonamiEasterEgg();
                konamiProgress = 0;
            }
        } else {
            konamiProgress = 0;
        }

        // Secret word detection
        if (e.key.length === 1) {
            typedKeys += e.key.toLowerCase();
            if (typedKeys.length > 20) {
                typedKeys = typedKeys.slice(-20);
            }
            checkSecretWords();
        }
    }

    function handleClick(e) {
        const target = e.target;
        
        // Track clicks on emojis and special elements
        const emoji = target.textContent?.trim();
        if (emoji && emoji.length <= 4) {
            clickCounts[emoji] = (clickCounts[emoji] || 0) + 1;
            checkClickEasterEggs(emoji, clickCounts[emoji]);
        }

        // Logo click counter
        if (target.closest('.logo, .brand, .navbar-brand, [class*="logo"]')) {
            clickCounts['logo'] = (clickCounts['logo'] || 0) + 1;
            if (clickCounts['logo'] === 10) {
                triggerPartyMode();
                clickCounts['logo'] = 0;
            }
        }

        // Reset counts after timeout
        setTimeout(() => {
            clickCounts[emoji] = 0;
        }, 2000);
    }

    let lastTrailTime = 0;
    function handleMouseMove(e) {
        const now = Date.now();
        if (now - lastTrailTime < 50) return;
        lastTrailTime = now;

        // Theme-specific cursor effects
        if (currentTheme === 'pride') {
            createRainbowTrail(e.clientX, e.clientY);
        } else if (currentTheme === 'valentines') {
            if (Math.random() < 0.1) {
                createHeartTrail(e.clientX, e.clientY);
            }
        }
    }

    // ==========================================
    // THEME-SPECIFIC EFFECTS
    // ==========================================
    function startThemeEffects() {
        switch(currentTheme) {
            case 'christmas':
                startChristmasEffects();
                break;
            case 'halloween':
                startHalloweenEffects();
                break;
            case 'easter':
                startEasterEffects();
                break;
            case 'valentines':
                startValentinesEffects();
                break;
            case 'new-year':
                startNewYearEffects();
                break;
            case 'stpatricks':
                startStPatricksEffects();
                break;
            case 'thanksgiving':
                startThanksgivingEffects();
                break;
            case 'july4th':
                startJuly4thEffects();
                break;
            case 'pride':
                startPrideEffects();
                break;
            case 'spring':
                startSpringEffects();
                break;
            case 'summer':
                startSummerEffects();
                break;
            case 'autumn':
                startAutumnEffects();
                break;
            case 'winter':
                startWinterEffects();
                break;
        }
    }

    // ==========================================
    // 🎄 CHRISTMAS EFFECTS
    // ==========================================
    function startChristmasEffects() {
        // Snowfall
        createSnowfall();
        
        // Christmas lights
        createChristmasLights();
        
        // Add Santa hat to logo
        addSantaHat();
        
        // Hidden present easter egg
        createHiddenPresent();
        
        // Christmas countdown timer
        createChristmasCountdown();
        
        // Flying Santa sleigh
        createFlyingSanta();
        
        // Ornaments on cards
        addOrnamentDecorations();
        
        // Secret Rudolph finder
        createHiddenRudolph();
        
        // Gingerbread man runner
        createGingerbreadRunner();
        
        // Naughty/Nice click detector
        setupNaughtyNiceDetector();
        
        // Christmas music toggle
        createMusicToggle();
        
        // Secret snowman builder
        setupSnowmanBuilder();
    }
    
    // Christmas Countdown Timer
    function createChristmasCountdown() {
        // Check if Christmas has passed this year
        const now = new Date();
        let christmas = new Date(now.getFullYear(), 11, 25); // December 25
        if (now > christmas) {
            christmas = new Date(now.getFullYear() + 1, 11, 25);
        }
        
        const countdown = document.createElement('div');
        countdown.id = 'christmas-countdown';
        countdown.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            background: linear-gradient(135deg, rgba(196, 30, 58, 0.95) 0%, rgba(139, 0, 0, 0.95) 100%);
            border: 2px solid #ffd700;
            border-radius: 15px;
            padding: 15px 20px;
            color: white;
            font-family: 'Segoe UI', sans-serif;
            text-align: center;
            z-index: 10002;
            box-shadow: 0 4px 20px rgba(196, 30, 58, 0.4), 0 0 30px rgba(255, 215, 0, 0.2);
            animation: countdown-glow 2s ease-in-out infinite alternate;
            pointer-events: auto;
            cursor: pointer;
            min-width: 180px;
        `;
        
        countdown.innerHTML = `
            <div style="font-size: 0.8em; margin-bottom: 5px; opacity: 0.9;">🎄 Christmas Countdown 🎄</div>
            <div id="countdown-timer" style="font-size: 1.3em; font-weight: bold; letter-spacing: 1px;"></div>
            <div id="countdown-message" style="font-size: 0.75em; margin-top: 5px; opacity: 0.8;"></div>
        `;
        
        // Click to toggle size
        let isMinimized = false;
        countdown.addEventListener('click', () => {
            isMinimized = !isMinimized;
            if (isMinimized) {
                countdown.style.padding = '8px 12px';
                countdown.style.minWidth = 'auto';
                countdown.querySelector('div:first-child').style.display = 'none';
                document.getElementById('countdown-message').style.display = 'none';
            } else {
                countdown.style.padding = '15px 20px';
                countdown.style.minWidth = '180px';
                countdown.querySelector('div:first-child').style.display = 'block';
                document.getElementById('countdown-message').style.display = 'block';
            }
        });
        
        effectsContainer.appendChild(countdown);
        
        function updateCountdown() {
            const now = new Date();
            const diff = christmas - now;
            
            if (diff <= 0) {
                document.getElementById('countdown-timer').textContent = '🎅 IT\'S CHRISTMAS! 🎄';
                document.getElementById('countdown-message').textContent = 'Merry Christmas!';
                triggerChristmasCelebration();
                return;
            }
            
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            
            const timerEl = document.getElementById('countdown-timer');
            const messageEl = document.getElementById('countdown-message');
            
            if (days > 0) {
                timerEl.textContent = `${days}d ${hours}h ${minutes}m ${seconds}s`;
                messageEl.textContent = days === 1 ? 'Only 1 day left!' : `${days} days until Christmas!`;
            } else if (hours > 0) {
                timerEl.textContent = `${hours}h ${minutes}m ${seconds}s`;
                messageEl.textContent = 'Almost there! 🎁';
            } else {
                timerEl.textContent = `${minutes}m ${seconds}s`;
                messageEl.textContent = 'Christmas is nearly here! 🎅';
            }
        }
        
        updateCountdown();
        setInterval(updateCountdown, 1000);
    }
    
    function triggerChristmasCelebration() {
        // Big celebration when it's Christmas
        createConfettiBurst(['#ff0000', '#00ff00', '#ffd700', '#ffffff'], 100);
        showNotification('🎄🎅 MERRY CHRISTMAS! 🎁🎉', 'christmas');
        
        // Play jingle bells sound effect visual
        const bells = document.createElement('div');
        bells.textContent = '🔔🔔🔔';
        bells.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 5em;
            animation: bells-ring 1s ease-in-out 3;
            z-index: 10010;
        `;
        document.body.appendChild(bells);
        setTimeout(() => bells.remove(), 3000);
    }
    
    // Flying Santa Sleigh
    function createFlyingSanta() {
        const santaInterval = setInterval(() => {
            if (currentTheme !== 'christmas') {
                clearInterval(santaInterval);
                return;
            }
            
            if (Math.random() < 0.15) {
                const santa = document.createElement('div');
                santa.innerHTML = '🎅🛷🦌🦌🦌';
                santa.style.cssText = `
                    position: fixed;
                    top: ${5 + Math.random() * 20}%;
                    left: -200px;
                    font-size: 1.8em;
                    animation: santa-fly ${12 + Math.random() * 8}s linear forwards;
                    z-index: 10003;
                    pointer-events: none;
                    filter: drop-shadow(0 0 10px rgba(255, 215, 0, 0.5));
                `;
                effectsContainer.appendChild(santa);
                setTimeout(() => santa.remove(), 20000);
            }
        }, 15000);
    }
    
    // Ornament Decorations on Cards
    function addOrnamentDecorations() {
        const ornaments = ['🔴', '🟢', '🟡', '🔵', '🟣', '⭐'];
        document.querySelectorAll('.card, .stat-card, .dashboard-card').forEach((card, i) => {
            const ornament = document.createElement('span');
            ornament.textContent = ornaments[i % ornaments.length];
            ornament.style.cssText = `
                position: absolute;
                top: -10px;
                right: ${10 + (i % 3) * 20}px;
                font-size: 1.2em;
                animation: ornament-swing 2s ease-in-out infinite;
                animation-delay: ${i * 0.2}s;
            `;
            card.style.position = 'relative';
            card.style.overflow = 'visible';
            card.appendChild(ornament);
        });
    }
    
    // Hidden Rudolph Easter Egg
    function createHiddenRudolph() {
        const rudolph = document.createElement('div');
        rudolph.textContent = '🦌';
        rudolph.style.cssText = `
            position: fixed;
            bottom: ${100 + Math.random() * 200}px;
            left: ${50 + Math.random() * 100}px;
            font-size: 2em;
            cursor: pointer;
            pointer-events: auto;
            opacity: 0.2;
            transition: all 0.3s ease;
            z-index: 10001;
            filter: grayscale(1);
        `;
        
        rudolph.addEventListener('mouseenter', () => {
            rudolph.style.opacity = '1';
            rudolph.style.filter = 'grayscale(0)';
            rudolph.style.transform = 'scale(1.3)';
        });
        
        rudolph.addEventListener('mouseleave', () => {
            rudolph.style.opacity = '0.2';
            rudolph.style.filter = 'grayscale(1)';
            rudolph.style.transform = 'scale(1)';
        });
        
        let clickCount = 0;
        rudolph.addEventListener('click', () => {
            clickCount++;
            if (clickCount === 1) {
                showNotification('🦌 Rudolph\'s nose starts to glow...', 'christmas');
                rudolph.innerHTML = '🦌<span style="position:absolute;color:red;font-size:0.3em;top:8px;left:12px;">●</span>';
            } else if (clickCount === 3) {
                showNotification('🔴 Rudolph\'s nose is glowing bright!', 'christmas');
                rudolph.style.filter = 'drop-shadow(0 0 15px red)';
            } else if (clickCount === 5) {
                showNotification('🦌✨ Rudolph leads the way! You found a secret!', 'christmas');
                triggerRudolphEasterEgg();
                clickCount = 0;
            }
        });
        
        effectsContainer.appendChild(rudolph);
    }
    
    function triggerRudolphEasterEgg() {
        // Rudolph flies across screen leaving red trail
        const flyingRudolph = document.createElement('div');
        flyingRudolph.innerHTML = '🔴🦌';
        flyingRudolph.style.cssText = `
            position: fixed;
            top: 30%;
            left: -100px;
            font-size: 3em;
            animation: rudolph-fly 4s ease-in-out forwards;
            z-index: 10010;
        `;
        document.body.appendChild(flyingRudolph);
        
        // Red trail
        let trailCount = 0;
        const trailInterval = setInterval(() => {
            if (trailCount > 30) {
                clearInterval(trailInterval);
                return;
            }
            const glow = document.createElement('div');
            glow.textContent = '✨';
            glow.style.cssText = `
                position: fixed;
                top: ${30 + Math.sin(trailCount * 0.3) * 10}%;
                left: ${(trailCount / 30) * 100}%;
                font-size: 1.5em;
                color: red;
                animation: fade-out 1s forwards;
                z-index: 10009;
            `;
            document.body.appendChild(glow);
            setTimeout(() => glow.remove(), 1000);
            trailCount++;
        }, 100);
        
        setTimeout(() => flyingRudolph.remove(), 4000);
        createConfettiBurst(['#ff0000', '#ffd700'], 50);
    }
    
    // Gingerbread Man Runner
    function createGingerbreadRunner() {
        const gingerbread = document.createElement('div');
        gingerbread.textContent = '🍪';
        gingerbread.title = 'Catch the gingerbread man!';
        gingerbread.style.cssText = `
            position: fixed;
            bottom: 50px;
            left: -50px;
            font-size: 2em;
            cursor: pointer;
            pointer-events: auto;
            z-index: 10001;
            transition: transform 0.1s;
        `;
        
        let position = -50;
        let direction = 1;
        let speed = 2;
        let caught = false;
        
        function runGingerbread() {
            if (currentTheme !== 'christmas' || caught) return;
            
            position += speed * direction;
            
            if (position > window.innerWidth + 50) {
                direction = -1;
                gingerbread.style.transform = 'scaleX(-1)';
            } else if (position < -50) {
                direction = 1;
                gingerbread.style.transform = 'scaleX(1)';
            }
            
            gingerbread.style.left = position + 'px';
            requestAnimationFrame(runGingerbread);
        }
        
        gingerbread.addEventListener('click', () => {
            caught = true;
            gingerbread.style.animation = 'none';
            showNotification('🍪 You caught the Gingerbread Man! "You can\'t catch me... oh wait, you did!"', 'christmas');
            createConfettiBurst(['#8B4513', '#D2691E', '#ffd700'], 30);
            
            setTimeout(() => {
                caught = false;
                speed = speed + 1; // Gets faster each time
                runGingerbread();
            }, 5000);
        });
        
        effectsContainer.appendChild(gingerbread);
        setTimeout(runGingerbread, 3000);
    }
    
    // Naughty/Nice Detector
    function setupNaughtyNiceDetector() {
        let rapidClicks = 0;
        let lastClickTime = 0;
        
        document.addEventListener('click', (e) => {
            if (currentTheme !== 'christmas') return;
            
            const now = Date.now();
            if (now - lastClickTime < 300) {
                rapidClicks++;
                
                if (rapidClicks === 10) {
                    showNotification('🎅 Santa sees you clicking so fast... Naughty list? 📝', 'christmas');
                } else if (rapidClicks === 20) {
                    showNotification('🎅 Okay okay, you\'re on the Nice list! 😊', 'christmas');
                    createConfettiBurst(['#00ff00', '#ffd700'], 40);
                    rapidClicks = 0;
                }
            } else {
                rapidClicks = 0;
            }
            lastClickTime = now;
        });
    }
    
    // Christmas Music Toggle (Visual only - creates jingle text)
    function createMusicToggle() {
        const toggle = document.createElement('div');
        toggle.innerHTML = '🎵';
        toggle.title = 'Toggle festive vibes';
        toggle.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            font-size: 1.8em;
            cursor: pointer;
            pointer-events: auto;
            z-index: 10001;
            opacity: 0.7;
            transition: all 0.3s ease;
        `;
        
        let isPlaying = false;
        let noteInterval;
        
        toggle.addEventListener('click', () => {
            isPlaying = !isPlaying;
            
            if (isPlaying) {
                toggle.style.opacity = '1';
                toggle.style.animation = 'music-bounce 0.5s ease infinite';
                showNotification('🎵 Jingle bells, jingle bells, jingle all the way! 🔔', 'christmas');
                
                // Floating music notes
                noteInterval = setInterval(() => {
                    const note = document.createElement('div');
                    note.textContent = ['🎵', '🎶', '🎼', '🔔'][Math.floor(Math.random() * 4)];
                    note.style.cssText = `
                        position: fixed;
                        bottom: 100px;
                        right: ${30 + Math.random() * 60}px;
                        font-size: 1.2em;
                        animation: note-float 3s ease-out forwards;
                        z-index: 10000;
                        pointer-events: none;
                    `;
                    effectsContainer.appendChild(note);
                    setTimeout(() => note.remove(), 3000);
                }, 800);
            } else {
                toggle.style.opacity = '0.7';
                toggle.style.animation = 'none';
                clearInterval(noteInterval);
                showNotification('🔇 Music paused', 'christmas');
            }
        });
        
        toggle.addEventListener('mouseenter', () => {
            toggle.style.transform = 'scale(1.2)';
        });
        
        toggle.addEventListener('mouseleave', () => {
            toggle.style.transform = 'scale(1)';
        });
        
        effectsContainer.appendChild(toggle);
    }
    
    // Snowman Builder Easter Egg
    function setupSnowmanBuilder() {
        let snowballCount = 0;
        const snowmanParts = [];
        
        // Type "build" to start building
        document.addEventListener('keydown', (e) => {
            if (currentTheme !== 'christmas') return;
        });
        
        // Secret: Click in corner 3 times
        const corner = document.createElement('div');
        corner.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            width: 50px;
            height: 50px;
            z-index: 10001;
            pointer-events: auto;
            cursor: default;
        `;
        
        let cornerClicks = 0;
        corner.addEventListener('click', () => {
            cornerClicks++;
            
            if (cornerClicks === 3) {
                buildSnowman();
                cornerClicks = 0;
            }
        });
        
        effectsContainer.appendChild(corner);
    }
    
    function buildSnowman() {
        showNotification('☃️ Building a snowman...', 'christmas');
        
        const snowman = document.createElement('div');
        snowman.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 0;
            z-index: 10010;
            transition: font-size 0.5s ease;
        `;
        document.body.appendChild(snowman);
        
        // Build animation
        setTimeout(() => {
            snowman.textContent = '⚪';
            snowman.style.fontSize = '4em';
        }, 500);
        
        setTimeout(() => {
            snowman.innerHTML = '⚪<br>⚪';
            showNotification('☃️ Adding middle...', 'christmas');
        }, 1500);
        
        setTimeout(() => {
            snowman.innerHTML = '⛄';
            snowman.style.fontSize = '6em';
            showNotification('☃️ Perfect snowman built! ⛄', 'christmas');
            createConfettiBurst(['#ffffff', '#87CEEB'], 50);
        }, 2500);
        
        setTimeout(() => {
            snowman.style.opacity = '0';
            setTimeout(() => snowman.remove(), 500);
        }, 8000);
    }

    function createSnowfall() {
        const snowflakes = ['❄', '❅', '❆', '✻', '✼', '❉', '∗'];
        for (let i = 0; i < CONFIG.particleCount; i++) {
            setTimeout(() => {
                createSnowflake(snowflakes[Math.floor(Math.random() * snowflakes.length)]);
            }, i * 200);
        }
        
        // Continuous snowfall
        setInterval(() => {
            if (currentTheme === 'christmas') {
                createSnowflake(snowflakes[Math.floor(Math.random() * snowflakes.length)]);
            }
        }, 800);
    }

    function createSnowflake(char) {
        const flake = document.createElement('div');
        flake.className = 'snow-particle';
        flake.textContent = char;
        flake.style.cssText = `
            position: absolute;
            top: -20px;
            left: ${Math.random() * 100}%;
            font-size: ${0.8 + Math.random() * 1.2}em;
            color: #fff;
            text-shadow: 0 0 5px rgba(255,255,255,0.8);
            opacity: ${0.6 + Math.random() * 0.4};
            animation: snowfall ${8 + Math.random() * 10}s linear forwards;
            pointer-events: none;
        `;
        effectsContainer.appendChild(flake);
        
        setTimeout(() => flake.remove(), 18000);
    }

    function createChristmasLights() {
        const lightsBar = document.createElement('div');
        lightsBar.className = 'christmas-lights';
        lightsBar.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 30px;
            display: flex;
            justify-content: space-around;
            align-items: flex-start;
            z-index: 10000;
            pointer-events: none;
        `;

        const colors = ['#ff0000', '#00ff00', '#ffff00', '#0080ff', '#ff00ff', '#ff8000'];
        const bulbCount = Math.floor(window.innerWidth / 40);
        
        for (let i = 0; i < bulbCount; i++) {
            const bulb = document.createElement('div');
            const color = colors[i % colors.length];
            bulb.className = 'light-bulb';
            bulb.style.cssText = `
                width: 12px;
                height: 16px;
                background: ${color};
                border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
                box-shadow: 0 0 10px ${color}, 0 0 20px ${color}, 0 0 30px ${color};
                animation: twinkle ${0.5 + Math.random() * 1}s ease-in-out infinite alternate;
                animation-delay: ${Math.random() * 2}s;
                position: relative;
            `;
            
            // Wire
            const wire = document.createElement('div');
            wire.style.cssText = `
                position: absolute;
                top: -8px;
                left: 50%;
                width: 2px;
                height: 10px;
                background: #333;
                transform: translateX(-50%);
            `;
            bulb.appendChild(wire);
            lightsBar.appendChild(bulb);
        }

        effectsContainer.appendChild(lightsBar);
    }

    function addSantaHat() {
        const logo = document.querySelector('.logo img, .brand img, .navbar-brand img, [class*="logo"] img');
        if (logo) {
            const hat = document.createElement('span');
            hat.textContent = '🎅';
            hat.style.cssText = `
                position: absolute;
                top: -15px;
                left: 50%;
                transform: translateX(-50%);
                font-size: 1.5em;
                z-index: 1000;
            `;
            logo.parentElement.style.position = 'relative';
            logo.parentElement.appendChild(hat);
        }
    }

    function createHiddenPresent() {
        const present = document.createElement('div');
        present.className = 'hidden-present';
        present.textContent = '🎁';
        present.style.cssText = `
            position: fixed;
            bottom: ${20 + Math.random() * 100}px;
            right: ${20 + Math.random() * 100}px;
            font-size: 2em;
            cursor: pointer;
            pointer-events: auto;
            opacity: 0.3;
            transition: all 0.3s ease;
            animation: present-wiggle 3s ease-in-out infinite;
            z-index: 10001;
        `;
        
        present.addEventListener('mouseenter', () => {
            present.style.opacity = '1';
            present.style.transform = 'scale(1.2)';
        });
        
        present.addEventListener('mouseleave', () => {
            present.style.opacity = '0.3';
            present.style.transform = 'scale(1)';
        });
        
        present.addEventListener('click', () => {
            triggerChristmasEasterEgg();
            present.style.display = 'none';
            setTimeout(() => {
                present.style.display = 'block';
                present.style.bottom = `${20 + Math.random() * 100}px`;
                present.style.right = `${20 + Math.random() * 100}px`;
            }, 30000);
        });

        effectsContainer.appendChild(present);
    }

    function triggerChristmasEasterEgg() {
        const messages = [
            "🎄 Merry Christmas! Here's some holiday cheer!",
            "🎅 Ho Ho Ho! Santa says you've been nice this year!",
            "⭐ May your holidays be bright!",
            "🦌 Rudolph says hi!",
            "🍪 Don't forget to leave cookies for Santa!",
            "☃️ Let it snow, let it snow, let it snow!",
            "🎁 The best gift is the friends we made along the way!"
        ];
        
        showNotification(messages[Math.floor(Math.random() * messages.length)], 'christmas');
        createConfettiBurst(['#ff0000', '#00ff00', '#ffd700', '#ffffff']);
    }

    // ==========================================
    // 🎃 HALLOWEEN EFFECTS
    // ==========================================
    function startHalloweenEffects() {
        // Flying bats
        createFlyingBats();
        
        // Flickering effect
        createFlickerEffect();
        
        // Hidden ghost
        createHiddenGhost();
        
        // Spooky spider
        createSpider();
    }

    function createFlyingBats() {
        const bats = ['🦇', '🦇', '🦇', '🎃', '👻'];
        
        setInterval(() => {
            if (currentTheme === 'halloween' && Math.random() < 0.3) {
                const bat = document.createElement('div');
                bat.textContent = bats[Math.floor(Math.random() * bats.length)];
                bat.style.cssText = `
                    position: absolute;
                    left: -50px;
                    top: ${10 + Math.random() * 50}%;
                    font-size: ${1.5 + Math.random() * 1}em;
                    animation: bat-fly ${8 + Math.random() * 7}s linear forwards;
                    opacity: 0.8;
                `;
                effectsContainer.appendChild(bat);
                setTimeout(() => bat.remove(), 15000);
            }
        }, 3000);
    }

    function createFlickerEffect() {
        const overlay = document.createElement('div');
        overlay.className = 'flicker-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0);
            pointer-events: none;
            z-index: 9998;
        `;
        effectsContainer.appendChild(overlay);

        // Random flicker
        setInterval(() => {
            if (currentTheme === 'halloween' && Math.random() < 0.05) {
                overlay.style.background = 'rgba(0,0,0,0.3)';
                setTimeout(() => {
                    overlay.style.background = 'rgba(0,0,0,0)';
                }, 100);
            }
        }, 2000);
    }

    function createHiddenGhost() {
        const ghost = document.createElement('div');
        ghost.className = 'hidden-ghost';
        ghost.textContent = '👻';
        ghost.style.cssText = `
            position: fixed;
            bottom: ${50 + Math.random() * 150}px;
            left: ${50 + Math.random() * 150}px;
            font-size: 2.5em;
            cursor: pointer;
            pointer-events: auto;
            opacity: 0.1;
            transition: all 0.3s ease;
            z-index: 10001;
        `;
        
        ghost.addEventListener('mouseenter', () => {
            ghost.style.opacity = '1';
            ghost.style.transform = 'scale(1.5)';
            showNotification('👻 BOO!!! 👻', 'halloween');
            document.body.style.animation = 'shake 0.5s ease';
            setTimeout(() => {
                document.body.style.animation = '';
            }, 500);
        });
        
        ghost.addEventListener('mouseleave', () => {
            ghost.style.opacity = '0.1';
            ghost.style.transform = 'scale(1)';
        });

        effectsContainer.appendChild(ghost);
    }

    function createSpider() {
        const spider = document.createElement('div');
        spider.innerHTML = '🕷️';
        spider.style.cssText = `
            position: fixed;
            top: -50px;
            right: 50px;
            font-size: 2em;
            transition: top 2s ease-in-out;
            z-index: 10001;
        `;
        
        // Web string
        const web = document.createElement('div');
        web.style.cssText = `
            position: fixed;
            top: 0;
            right: 62px;
            width: 2px;
            height: 0;
            background: linear-gradient(to bottom, rgba(255,255,255,0.8), rgba(255,255,255,0.3));
            transition: height 2s ease-in-out;
            z-index: 10000;
        `;
        
        effectsContainer.appendChild(web);
        effectsContainer.appendChild(spider);

        // Spider drops down on scroll
        let hasDropped = false;
        window.addEventListener('scroll', () => {
            if (currentTheme === 'halloween' && !hasDropped && window.scrollY > 200) {
                hasDropped = true;
                spider.style.top = '150px';
                web.style.height = '150px';
                
                setTimeout(() => {
                    spider.style.top = '-50px';
                    web.style.height = '0';
                    setTimeout(() => {
                        hasDropped = false;
                    }, 2000);
                }, 3000);
            }
        });
    }

    function triggerHalloweenEasterEgg() {
        const messages = [
            "🎃 Trick or Treat! You found a secret!",
            "👻 The spirits are pleased with you...",
            "🦇 Something spooky this way comes!",
            "🕸️ You've wandered into the web of secrets!",
            "💀 Boo! Did I scare you?",
            "🧙 Double, double toil and trouble!",
            "🌙 The witching hour approaches..."
        ];
        
        showNotification(messages[Math.floor(Math.random() * messages.length)], 'halloween');
        
        // Screen goes dark briefly
        const darkness = document.createElement('div');
        darkness.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: black;
            z-index: 99999;
            opacity: 0;
            transition: opacity 0.3s;
            pointer-events: none;
        `;
        document.body.appendChild(darkness);
        
        setTimeout(() => darkness.style.opacity = '0.8', 10);
        setTimeout(() => darkness.style.opacity = '0', 500);
        setTimeout(() => darkness.remove(), 1000);
    }

    // ==========================================
    // 🐰 EASTER EFFECTS
    // ==========================================
    function startEasterEffects() {
        // Bouncing eggs
        createBouncingEggs();
        
        // Bunny ears on avatars
        addBunnyEars();
        
        // Hidden egg hunt
        createHiddenEggs();
        
        // Rainbow cursor trail
        enableRainbowCursor();
    }

    function createBouncingEggs() {
        const eggs = ['🥚', '🐣', '🥚', '🐰', '🌷', '🦋'];
        
        setInterval(() => {
            if (currentTheme === 'easter' && Math.random() < 0.4) {
                const egg = document.createElement('div');
                egg.textContent = eggs[Math.floor(Math.random() * eggs.length)];
                egg.style.cssText = `
                    position: absolute;
                    top: -40px;
                    left: ${Math.random() * 100}%;
                    font-size: ${1.2 + Math.random() * 0.8}em;
                    animation: egg-tumble ${8 + Math.random() * 6}s linear forwards;
                    opacity: 0.85;
                `;
                effectsContainer.appendChild(egg);
                setTimeout(() => egg.remove(), 14000);
            }
        }, 1500);
    }

    function addBunnyEars() {
        const avatars = document.querySelectorAll('.avatar, .user-avatar, [class*="avatar"] img');
        avatars.forEach(avatar => {
            if (avatar.closest('.bunny-ear-added')) return;
            const wrapper = avatar.parentElement;
            wrapper.style.position = 'relative';
            wrapper.classList.add('bunny-ear-added');
            
            const ears = document.createElement('span');
            ears.textContent = '🐰';
            ears.style.cssText = `
                position: absolute;
                top: -12px;
                left: 50%;
                transform: translateX(-50%);
                font-size: 0.8em;
                z-index: 10;
                filter: grayscale(0.3);
            `;
            wrapper.appendChild(ears);
        });
    }

    let hiddenEggsFound = 0;
    const totalHiddenEggs = 5;
    
    function createHiddenEggs() {
        const eggColors = ['🥚', '🟡', '🟢', '🔵', '🟣'];
        
        for (let i = 0; i < totalHiddenEggs; i++) {
            setTimeout(() => {
                const egg = document.createElement('div');
                egg.className = 'hidden-easter-egg';
                egg.textContent = eggColors[i];
                egg.dataset.found = 'false';
                egg.style.cssText = `
                    position: fixed;
                    top: ${20 + Math.random() * 60}%;
                    left: ${10 + Math.random() * 80}%;
                    font-size: 1.5em;
                    cursor: pointer;
                    pointer-events: auto;
                    opacity: 0.15;
                    transition: all 0.3s ease;
                    z-index: 10001;
                    filter: blur(1px);
                `;
                
                egg.addEventListener('mouseenter', () => {
                    egg.style.opacity = '1';
                    egg.style.transform = 'scale(1.3)';
                    egg.style.filter = 'blur(0)';
                });
                
                egg.addEventListener('mouseleave', () => {
                    if (egg.dataset.found === 'false') {
                        egg.style.opacity = '0.15';
                        egg.style.transform = 'scale(1)';
                        egg.style.filter = 'blur(1px)';
                    }
                });
                
                egg.addEventListener('click', () => {
                    if (egg.dataset.found === 'true') return;
                    egg.dataset.found = 'true';
                    hiddenEggsFound++;
                    
                    egg.style.animation = 'egg-collect 0.5s ease forwards';
                    
                    if (hiddenEggsFound === totalHiddenEggs) {
                        setTimeout(() => {
                            showNotification('🎉 You found all the Easter eggs! Happy Easter! 🐰', 'easter');
                            createConfettiBurst(['#ffb6c1', '#98fb98', '#87ceeb', '#dda0dd', '#ffd700']);
                        }, 500);
                    } else {
                        showNotification(`🥚 Found ${hiddenEggsFound}/${totalHiddenEggs} eggs!`, 'easter');
                    }
                    
                    setTimeout(() => egg.remove(), 500);
                });
                
                effectsContainer.appendChild(egg);
            }, i * 500);
        }
    }

    let rainbowCursorEnabled = false;
    function enableRainbowCursor() {
        if (rainbowCursorEnabled) return;
        rainbowCursorEnabled = true;
        
        const colors = ['#ffb6c1', '#98fb98', '#87ceeb', '#dda0dd', '#ffd700'];
        let colorIndex = 0;
        
        document.addEventListener('mousemove', (e) => {
            if (currentTheme !== 'easter') return;
            if (Math.random() > 0.3) return;
            
            const trail = document.createElement('div');
            trail.style.cssText = `
                position: fixed;
                left: ${e.clientX}px;
                top: ${e.clientY}px;
                width: 8px;
                height: 8px;
                background: ${colors[colorIndex % colors.length]};
                border-radius: 50%;
                pointer-events: none;
                animation: trail-fade 0.6s ease-out forwards;
                z-index: 9998;
            `;
            effectsContainer.appendChild(trail);
            colorIndex++;
            setTimeout(() => trail.remove(), 600);
        });
    }

    function triggerEasterEasterEgg() {
        const messages = [
            "🐰 Hoppy Easter! You found a secret!",
            "🥚 Some-bunny loves you!",
            "🌷 Spring has sprung!",
            "🐣 A little birdie told me you're awesome!",
            "🦋 Spread your wings and fly!"
        ];
        showNotification(messages[Math.floor(Math.random() * messages.length)], 'easter');
        createConfettiBurst(['#ffb6c1', '#98fb98', '#87ceeb', '#dda0dd']);
    }

    // ==========================================
    // 💕 VALENTINE'S EFFECTS
    // ==========================================
    function startValentinesEffects() {
        // Floating hearts
        createFloatingHearts();
        
        // Cupid cursor
        enableCupidCursor();
        
        // Love letter easter egg
        createLoveLetter();
        
        // Rose petal burst on click
        enableRosePetalClick();
    }

    function createFloatingHearts() {
        const hearts = ['❤️', '💕', '💖', '💗', '💓', '💘', '💝', '🌹'];
        
        setInterval(() => {
            if (currentTheme === 'valentines' && Math.random() < 0.5) {
                const heart = document.createElement('div');
                heart.textContent = hearts[Math.floor(Math.random() * hearts.length)];
                heart.style.cssText = `
                    position: absolute;
                    bottom: -40px;
                    left: ${Math.random() * 100}%;
                    font-size: ${1 + Math.random() * 1}em;
                    animation: heart-rise ${6 + Math.random() * 6}s ease-out forwards;
                    opacity: 0.8;
                `;
                effectsContainer.appendChild(heart);
                setTimeout(() => heart.remove(), 12000);
            }
        }, 1200);
    }

    function enableCupidCursor() {
        // Add subtle heart trail on hover
        document.addEventListener('mousemove', (e) => {
            if (currentTheme !== 'valentines') return;
            if (Math.random() > 0.1) return;
            
            const heart = document.createElement('div');
            heart.textContent = '💕';
            heart.style.cssText = `
                position: fixed;
                left: ${e.clientX + 10}px;
                top: ${e.clientY + 10}px;
                font-size: 0.8em;
                pointer-events: none;
                animation: mini-heart-float 1s ease-out forwards;
                z-index: 9998;
            `;
            effectsContainer.appendChild(heart);
            setTimeout(() => heart.remove(), 1000);
        });
    }

    function createLoveLetter() {
        const letter = document.createElement('div');
        letter.className = 'love-letter';
        letter.textContent = '💌';
        letter.style.cssText = `
            position: fixed;
            bottom: ${30 + Math.random() * 80}px;
            right: ${30 + Math.random() * 80}px;
            font-size: 2em;
            cursor: pointer;
            pointer-events: auto;
            opacity: 0.4;
            transition: all 0.3s ease;
            animation: letter-float 3s ease-in-out infinite;
            z-index: 10001;
        `;
        
        letter.addEventListener('mouseenter', () => {
            letter.style.opacity = '1';
            letter.style.transform = 'scale(1.2) rotate(10deg)';
        });
        
        letter.addEventListener('mouseleave', () => {
            letter.style.opacity = '0.4';
            letter.style.transform = 'scale(1) rotate(0deg)';
        });
        
        letter.addEventListener('click', () => {
            const loveMessages = [
                "💕 Love is in the air!",
                "❤️ You are loved!",
                "💘 Cupid says hi!",
                "🌹 You're simply the best!",
                "💖 Sending virtual hugs!",
                "💝 You make the world brighter!"
            ];
            showNotification(loveMessages[Math.floor(Math.random() * loveMessages.length)], 'valentines');
            createConfettiBurst(['#ff69b4', '#ff1493', '#ffb6c1', '#ff0000', '#ffffff']);
            
            // Move letter to new position
            letter.style.bottom = `${30 + Math.random() * 80}px`;
            letter.style.right = `${30 + Math.random() * 80}px`;
        });
        
        effectsContainer.appendChild(letter);
    }

    function enableRosePetalClick() {
        document.addEventListener('click', (e) => {
            if (currentTheme !== 'valentines') return;
            if (Math.random() > 0.3) return;
            
            for (let i = 0; i < 5; i++) {
                setTimeout(() => {
                    const petal = document.createElement('div');
                    petal.textContent = '🌸';
                    petal.style.cssText = `
                        position: fixed;
                        left: ${e.clientX}px;
                        top: ${e.clientY}px;
                        font-size: 1em;
                        pointer-events: none;
                        animation: petal-scatter 1s ease-out forwards;
                        --tx: ${(Math.random() - 0.5) * 100}px;
                        --ty: ${(Math.random() - 0.5) * 100}px;
                        z-index: 9998;
                    `;
                    effectsContainer.appendChild(petal);
                    setTimeout(() => petal.remove(), 1000);
                }, i * 50);
            }
        });
    }

    // ==========================================
    // 🍀 ST. PATRICK'S EFFECTS
    // ==========================================
    function startStPatricksEffects() {
        // Falling shamrocks
        createFallingShamrocks();
        
        // Hidden pot of gold
        createPotOfGold();
        
        // Rainbow effect
        createRainbow();
        
        // Gold coin shower on click
        enableGoldCoinShower();
    }

    function createFallingShamrocks() {
        const items = ['🍀', '☘️', '🪙', '🍀', '☘️'];
        
        setInterval(() => {
            if (currentTheme === 'stpatricks' && Math.random() < 0.4) {
                const item = document.createElement('div');
                item.textContent = items[Math.floor(Math.random() * items.length)];
                item.style.cssText = `
                    position: absolute;
                    top: -30px;
                    left: ${Math.random() * 100}%;
                    font-size: ${1 + Math.random() * 0.6}em;
                    animation: shamrock-tumble ${7 + Math.random() * 5}s linear forwards;
                    opacity: 0.85;
                `;
                effectsContainer.appendChild(item);
                setTimeout(() => item.remove(), 12000);
            }
        }, 1800);
    }

    function createPotOfGold() {
        const pot = document.createElement('div');
        pot.className = 'pot-of-gold';
        pot.innerHTML = '🏺<span class="gold-shine">✨</span>';
        pot.style.cssText = `
            position: fixed;
            bottom: ${20 + Math.random() * 60}px;
            left: ${20 + Math.random() * 60}px;
            font-size: 2.5em;
            cursor: pointer;
            pointer-events: auto;
            opacity: 0.3;
            transition: all 0.3s ease;
            z-index: 10001;
        `;
        
        pot.addEventListener('mouseenter', () => {
            pot.style.opacity = '1';
            pot.style.transform = 'scale(1.2)';
        });
        
        pot.addEventListener('mouseleave', () => {
            pot.style.opacity = '0.3';
            pot.style.transform = 'scale(1)';
        });
        
        let goldClicks = 0;
        pot.addEventListener('click', () => {
            goldClicks++;
            
            // Spray gold coins
            for (let i = 0; i < 10; i++) {
                setTimeout(() => {
                    const coin = document.createElement('div');
                    coin.textContent = '🪙';
                    coin.style.cssText = `
                        position: fixed;
                        left: ${pot.getBoundingClientRect().left + 20}px;
                        top: ${pot.getBoundingClientRect().top}px;
                        font-size: 1.5em;
                        pointer-events: none;
                        animation: coin-spray 1s ease-out forwards;
                        --tx: ${(Math.random() - 0.5) * 200}px;
                        --ty: ${-50 - Math.random() * 150}px;
                        z-index: 100000;
                    `;
                    effectsContainer.appendChild(coin);
                    setTimeout(() => coin.remove(), 1000);
                }, i * 30);
            }
            
            if (goldClicks === 7) {
                showNotification("🌈 You found the leprechaun's gold! 🍀", 'stpatricks');
                goldClicks = 0;
            }
        });
        
        effectsContainer.appendChild(pot);
    }

    function createRainbow() {
        const rainbow = document.createElement('div');
        rainbow.className = 'theme-rainbow';
        rainbow.style.cssText = `
            position: fixed;
            top: 10%;
            right: -100px;
            width: 300px;
            height: 150px;
            background: conic-gradient(
                from 180deg,
                #ff0000 0deg,
                #ff8000 30deg,
                #ffff00 60deg,
                #00ff00 90deg,
                #0080ff 120deg,
                #8000ff 150deg,
                transparent 180deg
            );
            border-radius: 150px 150px 0 0;
            opacity: 0.3;
            pointer-events: none;
            z-index: 1;
            transform: rotate(-30deg);
            filter: blur(2px);
        `;
        effectsContainer.appendChild(rainbow);
    }

    function enableGoldCoinShower() {
        document.addEventListener('dblclick', (e) => {
            if (currentTheme !== 'stpatricks') return;
            
            showNotification("🪙 Gold coin shower! 🪙", 'stpatricks');
            
            for (let i = 0; i < 20; i++) {
                setTimeout(() => {
                    const coin = document.createElement('div');
                    coin.textContent = '🪙';
                    coin.style.cssText = `
                        position: fixed;
                        top: -30px;
                        left: ${Math.random() * 100}%;
                        font-size: 1.5em;
                        animation: coin-fall ${1 + Math.random() * 2}s linear forwards;
                        z-index: 100000;
                    `;
                    effectsContainer.appendChild(coin);
                    setTimeout(() => coin.remove(), 3000);
                }, i * 50);
            }
        });
    }

    function startNewYearEffects() {
        console.log('🎆 New Year effects activated!');
        
        // Create countdown overlay
        createNewYearCountdown();
        
        // Start fireworks
        startFireworks();
        
        // Add sparkle effects
        startSparkleEffect();
        
        // Add golden confetti periodically
        setInterval(() => {
            if (Math.random() > 0.7) {
                createGoldenConfetti();
            }
        }, 3000);
    }

    function createNewYearCountdown() {
        // Check if countdown already exists
        if (document.getElementById('new-year-countdown')) return;
        
        const countdown = document.createElement('div');
        countdown.id = 'new-year-countdown';
        countdown.innerHTML = `
            <div class="countdown-container">
                <div class="countdown-title">🎆 NEW YEAR 2026 🎆</div>
                <div class="countdown-timer">
                    <div class="countdown-item">
                        <span class="countdown-value" id="countdown-days">00</span>
                        <span class="countdown-label">Days</span>
                    </div>
                    <div class="countdown-separator">:</div>
                    <div class="countdown-item">
                        <span class="countdown-value" id="countdown-hours">00</span>
                        <span class="countdown-label">Hours</span>
                    </div>
                    <div class="countdown-separator">:</div>
                    <div class="countdown-item">
                        <span class="countdown-value" id="countdown-minutes">00</span>
                        <span class="countdown-label">Minutes</span>
                    </div>
                    <div class="countdown-separator">:</div>
                    <div class="countdown-item">
                        <span class="countdown-value" id="countdown-seconds">00</span>
                        <span class="countdown-label">Seconds</span>
                    </div>
                </div>
                <div class="countdown-message" id="countdown-message"></div>
            </div>
        `;
        countdown.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 9999;
            pointer-events: none;
        `;
        
        // Add styles
        const style = document.createElement('style');
        style.id = 'new-year-countdown-styles';
        style.textContent = `
            .countdown-container {
                background: linear-gradient(135deg, rgba(255, 215, 0, 0.15) 0%, rgba(255, 140, 0, 0.15) 50%, rgba(255, 69, 0, 0.15) 100%);
                backdrop-filter: blur(10px);
                border: 2px solid rgba(255, 215, 0, 0.4);
                border-radius: 16px;
                padding: 1rem 1.5rem;
                text-align: center;
                box-shadow: 0 0 30px rgba(255, 215, 0, 0.3), inset 0 0 20px rgba(255, 215, 0, 0.1);
                animation: countdown-glow 2s ease-in-out infinite alternate;
            }
            
            @keyframes countdown-glow {
                from { box-shadow: 0 0 30px rgba(255, 215, 0, 0.3), inset 0 0 20px rgba(255, 215, 0, 0.1); }
                to { box-shadow: 0 0 50px rgba(255, 140, 0, 0.5), inset 0 0 30px rgba(255, 215, 0, 0.2); }
            }
            
            .countdown-title {
                font-size: 1.1rem;
                font-weight: 700;
                color: #ffd700;
                text-shadow: 0 0 10px rgba(255, 215, 0, 0.8);
                margin-bottom: 0.75rem;
                letter-spacing: 2px;
            }
            
            .countdown-timer {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
            }
            
            .countdown-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                min-width: 50px;
            }
            
            .countdown-value {
                font-size: 1.75rem;
                font-weight: 800;
                color: #fff;
                text-shadow: 0 0 15px rgba(255, 215, 0, 0.8), 0 0 30px rgba(255, 140, 0, 0.5);
                font-family: 'Courier New', monospace;
                background: linear-gradient(180deg, #ffd700 0%, #ff8c00 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }
            
            .countdown-label {
                font-size: 0.65rem;
                color: rgba(255, 215, 0, 0.8);
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-top: 0.25rem;
            }
            
            .countdown-separator {
                font-size: 1.5rem;
                font-weight: bold;
                color: #ffd700;
                text-shadow: 0 0 10px rgba(255, 215, 0, 0.8);
                animation: separator-blink 1s ease-in-out infinite;
            }
            
            @keyframes separator-blink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.3; }
            }
            
            .countdown-message {
                margin-top: 0.75rem;
                font-size: 0.9rem;
                color: #ffd700;
                font-weight: 600;
                text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
            }
            
            .countdown-celebration {
                animation: celebration-shake 0.5s ease-in-out infinite;
            }
            
            @keyframes celebration-shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-5px) rotate(-2deg); }
                75% { transform: translateX(5px) rotate(2deg); }
            }
            
            /* Firework styles */
            .firework {
                position: fixed;
                pointer-events: none;
                z-index: 9998;
            }
            
            .firework-particle {
                position: absolute;
                width: 4px;
                height: 4px;
                border-radius: 50%;
                animation: firework-explode 1.5s ease-out forwards;
            }
            
            @keyframes firework-explode {
                0% {
                    transform: translate(0, 0) scale(1);
                    opacity: 1;
                }
                100% {
                    transform: translate(var(--tx), var(--ty)) scale(0);
                    opacity: 0;
                }
            }
            
            .firework-trail {
                position: fixed;
                width: 3px;
                height: 20px;
                background: linear-gradient(to top, transparent, #ffd700);
                border-radius: 2px;
                animation: firework-rise 1s ease-out forwards;
                z-index: 9997;
            }
            
            @keyframes firework-rise {
                0% {
                    transform: translateY(0) scaleY(1);
                    opacity: 1;
                }
                100% {
                    transform: translateY(-200px) scaleY(0.5);
                    opacity: 0;
                }
            }
            
            .sparkle {
                position: fixed;
                pointer-events: none;
                z-index: 9996;
                animation: sparkle-twinkle 1s ease-in-out forwards;
            }
            
            @keyframes sparkle-twinkle {
                0% { transform: scale(0) rotate(0deg); opacity: 0; }
                50% { transform: scale(1) rotate(180deg); opacity: 1; }
                100% { transform: scale(0) rotate(360deg); opacity: 0; }
            }
            
            .golden-confetti {
                position: fixed;
                pointer-events: none;
                z-index: 9995;
                animation: confetti-fall 4s linear forwards;
            }
            
            @keyframes confetti-fall {
                0% {
                    transform: translateY(-20px) rotate(0deg);
                    opacity: 1;
                }
                100% {
                    transform: translateY(100vh) rotate(720deg);
                    opacity: 0;
                }
            }
        `;
        
        if (!document.getElementById('new-year-countdown-styles')) {
            document.head.appendChild(style);
        }
        document.body.appendChild(countdown);
        
        // Start countdown update
        updateCountdown();
        setInterval(updateCountdown, 1000);
    }

    function updateCountdown() {
        const now = new Date();
        const currentYear = now.getFullYear();
        const newYear = new Date(currentYear + 1, 0, 1, 0, 0, 0);
        
        // If we're past midnight on Jan 1st, check if we're still in celebration period (first 24 hours)
        const janFirst = new Date(currentYear, 0, 1, 0, 0, 0);
        const janSecond = new Date(currentYear, 0, 2, 0, 0, 0);
        
        let diff, message;
        const daysEl = document.getElementById('countdown-days');
        const hoursEl = document.getElementById('countdown-hours');
        const minutesEl = document.getElementById('countdown-minutes');
        const secondsEl = document.getElementById('countdown-seconds');
        const messageEl = document.getElementById('countdown-message');
        const container = document.querySelector('.countdown-container');
        
        if (!daysEl) return;
        
        // Check if it's currently New Year's Day (Jan 1st)
        if (now >= janFirst && now < janSecond) {
            // It's New Year's Day! Celebration mode
            daysEl.textContent = '🎉';
            hoursEl.textContent = '🎊';
            minutesEl.textContent = '🎆';
            secondsEl.textContent = '🥳';
            messageEl.textContent = `HAPPY NEW YEAR ${currentYear}!`;
            container.classList.add('countdown-celebration');
            
            // Trigger massive celebration
            if (!window.newYearCelebrationTriggered) {
                window.newYearCelebrationTriggered = true;
                triggerNewYearCelebration();
            }
            return;
        }
        
        // Otherwise, count down to next new year
        diff = newYear - now;
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        daysEl.textContent = String(days).padStart(2, '0');
        hoursEl.textContent = String(hours).padStart(2, '0');
        minutesEl.textContent = String(minutes).padStart(2, '0');
        secondsEl.textContent = String(seconds).padStart(2, '0');
        
        // Dynamic messages based on time remaining
        if (days === 0 && hours === 0 && minutes < 1) {
            messageEl.textContent = '🎆 ALMOST THERE! 🎆';
            container.classList.add('countdown-celebration');
        } else if (days === 0 && hours === 0) {
            messageEl.textContent = '⏰ Final countdown!';
        } else if (days === 0) {
            messageEl.textContent = '🌟 Today is the day!';
        } else if (days <= 7) {
            messageEl.textContent = '✨ One week to go!';
        } else {
            messageEl.textContent = `Countdown to ${currentYear + 1}`;
        }
    }

    function triggerNewYearCelebration() {
        // Massive fireworks display
        for (let i = 0; i < 20; i++) {
            setTimeout(() => launchFirework(), i * 200);
        }
        
        // Golden confetti burst
        for (let i = 0; i < 100; i++) {
            setTimeout(() => createGoldenConfetti(), i * 50);
        }
        
        // Show celebration notification
        showNotification('🎉 HAPPY NEW YEAR! 🎆', 'newyear');
    }

    function startFireworks() {
        // Launch fireworks periodically
        setInterval(() => {
            if (Math.random() > 0.5) {
                launchFirework();
            }
        }, 2000);
        
        // Initial burst
        for (let i = 0; i < 3; i++) {
            setTimeout(() => launchFirework(), i * 500);
        }
    }

    function launchFirework() {
        if (!effectsContainer) return;
        
        const x = Math.random() * window.innerWidth;
        const startY = window.innerHeight;
        const endY = 100 + Math.random() * 300;
        
        // Create trail
        const trail = document.createElement('div');
        trail.className = 'firework-trail';
        trail.style.left = x + 'px';
        trail.style.top = startY + 'px';
        effectsContainer.appendChild(trail);
        
        // After trail animation, create explosion
        setTimeout(() => {
            trail.remove();
            createFireworkExplosion(x, endY);
        }, 800);
    }

    function createFireworkExplosion(x, y) {
        if (!effectsContainer) return;
        
        const colors = [
            ['#ffd700', '#ffec8b', '#fff8dc'], // Gold
            ['#ff6b6b', '#ff8e8e', '#ffb3b3'], // Red
            ['#4ecdc4', '#7eddd6', '#a8ece7'], // Teal
            ['#a855f7', '#c084fc', '#d8b4fe'], // Purple
            ['#3b82f6', '#60a5fa', '#93c5fd'], // Blue
            ['#f97316', '#fb923c', '#fdba74'], // Orange
        ];
        
        const colorSet = colors[Math.floor(Math.random() * colors.length)];
        const particleCount = 30 + Math.floor(Math.random() * 20);
        
        const firework = document.createElement('div');
        firework.className = 'firework';
        firework.style.left = x + 'px';
        firework.style.top = y + 'px';
        
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'firework-particle';
            const angle = (i / particleCount) * Math.PI * 2;
            const velocity = 50 + Math.random() * 100;
            const tx = Math.cos(angle) * velocity;
            const ty = Math.sin(angle) * velocity;
            
            particle.style.background = colorSet[Math.floor(Math.random() * colorSet.length)];
            particle.style.boxShadow = `0 0 6px ${colorSet[0]}`;
            particle.style.setProperty('--tx', tx + 'px');
            particle.style.setProperty('--ty', ty + 'px');
            
            firework.appendChild(particle);
        }
        
        effectsContainer.appendChild(firework);
        
        setTimeout(() => firework.remove(), 1500);
    }

    function startSparkleEffect() {
        setInterval(() => {
            if (Math.random() > 0.6) {
                createSparkle();
            }
        }, 500);
    }

    function createSparkle() {
        if (!effectsContainer) return;
        
        const sparkle = document.createElement('div');
        sparkle.className = 'sparkle';
        sparkle.innerHTML = '✨';
        sparkle.style.left = Math.random() * window.innerWidth + 'px';
        sparkle.style.top = Math.random() * window.innerHeight + 'px';
        sparkle.style.fontSize = (10 + Math.random() * 20) + 'px';
        
        effectsContainer.appendChild(sparkle);
        
        setTimeout(() => sparkle.remove(), 1000);
    }

    function createGoldenConfetti() {
        if (!effectsContainer) return;
        
        const confetti = document.createElement('div');
        confetti.className = 'golden-confetti';
        
        const shapes = ['🎊', '🎉', '✨', '⭐', '🌟'];
        const isEmoji = Math.random() > 0.5;
        
        if (isEmoji) {
            confetti.innerHTML = shapes[Math.floor(Math.random() * shapes.length)];
            confetti.style.fontSize = (15 + Math.random() * 15) + 'px';
        } else {
            confetti.style.width = (5 + Math.random() * 10) + 'px';
            confetti.style.height = (10 + Math.random() * 15) + 'px';
            confetti.style.background = `linear-gradient(135deg, #ffd700, #ff8c00)`;
            confetti.style.borderRadius = '2px';
        }
        
        confetti.style.left = Math.random() * window.innerWidth + 'px';
        confetti.style.animationDuration = (3 + Math.random() * 2) + 's';
        
        effectsContainer.appendChild(confetti);
        
        setTimeout(() => confetti.remove(), 5000);
    }

    function startJuly4thEffects() {
        // Phase 3
        console.log('🇺🇸 July 4th effects coming in Phase 3!');
    }

    function startThanksgivingEffects() {
        // Phase 3
        console.log('🦃 Thanksgiving effects coming in Phase 3!');
    }

    function startSpringEffects() {
        // Phase 4
        console.log('🌸 Spring effects coming in Phase 4!');
    }

    function startSummerEffects() {
        // Phase 4
        console.log('☀️ Summer effects coming in Phase 4!');
    }

    function startAutumnEffects() {
        // Phase 4
        console.log('🍂 Autumn effects coming in Phase 4!');
    }

    function startWinterEffects() {
        // Phase 4
        console.log('❄️ Winter effects coming in Phase 4!');
    }

    function startPrideEffects() {
        // Phase 5
        console.log('🏳️‍🌈 Pride effects coming in Phase 5!');
    }

    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================
    function showNotification(message, theme) {
        const notification = document.createElement('div');
        notification.className = `theme-notification ${theme}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0);
            padding: 20px 40px;
            background: rgba(0,0,0,0.9);
            color: #fff;
            font-size: 1.5em;
            border-radius: 15px;
            z-index: 100000;
            text-align: center;
            box-shadow: 0 0 30px rgba(255,255,255,0.3);
            animation: notification-pop 0.5s ease forwards;
            pointer-events: none;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'notification-pop 0.3s ease reverse forwards';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    function createConfettiBurst(colors) {
        for (let i = 0; i < 50; i++) {
            const confetti = document.createElement('div');
            const color = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                width: ${5 + Math.random() * 10}px;
                height: ${5 + Math.random() * 10}px;
                background: ${color};
                border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
                animation: confetti-burst 1.5s ease-out forwards;
                --tx: ${(Math.random() - 0.5) * 400}px;
                --ty: ${(Math.random() - 0.5) * 400}px;
                --r: ${Math.random() * 720}deg;
                z-index: 100001;
                pointer-events: none;
            `;
            effectsContainer.appendChild(confetti);
            setTimeout(() => confetti.remove(), 1500);
        }
    }

    function createRainbowTrail(x, y) {
        const colors = ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#0080ff', '#8000ff'];
        const trail = document.createElement('div');
        trail.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            width: 10px;
            height: 10px;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            border-radius: 50%;
            pointer-events: none;
            animation: trail-fade 0.5s ease-out forwards;
            z-index: 9998;
        `;
        effectsContainer.appendChild(trail);
        setTimeout(() => trail.remove(), 500);
    }

    function createHeartTrail(x, y) {
        const trail = document.createElement('div');
        trail.textContent = '💕';
        trail.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            font-size: 1em;
            pointer-events: none;
            animation: heart-float 1s ease-out forwards;
            z-index: 9998;
        `;
        effectsContainer.appendChild(trail);
        setTimeout(() => trail.remove(), 1000);
    }

    // ==========================================
    // EASTER EGG TRIGGERS
    // ==========================================
    function checkSecretWords() {
        const themeWords = CONFIG.secretWords[currentTheme] || [];
        const allWords = [...themeWords, 'guardian', 'disco'];
        
        for (const word of allWords) {
            if (typedKeys.includes(word)) {
                typedKeys = '';
                if (word === 'guardian') {
                    triggerGuardianDance();
                } else if (word === 'disco') {
                    triggerPartyMode();
                } else {
                    triggerSecretWordEasterEgg(word);
                }
                break;
            }
        }
    }

    function checkClickEasterEggs(emoji, count) {
        // Christmas: Click tree 7 times
        if (currentTheme === 'christmas' && emoji === '🎄' && count === 7) {
            createConfettiBurst(['#ff0000', '#00ff00', '#ffd700']);
            showNotification('🎄 Christmas Tree Power! 🎄', 'christmas');
        }
        
        // Halloween: Triple click pumpkin
        if (currentTheme === 'halloween' && emoji === '🎃' && count === 3) {
            triggerHalloweenEasterEgg();
        }
        
        // Click heart 5 times for valentines
        if (currentTheme === 'valentines' && (emoji === '❤️' || emoji === '💕') && count === 5) {
            createConfettiBurst(['#ff69b4', '#ff1493', '#ffb6c1', '#ff0000']);
            showNotification('💕 Love is in the air! 💕', 'valentines');
        }
    }

    function triggerKonamiEasterEgg() {
        showNotification('🎮 KONAMI CODE ACTIVATED! 🎮', currentTheme);
        
        // Theme-specific konami effects
        switch(currentTheme) {
            case 'christmas':
                // Santa sleigh flies across
                const sleigh = document.createElement('div');
                sleigh.textContent = '🛷🎅🦌🦌🦌';
                sleigh.style.cssText = `
                    position: fixed;
                    top: 20%;
                    left: -200px;
                    font-size: 3em;
                    animation: sleigh-fly 4s linear forwards;
                    z-index: 100000;
                `;
                effectsContainer.appendChild(sleigh);
                setTimeout(() => sleigh.remove(), 4000);
                break;
                
            case 'halloween':
                // Skeleton army
                for (let i = 0; i < 10; i++) {
                    setTimeout(() => {
                        const skeleton = document.createElement('div');
                        skeleton.textContent = '💀';
                        skeleton.style.cssText = `
                            position: fixed;
                            bottom: -50px;
                            left: ${Math.random() * 100}%;
                            font-size: 3em;
                            animation: skeleton-rise 3s ease-out forwards;
                            z-index: 100000;
                        `;
                        effectsContainer.appendChild(skeleton);
                        setTimeout(() => skeleton.remove(), 3000);
                    }, i * 200);
                }
                break;
            
            case 'easter':
                // Giant bunny hops across
                const bunny = document.createElement('div');
                bunny.textContent = '🐰';
                bunny.style.cssText = `
                    position: fixed;
                    bottom: 10%;
                    left: -100px;
                    font-size: 5em;
                    animation: bunny-across 3s ease-in-out forwards;
                    z-index: 100000;
                `;
                effectsContainer.appendChild(bunny);
                // Eggs trail behind
                for (let i = 0; i < 8; i++) {
                    setTimeout(() => {
                        const egg = document.createElement('div');
                        egg.textContent = ['🥚', '🐣', '🌷'][Math.floor(Math.random() * 3)];
                        egg.style.cssText = `
                            position: fixed;
                            bottom: ${10 + Math.random() * 20}%;
                            left: -50px;
                            font-size: 2em;
                            animation: bunny-across ${2.5 + Math.random()}s ease-in-out forwards;
                            z-index: 99999;
                        `;
                        effectsContainer.appendChild(egg);
                        setTimeout(() => egg.remove(), 3500);
                    }, i * 150);
                }
                setTimeout(() => bunny.remove(), 3000);
                break;
            
            case 'valentines':
                // Heart explosion
                for (let i = 0; i < 30; i++) {
                    setTimeout(() => {
                        const heart = document.createElement('div');
                        heart.textContent = ['❤️', '💕', '💖', '💗', '💘'][Math.floor(Math.random() * 5)];
                        heart.style.cssText = `
                            position: fixed;
                            top: 50%;
                            left: 50%;
                            font-size: ${2 + Math.random() * 2}em;
                            animation: confetti-burst 2s ease-out forwards;
                            --tx: ${(Math.random() - 0.5) * 600}px;
                            --ty: ${(Math.random() - 0.5) * 600}px;
                            --r: ${Math.random() * 360}deg;
                            z-index: 100000;
                            pointer-events: none;
                        `;
                        effectsContainer.appendChild(heart);
                        setTimeout(() => heart.remove(), 2000);
                    }, i * 50);
                }
                break;
            
            case 'stpatricks':
                // Rainbow shoots across with pot of gold
                const rainbow = document.createElement('div');
                rainbow.innerHTML = '🌈';
                rainbow.style.cssText = `
                    position: fixed;
                    top: 30%;
                    left: -150px;
                    font-size: 6em;
                    animation: rainbow-across 3s linear forwards;
                    z-index: 100000;
                `;
                effectsContainer.appendChild(rainbow);
                
                // Pot of gold at the end
                setTimeout(() => {
                    const pot = document.createElement('div');
                    pot.textContent = '🏺✨';
                    pot.style.cssText = `
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%) scale(0);
                        font-size: 5em;
                        animation: pot-appear 1s ease-out forwards;
                        z-index: 100001;
                    `;
                    effectsContainer.appendChild(pot);
                    
                    // Gold coin explosion
                    for (let i = 0; i < 40; i++) {
                        setTimeout(() => {
                            const coin = document.createElement('div');
                            coin.textContent = '🪙';
                            coin.style.cssText = `
                                position: fixed;
                                top: 50%;
                                left: 50%;
                                font-size: 1.5em;
                                animation: confetti-burst 1.5s ease-out forwards;
                                --tx: ${(Math.random() - 0.5) * 500}px;
                                --ty: ${(Math.random() - 0.5) * 500}px;
                                --r: ${Math.random() * 720}deg;
                                z-index: 100000;
                            `;
                            effectsContainer.appendChild(coin);
                            setTimeout(() => coin.remove(), 1500);
                        }, i * 30);
                    }
                    setTimeout(() => pot.remove(), 2000);
                }, 2000);
                
                setTimeout(() => rainbow.remove(), 3000);
                break;
                
            default:
                createConfettiBurst(['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff']);
        }
    }

    function triggerSecretWordEasterEgg(word) {
        const effects = {
            // Christmas
            'hohoho': () => {
                showNotification('🎅 HO HO HO! Merry Christmas! 🎅', 'christmas');
                createConfettiBurst(['#ff0000', '#00ff00', '#ffffff']);
            },
            'santa': () => {
                showNotification('🎅 Santa is watching... Be good! 🎅', 'christmas');
            },
            'jingle': () => {
                showNotification('🔔 Jingle bells, jingle bells! 🔔', 'christmas');
            },
            
            // Halloween
            'trick': () => {
                triggerHalloweenEasterEgg();
            },
            'boo': () => {
                showNotification('👻 BOOOOOO! 👻', 'halloween');
                document.body.style.animation = 'shake 0.5s ease';
                setTimeout(() => document.body.style.animation = '', 500);
            },
            'spooky': () => {
                showNotification('🎃 Spooky scary skeletons! 💀', 'halloween');
            },
            
            // Easter (Phase 2)
            'bunny': () => {
                showNotification('🐰 Hop hop hop! Easter bunny is here! 🐰', 'easter');
                triggerEasterEasterEgg();
            },
            'eggs': () => {
                showNotification('🥚 Have you found all the hidden eggs? 🥚', 'easter');
            },
            'hop': () => {
                showNotification('🐰 Hippity hoppity, Easter\'s on its way! 🐰', 'easter');
                document.body.style.animation = 'bunny-hop 0.5s ease';
                setTimeout(() => document.body.style.animation = '', 500);
            },
            
            // Valentine's (Phase 2)
            'love': () => {
                showNotification('💕 Love is all you need! 💕', 'valentines');
                createConfettiBurst(['#ff69b4', '#ff1493', '#ffb6c1', '#ff0000']);
            },
            'cupid': () => {
                showNotification('💘 Cupid\'s arrow has struck! 💘', 'valentines');
            },
            'heart': () => {
                showNotification('❤️ You have a beautiful heart! ❤️', 'valentines');
                createConfettiBurst(['#ff0000', '#ff69b4', '#ffffff']);
            },
            
            // St. Patrick's (Phase 2)
            'lucky': () => {
                showNotification('🍀 Feeling lucky today! 🍀', 'stpatricks');
                createConfettiBurst(['#228b22', '#ffd700', '#32cd32']);
            },
            'gold': () => {
                showNotification('🪙 You found the leprechaun\'s gold! 🪙', 'stpatricks');
                // Gold coin explosion
                for (let i = 0; i < 30; i++) {
                    setTimeout(() => {
                        const coin = document.createElement('div');
                        coin.textContent = '🪙';
                        coin.style.cssText = `
                            position: fixed;
                            top: 50%;
                            left: 50%;
                            font-size: 1.5em;
                            animation: confetti-burst 1.5s ease-out forwards;
                            --tx: ${(Math.random() - 0.5) * 400}px;
                            --ty: ${(Math.random() - 0.5) * 400}px;
                            --r: ${Math.random() * 720}deg;
                            z-index: 100001;
                            pointer-events: none;
                        `;
                        effectsContainer.appendChild(coin);
                        setTimeout(() => coin.remove(), 1500);
                    }, i * 30);
                }
            },
            'shamrock': () => {
                showNotification('☘️ May the luck of the Irish be with you! ☘️', 'stpatricks');
            }
        };
        
        if (effects[word]) {
            effects[word]();
        } else {
            showNotification(`✨ You found a secret: "${word}"! ✨`, currentTheme);
        }
    }

    function triggerGuardianDance() {
        showNotification('🤖 DarkLock is dancing! 🕺', currentTheme);
        
        const guardian = document.createElement('div');
        guardian.textContent = '🤖';
        guardian.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 5em;
            animation: guardian-dance 2s ease-in-out;
            z-index: 100000;
        `;
        document.body.appendChild(guardian);
        setTimeout(() => guardian.remove(), 2000);
    }

    function triggerPartyMode() {
        if (isPartyMode) return;
        isPartyMode = true;
        
        showNotification('🎉 PARTY MODE ACTIVATED! 🎉', currentTheme);
        document.body.classList.add('party-mode');
        
        // Disco lights
        const disco = document.createElement('div');
        disco.className = 'disco-lights';
        disco.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 9997;
            animation: disco 0.5s linear infinite;
        `;
        effectsContainer.appendChild(disco);
        
        // Stop after 10 seconds
        setTimeout(() => {
            isPartyMode = false;
            document.body.classList.remove('party-mode');
            disco.remove();
            showNotification('🎉 Party\'s over... for now! 🎉', currentTheme);
        }, 10000);
    }

    // ==========================================
    // IDLE DETECTION
    // ==========================================
    function startIdleDetection() {
        resetIdleTimer();
    }

    function resetIdleTimer() {
        clearTimeout(idleTimer);
        document.body.classList.remove('idle-mode');
        
        idleTimer = setTimeout(() => {
            triggerIdleAnimation();
        }, 60000); // 60 seconds
    }

    function triggerIdleAnimation() {
        document.body.classList.add('idle-mode');
        
        const zzz = document.createElement('div');
        zzz.className = 'idle-zzz';
        zzz.innerHTML = 'z<span>z</span><span>z</span>';
        zzz.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 3em;
            color: var(--accent-primary, #5865F2);
            opacity: 0.7;
            animation: zzz-float 2s ease-in-out infinite;
            z-index: 100000;
            pointer-events: none;
        `;
        effectsContainer.appendChild(zzz);
        
        // Remove when user becomes active
        const removeZzz = () => {
            zzz.remove();
            document.removeEventListener('mousemove', removeZzz);
            document.removeEventListener('keydown', removeZzz);
        };
        document.addEventListener('mousemove', removeZzz);
        document.addEventListener('keydown', removeZzz);
    }

    // ==========================================
    // CSS ANIMATIONS (injected dynamically)
    // ==========================================
    function injectAnimationStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes snowfall {
                0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
                100% { transform: translateY(100vh) rotate(360deg); opacity: 0.3; }
            }
            
            @keyframes twinkle {
                0% { opacity: 0.4; transform: scale(0.9); }
                100% { opacity: 1; transform: scale(1.1); }
            }
            
            @keyframes present-wiggle {
                0%, 100% { transform: rotate(-5deg); }
                50% { transform: rotate(5deg); }
            }
            
            @keyframes bat-fly {
                0% { transform: translateX(-50px) translateY(0); opacity: 0; }
                10% { opacity: 0.8; }
                50% { transform: translateX(50vw) translateY(-30px); }
                90% { opacity: 0.8; }
                100% { transform: translateX(100vw) translateY(20px); opacity: 0; }
            }
            
            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-10px); }
                75% { transform: translateX(10px); }
            }
            
            @keyframes notification-pop {
                0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
                50% { transform: translate(-50%, -50%) scale(1.1); }
                100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }
            
            @keyframes confetti-burst {
                0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
                100% { transform: translate(var(--tx), var(--ty)) rotate(var(--r)); opacity: 0; }
            }
            
            @keyframes trail-fade {
                0% { transform: scale(1); opacity: 0.8; }
                100% { transform: scale(0); opacity: 0; }
            }
            
            @keyframes heart-float {
                0% { transform: translateY(0) scale(1); opacity: 1; }
                100% { transform: translateY(-50px) scale(0.5); opacity: 0; }
            }
            
            @keyframes sleigh-fly {
                0% { left: -200px; top: 20%; }
                50% { top: 15%; }
                100% { left: 100vw; top: 20%; }
            }
            
            @keyframes skeleton-rise {
                0% { transform: translateY(0); opacity: 0; }
                20% { opacity: 1; }
                80% { opacity: 1; }
                100% { transform: translateY(-100vh); opacity: 0; }
            }
            
            @keyframes guardian-dance {
                0%, 100% { transform: translate(-50%, -50%) rotate(0deg); }
                25% { transform: translate(-50%, -50%) rotate(15deg) translateY(-20px); }
                50% { transform: translate(-50%, -50%) rotate(-15deg); }
                75% { transform: translate(-50%, -50%) rotate(15deg) translateY(-20px); }
            }
            
            @keyframes disco {
                0% { background: radial-gradient(circle at 20% 20%, rgba(255,0,0,0.1) 0%, transparent 50%); }
                25% { background: radial-gradient(circle at 80% 20%, rgba(0,255,0,0.1) 0%, transparent 50%); }
                50% { background: radial-gradient(circle at 80% 80%, rgba(0,0,255,0.1) 0%, transparent 50%); }
                75% { background: radial-gradient(circle at 20% 80%, rgba(255,255,0,0.1) 0%, transparent 50%); }
                100% { background: radial-gradient(circle at 20% 20%, rgba(255,0,0,0.1) 0%, transparent 50%); }
            }
            
            @keyframes zzz-float {
                0%, 100% { transform: translate(-50%, -50%) translateY(0); }
                50% { transform: translate(-50%, -50%) translateY(-20px); }
            }
            
            .idle-zzz span {
                animation: zzz-letter 1s ease-in-out infinite;
            }
            .idle-zzz span:nth-child(1) { animation-delay: 0.2s; }
            .idle-zzz span:nth-child(2) { animation-delay: 0.4s; }
            
            @keyframes zzz-letter {
                0%, 100% { opacity: 0.5; transform: translateY(0); }
                50% { opacity: 1; transform: translateY(-10px); }
            }
            
            .party-mode {
                animation: party-bg 0.5s linear infinite;
            }
            
            @keyframes party-bg {
                0% { filter: hue-rotate(0deg); }
                100% { filter: hue-rotate(360deg); }
            }
            
            /* Phase 2 Animations - Easter, Valentine's, St. Patrick's */
            @keyframes egg-tumble {
                0% { transform: translateY(-40px) rotate(0deg); opacity: 0.85; }
                25% { transform: translateY(25vh) rotate(90deg) translateX(15px); }
                50% { transform: translateY(50vh) rotate(180deg) translateX(-15px); }
                75% { transform: translateY(75vh) rotate(270deg) translateX(15px); }
                100% { transform: translateY(100vh) rotate(360deg); opacity: 0; }
            }
            
            @keyframes egg-collect {
                0% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.5) rotate(180deg); opacity: 1; }
                100% { transform: scale(0) rotate(360deg); opacity: 0; }
            }
            
            @keyframes heart-rise {
                0% { transform: translateY(0) scale(1); opacity: 0.8; }
                50% { transform: translateY(-50vh) scale(1.2) translateX(20px); opacity: 1; }
                100% { transform: translateY(-100vh) scale(0.8) translateX(-20px); opacity: 0; }
            }
            
            @keyframes mini-heart-float {
                0% { transform: translateY(0) scale(1); opacity: 1; }
                100% { transform: translateY(-30px) scale(0.5); opacity: 0; }
            }
            
            @keyframes letter-float {
                0%, 100% { transform: translateY(0) rotate(-5deg); }
                50% { transform: translateY(-10px) rotate(5deg); }
            }
            
            @keyframes petal-scatter {
                0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
                100% { transform: translate(var(--tx), var(--ty)) rotate(360deg); opacity: 0; }
            }
            
            @keyframes shamrock-tumble {
                0% { transform: translateY(-30px) rotate(0deg) translateX(0); opacity: 0.85; }
                50% { transform: translateY(50vh) rotate(180deg) translateX(25px); }
                100% { transform: translateY(100vh) rotate(360deg) translateX(-25px); opacity: 0; }
            }
            
            @keyframes coin-spray {
                0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
                100% { transform: translate(var(--tx), var(--ty)) rotate(720deg); opacity: 0; }
            }
            
            @keyframes coin-fall {
                0% { transform: translateY(-30px) rotate(0deg); opacity: 1; }
                100% { transform: translateY(100vh) rotate(720deg); opacity: 0.5; }
            }
            
            /* Phase 2 Konami Animations */
            @keyframes bunny-across {
                0% { left: -100px; transform: translateY(0); }
                25% { transform: translateY(-50px); }
                50% { transform: translateY(0); }
                75% { transform: translateY(-50px); }
                100% { left: 100vw; transform: translateY(0); }
            }
            
            @keyframes rainbow-across {
                0% { left: -150px; }
                100% { left: 100vw; }
            }
            
            @keyframes pot-appear {
                0% { transform: translate(-50%, -50%) scale(0) rotate(-180deg); }
                100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); }
            }
            
            @keyframes bunny-hop {
                0%, 100% { transform: translateY(0); }
                25% { transform: translateY(-15px); }
                50% { transform: translateY(0); }
                75% { transform: translateY(-10px); }
            }
            
            /* Christmas Enhanced Animations */
            @keyframes countdown-glow {
                0% { box-shadow: 0 4px 20px rgba(196, 30, 58, 0.4), 0 0 30px rgba(255, 215, 0, 0.2); }
                100% { box-shadow: 0 4px 30px rgba(196, 30, 58, 0.6), 0 0 50px rgba(255, 215, 0, 0.4); }
            }
            
            @keyframes bells-ring {
                0%, 100% { transform: translate(-50%, -50%) rotate(0deg); }
                25% { transform: translate(-50%, -50%) rotate(15deg); }
                75% { transform: translate(-50%, -50%) rotate(-15deg); }
            }
            
            @keyframes santa-fly {
                0% { left: -200px; transform: translateY(0); }
                25% { transform: translateY(-20px); }
                50% { transform: translateY(10px); }
                75% { transform: translateY(-15px); }
                100% { left: calc(100vw + 200px); transform: translateY(0); }
            }
            
            @keyframes ornament-swing {
                0%, 100% { transform: rotate(-8deg); }
                50% { transform: rotate(8deg); }
            }
            
            @keyframes rudolph-fly {
                0% { left: -100px; transform: translateY(0); }
                50% { transform: translateY(-50px); }
                100% { left: calc(100vw + 100px); transform: translateY(0); }
            }
            
            @keyframes fade-out {
                0% { opacity: 1; transform: scale(1); }
                100% { opacity: 0; transform: scale(0.5); }
            }
            
            @keyframes music-bounce {
                0%, 100% { transform: scale(1) translateY(0); }
                50% { transform: scale(1.1) translateY(-5px); }
            }
            
            @keyframes note-float {
                0% { opacity: 1; transform: translateY(0) rotate(0deg); }
                100% { opacity: 0; transform: translateY(-100px) rotate(30deg); }
            }
            
            @keyframes gingerbread-run {
                0% { transform: translateY(0); }
                50% { transform: translateY(-10px); }
                100% { transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // START
    // ==========================================
    injectAnimationStyles();
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for debugging
    window.ThemeEffects = {
        trigger: triggerKonamiEasterEgg,
        party: triggerPartyMode,
        confetti: () => createConfettiBurst(['#ff0000', '#00ff00', '#0000ff', '#ffff00']),
        notify: showNotification
    };

})();
