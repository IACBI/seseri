// @vitest-environment jsdom
/**
 * Changing the default speed in Settings while something is playing.
 *
 * The control wrote the new default straight to the element, so a show with a
 * speed of its own was pulled off it — while the Now Playing sheet and the dock
 * went on displaying the show's speed, and nothing re-applied it until the next
 * episode loaded.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { audio } from '../../player/engine';
import { playing, type PlayingSession } from '../../player/session';
import { clearFeedSpeeds, setFeedSpeed } from '../../state/feed-speed';
import { DEFAULT_SETTINGS, settings } from '../../state/settings';
import { renderShell } from '../shell';
import { initSettingsView } from './settings';

const FEED_ID = 'rss:https://feeds.example.com/fast';

function session(feedId: string): PlayingSession {
  return {
    feedId,
    meta: { id: feedId, name: 'Show', artist: '', art: '' },
    episodes: [
      {
        trackId: 'e1',
        trackName: 'One',
        releaseDate: '',
        episodeUrl: 'https://cdn.example.com/e1.mp3',
        trackTimeMillis: 60_000,
      },
    ],
    index: 0,
    trackId: 'e1',
  };
}

let defaultSpeed: HTMLSelectElement;

function chooseDefault(value: string): void {
  defaultSpeed.value = value;
  defaultSpeed.dispatchEvent(new Event('change'));
}

beforeEach(() => {
  localStorage.clear();
  settings.set({ ...DEFAULT_SETTINGS });
  clearFeedSpeeds();
  playing.set(null);
  audio.playbackRate = 1;
  document.body.innerHTML = '<div id="app"></div>';
  renderShell(document.getElementById('app') as HTMLElement);
  initSettingsView({ onDataCleared: () => undefined });
  defaultSpeed = document.getElementById('s_defaultSpeed') as HTMLSelectElement;
});

describe('the default speed control', () => {
  it('moves what is playing when the show has no speed of its own', () => {
    playing.set(session(FEED_ID));

    chooseDefault('1.5');

    expect(audio.playbackRate).toBe(1.5);
  });

  it('leaves a show with its own speed on it', () => {
    setFeedSpeed(FEED_ID, 2);
    playing.set(session(FEED_ID));
    audio.playbackRate = 2;

    chooseDefault('1.5');

    expect(audio.playbackRate).toBe(2);
  });
});
