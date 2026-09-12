import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index';

/**
 * `/v1/parse` exists so the client stops downloading tens of megabytes of XML
 * and building a DOM out of it. The parser itself is covered exhaustively on
 * the frontend side (`src/feeds/rss-scan.test.ts`, against a DOMParser
 * reference); what matters here is the endpoint around it: the guards it
 * inherits from `/v1/feed`, the slicing, the caching, and that a private feed
 * never reaches the shared edge cache.
 */

const APP_ORIGIN = 'https://iacbi.github.io';
const DEPLOYED = 'https://api.test';
const HOST = 'https://feeds.example.com';

async function call(path: string, origin: string | null = APP_ORIGIN): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(DEPLOYED + path, { headers: origin === null ? {} : { origin } }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

function parseUrl(feedPath: string, extra = ''): string {
  return '/v1/parse?url=' + encodeURIComponent(HOST + feedPath) + extra;
}

interface ParsedBody {
  meta: { name: string; artist: string; art: string };
  total: number;
  offset: number;
  episodes: Array<{ trackId: string; trackName: string; episodeUrl: string }>;
}

/**
 * `count` items, newest-first the way real feeds are ordered. `notesChars`
 * stands in for show notes, which on real archives are most of the bytes:
 * measured across three feeds the median episode carries about 2 KB of them.
 */
function feed(count: number, opts: { title?: string; notesChars?: number } = {}): string {
  const notes = 'x'.repeat(opts.notesChars ?? 0);
  const items = Array.from(
    { length: count },
    (_, i) =>
      `<item><title>Ep ${i}</title><guid>g${i}</guid>` +
      `<pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>` +
      `<enclosure url="https://cdn.example.com/${i}.mp3" type="audio/mpeg"/>` +
      `<itunes:duration>${60 + i}</itunes:duration>` +
      (notes ? `<description><![CDATA[<p>${notes}</p>]]></description>` : '') +
      `</item>`,
  ).join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>` +
    `<title>${opts.title ?? 'Parsed Pod'}</title>` +
    `<itunes:author>Author</itunes:author>` +
    `<itunes:image href="https://img.example.com/a.jpg"/>` +
    `${items}</channel></rss>`
  );
}

function serve(path: string, body: string | Uint8Array, contentType = 'application/rss+xml'): void {
  fetchMock
    .get(HOST)
    .intercept({ path })
    .reply(200, body as never, { headers: { 'content-type': contentType } });
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('GET /v1/parse', () => {
  it('returns feed metadata and episodes as JSON', async () => {
    serve('/pod.xml', feed(3));
    const res = await call(parseUrl('/pod.xml'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');

    const body = (await res.json()) as ParsedBody;
    expect(body.meta).toEqual({
      name: 'Parsed Pod',
      artist: 'Author',
      art: 'https://img.example.com/a.jpg',
    });
    expect(body.total).toBe(3);
    expect(body.offset).toBe(0);
    expect(body.episodes.map((e) => e.trackId)).toEqual(['g0', 'g1', 'g2']);
    expect(body.episodes[0]).toMatchObject({
      trackName: 'Ep 0',
      episodeUrl: 'https://cdn.example.com/0.mp3',
      trackTimeMillis: 60000,
    });
  });

  it('is smaller than the XML it replaces, and much smaller without notes', async () => {
    const xml = feed(300, { notesChars: 2000 });
    serve('/big.xml', xml);
    const withNotes = await (await call(parseUrl('/big.xml'))).text();
    const lean = await (await call(parseUrl('/big.xml', '&notes=0'))).text();

    // Keeping the notes still helps, but not by much: they are the bulk.
    expect(withNotes.length).toBeLessThan(xml.length);
    // Dropping them is the actual win, and it is a large one.
    expect(lean.length).toBeLessThan(withNotes.length / 4);
  });

  it('omits show notes on request, and nothing else', async () => {
    serve('/notes.xml', feed(2, { notesChars: 50 }));
    const body = (await (await call(parseUrl('/notes.xml', '&notes=0'))).json()) as ParsedBody;
    const ep = body.episodes[0] as Record<string, unknown>;
    expect(ep['description']).toBeUndefined();
    // Everything a list renders is still there.
    expect(ep).toMatchObject({
      trackId: 'g0',
      trackName: 'Ep 0',
      episodeUrl: 'https://cdn.example.com/0.mp3',
      trackTimeMillis: 60000,
    });
  });

  it('includes show notes unless asked not to', async () => {
    serve('/notes.xml', feed(1, { notesChars: 30 }));
    const body = (await (await call(parseUrl('/notes.xml'))).json()) as ParsedBody;
    expect((body.episodes[0] as Record<string, unknown>)['description']).toContain('xxx');
  });

  it('serves the notes for one episode by id, from the document it already parsed', async () => {
    serve('/notes.xml', feed(5, { notesChars: 40 }));
    // Fill the cache with a lean list first, the way the client does.
    const list = (await (await call(parseUrl('/notes.xml', '&notes=0'))).json()) as ParsedBody;
    expect((list.episodes[3] as Record<string, unknown>)['description']).toBeUndefined();

    const res = await call(parseUrl('/notes.xml', '&notesFor=g3'));
    expect(res.headers.get('x-seseri-cache')).toBe('hit');
    const body = (await res.json()) as ParsedBody;
    expect(body.episodes).toHaveLength(1);
    expect(body.episodes[0]?.trackId).toBe('g3');
    expect((body.episodes[0] as Record<string, unknown>)['description']).toContain('xxx');
  });

  it('answers an unknown episode id with an empty list, not an error', async () => {
    serve('/notes.xml', feed(2, { notesChars: 10 }));
    const res = await call(parseUrl('/notes.xml', '&notesFor=nope'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as ParsedBody).episodes).toEqual([]);
  });

  it('slices with offset and limit, and still reports the real total', async () => {
    serve('/pod.xml', feed(50));
    const res = await call(parseUrl('/pod.xml', '&offset=10&limit=5'));
    const body = (await res.json()) as ParsedBody;

    expect(body.total).toBe(50);
    expect(body.offset).toBe(10);
    expect(body.episodes.map((e) => e.trackId)).toEqual(['g10', 'g11', 'g12', 'g13', 'g14']);
  });

  it('treats a nonsense offset or limit as absent rather than failing', async () => {
    serve('/pod.xml', feed(4));
    const res = await call(parseUrl('/pod.xml', '&offset=-3&limit=abc'));
    const body = (await res.json()) as ParsedBody;
    expect(body.offset).toBe(0);
    expect(body.episodes).toHaveLength(4);
  });

  it('returns an empty window past the end, not an error', async () => {
    serve('/pod.xml', feed(4));
    const res = await call(parseUrl('/pod.xml', '&offset=99'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ParsedBody;
    expect(body.episodes).toEqual([]);
    expect(body.total).toBe(4);
  });

  it('decodes a feed by its declared charset', async () => {
    // windows-1252: 0xE7 is "ç", 0xFC is "ü". Read as UTF-8 these are
    // replacement characters, which is what the client's own `res.text()` used
    // to produce for feeds that send no charset in the header.
    const latin = `<?xml version="1.0" encoding="windows-1252"?><rss><channel>` +
      `<title>G\xFCndem \xE7ok</title>` +
      `<item><guid>g1</guid><enclosure url="https://cdn.example.com/1.mp3"/></item>` +
      `</channel></rss>`;
    const bytes = Uint8Array.from([...latin].map((ch) => ch.charCodeAt(0)));
    serve('/latin.xml', bytes, 'application/rss+xml');

    const body = (await (await call(parseUrl('/latin.xml'))).json()) as ParsedBody;
    expect(body.meta.name).toBe('Gündem çok');
  });

  it('prefers the charset in the content type over the declaration', async () => {
    const utf8 = `<?xml version="1.0" encoding="windows-1252"?><rss><channel>` +
      `<title>Gündem</title>` +
      `<item><guid>g1</guid><enclosure url="https://cdn.example.com/1.mp3"/></item>` +
      `</channel></rss>`;
    serve('/mislabelled.xml', utf8, 'application/rss+xml; charset=utf-8');
    const body = (await (await call(parseUrl('/mislabelled.xml'))).json()) as ParsedBody;
    expect(body.meta.name).toBe('Gündem');
  });

  it('rejects a private target, like every other proxy route', async () => {
    expect((await call('/v1/parse?url=http://127.0.0.1/x')).status).toBe(400);
    expect((await call('/v1/parse?url=not-a-url')).status).toBe(400);
  });

  it('requires the app origin', async () => {
    expect((await call(parseUrl('/pod.xml'), null)).status).toBe(403);
    expect((await call(parseUrl('/pod.xml'), 'https://evil.example')).status).toBe(403);
  });

  it('refuses a document that is not a feed', async () => {
    serve('/page.html', '<html><body>nope</body></html>', 'text/html');
    expect((await call(parseUrl('/page.html'))).status).toBe(415);
  });

  it('reports unparseable content as 415 rather than a server error', async () => {
    serve('/junk.xml', 'this is not a feed at all', 'application/xml');
    const res = await call(parseUrl('/junk.xml'));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: 'not a feed' });
  });

  it('propagates an upstream failure as 502', async () => {
    fetchMock.get(HOST).intercept({ path: '/dead.xml' }).reply(500, 'x');
    expect((await call(parseUrl('/dead.xml'))).status).toBe(502);
  });

  it('serves a second request from the edge cache without refetching', async () => {
    // One interceptor only: a second upstream fetch would leave it pending and
    // `assertNoPendingInterceptors` would not be the thing that failed — the
    // request itself would throw on a disabled net connection.
    serve('/cached.xml', feed(2));
    const first = await call(parseUrl('/cached.xml'));
    expect(first.headers.get('x-seseri-cache')).toBe('miss');

    const second = await call(parseUrl('/cached.xml', '&limit=1'));
    expect(second.status).toBe(200);
    expect(second.headers.get('x-seseri-cache')).toBe('hit');
    // Same cached document, a different slice of it.
    const body = (await second.json()) as ParsedBody;
    expect(body.total).toBe(2);
    expect(body.episodes.map((e) => e.trackId)).toEqual(['g0']);
  });

  it('never stores a credential-bearing feed in the shared edge cache', async () => {
    // The same rule `/v1/feed` follows: a paid feed's URL carries the
    // listener's own subscriber token, and the edge cache is shared.
    // `auth_token` is one of the parameter names `credential-url.ts` knows.
    const path = '/private.xml?auth_token=abc123def456';
    serve(path, feed(1));
    const first = await call('/v1/parse?url=' + encodeURIComponent(HOST + path));
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('x-seseri-cache')).toBe('bypass');

    // Proof it was not stored: a second call needs the upstream again.
    serve(path, feed(1));
    const second = await call('/v1/parse?url=' + encodeURIComponent(HOST + path));
    expect(second.headers.get('x-seseri-cache')).toBe('bypass');
  });
});
