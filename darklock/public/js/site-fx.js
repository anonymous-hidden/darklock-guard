/* ═══════════════════════════════════════════════════════════
   DARKLOCK SITE FX — shared animation engine
   Vanilla JS, zero dependencies. Pairs with site-fx.css.
   Auto-initializes on DOMContentLoaded:
     • Scroll reveals (.reveal/.reveal-left/.reveal-right/.reveal-scale)
     • Animated counters [data-count] (+[data-suffix]/[data-decimals])
     • 3D tilt cards (.tilt-card)
     • Cursor glow tracking (.glow-track)
     • Magnetic buttons (.btn.magnetic)
     • Nav scroll state (#mainNav → .scrolled)
     • Scroll progress bar + back-to-top button
     • Text scramble decode [data-scramble]
     • Typewriter [data-typewriter='["a","b"]']
     • Particle canvas (.fx-particles)
     • Mobile nav toggle (#navToggle/#navLinks)
   ═══════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ── Scroll reveals ─────────────────────────────────── */
    function initReveals() {
        var els = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
        if (!els.length) return;
        if (reduceMotion || !('IntersectionObserver' in window)) {
            els.forEach(function (el) { el.classList.add('visible'); });
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) {
                    e.target.classList.add('visible');
                    io.unobserve(e.target);
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -48px 0px' });
        els.forEach(function (el) { io.observe(el); });
    }

    /* ── Animated counters ──────────────────────────────── */
    function animateCount(el) {
        var target = parseFloat(el.getAttribute('data-count'));
        if (isNaN(target)) return;
        var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
        var suffix = el.getAttribute('data-suffix') || '';
        var prefix = el.getAttribute('data-prefix') || '';
        var dur = parseInt(el.getAttribute('data-duration') || '1800', 10);
        if (reduceMotion) { el.textContent = prefix + target.toFixed(decimals) + suffix; return; }
        var start = null;
        function frame(ts) {
            if (!start) start = ts;
            var p = Math.min((ts - start) / dur, 1);
            var eased = 1 - Math.pow(1 - p, 4); // easeOutQuart
            el.textContent = prefix + (target * eased).toFixed(decimals) + suffix;
            if (p < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function initCounters() {
        var els = document.querySelectorAll('[data-count]');
        if (!els.length) return;
        if (!('IntersectionObserver' in window)) { els.forEach(animateCount); return; }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) { animateCount(e.target); io.unobserve(e.target); }
            });
        }, { threshold: 0.4 });
        els.forEach(function (el) { io.observe(el); });
    }

    /* ── 3D tilt ────────────────────────────────────────── */
    function initTilt() {
        if (reduceMotion) return;
        document.querySelectorAll('.tilt-card').forEach(function (card) {
            var maxTilt = parseFloat(card.getAttribute('data-tilt-max') || '7');
            card.addEventListener('mousemove', function (ev) {
                var r = card.getBoundingClientRect();
                var px = (ev.clientX - r.left) / r.width - 0.5;
                var py = (ev.clientY - r.top) / r.height - 0.5;
                card.style.transform =
                    'perspective(900px) rotateX(' + (-py * maxTilt) + 'deg) rotateY(' + (px * maxTilt) + 'deg) translateY(-4px)';
            });
            card.addEventListener('mouseleave', function () {
                card.style.transform = 'perspective(900px) rotateX(0) rotateY(0) translateY(0)';
            });
        });
    }

    /* ── Cursor glow tracking ───────────────────────────── */
    function initGlowTrack() {
        document.querySelectorAll('.glow-track').forEach(function (el) {
            el.addEventListener('mousemove', function (ev) {
                var r = el.getBoundingClientRect();
                el.style.setProperty('--mx', ((ev.clientX - r.left) / r.width * 100) + '%');
                el.style.setProperty('--my', ((ev.clientY - r.top) / r.height * 100) + '%');
            });
        });
    }

    /* ── Magnetic buttons ───────────────────────────────── */
    function initMagnetic() {
        if (reduceMotion) return;
        document.querySelectorAll('.btn.magnetic').forEach(function (btn) {
            var strength = 0.25;
            btn.addEventListener('mousemove', function (ev) {
                var r = btn.getBoundingClientRect();
                var dx = ev.clientX - (r.left + r.width / 2);
                var dy = ev.clientY - (r.top + r.height / 2);
                btn.style.transform = 'translate(' + (dx * strength) + 'px,' + (dy * strength) + 'px)';
            });
            btn.addEventListener('mouseleave', function () {
                btn.style.transform = 'translate(0,0)';
            });
        });
    }

    /* ── Nav scroll state ───────────────────────────────── */
    function initNav() {
        var nav = document.getElementById('mainNav') || document.querySelector('.nav');
        if (nav) {
            var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 40); };
            window.addEventListener('scroll', onScroll, { passive: true });
            onScroll();
        }
        var toggle = document.getElementById('navToggle');
        var links = document.getElementById('navLinks');
        if (toggle && links) {
            toggle.addEventListener('click', function () { links.classList.toggle('nav-open'); });
        }
    }

    /* ── Scroll progress + back-to-top ──────────────────── */
    function initScrollChrome() {
        var bar = document.createElement('div');
        bar.className = 'scroll-progress';
        document.body.appendChild(bar);

        var top = document.createElement('button');
        top.className = 'fx-top-btn';
        top.setAttribute('aria-label', 'Back to top');
        top.innerHTML = '<i class="fas fa-arrow-up"></i>';
        top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); });
        document.body.appendChild(top);

        function onScroll() {
            var h = document.documentElement;
            var max = h.scrollHeight - h.clientHeight;
            bar.style.transform = 'scaleX(' + (max > 0 ? (h.scrollTop / max) : 0) + ')';
            top.classList.toggle('show', h.scrollTop > 560);
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    /* ── Text scramble decode ───────────────────────────── */
    var SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#________';
    function scramble(el) {
        var finalText = el.getAttribute('data-scramble-text') || el.textContent;
        el.setAttribute('data-scramble-text', finalText);
        if (reduceMotion) { el.textContent = finalText; return; }
        var frame = 0;
        var queue = [];
        for (var i = 0; i < finalText.length; i++) {
            queue.push({ ch: finalText[i], start: Math.floor(Math.random() * 22), end: Math.floor(Math.random() * 22) + 18 });
        }
        function update() {
            var out = '';
            var done = 0;
            for (var i = 0; i < queue.length; i++) {
                var q = queue[i];
                if (frame >= q.end) { done++; out += q.ch; }
                else if (frame >= q.start) {
                    out += '<span style="opacity:.5">' + SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)] + '</span>';
                } else { out += '&nbsp;'; }
            }
            el.innerHTML = out;
            if (done < queue.length) { frame++; requestAnimationFrame(update); }
        }
        update();
    }

    function initScramble() {
        var els = document.querySelectorAll('[data-scramble]');
        if (!els.length) return;
        if (!('IntersectionObserver' in window)) { els.forEach(scramble); return; }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) { scramble(e.target); io.unobserve(e.target); }
            });
        }, { threshold: 0.5 });
        els.forEach(function (el) { io.observe(el); });
    }

    /* ── Typewriter ─────────────────────────────────────── */
    function initTypewriter() {
        document.querySelectorAll('[data-typewriter]').forEach(function (el) {
            var phrases;
            try { phrases = JSON.parse(el.getAttribute('data-typewriter')); } catch (e) { return; }
            if (!Array.isArray(phrases) || !phrases.length) return;
            if (reduceMotion) { el.textContent = phrases[0]; return; }
            el.classList.add('fx-caret');
            var pi = 0, ci = 0, deleting = false;
            function tick() {
                var phrase = phrases[pi];
                if (!deleting) {
                    ci++;
                    el.textContent = phrase.slice(0, ci);
                    if (ci === phrase.length) { deleting = true; setTimeout(tick, 2100); return; }
                    setTimeout(tick, 42 + Math.random() * 50);
                } else {
                    ci--;
                    el.textContent = phrase.slice(0, ci);
                    if (ci === 0) { deleting = false; pi = (pi + 1) % phrases.length; setTimeout(tick, 350); return; }
                    setTimeout(tick, 22);
                }
            }
            setTimeout(tick, 600);
        });
    }

    /* ── Particle network canvas ────────────────────────── */
    function initParticles() {
        if (reduceMotion) return;
        document.querySelectorAll('.fx-particles').forEach(function (host) {
            var canvas = document.createElement('canvas');
            canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
            host.appendChild(canvas);
            var ctx = canvas.getContext('2d');
            var dots = [];
            var DPR = Math.min(window.devicePixelRatio || 1, 2);
            var density = parseFloat(host.getAttribute('data-density') || '1');
            var hue = host.getAttribute('data-color') || '99,102,241';
            var mouse = { x: -9999, y: -9999 };

            function resize() {
                var r = host.getBoundingClientRect();
                canvas.width = r.width * DPR;
                canvas.height = r.height * DPR;
                ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
                var count = Math.min(110, Math.floor(r.width * r.height / 16000 * density));
                dots = [];
                for (var i = 0; i < count; i++) {
                    dots.push({
                        x: Math.random() * r.width,
                        y: Math.random() * r.height,
                        vx: (Math.random() - 0.5) * 0.35,
                        vy: (Math.random() - 0.5) * 0.35,
                        r: Math.random() * 1.6 + 0.6
                    });
                }
            }

            host.addEventListener('mousemove', function (ev) {
                var r = host.getBoundingClientRect();
                mouse.x = ev.clientX - r.left;
                mouse.y = ev.clientY - r.top;
            }, { passive: true });
            host.addEventListener('mouseleave', function () { mouse.x = -9999; mouse.y = -9999; });

            var visible = true;
            if ('IntersectionObserver' in window) {
                new IntersectionObserver(function (entries) {
                    visible = entries[0].isIntersecting;
                }, { threshold: 0 }).observe(host);
            }

            function step() {
                requestAnimationFrame(step);
                if (!visible) return;
                var w = canvas.width / DPR, h = canvas.height / DPR;
                ctx.clearRect(0, 0, w, h);
                for (var i = 0; i < dots.length; i++) {
                    var d = dots[i];
                    d.x += d.vx; d.y += d.vy;
                    if (d.x < 0 || d.x > w) d.vx *= -1;
                    if (d.y < 0 || d.y > h) d.vy *= -1;
                    // gentle mouse attraction
                    var mdx = mouse.x - d.x, mdy = mouse.y - d.y;
                    var mdist = Math.sqrt(mdx * mdx + mdy * mdy);
                    if (mdist < 140 && mdist > 0.01) {
                        d.x += mdx / mdist * 0.3;
                        d.y += mdy / mdist * 0.3;
                    }
                    ctx.beginPath();
                    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(' + hue + ',0.55)';
                    ctx.fill();
                    for (var j = i + 1; j < dots.length; j++) {
                        var o = dots[j];
                        var dx = d.x - o.x, dy = d.y - o.y;
                        var dist = dx * dx + dy * dy;
                        if (dist < 11000) {
                            ctx.beginPath();
                            ctx.moveTo(d.x, d.y);
                            ctx.lineTo(o.x, o.y);
                            ctx.strokeStyle = 'rgba(' + hue + ',' + (0.16 * (1 - dist / 11000)) + ')';
                            ctx.lineWidth = 0.7;
                            ctx.stroke();
                        }
                    }
                }
            }
            resize();
            window.addEventListener('resize', resize, { passive: true });
            step();
        });
    }

    /* ── User nav state (window.DARKLOCK_USER) ──────────── */
    function initUserState() {
        if (!window.DARKLOCK_USER) return;
        var navUser = document.getElementById('navUser');
        var navUsername = document.getElementById('navUsername');
        var signin = document.getElementById('navSignin');
        var signup = document.getElementById('navSignup');
        var dash = document.getElementById('navDash');
        if (navUser) navUser.style.display = 'inline';
        if (navUsername) navUsername.textContent = window.DARKLOCK_USER.username;
        if (signin) signin.style.display = 'none';
        if (signup) signup.style.display = 'none';
        if (dash) dash.style.display = 'inline-flex';
    }

    /* ── Boot ───────────────────────────────────────────── */
    function boot() {
        initReveals();
        initCounters();
        initTilt();
        initGlowTrack();
        initMagnetic();
        initNav();
        initScrollChrome();
        initScramble();
        initTypewriter();
        initParticles();
        initUserState();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // Expose for page-specific scripts
    window.DarklockFX = { scramble: scramble, animateCount: animateCount };
})();
