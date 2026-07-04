/**
 * Seseri API — Cloudflare Worker backend.
 *
 *   GET /v1/feed?url=      RSS/Atom proxy (text, ≤5 MB, edge-cached 15 min)
 *   GET /v1/itunes?url=    iTunes search/lookup proxy (JSON, edge-cached 1 h)
 *   GET /v1/yt/list        ?type=playlist|channel&id= → YtListing JSON
 *   GET /v1/yt/resolve     ?id=<videoId> → { audioUrl }
 *
 * Cross-cutting: CORS allowlist, per-IP KV rate limit, health-checked
 * upstream pool refreshed by cron.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { edgeCached, fetchWithTimeout, readCapped, safeTarget } from './safe-fetch';
import { rateLimited } from './ratelimit';
import { poolSearch, refreshHealth, ytList, ytResolve, type YtKind } from './yt';
import { tubeAudio, tubeSearch, type TubeAudio } from './innertube';

// Popular feeds keep their full archive in the feed — The Daily's RSS alone
// is ~18 MB — so the cap is generous; it only guards against abuse.
const FEED_MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set(['https://iacbi.github.io']);
// Any localhost origin is fine — it only ever means the developer's own machine.
const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function allowOrigin(origin: string): string | null {
  return ALLOWED_ORIGINS.has(origin) || LOCALHOST_ORIGIN.test(origin) ? origin : null;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: allowOrigin,
    allowMethods: ['GET', 'OPTIONS'],
    maxAge: 86400,
  }),
);

app.use('*', async (c, next) => {
  // Audio streaming is exempt: seeking issues bursts of range requests
  if (c.req.path === '/v1/yt/audio') return next();
  const ip = c.req.header('cf-connecting-ip') ?? '';
  if (await rateLimited(c.env.KV, ip)) {
    return c.json({ error: 'rate limited' }, 429, { 'retry-after': '60' });
  }
  await next();
});

app.get('/', (c) => c.json({ name: 'seseri-api', ok: true }));

// ── RSS/Atom proxy ──────────────────────────────────────────────────
app.get('/v1/feed', async (c) => {
  const target = safeTarget(c.req.query('url'));
  if (!target) return c.json({ error: 'invalid url' }, 400);

  return edgeCached(
    'https://cache.seseri/feed?u=' + encodeURIComponent(target.href),
    15 * 60,
    c.executionCtx,
    async () => {
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
    },
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

// ── YouTube ─────────────────────────────────────────────────────────
app.get('/v1/yt/list', async (c) => {
  const type = c.req.query('type');
  const id = c.req.query('id') ?? '';
  if ((type !== 'playlist' && type !== 'channel') || !/^[\w-]{10,64}$/.test(id)) {
    return c.json({ error: 'invalid params' }, 400);
  }
  return edgeCached(
    `https://cache.seseri/yt-list?t=${type}&i=${encodeURIComponent(id)}`,
    15 * 60,
    c.executionCtx,
    async () => {
      const listing = await ytList(c.env.KV, type as YtKind, id);
      if (!listing) return c.json({ error: 'no upstream' }, 502);
      return c.json(listing);
    },
  );
});

app.get('/v1/yt/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2 || q.length > 100) return c.json({ error: 'invalid query' }, 400);
  return edgeCached(
    'https://cache.seseri/yt-search?q=' + encodeURIComponent(q.toLowerCase()),
    15 * 60,
    c.executionCtx,
    async () => {
      try {
        const items = await tubeSearch(q);
        if (items.length) return c.json({ items });
      } catch (e) {
        console.error('tubeSearch failed:', (e as Error).message);
      }
      try {
        const items = await poolSearch(c.env.KV, q);
        return c.json({ items });
      } catch {
        return c.json({ error: 'no upstream' }, 502);
      }
    },
  );
});

/** Resolve an audio format for the audio proxy; cached in KV (URLs ~6 h). */
async function audioFor(kv: KVNamespace, id: string): Promise<TubeAudio | null> {
  const key = 'yta:' + id;
  const hit = await kv.get<TubeAudio>(key, 'json').catch(() => null);
  if (hit) return hit;
  const fresh = await tubeAudio(id).catch((e: Error) => {
    console.error('tubeAudio failed:', e.message);
    return null;
  });
  if (fresh) await kv.put(key, JSON.stringify(fresh), { expirationTtl: 1800 }).catch(() => {});
  return fresh;
}

app.get('/v1/yt/resolve', async (c) => {
  const id = c.req.query('id') ?? '';
  if (!/^[\w-]{11}$/.test(id)) return c.json({ error: 'invalid id' }, 400);
  // Innertube first: its stream URLs are IP-bound to this worker, so the
  // client gets our /v1/yt/audio proxy URL instead of the raw googlevideo one.
  const own = await audioFor(c.env.KV, id);
  if (own) {
    return c.json({ audioUrl: new URL('/v1/yt/audio?id=' + id, c.req.url).href });
  }
  return edgeCached(
    'https://cache.seseri/yt-resolve?i=' + encodeURIComponent(id),
    5 * 60, // public-instance URLs expire upstream — keep this short
    c.executionCtx,
    async () => {
      const audioUrl = await ytResolve(c.env.KV, id);
      if (!audioUrl) return c.json({ error: 'no stream' }, 502);
      return c.json({ audioUrl });
    },
  );
});

/** Stream the audio bytes through the worker (range-aware → seek works). */
app.get('/v1/yt/audio', async (c) => {
  const id = c.req.query('id') ?? '';
  if (!/^[\w-]{11}$/.test(id)) return c.json({ error: 'invalid id' }, 400);
  let fmt = await audioFor(c.env.KV, id);
  if (!fmt) return c.json({ error: 'no stream' }, 502);

  // googlevideo 403s range-less requests — always send one; when the client
  // didn't ask for a range we unwrap the 206 back into a plain 200 below.
  const clientRange = c.req.header('range');
  const range = clientRange ?? 'bytes=0-';
  const upstreamFetch = (f: TubeAudio): Promise<Response> =>
    fetch(f.url, { headers: { 'user-agent': f.ua, range } });

  let upstream = await upstreamFetch(fmt);
  if (upstream.status === 403 || upstream.status === 410) {
    // URL expired — re-resolve once and retry
    await c.env.KV.delete('yta:' + id).catch(() => {});
    fmt = await audioFor(c.env.KV, id);
    if (!fmt) return c.json({ error: 'no stream' }, 502);
    upstream = await upstreamFetch(fmt);
  }
  if (!upstream.ok && upstream.status !== 206) {
    return c.json({ error: 'upstream ' + upstream.status }, 502);
  }

  const headers = new Headers({ 'content-type': fmt.mime, 'accept-ranges': 'bytes' });
  headers.set('cache-control', 'no-store');
  if (!clientRange && upstream.status === 206) {
    // client wanted the whole file — present the full-range 206 as a 200
    const total = upstream.headers.get('content-range')?.split('/')[1];
    if (total) headers.set('content-length', total);
    return new Response(upstream.body, { status: 200, headers });
  }
  for (const h of ['content-range', 'content-length'] as const) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
});

app.notFound((c) => c.json({ error: 'not found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshHealth(env.KV).then(() => {}));
  },
};
