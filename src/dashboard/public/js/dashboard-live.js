/* ════════════════════════════════════════════════════════════════
   DARKLOCK DASHBOARD LIVE — real-time bot ↔ dashboard sync layer
   Additive only: never replaces dashboard-pro.js logic.
   - Injects a live bot status pill into the dashboard header
   - Polls bot status + analytics and tween-animates changed values
   - Adds cursor glow tracking on stat cards
   ════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var POLL_STATUS_MS = 10000;
    var POLL_STATS_MS = 20000;
    var pill = null;

    /* ── helpers ──────────────────────────────────────────────── */
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    function fmt(n) {
        n = Number(n) || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(Math.round(n));
    }

    function fmtUptime(sec) {
        sec = Number(sec) || 0;
        var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
        if (d > 0) return d + 'd ' + h + 'h';
        if (h > 0) return h + 'h ' + m + 'm';
        return m + 'm';
    }

    /* tween a numeric element from its current displayed value */
    function tweenValue(el, target, formatter) {
        if (!el) return;
        formatter = formatter || fmt;
        var raw = (el.dataset.v2Raw !== undefined) ? Number(el.dataset.v2Raw) : NaN;
        if (isNaN(raw)) {
            // try to parse what's displayed (strip K/M)
            var txt = (el.textContent || '').trim();
            var mult = /M$/i.test(txt) ? 1e6 : /K$/i.test(txt) ? 1e3 : 1;
            raw = parseFloat(txt.replace(/[^0-9.]/g, '')) * mult || 0;
        }
        target = Number(target) || 0;
        if (Math.round(raw) === Math.round(target)) return;
        el.dataset.v2Raw = String(target);

        var start = raw, t0 = null, DUR = 900;
        function step(ts) {
            if (!t0) t0 = ts;
            var p = Math.min((ts - t0) / DUR, 1);
            var e = 1 - Math.pow(1 - p, 4); // easeOutQuart
            el.textContent = formatter(start + (target - start) * e);
            if (p < 1) requestAnimationFrame(step);
            else {
                el.textContent = formatter(target);
                el.classList.remove('v2-ticked');
                void el.offsetWidth;
                el.classList.add('v2-ticked');
            }
        }
        requestAnimationFrame(step);
    }

    /* ── live bot status pill ─────────────────────────────────── */
    function ensurePill() {
        if (pill) return pill;
        var header = $('.dashboard-header .header-actions');
        if (!header) return null;
        pill = document.createElement('div');
        pill.className = 'v2-bot-pill';
        pill.id = 'v2BotPill';
        pill.innerHTML = '<span class="v2-dot"></span><span class="v2-label">Connecting…</span><span class="v2-meta"></span>';
        header.insertBefore(pill, header.firstChild);
        return pill;
    }

    function renderStatus(bot) {
        var p = ensurePill();
        if (!p) return;
        var label = $('.v2-label', p), meta = $('.v2-meta', p);
        if (bot && bot.online) {
            p.classList.remove('offline');
            if (label) label.textContent = 'Bot Online';
            if (meta) {
                var bits = [];
                if (bot.ping !== undefined && bot.ping !== null && bot.ping >= 0) bits.push(bot.ping + 'ms');
                if (bot.uptime) bits.push(fmtUptime(bot.uptime));
                meta.textContent = bits.length ? '· ' + bits.join(' · ') : '';
            }
            p.title = (bot.username || 'Bot') + ' — ' + (bot.guilds || 0) + ' servers, ' + (bot.users || 0) + ' users';
        } else {
            p.classList.add('offline');
            if (label) label.textContent = 'Bot Offline';
            if (meta) meta.textContent = '';
            p.title = 'The Discord bot is not currently reachable';
        }
    }

    function pollStatus() {
        fetch('/platform/api/bot/status', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (data && data.bot) renderStatus(data.bot);
                else renderStatus(null);
            })
            .catch(function () { renderStatus(null); });
    }

    /* ── live stat refresh ────────────────────────────────────── */
    function currentGuildId() {
        try {
            var stored = localStorage.getItem('selectedGuildId');
            if (stored) return stored;
            if (window.selectedServerId) return window.selectedServerId;
            if (window.currentGuildId) return window.currentGuildId;
            var m = location.search.match(/[?&]guild(?:_id|Id)?=(\d+)/);
            if (m) return m[1];
        } catch (e) { /* noop */ }
        return null;
    }

    function pollStats() {
        if (document.hidden) return;
        var gid = currentGuildId();
        var url = '/api/analytics/overview' + (gid ? '?guildId=' + encodeURIComponent(gid) : '');
        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data) return;
                var o = data.overview || data.data || data;
                if (!o || typeof o !== 'object') return;
                // map known stat-card labels → API fields
                var map = {
                    'total members': o.totalMembers,
                    'members': o.totalMembers,
                    'messages': o.totalMessages,
                    'commands used': o.totalCommands,
                    'commands': o.totalCommands,
                    'mod actions': o.totalModActions,
                    'messages today': o.messagesToday,
                    'joins today': o.joinsToday
                };
                $all('.stat-card').forEach(function (card) {
                    var labelEl = $('.stat-label', card), valEl = $('.stat-value', card);
                    if (!labelEl || !valEl) return;
                    var key = labelEl.textContent.trim().toLowerCase();
                    if (map[key] !== undefined && map[key] !== null) {
                        tweenValue(valEl, map[key]);
                    }
                });
            })
            .catch(function () { /* silent */ });
    }

    /* ── stat-card cursor glow tracking ───────────────────────── */
    function bindGlow() {
        document.addEventListener('pointermove', function (e) {
            var card = e.target && e.target.closest ? e.target.closest('.stat-card') : null;
            if (!card) return;
            var r = card.getBoundingClientRect();
            card.style.setProperty('--v2-mx', ((e.clientX - r.left) / r.width * 100) + '%');
            card.style.setProperty('--v2-my', ((e.clientY - r.top) / r.height * 100) + '%');
        }, { passive: true });
    }

    /* ── boot ─────────────────────────────────────────────────── */
    function boot() {
        ensurePill();
        pollStatus();
        bindGlow();
        setInterval(pollStatus, POLL_STATUS_MS);
        // initial stats poll is delayed so dashboard-pro.js renders cards first
        setTimeout(pollStats, 6000);
        setInterval(pollStats, POLL_STATS_MS);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) { pollStatus(); pollStats(); }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
