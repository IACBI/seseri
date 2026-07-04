import type { Subscription } from '../feeds/types';

/**
 * OPML export/import for subscriptions. RSS subs use the standard xmlUrl;
 * iTunes and YouTube subs are encoded as web links (url attribute) that the
 * importer maps back through their public URL forms.
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
      if (id.startsWith('yt:')) {
        const p = id.split(':');
        const url =
          p[1] === 'playlist'
            ? `https://www.youtube.com/playlist?list=${p.slice(2).join(':')}`
            : p[1] === 'channel'
              ? `https://www.youtube.com/channel/${p.slice(2).join(':')}`
              : `https://www.youtube.com/watch?v=${p.slice(2).join(':')}`;
        return `    <outline type="link" text="${text}" url="${xmlEscape(url)}"/>`;
      }
      return `    <outline type="link" text="${text}" url="https://podcasts.apple.com/podcast/id${xmlEscape(id)}"/>`;
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
}

/** Parse OPML text into importable entries (unknown outlines are skipped). */
export function parseOpml(xml: string): OpmlEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('invalid opml');
  const out: OpmlEntry[] = [];
  doc.querySelectorAll('outline').forEach((o) => {
    const name = o.getAttribute('text') || o.getAttribute('title') || '';
    const xmlUrl = o.getAttribute('xmlUrl');
    if (xmlUrl && /^https?:\/\//i.test(xmlUrl)) {
      out.push({ id: 'rss:' + xmlUrl, name: name || xmlUrl });
      return;
    }
    const url = o.getAttribute('url') || o.getAttribute('htmlUrl') || '';
    const apple = url.match(/podcasts\.apple\.com\/.*id(\d{4,14})/i) || url.match(/^id?(\d{6,12})$/);
    if (apple?.[1]) {
      out.push({ id: apple[1], name: name || apple[1] });
      return;
    }
    const pl = url.match(/[?&]list=([\w-]+)/i);
    if (pl?.[1]) {
      out.push({ id: 'yt:playlist:' + pl[1], name: name || 'YouTube' });
      return;
    }
    const ch = url.match(/youtube\.com\/channel\/(UC[\w-]{20,})/i);
    if (ch?.[1]) {
      out.push({ id: 'yt:channel:' + ch[1], name: name || 'YouTube' });
      return;
    }
    const vid = url.match(/(?:[?&]v=|youtu\.be\/)([\w-]{11})/);
    if (vid?.[1]) {
      out.push({ id: 'yt:video:' + vid[1], name: name || 'YouTube' });
    }
  });
  return out;
}
