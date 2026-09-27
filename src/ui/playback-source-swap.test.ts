// @vitest-environment jsdom
/**
 * What a source swap leaves behind.
 *
 * Both load paths attach a one-shot listener (`canplay` to restore the saved
 * position, `loadedmetadata` to continue a swapped-in copy) and neither event
 * is guaranteed to arrive before the listener moves on. A listener that
 * outlives its source then runs against the NEXT episode's event: it seeks that
 * episode to the previous one's position, or — for a swap — starts it playing.
 *
 * The prefetch handoff has a second way to surprise: the local copy can land
 * minutes after the listener pressed pause, and the swap must not restart
 * the episode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handoff = (url: string, positionSec: number) => void;
const prefetch = vi.hoisted(() => ({ handoff: null as Handoff | null }));
vi.mock('../player/prefetch', () => ({
  initPrefetch: (h: { handoff: Handoff }) => {
    prefetch.handoff = h.handoff;
  },
  prefetchEpisode: () => undefined,
}));

import { createPlaybackController } from './playback-controller';
import { audio } from '../player/engine';
import { playing } from '../player/session';
import { clearQueue } from '../state/queue';
import { DEFAULT_SETTINGS, settings } from '../state/settings';
import { setProgress } from '../storage/progress';

const FEED = 'https://feeds.example.com/swap';

function feedXml(ids: string[]): string {
  const items = ids
    .map(
      (id, i) => `<item><title>ep ${i + 1}</title><guid>${id}</guid>
        <pubDate>Mon, 0${i + 1} Jan 2024 00:00:00 GMT</pubDate>
        <enclosure url="https://cdn.example.com/${id}.mp3" type="audio/mpeg"/></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Swap</title>${items}</channel></rss>`;
}

async function waitFor(pred: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out waiting for: ' + label);
}

/** Seeks the element receives, and a media element that is ready to take them. */
let seeks: number[];
let play: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes(encodeURIComponent(FEED))
        ? new Response(feedXml(['s1', 's2', 's3']), { status: 200 })
        : new Response('', { status: 404 }),
    ),
  );
  settings.set({ ...DEFAULT_SETTINGS, allowPublicProxies: true });
  localStorage.clear();
  clearQueue();
  playing.set(null);
  audio.removeAttribute('src');

  seeks = [];
  let at = 0;
  Object.defineProperty(audio, 'currentTime', {
    configurable: true,
    get: () => at,
    set: (v: number) => {
      at = v;
      seeks.push(v);
    },
  });
  Object.defineProperty(audio, 'duration', { configurable: true, get: () => 600 });
  Object.defineProperty(audio, 'seekable', {
    configurable: true,
    get: () => ({ length: 1, start: () => 0, end: () => 600 }),
  });
  play = vi.spyOn(audio, 'play').mockImplementation(() => Promise.resolve());
  // jsdom has no object URLs; the swap revokes the copy it replaces.
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  play.mockRestore();
  for (const prop of ['currentTime', 'duration', 'seekable']) {
    delete (audio as unknown as Record<string, unknown>)[prop];
  }
  settings.set({ ...DEFAULT_SETTINGS });
});

async function openFeed(): Promise<ReturnType<typeof createPlaybackController>> {
  const ctl = createPlaybackController();
  ctl.openFeed({ kind: 'rss', url: FEED });
  await waitFor(() => ctl.session().filtered.length === 3, 'the feed to list');
  return ctl;
}

async function start(
  ctl: ReturnType<typeof createPlaybackController>,
  idx: number,
  id: string,
  autoplay = false,
): Promise<void> {
  ctl.playEpisode(idx, autoplay);
  await waitFor(() => audio.src.includes(`${id}.mp3`), `${id} to load`);
}

describe("a load's listener stays with its own source", () => {
  it("does not seek the next episode to the previous one's saved position", async () => {
    setProgress('s1', 120);
    const ctl = await openFeed();
    await start(ctl, 0, 's1');
    // Moved on before s1 ever reached `canplay`.
    await start(ctl, 1, 's2');

    audio.dispatchEvent(new Event('canplay'));

    expect(seeks).not.toContain(120);
  });

  it("still restores the episode's own saved position", async () => {
    setProgress('s2', 200);
    const ctl = await openFeed();
    await start(ctl, 1, 's2');

    audio.dispatchEvent(new Event('canplay'));

    expect(seeks).toContain(200);
  });

  it('does not let a swap that never finished loading start the next episode', async () => {
    const ctl = await openFeed();
    await start(ctl, 0, 's1', true);
    prefetch.handoff?.('blob:stale-swap', 42);
    await start(ctl, 1, 's2');
    play.mockClear();

    audio.dispatchEvent(new Event('loadedmetadata'));

    expect(seeks).not.toContain(42);
    expect(play).not.toHaveBeenCalled();
  });
});

describe('the prefetch handoff respects a pause', () => {
  it('swaps in the local copy without playing it when the listener paused', async () => {
    const ctl = await openFeed();
    await start(ctl, 0, 's1', false);
    play.mockClear();

    prefetch.handoff?.('blob:paused-swap', 42);
    audio.dispatchEvent(new Event('loadedmetadata'));

    expect(audio.src).toBe('blob:paused-swap');
    expect(seeks).toContain(42);
    expect(play).not.toHaveBeenCalled();
  });

  it('keeps playing across the swap when the listener was listening', async () => {
    const ctl = await openFeed();
    await start(ctl, 0, 's1', true);
    play.mockClear();

    prefetch.handoff?.('blob:playing-swap', 42);
    audio.dispatchEvent(new Event('loadedmetadata'));

    expect(play).toHaveBeenCalledTimes(1);
  });
});
