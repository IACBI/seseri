/**
 * Seseri API — Cloudflare Worker backend.
 *
 *   GET /v1/feed?url=      RSS/Atom proxy (text, ≤5 MB, edge-cached 15 min)
 *   GET /v1/itunes?url=    iTunes search/lookup proxy (JSON, edge-cached 1 h)
 *   /v1/sync               cross-device blob store (GET/PUT/DELETE, see sync.ts)
 *
 * Cross-cutting: CORS allowlist, per-IP KV rate limit — except /v1/sync, which
 * carries its own limiter so it cannot exhaust the shared KV write budget.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { carriesCredential } from './credential-url';
import { edgeCached, fetchWithTimeout, readCapped, safeTarget } from './safe-fetch';
import { rateLimited } from './ratelimit';
import { sweepSync, syncRoutes } from './sync';

// Popular feeds keep their full archive in the feed — The Daily's RSS alone
// is ~18 MB — so the cap is generous; it only guards against abuse.
const FEED_MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set(['https://iacbi.github.io']);
// Any localhost origin is fine — it only ever means the developer's own machine.
const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const SYNC_PREFIX = '/v1/sync';

function allowOrigin(origin: string): string | null {
  return ALLOWED_ORIGINS.has(origin) || LOCALHOST_ORIGIN.test(origin) ? origin : null;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: allowOrigin,
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

app.use('*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') ?? '';

  if (c.req.path !== '/' && !allowOrigin(c.req.header('origin') ?? '')) {
    // Without this the proxy endpoints are usable as a general-purpose open
    // proxy, which also lets anyone seed our edge cache. Browsers always send
    // Origin on a cross-origin fetch and the app is never same-origin with the
    // worker, so a missing or foreign Origin means the caller is not the app.
    return c.json({ error: 'forbidden' }, 403);
  }

  /**
   * Sync runs its own limiter. Routing it through the KV one would spend a KV
   * write per request out of a 1000/day free-tier budget shared with the feed
   * and iTunes proxies — and that limiter degrades open once the budget is
   * gone, because `ratelimit.ts` swallows the write error and the counter
   * stops growing. Exhausting it would take the whole worker down, not just
   * sync.
   */
  if (c.req.path.startsWith(SYNC_PREFIX)) return next();

  if (await rateLimited(c.env.KV, ip)) {
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
      if (ct.includes('text/html')) return c.json({ error: 'not a feed' }, 415);
      const body = await readCapped(res, FEED_MAX_BYTES);
      return new Response(body, {
        headers: { 'content-type': ct || 'application/xml; charset=utf-8' },
      });
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg === 'too large' ? 'feed too large' : 'fetch failed' }, msg === 'too large' ? 413 : 502);
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
        return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8' } });
      } catch {
        return c.json({ error: 'fetch failed' }, 502);
      }
    },
  );
});

app.route(SYNC_PREFIX, syncRoutes);

app.notFound((c) => c.json({ error: 'not found' }, 404));

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
