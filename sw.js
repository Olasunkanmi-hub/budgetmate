/* OlaPurse service worker
   Strategy:
   - HTML / page navigations  -> NETWORK-FIRST (newest version always wins when online,
                                 cached copy is used only when offline)
   - Other same-origin assets -> cache-first, refreshed in the background
   - Cross-origin (exchange-rate APIs) -> left to the network, never cached here

   This is what stops the "old version until I hard-refresh" problem.
   Bump CACHE_VERSION only if you want to force-clear cached assets. */
const CACHE_VERSION = 'olapurse-v2';
const PRECACHE = ['./', './index.html', './manifest.json', './icon-192.png'];

self.addEventListener('install', (event) => {
  // Take over as soon as possible instead of waiting for old tabs to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // allSettled + per-item catch so a missing file never blocks install
      Promise.allSettled(PRECACHE.map((u) => cache.add(u).catch(() => null)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Let cross-origin requests (e.g. the currency APIs) go straight to the network.
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // NETWORK-FIRST: always try the live page; fall back to cache only when offline.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match(req)) ||
               (await cache.match('./index.html')) ||
               Response.error();
      }
    })());
    return;
  }

  // Other same-origin assets: serve from cache fast, update in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => { if (res && res.status === 200) cache.put(req, res.clone()); return res; })
      .catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
