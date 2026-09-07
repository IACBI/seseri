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

/**
 * Cache name is derived from the injected precache manifest, so every build
 * that changes an asset gets a fresh bucket and `activate` can delete the old
 * one. It used to be the hardcoded 'seseri-v4' *and* on the never-delete list,
 * which meant the shell cache could never be pruned: superseded hashed assets
 * accumulated forever, and non-hashed files (manifest, icons, privacy-policy)
 * stayed cache-first with no revalidation until someone bumped the constant
 * by hand.
 */
const AUDIO_CACHE = 'seseri-audio';

/** Short stable digest of the manifest's revisions/urls. */
function buildTag(): string {
  let h = 0x811c9dc5;
  for (const e of precacheEntries) {
    const s = e.url + '|' + (e.revision ?? '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(36);
}

const CACHE = `seseri-shell-${buildTag()}`;
// Only the offline episode audio must survive a shell-cache upgrade.
const PERSISTENT = new Set([AUDIO_CACHE]);
const BASE = new URL('./', sw.location.href).pathname;
const SHELL = BASE; // offline fallback for navigations

/**
 * Hashed build output is immutable, so cache-first is correct for it. Everything
 * else same-origin (manifest, icons, privacy-policy.html) must revalidate, or it
 * stays stale until the cache name changes.
 */
function isImmutable(pathname: string): boolean {
  return /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2)$/.test(pathname);
}

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

  /**
   * Sync must never be cached. Today the worker lives on another origin and is
   * skipped above, but a same-origin deployment (a path-based proxy, or the
   * headless smoke, which has to stay same-origin to satisfy the CSP) would
   * otherwise land here — where stale-while-revalidate happily replays a
   * previous device's blob, and a cache miss falls back to the app shell,
   * handing the client an HTML page it decodes as ciphertext.
   */
  if (url.pathname.endsWith('/v1/sync')) return;

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

  const store = (res: Response): Response => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      void caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit && isImmutable(url.pathname)) return hit;
      if (hit) {
        // Stale-while-revalidate: serve immediately, refresh in the background.
        event.waitUntil(
          fetch(req)
            .then(store)
            .catch(() => undefined),
        );
        return hit;
      }
      return fetch(req).then(store);
    }),
  );
});
