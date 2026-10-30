import type { Episode } from './types';

/**
 * Oldest-first: chronological when the feed actually carries dates, otherwise
 * the source order reversed (every source we use hands over newest-first).
 * Always a new array.
 *
 * The threshold matters. `some()` was enough to switch to date sorting, so a
 * feed where only a handful of items are dated sorted every undated one as
 * epoch 0 and scattered them to one end. A majority rule keeps a fully dated
 * feed chronological and leaves a sparsely dated one in source order.
 *
 * Shared by the episode list and the new-episode sweep, which must agree on
 * what "newest" means.
 */
export function chronological(episodes: readonly Episode[]): Episode[] {
  // A date no parser reads (a localized weekday, say) is no date at all. As a
  // `NaN` it made the comparator inconsistent, and the sort then left a whole
  // unreadable feed in source order and displaced the readable items around a
  // single bad one.
  const keyed = episodes.map((e) => ({ e, t: e.releaseDate ? Date.parse(e.releaseDate) : NaN }));
  const dated = keyed.reduce((n, k) => n + (Number.isNaN(k.t) ? 0 : 1), 0);
  if (dated * 2 > episodes.length) {
    const at = (k: { t: number }): number => (Number.isNaN(k.t) ? 0 : k.t);
    return keyed.sort((a, b) => at(a) - at(b)).map((k) => k.e);
  }
  return episodes.slice().reverse();
}
