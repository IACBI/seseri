/**
 * Playback speed, per show.
 *
 * One global speed is the wrong shape for the thing it describes. A two-host
 * conversation is comfortable at 1.5×; a radio drama, a music show or anything
 * with sound design is ruined by it. With a single setting the listener either
 * picks one and accepts it being wrong half the time, or re-sets the speed at
 * every switch — and the speed control is in the Now Playing sheet, so that is
 * two taps into a panel, per episode.
 *
 * The override only exists while it differs from the global default, so the
 * store stays small and "set it back to normal" leaves nothing behind. Which
 * also means changing the default in Settings still moves every show that
 * never asked for anything else.
 *
 * Not synced, for the same reason the global default is not: `README.md` says
 * font size, theme and volume belong to the device, and how fast you like to
 * listen belongs with them. It is in the JSON backup, which is where a
 * deliberate move to a new device goes through.
 */

import { local } from '../storage/local';
import { settings } from './settings';
import { signal } from './signals';

const KEY = 'pp_feed_speed';

/** The speeds the UI offers. A stored value outside this set is ignored. */
export const SPEEDS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];

let overrides: Record<string, number> = {};

/** Bumped on every change, so the two speed selects can follow along. */
export const feedSpeedRevision = signal(0);

function acceptable(v: unknown): v is number {
  return typeof v === 'number' && SPEEDS.includes(v);
}

export function loadFeedSpeeds(): void {
  const raw = local.get<unknown>(KEY, {});
  overrides = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [feedId, v] of Object.entries(raw as Record<string, unknown>)) {
      // Written straight to `audio.playbackRate`, so a stored value has to be
      // one the UI can actually produce rather than merely "a number".
      if (feedId && acceptable(v)) overrides[feedId] = v;
    }
  }
  feedSpeedRevision.set(feedSpeedRevision() + 1);
}

/** The speed this show should play at: its own, or the global default. */
export function speedFor(feedId: string | null | undefined): number {
  if (feedId) {
    const own = overrides[feedId];
    if (own !== undefined) return own;
  }
  return settings().defaultSpeed;
}

/** True when this show has a speed of its own. */
export function hasOwnSpeed(feedId: string | null | undefined): boolean {
  return !!feedId && overrides[feedId] !== undefined;
}

/**
 * Remember a speed for one show. Setting it to the global default removes the
 * override instead of storing it — there is nothing to remember about a show
 * that plays at the normal speed.
 */
export function setFeedSpeed(feedId: string, speed: number): void {
  if (!feedId || !acceptable(speed)) return;
  if (speed === settings().defaultSpeed) delete overrides[feedId];
  else overrides[feedId] = speed;
  local.set(KEY, overrides);
  feedSpeedRevision.set(feedSpeedRevision() + 1);
}

export function clearFeedSpeeds(): void {
  overrides = {};
  local.set(KEY, overrides);
  feedSpeedRevision.set(feedSpeedRevision() + 1);
}

/** How many shows have a speed of their own — the Settings readout. */
export function feedSpeedCount(): number {
  return Object.keys(overrides).length;
}
