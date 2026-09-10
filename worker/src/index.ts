/**
 * Seseri API — Cloudflare Worker backend.
 *
 *   GET /v1/feed?url=      RSS/Atom proxy (text, ≤5 MB, edge-cached 15 min)
 *   GET /v1/itunes?url=    iTunes search/lookup proxy (JSON, edge-cached 1 h)
 *   /v1/sync               cross-device blob store (GET/PUT/DELETE, see sync.ts)
 *
 * Cross-cutting: CORS allowlist and a per-client-prefix rate limit; /v1/sync
 * carries budgets of its own on top (see sync.ts).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext, Env } from './env';
import { carriesCredential } from './credential-url';
import { edgeCached, fetchWithTimeout, readCapped, safeTarget } from './safe-fetch';
import { clientKey, rateLimited } from './ratelimit';
import { sweepSync, syncRoutes } from './sync';

// Popular feeds keep their full archive in the feed — The Daily's RSS alone
// is ~18 MB — so the cap is generous; it only guards against abuse.
const FEED_MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set(['https://iacbi.github.io']);
const LOCALHOST = /^(localhost|127\.0\.0\.1)$/;
const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const SYNC_PREFIX = '/v1/sync';

/**
 * A localhost Origin is accepted only by a worker that is ITSELF on localhost.
 *
 * `wrangler dev` needs it: the app runs on 5199 and the worker on 8787, so
 * every local request is cross-origin. But a header is not proof of anything —
 * `curl -H 'Origin: http://localhost' …` is one line, and while the deployed
 * worker honoured it the proxy endpoints were an open proxy for anyone willing
 * to send it, edge cache included. The request's own hostname cannot be forged
 * the same way: Cloudflare routes by hostname, so a deployed worker only ever
 * sees its `workers.dev` (or custom) host here.
 */
function allowOrigin(origin: string, requestUrl: string): string | null {
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (!LOCALHOST_ORIGIN.test(origin)) return null;
  let self: URL;
  try {
    self = new URL(requestUrl);
  } catch {
    return null;
  }
  return LOCALHOST.test(self.hostname) ? origin : null;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: (origin, c) => allowOrigin(origin, c.req.url),
    allowMethods: ['GET', 'PUT', 'DELETE', 'OPTIONS'],
    // Left empty, Hono reflects Access-Control-Request-Headers verbatim — the
    // worker would advertise whatever the caller asked for. Pin the list.
    allowHeaders: ['content-type', 'x-sync-id', 'if-match'],
    // A cross-origin response hides these from the page unless they are named,
    // and the client cannot follow compare-and-set without reading ETag.
    exposeHeaders: ['etag', 'x-sync-time', 'x-sync-conflict'],
    maxAge: 86400,
  }),
);

const RATE_LIMITED = { error: 'rate limited' } as const;

/** Per client prefix. Generous: a listener refreshing a library stays far under. */
const PROXY_PER_MIN = 60;

/**
 * Both proxies buffer their upstream body before answering, and every guard
 * around that is per request. `readCapped` adds the one that is not — an
 * isolate-wide ceiling on bytes being drained at once — and reports it as
 * `busy`; a stalled upstream comes back as `read timeout`. Neither is the
 * caller's fault, so neither is a 4xx.
 */
function proxyError(c: Context<AppContext>, e: unknown): Response {
  switch ((e as Error).message) {
    case 'too large':
      return c.json({ error: 'feed too large' }, 413);
    case 'busy':
      return c.json({ error: 'busy' }, 503, { 'retry-after': '5' });
    case 'read timeout':
      return c.json({ error: 'upstream timeout' }, 504);
    default:
      return c.json({ error: 'fetch failed' }, 502);
  }
}

/**
 * The proxy hands back bytes it did not write, under a content type it did not
 * choose. `nosniff` stops a browser upgrading a mislabelled body to something
 * that executes.
 */
const NOSNIFF = { 'x-content-type-options': 'nosniff' } as const;

/**
 * Content types a feed may legitimately arrive as.
 *
 * Only `text/html` used to be refused, which left every other document type
 * through — `image/svg+xml` and `application/xhtml+xml` both render as markup
 * if a browser is ever pointed straight at the proxy URL. The origin gate above
 * already refuses a plain navigation (it carries no `Origin`), so this is the
 * second lock rather than the first, but a passthrough content type is not
 * something to leave open-ended. An absent content type is allowed: plenty of
 * small feed hosts send none, and the body is capped and never executed.
 */
function feedContentType(ct: string): boolean {
  if (!ct) return true;
  return !/html|svg|javascript|ecmascript/.test(ct);
}

app.use('*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') ?? '';

  if (c.req.path !== '/' && !allowOrigin(c.req.header('origin') ?? '', c.req.url)) {
    // Without this the proxy endpoints are usable as a general-purpose open
    // proxy, which also lets anyone seed our edge cache. Browsers always send
    // Origin on a cross-origin fetch and the app is never same-origin with the
    // worker, so a missing or foreign Origin means the caller is not the app.
    return c.json({ error: 'forbidden' }, 403);
  }

  // Sync meters itself, per address and per hashed code both.
  if (c.req.path.startsWith(SYNC_PREFIX)) return next();

  // The edge sets `cf-connecting-ip` on everything it routes and overwrites
  // whatever the client sent, so an empty one means `wrangler dev` or a test —
  // not a caller who found a way to hide.
  if (
    ip &&
    (await rateLimited(c.env.LIMITERS, c.env.PROXY_IP, 'proxy', clientKey(ip), PROXY_PER_MIN))
  ) {
    return c.json(RATE_LIMITED, 429, { 'retry-after': '60' });
  }
  await next();
});

app.get('/', (c) => c.json({ name: 'seseri-api', ok: true }));

// ── RSS/Atom proxy ──────────────────────────────────────────────────
app.get('/v1/feed', async (c) => {
  const target = safeTarget(c.req.query('url'));
  if (!target) return c.json({ error: 'invalid url' }, 400);

  const fetchFeed = async (): Promise<Response> => {
    try {
      const res = await fetchWithTimeout(target.href, 15000, {
        headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      });
      if (!res.ok) return c.json({ error: 'upstream ' + res.status }, 502);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!feedContentType(ct)) return c.json({ error: 'not a feed' }, 415);
      const body = await readCapped(res, FEED_MAX_BYTES);
      return new Response(body, {
        headers: {
          'content-type': ct || 'application/xml; charset=utf-8',
          ...NOSNIFF,
        },
      });
    } catch (e) {
      return proxyError(c, e);
    }
  };

  /**
   * Paid feeds carry the listener's own subscriber token in the URL. The client
   * already refuses to send those to the public proxies and routes them here
   * instead — but here they were being written into Cloudflare's SHARED edge
   * cache under `Cache-Control: public` for 15 minutes, which put one
   * listener's private episodes in a cache entry keyed by a URL they do not
   * exclusively control. Those responses are now never stored.
   */
  if (carriesCredential(target.href)) {
    const res = await fetchFeed();
    res.headers.set('cache-control', 'no-store');
    return res;
  }

  return edgeCached(
    'https://cache.seseri/feed?u=' + encodeURIComponent(target.href),
    15 * 60,
    c.executionCtx,
    fetchFeed,
  );
});

// ── iTunes API proxy (fixes their Origin-blind CDN caching) ─────────
app.get('/v1/itunes', async (c) => {
  const target = safeTarget(c.req.query('url'));
  if (!target || !/(^|\.)itunes\.apple\.com$/.test(target.hostname)) {
    return c.json({ error: 'invalid url' }, 400);
  }
  return edgeCached(
    'https://cache.seseri/itunes?u=' + encodeURIComponent(target.href),
    60 * 60,
    c.executionCtx,
    async () => {
      try {
        const res = await fetchWithTimeout(target.href, 10000);
        if (!res.ok) return c.json({ error: 'upstream ' + res.status }, 502);
        const body = await readCapped(res, FEED_MAX_BYTES);
        return new Response(body, {
          headers: { 'content-type': 'application/json; charset=utf-8', ...NOSNIFF },
        });
      } catch (e) {
        return proxyError(c, e);
      }
    },
  );
});

app.route(SYNC_PREFIX, syncRoutes);

app.notFound((c) => c.json({ error: 'not found' }, 404));

export { RateLimiterDO } from './ratelimit';

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await sweepSync(env.DB);
  },
};
