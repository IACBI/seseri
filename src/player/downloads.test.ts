// @vitest-environment jsdom
/**
 * The last-resort handoff, for an episode whose CDN refuses CORS.
 *
 * This had no test at all, and the bug it was hiding was reported to the
 * listener as its own opposite: `window.open` returns null whenever `noopener`
 * is set — per spec, on success as much as on failure — so the old
 * `if (!w) return 'no-url'` turned every successful handoff into "download
 * link not found". Found in production on a podtrac-fronted feed, where the
 * browser had already started fetching the file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode } from '../feeds/types';
import { downloadEpisode } from './downloads';

function ep(episodeUrl: string | undefined): Episode {
  return {
    trackId: 'e1',
    trackName: 'An episode',
    releaseDate: '',
    ...(episodeUrl === undefined ? {} : { episodeUrl }),
    trackTimeMillis: 0,
  } as Episode;
}

/** What a real browser does with `noopener`: open the window, return null. */
let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  open = vi.fn(() => null);
  vi.stubGlobal('open', open);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadEpisode', () => {
  it('reports the handoff even though noopener nulls the return value', () => {
    expect(downloadEpisode(ep('https://cdn.example.com/a.mp3'))).toBe('opened');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('keeps noopener and noreferrer on the opened window', () => {
    downloadEpisode(ep('https://cdn.example.com/a.mp3'));
    const [url, target, features] = open.mock.calls[0] as unknown as [string, string, string];
    expect(url).toBe('https://cdn.example.com/a.mp3');
    expect(target).toBe('_blank');
    expect(features).toContain('noopener');
    expect(features).toContain('noreferrer');
  });

  it('still reports the handoff when the browser does return a window', () => {
    // Not every engine follows the spec here; the outcome must not depend on it.
    open.mockReturnValue({} as Window);
    expect(downloadEpisode(ep('https://cdn.example.com/a.mp3'))).toBe('opened');
  });

  it('refuses an episode with no audio url, and opens nothing', () => {
    expect(downloadEpisode(ep(undefined))).toBe('no-url');
    expect(downloadEpisode(ep(''))).toBe('no-url');
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses a plaintext url rather than handing it to the browser', () => {
    expect(downloadEpisode(ep('http://cdn.example.com/a.mp3'))).toBe('no-url');
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses a javascript: url', () => {
    expect(downloadEpisode(ep('javascript:alert(1)'))).toBe('no-url');
    expect(open).not.toHaveBeenCalled();
  });
});
