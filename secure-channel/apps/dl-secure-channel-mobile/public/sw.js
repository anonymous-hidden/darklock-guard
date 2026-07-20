/* ── Darklock Secure Channel – Service Worker ── */
const CACHE_NAME = 'darklock-sc-v3';
const PRECACHE = [
  '/app/secure-channel/',
  '/app/secure-channel/pwa.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only cache same-origin GET requests that belong to the app shell.
  // Third-party analytics, beacons, and API traffic should bypass the SW.
  if (url.origin !== self.location.origin || request.method !== 'GET') return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/ws') ||
      url.pathname.includes('/v1/') || url.pathname.includes('ids.') ||
      url.pathname.includes('rly.') || url.pathname.includes('beacon')) return;

  // App shell/navigation should be network-first to avoid stale cached
  // HTML keeping mobile clients stuck on an old broken bundle.
  const isAppShellRequest =
    request.mode === 'navigate' ||
    url.pathname === '/app/secure-channel/' ||
    url.pathname === '/app/secure-channel' ||
    url.pathname.endsWith('/app/secure-channel/pwa.html');

  if (isAppShellRequest) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cachedShell = await caches.match('/app/secure-channel/pwa.html');
          return cachedShell || caches.match(request) || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});
