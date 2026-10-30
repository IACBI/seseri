// @vitest-environment jsdom
/**
 * The Now Playing title crossfade.
 *
 * A change of title fades out and swaps the text 150 ms later. A second change
 * inside that window compared the new title with the text still on screen, and
 * when the two matched it returned — leaving the swap already scheduled for the
 * intermediate title to land. Next-then-previous in quick succession ended with
 * the heading naming an episode that was not playing.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode } from '../../feeds/types';
import { renderShell } from '../shell';
import { initNowPlaying } from './now-playing';
import { playing, type PlayingSession } from '../../player/session';
import type { PlaybackController } from '../playback-controller';

function ep(id: string): Episode {
  return {
    trackId: id,
    trackName: 'Episode ' + id,
    releaseDate: '',
    episodeUrl: `https://cdn.example.com/${id}.mp3`,
    trackTimeMillis: 60_000,
  };
}

const LIST = [ep('a'), ep('b')];

function at(index: number): PlayingSession {
  return {
    feedId: 'rss:https://feeds.example.com/t',
    meta: { id: 'rss:https://feeds.example.com/t', name: 'Show', artist: '', art: '' },
    episodes: LIST,
    index,
    trackId: String(LIST[index]?.trackId),
  };
}

let title: HTMLElement;

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  Element.prototype.scrollIntoView = () => undefined;
  const app = document.createElement('div');
  document.body.append(app);
  renderShell(app);
  initNowPlaying({ playback: {} as PlaybackController, openQueue: () => undefined });
  title = document.getElementById('nowTitle') as HTMLElement;
});

beforeEach(() => {
  vi.useFakeTimers();
  playing.set(null);
  vi.advanceTimersByTime(500);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Now Playing title', () => {
  it('follows the episode that is playing', () => {
    playing.set(at(0));
    vi.advanceTimersByTime(200);
    expect(title.textContent).toBe('Episode a');

    playing.set(at(1));
    vi.advanceTimersByTime(200);
    expect(title.textContent).toBe('Episode b');
  });

  it('is not left on the in-between episode by a quick next-then-previous', () => {
    playing.set(at(0));
    vi.advanceTimersByTime(200);

    playing.set(at(1));
    vi.advanceTimersByTime(50); // inside the 150 ms swap
    playing.set(at(0));
    vi.advanceTimersByTime(300);

    expect(title.textContent).toBe('Episode a');
  });
});
