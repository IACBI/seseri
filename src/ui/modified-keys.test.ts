// @vitest-environment jsdom
/**
 * Widgets that claim the arrow keys must leave the modified ones alone.
 *
 * Alt+Left/Right is Back/Forward in every desktop browser, Cmd+Left/Right is
 * the same on macOS, and Ctrl/Cmd+Home/End scroll the page. The episode list,
 * the library tabs and both seek bars called `preventDefault()` on the bare key
 * name, so with focus on any of them — which is where a click on an episode
 * leaves it — those shortcuts did nothing, or moved the focus or the playhead
 * instead.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, settings } from '../state/settings';
import { createPlaybackController, type PlaybackController } from './playback-controller';
import { initMiniPlayer } from './mini-player';
import { renderShell } from './shell';
import { initLibraryView } from './views/library';
import { initPodcastView } from './views/podcast';
import { initWaveform } from './waveform';

const FEED = 'https://feeds.example.com/keys';
const XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>Keys</title>
  <item><title>One</title><guid>k1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.com/k1.mp3" type="audio/mpeg"/></item>
  <item><title>Two</title><guid>k2</guid><pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.com/k2.mp3" type="audio/mpeg"/></item>
</channel></rss>`;

const MODIFIED: Array<[string, KeyboardEventInit]> = [
  ['Alt+←', { key: 'ArrowLeft', altKey: true }],
  ['Alt+→', { key: 'ArrowRight', altKey: true }],
  ['Cmd+←', { key: 'ArrowLeft', metaKey: true }],
  ['Ctrl+Home', { key: 'Home', ctrlKey: true }],
  ['Cmd+End', { key: 'End', metaKey: true }],
];

function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

async function waitFor(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out');
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(XML, { status: 200 })),
  );
  settings.set({ ...DEFAULT_SETTINGS, allowPublicProxies: true });
  document.body.innerHTML = '<div id="app"></div>';
  renderShell(document.getElementById('app') as HTMLElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the episode list', () => {
  it.each(MODIFIED)('does not take %s', async (_name, init) => {
    const playback = createPlaybackController();
    initPodcastView({ playback, onBack: () => undefined, openNowPlaying: () => undefined });
    playback.openFeed({ kind: 'rss', url: FEED });
    await waitFor(() => playback.session().filtered.length === 2);

    const open = document.querySelector('.ep-open') as HTMLElement;
    expect(press(open, init).defaultPrevented).toBe(false);
  });

  it('still takes the bare arrow keys', async () => {
    const playback = createPlaybackController();
    initPodcastView({ playback, onBack: () => undefined, openNowPlaying: () => undefined });
    playback.openFeed({ kind: 'rss', url: FEED });
    await waitFor(() => playback.session().filtered.length === 2);

    const open = document.querySelector('.ep-open') as HTMLElement;
    expect(press(open, { key: 'ArrowDown' }).defaultPrevented).toBe(true);
  });
});

describe('the library tabs', () => {
  it.each(MODIFIED)('do not take %s', (_name, init) => {
    initLibraryView({ openFeed: () => undefined });
    const tab = document.getElementById('lib-tab-subs') as HTMLElement;
    expect(press(tab, init).defaultPrevented).toBe(false);
  });

  it('still move with the bare arrow keys', () => {
    initLibraryView({ openFeed: () => undefined });
    const tab = document.getElementById('lib-tab-subs') as HTMLElement;
    expect(press(tab, { key: 'ArrowRight' }).defaultPrevented).toBe(true);
  });
});

describe('the seek bars', () => {
  it.each(MODIFIED)('leave %s to the browser (Now Playing)', (_name, init) => {
    const seekRel = vi.fn();
    const wrap = document.createElement('div');
    initWaveform(
      {
        wrap,
        base: document.createElement('div'),
        fill: document.createElement('div'),
        head: document.createElement('div'),
        tip: document.createElement('div'),
      },
      { seekRel, skipBack: () => 15, skipFwd: () => 30 },
    );

    expect(press(wrap, init).defaultPrevented).toBe(false);
    expect(seekRel).not.toHaveBeenCalled();
  });

  it.each(MODIFIED)('leave %s to the browser (dock)', (_name, init) => {
    const seekRel = vi.fn();
    initMiniPlayer({
      playback: { seekRel } as unknown as PlaybackController,
      onOpen: () => undefined,
    });
    const scrub = document.getElementById('miniScrub') as HTMLElement;

    expect(press(scrub, init).defaultPrevented).toBe(false);
    expect(seekRel).not.toHaveBeenCalled();
  });

  it('still seek on the bare arrow keys', () => {
    const seekRel = vi.fn();
    initMiniPlayer({
      playback: { seekRel } as unknown as PlaybackController,
      onOpen: () => undefined,
    });
    const scrub = document.getElementById('miniScrub') as HTMLElement;

    expect(press(scrub, { key: 'ArrowRight' }).defaultPrevented).toBe(true);
    expect(seekRel).toHaveBeenCalledTimes(1);
  });
});
