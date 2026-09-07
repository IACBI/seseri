import type { FeedMeta } from '../feeds/types';
import type { QueueItem } from '../state/queue';

/**
 * The shapes that travel between devices.
 *
 * Every `at` is a millisecond epoch **on the server clock** — the client adds
 * its measured skew on the way out and subtracts it on the way back in
 * (`src/sync/snapshot.ts`), so two devices with badly set clocks still compare
 * like for like. Nothing here is ever read straight from storage: the stored
 * timestamps are on each device's own clock.
 */

/** A resume position for one episode. */
export interface ProgressEntry {
  /** Seconds into the episode. */
  t: number;
  at: number;
}

/** Which episode was last played in one feed. */
export interface LastPlayedEntry {
  /** Episode trackId. */
  ep: string;
  at: number;
}

/**
 * One subscription, or its tombstone.
 *
 * A removal has to travel as a stamped entry rather than as an absence: the
 * merge is a union, so a feed the user unsubscribed from on the phone is still
 * present on the PC, wins the union, and comes back on the next merge. The
 * tombstone is what says "this was deleted, and when".
 */
export interface SubEntry {
  at: number;
  removed?: true;
  /** Dropped on a tombstone — dead weight in every payload from then on. */
  meta?: FeedMeta;
}

/** The queue travels whole; see `mergePayload` for why it is not merged item by item. */
export interface QueueSnapshot {
  list: QueueItem[];
  at: number;
}

export interface SyncPayload {
  v: number;
  /** episode trackId → position */
  progress: Record<string, ProgressEntry>;
  /** feedId → last played episode */
  lastPlayed: Record<string, LastPlayedEntry>;
  /** feedId → subscription or tombstone */
  subs: Record<string, SubEntry>;
  queue: QueueSnapshot;
}
