import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { safeTarget } from '../src/safe-fetch';

const APP_ORIGIN = 'https://iacbi.github.io';

/** A deployed worker's own hostname. `wrangler dev` serves on 127.0.0.1. */
const DEPLOYED = 'https://api.test';
const LOCAL_WORKER = 'http://127.0.0.1:8787';

/** Proxy endpoints require the app's Origin, so send it unless a test overrides. */
async function call(
  path: string,
  origin: string | null = APP_ORIGIN,
  base: string = DEPLOYED,
): Promise<Response> {
  const ctx = createExecutionContext();
  const req = new Request(base + path, {
    headers: origin === null ? {} : { origin },
  });
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('safeTarget', () => {
  it('accepts public http(s) urls', () => {
    expect(safeTarget('https://example.com/feed.xml')?.href).toBe('https://example.com/feed.xml');
  });
  it.each([
    'ftp://example.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.1.2.3/x',
    'https://192.168.1.1/x',
    'https://172.16.0.1/x',
    'https://user:pw@example.com/x',
    'https://foo.internal/x',
    'not a url',
    '',
  ])('rejects %s', (raw) => {
    expect(safeTarget(raw)).toBeNull();
  });
});

describe('routing & validation', () => {
  it('health endpoint answers', async () => {
    const res = await call('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('rejects a private feed url', async () => {
    expect((await call('/v1/feed?url=http://127.0.0.1/x')).status).toBe(400);
  });

  it('rejects non-itunes hosts on /v1/itunes', async () => {
    expect((await call('/v1/itunes?url=https://evil.com/lookup')).status).toBe(400);
  });

  it('404s unknown paths', async () => {
    expect((await call('/nope')).status).toBe(404);
  });
});

describe('/v1/feed proxy', () => {
  it('returns upstream XML and caches it', async () => {
    fetchMock
      .get('https://feeds.example.com')
      .intercept({ path: '/pod.xml' })
      .reply(200, '<rss><channel><title>T</title></channel></rss>', {
        headers: { 'content-type': 'application/rss+xml' },
      });
    const res = await call('/v1/feed?url=' + encodeURIComponent('https://feeds.example.com/pod.xml'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>T</title>');
    expect(res.headers.get('content-type')).toContain('rss');
    // The body is upstream's, under a content type upstream chose.
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it.each([
    ['text/html', 'HTML masquerading as a feed'],
    ['image/svg+xml', 'SVG, which renders as markup'],
    ['application/xhtml+xml', 'XHTML, which renders as markup'],
    ['text/javascript', 'a script'],
  ])('rejects upstream %s (%s)', async (contentType) => {
    fetchMock
      .get('https://feeds.example.com')
      .intercept({ path: '/page' })
      .reply(200, '<html></html>', { headers: { 'content-type': contentType } });
    expect((await call('/v1/feed?url=' + encodeURIComponent('https://feeds.example.com/page'))).status).toBe(415);
  });

  it('accepts a feed served with no content type at all', async () => {
    // Plenty of small hosts send none; the body is capped and never executed.
    fetchMock
      .get('https://feeds.example.com')
      .intercept({ path: '/bare' })
      .reply(200, '<rss><channel><title>B</title></channel></rss>', { headers: {} });
    const res = await call('/v1/feed?url=' + encodeURIComponent('https://feeds.example.com/bare'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
  });

  it('propagates upstream failure as 502', async () => {
    fetchMock.get('https://feeds.example.com').intercept({ path: '/dead' }).reply(500, 'x');
    expect((await call('/v1/feed?url=' + encodeURIComponent('https://feeds.example.com/dead'))).status).toBe(502);
  });

  it('never stores a credential-bearing feed in the shared edge cache', async () => {
    // A paid feed's URL contains the listener's own subscriber token. It is
    // routed here precisely BECAUSE it must not reach a third party — writing
    // it into Cloudflare's shared cache under `Cache-Control: public` for 15
    // minutes undid that.
    const priv = 'https://feeds.example.com/private?auth=Ab3xK9zQ11mNpQrStUvWxYz';
    fetchMock
      .get('https://feeds.example.com')
      .intercept({ path: /^\/private/ })
      .reply(200, '<rss><channel><title>Paid</title></channel></rss>', {
        headers: { 'content-type': 'application/rss+xml' },
      })
      .times(2);

    const first = await call('/v1/feed?url=' + encodeURIComponent(priv));
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('x-seseri-cache')).toBeNull(); // never went through edgeCached

    // A second call must reach the upstream again rather than a cached copy —
    // the `.times(2)` above fails the run if it does not.
    expect((await call('/v1/feed?url=' + encodeURIComponent(priv))).status).toBe(200);
  });

  it('still edge-caches an ordinary public feed', async () => {
    fetchMock
      .get('https://feeds.example.com')
      .intercept({ path: '/public.xml' })
      .reply(200, '<rss><channel><title>Free</title></channel></rss>', {
        headers: { 'content-type': 'application/rss+xml' },
      });
    const res = await call('/v1/feed?url=' + encodeURIComponent('https://feeds.example.com/public.xml'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-seseri-cache')).toBe('miss');
  });
});

describe('/v1/itunes proxy', () => {
  it('proxies itunes JSON', async () => {
    fetchMock
      .get('https://itunes.apple.com')
      .intercept({ path: /\/lookup.*/ })
      .reply(200, JSON.stringify({ resultCount: 0, results: [] }));
    const res = await call('/v1/itunes?url=' + encodeURIComponent('https://itunes.apple.com/lookup?id=1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resultCount: 0 });
  });
});

describe('open-proxy protection', () => {
  it('rejects a proxy call with no Origin', async () => {
    const url = encodeURIComponent('https://feeds.example.com/pod.xml');
    expect((await call('/v1/feed?url=' + url, null)).status).toBe(403);
    expect((await call('/v1/itunes?url=https://itunes.apple.com/lookup?id=1', null)).status).toBe(
      403,
    );
  });

  it('rejects a proxy call from a foreign Origin', async () => {
    const url = encodeURIComponent('https://feeds.example.com/pod.xml');
    expect((await call('/v1/feed?url=' + url, 'https://evil.example')).status).toBe(403);
  });

  it('allows a localhost Origin only when the worker is itself local', async () => {
    // `wrangler dev`: app on 5199, worker on 8787 — cross-origin, and allowed.
    // Reaches validation rather than the origin gate, so it 400s not 403s.
    expect(
      (await call('/v1/feed?url=http://127.0.0.1/x', 'http://localhost:5199', LOCAL_WORKER)).status,
    ).toBe(400);
  });

  it.each([
    ['http://localhost:5199', 'localhost with a port'],
    ['http://localhost', 'bare localhost'],
    ['http://127.0.0.1:5199', 'loopback address'],
  ])('refuses a forged %s Origin against the deployed worker (%s)', async (origin) => {
    // A header is not proof of anything: `curl -H 'Origin: http://localhost'`
    // used to turn the deployed proxy into an open one.
    const url = encodeURIComponent('https://feeds.example.com/pod.xml');
    expect((await call('/v1/feed?url=' + url, origin)).status).toBe(403);
  });

  it('leaves the health endpoint open', async () => {
    expect((await call('/', null)).status).toBe(200);
  });
});

describe('CORS', () => {
  it('allows the production origin', async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request('https://api.test/', { headers: { origin: 'https://iacbi.github.io' } }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://iacbi.github.io');
  });

  it('does not reflect unknown origins', async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request('https://api.test/', { headers: { origin: 'https://evil.example' } }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
