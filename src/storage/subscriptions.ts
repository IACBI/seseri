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

export function loadSubscriptions(): void {
  const favs = local.get<Subscription[]>('pp_favs', []);
  const list = Array.isArray(favs) ? favs : [];
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
 */
export function setSubscriptionsStamped(
  list: Subscription[],
  at: Record<string, number>,
  removed: Record<string, number>,
): void {
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
