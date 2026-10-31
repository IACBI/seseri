// @vitest-environment jsdom
/**
 * The show's intro/outro skip, wired through the real controller.
 *
 * `feed-trim.test.ts` pins the arithmetic; this pins what the controller does
 * with it: where an episode starts, and that running into the outro finishes
 * the episode the same way running out of audio does — marked heard, then
 * auto-next — while the credits stop instead of playing on underneath.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../player/prefetch', () => ({
  initPrefetch: () => undefined,
  prefetchEpisode: () => undefined,
}));

import { createPlaybackController } from './playback-controller';
import { audio } from '../player/engine';
import { playing } from '../player/session';
import { clearQueue } from '../state/queue';
import { DEFAULT_SETTINGS, settings } from '../state/settings';
import { loadFeedTrims, setFeedTrim } from '../state/feed-trim';
import { clearProgress, setProgress } from '../storage/progress';
import { clearPlayed, isPlayed } from '../storage/played';

const FEED = 'https://feeds.example.com/trim';
const FEED_ID = 'rss:' + FEED;

function feedXml(ids: string[]): string {
  const items = ids
    .map(
      (id, i) => `<item><title>ep ${i + 1}</title><guid>${id}</guid>
        <pubDate>Mon, 0${i + 1} Jan 2024 00:00:00 GMT</pubDate>
        <enclosure url="https://cdn.example.com/${id}.mp3" type="audio/mpeg"/></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Trim</title>${items}</channel></rss>`;
}

async function waitFor(pred: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out waiting for: ' + label);
}

const DURATION = 1800;
let at: number;
let paused: boolean;
let seeks: number[];
let pause: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes(encodeURIComponent(FEED))
        ? new Response(feedXml(['t1', 't2', 't3']), { status: 200 })
        : new Response('', { status: 404 }),
    ),
  );
  settings.set({ ...DEFAULT_SETTINGS, allowPublicProxies: true, autoNext: true });
  localStorage.clear();
  // Both stores keep a copy in memory that outlives localStorage.clear().
  clearProgress();
  clearPlayed();
  loadFeedTrims();
  clearQueue();
  playing.set(null);
  audio.removeAttribute('src');

  at = 0;
  paused = true;
  seeks = [];
  Object.defineProperty(audio, 'currentTime', {
    configurable: true,
    get: () => at,
    set: (v: number) => {
      at = v;
      seeks.push(v);
    },
  });
  Object.defineProperty(audio, 'duration', { configurable: true, get: () => DURATION });
  Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
  Object.defineProperty(audio, 'seekable', {
    configurable: true,
    get: () => ({ length: 1, start: () => 0, end: () => DURATION }),
  });
  vi.spyOn(audio, 'play').mockImplementation(() => {
    paused = false;
    return Promise.resolve();
  });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  pause = vi.spyOn(audio, 'pause').mockImplementation(() => {
    paused = true;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const prop of ['currentTime', 'duration', 'paused', 'seekable']) {
    delete (audio as unknown as Record<string, unknown>)[prop];
  }
  settings.set({ ...DEFAULT_SETTINGS });
});

/** The list's first two episodes, in whatever order the list sorts them. */
let first: string;
let second: string;

async function startFirst(): Promise<ReturnType<typeof createPlaybackController>> {
  const ctl = createPlaybackController();
  ctl.openFeed({ kind: 'rss', url: FEED });
  await waitFor(() => ctl.session().filtered.length === 3, 'the feed to list');
  ctl.playEpisode(0, true);
  first = String(ctl.session().filtered[0]?.trackId);
  second = String(ctl.session().filtered[1]?.trackId);
  await waitFor(() => audio.src.includes(`${first}.mp3`), 'the first episode to load');
  return ctl;
}

/** Wall clock for the engine's 250 ms `timeupdate` throttle, moved by hand. */
let clock = 0;

/** Playback reaching `sec`: a plain `timeupdate`, past the throttle. */
async function tick(sec: number): Promise<void> {
  at = sec;
  clock += 300;
  audio.dispatchEvent(new Event('timeupdate'));
  await Promise.resolve();
}

/** The listener jumping to `sec`: a skip, a scrub, or one frame of a drag. */
async function seek(sec: number): Promise<void> {
  at = sec;
  clock += 16;
  audio.dispatchEvent(new Event('seeked'));
  await Promise.resolve();
}

describe('the intro', () => {
  it('starts a fresh episode past it', async () => {
    setFeedTrim(FEED_ID, 'intro', 45);
    await startFirst();
    audio.dispatchEvent(new Event('canplay'));
    expect(seeks).toContain(45);
  });

  it('leaves a resume past it where it was', async () => {
    setFeedTrim(FEED_ID, 'intro', 45);
    await startFirst();
    setProgress(first, 600);
    audio.dispatchEvent(new Event('canplay'));
    expect(seeks).toContain(600);
    expect(seeks).not.toContain(45);
  });

  it('does nothing for a show without one', async () => {
    await startFirst();
    audio.dispatchEvent(new Event('canplay'));
    expect(seeks).toEqual([]);
  });
});

describe('the outro', () => {
  beforeEach(() => setFeedTrim(FEED_ID, 'outro', 60));

  it('finishes the episode on the way in and moves on', async () => {
    await startFirst();
    await tick(DURATION - 60.2);
    await tick(DURATION - 59.9);

    expect(pause).toHaveBeenCalled();
    expect(isPlayed(first)).toBe(true);
    await waitFor(() => audio.src.includes(`${second}.mp3`), 'auto-next to start the next one');
  });

  it('stops the credits when nothing comes next', async () => {
    settings.set({ ...settings(), autoNext: false });
    await startFirst();
    await tick(DURATION - 60.2);
    await tick(DURATION - 59.9);

    expect(paused).toBe(true);
    expect(isPlayed(first)).toBe(true);
    expect(audio.src).toContain(`${first}.mp3`);
  });

  it('lets a seek into the outro play on', async () => {
    await startFirst();
    await tick(600);
    await seek(DURATION - 30);
    await tick(DURATION - 29.75);

    expect(pause).not.toHaveBeenCalled();
    expect(isPlayed(first)).toBe(false);
  });

  it('lets a small scrub across the boundary play on', async () => {
    await startFirst();
    await tick(DURATION - 61);
    await seek(DURATION - 59);
    await tick(DURATION - 58.75);

    expect(pause).not.toHaveBeenCalled();
    expect(isPlayed(first)).toBe(false);
  });

  it('lets a waveform drag through the boundary play on', async () => {
    await startFirst();
    await tick(DURATION - 70);
    // One seek per animation frame, each a fraction of a second apart.
    for (let t = DURATION - 62; t <= DURATION - 55; t += 0.5) await seek(t);
    await tick(DURATION - 54.75);

    expect(pause).not.toHaveBeenCalled();
    expect(isPlayed(first)).toBe(false);
  });

  it("ignores the element's own timeupdate for a seek still in progress", async () => {
    await startFirst();
    await tick(DURATION - 60.5);
    Object.defineProperty(audio, 'seeking', { configurable: true, get: () => true });
    await tick(DURATION - 59);
    delete (audio as unknown as Record<string, unknown>)['seeking'];

    expect(pause).not.toHaveBeenCalled();
    expect(isPlayed(first)).toBe(false);
  });

  it('still fires when playback carries on past a scrub that stopped short of it', async () => {
    await startFirst();
    await seek(DURATION - 61);
    await tick(DURATION - 60.25);
    await tick(DURATION - 59.95);

    expect(isPlayed(first)).toBe(true);
  });

  it('does not fire while paused', async () => {
    await startFirst();
    paused = true;
    await tick(DURATION - 60.2);
    await tick(DURATION - 59.9);
    expect(isPlayed(first)).toBe(false);
  });
});
