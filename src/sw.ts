/// <reference lib="webworker" />
/**
 * Service worker — ported from legacy sw.js, precache list now injected by
 * vite-plugin-pwa (injectManifest) instead of a hand-maintained array.
 * Strategy preserved: network-first navigations, cache-first static assets.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

// Literal `self.__WB_MANIFEST` is required: workbox injects the precache list here.
const precacheEntries = (
  self as unknown as { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }
).__WB_MANIFEST;

const CACHE = 'seseri-v4';
// Buckets that must survive shell-cache upgrades (offline episode audio).
const PERSISTENT = new Set([CACHE, 'seseri-audio']);
const BASE = new URL('./', sw.location.href).pathname;
const SHELL = BASE; // offline fallback for navigations

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      const urls = new Set<string>([BASE]);
      for (const e of precacheEntries) urls.add(new URL(e.url, sw.location.href).pathname);
      return cache.addAll([...urls]);
    }),
  );
  void sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !PERSISTENT.has(k)).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return; // APIs/media handled elsewhere (P3)

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(
          async () => (await caches.match(req)) ?? (await caches.match(SHELL)) ?? Response.error(),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
