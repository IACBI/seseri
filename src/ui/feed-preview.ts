/**
 * What the screen that opened a feed already knew about it.
 *
 * A search result carries the show's name, artwork and episode count, and a
 * subscription tile its name and artwork, yet the podcast page used to open on
 * "—" and "0 episodes" until the feed arrived — a header that was wrong for
 * seconds on a large archive. The opener leaves what it knows here and the page
 * paints it while it loads; the feed's own answer replaces it.
 */

export interface FeedPreview {
  name: string;
  artist: string;
  art: string;
  /** Episodes the source reported, when it reported any. */
  count?: number;
}

/** Only the most recent few matter: a preview is read once, right after it is left. */
const MAX = 20;
const previews = new Map<string, FeedPreview>();

export function rememberPreview(feedId: string, preview: FeedPreview): void {
  if (!feedId || !preview.name) return;
  previews.delete(feedId);
  previews.set(feedId, preview);
  while (previews.size > MAX) {
    const oldest = previews.keys().next().value;
    if (oldest === undefined) break;
    previews.delete(oldest);
  }
}

export function previewFor(feedId: string | null | undefined): FeedPreview | null {
  return (feedId && previews.get(feedId)) || null;
}
