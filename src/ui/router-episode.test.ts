// @vitest-environment jsdom
/**
 * Episode links.
 *
 * `?ep=` and `&t=` arrive from outside the app — a message, a tweet, a
 * bookmark — so both are treated the way `?rss=` already is: validated, not
 * trusted. The id goes on to select an episode and the offset goes to
 * `audio.currentTime`, which throws on a value it does not like.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { parseLocation, shareUrlFor, urlFor } from './router';

function at(search: string): void {
  history.replaceState(null, '', '/' + search);
}

beforeEach(() => at(''));

describe('parseLocation — episode', () => {
  it('reads an episode id alongside an Apple id', () => {
    at('?podcast=152249110&ep=guid-abc');
    expect(parseLocation()).toEqual({
      kind: 'feed',
      req: { kind: 'itunes', id: '152249110' },
      episodeId: 'guid-abc',
    });
  });

  it('reads an episode id alongside an RSS url', () => {
    at('?rss=' + encodeURIComponent('https://feeds.example.com/p.xml') + '&ep=g1');
    expect(parseLocation()).toEqual({
      kind: 'feed',
      req: { kind: 'rss', url: 'https://feeds.example.com/p.xml' },
      episodeId: 'g1',
    });
  });

  it('reads a position', () => {
    at('?podcast=152249110&ep=g1&t=942');
    expect(parseLocation()).toMatchObject({ episodeId: 'g1', at: 942 });
  });

  it('rounds a fractional position, which is what currentTime gets', () => {
    at('?podcast=152249110&ep=g1&t=942.77');
    expect(parseLocation()).toMatchObject({ at: 942 });
  });

  it('keeps a guid that is itself a url', () => {
    // Plenty of feeds use the episode page as the guid.
    const guid = 'https://example.com/2026/09/12/episode';
    at('?podcast=152249110&ep=' + encodeURIComponent(guid));
    expect(parseLocation()).toMatchObject({ episodeId: guid });
  });

  it.each([
    ['a negative offset', '&t=-30'],
    ['zero', '&t=0'],
    ['an absurd offset', '&t=99999999'],
    ['a non-number', '&t=soon'],
    ['an empty value', '&t='],
  ])('ignores %s', (_label, tail) => {
    at('?podcast=152249110&ep=g1' + tail);
    const route = parseLocation();
    expect(route).toMatchObject({ episodeId: 'g1' });
    expect('at' in route ? route.at : undefined).toBeUndefined();
  });

  it('ignores an episode id that is absurdly long', () => {
    at('?podcast=152249110&ep=' + 'x'.repeat(400));
    const route = parseLocation();
    expect('episodeId' in route ? route.episodeId : undefined).toBeUndefined();
  });

  it('ignores an episode id with no feed to find it in', () => {
    at('?ep=g1&t=30');
    expect(parseLocation()).toEqual({ kind: 'home' });
  });
});

describe('urlFor', () => {
  it('leaves the episode out unless asked for one', () => {
    expect(urlFor({ kind: 'feed', req: { kind: 'itunes', id: '123456' } })).toBe(
      '/?podcast=123456',
    );
  });

  it('carries the episode and the position', () => {
    expect(
      urlFor({
        kind: 'feed',
        req: { kind: 'itunes', id: '123456' },
        episodeId: 'g 1&x',
        at: 90,
      }),
    ).toBe('/?podcast=123456&ep=g%201%26x&t=90');
  });

  it('escapes an episode id so it cannot add parameters of its own', () => {
    const url = urlFor({
      kind: 'feed',
      req: { kind: 'itunes', id: '123456' },
      episodeId: 'a&view=settings',
    });
    expect(url).not.toContain('&view=settings');
    expect(new URLSearchParams(url.slice(url.indexOf('?'))).get('ep')).toBe('a&view=settings');
  });
});

describe('shareUrlFor', () => {
  it('is absolute, so it can be pasted anywhere', () => {
    const url = shareUrlFor({ kind: 'itunes', id: '123456' }, { episodeId: 'g1', at: 42 });
    expect(url).toBe(location.origin + '/?podcast=123456&ep=g1&t=42');
  });

  it('omits the position when there is not one worth sharing', () => {
    expect(shareUrlFor({ kind: 'itunes', id: '123456' }, { episodeId: 'g1', at: 0 })).toBe(
      location.origin + '/?podcast=123456&ep=g1',
    );
  });

  it('round-trips through parseLocation', () => {
    const url = shareUrlFor(
      { kind: 'rss', url: 'https://feeds.example.com/p.xml?token=x' },
      { episodeId: 'guid/with/slashes', at: 125 },
    );
    history.replaceState(null, '', url.slice(location.origin.length));
    expect(parseLocation()).toEqual({
      kind: 'feed',
      req: { kind: 'rss', url: 'https://feeds.example.com/p.xml?token=x' },
      episodeId: 'guid/with/slashes',
      at: 125,
    });
  });
});
