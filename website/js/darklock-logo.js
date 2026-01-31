// Darklock Logo - Website Version
// Inline SVG logo for brand consistency

(function() {
  'use strict';

  // Logo SVG template - NEW BRAND
  const createLogo = (size = 40) => `
    <svg width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="darklock-logo-svg">
      <defs>
        <linearGradient id="dlGrad-${size}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#60A5FA"/>
          <stop offset="55%" stop-color="#6366F1"/>
          <stop offset="100%" stop-color="#7C3AED"/>
        </linearGradient>
      </defs>
      <path d="M25 19 H56 C72 19 81 28 81 50 C81 72 72 81 56 81 H25 V19 Z M38 31 V69 H55 C62 69 69 62 69 50 C69 38 62 31 55 31 H38 Z" fill="url(#dlGrad-${size})" />
      <path d="M44 41 H56 L50 50 L56 59 H44 V41 Z" fill="#020617" opacity="0.9" />
    </svg>
  `;

  // Replace brand icons with logo on DOM ready
  function replaceBrandIcons() {
    // Replace navbar brand icons
    document.querySelectorAll('.brand-icon').forEach(el => {
      const icon = el.querySelector('i.fa-shield-halved, i.fa-shield');
      if (icon) {
        el.innerHTML = createLogo(32);
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
      }
    });

    // Replace hero shield icons
    document.querySelectorAll('.hero-shield, .shield-icon-large').forEach(el => {
      el.innerHTML = createLogo(120);
    });

    // Replace footer brand icons
    document.querySelectorAll('.footer-brand .brand-icon, .footer .brand-icon').forEach(el => {
      const icon = el.querySelector('i.fa-shield-halved, i.fa-shield');
      if (icon) {
        el.innerHTML = createLogo(32);
      }
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', replaceBrandIcons);
  } else {
    replaceBrandIcons();
  }

  // Expose globally for manual use
  window.DarklockLogo = {
    create: createLogo,
    replace: replaceBrandIcons
  };
})();
