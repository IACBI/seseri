import type { Subscription } from '../feeds/types';
import { local } from './local';
import { signal } from '../state/signals';

/** Subscriptions ("favorites") — legacy key `pp_favs`, same entry shape. */
export const subscriptions = signal<Subscription[]>([]);

/**
 * Sidecars for cross-device sync, kept beside `pp_favs` rather than folded into
 * it so the stored list shape — and therefore every backup file — is unchanged.
 *
 * `pp_subs_rm` holds tombstones. Without them an unsubscribe cannot travel: the
 * merge is a union, so the device that still has the feed would win and the
 * subscription would come back on the next sync.
 */
const AT_KEY = 'pp_subs_at';
const RM_KEY = 'pp_subs_rm';

let subAt: Record<string, number> = {};
let subRm: Record<string, number> = {};

function asStamps(v: unknown): Record<string, number> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
}

/**
 * Reject what does not fit, never throw — the same contract as `loadQueue` and
 * `loadSettings`.
 *
 * This list is not only written by the app. `restoreBackup` copies `pp_favs`
 * straight out of a hand-editable JSON file, and a sync payload from another
 * build supplies `subs[].meta`. A single `null` in it used to reach
 * `String(f.id)` in the loop below, which throws — inside `boot()`, before any
 * view renders, on a value that lives in localStorage. The app came up blank
 * and stayed blank until storage was cleared.
 *
 * `id` is the only load-bearing field (it keys the sidecars, the feed cache and
 * `pp_last_<feedId>`); the three labels are coerced so a stray number renders
 * as text instead of crashing a row.
 */
export function sanitizeSubscriptions(raw: unknown): Subscription[] {
  if (!Array.isArray(raw)) return [];
  const out: Subscription[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Partial<Subscription>;
    const id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: typeof r.name === 'string' ? r.name : '',
      artist: typeof r.artist === 'string' ? r.artist : '',
      art: typeof r.art === 'string' ? r.art : '',
    });
  }
  return out;
}

export function loadSubscriptions(): void {
  const list = sanitizeSubscriptions(local.get<unknown>('pp_favs', []));
  subscriptions.set(list);
  subAt = asStamps(local.get<unknown>(AT_KEY, {}));
  subRm = asStamps(local.get<unknown>(RM_KEY, {}));
  // Subscriptions from before the sidecar existed report 0, which loses no
  // conflict it should win (see SIMULTANEITY_MS in src/sync/merge.ts).
  for (const f of list) {
    const id = String(f.id);
    if (!(id in subAt)) subAt[id] = 0;
  }
}

/** Timestamp what actually changed, so untouched entries keep their stamps. */
function stamp(prev: Subscription[], next: Subscription[]): void {
  const now = Date.now();
  const before = new Set(prev.map((f) => String(f.id)));
  const after = new Set(next.map((f) => String(f.id)));
  for (const id of after) {
    if (!before.has(id)) {
      subAt[id] = now;
      delete subRm[id];
    }
  }
  for (const id of before) {
    if (!after.has(id)) {
      subRm[id] = now;
      delete subAt[id];
    }
  }
}

function persist(list: Subscription[]): void {
  stamp(subscriptions(), list);
  subscriptions.set(list);
  local.set('pp_favs', list);
  local.set(AT_KEY, subAt);
  local.set(RM_KEY, subRm);
}

/** What sync reads. Copied so callers cannot mutate the live maps. */
export function subscriptionsSnapshot(): {
  list: Subscription[];
  at: Record<string, number>;
  removed: Record<string, number>;
} {
  return { list: subscriptions().slice(), at: { ...subAt }, removed: { ...subRm } };
}

/**
 * Apply a merged set in one write, keeping the merge's own timestamps.
 *
 * Deliberately not `persist`: that stamps whatever changed with `Date.now()`,
 * which would restamp the other device's history as if it had just happened
 * here and make this device win every subsequent conflict.
 *
 * Sanitised on the way in as well as on the way out of storage: the entries
 * come from `subs[].meta` in a remote payload, which a build newer or older
 * than this one wrote.
 */
export function setSubscriptionsStamped(
  rawList: Subscription[],
  at: Record<string, number>,
  removed: Record<string, number>,
): void {
  const list = sanitizeSubscriptions(rawList);
  subAt = { ...at };
  subRm = { ...removed };
  subscriptions.set(list);
  local.set('pp_favs', list);
  local.set(AT_KEY, subAt);
  local.set(RM_KEY, subRm);
}

export function isSubscribed(id: string): boolean {
  return subscriptions().some((f) => String(f.id) === String(id));
}

export function toggleSubscription(meta: Subscription): void {
  const list = subscriptions();
  persist(
    isSubscribed(meta.id) ? list.filter((f) => String(f.id) !== String(meta.id)) : [...list, meta],
  );
}

export function removeSubscription(id: string): void {
  persist(subscriptions().filter((f) => String(f.id) !== String(id)));
}

/**
 * Fill in artwork/author for a subscription that was stored without them.
 * OPML carries only a title and a URL, so an imported subscription sat in the
 * Library as a nameless grey tile until the user opened it — and even then
 * nothing wrote the metadata back.
 */
export function refreshSubscription(meta: Subscription): void {
  const list = subscriptions();
  const i = list.findIndex((f) => String(f.id) === String(meta.id));
  const cur = list[i];
  if (!cur) return;
  const next: Subscription = {
    ...cur,
    name: cur.name || meta.name,
    artist: cur.artist || meta.artist,
    art: cur.art || meta.art,
  };
  if (next.name === cur.name && next.artist === cur.artist && next.art === cur.art) return;
  const updated = list.slice();
  updated[i] = next;
  persist(updated);
}
