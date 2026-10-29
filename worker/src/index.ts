/**
 * Seseri API — Cloudflare Worker backend.
 *
 *   GET /v1/feed?url=      RSS/Atom proxy (raw text, ≤20 MB, edge-cached 15 min)
 *   GET /v1/parse?url=     the same feed, parsed here and returned as compact
 *                          JSON (edge-cached 15 min, sliceable)
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
import { isFeedDocument } from './feed-shape';
import { scanRss } from './rss-scan';
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
 * if a browser is ever pointed straight at the proxy URL. The origin gate only
 * stops a browser navigation (which sends no `Origin`), so a passthrough
 * content type is not something to leave open-ended. An
 * absent content type is allowed: plenty of small feed hosts send none, and the
 * body is capped and never executed. `isFeedDocument` is the check that does
 * not depend on what the upstream claims to be.
 */
function feedContentType(ct: string): boolean {
  if (!ct) return true;
  return !/html|svg|javascript|ecmascript/.test(ct);
}

app.use('*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') ?? '';

  if (c.req.path !== '/' && !allowOrigin(c.req.header('origin') ?? '', c.req.url)) {
    // Browser-side CORS policy, not authentication. Any client can send
    // `Origin: https://iacbi.github.io` — the app is a public static client with
    // no secret to check — so this only turns away a page on another site. It
    // does not stop curl. The abuse limits are the ones below and in
    // safeTarget(): private hosts refused and redirects re-checked, the
    // per-client rate limit, size and time caps, and the feed-shape check on
    // /v1/feed.
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
      // Refused before edgeCached stores anything: only a 200 is cached.
      if (!isFeedDocument(body)) return c.json({ error: 'not a feed' }, 415);
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

/**
 * One host, deliberately.
 *
 * Apple's top-shows chart (`rss.marketingtools.apple.com`) was going to be
 * added here for a discovery screen, and was measured first: it answers 200 to
 * an ordinary client and 403 to this Worker, whatever headers it sends — Apple
 * refuses that endpoint from datacentre egress. It is also the only Apple
 * endpoint that sends no CORS headers, so the browser cannot read it either.
 * Discovery is built on the search endpoint below instead (feeds/topics.ts),
 * and this stays a one-host allow-list rather than carrying a host nothing
 * can call.
 */
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

// ── parsed feed (the same bytes, without shipping them) ─────────────
/**
 * Why this exists next to `/v1/feed`: a popular show's archive is tens of
 * megabytes of XML, and the client was downloading all of it and building a DOM
 * from it on the main thread to end up with a list of titles and URLs. Parsing
 * here turns that into a JSON document an order of magnitude smaller, with no
 * DOM anywhere — `rss-scan.ts` is the same file the client ships, duplicated
 * verbatim, so both sides agree on every `trackId`.
 *
 * `/v1/feed` stays: the client falls back to it (and to the public proxies)
 * whenever this endpoint is unreachable, and it parses the XML itself then.
 */

/** Hard ceiling on what one response will carry, whatever the feed claims. */
const PARSE_MAX_EPISODES = 5000;

/**
 * Ceiling on what the cached document keeps, which is what `offset` pages
 * through. It used to be the per-response cap as well, so everything past the
 * first 5000 items was discarded before anyone could ask for it. Matches the
 * client's own ceiling (`MAX_PARSED_EPISODES` in src/feeds/proxy-chain.ts);
 * the 20 MB read cap bounds the document long before this in practice.
 */
const PARSE_DOC_MAX_EPISODES = 20_000;

/** Charset for a feed's bytes: the header first, then the XML declaration. */
function feedCharset(contentType: string, head: Uint8Array): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  // The declaration is ASCII-compatible in every encoding we might meet here,
  // so sniffing the first bytes as latin1 is safe for reading it.
  const prologue = new TextDecoder('latin1').decode(head.subarray(0, 200));
  const fromXml = /encoding=["']([\w-]+)["']/i.exec(prologue)?.[1];
  return (fromXml ?? 'utf-8').toLowerCase();
}

/**
 * Decode with the feed's declared charset.
 *
 * The client used to call `res.text()`, which defaults to UTF-8 when the
 * response carries no charset — so a windows-1252 feed arrived with mangled
 * titles. Decoding here, where the content type is still in hand, fixes those
 * feeds as a side effect. An unknown label falls back to UTF-8 rather than
 * failing the request.
 */
function decodeFeed(bytes: Uint8Array, contentType: string): string {
  const charset = feedCharset(contentType, bytes);
  try {
    return new TextDecoder(charset, { fatal: false, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Non-negative integer query parameter, or undefined. */
function intParam(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

interface ParsedDoc {
  meta: { name: string; artist: string; art: string };
  total: number;
  /** Names the notes chunks this list belongs to; see `notesKey`. */
  build: string;
  /** Episodes per notes chunk; see `chunkSize`. */
  chunk: number;
  /** Episodes without `description`. */
  episodes: Array<Record<string, unknown>>;
}

/**
 * Each chunk is one `cache.put` on a miss, and every cache call is a
 * subrequest against a per-invocation cap (50 on the free plan). Small chunks
 * keep a notes lookup cheap; the cap on their number keeps a 20,000-episode
 * archive from failing on the writes.
 */
const NOTES_CHUNK_MIN = 50;
const NOTES_CHUNKS_MAX = 24;
const chunkSize = (episodes: number): number =>
  Math.max(NOTES_CHUNK_MIN, Math.ceil(episodes / NOTES_CHUNKS_MAX));
const PARSE_TTL = 15 * 60;

const listKey = (href: string): string =>
  'https://cache.seseri/parse/v2?u=' + encodeURIComponent(href);
/**
 * `build` is in the key so a chunk can only ever be read together with the list
 * that was written alongside it; chunks of an older build just expire unread.
 */
const notesKey = (href: string, build: string, chunk: number): string =>
  `https://cache.seseri/parse-notes/v2?u=${encodeURIComponent(href)}&b=${build}&c=${chunk}`;

app.get('/v1/parse', async (c) => {
  const target = safeTarget(c.req.query('url'));
  if (!target) return c.json({ error: 'invalid url' }, 400);

  const offset = intParam(c.req.query('offset')) ?? 0;
  const limit = Math.min(intParam(c.req.query('limit')) ?? PARSE_MAX_EPISODES, PARSE_MAX_EPISODES);
  /**
   * Show notes are most of a feed's bytes and none of a list's content.
   *
   * Measured on three real archives, compressed, which is what actually
   * travels: The Daily is 1.31 MB of brotli as XML and 1.06 MB as JSON with
   * notes — a rounding error, because XML compresses well — but 0.28 MB
   * without them. Vergecast goes from 0.80 MB to 0.08 MB. So the client asks
   * for a list with no notes and fetches the one episode's notes it is about
   * to render, which is what `notesFor` is for.
   *
   * Notes are included unless asked otherwise: a caller that does not know
   * about this parameter must still get a complete answer.
   */
  const wantNotes = c.req.query('notes') !== '0';
  const notesFor = c.req.query('notesFor');

  const cacheable = !carriesCredential(target.href);
  /** Notes chunks of a freshly parsed feed, so this request need not re-read them. */
  let built: Array<Array<string | null>> | undefined;

  const fetchAndParse = async (): Promise<Response> => {
    try {
      const res = await fetchWithTimeout(target.href, 15000, {
        headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      });
      if (!res.ok) return c.json({ error: 'upstream ' + res.status }, 502);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!feedContentType(ct)) return c.json({ error: 'not a feed' }, 415);
      const bytes = await readCapped(res, FEED_MAX_BYTES);
      const parsed = scanRss(decodeFeed(bytes, ct));
      const kept = parsed.episodes.slice(0, PARSE_DOC_MAX_EPISODES);
      const build = crypto.randomUUID();
      const chunk = chunkSize(kept.length);
      const chunks: Array<Array<string | null>> = [];
      const episodes = kept.map((e, i) => {
        const { description, ...rest } = e;
        const note = typeof description === 'string' ? description : null;
        (chunks[Math.floor(i / chunk)] ??= []).push(note);
        return rest;
      });
      built = chunks;
      if (cacheable) {
        const cache = caches.default;
        chunks.forEach((chunk, n) =>
          c.executionCtx.waitUntil(
            cache.put(
              new Request(notesKey(target.href, build, n), { method: 'GET' }),
              Response.json(chunk, {
                headers: { 'cache-control': `public, max-age=${PARSE_TTL}` },
              }),
            ),
          ),
        );
      }
      return Response.json({
        meta: { name: parsed.title, artist: parsed.author, art: parsed.art },
        total: parsed.episodes.length,
        build,
        chunk,
        episodes,
      } satisfies ParsedDoc);
    } catch (e) {
      // `invalid rss` is the parser's verdict on something that is not a feed,
      // which is the caller's URL being wrong rather than an upstream fault.
      if ((e as Error).message === 'invalid rss') return c.json({ error: 'not a feed' }, 415);
      return proxyError(c, e);
    }
  };

  /**
   * The cached list carries no show notes, and the notes live in separate
   * chunk entries. Notes are most of the bytes, and a paged or `notes=0`
   * request used to JSON.parse all of them (megabytes, on a 20,000-episode
   * archive) just to slice a few rows — CPU time the Worker does not have.
   */
  const full = cacheable
    ? await edgeCached(listKey(target.href), PARSE_TTL, c.executionCtx, fetchAndParse)
    : await fetchAndParse();

  if (full.status !== 200) return full;

  const doc = (await full.json()) as ParsedDoc;

  /** Notes for episodes [from, to) of the list, or undefined if a chunk has gone missing. */
  const readNotes = async (from: number, to: number): Promise<Array<string | null> | undefined> => {
    const out: Array<string | null> = [];
    const size = doc.chunk;
    const first = Math.floor(from / size);
    const last = Math.floor((to - 1) / size);
    for (let n = first; n <= last; n++) {
      let chunk = built?.[n];
      if (!chunk) {
        const key = notesKey(target.href, doc.build, n);
        const hit = await caches.default.match(new Request(key, { method: 'GET' }));
        if (!hit) return undefined;
        chunk = (await hit.json()) as Array<string | null>;
      }
      const lo = Math.max(from, n * size) - n * size;
      const hi = Math.min(to, (n + 1) * size) - n * size;
      out.push(...chunk.slice(lo, hi));
    }
    return out;
  };

  /**
   * Attach notes to `eps` (which start at list index `from`). If the chunks
   * were evicted before the list, re-parse once and read them from memory.
   */
  const withNotes = async (from: number, eps: Array<Record<string, unknown>>) => {
    if (eps.length === 0) return eps;
    let notes = await readNotes(from, from + eps.length);
    if (!notes) {
      await fetchAndParse();
      notes = await readNotes(from, from + eps.length);
    }
    return eps.map((e, i) => {
      const d = notes?.[i];
      return typeof d === 'string' ? { ...e, description: d } : e;
    });
  };

  /**
   * One episode by id, notes included: a single chunk read, so no re-parse of
   * the feed and no parse of anyone else's notes.
   */
  let window: Array<Record<string, unknown>>;
  if (notesFor !== undefined) {
    const at = doc.episodes.findIndex((e) => e['trackId'] === notesFor);
    const ep = doc.episodes[at];
    window = ep ? await withNotes(at, [ep]) : [];
  } else {
    window = doc.episodes.slice(offset, offset + limit);
    if (wantNotes) window = await withNotes(offset, window);
  }

  return c.json({ meta: doc.meta, total: doc.total, offset, episodes: window }, 200, {
    ...NOSNIFF,
    // Sliced per request, and a private feed must never be stored anywhere.
    'cache-control': cacheable ? 'private, max-age=300' : 'no-store',
    'x-seseri-cache': full.headers.get('x-seseri-cache') ?? 'bypass',
  });
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
