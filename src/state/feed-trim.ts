/**
 * Skip the intro and the outro, per show.
 *
 * Most shows open on the same jingle and sponsor read and close on the same
 * credits, every episode, for years. Skipping them by hand is a swipe at the
 * start and a reach for the phone at the end — exactly the moments a listener
 * is not holding it. The length is a property of the show, so it is stored
 * against the feed and applies to every episode of it.
 *
 * Stored like the per-show speed (`feed-speed.ts`): device-local, in the JSON
 * backup, and present only while it differs from "off".
 */

import { local } from '../storage/local';
import { signal } from './signals';

const KEY = 'pp_feed_trim';

/** The lengths the UI offers, in seconds. A stored value outside this set is ignored. */
export const TRIMS: readonly number[] = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180];

export interface FeedTrim {
  intro: number;
  outro: number;
}

const NONE: FeedTrim = Object.freeze({ intro: 0, outro: 0 });

/**
 * Below this much audio left after both trims, an episode is a trailer or a
 * bonus clip rather than a normal episode with the usual bookends, and the
 * trims would eat most of it.
 */
export const MIN_BODY_SEC = 60;

/**
 * A `timeupdate` lands every 250 ms or so of media time, a little more at high
 * speed or under background throttling. A jump wider than this was a seek: the
 * listener went there on purpose, and is not sent away from it.
 */
const MAX_TICK_SEC = 4;

let trims: Record<string, FeedTrim> = {};

export const feedTrimRevision = signal(0);

function acceptable(v: unknown): v is number {
  return typeof v === 'number' && TRIMS.includes(v);
}

export function loadFeedTrims(): void {
  const raw = local.get<unknown>(KEY, {});
  trims = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [feedId, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!feedId || !v || typeof v !== 'object') continue;
      const { intro, outro } = v as Record<string, unknown>;
      const t = { intro: acceptable(intro) ? intro : 0, outro: acceptable(outro) ? outro : 0 };
      if (t.intro || t.outro) trims[feedId] = t;
    }
  }
  feedTrimRevision.set(feedTrimRevision() + 1);
}

/** This show's trims; both zero when it has none. */
export function trimFor(feedId: string | null | undefined): FeedTrim {
  return (feedId && trims[feedId]) || NONE;
}

export function hasOwnTrim(feedId: string | null | undefined): boolean {
  return !!feedId && trims[feedId] !== undefined;
}

/** Set one end of a show's trim. Setting both ends to zero forgets the show. */
export function setFeedTrim(feedId: string, part: keyof FeedTrim, seconds: number): void {
  if (!feedId || (part !== 'intro' && part !== 'outro') || !acceptable(seconds)) return;
  const next = { ...trimFor(feedId), [part]: seconds };
  if (next.intro || next.outro) trims[feedId] = next;
  else delete trims[feedId];
  local.set(KEY, trims);
  feedTrimRevision.set(feedTrimRevision() + 1);
}

export function clearFeedTrims(): void {
  trims = {};
  local.set(KEY, trims);
  feedTrimRevision.set(feedTrimRevision() + 1);
}

/** How many shows have a trim — the Settings readout. */
export function feedTrimCount(): number {
  return Object.keys(trims).length;
}

/**
 * Where an episode starting from `from` should begin instead: past the intro
 * when it would otherwise start inside it, and `from` itself otherwise.
 *
 * An unknown duration (a stream that has not reported one yet) still skips: the
 * intro is at the start whatever the length, and the short-episode guard is
 * the only thing the duration is needed for.
 */
export function startPastIntro(from: number, duration: number, trim: FeedTrim): number {
  if (!trim.intro || from >= trim.intro) return from;
  if (Number.isFinite(duration) && duration < trim.intro + trim.outro + MIN_BODY_SEC) return from;
  return trim.intro;
}

/**
 * True when playback just ran into the outro: the previous tick was before it
 * and this one is inside it, by an ordinary tick rather than a seek. So an
 * episode resumed inside its outro, or scrubbed into it, plays on.
 */
export function crossedOutro(prev: number, now: number, duration: number, trim: FeedTrim): boolean {
  if (!trim.outro || !Number.isFinite(duration)) return false;
  if (duration < trim.intro + trim.outro + MIN_BODY_SEC) return false;
  const at = duration - trim.outro;
  return prev < at && now >= at && now - prev <= MAX_TICK_SEC;
}
