/**
 * Darklock Systems — Cloudflare Worker
 *
 * Sits in front of the Cloudflare Tunnel to the Pi 5.
 * Normal operation: transparently proxies every request to your origin.
 * When the Pi 5 / tunnel is down (502, 522, 523, 524, or network error):
 *   → Returns the branded "Servers Offline" maintenance page.
 *
 * Deploy: wrangler deploy
 * Docs:   see README section in this file's directory.
 */

// ── Offline status codes that trigger the maintenance page ───────────────────
const OFFLINE_STATUSES = new Set([502, 503, 522, 523, 524, 525, 530]);

// ── Maintenance page HTML ─────────────────────────────────────────────────────
function buildMaintenancePage(requestedUrl) {
  const now = new Date().toUTCString();
  const path = requestedUrl ? new URL(requestedUrl).pathname : "/";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline — Darklock Systems</title>
  <meta name="robots" content="noindex, nofollow">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg:        #0a0e17;
      --card:      #0f1420;
      --border:    rgba(148,163,184,0.10);
      --cyan:      #00f0ff;
      --purple:    #7c3aed;
      --pink:      #ec4899;
      --amber:     #f59e0b;
      --red:       #ef4444;
      --text:      #ffffff;
      --muted:     #94a3b8;
      --dimmed:    #475569;
    }

    html, body {
      min-height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }

    /* ── Animated background orbs ── */
    .orbs { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
    .orb {
      position: absolute; border-radius: 50%;
      filter: blur(80px); opacity: 0.35;
      animation: drift 20s ease-in-out infinite;
    }
    .orb-1 {
      width: 600px; height: 600px;
      background: linear-gradient(135deg, var(--cyan), var(--purple));
      top: -200px; right: -200px;
      animation-delay: 0s;
    }
    .orb-2 {
      width: 500px; height: 500px;
      background: linear-gradient(135deg, var(--purple), var(--pink));
      bottom: -150px; left: -150px;
      animation-delay: -7s;
    }
    .orb-3 {
      width: 350px; height: 350px;
      background: linear-gradient(135deg, var(--amber), var(--red));
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      animation-delay: -14s;
      opacity: 0.18;
    }
    @keyframes drift {
      0%,100% { transform: translate(0,0) scale(1); }
      25%      { transform: translate(30px,-30px) scale(1.05); }
      50%      { transform: translate(-20px,20px) scale(0.95); }
      75%      { transform: translate(-30px,-20px) scale(1.02); }
    }

    /* ── Card ── */
    .card {
      position: relative; z-index: 10;
      text-align: center;
      padding: 2.5rem 2rem;
      max-width: 580px;
      width: 100%;
    }

    /* ── Icon ── */
    .icon-wrap {
      width: 110px; height: 110px;
      margin: 0 auto 2rem;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.15));
      border: 2px solid rgba(245,158,11,0.45);
      display: flex; align-items: center; justify-content: center;
      animation: pulse-ring 2.5s ease-out infinite;
    }
    @keyframes pulse-ring {
      0%   { box-shadow: 0 0 0 0 rgba(245,158,11,0.45); }
      70%  { box-shadow: 0 0 0 22px rgba(245,158,11,0); }
      100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); }
    }
    .icon-wrap svg {
      width: 48px; height: 48px;
      stroke: var(--amber); fill: none;
      stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round;
      animation: wobble 3s ease-in-out infinite;
    }
    @keyframes wobble {
      0%,100% { transform: rotate(0deg); }
      25%     { transform: rotate(-12deg); }
      75%     { transform: rotate(12deg); }
    }

    /* ── Status badge ── */
    .badge {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: rgba(239,68,68,0.12);
      border: 1px solid rgba(239,68,68,0.30);
      color: #fca5a5;
      padding: 0.3rem 0.9rem;
      border-radius: 999px;
      font-size: 0.72rem; font-weight: 700;
      letter-spacing: 0.09em; text-transform: uppercase;
      margin-bottom: 1.5rem;
    }
    .dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--red);
      animation: blink 2s ease-in-out infinite;
    }
    @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0.2; } }

    /* ── Typography ── */
    h1 {
      font-size: clamp(1.7rem, 5vw, 2.5rem);
      font-weight: 800; line-height: 1.2;
      margin-bottom: 1rem;
      background: linear-gradient(135deg, var(--text), var(--muted));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle {
      font-size: 1.05rem; color: var(--muted);
      line-height: 1.65; margin-bottom: 2rem;
    }

    /* ── Info panel ── */
    .info-panel {
      background: rgba(15,20,32,0.85);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-left: 3px solid var(--amber);
      border-radius: 0.85rem;
      padding: 1.25rem 1.5rem;
      margin: 1.5rem 0;
      text-align: left;
    }
    .info-panel-title {
      display: flex; align-items: center; gap: 0.5rem;
      color: var(--amber); font-weight: 600; font-size: 0.88rem;
      margin-bottom: 0.6rem;
    }
    .info-panel-title svg { width:16px;height:16px;stroke:var(--amber);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round; }
    .info-panel p { color: var(--muted); font-size: 0.875rem; line-height: 1.65; }

    /* ── Progress bar ── */
    .progress-wrap { margin: 1.75rem 0; }
    .progress-label {
      display: flex; justify-content: space-between;
      font-size: 0.78rem; color: var(--dimmed); margin-bottom: 0.45rem;
    }
    .progress-track {
      height: 5px; background: rgba(148,163,184,0.15);
      border-radius: 3px; overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--cyan), var(--purple));
      border-radius: 3px;
      animation: progress-pulse 2s ease-in-out infinite alternate;
      width: 65%;
    }
    @keyframes progress-pulse { from { opacity:0.5; width:40%; } to { opacity:1; width:80%; } }

    /* ── Meta row ── */
    .meta-row {
      display: flex; flex-wrap: wrap; justify-content: center; gap: 1.25rem;
      margin-top: 2rem;
    }
    .meta-item {
      display: flex; align-items: center; gap: 0.4rem;
      color: var(--dimmed); font-size: 0.78rem;
    }
    .meta-item svg { width:13px;height:13px;stroke:var(--cyan);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round; }

    /* ── Return link ── */
    .retry-btn {
      display: inline-flex; align-items: center; gap: 0.5rem;
      margin-top: 2rem;
      background: linear-gradient(135deg, rgba(0,240,255,0.12), rgba(124,58,237,0.12));
      border: 1px solid rgba(0,240,255,0.25);
      color: var(--cyan); text-decoration: none;
      padding: 0.6rem 1.4rem; border-radius: 0.5rem;
      font-size: 0.875rem; font-weight: 600;
      transition: background 0.2s, border-color 0.2s;
    }
    .retry-btn:hover {
      background: linear-gradient(135deg, rgba(0,240,255,0.2), rgba(124,58,237,0.2));
      border-color: rgba(0,240,255,0.45);
    }
    .retry-btn svg { width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round; }
  </style>
</head>
<body>
  <div class="orbs">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
  </div>

  <div class="card">
    <div class="icon-wrap">
      <!-- Wrench icon -->
      <svg viewBox="0 0 24 24">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
      </svg>
    </div>

    <div class="badge"><span class="dot"></span>Systems Offline</div>

    <h1>Darklock Systems</h1>
    <p class="subtitle">
      Our servers are currently down for maintenance or experiencing an outage.<br>
      We're working to restore service as quickly as possible.
    </p>

    <div class="info-panel">
      <div class="info-panel-title">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        What's happening?
      </div>
      <p>
        The Darklock platform is temporarily unreachable. This page is served automatically
        while the main server is offline. No action is needed on your part — the system
        will recover automatically.
      </p>
    </div>

    <div class="progress-wrap">
      <div class="progress-label">
        <span>Attempting to reconnect…</span>
        <span id="counter">retrying</span>
      </div>
      <div class="progress-track"><div class="progress-fill"></div></div>
    </div>

    <div class="meta-row">
      <span class="meta-item">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Detected: ${now}
      </span>
      <span class="meta-item">
        <svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        Path: ${path}
      </span>
    </div>

    <a class="retry-btn" href="javascript:location.reload()">
      <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      Try again
    </a>
  </div>

  <script>
    // Auto-refresh every 30 seconds
    let secs = 30;
    const el = document.getElementById('counter');
    const tick = () => {
      el.textContent = secs + 's';
      if (--secs < 0) location.reload();
      else setTimeout(tick, 1000);
    };
    tick();
  </script>
</body>
</html>`;
}

function isApiRequestPath(pathname) {
  return pathname.startsWith('/api/') ||
    pathname.startsWith('/api/web-verify/') ||
    pathname === '/api/web-verify' ||
    pathname.startsWith('/platform/api/') ||
    pathname === '/api' ||
    pathname === '/platform/api';
}

function sanitizeResponseHeaders(headers) {
  const newHeaders = new Headers(headers);
  // Strip Cloudflare-injected report-only CSP that sets connect-src 'none'.
  newHeaders.delete('Content-Security-Policy-Report-Only');
  return newHeaders;
}

function buildApiFallback(requestedUrl, cause = 'origin_unavailable') {
  const url = new URL(requestedUrl);
  return {
    success: false,
    error: 'Darklock services are temporarily unavailable. Please try again in a few minutes.',
    fallback: true,
    cause,
    path: url.pathname,
    timestamp: new Date().toISOString()
  };
}

function apiFallbackResponse(requestedUrl, cause, status = 503) {
  return new Response(JSON.stringify(buildApiFallback(requestedUrl, cause)), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache",
      "X-Darklock-Fallback": "1",
    },
  });
}

// ── Worker entry point ────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    // Skip trying to proxy non-GET/HEAD for offline detection if you want,
    // but proxying everything is correct — pass all methods through.
    try {
      const response = await fetch(request);

      const requestPath = new URL(request.url).pathname;
      const isApiPath = isApiRequestPath(requestPath);

      // Secure Channel should always pass through the origin response directly.
      // It is a public app shell, not a maintenance-gated page.
      if (!requestPath.startsWith('/app/secure-channel') && OFFLINE_STATUSES.has(response.status)) {
        if (isApiPath) {
          return apiFallbackResponse(request.url, `origin_status_${response.status}`);
        }

        return new Response(buildMaintenancePage(request.url), {
          status: 503,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store, no-cache",
            "X-Darklock-Fallback": "1",
          },
        });
      }

      // API paths must always return JSON. If upstream/challenge returns HTML,
      // normalize to a JSON fallback payload so clients never crash on parse.
      if (isApiPath) {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const bodyText = await response.text();
        const looksLikeJson = contentType.includes('application/json') || /^[\s\r\n]*[\[{]/.test(bodyText);

        if (!looksLikeJson) {
          return apiFallbackResponse(
            request.url,
            `non_json_upstream_status_${response.status}`,
            response.status >= 400 ? response.status : 503
          );
        }

        const apiHeaders = sanitizeResponseHeaders(response.headers);
        apiHeaders.set('Content-Type', 'application/json; charset=utf-8');
        apiHeaders.set('Cache-Control', 'no-store, no-cache');
        return new Response(bodyText, {
          status: response.status,
          statusText: response.statusText,
          headers: apiHeaders,
        });
      }

      // Strip Cloudflare-injected report-only CSP that can break first-party API calls.
      const newHeaders = sanitizeResponseHeaders(response.headers);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });

    } catch (err) {
      // Network / tunnel error — Pi 5 is unreachable
      const requestPath = new URL(request.url).pathname;
      if (isApiRequestPath(requestPath)) {
        return apiFallbackResponse(request.url, 'origin_fetch_failed');
      }

      return new Response(buildMaintenancePage(request.url), {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache",
          "X-Darklock-Fallback": "1",
        },
      });
    }
  },
};
