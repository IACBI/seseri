// @vitest-environment jsdom
/**
 * The transcript panel across episode changes.
 *
 * Two faults lived here together. Every episode with a transcript added its own
 * `toggle` listener to the panel and none was ever removed, so opening it ran
 * the oldest loader first — which fetched a transcript nobody wanted, dropped
 * it, and left the state at `loading` so the current episode's loader never
 * ran. And a stale-track check that could never be true re-prepared the panel
 * on every `playing` write, so a refresh of the playing feed closed it and
 * threw the loaded text away.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode, EpisodeTranscript } from '../../feeds/types';

const fetchTranscript = vi.hoisted(() =>
  vi.fn(async (url: string) => [{ start: 0, end: 5, text: 'from ' + url }]),
);
vi.mock('../../player/transcript', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../player/transcript')>()),
  fetchTranscript,
}));

import { renderShell } from '../shell';
import { initNowPlaying } from './now-playing';
import { playing, type PlayingSession } from '../../player/session';
import type { PlaybackController } from '../playback-controller';

function ep(id: string, transcripts?: EpisodeTranscript[]): Episode {
  return {
    trackId: id,
    trackName: 'Episode ' + id,
    releaseDate: '',
    episodeUrl: `https://cdn.example.com/${id}.mp3`,
    trackTimeMillis: 60_000,
    ...(transcripts ? { transcripts } : {}),
  };
}

const vtt = (id: string): EpisodeTranscript[] => [
  { url: `https://t.example.com/${id}.vtt`, type: 'text/vtt' },
];

function session(episodes: Episode[], index: number): PlayingSession {
  return {
    feedId: 'rss:https://feeds.example.com/t',
    meta: { id: 'rss:https://feeds.example.com/t', name: 'Show', artist: '', art: '' },
    episodes,
    index,
    trackId: String(episodes[index]?.trackId),
  };
}

let panel: HTMLDetailsElement;

function openPanel(): void {
  panel.open = true;
  panel.dispatchEvent(new Event('toggle'));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeAll(() => {
  // jsdom has no layout, so none of the observers the sheet's widgets use.
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
  panel = document.getElementById('npTranscript') as HTMLDetailsElement;
});

beforeEach(() => {
  playing.set(null);
  fetchTranscript.mockClear();
});

describe('the transcript panel', () => {
  it("loads the current episode's transcript after an earlier one had its own", async () => {
    const list = [ep('a', vtt('a')), ep('b', vtt('b'))];
    playing.set(session(list, 0));
    playing.set(session(list, 1));

    openPanel();
    await settle();

    expect(fetchTranscript).toHaveBeenCalledTimes(1);
    expect(fetchTranscript.mock.calls[0]?.[0]).toBe('https://t.example.com/b.vtt');
    expect(panel.textContent).toContain('from https://t.example.com/b.vtt');
  });

  it('stays open, with its text, when the playing feed is refreshed', async () => {
    const list = [ep('c', vtt('c'))];
    playing.set(session(list, 0));
    openPanel();
    await settle();
    expect(panel.textContent).toContain('from https://t.example.com/c.vtt');

    // What `adoptRefreshedEpisodes` writes when the playing feed reloads.
    playing.set(session([ep('c', vtt('c'))], 0));

    expect(panel.open).toBe(true);
    expect(panel.textContent).toContain('from https://t.example.com/c.vtt');
    expect(fetchTranscript).toHaveBeenCalledTimes(1);
  });
});
