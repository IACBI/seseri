// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedRequest } from '../feeds/types';
import { initRouter, parseLocation, urlFor } from './router';

function setUrl(search: string): void {
  history.replaceState(null, '', '/' + search);
}

function makeHandlers() {
  return { showFeed: vi.fn<(req: FeedRequest) => void>(), showHome: vi.fn<() => void>() };
}

beforeEach(() => {
  // Land every test on a clean home URL.
  history.replaceState(null, '', '/');
});

describe('parseLocation', () => {
  it('parses a valid ?podcast= id into an itunes feed', () => {
    setUrl('?podcast=1550551126');
    expect(parseLocation()).toEqual({ kind: 'feed', req: { kind: 'itunes', id: '1550551126' } });
  });

  it('rejects a non-numeric ?podcast= id and falls back to home', () => {
    setUrl('?podcast=notanid');
    expect(parseLocation()).toEqual({ kind: 'home' });
  });

  it('parses an http(s) ?rss= url', () => {
    setUrl('?rss=' + encodeURIComponent('https://feeds.example.com/pod'));
    expect(parseLocation()).toEqual({
      kind: 'feed',
      req: { kind: 'rss', url: 'https://feeds.example.com/pod' },
    });
  });

  it('rejects a non-http ?rss= value', () => {
    setUrl('?rss=' + encodeURIComponent('javascript:alert(1)'));
    expect(parseLocation()).toEqual({ kind: 'home' });
  });

  it('decodes a ?yt= token into a typed ref', () => {
    setUrl('?yt=vid_dQw4w9WgXcQ');
    expect(parseLocation()).toEqual({
      kind: 'feed',
      req: { kind: 'yt', info: { type: 'video', id: 'dQw4w9WgXcQ' } },
    });
  });

  it('falls back to home for an unrecognised ?yt= token', () => {
    setUrl('?yt=garbage');
    expect(parseLocation()).toEqual({ kind: 'home' });
  });

  it('returns home when there are no known params', () => {
    setUrl('');
    expect(parseLocation()).toEqual({ kind: 'home' });
  });
});

describe('urlFor', () => {
  it('round-trips every feed request kind through parseLocation', () => {
    const reqs: FeedRequest[] = [
      { kind: 'itunes', id: '1550551126' },
      { kind: 'rss', url: 'https://feeds.example.com/pod' },
      { kind: 'yt', info: { type: 'playlist', id: 'PLabc-123' } },
    ];
    for (const req of reqs) {
      history.replaceState(null, '', urlFor({ kind: 'feed', req }));
      expect(parseLocation()).toEqual({ kind: 'feed', req });
    }
  });

  it('maps home to the bare pathname', () => {
    expect(urlFor({ kind: 'home' })).toBe(location.pathname);
  });
});

describe('feedOpened', () => {
  it('pushes a history entry and enables back when opening a feed from home', () => {
    const h = makeHandlers();
    const router = initRouter(h);
    const lenBefore = history.length;

    router.feedOpened({ kind: 'itunes', id: '1550551126' });

    expect(location.search).toBe('?podcast=1550551126');
    expect(router.canGoBack()).toBe(true);
    expect(history.length).toBe(lenBefore + 1);
  });

  it('replaces (not pushes) on a feed→feed navigation and leaves back disabled', () => {
    setUrl('?podcast=1550551126');
    const router = initRouter(makeHandlers());
    const lenBefore = history.length;

    router.feedOpened({ kind: 'rss', url: 'https://feeds.example.com/pod' });

    expect(location.search).toBe('?rss=' + encodeURIComponent('https://feeds.example.com/pod'));
    expect(history.length).toBe(lenBefore);
    expect(router.canGoBack()).toBe(false);
  });

  it('replaces without enabling back when push=false (initial deep-link load)', () => {
    const router = initRouter(makeHandlers());
    const lenBefore = history.length;

    router.feedOpened({ kind: 'itunes', id: '1550551126' }, false);

    expect(location.search).toBe('?podcast=1550551126');
    expect(history.length).toBe(lenBefore);
    expect(router.canGoBack()).toBe(false);
  });

  it('is a no-op when the target URL already matches the current one', () => {
    setUrl('?podcast=1550551126');
    const router = initRouter(makeHandlers());
    const lenBefore = history.length;

    router.feedOpened({ kind: 'itunes', id: '1550551126' });

    expect(history.length).toBe(lenBefore);
    expect(router.canGoBack()).toBe(false);
  });
});

describe('goHome', () => {
  it('pushes a home entry and invokes the showHome handler when on a feed', () => {
    setUrl('?podcast=1550551126');
    const h = makeHandlers();
    const router = initRouter(h);
    const lenBefore = history.length;

    router.goHome();

    expect(location.search).toBe('');
    expect(history.length).toBe(lenBefore + 1);
    expect(h.showHome).toHaveBeenCalledTimes(1);
  });

  it('does not push a duplicate entry when already home', () => {
    const h = makeHandlers();
    const router = initRouter(h);
    const lenBefore = history.length;

    router.goHome();

    expect(history.length).toBe(lenBefore);
    expect(h.showHome).toHaveBeenCalledTimes(1);
  });
});

describe('popstate', () => {
  it('routes to showFeed with the parsed request when navigating to a feed URL', () => {
    const h = makeHandlers();
    initRouter(h);

    setUrl('?podcast=1550551126');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(h.showFeed).toHaveBeenCalledWith({ kind: 'itunes', id: '1550551126' });
  });

  it('routes to showHome and clears back-behind when navigating to home', () => {
    const h = makeHandlers();
    const router = initRouter(h);
    // Open a feed so hasHomeBehind flips on.
    router.feedOpened({ kind: 'itunes', id: '1550551126' });
    expect(router.canGoBack()).toBe(true);

    setUrl('');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(h.showHome).toHaveBeenCalled();
    expect(router.canGoBack()).toBe(false);
  });
});
