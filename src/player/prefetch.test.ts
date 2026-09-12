// @vitest-environment jsdom
/**
 * The commitment gate in front of the prefetch.
 *
 * A first play costs two transfers of the episode (measured 2.00x), which is
 * structural — see the module header. What is not structural is spending them
 * on episodes nobody listens to, so the behaviour that matters here is: nothing
 * transfers until the listener has really stayed with the episode, a pause or a
 * scrub cannot fake that, leaving the episode cancels it, and an episode that is
 * nearly over is never copied at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode } from '../feeds/types';

const transferAllowed = vi.hoisted(() => vi.fn(() => true));
vi.mock('./connection', () => ({ transferAllowed }));

const isDownloaded = vi.hoisted(() => vi.fn(async () => false));
const offlineAudioUrl = vi.hoisted(() => vi.fn(async () => 'blob:local'));
vi.mock('./offline', () => ({ isDownloaded, offlineAudioUrl }));

const startDownload = vi.hoisted(() => vi.fn(async () => 'ok'));
vi.mock('./download-jobs', () => ({ startDownload }));

import {
  COMMIT_SECONDS,
  MIN_REMAINING_SECONDS,
  TICK_SECONDS,
  initPrefetch,
  prefetchEpisode,
  resetPrefetchForTests,
} from './prefetch';

function ep(trackId = 'e1', minutes = 60): Episode {
  return {
    trackId,
    trackName: 'Episode ' + trackId,
    releaseDate: '',
    episodeUrl: 'https://cdn.example.com/' + trackId + '.mp3',
    trackTimeMillis: minutes * 60_000,
  };
}

/** A listener we can drive: whose episode is on, and where they are in it. */
function listener(trackId: string | null = 'e1', position = 0) {
  const state = { trackId, position };
  const handoff = vi.fn();
  initPrefetch({
    handoff,
    currentTrackId: () => state.trackId,
    currentPosition: () => state.position,
  });
  return { state, handoff };
}

/** Advance the clock by `n` ticks, letting the position follow in real time. */
async function listen(state: { position: number }, ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    state.position += TICK_SECONDS;
    await vi.advanceTimersByTimeAsync(TICK_SECONDS * 1000);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  resetPrefetchForTests();
  transferAllowed.mockReturnValue(true);
  isDownloaded.mockResolvedValue(false);
  offlineAudioUrl.mockClear();
  startDownload.mockReset();
  startDownload.mockResolvedValue('ok');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('prefetchEpisode', () => {
  it('transfers nothing the moment play starts', async () => {
    const { state } = listener();
    prefetchEpisode(ep(), 'f1');
    await listen(state, 1);
    expect(startDownload).not.toHaveBeenCalled();
  });

  it('starts the copy once the listener has stayed with the episode', async () => {
    const { state } = listener();
    prefetchEpisode(ep(), 'f1');
    await listen(state, COMMIT_SECONDS / TICK_SECONDS);
    expect(startDownload).toHaveBeenCalledTimes(1);
    expect(startDownload.mock.calls[0] as unknown as [Episode, string, unknown]).toEqual([
      expect.objectContaining({ trackId: 'e1' }),
      'f1',
      { ephemeral: true },
    ]);
  });

  it('a pause stops the clock, so waiting is not listening', async () => {
    const { state } = listener();
    prefetchEpisode(ep(), 'f1');
    // The clock runs for twice the commitment; the position never moves.
    await vi.advanceTimersByTimeAsync(COMMIT_SECONDS * 2 * 1000);
    expect(startDownload).not.toHaveBeenCalled();
    // Resuming earns credit normally.
    await listen(state, COMMIT_SECONDS / TICK_SECONDS);
    expect(startDownload).toHaveBeenCalledTimes(1);
  });

  it('a scrub to the end cannot buy the commitment', async () => {
    const { state } = listener();
    prefetchEpisode(ep(), 'f1');
    state.position = 3000; // dragged the scrubber across the episode
    await vi.advanceTimersByTimeAsync(TICK_SECONDS * 1000);
    expect(startDownload).not.toHaveBeenCalled();
  });

  it('a backward seek credits nothing rather than going negative', async () => {
    const { state } = listener();
    prefetchEpisode(ep(), 'f1');
    await listen(state, 3);
    state.position = 0; // back to the top
    await vi.advanceTimersByTimeAsync(TICK_SECONDS * 1000);
    // The 30 s already listened survive; the seek neither adds nor removes.
    await listen(state, 2);
    expect(startDownload).not.toHaveBeenCalled();
    await listen(state, 1);
    expect(startDownload).toHaveBeenCalledTimes(1);
  });

  it('leaving the episode before committing transfers nothing', async () => {
    const { state } = listener();
    prefetchEpisode(ep(), 'f1');
    await listen(state, 2);
    state.trackId = 'e2';
    await vi.advanceTimersByTimeAsync(COMMIT_SECONDS * 2 * 1000);
    expect(startDownload).not.toHaveBeenCalled();
  });

  it('re-arms an episode that was abandoned, so coming back still works', async () => {
    const { state } = listener();
    prefetchEpisode(ep(), 'f1');
    state.trackId = 'e2';
    await vi.advanceTimersByTimeAsync(TICK_SECONDS * 1000);
    // Back to the first episode, played through the commitment this time.
    state.trackId = 'e1';
    prefetchEpisode(ep(), 'f1');
    await listen(state, COMMIT_SECONDS / TICK_SECONDS);
    expect(startDownload).toHaveBeenCalledTimes(1);
  });

  it('does not stack timers when play is reported twice', async () => {
    const { state } = listener();
    prefetchEpisode(ep(), 'f1');
    prefetchEpisode(ep(), 'f1');
    await listen(state, COMMIT_SECONDS / TICK_SECONDS);
    expect(startDownload).toHaveBeenCalledTimes(1);
  });

  it('never copies an episode that is nearly over', async () => {
    const minutes = 90;
    const { state } = listener('e1', minutes * 60 - MIN_REMAINING_SECONDS + 10);
    prefetchEpisode(ep('e1', minutes), 'f1');
    await listen(state, COMMIT_SECONDS / TICK_SECONDS);
    expect(startDownload).not.toHaveBeenCalled();
  });

  it('copies an episode resumed with plenty left', async () => {
    const { state } = listener('e1', 60);
    prefetchEpisode(ep('e1', 90), 'f1');
    await listen(state, COMMIT_SECONDS / TICK_SECONDS);
    expect(startDownload).toHaveBeenCalledTimes(1);
  });

  it('copies an episode whose feed declares no duration', async () => {
    const { state } = listener();
    prefetchEpisode(ep('e1', 0), 'f1');
    await listen(state, COMMIT_SECONDS / TICK_SECONDS);
    expect(startDownload).toHaveBeenCalledTimes(1);
  });

  it('respects the connection setting at play time', async () => {
    transferAllowed.mockReturnValue(false);
    const { state } = listener();
    prefetchEpisode(ep(), 'f1');
    await listen(state, COMMIT_SECONDS / TICK_SECONDS);
    expect(startDownload).not.toHaveBeenCalled();
  });

  it('re-checks the connection at commit time, not just at play time', async () => {
    const { state } = listener();
    prefetchEpisode(ep(), 'f1');
    await listen(state, COMMIT_SECONDS / TICK_SECONDS - 1);
    transferAllowed.mockReturnValue(false); // moved onto cellular meanwhile
    await listen(state, 1);
    expect(startDownload).not.toHaveBeenCalled();
  });

  it('skips an episode that is already on the device', async () => {
    isDownloaded.mockResolvedValue(true);
    const { state } = listener();
    prefetchEpisode(ep(), 'f1');
    await listen(state, COMMIT_SECONDS / TICK_SECONDS);
    expect(startDownload).not.toHaveBeenCalled();
  });

  it('hands the element the local copy when it lands', async () => {
    const { state, handoff } = listener();
    prefetchEpisode(ep(), 'f1');
    await listen(state, COMMIT_SECONDS / TICK_SECONDS);
    await vi.advanceTimersByTimeAsync(0);
    expect(handoff).toHaveBeenCalledWith('blob:local', state.position);
  });

  it('drops the handoff when the listener moves on mid-download', async () => {
    // The download has to still be in flight when they leave, so it is held
    // open here: resolving it first would make the guard untestable.
    let finish: () => void = () => undefined;
    startDownload.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve('ok');
        }),
    );
    const { state, handoff } = listener();
    prefetchEpisode(ep(), 'f1');
    await listen(state, COMMIT_SECONDS / TICK_SECONDS);
    expect(startDownload).toHaveBeenCalledTimes(1);

    state.trackId = 'e2'; // skipped to the next episode while it downloaded
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(handoff).not.toHaveBeenCalled();
    expect(offlineAudioUrl).not.toHaveBeenCalled();
  });

  it('does nothing at all before the player is wired up', async () => {
    resetPrefetchForTests();
    prefetchEpisode(ep(), 'f1');
    await vi.advanceTimersByTimeAsync(COMMIT_SECONDS * 2 * 1000);
    expect(startDownload).not.toHaveBeenCalled();
  });
});
