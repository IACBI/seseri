/**
 * RSS scanner — one forward pass over the feed text, no DOM.
 *
 * ⚠ This file is duplicated verbatim as `worker/src/rss-scan.ts`, the same way
 * `credential-url.ts` is. `rss-scan.test.ts` fails if the two drift.
 *
 * Why not `DOMParser`, which the app used before:
 *
 *   - It does not exist in a Cloudflare Worker, and parsing at the edge is the
 *     point. A popular show's full archive is tens of megabytes of XML (The
 *     Daily: ~20 MB, ~3000 items), and shipping all of it to a phone to end up
 *     with a fraction of that in fields was most of what "opening a podcast"
 *     cost.
 *
 *   - On the client it built a whole document — a node per element, thousands
 *     of items deep — on the main thread, and moving that to a Web Worker was
 *     never an option either, because `DOMParser` does not exist there.
 *
 * The output is deliberately identical to what the DOM implementation produced,
 * down to which duplicate tag wins: resume positions are keyed on `trackId`, so
 * a change of mind about `<guid>` would orphan every saved position already out
 * there. `rss-scan.test.ts` keeps a DOMParser reference implementation and
 * asserts the two agree over a corpus of awkward feeds.
 *
 * Scope is the feed shapes podcast clients actually meet: RSS 2.0 plus the
 * iTunes and Podcasting 2.0 namespaces. Matching is by local name, so a feed
 * that binds those namespaces to unusual prefixes still parses.
 */

/** A single playable item, exactly as the player consumes it. */
export interface ScannedEpisode {
  /** Stable id: `<guid>` when the feed has one, otherwise the enclosure URL. */
  trackId: string;
  trackName: string;
  /** Raw date string (RSS `pubDate` or ISO); '' when the feed omits it. */
  releaseDate: string;
  episodeUrl: string;
  /** Duration in ms; 0 when unknown. */
  trackTimeMillis: number;
  /** Per-episode artwork from `<itunes:image>`. */
  art?: string;
  /** Raw show-notes markup — untrusted, never render it as HTML. */
  description?: string;
  /** `<itunes:season>` / `<itunes:episode>` when the feed numbers its items. */
  season?: number;
  episode?: number;
  /** `<podcast:chapters url>`: a JSON chapter list. https only. */
  chaptersUrl?: string;
  /** `<podcast:transcript>` alternatives in feed order. https only. */
  transcripts?: ScannedTranscript[];
}

export interface ScannedTranscript {
  url: string;
  /** MIME type as the feed declares it: `text/vtt`, `application/srt`, … */
  type: string;
  language?: string;
}

export interface ParsedRss {
  title: string;
  author: string;
  art: string;
  episodes: ScannedEpisode[];
}

/** "1:02:03" | "62:03" | "3723" → milliseconds. 0 for anything unparseable. */
export function parseDuration(s: string): number {
  if (!s) return 0;
  const p = s.split(':').map(Number);
  if (p.some(isNaN)) return 0;
  const sec =
    p.length === 3
      ? (p[0] ?? 0) * 3600 + (p[1] ?? 0) * 60 + (p[2] ?? 0)
      : p.length === 2
        ? (p[0] ?? 0) * 60 + (p[1] ?? 0)
        : (p[0] ?? 0);
  return sec * 1000;
}

// ── text decoding ────────────────────────────────────────────────────
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Not XML-predefined, but feeds use it constantly and every browser accepts
  // it. Left alone it renders as a literal "&nbsp;" in an episode title.
  nbsp: ' ',
};

const ENTITY_RE = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/**
 * Decode the references a feed can carry. Anything unrecognised is left as
 * written, which is what a browser does with an undeclared entity — and is the
 * safe direction, since text is all this module ever produces.
 */
function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(ENTITY_RE, (whole, body: string) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole; // lone surrogate
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** Collapse an XML name to its local part: `itunes:duration` → `duration`. */
function localName(qname: string): string {
  const colon = qname.indexOf(':');
  return (colon === -1 ? qname : qname.slice(colon + 1)).toLowerCase();
}

function httpsOnly(u: string | undefined): string {
  return u && /^https:\/\//i.test(u) ? u : '';
}

/**
 * HTML elements that never close. Show notes are supposed to be escaped or in
 * CDATA, but plenty of feeds drop raw `<br>` and `<img>` into a
 * `<description>`; treating them as open tags would unbalance the stack and
 * swallow the rest of the feed.
 */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function isNameEnd(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '/' || c === '>';
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** Attribute map for the inside of a tag, values entity-decoded. */
function readAttrs(inner: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (inner.indexOf('=') === -1) return out;
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(inner)) !== null) {
    out[localName(m[1] ?? '')] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** What a captured element's text is being collected for. */
type Sink =
  | 'channel-title'
  | 'channel-author'
  | 'image-url'
  | 'item-title'
  | 'item-guid'
  | 'item-date'
  | 'item-duration'
  | 'item-notes'
  | 'item-summary'
  | 'item-season'
  | 'item-episode';

interface Capture {
  sink: Sink;
  /** Stack depth of the captured element itself. */
  depth: number;
  buf: string;
}

interface ItemDraft {
  title: string;
  guid: string;
  date: string;
  enclosure: string;
  durationMs: number;
  art: string;
  notes: string;
  summary: string;
  season: number;
  episode: number;
  chaptersUrl: string;
  transcripts: ScannedTranscript[];
}

function newItem(): ItemDraft {
  return {
    title: '',
    guid: '',
    date: '',
    enclosure: '',
    durationMs: 0,
    art: '',
    notes: '',
    summary: '',
    season: 0,
    episode: 0,
    chaptersUrl: '',
    transcripts: [],
  };
}

/**
 * Parse a feed. Throws `invalid rss` when the text carries no `<channel>`,
 * which is the same verdict the DOM implementation reached (its `querySelector`
 * found nothing) for both junk input and a feed of a kind we do not read.
 */
export function scanRss(xml: string): ParsedRss {
  /** Local names of the open elements, outermost first. */
  const stack: string[] = [];
  let channelDepth = -1;
  let itemDepth = -1;
  let sawChannel = false;

  let chTitle = '';
  let chAuthor = '';
  let chArt = '';

  /** `<image>` in progress: href from the attribute, url from a child element. */
  let imageHref = '';
  let imageUrl = '';
  let imageDepth = -1;
  /** Whose artwork the open `<image>` belongs to. */
  let imageOwner: 'channel' | 'item' | null = null;

  let item: ItemDraft | null = null;
  let capture: Capture | null = null;
  const episodes: ScannedEpisode[] = [];

  const text = (raw: string, decode: boolean): void => {
    if (!capture || !raw) return;
    capture.buf += decode ? decodeEntities(raw) : raw;
  };

  /**
   * `depth` is where the element will sit once pushed — the push happens at the
   * end of the open-tag branch, so `stack.length` here is one short and using
   * it meant no capture ever ended: the channel title swallowed the whole feed
   * and, because structure handling is skipped inside a capture, not a single
   * item was recognised.
   */
  const startCapture = (sink: Sink, depth: number): void => {
    // Never nest: an element inside a captured one contributes its text to the
    // capture already running, which is what `textContent` does.
    if (!capture) capture = { sink, depth, buf: '' };
  };

  const endCapture = (): void => {
    if (!capture) return;
    const value = capture.buf.trim();
    const sink = capture.sink;
    capture = null;
    switch (sink) {
      case 'channel-title':
        if (!chTitle) chTitle = value;
        return;
      case 'channel-author':
        if (!chAuthor) chAuthor = value;
        return;
      case 'image-url':
        if (!imageUrl) imageUrl = value;
        return;
      default:
        break;
    }
    if (!item) return;
    switch (sink) {
      case 'item-title':
        if (!item.title) item.title = value;
        break;
      case 'item-guid':
        if (!item.guid) item.guid = value;
        break;
      case 'item-date':
        if (!item.date) item.date = value;
        break;
      case 'item-duration':
        // Last one wins, matching the DOM implementation's switch.
        item.durationMs = parseDuration(value);
        break;
      case 'item-notes':
        item.notes = value;
        break;
      case 'item-summary':
        if (!item.summary) item.summary = value;
        break;
      case 'item-season':
        item.season = parseInt(value, 10) || 0;
        break;
      case 'item-episode':
        item.episode = parseInt(value, 10) || 0;
        break;
    }
  };

  const finishImage = (): void => {
    const resolved = imageHref || imageUrl;
    if (resolved) {
      if (imageOwner === 'item' && item) item.art = resolved;
      else if (imageOwner === 'channel') chArt = resolved;
    }
    imageHref = '';
    imageUrl = '';
    imageDepth = -1;
    imageOwner = null;
  };

  const finishItem = (): void => {
    const draft = item;
    item = null;
    if (!draft) return;
    // https only: the CSP allows no other scheme for media, and an http
    // enclosure would be blocked as mixed content anyway.
    if (!/^https:\/\//i.test(draft.enclosure)) return;
    const description = draft.notes || draft.summary;
    const ep: ScannedEpisode = {
      trackId: draft.guid || draft.enclosure,
      trackName: draft.title,
      releaseDate: draft.date,
      episodeUrl: draft.enclosure,
      trackTimeMillis: draft.durationMs,
    };
    if (draft.art) ep.art = draft.art;
    if (description) ep.description = description;
    if (draft.season > 0) ep.season = draft.season;
    if (draft.episode > 0) ep.episode = draft.episode;
    if (draft.chaptersUrl) ep.chaptersUrl = draft.chaptersUrl;
    if (draft.transcripts.length) ep.transcripts = draft.transcripts;
    episodes.push(ep);
  };

  /** Pop to the outermost open element with this name; ignore if none. */
  const closeTo = (name: string): void => {
    let at = -1;
    for (let d = stack.length - 1; d >= 0; d--) {
      if (stack[d] === name) {
        at = d;
        break;
      }
    }
    if (at === -1) return; // stray close tag — a browser ignores it too
    while (stack.length > at) {
      const depth = stack.length; // depth of the element being popped
      stack.pop();
      if (capture && capture.depth >= depth) endCapture();
      if (imageDepth === depth) finishImage();
      if (itemDepth === depth) {
        finishItem();
        itemDepth = -1;
      }
      if (channelDepth === depth) channelDepth = -1;
    }
  };

  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      text(xml.slice(i), true);
      break;
    }
    if (lt > i) text(xml.slice(i, lt), true);

    // ── non-element constructs ──────────────────────────────────────
    if (xml.startsWith('<![CDATA[', lt)) {
      const close = xml.indexOf(']]>', lt + 9);
      const body = close === -1 ? xml.slice(lt + 9) : xml.slice(lt + 9, close);
      text(body, false); // CDATA is literal: no entity decoding
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const close = xml.indexOf('-->', lt + 4);
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const close = xml.indexOf('?>', lt + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      const close = xml.indexOf('>', lt + 2);
      i = close === -1 ? n : close + 1;
      continue;
    }

    // ── element ─────────────────────────────────────────────────────
    let p = lt + 1;
    const closing = xml[p] === '/';
    if (closing) p++;
    const nameStart = p;
    while (p < n && !isNameEnd(xml[p] as string)) p++;
    if (p === nameStart) {
      // A bare `<` in text. Keep it, as a parser in HTML mode would.
      text('<', false);
      i = lt + 1;
      continue;
    }
    const name = localName(xml.slice(nameStart, p));

    // Find the `>` that ends the tag, skipping quoted attribute values so a
    // `>` inside one cannot end it early.
    let gt = p;
    let quote = '';
    for (; gt < n; gt++) {
      const c = xml[gt] as string;
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
    }
    if (gt >= n) break; // truncated feed: nothing more to read
    const inner = xml.slice(p, gt);
    i = gt + 1;

    if (closing) {
      closeTo(name);
      continue;
    }

    const selfClosing = inner.trimEnd().endsWith('/') || VOID.has(name);
    const parent = stack.length ? stack[stack.length - 1] : '';
    const inChannel = channelDepth !== -1;
    const inItem = itemDepth !== -1;
    // Depth this element will occupy once pushed.
    const depth = stack.length + 1;
    const childOfChannel = inChannel && parent === 'channel' && depth === channelDepth + 1;
    const childOfItem = inItem && depth === itemDepth + 1;

    // Anything inside a running capture is markup to step over: its text is
    // already being collected, and it must not start structures of its own.
    if (!capture) {
      if (name === 'channel' && channelDepth === -1) {
        channelDepth = depth;
        sawChannel = true;
      } else if (name === 'item' && inChannel && !inItem) {
        itemDepth = depth;
        item = newItem();
      } else if (name === 'image' && (childOfChannel || childOfItem) && imageDepth === -1) {
        const attrs = readAttrs(inner);
        imageHref = attrs['href'] ?? '';
        imageUrl = '';
        imageOwner = childOfItem ? 'item' : 'channel';
        imageDepth = depth;
        // `<itunes:image href="…"/>` — nothing to wait for.
        if (selfClosing) finishImage();
      } else if (name === 'url' && imageDepth !== -1 && depth === imageDepth + 1) {
        startCapture('image-url', depth);
      } else if (childOfChannel && !inItem) {
        if (name === 'title') startCapture('channel-title', depth);
        else if (name === 'author') startCapture('channel-author', depth);
      } else if (childOfItem && item) {
        switch (name) {
          case 'title':
            startCapture('item-title', depth);
            break;
          case 'guid':
            startCapture('item-guid', depth);
            break;
          case 'pubdate':
            startCapture('item-date', depth);
            break;
          case 'duration':
            startCapture('item-duration', depth);
            break;
          case 'encoded':
            startCapture('item-notes', depth);
            break;
          case 'description':
          case 'summary':
            startCapture('item-summary', depth);
            break;
          case 'season':
            startCapture('item-season', depth);
            break;
          case 'episode':
            startCapture('item-episode', depth);
            break;
          case 'enclosure':
            item.enclosure = readAttrs(inner)['url'] ?? '';
            break;
          case 'chapters': {
            const url = httpsOnly(readAttrs(inner)['url']);
            if (url) item.chaptersUrl = url;
            break;
          }
          case 'transcript': {
            const attrs = readAttrs(inner);
            const url = httpsOnly(attrs['url']);
            if (url) {
              const t: ScannedTranscript = { url, type: attrs['type'] ?? '' };
              const lang = attrs['language'];
              if (lang) t.language = lang;
              item.transcripts.push(t);
            }
            break;
          }
        }
      }
    }

    if (!selfClosing) stack.push(name);
  }

  // A feed that ends mid-element still yields what it managed to say.
  while (stack.length) closeTo(stack[stack.length - 1] as string);
  if (capture) endCapture();
  if (item) finishItem();

  if (!sawChannel) throw new Error('invalid rss');

  return {
    title: chTitle || 'Podcast',
    author: chAuthor,
    art: chArt,
    episodes,
  };
}
