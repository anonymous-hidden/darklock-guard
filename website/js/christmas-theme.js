/**
 * 🎄 Christmas Theme Manager 🎄
 * Seasonal dashboard decorations with snow, lights, and festive styling
 */

(function() {
    'use strict';

    // Configuration
    const CHRISTMAS_CONFIG = {
        snowflakeCount: 40,
        snowflakeSymbols: ['❄', '❅', '❆', '✻', '✼', '❉', '✶'],
        lightColors: ['red', 'green', 'gold', 'blue'],
        lightCount: 30,
        ornaments: ['🎄', '🎁', '⭐', '🔔'],
        bannerText: 'Happy Holidays!',
        storageKey: 'christmas_mode_enabled',
        autoEnable: true, // Auto-enable during Christmas season
        seasonStart: { month: 12, day: 1 },  // December 1st
        seasonEnd: { month: 1, day: 6 }      // January 6th (Epiphany)
    };

    // Check if we're in Christmas season
    function isChristmasSeason() {
        const now = new Date();
        const month = now.getMonth() + 1; // JavaScript months are 0-indexed
        const day = now.getDate();

        // December 1-31 OR January 1-6
        if (month === 12 && day >= CHRISTMAS_CONFIG.seasonStart.day) return true;
        if (month === 1 && day <= CHRISTMAS_CONFIG.seasonEnd.day) return true;
        return false;
    }

    // Create snowfall container
    function createSnowfall() {
        const existing = document.querySelector('.snowfall-container');
        if (existing) return;

        const container = document.createElement('div');
        container.className = 'snowfall-container';
        container.setAttribute('aria-hidden', 'true');

        for (let i = 0; i < CHRISTMAS_CONFIG.snowflakeCount; i++) {
            const snowflake = document.createElement('span');
            snowflake.className = 'snowflake';
            snowflake.textContent = CHRISTMAS_CONFIG.snowflakeSymbols[
                Math.floor(Math.random() * CHRISTMAS_CONFIG.snowflakeSymbols.length)
            ];
            container.appendChild(snowflake);
        }

        document.body.appendChild(container);
    }

    // Create Christmas lights
    function createChristmasLights() {
        const existingLights = document.querySelector('.christmas-lights');
        const existingWire = document.querySelector('.christmas-wire');
        if (existingLights) return;

        // Create wire
        const wire = document.createElement('div');
        wire.className = 'christmas-wire';
        wire.setAttribute('aria-hidden', 'true');
        document.body.appendChild(wire);

        // Create lights container
        const lightsContainer = document.createElement('div');
        lightsContainer.className = 'christmas-lights';
        lightsContainer.setAttribute('aria-hidden', 'true');

        for (let i = 0; i < CHRISTMAS_CONFIG.lightCount; i++) {
            const bulb = document.createElement('span');
            const colorIndex = i % CHRISTMAS_CONFIG.lightColors.length;
            bulb.className = `light-bulb light-${CHRISTMAS_CONFIG.lightColors[colorIndex]}`;
            lightsContainer.appendChild(bulb);
        }

        document.body.appendChild(lightsContainer);
    }

    // Create Christmas banner
    function createChristmasBanner() {
        const existing = document.querySelector('.christmas-banner');
        if (existing) return;

        const banner = document.createElement('div');
        banner.className = 'christmas-banner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        banner.textContent = CHRISTMAS_CONFIG.bannerText;

        document.body.appendChild(banner);
    }

    // Create decorative ornaments
    function createOrnaments() {
        const existing = document.querySelectorAll('.ornament');
        if (existing.length > 0) return;

        CHRISTMAS_CONFIG.ornaments.forEach((emoji, index) => {
            const ornament = document.createElement('span');
            ornament.className = `ornament ornament-${index + 1}`;
            ornament.textContent = emoji;
            ornament.setAttribute('aria-hidden', 'true');
            document.body.appendChild(ornament);
        });
    }

    // Create toggle button
    function createToggleButton() {
        const existing = document.querySelector('.christmas-toggle');
        if (existing) return;

        const toggle = document.createElement('button');
        toggle.className = 'christmas-toggle';
        toggle.setAttribute('aria-label', 'Toggle Christmas theme');
        toggle.setAttribute('title', 'Toggle Christmas theme');
        toggle.innerHTML = document.body.classList.contains('christmas-mode') ? '🎄' : '❄️';
        
        toggle.addEventListener('click', () => {
            toggleChristmasMode();
            toggle.innerHTML = document.body.classList.contains('christmas-mode') ? '🎄' : '❄️';
        });

        document.body.appendChild(toggle);
    }

    // Enable Christmas mode
    function enableChristmasMode() {
        document.body.classList.add('christmas-mode');
        createSnowfall();
        createChristmasLights();
        createChristmasBanner();
        createOrnaments();
        localStorage.setItem(CHRISTMAS_CONFIG.storageKey, 'true');
        
        // Update toggle button icon
        const toggle = document.querySelector('.christmas-toggle');
        if (toggle) toggle.innerHTML = '🎄';
        
        console.log('🎄 Christmas mode enabled! Happy Holidays!');
    }

    // Disable Christmas mode
    function disableChristmasMode() {
        document.body.classList.remove('christmas-mode');
        
        // Remove decorations
        const elementsToRemove = [
            '.snowfall-container',
            '.christmas-lights',
            '.christmas-wire',
            '.christmas-banner',
            '.ornament'
        ];
        
        elementsToRemove.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => el.remove());
        });
        
        localStorage.setItem(CHRISTMAS_CONFIG.storageKey, 'false');
        
        // Update toggle button icon
        const toggle = document.querySelector('.christmas-toggle');
        if (toggle) toggle.innerHTML = '❄️';
        
        console.log('❄️ Christmas mode disabled');
    }

    // Toggle Christmas mode
    function toggleChristmasMode() {
        if (document.body.classList.contains('christmas-mode')) {
            disableChristmasMode();
        } else {
            enableChristmasMode();
        }
    }

    // Initialize Christmas theme
    function initChristmasTheme() {
        // Always create toggle button
        createToggleButton();

        // Check stored preference
        const storedPreference = localStorage.getItem(CHRISTMAS_CONFIG.storageKey);
        
        if (storedPreference === 'true') {
            enableChristmasMode();
        } else if (storedPreference === 'false') {
            // User explicitly disabled, respect that
            return;
        } else if (CHRISTMAS_CONFIG.autoEnable && isChristmasSeason()) {
            // Auto-enable during Christmas season if no preference set
            enableChristmasMode();
        }
    }

    // Expose global API
    window.ChristmasTheme = {
        enable: enableChristmasMode,
        disable: disableChristmasMode,
        toggle: toggleChristmasMode,
        isEnabled: () => document.body.classList.contains('christmas-mode'),
        isSeason: isChristmasSeason,
        config: CHRISTMAS_CONFIG
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChristmasTheme);
    } else {
        initChristmasTheme();
    }

    // Re-initialize after page navigation (for SPA)
    window.addEventListener('popstate', initChristmasTheme);

})();
