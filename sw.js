'use strict';

const CACHE = 'seseri-v2'; // bump on each significant deployment

// Resolve everything relative to THIS service worker's own location, so the
// app keeps working under any base path (/seseri/, /podcast-player/, root, …)
// without having to edit hard-coded paths every time the repo is renamed.
const BASE = new URL('./', self.location).href;
const SHELL = BASE + 'index.html';
const PRECACHE = [BASE, SHELL, BASE + 'manifest.json'];

// ── Install: pre-cache shell assets ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      // Don't let a single 404'd asset block activation of the new worker.
      .catch(() => {})
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

// ── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  // Only handle GET; skip cross-origin (iTunes API, CORS proxies, media files).
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  // Network-first for page navigations / HTML so a freshly deployed index.html
  // is always picked up on reload — never serve a stale shell forever.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const toCache = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, toCache));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(c => c || caches.match(SHELL))
        )
    );
    return;
  }

  // Cache-first for static same-origin assets (icons, manifest, …).
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
      }).catch(() => caches.match(SHELL));
    })
  );
});
