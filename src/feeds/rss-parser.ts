/**
 * Feed parsing, as the app consumes it.
 *
 * The implementation moved to `rss-scan.ts` — a DOM-free single pass, shared
 * verbatim with the Worker so a feed is parsed at the edge and the client
 * receives compact JSON instead of tens of megabytes of XML. This module stays
 * as the app-facing seam: it is what `resolve.ts` and the tests import, and it
 * is the fallback path for a feed fetched through the public CORS proxies,
 * which arrives as raw XML with no Worker in front of it.
 *
 * One behaviour deliberately changed with the move. `DOMParser` in
 * `application/xml` mode is strict: a single unescaped `&` anywhere in a
 * 3000-item feed produced a `parsererror` and the whole show was reported as
 * `invalid rss`. The scanner salvages what it can instead, the way a browser
 * does with imperfect HTML, and only gives up when there is no `<channel>` at
 * all. A feed with one broken item now loses that item rather than everything.
 */

import type { Episode } from './types';
import { scanRss } from './rss-scan';

export { parseDuration } from './rss-scan';

export interface ParsedRss {
  title: string;
  author: string;
  art: string;
  episodes: Episode[];
}

/** Pure feed→episodes parsing: no network, no globals, no DOM. */
export function parseRss(xmlText: string): ParsedRss {
  return scanRss(xmlText);
}
