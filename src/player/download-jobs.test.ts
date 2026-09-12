// @vitest-environment jsdom
/**
 * Downloads in flight.
 *
 * The behaviour that matters: a job appears the moment it starts, its
 * percentage moves, a cancel actually stops the transfer, and the job is
 * removed whichever way it ends. A job left behind would leave a row stuck on
 * a percentage for the rest of the session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode } from '../feeds/types';

const downloadOffline = vi.hoisted(() => vi.fn());
vi.mock('./offline', () => ({ downloadOffline }));

import {
  cancelAllDownloads,
  cancelDownload,
  downloadJobs,
  isDownloading,
  jobFor,
  jobFraction,
  startDownload,
} from './download-jobs';

function ep(trackId = 'e1'): Episode {
  return {
    trackId,
    trackName: 'Episode ' + trackId,
    releaseDate: '',
    episodeUrl: 'https://cdn.example.com/' + trackId + '.mp3',
    trackTimeMillis: 0,
  };
}

/** A download we can drive: resolve it, or watch it observe the abort. */
function controllable() {
  let finish: (outcome: string) => void = () => undefined;
  let progress: ((p: { received: number; total: number }) => void) | undefined;
  let seenSignal: AbortSignal | undefined;
  downloadOffline.mockImplementation(
    (_ep: Episode, _feedId: string, opts: Record<string, unknown>) => {
      progress = opts['onProgress'] as typeof progress;
      seenSignal = opts['signal'] as AbortSignal;
      return new Promise((resolve) => {
        finish = resolve as typeof finish;
        seenSignal?.addEventListener('abort', () => resolve('aborted'), { once: true });
      });
    },
  );
  return {
    finish: (outcome = 'ok') => finish(outcome),
    report: (received: number, total: number) => progress?.({ received, total }),
    signal: () => seenSignal,
  };
}

beforeEach(() => {
  downloadJobs.set(new Map());
  downloadOffline.mockReset();
});

describe('startDownload', () => {
  it('registers a job straight away, before any bytes arrive', async () => {
    const job = controllable();
    const done = startDownload(ep(), 'f1');

    expect(isDownloading('e1')).toBe(true);
    expect(jobFor('e1')).toMatchObject({ id: 'e1', feedId: 'f1', received: 0, total: 0 });

    job.finish('ok');
    await expect(done).resolves.toBe('ok');
  });

  it('removes the job when it finishes', async () => {
    const job = controllable();
    const done = startDownload(ep(), 'f1');
    job.finish('ok');
    await done;
    expect(isDownloading('e1')).toBe(false);
    expect(jobFor('e1')).toBeUndefined();
  });

  it('removes the job when it fails', async () => {
    const job = controllable();
    const done = startDownload(ep(), 'f1');
    job.finish('failed');
    await expect(done).resolves.toBe('failed');
    expect(isDownloading('e1')).toBe(false);
  });

  it('removes the job when the download throws', async () => {
    downloadOffline.mockRejectedValue(new Error('boom'));
    await expect(startDownload(ep(), 'f1')).rejects.toThrow('boom');
    expect(isDownloading('e1')).toBe(false);
  });

  it('refuses a second transfer of the same episode', async () => {
    const job = controllable();
    const first = startDownload(ep(), 'f1');

    await expect(startDownload(ep(), 'f1')).resolves.toBe('already');
    expect(downloadOffline).toHaveBeenCalledTimes(1);

    job.finish('ok');
    await first;
  });

  it('refuses an episode with no id', async () => {
    await expect(startDownload(ep(''), 'f1')).resolves.toBe('no-url');
    expect(downloadOffline).not.toHaveBeenCalled();
  });
});

describe('progress', () => {
  it('reports a fraction once the host has declared a length', async () => {
    const job = controllable();
    const done = startDownload(ep(), 'f1');

    expect(jobFraction('e1')).toBeNull(); // nothing declared yet

    job.report(500_000, 1_000_000);
    expect(jobFraction('e1')).toBeCloseTo(0.5);
    expect(jobFor('e1')).toMatchObject({ received: 500_000, total: 1_000_000 });

    job.finish('ok');
    await done;
  });

  it('stays null for a host that declares no length', async () => {
    const job = controllable();
    const done = startDownload(ep(), 'f1');
    job.report(12_345, 0);
    expect(jobFraction('e1')).toBeNull();
    expect(jobFor('e1')?.received).toBe(12_345);
    job.finish('ok');
    await done;
  });

  it('does not republish for a move too small to see', async () => {
    const job = controllable();
    const done = startDownload(ep(), 'f1');

    job.report(100_000, 1_000_000); // 10% — the first real number
    const after10 = downloadJobs();
    job.report(100_500, 1_000_000); // +0.05%
    expect(downloadJobs()).toBe(after10);

    job.report(200_000, 1_000_000); // 20%
    expect(downloadJobs()).not.toBe(after10);
    expect(jobFraction('e1')).toBeCloseTo(0.2);

    job.finish('ok');
    await done;
  });

  it('clamps a host that sends more than it declared', async () => {
    const job = controllable();
    const done = startDownload(ep(), 'f1');
    job.report(1_200_000, 1_000_000);
    expect(jobFraction('e1')).toBe(1);
    job.finish('ok');
    await done;
  });
});

describe('cancelling', () => {
  it('aborts the transfer and clears the job', async () => {
    const job = controllable();
    const done = startDownload(ep(), 'f1');

    expect(cancelDownload('e1')).toBe(true);
    expect(job.signal()?.aborted).toBe(true);

    await expect(done).resolves.toBe('aborted');
    expect(isDownloading('e1')).toBe(false);
  });

  it('says so when there is nothing to cancel', () => {
    expect(cancelDownload('nope')).toBe(false);
  });

  it('cancels everything at once', async () => {
    const a = controllable();
    const first = startDownload(ep('e1'), 'f1');
    const b = controllable();
    const second = startDownload(ep('e2'), 'f1');

    cancelAllDownloads();

    await expect(first).resolves.toBe('aborted');
    await expect(second).resolves.toBe('aborted');
    expect(downloadJobs().size).toBe(0);
    expect(a.signal()?.aborted).toBe(true);
    expect(b.signal()?.aborted).toBe(true);
  });
});

describe('the registry as a signal', () => {
  it('publishes a new map rather than mutating, so subscribers notice', async () => {
    const seen: number[] = [];
    const off = downloadJobs.subscribe((m) => seen.push(m.size));
    const job = controllable();
    const done = startDownload(ep(), 'f1');
    job.finish('ok');
    await done;
    off();
    expect(seen).toEqual([1, 0]);
  });
});
