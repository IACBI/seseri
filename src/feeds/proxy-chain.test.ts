import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTextProxied, fetchWithTimeout, PROXIES_DISABLED_ERROR } from './proxy-chain';
import { DEFAULT_SETTINGS, settings } from '../state/settings';

function res(body: string, ok = true, status = 200): Response {
  return new Response(body, { status: ok ? status : 500 });
}

/**
 * The public proxies are opt-in and OFF by default, so every test that
 * exercises them has to turn them on explicitly — which is also the point:
 * the default path must not reach a third party at all.
 */
beforeEach(() => settings.set({ ...DEFAULT_SETTINGS, allowPublicProxies: true }));
afterEach(() => {
  vi.unstubAllGlobals();
  settings.set({ ...DEFAULT_SETTINGS });
});

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

  it('cancels the proxies that lost the race', async () => {
    const losers: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).includes('codetabs')) return Promise.resolve(res('<rss>ok</rss>'));
        if (init?.signal) losers.push(init.signal);
        return new Promise<Response>(() => undefined); // still downloading
      }),
    );
    await expect(fetchTextProxied('https://example.com/feed')).resolves.toBe('<rss>ok</rss>');
    expect(losers).toHaveLength(2);
    expect(losers.every((s) => s.aborted)).toBe(true);
  });

  it('fails with a single error when every proxy is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    await expect(fetchTextProxied('https://example.com/feed')).rejects.toThrow('fetch failed');
  });

  it('refuses to hand a credential-bearing feed to the public proxies', async () => {
    const fetchMock = vi.fn(async () => res('<rss>leaked</rss>'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchTextProxied('https://www.patreon.com/rss/x?auth=Ab3xK9zQ11mNpQrStUvWxYz'),
    ).rejects.toThrow('private-feed');
    // The point of the guard: no request may leave at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still proxies an ordinary public feed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res('<rss>ok</rss>')));
    await expect(fetchTextProxied('https://feeds.example.com/pod.xml')).resolves.toBe(
      '<rss>ok</rss>',
    );
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

describe('public proxies are opt-in', () => {
  it('refuses to use them when the setting is off', async () => {
    settings.set({ ...DEFAULT_SETTINGS, allowPublicProxies: false });
    const fetchMock = vi.fn(async () => res('<rss>ok</rss>'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchTextProxied('https://feeds.example.com/pod.xml')).rejects.toThrow(
      PROXIES_DISABLED_ERROR,
    );
    // Nothing may leave: the operators must not even learn the feed URL.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the credential leak first, since that is the stronger refusal', async () => {
    settings.set({ ...DEFAULT_SETTINGS, allowPublicProxies: false });
    vi.stubGlobal('fetch', vi.fn(async () => res('<rss>leaked</rss>')));
    await expect(
      fetchTextProxied('https://www.patreon.com/rss/x?auth=Ab3xK9zQ11mNpQrStUvWxYz'),
    ).rejects.toThrow('private-feed');
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
