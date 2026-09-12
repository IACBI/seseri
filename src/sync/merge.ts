import type {
  LastPlayedEntry,
  PlayedEntry,
  ProgressEntry,
  QueueSnapshot,
  SubEntry,
  SyncPayload,
} from './types';

/**
 * The merge, and nothing else.
 *
 * This module is deliberately pure: no storage, no `fetch`, no `crypto`, and no
 * `Date.now()` — `now` is a parameter. That is what makes the two properties
 * below testable, and those properties are the whole correctness argument for
 * the feature:
 *
 *   commutative   merge(a, b, now) deep-equals merge(b, a, now)
 *                 → two devices that merge in opposite orders still converge
 *   idempotent    merge(merge(a, b, now), b, now) deep-equals merge(a, b, now)
 *                 → they stop changing once they have converged
 *
 * Every helper here has to preserve both. A tie broken by "whichever argument
 * came first" would quietly break commutativity, which is why the ties below
 * are broken on the content instead.
 */

/**
 * 2 added `played`. Nothing branches on this number — a v1 payload from an
 * older device is applied as-is, with an empty `played` — but a shape that
 * changed without the version moving is a lie waiting to matter.
 */
export const PAYLOAD_VERSION = 2;

/**
 * Two writes this close together are treated as concurrent rather than ordered.
 *
 * Timestamps come from two devices' clocks, corrected by a skew measurement
 * that is itself only good to a second or two. Inside the window the merge
 * takes the *further* position instead of the later one: a position jumping
 * backwards is the failure users notice and hate, while over-advancing costs
 * one tap. It also makes `at: 0` — every entry written before this feature
 * existed — resolve sensibly, so there is no migration to run.
 *
 * The cost: deliberately restarting an episode on one device within a minute of
 * the other device's last write is discarded.
 */
export const SIMULTANEITY_MS = 60_000;

/** How long a removal keeps out-voting the copy on a device that was offline. */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** A stamp further ahead than this is a wrong clock, not a newer write. */
export const FUTURE_SKEW_CAP_MS = 48 * 60 * 60 * 1000;

export function emptyPayload(): SyncPayload {
  return {
    v: PAYLOAD_VERSION,
    progress: {},
    lastPlayed: {},
    subs: {},
    queue: { list: [], at: 0 },
    played: {},
  };
}

/** A stamp that cannot order anything: absent, malformed, or absurdly ahead. */
function clampAt(at: number, now: number): number {
  if (!Number.isFinite(at) || at < 0) return 0;
  return at > now + FUTURE_SKEW_CAP_MS ? now : at;
}

function clampT(t: number): number {
  return Number.isFinite(t) && t > 0 ? t : 0;
}

function concurrent(a: number, b: number): boolean {
  return Math.abs(a - b) <= SIMULTANEITY_MS;
}

function mergeProgressEntry(a: ProgressEntry, b: ProgressEntry): ProgressEntry {
  if (concurrent(a.at, b.at)) return { t: Math.max(a.t, b.t), at: Math.max(a.at, b.at) };
  return a.at > b.at ? a : b;
}

function mergeLastPlayedEntry(
  a: LastPlayedEntry,
  b: LastPlayedEntry,
  progress: Record<string, ProgressEntry>,
): LastPlayedEntry {
  if (!concurrent(a.at, b.at)) return a.at > b.at ? a : b;
  const at = Math.max(a.at, b.at);
  if (a.ep === b.ep) return { ep: a.ep, at };
  // Both devices claim a different "last" at the same moment. The one the user
  // got further into is the better guess; the id comparison only exists so the
  // result does not depend on argument order.
  const ta = progress[a.ep]?.t ?? 0;
  const tb = progress[b.ep]?.t ?? 0;
  if (ta !== tb) return { ep: ta > tb ? a.ep : b.ep, at };
  return { ep: a.ep > b.ep ? a.ep : b.ep, at };
}

/** `exactOptionalPropertyTypes` forbids writing `removed: undefined`. */
function subWithAt(e: SubEntry, at: number): SubEntry {
  const out: SubEntry = { at };
  if (e.removed) out.removed = true;
  if (e.meta) out.meta = e.meta;
  return out;
}

function metaKey(e: SubEntry): string {
  const m = e.meta;
  return m ? [m.id, m.name, m.artist, m.art].join('\u0000') : '';
}

function mergeSubEntry(a: SubEntry, b: SubEntry): SubEntry {
  if (!concurrent(a.at, b.at)) return a.at > b.at ? a : b;
  const at = Math.max(a.at, b.at);
  if (a.removed && b.removed) return { at, removed: true };
  // Least destructive inside the window: a removal racing a subscribe loses, so
  // the feed stays in the library. Losing a show you still want is worse than
  // having to unsubscribe twice.
  if (a.removed) return subWithAt(b, at);
  if (b.removed) return subWithAt(a, at);
  if (a.at !== b.at) return subWithAt(a.at > b.at ? a : b, at);
  return subWithAt(metaKey(a) <= metaKey(b) ? a : b, at);
}

/** `exactOptionalPropertyTypes` forbids writing `unplayed: undefined`. */
function playedWithAt(e: PlayedEntry, at: number): PlayedEntry {
  return e.unplayed ? { at, unplayed: true } : { at };
}

/**
 * Inside the simultaneity window, "not heard" wins.
 *
 * Least destructive, the same way a subscribe beats a concurrent unsubscribe:
 * an episode wrongly marked heard vanishes from the unplayed filter and the
 * listener has no way to notice it is missing, while one wrongly marked unheard
 * simply shows up again and costs a tap.
 */
function mergePlayedEntry(a: PlayedEntry, b: PlayedEntry): PlayedEntry {
  if (!concurrent(a.at, b.at)) return a.at > b.at ? a : b;
  const at = Math.max(a.at, b.at);
  if (!!a.unplayed === !!b.unplayed) return playedWithAt(a, at);
  return { at, unplayed: true };
}

function normPlayed(
  src: Record<string, PlayedEntry> | undefined,
  now: number,
): Record<string, PlayedEntry> {
  const out: Record<string, PlayedEntry> = {};
  for (const [k, v] of Object.entries(src ?? {})) out[k] = playedWithAt(v, clampAt(v.at, now));
  return out;
}

function queueKey(list: QueueSnapshot['list']): string {
  return list.map((i) => i.feedId + '\u0000' + i.trackId).join('\u0001');
}

function mergeQueue(a: QueueSnapshot, b: QueueSnapshot): QueueSnapshot {
  // Whole-list, never item by item: two independently reordered lists merged
  // element-wise produce an order neither user asked for.
  if (!concurrent(a.at, b.at)) return a.at > b.at ? a : b;
  const at = Math.max(a.at, b.at);
  if (a.list.length !== b.list.length) {
    return { list: a.list.length > b.list.length ? a.list : b.list, at };
  }
  return { list: queueKey(a.list) <= queueKey(b.list) ? a.list : b.list, at };
}

function unionMerge<T>(
  a: Record<string, T>,
  b: Record<string, T>,
  join: (x: T, y: T) => T,
): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = cur === undefined ? v : join(cur, v);
  }
  return out;
}

function normProgress(
  src: Record<string, ProgressEntry>,
  now: number,
): Record<string, ProgressEntry> {
  const out: Record<string, ProgressEntry> = {};
  for (const [k, v] of Object.entries(src)) out[k] = { t: clampT(v.t), at: clampAt(v.at, now) };
  return out;
}

function normLastPlayed(
  src: Record<string, LastPlayedEntry>,
  now: number,
): Record<string, LastPlayedEntry> {
  const out: Record<string, LastPlayedEntry> = {};
  for (const [k, v] of Object.entries(src)) out[k] = { ep: v.ep, at: clampAt(v.at, now) };
  return out;
}

function normSubs(src: Record<string, SubEntry>, now: number): Record<string, SubEntry> {
  const out: Record<string, SubEntry> = {};
  for (const [k, v] of Object.entries(src)) out[k] = subWithAt(v, clampAt(v.at, now));
  return out;
}

/**
 * Drop tombstones nobody needs any more.
 *
 * This runs on the output only, never on the inputs. Two devices GC at
 * different wall-clock moments; letting them prune their inputs would make the
 * same pair of payloads merge to different results on each side, and they would
 * never converge. A device offline for longer than the TTL resurrects a feed it
 * unsubscribed from — the known cost of this design.
 */
function gcTombstones(subs: Record<string, SubEntry>, now: number): Record<string, SubEntry> {
  const out: Record<string, SubEntry> = {};
  for (const [k, v] of Object.entries(subs)) {
    if (v.removed && now - v.at > TOMBSTONE_TTL_MS) continue;
    out[k] = v;
  }
  return out;
}

export function mergePayload(local: SyncPayload, remote: SyncPayload, now: number): SyncPayload {
  const progress = unionMerge(
    normProgress(local.progress, now),
    normProgress(remote.progress, now),
    mergeProgressEntry,
  );
  const lastPlayed = unionMerge(
    normLastPlayed(local.lastPlayed, now),
    normLastPlayed(remote.lastPlayed, now),
    (a, b) => mergeLastPlayedEntry(a, b, progress),
  );
  const subs = gcTombstones(
    unionMerge(normSubs(local.subs, now), normSubs(remote.subs, now), mergeSubEntry),
    now,
  );
  const queue = mergeQueue(
    { list: local.queue.list, at: clampAt(local.queue.at, now) },
    { list: remote.queue.list, at: clampAt(remote.queue.at, now) },
  );
  const played = unionMerge(
    normPlayed(local.played, now),
    normPlayed(remote.played, now),
    mergePlayedEntry,
  );
  return { v: PAYLOAD_VERSION, progress, lastPlayed, subs, queue, played };
}

/**
 * Shrink an over-large payload by forgetting the oldest positions.
 *
 * Last resort before the server's size cap. Ties break on the key so two
 * devices that cap the same payload produce the same result.
 */
export function capPayload(p: SyncPayload, maxProgressEntries: number): SyncPayload {
  const keys = Object.keys(p.progress);
  if (keys.length <= maxProgressEntries) return p;
  const keep = keys
    .sort((x, y) => {
      const ax = p.progress[x]?.at ?? 0;
      const ay = p.progress[y]?.at ?? 0;
      return ay - ax || (x < y ? -1 : x > y ? 1 : 0);
    })
    .slice(0, maxProgressEntries);
  const progress: Record<string, ProgressEntry> = {};
  for (const k of keep) {
    const v = p.progress[k];
    if (v) progress[k] = v;
  }
  // `played` grows at the same rate — one entry per episode finished — so
  // trimming only the positions would leave the payload just as oversized.
  const playedKeys = Object.keys(p.played ?? {});
  if (playedKeys.length <= maxProgressEntries) return { ...p, progress };
  const playedKeep = playedKeys
    .sort((x, y) => {
      const ax = p.played?.[x]?.at ?? 0;
      const ay = p.played?.[y]?.at ?? 0;
      return ay - ax || (x < y ? -1 : x > y ? 1 : 0);
    })
    .slice(0, maxProgressEntries);
  const played: Record<string, PlayedEntry> = {};
  for (const k of playedKeep) {
    const v = p.played?.[k];
    if (v) played[k] = v;
  }
  return { ...p, progress, played };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Written in the same spirit as `loadQueue`: reject what does not fit, never
 * throw. The blob is authenticated, so it came from one of the user's own
 * devices — but a newer version of the app is a real source of shapes this
 * version cannot handle, and unknown extra keys have to survive rather than
 * fail the whole payload.
 */
export function isSyncPayload(x: unknown): x is SyncPayload {
  if (!isRecord(x)) return false;
  if (typeof x['v'] !== 'number') return false;
  if (!isRecord(x['progress']) || !isRecord(x['lastPlayed']) || !isRecord(x['subs'])) return false;
  for (const v of Object.values(x['progress'])) {
    if (!isRecord(v) || typeof v['t'] !== 'number' || typeof v['at'] !== 'number') return false;
  }
  for (const v of Object.values(x['lastPlayed'])) {
    if (!isRecord(v) || typeof v['ep'] !== 'string' || typeof v['at'] !== 'number') return false;
  }
  for (const v of Object.values(x['subs'])) {
    if (!isRecord(v) || typeof v['at'] !== 'number') return false;
    // `meta` travels straight into the subscription list, which keys the feed
    // cache and the `pp_last_<feedId>` pointers. A `meta` that is present but
    // is not an object with a usable id is not a payload this build can apply.
    const meta = v['meta'];
    if (meta !== undefined && (!isRecord(meta) || typeof meta['id'] !== 'string' || !meta['id'])) {
      return false;
    }
  }
  // Absent on a v1 payload, which is a real thing to receive.
  const pl = x['played'];
  if (pl !== undefined) {
    if (!isRecord(pl)) return false;
    for (const v of Object.values(pl)) {
      if (!isRecord(v) || typeof v['at'] !== 'number') return false;
    }
  }
  const q = x['queue'];
  if (!isRecord(q) || !Array.isArray(q['list']) || typeof q['at'] !== 'number') return false;
  for (const item of q['list']) {
    if (!isRecord(item)) return false;
    if (typeof item['feedId'] !== 'string' || typeof item['trackId'] !== 'string') return false;
    if (!item['feedId'] || !item['trackId']) return false;
  }
  return true;
}
