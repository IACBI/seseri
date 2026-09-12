/**
 * Browsing by topic, for the listener who does not arrive with a name in mind.
 *
 * The search screen opened on nothing at all, which is the one screen a podcast
 * app should not open on.
 *
 * The obvious source for this was Apple's top-shows chart, and it was measured
 * before being built on: `rss.marketingtools.apple.com` answers 200 to an
 * ordinary client, sends no `Access-Control-Allow-Origin` (so a browser cannot
 * read it), and answers 403 to a Cloudflare Worker whatever headers it sends
 * (so the proxy cannot read it either) — verified 2026-09-12. There is no
 * configuration in which it works, so it is not used.
 *
 * What does work everywhere the search works is the search itself. So the
 * topics are search terms, one set per language rather than one translated
 * set: searching "history" in the Turkish storefront finds far less than
 * "tarih" does, and the point of the screen is to find something.
 */

import type { LangKey } from '../i18n/types';
import type { SearchResult } from './types';
import { searchPodcasts } from './itunes';

/**
 * The topics offered, in order. Each key's value is both the chip's label and
 * the term it searches, which is why they are translations of an intent rather
 * than of a word.
 */
export const TOPIC_KEYS: readonly LangKey[] = [
  'topic_news',
  'topic_history',
  'topic_science',
  'topic_tech',
  'topic_culture',
  'topic_comedy',
  'topic_sport',
  'topic_health',
];

/** Shows for one topic. Just a search, so it inherits its whole fallback chain. */
export function topicShows(term: string, signal?: AbortSignal): Promise<SearchResult[]> {
  return searchPodcasts(term, signal);
}
