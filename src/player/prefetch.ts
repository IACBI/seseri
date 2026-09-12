/**
 * Background prefetch — the structural answer to backgrounded playback.
 *
 * Recovery (`recovery.ts`) makes a dropped range request survivable. This makes
 * it not happen: while the episode plays, its bytes are pulled into the same
 * offline cache a user download uses, and when the copy is complete the element
 * is switched over to it. From that moment playback needs no network at all, so
 * a dozing radio, an expiring signed URL or a Worker rate limit cannot end it.
 *
 * The swap is deliberately narrow: same track, same position, same rate, no
 * change to the session or the Media Session notification. If anything about
 * the situation has moved on by the time the download lands, it is dropped.
 *
 * The copy is a second transfer: the element streams the episode while this
 * fetches it whole, so a first play costs 2.00× the episode (measured — 4.80 MB
 * of audio, 9.60 MB off the host). That duplication is not removable here. The
 * only way to feed both the element and the cache from one transfer is for the
 * service worker to answer the element's own range request and tee the body
 * into the cache, and a tee buffers for whichever side reads slower — the
 * element reads at playback rate, the cache at line rate, so the worker would
 * hold the rest of the episode in memory (tens to hundreds of MB on a phone).
 * Answering `bytes=0-` with a plain 200 instead would avoid the tee and break
 * seeking for the whole of the first play. So the duplicate stays, and what is
 * worth removing is the copies nobody listens to: this waits until the listener
 * has actually stayed with the episode, and skips one that is nearly over.
 */

import type { Episode } from '../feeds/types';
import { settings } from '../state/settings';
import { transferAllowed } from './connection';
import { isDownloaded, offlineAudioUrl } from './offline';
import { startDownload } from './download-jobs';

export interface PrefetchHooks {
  /** Hand the element a local copy, continuing from `positionSec`. */
  handoff: (url: string, positionSec: number) => void;
  /** Position to resume at, and the track it belongs to, read at swap time. */
  currentTrackId: () => string | null;
  currentPosition: () => number;
}

/** Seconds of real listening before a whole-episode copy has earned its bytes. */
export const COMMIT_SECONDS = 60;
/** How often listening is sampled. Also the ceiling on one sample's credit. */
export const TICK_SECONDS = 10;
/**
 * With less audio left than this, a full copy buys almost nothing: resuming a
 * 90-minute episode at 97% would download all of it for two minutes of sound.
 */
export const MIN_REMAINING_SECONDS = 120;

let hooks: PrefetchHooks | null = null;
/** Track ids whose download has been started — one shot each, success or not. */
const attempted = new Set<string>();
/** Track ids with a live commitment timer, so a re-play does not stack them. */
const armed = new Set<string>();

export function initPrefetch(h: PrefetchHooks): void {
  hooks = h;
}

/** Test seam: the module keeps per-session state and the tests need it fresh. */
export function resetPrefetchForTests(): void {
  hooks = null;
  attempted.clear();
  armed.clear();
}

/** Shared with auto-download; see player/connection.ts for the reasoning. */
function allowedNow(): boolean {
  return transferAllowed(settings().prefetchAudio);
}

/** Seconds of audio after `position`, or Infinity when the feed declares none. */
function remainingSeconds(ep: Episode, position: number): number {
  const total = Number(ep.trackTimeMillis) / 1000;
  if (!Number.isFinite(total) || total <= 0) return Infinity;
  return total - position;
}

async function run(ep: Episode, feedId: string, id: string): Promise<void> {
  try {
    if (await isDownloaded(id)) return; // already local, nothing to do
    const outcome = await startDownload(ep, feedId, { ephemeral: true });
    if (outcome !== 'ok') return;
    // Everything below re-reads live state: the download may have taken
    // minutes, and the user may be three episodes further on by now.
    if (hooks?.currentTrackId() !== id) return;
    const url = await offlineAudioUrl(id);
    if (!url) return;
    if (hooks?.currentTrackId() !== id) {
      URL.revokeObjectURL(url);
      return;
    }
    hooks.handoff(url, hooks.currentPosition());
  } catch {
    /* prefetch is an optimisation; the streaming path still works */
  }
}

/**
 * Arm caching for `ep`. Safe to call on every play — it is idempotent per
 * track and silently does nothing when it should not run.
 *
 * Nothing is transferred until the listener has accumulated `COMMIT_SECONDS`
 * of playback on this episode. Position deltas are what counts, clamped to the
 * sample length, so a pause stops the clock and a scrub cannot buy credit — and
 * a browse-and-skip session, which used to pull a complete copy of every
 * episode it touched for ten seconds, now pulls none.
 */
export function prefetchEpisode(ep: Episode, feedId: string): void {
  const id = String(ep.trackId);
  if (!hooks || !id || attempted.has(id) || armed.has(id) || !allowedNow()) return;
  if (remainingSeconds(ep, hooks.currentPosition()) < MIN_REMAINING_SECONDS) return;
  armed.add(id);

  let listened = 0;
  let lastPos = hooks.currentPosition();

  const tick = (): void => {
    if (!hooks || hooks.currentTrackId() !== id) {
      // They moved on before committing. Forget it so a later play re-arms.
      armed.delete(id);
      return;
    }
    const pos = hooks.currentPosition();
    // Clamped both ways: a backward seek credits nothing, and a forward one
    // credits at most the time that actually passed.
    listened += Math.min(Math.max(0, pos - lastPos), TICK_SECONDS);
    lastPos = pos;

    if (listened < COMMIT_SECONDS) {
      setTimeout(tick, TICK_SECONDS * 1000);
      return;
    }
    if (!allowedNow() || remainingSeconds(ep, pos) < MIN_REMAINING_SECONDS) {
      armed.delete(id);
      return;
    }
    attempted.add(id);
    void run(ep, feedId, id);
  };

  setTimeout(tick, TICK_SECONDS * 1000);
}
