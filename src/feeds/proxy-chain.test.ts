import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTextProxied, fetchWithTimeout } from './proxy-chain';

function res(body: string, ok = true, status = 200): Response {
  return new Response(body, { status: ok ? status : 500 });
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchTextProxied', () => {
  it('returns the first proxy that answers with a body', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('allorigins')) return res(''); // empty → rejected
      if (u.includes('codetabs')) return res('<rss>ok</rss>');
      return new Response('', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchTextProxied('https://example.com/feed')).resolves.toBe('<rss>ok</rss>');
  });

  it('fails with a single error when every proxy is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    await expect(fetchTextProxied('https://example.com/feed')).rejects.toThrow('fetch failed');
  });

  it('propagates an abort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const ctrl = new AbortController();
    const p = fetchTextProxied('https://example.com/feed', ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetchWithTimeout', () => {
  it('aborts a hanging request after the per-attempt timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    await expect(fetchWithTimeout('https://slow.example', undefined, 30)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
