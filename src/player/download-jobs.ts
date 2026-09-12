/**
 * Downloads in flight.
 *
 * The download button used to set itself to an hourglass, disable itself, and
 * await the whole transfer. For a 150 MB episode on a hotel connection that is
 * several minutes of a page that says nothing and cannot be told to stop —
 * and if the listener navigated away, the only way to find out whether it had
 * worked was to come back and look.
 *
 * So a download is a job here: it has a percentage, it can be cancelled, and it
 * outlives the row that started it. The registry is a signal, which is what
 * lets a row repaint from wherever it is without the controller tracking which
 * rows are watching.
 */

import type { Episode } from '../feeds/types';
import { downloadOffline, type OfflineOutcome } from './offline';
import { signal } from '../state/signals';

export interface DownloadJob {
  /** Episode trackId. */
  id: string;
  feedId: string;
  title: string;
  received: number;
  /** 0 when the host declared no length, which some do not. */
  total: number;
  startedAt: number;
}

/** In-flight jobs by episode id. Replaced wholesale so the signal fires. */
export const downloadJobs = signal<ReadonlyMap<string, DownloadJob>>(new Map());

const controllers = new Map<string, AbortController>();

/**
 * A percentage is only worth painting when it moves. Chunks arrive dozens of
 * times a second and each one would otherwise rebuild a row.
 */
const PROGRESS_STEP = 0.01;

function publish(next: Map<string, DownloadJob>): void {
  downloadJobs.set(next);
}

function patch(id: string, fields: Partial<DownloadJob>): void {
  const current = downloadJobs().get(id);
  if (!current) return;
  const next = new Map(downloadJobs());
  next.set(id, { ...current, ...fields });
  publish(next);
}

function drop(id: string): void {
  if (!downloadJobs().has(id)) return;
  const next = new Map(downloadJobs());
  next.delete(id);
  publish(next);
}

export function jobFor(episodeId: string): DownloadJob | undefined {
  return downloadJobs().get(episodeId);
}

export function isDownloading(episodeId: string): boolean {
  return downloadJobs().has(episodeId);
}

/** 0–1, or null while the host has not said how big the episode is. */
export function jobFraction(episodeId: string): number | null {
  const job = downloadJobs().get(episodeId);
  if (!job || job.total <= 0) return null;
  return Math.min(1, job.received / job.total);
}

/**
 * Start a download and register it. Resolves with the outcome, which is what
 * the caller reports; the job is removed either way.
 *
 * A second call for an episode already downloading is ignored rather than
 * starting a second transfer of the same bytes.
 */
export async function startDownload(
  ep: Episode,
  feedId: string,
  opts: { ephemeral?: boolean } = {},
): Promise<OfflineOutcome | 'already'> {
  const id = String(ep.trackId);
  if (!id) return 'no-url';
  if (downloadJobs().has(id)) return 'already';

  const controller = new AbortController();
  controllers.set(id, controller);
  const next = new Map(downloadJobs());
  next.set(id, {
    id,
    feedId,
    title: ep.trackName || '',
    received: 0,
    total: 0,
    startedAt: Date.now(),
  });
  publish(next);

  let lastPainted = 0;
  try {
    return await downloadOffline(ep, feedId, {
      ...(opts.ephemeral ? { ephemeral: true } : {}),
      signal: controller.signal,
      onProgress: ({ received, total }) => {
        const fraction = total > 0 ? received / total : 0;
        // Always publish the first chunk (so "0%" becomes a real number) and
        // the total, then only on a visible step.
        if (lastPainted && fraction - lastPainted < PROGRESS_STEP) return;
        lastPainted = fraction;
        patch(id, { received, total });
      },
    });
  } finally {
    controllers.delete(id);
    drop(id);
  }
}

/** Ask an in-flight download to stop. Silent when there is nothing running. */
export function cancelDownload(episodeId: string): boolean {
  const controller = controllers.get(episodeId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Cancel everything — used when the whole download store is cleared. */
export function cancelAllDownloads(): void {
  for (const controller of controllers.values()) controller.abort();
}
