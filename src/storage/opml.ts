import type { Subscription } from '../feeds/types';

/**
 * OPML export/import for subscriptions. RSS subs use the standard xmlUrl;
 * iTunes subs are encoded as web links (url attribute) that the importer maps
 * back through their public URL form.
 *
 * YouTube links are deliberately NOT imported: the app dropped YouTube support,
 * so a `yt:` subscription could only ever render as a row that fails to open.
 * A file exported by an older version still imports — its podcast entries are
 * kept and its YouTube ones skipped.
 */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportOpml(subs: Subscription[]): string {
  const outlines = subs
    .map((f) => {
      const id = String(f.id);
      const text = xmlEscape(f.name || id);
      if (id.startsWith('rss:')) {
        return `    <outline type="rss" text="${text}" xmlUrl="${xmlEscape(id.slice(4))}"/>`;
      }
      const apple = `https://podcasts.apple.com/podcast/id${xmlEscape(id)}`;
      // With the feed's own address the entry is one every podcast app can
      // import; `url` keeps the Apple id, which is what Seseri reads back.
      if (f.feedUrl) {
        return `    <outline type="rss" text="${text}" xmlUrl="${xmlEscape(f.feedUrl)}" url="${apple}"/>`;
      }
      return `    <outline type="link" text="${text}" url="${apple}"/>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Seseri subscriptions</title></head>
  <body>
${outlines}
  </body>
</opml>
`;
}

export interface OpmlEntry {
  /** Subscription id in legacy format. */
  id: string;
  name: string;
  /** For an Apple entry, the feed address the file gave beside it. */
  feedUrl?: string;
}

/** Parse OPML text into importable entries (unknown outlines are skipped). */
export function parseOpml(xml: string): OpmlEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('invalid opml');
  const out: OpmlEntry[] = [];
  doc.querySelectorAll('outline').forEach((o) => {
    const name = o.getAttribute('text') || o.getAttribute('title') || '';
    const xmlUrl = o.getAttribute('xmlUrl');
    const feedUrl = xmlUrl && /^https?:\/\//i.test(xmlUrl) ? xmlUrl : '';
    const url = o.getAttribute('url') || o.getAttribute('htmlUrl') || '';
    const apple = url.match(/podcasts\.apple\.com\/.*id(\d{4,14})/i) || url.match(/^id?(\d{6,12})$/);
    // The Apple id first when the file carries both, as Seseri's own export
    // does: it is the id the listener's positions and history are filed under,
    // so a round trip must come back as the same subscription.
    if (apple?.[1]) {
      const https = feedUrl.startsWith('https://') ? feedUrl : '';
      out.push({ id: apple[1], name: name || apple[1], ...(https ? { feedUrl: https } : {}) });
      return;
    }
    if (feedUrl) out.push({ id: 'rss:' + feedUrl, name: name || feedUrl });
  });
  return out;
}

/**
 * One key for "the same feed", whichever way its address was written: the
 * scheme, a `www.`, letter case in the host and a trailing slash all vary
 * between apps and none of them makes it a different show.
 */
export function feedKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return host + u.pathname.replace(/\/+$/, '') + u.search;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * The entries of an import that are not already followed, and not repeated
 * within the file.
 *
 * A show followed through Apple is `<id>` here and a bare feed address in
 * every other app's export, so an id comparison alone subscribed to it a
 * second time — two tiles, two histories, the same episodes twice in the new
 * list. The feed address is the common ground: an Apple subscription knows it
 * (`Subscription.feedUrl`), an `rss:` one is it.
 */
export function unfollowedEntries(
  entries: readonly OpmlEntry[],
  existing: readonly Subscription[],
): OpmlEntry[] {
  const ids = new Set<string>();
  const feeds = new Set<string>();
  const remember = (id: string, feedUrl?: string): void => {
    ids.add(id);
    const url = feedUrl || (id.startsWith('rss:') ? id.slice(4) : '');
    if (url) feeds.add(feedKey(url));
  };
  for (const s of existing) remember(String(s.id), s.feedUrl);

  const out: OpmlEntry[] = [];
  for (const e of entries) {
    const url = e.feedUrl || (e.id.startsWith('rss:') ? e.id.slice(4) : '');
    if (ids.has(e.id) || (url && feeds.has(feedKey(url)))) continue;
    remember(e.id, url);
    out.push(e);
  }
  return out;
}
