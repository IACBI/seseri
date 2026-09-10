/** Upstream fetch hardening: SSRF guard, timeout, response size cap. */

const PRIVATE_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;

/** Reserved / non-routable IPv4, given as four octets. */
function privateIpv4(o: readonly number[]): boolean {
  const a = o[0] ?? 0;
  const b = o[1] ?? 0;
  if (a === 0 || a === 127 || a === 10) return true; // this-network, loopback, private
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/**
 * Expand an IPv6 literal into 8 groups. Also folds an embedded IPv4 tail
 * (`::ffff:1.2.3.4`) into two groups, so the mapped forms below catch it even
 * when the URL parser has not already rewritten them to hex.
 */
export function parseIpv6(addr: string): number[] | null {
  let s = addr.toLowerCase();
  const tail4 = /^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(s);
  if (tail4) {
    const o = (tail4[2] ?? '').split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = (((o[0] ?? 0) << 8) | (o[1] ?? 0)).toString(16);
    const lo = (((o[2] ?? 0) << 8) | (o[3] ?? 0)).toString(16);
    s = `${tail4[1] ?? ''}${hi}:${lo}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  let groups: string[];
  if (halves.length === 1) {
    groups = head;
  } else {
    const rest = halves[1] ? halves[1].split(':') : [];
    const fill = 8 - head.length - rest.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...rest];
  }
  if (groups.length !== 8) return null;

  const out = groups.map((g) => (g === '' ? 0 : parseInt(g, 16)));
  if (out.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return out;
}

function privateIpv6(g: readonly number[]): boolean {
  const first = g[0] ?? 0;
  if (g.every((x) => x === 0)) return true; // :: (unspecified — routes to localhost)
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local

  // Forms that carry an IPv4 address: mapped, compatible, and the NAT64
  // well-known prefix. All three reach the embedded address, so apply v4 rules.
  const zeroTo5 = g.slice(0, 5).every((x) => x === 0);
  const mapped = zeroTo5 && g[5] === 0xffff;
  const compat = zeroTo5 && g[5] === 0;
  const nat64 = first === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (mapped || compat || nat64) {
    const hi = g[6] ?? 0;
    const lo = g[7] ?? 0;
    return privateIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  return false;
}

/**
 * True for hosts that must never be proxied. Exported for direct testing.
 *
 * Hostnames arrive WHATWG-normalized, so decimal/hex/octal IPv4 and compressed
 * IPv6 are already in canonical form. An IPv6 literal we cannot parse is
 * refused rather than allowed.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h) return true;
  if (PRIVATE_NAME.test(h)) return true;

  const bracketed = h.startsWith('[') && h.endsWith(']');
  if (bracketed || h.includes(':')) {
    const g = parseIpv6(bracketed ? h.slice(1, -1) : h);
    return g ? privateIpv6(g) : true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return privateIpv4(h.split('.').map(Number));
  return false;
}

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
  if (isPrivateHost(u.hostname)) return null;
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

/**
 * Isolate-wide ceiling on bytes held by concurrent `readCapped` drains.
 *
 * `maxBytes` bounds one request; nothing bounded the sum. A Cloudflare isolate
 * serves every request routed to it at that colo and they all share its ~128 MB,
 * so a handful of concurrent 20 MB feeds — the proxy fetches whatever URL it is
 * handed, so arranging them is a static file and a loop — took the isolate over
 * the limit and killed every request in flight on it, other listeners' included.
 * Real feeds are hundreds of kilobytes, so this only binds under abuse: it takes
 * ~90 concurrent average feeds, or three deliberate maximum-size ones, to reach.
 *
 * The gauge covers the drain, which is where bodies pile up. The finished buffer
 * stays alive until its response is delivered, and that tail is not counted.
 */
export const DRAIN_BUDGET_BYTES = 48 * 1024 * 1024;

let inflightBytes = 0;

/** Bytes currently held by drains in this isolate. Exported for testing. */
export function inflightDrainBytes(): number {
  return inflightBytes;
}

const EMPTY = new Uint8Array(0);

/**
 * Read a body up to `maxBytes`; throws when the upstream is larger.
 *
 * `timeoutMs` bounds the whole drain. `fetchWithTimeout` covers reaching the
 * response, not draining it — its timer is cleared the moment the headers
 * arrive — so without a deadline here an upstream that answers instantly and
 * then dribbles one byte a second pinned the request, its connection and its
 * growing buffer for as long as it cared to keep the socket open. 30 s is
 * ~5.5 Mbps for a full 20 MB body, far beyond what any real feed host needs.
 *
 * `budget` is the isolate-wide ceiling above; it is a parameter only so a test
 * can drive the shared gauge without allocating 48 MB.
 */
export async function readCapped(
  res: Response,
  maxBytes: number,
  { timeoutMs = 30_000, budget = DRAIN_BUDGET_BYTES }: { timeoutMs?: number; budget?: number } = {},
): Promise<Uint8Array> {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error('too large');
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let held = 0;
  let expired = false;
  // Cancelling resolves the pending read as done, so the loop below unwinds
  // through the `expired` check rather than waiting for the upstream.
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, timeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      held += value.byteLength;
      inflightBytes += value.byteLength;
      if (total > maxBytes) throw new Error('too large');
      if (inflightBytes > budget) throw new Error('busy');
      chunks.push(value);
    }
    if (expired) throw new Error('read timeout');
    const out = new Uint8Array(total);
    let off = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i] ?? EMPTY;
      out.set(c, off);
      off += c.byteLength;
      // Let each chunk go as it is copied. Holding the whole chunk list and the
      // finished copy at the same time doubled the peak for every body.
      chunks[i] = EMPTY;
    }
    return out;
  } finally {
    clearTimeout(timer);
    inflightBytes -= held;
    void reader.cancel().catch(() => {});
  }
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
