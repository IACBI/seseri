/**
 * Does a body start like a feed? Only the prologue is read: the root element
 * is the first thing that matters, and the body can be tens of megabytes.
 */

/** Enough for a BOM, an XML declaration, a few comments and a DOCTYPE. */
const HEAD_BYTES = 4096;

/** A root tag: optional prefix, then the local name, then a delimiter. */
const ROOT = /^<(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)(?=[\s/>])/;

function decodeHead(bytes: Uint8Array): string {
  const head = bytes.subarray(0, HEAD_BYTES);
  // A UTF-16 feed is ASCII-shaped only after decoding; the BOM says which.
  let utf16: string | null = null;
  if (head[0] === 0xff && head[1] === 0xfe) utf16 = 'utf-16le';
  else if (head[0] === 0xfe && head[1] === 0xff) utf16 = 'utf-16be';
  try {
    return new TextDecoder(utf16 ?? 'utf-8').decode(head);
  } catch {
    return '';
  }
}

/**
 * Index just past the prologue item starting at `i` (a comment, a processing
 * instruction or a DOCTYPE), or -1 when the item does not start there, or
 * -2 when it starts but does not finish inside the head.
 */
function skipPrologueItem(head: string, i: number): number {
  if (head.startsWith('<?', i)) {
    const end = head.indexOf('?>', i + 2);
    return end < 0 ? -2 : end + 2;
  }
  if (head.startsWith('<!--', i)) {
    const end = head.indexOf('-->', i + 4);
    return end < 0 ? -2 : end + 3;
  }
  if (/^<!DOCTYPE/i.test(head.slice(i, i + 9))) {
    // An internal subset (`[ … ]`) can hold `>` inside declarations, so the
    // closing `>` is searched for only after the subset ends.
    const open = head.indexOf('[', i);
    const gt = head.indexOf('>', i);
    if (gt < 0) return -2;
    if (open < 0 || open > gt) return gt + 1;
    const close = head.indexOf(']', open);
    if (close < 0) return -2;
    const end = head.indexOf('>', close);
    return end < 0 ? -2 : end + 1;
  }
  return -1;
}

/**
 * True when the body's root element is `rss`, `feed` (Atom, with or without a
 * prefix) or `rdf:RDF` (RSS 1.0). A leading BOM, whitespace, XML declarations,
 * comments and a DOCTYPE are skipped. HTML, JSON, plain text and empty bodies
 * all fail here, which is the point: `/v1/feed` must not be a general fetcher.
 */
export function isFeedDocument(bytes: Uint8Array): boolean {
  const head = decodeHead(bytes);
  let i = 0;
  for (;;) {
    while (i < head.length && /\s/.test(head.charAt(i))) i++;
    const next = skipPrologueItem(head, i);
    if (next === -2) return false;
    if (next === -1) break;
    i = next;
  }
  const m = ROOT.exec(head.slice(i, i + 256));
  if (!m) return false;
  const prefix = (m[1] ?? '').toLowerCase();
  const local = (m[2] ?? '').toLowerCase();
  if (local === 'rss' || local === 'feed') return true;
  return local === 'rdf' && prefix === 'rdf';
}
