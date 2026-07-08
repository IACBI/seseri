import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { safeTarget } from '../src/safe-fetch';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    KV: KVNamespace;
  }
}

async function call(path: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request('https://api.test' + path), env, ctx);
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

  it('rejects bad yt params', async () => {
    expect((await call('/v1/yt/list?type=video&id=abc')).status).toBe(400);
    expect((await call('/v1/yt/resolve?id=short')).status).toBe(400);
    expect((await call('/v1/yt/search?q=a')).status).toBe(400);
    expect((await call('/v1/yt/audio?id=nope')).status).toBe(400);
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
  });

  it('rejects HTML masquerading as a feed', async () => {
    fetchMock
      .get('https://feeds.example.com')
      .intercept({ path: '/page' })
      .reply(200, '<html></html>', { headers: { 'content-type': 'text/html' } });
    expect((await call('/v1/feed?url=' + encodeURIComponent('https://feeds.example.com/page'))).status).toBe(415);
  });

  it('propagates upstream failure as 502', async () => {
    fetchMock.get('https://feeds.example.com').intercept({ path: '/dead' }).reply(500, 'x');
    expect((await call('/v1/feed?url=' + encodeURIComponent('https://feeds.example.com/dead'))).status).toBe(502);
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
