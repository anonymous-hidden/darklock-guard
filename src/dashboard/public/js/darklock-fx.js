/**
 * DarkLock FX — Premium Micro-Interaction Engine
 * ================================================
 * One file. Every page. Automatic.
 * 
 * Features:
 *   1.  Cursor glow trail (follows mouse)
 *   2.  Magnetic hover buttons
 *   3.  3D tilt on cards
 *   4.  Ripple click effect
 *   5.  Scroll-reveal animations
 *   6.  Number count-up
 *   7.  Spotlight hover (cards)
 *   8.  Toast notification system
 *   9.  Typewriter text effect
 *  10.  Floating particles (subtle)
 *  11.  Smooth section transitions
 *  12.  Interactive stat cards
 *  13.  Sidebar active trail
 *  14.  Confetti celebration
 *  15.  Command palette hint (Ctrl+K)
 *  16.  Ambient sound toggle (muted by default)
 *  18.  Skeleton → content shimmer transition
 *  19.  Smooth anchor scrolling
 *  20.  Keyboard shortcuts help overlay
 *
 * Branding: #00d4ff (cyan) / #06ffa5 (green) / #7c3aed (purple)
 */

(function DarkLockFX() {
    'use strict';

    // Don't double-init
    if (window.__DL_FX_LOADED) return;
    window.__DL_FX_LOADED = true;

    const BRAND = {
        cyan: '#00d4ff',
        green: '#06ffa5',
        purple: '#7c3aed',
        pink: '#ec4899',
        surface: 'rgba(15,20,35,0.95)',
    };

    // Respect reduced motion — reads OS preference AND the dashboard Reduce Motion toggle
    function _getReducedMotionPref() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
        try { const s = localStorage.getItem('dashboardSettings'); if (s) return !!JSON.parse(s).reduceMotion; } catch (_) {}
        return false;
    }
    let reducedMotion = _getReducedMotionPref();
    const isTouchDevice = window.matchMedia('(hover: none)').matches;

    // React to the dashboard's live Reduce Motion toggle
    window.addEventListener('DLReduceMotion', function (e) {
        reducedMotion = !!e.detail.active;
        const glow = document.querySelector('.dl-cursor-glow');
        if (glow) glow.style.visibility = reducedMotion ? 'hidden' : 'visible';
        if (reducedMotion) {
            // Reset any in-flight JS transforms immediately
            document.querySelectorAll('.dl-tilt').forEach(c => { c.style.transform = ''; });
            document.querySelectorAll('.btn-primary, .dl-magnetic, .cta .btn').forEach(b => { b.style.transform = ''; });
            document.querySelectorAll('.dl-spotlight').forEach(c => c.classList.remove('dl-spotlight'));
            // Instantly reveal any scroll-reveal elements that are still waiting to appear
            document.querySelectorAll('.dl-reveal, .dl-reveal-left, .dl-reveal-right, .dl-reveal-scale').forEach(el => {
                el.classList.add('dl-revealed');
                el.style.opacity = '';
                el.style.transform = '';
            });
            // Clear sidebar stagger in-progress styles
            document.querySelectorAll('.nav-item, .sidebar-nav a, .nav-section').forEach(el => {
                el.style.opacity = '';
                el.style.transform = '';
                el.style.transition = '';
            });
        }
    });

    // ==========================================
    // 1. CURSOR GLOW TRAIL
    // ==========================================
    function initCursorGlow() {
        if (isTouchDevice) return;
        const glow = document.createElement('div');
        glow.className = 'dl-cursor-glow';
        document.body.appendChild(glow);

        let mx = -500, my = -500;
        let cx = -500, cy = -500;

        document.addEventListener('mousemove', e => {
            mx = e.clientX;
            my = e.clientY;
        }, { passive: true });

        function animate() {
            if (reducedMotion) {
                glow.style.visibility = 'hidden';
            } else {
                glow.style.visibility = 'visible';
                cx += (mx - cx) * 0.08;
                cy += (my - cy) * 0.08;
                glow.style.left = cx + 'px';
                glow.style.top = cy + 'px';
            }
            requestAnimationFrame(animate);
        }
        if (reducedMotion) glow.style.visibility = 'hidden';
        animate();
    }

    // ==========================================
    // 2. MAGNETIC HOVER BUTTONS
    // ==========================================
    function initMagneticButtons() {
        if (isTouchDevice) return;

        document.addEventListener('mousemove', e => {
            if (reducedMotion) return;
            const btns = document.querySelectorAll('.btn-primary, .dl-magnetic, .cta .btn');
            btns.forEach(btn => {
                const rect = btn.getBoundingClientRect();
                const bx = rect.left + rect.width / 2;
                const by = rect.top + rect.height / 2;
                const dx = e.clientX - bx;
                const dy = e.clientY - by;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 120) {
                    const pull = (120 - dist) / 120;
                    btn.style.transform = `translate(${dx * pull * 0.15}px, ${dy * pull * 0.15}px)`;
                } else {
                    btn.style.transform = '';
                }
            });
        }, { passive: true });
    }

    // ==========================================
    // 3. 3D TILT CARDS
    // ==========================================
    function initTiltCards() {
        if (isTouchDevice) return;

        function setupTilt(card) {
            if (card.dataset.dlTilt) return;
            card.dataset.dlTilt = '1';
            card.classList.add('dl-tilt');

            // Add shine layer
            if (!card.querySelector('.dl-tilt-shine')) {
                const shine = document.createElement('div');
                shine.className = 'dl-tilt-shine';
                card.appendChild(shine);
            }

            card.addEventListener('mousemove', e => {
                if (reducedMotion) return;
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;
                const tiltX = (0.5 - y) * 8;
                const tiltY = (x - 0.5) * 8;
                card.style.transform = `perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
                card.style.setProperty('--shine-x', (x * 100) + '%');
                card.style.setProperty('--shine-y', (y * 100) + '%');
            }, { passive: true });

            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
            });
        }

        // Setup on existing + observe new
        const selectors = '.chart-container, .dl-tilt-target, .feature, .card, .stat-card, .ws-cell > div, .dl-glow-card, .settings-section, .filter-row';
        document.querySelectorAll(selectors).forEach(setupTilt);

        const obs = new MutationObserver(() => {
            document.querySelectorAll(selectors).forEach(setupTilt);
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // ==========================================
    // 4. RIPPLE CLICK EFFECT
    // ==========================================
    function initRipple() {
        document.addEventListener('click', e => {
            if (reducedMotion) return;
            if (!e.target || typeof e.target.closest !== 'function') return;
            const target = e.target.closest('button, .btn, .nav-item, .dl-ripple, [role="button"]');
            if (!target) return;

            const rect = target.getBoundingClientRect();
            const ripple = document.createElement('span');
            ripple.className = 'dl-ripple-wave';
            const size = Math.max(rect.width, rect.height) * 2;
            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
            ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';

            target.style.position = target.style.position || 'relative';
            target.style.overflow = 'hidden';
            target.appendChild(ripple);
            ripple.addEventListener('animationend', () => ripple.remove());
        });
    }

    // ==========================================
    // 5. SCROLL REVEAL
    // ==========================================
    function initScrollReveal() {
        if (reducedMotion) return;

        // Auto-tag elements
        const autoRevealSelectors = [
            '.settings-section', '.feature', '.card', '.hero-stat',
            '.stat-card', '.dl-reveal', '.dl-reveal-left', '.dl-reveal-right',
            '.dl-reveal-scale', '.filter-row', '.chart-container',
            '.ws-cell', '.nav-section', 'h1', 'h2'
        ];

        function tagElements() {
            autoRevealSelectors.forEach(sel => {
                document.querySelectorAll(sel).forEach((el, i) => {
                    if (!el.classList.contains('dl-reveal') && 
                        !el.classList.contains('dl-reveal-left') && 
                        !el.classList.contains('dl-reveal-right') &&
                        !el.classList.contains('dl-reveal-scale') &&
                        !el.dataset.dlRevealed) {
                        el.classList.add('dl-reveal');
                        el.style.transitionDelay = (i * 0.05) + 's';
                    }
                });
            });
        }

        tagElements();

        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('dl-revealed');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

        function observe() {
            document.querySelectorAll('.dl-reveal, .dl-reveal-left, .dl-reveal-right, .dl-reveal-scale').forEach(el => {
                if (!el.classList.contains('dl-revealed')) io.observe(el);
            });
        }
        observe();

        // Re-run when DOM changes
        const obs = new MutationObserver(() => { tagElements(); observe(); });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // ==========================================
    // 6. NUMBER COUNT-UP
    // ==========================================
    function initCountUp() {
        function animateValue(el) {
            if (el.dataset.dlCounted) return;
            const text = el.textContent.trim();
            
            // Extract number from text
            const match = text.match(/([\d,]+\.?\d*)/);
            if (!match) return;
            
            const end = parseFloat(match[1].replace(/,/g, ''));
            if (isNaN(end) || end === 0) return;

            el.dataset.dlCounted = '1';
            // Skip the animation entirely when reduce motion is active
            if (reducedMotion) return;
            el.classList.add('dl-countup', 'dl-counting');

            const prefix = text.substring(0, text.indexOf(match[1]));
            const suffix = text.substring(text.indexOf(match[1]) + match[1].length);
            const isInt = !match[1].includes('.');
            const duration = Math.min(2000, Math.max(800, end * 2));
            const start = performance.now();

            function step(now) {
                if (reducedMotion) {
                    // Reduce motion was toggled mid-animation — snap to final value
                    el.textContent = text;
                    el.classList.remove('dl-counting');
                    return;
                }
                const elapsed = now - start;
                const progress = Math.min(elapsed / duration, 1);
                // Ease out cubic
                const ease = 1 - Math.pow(1 - progress, 3);
                const current = end * ease;
                
                if (isInt) {
                    el.textContent = prefix + Math.round(current).toLocaleString() + suffix;
                } else {
                    el.textContent = prefix + current.toFixed(1) + suffix;
                }

                if (progress < 1) {
                    requestAnimationFrame(step);
                } else {
                    el.textContent = text; // Restore original
                    setTimeout(() => el.classList.remove('dl-counting'), 1500);
                }
            }
            requestAnimationFrame(step);
        }

        const io = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animateValue(entry.target);
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });

        function scan() {
            const selectors = '.num, .stat-value, .stat-number, .hero-stat .stat-value, .dl-countup, [data-countup]';
            document.querySelectorAll(selectors).forEach(el => {
                if (!el.dataset.dlCounted) io.observe(el);
            });
        }
        scan();
        const obs = new MutationObserver(scan);
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // ==========================================
    // 7. SPOTLIGHT HOVER ON PANELS
    // ==========================================
    function initSpotlight() {
        if (isTouchDevice) return;

        document.addEventListener('mousemove', e => {
            if (reducedMotion) return;
            const cards = document.querySelectorAll('.dl-spotlight, .settings-section, .filters, .feature, [class*="card"]:not(body)');
            cards.forEach(card => {
                const rect = card.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right && 
                    e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    card.style.setProperty('--spot-x', (e.clientX - rect.left) + 'px');
                    card.style.setProperty('--spot-y', (e.clientY - rect.top) + 'px');
                    if (!card.classList.contains('dl-spotlight')) card.classList.add('dl-spotlight');
                }
            });
        }, { passive: true });
    }

    // ==========================================
    // 8. TOAST NOTIFICATION SYSTEM
    // ==========================================
    function initToasts() {
        let container = document.querySelector('.dl-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'dl-toast-container';
            document.body.appendChild(container);
        }

        const icons = {
            success: 'fa-check',
            error: 'fa-xmark',
            warning: 'fa-triangle-exclamation',
            info: 'fa-info',
        };

        /**
         * Show a toast notification
         * @param {string} message - Text to display
         * @param {('success'|'error'|'warning'|'info')} type - Toast type
         * @param {number} duration - Duration in ms (default 4000)
         */
        window.dlToast = function(message, type = 'info', duration = 4000) {
            const toast = document.createElement('div');
            toast.className = `dl-toast dl-toast-${type}`;
            toast.style.setProperty('--dl-toast-duration', duration + 'ms');
            toast.innerHTML = `
                <div class="dl-toast-icon"><i class="fas ${icons[type] || icons.info}"></i></div>
                <span>${message}</span>
                <div class="dl-toast-progress"></div>
            `;
            toast.addEventListener('click', () => dismiss(toast));
            container.appendChild(toast);

            function dismiss(t) {
                t.classList.add('dl-toast-out');
                setTimeout(() => t.remove(), 300);
            }

            setTimeout(() => {
                if (toast.parentNode) dismiss(toast);
            }, duration);

            // Limit to 5 visible
            while (container.children.length > 5) {
                dismiss(container.firstElementChild);
            }
        };
    }

    // ==========================================
    // 9. TYPEWRITER EFFECT
    // ==========================================
    function initTypewriter() {
        if (reducedMotion) return;

        document.querySelectorAll('[data-typewriter]').forEach(el => {
            if (el.dataset.dlTyped) return;
            el.dataset.dlTyped = '1';
            const text = el.textContent;
            el.textContent = '';
            el.classList.add('dl-typewriter-cursor');
            let i = 0;

            const io = new IntersectionObserver(entries => {
                if (entries[0].isIntersecting) {
                    io.disconnect();
                    function type() {
                        if (i < text.length) {
                            el.textContent += text.charAt(i);
                            i++;
                            setTimeout(type, 35 + Math.random() * 30);
                        } else {
                            setTimeout(() => el.classList.remove('dl-typewriter-cursor'), 2000);
                        }
                    }
                    setTimeout(type, 300);
                }
            });
            io.observe(el);
        });
    }

    // ==========================================
    // 10. FLOATING PARTICLES
    // ==========================================
    function initParticles() {
        if (reducedMotion || isTouchDevice) return;

        const canvas = document.createElement('canvas');
        canvas.id = 'dl-particles';
        canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;opacity:0.4;';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');

        let w, h;
        function resize() {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize, { passive: true });

        const count = Math.min(40, Math.floor(window.innerWidth / 40));
        const particles = Array.from({ length: count }, () => ({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            r: Math.random() * 1.5 + 0.5,
            color: [BRAND.cyan, BRAND.green, BRAND.purple][Math.floor(Math.random() * 3)],
            alpha: Math.random() * 0.3 + 0.1,
        }));

        let mouseX = -1000, mouseY = -1000;
        document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });

        function draw() {
            ctx.clearRect(0, 0, w, h);

            for (const p of particles) {
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0) p.x = w;
                if (p.x > w) p.x = 0;
                if (p.y < 0) p.y = h;
                if (p.y > h) p.y = 0;

                // Mouse interaction — gentle push
                const dx = mouseX - p.x;
                const dy = mouseY - p.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 150) {
                    p.vx -= dx * 0.0003;
                    p.vy -= dy * 0.0003;
                }
                // Dampen
                p.vx *= 0.999;
                p.vy *= 0.999;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.globalAlpha = p.alpha;
                ctx.fill();
            }

            // Draw connections
            ctx.globalAlpha = 1;
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = BRAND.cyan;
                        ctx.globalAlpha = (1 - dist / 120) * 0.08;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(draw);
        }
        draw();
    }

    // ==========================================
    // 11. CONFETTI CELEBRATION
    // ==========================================
    function initConfetti() {
        /**
         * Fire confetti! Call window.dlConfetti() after a success action
         */
        window.dlConfetti = function(origin = { x: 0.5, y: 0.5 }) {
            if (reducedMotion) return;
            const canvas = document.createElement('canvas');
            canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:100001;';
            document.body.appendChild(canvas);
            const ctx = canvas.getContext('2d');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            const colors = [BRAND.cyan, BRAND.green, BRAND.purple, BRAND.pink, '#ffc107', '#fff'];
            const pieces = Array.from({ length: 80 }, () => ({
                x: origin.x * canvas.width,
                y: origin.y * canvas.height,
                vx: (Math.random() - 0.5) * 16,
                vy: Math.random() * -14 - 4,
                w: Math.random() * 8 + 4,
                h: Math.random() * 4 + 2,
                color: colors[Math.floor(Math.random() * colors.length)],
                rot: Math.random() * 360,
                rv: (Math.random() - 0.5) * 12,
                alpha: 1,
            }));

            let frame = 0;
            function animate() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                let alive = false;

                for (const p of pieces) {
                    p.x += p.vx;
                    p.y += p.vy;
                    p.vy += 0.3; // gravity
                    p.rot += p.rv;
                    p.alpha -= 0.008;
                    p.vx *= 0.99;

                    if (p.alpha > 0) {
                        alive = true;
                        ctx.save();
                        ctx.translate(p.x, p.y);
                        ctx.rotate(p.rot * Math.PI / 180);
                        ctx.globalAlpha = Math.max(0, p.alpha);
                        ctx.fillStyle = p.color;
                        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                        ctx.restore();
                    }
                }

                frame++;
                if (alive && frame < 200) {
                    requestAnimationFrame(animate);
                } else {
                    canvas.remove();
                }
            }
            animate();
        };
    }

    // ==========================================
    // 12. SMOOTH ANCHOR SCROLLING
    // ==========================================
    function initSmoothScroll() {
        document.addEventListener('click', e => {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const link = e.target.closest('a[href^="#"]');
            if (!link) return;
            const target = document.querySelector(link.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
            }
        });
    }

    // ==========================================
    // 13. KEYBOARD SHORTCUTS LAYER
    // ==========================================
    function initKeyboardShortcuts() {
        const shortcuts = {
            'ctrl+k': () => {
                // Focus search if exists
                const search = document.querySelector('input[type="search"], input[placeholder*="Search"], #search');
                if (search) { search.focus(); return true; }
            },
            'ctrl+/': () => showShortcutsHelp(),
            'escape': () => {
                // Close any open modal
                const modal = document.querySelector('.modal[style*="block"], .ws-picker-overlay, .dl-shortcuts-overlay');
                if (modal) { modal.remove(); return true; }
            },
            'g d': () => { window.location.href = '/dashboard'; },
            'g h': () => { window.location.href = '/site/'; },
            'g a': () => { window.location.href = '/analytics'; },
            'g l': () => { window.location.href = '/logs'; },
            'g s': () => { window.location.href = '/setup/security'; },
        };

        let keyBuffer = '';
        let keyTimer = null;

        document.addEventListener('keydown', e => {
            // Don't intercept when typing
            if (e.target.matches('input, textarea, select, [contenteditable]')) return;

            const key = (e.ctrlKey ? 'ctrl+' : '') + (e.shiftKey ? 'shift+' : '') + e.key.toLowerCase();
            
            // Single-key shortcuts
            if (shortcuts[key]) {
                if (shortcuts[key]()) e.preventDefault();
                return;
            }

            // Multi-key sequences (g d, g h, etc.)
            keyBuffer += e.key.toLowerCase() + ' ';
            clearTimeout(keyTimer);
            keyTimer = setTimeout(() => { keyBuffer = ''; }, 800);

            const trimmed = keyBuffer.trim();
            if (shortcuts[trimmed]) {
                shortcuts[trimmed]();
                keyBuffer = '';
            }
        });

        function showShortcutsHelp() {
            if (document.querySelector('.dl-shortcuts-overlay')) return;
            const overlay = document.createElement('div');
            overlay.className = 'dl-shortcuts-overlay';
            overlay.style.cssText = `
                position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,0.7);
                backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;
                animation: dl-page-in 0.3s ease both;
            `;
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

            const box = document.createElement('div');
            box.style.cssText = `
                background:${BRAND.surface};border:1px solid rgba(0,212,255,0.2);border-radius:16px;
                padding:32px;max-width:480px;width:90%;color:#e2e8f0;font-family:Inter,sans-serif;
                box-shadow:0 20px 60px rgba(0,0,0,0.4),0 0 30px rgba(0,212,255,0.1);
            `;
            box.innerHTML = `
                <h2 style="margin:0 0 24px;font-size:1.4rem;display:flex;align-items:center;gap:10px;">
                    <i class="fas fa-keyboard" style="color:${BRAND.cyan}"></i> Keyboard Shortcuts
                </h2>
                <div style="display:grid;gap:10px;">
                    ${[
                        ['Ctrl + K', 'Search'],
                        ['Ctrl + /', 'Show shortcuts'],
                        ['Esc', 'Close modal/overlay'],
                        ['G → D', 'Go to Dashboard'],
                        ['G → H', 'Go to Home'],
                        ['G → A', 'Go to Analytics'],
                        ['G → L', 'Go to Logs'],
                        ['G → S', 'Go to Security'],
                    ].map(([k, v]) => `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                            <span style="color:#94a3b8">${v}</span>
                            <kbd style="background:rgba(0,212,255,0.1);padding:4px 10px;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:0.8rem;color:${BRAND.cyan};border:1px solid rgba(0,212,255,0.2);">${k}</kbd>
                        </div>
                    `).join('')}
                </div>
                <p style="margin:20px 0 0;font-size:0.8rem;color:#64748b;text-align:center;">Press Esc to close</p>
            `;
            overlay.appendChild(box);
            document.body.appendChild(overlay);
        }
    }

    // ==========================================
    // 15. INTERACTIVE SAVE FEEDBACK
    // ==========================================
    function initSaveFeedback() {
        // Intercept form submits and fetch calls for save feedback
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
            const method = (args[1]?.method || 'GET').toUpperCase();
            const isMutatingApi = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && url.includes('/api/');

            // Auto-inject CSRF token for mutating API calls (prevents 403 CSRF errors)
            if (isMutatingApi) {
                const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
                const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;
                if (csrfToken) {
                    const init = args[1] ? { ...args[1] } : {};
                    const existingHeaders = init.headers instanceof Headers
                        ? Object.fromEntries(init.headers.entries())
                        : (init.headers || {});
                    init.headers = { ...existingHeaders, 'X-CSRF-Token': csrfToken };
                    args[1] = init;
                }
            }

            return originalFetch.apply(this, args).then(response => {
                // Show save confirmation for successful mutations
                if (isMutatingApi && response.ok) {
                    setTimeout(() => window.dlToast?.('Changes saved', 'success', 2500), 100);
                }
                return response;
            });
        };
    }

    // ==========================================
    // 16. SIDEBAR TRAIL EFFECT
    // ==========================================
    function initSidebarTrail() {
        if (isTouchDevice || reducedMotion) return;

        const sidebar = document.querySelector('.sidebar, .sidebar-pro, .sidebar-nav');
        if (!sidebar) return;

        sidebar.addEventListener('mousemove', e => {
            const items = sidebar.querySelectorAll('.nav-item');
            items.forEach(item => {
                const rect = item.getBoundingClientRect();
                const dy = Math.abs(e.clientY - (rect.top + rect.height / 2));
                const proximity = Math.max(0, 1 - dy / 200);
                item.style.setProperty('--dl-proximity', proximity);
                item.style.paddingLeft = (16 + proximity * 6) + 'px';
                item.style.opacity = 0.6 + proximity * 0.4;
            });
        }, { passive: true });

        sidebar.addEventListener('mouseleave', () => {
            sidebar.querySelectorAll('.nav-item').forEach(item => {
                item.style.paddingLeft = '';
                item.style.opacity = '';
            });
        });
    }

    // ==========================================
    // 17. PAGE PROGRESS BAR
    // ==========================================
    function initProgressBar() {
        const bar = document.createElement('div');
        bar.id = 'dl-progress-bar';
        bar.style.cssText = `
            position:fixed;top:0;left:0;height:3px;z-index:100001;
            background:linear-gradient(90deg, ${BRAND.cyan}, ${BRAND.green});
            width:0;transition:width 0.3s ease;
            box-shadow:0 0 10px rgba(0,212,255,0.5);
            border-radius:0 3px 3px 0;
        `;
        document.body.appendChild(bar);

        window.addEventListener('scroll', () => {
            const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
            const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
            const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
            bar.style.width = progress + '%';
        }, { passive: true });
    }

    // ==========================================
    // 18. INTERACTIVE STAT HOVER (number wobble)
    // ==========================================
    function initStatHover() {
        if (isTouchDevice) return;

        document.addEventListener('mouseenter', e => {
            if (reducedMotion) return;
            if (!e.target || typeof e.target.closest !== 'function') return;
            const stat = e.target.closest('.num, .stat-value, .stat-number, .dl-countup');
            if (!stat || stat.dataset.dlWobbling) return;
            stat.dataset.dlWobbling = '1';

            stat.style.transition = 'transform 0.1s ease';
            let wobble = 0;
            const interval = setInterval(() => {
                wobble++;
                const angle = Math.sin(wobble * 0.5) * (3 - wobble * 0.3);
                stat.style.transform = `rotate(${angle}deg) scale(${1 + 0.02 * (5 - wobble)})`;
                if (wobble > 6) {
                    clearInterval(interval);
                    stat.style.transform = '';
                    delete stat.dataset.dlWobbling;
                }
            }, 60);
        }, true);
    }

    // ==========================================
    // 19. AUTO-ADD GRID BACKGROUND
    // ==========================================
    function initGridBackground() {
        document.body.classList.add('dl-grid-bg');
    }

    // ==========================================
    // 20. STAGGER ENTRANCE FOR SIDEBAR NAV
    // ==========================================
    function initSidebarStagger() {
        if (reducedMotion) return;
        const items = document.querySelectorAll('.nav-item, .sidebar-nav a, .nav-section');
        items.forEach((item, i) => {
            item.style.opacity = '0';
            item.style.transform = 'translateX(-20px)';
            item.style.transition = `all 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.04 + 0.2}s`;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    item.style.opacity = '';
                    item.style.transform = '';
                });
            });
        });
    }

    // ==========================================
    // 21. HOVER SOUND FEEDBACK (opt-in)
    // ==========================================
    function initHoverSound() {
        // Only if user enables via localStorage
        if (localStorage.getItem('dl-sound') !== 'on') return;

        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        function playTick() {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 800 + Math.random() * 400;
            gain.gain.value = 0.03;
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.1);
        }

        document.addEventListener('mouseenter', e => {
            if (e.target.matches('button, .btn, .nav-item, a')) playTick();
        }, true);
    }

    // ==========================================
    // INITIALIZE EVERYTHING
    // ==========================================
    function boot() {
        initCursorGlow();
        initMagneticButtons();
        initTiltCards();
        initRipple();
        initScrollReveal();
        initCountUp();
        initSpotlight();
        initToasts();
        initTypewriter();
        initParticles();
        initConfetti();
        initSmoothScroll();
        initKeyboardShortcuts();
        initSaveFeedback();
        initSidebarTrail();
        initProgressBar();
        initStatHover();
        initGridBackground();
        initSidebarStagger();
        initHoverSound();

        console.log(
            '%c⚡ DarkLock FX loaded — 21 micro-interactions active',
            'background:linear-gradient(90deg,#00d4ff,#06ffa5);color:#000;font-weight:bold;padding:4px 12px;border-radius:4px;font-size:12px;'
        );
    }

    // Boot on DOMContentLoaded or immediately if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
