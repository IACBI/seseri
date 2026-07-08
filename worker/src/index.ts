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

/**
 * Resolve an audio format for the audio proxy; cached in KV (URLs ~6 h).
 * Failures are cached too ("none") so /v1/yt/resolve falls through to the
 * public pool quickly instead of re-probing every client each time.
 */
async function audioFor(kv: KVNamespace, id: string): Promise<TubeAudio | null> {
  const key = 'yta2:' + id;
  const hit = await kv.get<TubeAudio | { none: true }>(key, 'json').catch(() => null);
  if (hit) return 'none' in hit ? null : hit;
  const fresh = await tubeAudio(id).catch((e: Error) => {
    console.error('tubeAudio failed:', e.message);
    return null;
  });
  await kv
    .put(key, JSON.stringify(fresh ?? { none: true }), { expirationTtl: fresh ? 1800 : 900 })
    .catch(() => {});
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

/**
 * Stream the audio bytes through the worker (range-aware → seek works).
 * googlevideo rejects range-less and open-ended requests but happily serves
 * bounded ranges — so the requested span is fetched as sequential ≤4 MB
 * chunks stitched into one streamed response.
 */
const AUDIO_CHUNK = 1024 * 1024;

app.get('/v1/yt/audio', async (c) => {
  const id = c.req.query('id') ?? '';
  if (!/^[\w-]{11}$/.test(id)) return c.json({ error: 'invalid id' }, 400);
  const kv = c.env.KV;
  let fmt = await audioFor(kv, id);
  if (!fmt) return c.json({ error: 'no stream' }, 502);

  const size = fmt.contentLength || 0;
  const m = /bytes=(\d+)-(\d*)/.exec(c.req.header('range') ?? '');
  const clientRanged = !!m;
  const start = m ? parseInt(m[1] ?? '0') : 0;
  const endWanted =
    m && m[2] ? Math.min(parseInt(m[2]), size ? size - 1 : Infinity) : size ? size - 1 : -1;
  if (endWanted < 0) return c.json({ error: 'no stream' }, 502); // unknown length
  if (start > endWanted) return c.body(null, 416);

  const chunk = async (from: number, to: number, allowRetry: boolean): Promise<Response> => {
    // googlevideo's own `range` query param passes where the Range header is
    // rejected for non-zero offsets (PO-token era first-chunk-only behavior)
    const u = fmt!.url + `&range=${from}-${to}`;
    const res = await fetch(u, { headers: { 'user-agent': fmt!.ua } });
    if ((res.status === 403 || res.status === 410) && allowRetry) {
      await kv.delete('yta2:' + id).catch(() => {});
      fmt = await audioFor(kv, id);
      if (fmt) return chunk(from, to, false); // fresh URL, one retry
    }
    return res;
  };

  // Probe the first chunk before committing to a streamed response
  const firstTo = Math.min(start + AUDIO_CHUNK - 1, endWanted);
  const first = await chunk(start, firstTo, true);
  if (!first.ok && first.status !== 206) {
    return c.json({ error: 'upstream ' + first.status }, 502);
  }

  const total = endWanted - start + 1;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let res = first;
        let from = start;
        for (;;) {
          const reader = res.body?.getReader();
          if (!reader) break;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          from += AUDIO_CHUNK;
          if (from > endWanted) break;
          res = await chunk(from, Math.min(from + AUDIO_CHUNK - 1, endWanted), true);
          if (!res.ok && res.status !== 206) break;
        }
      } catch {
        /* client went away or upstream died mid-stream */
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  const headers = new Headers({
    'content-type': fmt.mime,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-length': String(total),
  });
  if (clientRanged) {
    headers.set('content-range', `bytes ${start}-${endWanted}/${size}`);
    return new Response(stream, { status: 206, headers });
  }
  return new Response(stream, { status: 200, headers });
});

app.notFound((c) => c.json({ error: 'not found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshHealth(env.KV).then(() => {}));
  },
};
