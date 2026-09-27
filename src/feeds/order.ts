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
  const dated = episodes.reduce((n, e) => n + (e.releaseDate ? 1 : 0), 0);
  if (dated * 2 > episodes.length) {
    return episodes
      .slice()
      .sort((a, b) => +new Date(a.releaseDate || 0) - +new Date(b.releaseDate || 0));
  }
  return episodes.slice().reverse();
}
