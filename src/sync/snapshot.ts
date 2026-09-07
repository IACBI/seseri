import type { Subscription } from '../feeds/types';
import { queueSnapshot, setQueueStamped } from '../state/queue';
import { getLastPlayed, mergeProgress, progressSnapshot } from '../storage/progress';
import { setSubscriptionsStamped, subscriptionsSnapshot } from '../storage/subscriptions';
import { emptyPayload } from './merge';
import type { LastPlayedEntry, ProgressEntry, SubEntry, SyncPayload } from './types';

/**
 * The bridge between local storage and the sync payload — the only module in
 * `src/sync/` that touches either.
 *
 * It is also where clock correction happens. Stored timestamps are on this
 * device's clock; everything inside a payload is on the server's. Converting
 * here, once in each direction, means `setProgress` keeps writing a plain
 * `Date.now()` and the merge only ever compares like with like.
 */

/** A stamp of 0 means "unknown", not "the epoch", so skew must not shift it. */
function toServer(at: number, skewMs: number): number {
  return at === 0 ? 0 : at + skewMs;
}

function toLocal(at: number, skewMs: number): number {
  return at === 0 ? 0 : at - skewMs;
}

export function readLocalPayload(skewMs: number): SyncPayload {
  const { prog, progAt, lastAt } = progressSnapshot();
  const subs = subscriptionsSnapshot();
  const q = queueSnapshot();

  const progress: Record<string, ProgressEntry> = {};
  for (const [id, t] of Object.entries(prog)) {
    progress[id] = { t, at: toServer(progAt[id] ?? 0, skewMs) };
  }

  const lastPlayed: Record<string, LastPlayedEntry> = {};
  for (const [feedId, at] of Object.entries(lastAt)) {
    const ep = getLastPlayed(feedId);
    if (ep) lastPlayed[feedId] = { ep, at: toServer(at, skewMs) };
  }

  const subEntries: Record<string, SubEntry> = {};
  for (const f of subs.list) {
    const id = String(f.id);
    subEntries[id] = { at: toServer(subs.at[id] ?? 0, skewMs), meta: f };
  }
  for (const [id, at] of Object.entries(subs.removed)) {
    subEntries[id] = { at: toServer(at, skewMs), removed: true };
  }

  return {
    ...emptyPayload(),
    progress,
    lastPlayed,
    subs: subEntries,
    queue: { list: q.list, at: toServer(q.at, skewMs) },
  };
}

/**
 * Order the merged subscriptions the way the user last saw them: whatever is
 * still subscribed keeps its current position, and anything newly arrived from
 * the other device is appended oldest-first. A merged map has no order of its
 * own, and re-sorting the library on every sync would look like a bug.
 */
function orderSubs(entries: Record<string, SubEntry>): Subscription[] {
  const current = subscriptionsSnapshot().list;
  const kept: Subscription[] = [];
  const seen = new Set<string>();

  for (const f of current) {
    const id = String(f.id);
    const entry = entries[id];
    if (!entry || entry.removed) continue;
    kept.push(entry.meta ?? f);
    seen.add(id);
  }

  const added = Object.entries(entries)
    .filter(([id, e]) => !seen.has(id) && !e.removed && e.meta)
    .sort((a, b) => a[1].at - b[1].at || (a[0] < b[0] ? -1 : 1));

  for (const [, e] of added) if (e.meta) kept.push(e.meta);
  return kept;
}

/**
 * Write a merged payload back to storage.
 *
 * Two things it deliberately does not do. It never seeks the audio element — a
 * pull that lands mid-playback must not move the playhead; `applyPrefs` picks
 * the merged position up the next time that episode starts. And it skips the
 * episode currently playing (`exclude`), because a stale remote value would
 * land and then be overwritten by the next `timeupdate` a second later, which
 * is a write storm and a visible flicker on the mini scrub.
 */
export function applyPayload(payload: SyncPayload, skewMs: number, exclude: Set<string>): void {
  const progress: Record<string, ProgressEntry> = {};
  for (const [id, entry] of Object.entries(payload.progress)) {
    if (exclude.has(id)) continue;
    progress[id] = { t: entry.t, at: toLocal(entry.at, skewMs) };
  }

  const lastPlayed: Record<string, LastPlayedEntry> = {};
  for (const [feedId, entry] of Object.entries(payload.lastPlayed)) {
    lastPlayed[feedId] = { ep: entry.ep, at: toLocal(entry.at, skewMs) };
  }

  mergeProgress(progress, lastPlayed);

  const at: Record<string, number> = {};
  const removed: Record<string, number> = {};
  for (const [id, entry] of Object.entries(payload.subs)) {
    if (entry.removed) removed[id] = toLocal(entry.at, skewMs);
    else at[id] = toLocal(entry.at, skewMs);
  }
  setSubscriptionsStamped(orderSubs(payload.subs), at, removed);

  setQueueStamped(payload.queue.list, toLocal(payload.queue.at, skewMs));
}
