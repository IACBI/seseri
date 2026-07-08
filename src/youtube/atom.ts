import { fetchTextProxied, fetchWithTimeout } from '../feeds/proxy-chain';
import { ytIdFrom, type YtListing } from './piped';

/** Recursively collect descendant elements by local (namespace-stripped) name. */
function ytFindAll(root: Element, localName: string): Element[] {
  const out: Element[] = [];
  (function walk(n: Element) {
    for (const c of n.children) {
      if (c.localName === localName) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}

function childText(parent: Element, tag: string): string {
  for (const el of parent.children) {
    if (el.localName === tag) return el.textContent?.trim() ?? '';
  }
  return '';
}

interface Rss2JsonResponse {
  status?: string;
  feed?: { title?: string; author?: string };
  items?: Array<{ guid?: string; link?: string; title?: string; pubDate?: string; thumbnail?: string }>;
}

/**
 * Fetch + normalize a YouTube Atom feed (latest ~15). Primary: rss2json
 * (CORS-enabled JSON). Fallback: raw Atom XML through the proxy chain.
 */
export async function fetchYtFeed(
  feedUrl: string,
  signal?: AbortSignal,
  perTimeout = 15000,
): Promise<YtListing> {
  try {
    let j: Rss2JsonResponse | null = null;
    try {
      const res = await fetchWithTimeout(
        'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(feedUrl),
        signal,
        perTimeout,
      );
      if (res.ok) j = (await res.json()) as Rss2JsonResponse;
    } catch (e) {
      if (signal?.aborted) throw e;
    }
    if (j && j.status === 'ok' && Array.isArray(j.items) && j.items.length) {
      const items = j.items
        .map((it) => ({
          videoId: ytIdFrom(it.guid ?? '') || ytIdFrom(it.link ?? ''),
          title: it.title || '',
          published: it.pubDate || '',
          durationSec: 0,
          thumb: it.thumbnail || '',
        }))
        .filter((x) => x.videoId);
      if (items.length) {
        return { title: j.feed?.title || 'YouTube', author: j.feed?.author || '', items };
      }
    }
  } catch (e) {
    if (signal?.aborted) throw e;
  }

  const xml = await fetchTextProxied(feedUrl, signal);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const feed = doc.querySelector('feed');
  if (doc.querySelector('parsererror') || !feed) throw new Error('invalid yt feed');
  const authorEl = ytFindAll(feed, 'author')[0];
  const items: YtListing['items'] = [];
  for (const entry of feed.querySelectorAll('entry')) {
    const vid = ytFindAll(entry, 'videoId')[0]?.textContent?.trim() ?? '';
    if (!vid) continue;
    const thEl = ytFindAll(entry, 'thumbnail')[0];
    items.push({
      videoId: vid,
      title: childText(entry, 'title'),
      published: childText(entry, 'published'),
      durationSec: 0,
      thumb: thEl?.getAttribute('url') ?? '',
    });
  }
  return {
    title: childText(feed, 'title') || 'YouTube',
    author: authorEl ? childText(authorEl, 'name') : '',
    items,
  };
}
