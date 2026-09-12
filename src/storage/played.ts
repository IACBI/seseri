/**
 * Whether an episode has been listened to.
 *
 * Until now this was derived and derived only: a row counted as listened when
 * its saved position passed 96% of its duration. That is right most of the
 * time and wrong in the two cases that matter. A feed that publishes no
 * `<itunes:duration>` has no percentage to compare against, so its episodes
 * could never read as finished. And there was no way to say so by hand — no
 * "I have heard this", no "I want to hear this again" — which on a 2000-episode
 * archive leaves the listener with no way to tell the two apart.
 *
 * So the derivation stays, and explicit answers override it:
 *
 *   explicitly unplayed  →  not played, whatever the position says
 *   explicitly played    →  played, whatever the position says
 *   neither              →  position ≥ 96% of a known duration
 *
 * Both overrides are needed, and the second one especially. Clearing a position
 * cannot travel between devices on its own — `mergeProgress` is additive and
 * never deletes — so without a stamped "unplayed" entry the finished position
 * would come back on the next sync and the episode would mark itself played
 * again. It is the same tombstone argument the subscription list makes, for the
 * same reason.
 *
 * Storage: `pp_played` and `pp_played_rm`, both `episodeId → ms epoch`, beside
 * the existing keys rather than folded into `pp_prog` — which would invalidate
 * every backup file ever exported.
 */

import { clearProgressFor, getProgress } from './progress';
import { local } from './local';
import { signal } from '../state/signals';

/** Past this much of a known duration, an episode counts as heard. */
export const LISTENED_PERCENT = 96;

const PLAYED_KEY = 'pp_played';
const UNPLAYED_KEY = 'pp_played_rm';

let played: Record<string, number> = {};
let unplayed: Record<string, number> = {};

/**
 * Bumped on every change so views can re-render. The map itself is not the
 * signal's value: it is mutated in place and read through `isPlayed`, and
 * copying thousands of entries on every mark would be the expensive part.
 */
export const playedRevision = signal(0);

function touch(): void {
  playedRevision.set(playedRevision() + 1);
}

function asStamps(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, at] of Object.entries(v as Record<string, unknown>)) {
    if (k && typeof at === 'number' && Number.isFinite(at)) out[k] = at;
  }
  return out;
}

export function loadPlayed(): void {
  played = asStamps(local.get<unknown>(PLAYED_KEY, {}));
  unplayed = asStamps(local.get<unknown>(UNPLAYED_KEY, {}));
  // An id in both maps is a state that cannot be read; the newer answer is the
  // one the listener gave last.
  for (const id of Object.keys(played)) {
    const off = unplayed[id];
    if (off === undefined) continue;
    if (off >= (played[id] ?? 0)) delete played[id];
    else delete unplayed[id];
  }
  touch();
}

function persist(): void {
  local.set(PLAYED_KEY, played);
  local.set(UNPLAYED_KEY, unplayed);
  touch();
}

/** True when the listener said so by hand, whatever the position is. */
export function isExplicitlyUnplayed(episodeId: string): boolean {
  return unplayed[episodeId] !== undefined;
}

/**
 * Has this episode been heard? `durationMs` is only consulted for the derived
 * case; pass 0 when the feed does not say and the answer rests on the
 * overrides alone.
 */
export function isPlayed(episodeId: string, durationMs = 0): boolean {
  if (unplayed[episodeId] !== undefined) return false;
  if (played[episodeId] !== undefined) return true;
  if (durationMs <= 0) return false;
  const seconds = getProgress(episodeId);
  if (seconds <= 0) return false;
  return (seconds * 1000) / durationMs >= LISTENED_PERCENT / 100;
}

/** Fraction heard, 0–1, or 0 when it cannot be known. Ignores the overrides. */
export function playedFraction(episodeId: string, durationMs: number): number {
  if (durationMs <= 0) return 0;
  const seconds = getProgress(episodeId);
  if (seconds <= 0) return 0;
  return Math.min(1, (seconds * 1000) / durationMs);
}

export function markPlayed(episodeId: string): void {
  if (!episodeId) return;
  delete unplayed[episodeId];
  played[episodeId] = Date.now();
  persist();
}

/**
 * Mark unheard, and forget the position with it — "play this again" means from
 * the start. The tombstone is what makes that survive a sync, since the
 * position itself will come back from any device that still has it.
 */
export function markUnplayed(episodeId: string): void {
  if (!episodeId) return;
  delete played[episodeId];
  unplayed[episodeId] = Date.now();
  clearProgressFor(episodeId);
  persist();
}

/** Flip the state and return what it became. */
export function togglePlayed(episodeId: string, durationMs = 0): boolean {
  const next = !isPlayed(episodeId, durationMs);
  if (next) markPlayed(episodeId);
  else markUnplayed(episodeId);
  return next;
}

/**
 * Auto-mark on reaching the end of an episode.
 *
 * Separate from `markPlayed` because it must not override a listener who has
 * just said "unplayed" — and because a feed with no duration has no other way
 * to ever be counted as finished.
 */
export function notePlaybackEnded(episodeId: string): void {
  if (!episodeId || unplayed[episodeId] !== undefined) return;
  if (played[episodeId] !== undefined) return;
  played[episodeId] = Date.now();
  persist();
}

/** What sync reads. Copied so callers cannot mutate the live maps. */
export function playedSnapshot(): {
  played: Record<string, number>;
  unplayed: Record<string, number>;
} {
  return { played: { ...played }, unplayed: { ...unplayed } };
}

/**
 * Apply a merged set, keeping the merge's own stamps — not `persist`'s
 * `Date.now()`, which would restamp the other device's history as if it had
 * happened here and make this device win every later conflict.
 */
export function setPlayedStamped(
  nextPlayed: Record<string, number>,
  nextUnplayed: Record<string, number>,
): void {
  played = asStamps(nextPlayed);
  unplayed = asStamps(nextUnplayed);
  persist();
}

export function clearPlayed(): void {
  played = {};
  unplayed = {};
  persist();
}
