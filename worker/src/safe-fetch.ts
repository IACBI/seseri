/** Upstream fetch hardening: SSRF guard, timeout, response size cap. */

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

/** Validate a user-supplied URL for proxying. Returns a parsed URL or null. */
export function safeTarget(raw: string | undefined): URL | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (PRIVATE_HOST.test(u.hostname)) return null;
  if (u.username || u.password) return null;
  return u;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

/**
 * Fetch with a shared timeout budget and manual redirect handling. Every hop's
 * Location is re-validated with `safeTarget`, closing the redirect-based SSRF
 * gap where a public host 302s to an internal target. The `ms` budget and a
 * single AbortController cover the whole chain.
 */
export async function fetchWithTimeout(
  url: string,
  ms: number,
  init?: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    let currentUrl = url;
    let currentInit: RequestInit = { ...init };
    for (let hop = 0; ; hop++) {
      const res = await fetch(currentUrl, {
        ...currentInit,
        signal: ctrl.signal,
        redirect: 'manual',
      });
      if (!REDIRECT_STATUS.has(res.status)) return res;
      const loc = res.headers.get('location');
      if (!loc) return res;
      if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');

      const resolved = new URL(loc, currentUrl);
      if (!safeTarget(resolved.href)) throw new Error('unsafe redirect');

      // Per fetch spec: 303, and 301/302 on POST, become GET with no body.
      const method = (currentInit.method || 'GET').toUpperCase();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        currentInit = { ...currentInit, method: 'GET' };
        delete currentInit.body;
      }
      currentUrl = resolved.href;
    }
  } finally {
    clearTimeout(to);
  }
}

/** Read a body up to `maxBytes`; throws when the upstream is larger. */
export async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error('too large');
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * Edge-cache wrapper: serve from caches.default when fresh, otherwise compute
 * via `make` and store with the given TTL. Only 200s are cached.
 */
export async function edgeCached(
  cacheKeyUrl: string,
  ttlSeconds: number,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  make: () => Promise<Response>,
): Promise<Response> {
  const key = new Request(cacheKeyUrl, { method: 'GET' });
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set('x-seseri-cache', 'hit');
    return res;
  }
  const res = await make();
  if (res.status === 200) {
    const copy = res.clone();
    const stored = new Response(copy.body, copy);
    stored.headers.set('cache-control', `public, max-age=${ttlSeconds}`);
    ctx.waitUntil(cache.put(key, stored));
  }
  res.headers.set('x-seseri-cache', 'miss');
  return res;
}
