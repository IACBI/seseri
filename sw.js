'use strict';

const CACHE = 'podcast-player-v4'; // bump on each significant deployment
const PRECACHE = ['/podcast-player/', '/podcast-player/index.html', '/podcast-player/manifest.json'];

// ── Install: pre-cache shell assets ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ───────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first, fall back to network ──────────────────────────────
self.addEventListener('fetch', event => {
  // Only handle GET requests; skip cross-origin API calls (iTunes)
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, toCache));
        return response;
      }).catch(() => caches.match('/podcast-player/index.html'));
    })
  );
});
