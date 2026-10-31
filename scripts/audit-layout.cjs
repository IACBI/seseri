#!/usr/bin/env node
/* Layout geometry audit.
 *
 * The playback dock once shipped with its animated frequency line drawn through
 * the transport buttons. Nothing in the unit suites or the smokes can see that:
 * it is two boxes that intersect, and the only way to know is to lay the page
 * out and measure. This does that, across the whole matrix of things that move
 * boxes around — viewport, theme, font-size setting, language (including the
 * longest strings and a right-to-left one) — on every view and on every dialog
 * reachable, with an episode playing so the dock is on screen.
 *
 *   node scripts/audit-layout.cjs                  # the full sweep
 *   node scripts/audit-layout.cjs --quick          # a representative slice
 *   node scripts/audit-layout.cjs --help           # every option
 *
 * What it reports, per snapshot (all measured, none eyeballed):
 *
 *   overlap     two boxes that intersect and are not nested in each other:
 *               interactive elements, text lines, icons/images, and painted
 *               leaf decorations (bars, dots, tracks) against any of those.
 *   clipped     content cut by an ancestor's overflow without an ellipsis or a
 *               line-clamp, controls cut off, a <select>/<input> whose text is
 *               wider than its box.
 *   outside     anything drawn past the viewport edge, and fixed chrome (dock,
 *               tab bar, toast, banner) that overlaps other chrome.
 *   hscroll     the page, or a scroll container, that scrolls sideways.
 *   target      interactive targets under 44x44 CSS px ("error" under 24, the
 *               WCAG 2.5.8 floor; "warn" between 24 and 44, the project rule).
 *   text-size   text rendered under 12px (SVG text is scaled by its viewBox).
 *   hidden      content that cannot be scrolled out from under the dock or the
 *               tab bar (the last item, with the view scrolled to the end).
 *
 * Findings are grouped by what they are (element structure, not text), so one
 * defect seen in 400 snapshots is one line with the conditions it occurs under.
 * Exit code is 1 when any "error" is left, 0 otherwise; `--strict` makes warns
 * count too.
 *
 * Deliberately not asserted: pixel values tied to this machine's fonts. Every
 * threshold is a CSS-pixel rule (44px, 24px, 12px), and fractional overlap
 * below 1px is rounding, not a collision.
 *
 * Not covered, because a headless Chromium cannot show it: a real notch's
 * curved corners, iOS Safari's collapsing toolbar, a screen reader, a system
 * font scale. Safe-area insets ARE emulated (CDP) for the phone viewports.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { launchOptions, makeWav, startServer, stopServer, waitServer } = require('./lib/harness.cjs');

// ── configuration ───────────────────────────────────────────────────

/** `touch` turns on touch emulation so `(pointer: coarse)` rules apply. */
const VIEWPORTS = [
  { name: '320x640', width: 320, height: 640, dpr: 1, touch: true, safe: [0, 0, 0, 0] },
  { name: '375x812@3', width: 375, height: 812, dpr: 3, touch: true, safe: [47, 0, 34, 0] },
  { name: '390x844@3', width: 390, height: 844, dpr: 3, touch: true, safe: [47, 0, 34, 0] },
  // Not in the brief's list, but the one phone orientation the others cannot
  // stand in for: 390px of height, and a notch on the side.
  { name: '844x390@3', width: 844, height: 390, dpr: 3, touch: true, safe: [0, 47, 21, 47] },
  { name: '768x1024', width: 768, height: 1024, dpr: 1, touch: true, safe: [0, 0, 0, 0] },
  { name: '1024x768', width: 1024, height: 768, dpr: 1, touch: false, safe: [0, 0, 0, 0] },
  { name: '1280x720', width: 1280, height: 720, dpr: 1, touch: false, safe: [0, 0, 0, 0] },
  { name: '1536x864@1.25', width: 1536, height: 864, dpr: 1.25, touch: false, safe: [0, 0, 0, 0] },
  { name: '1920x1080', width: 1920, height: 1080, dpr: 1, touch: false, safe: [0, 0, 0, 0] },
];

const THEMES = ['dark', 'light', 'oled'];
const FONTS = ['13px', '17px']; // the default, and the largest the setting offers
/**
 * tr is the default and en the fallback; ar is the right-to-left one. de has
 * the longest unbreakable words, fr the longest strings overall, ru the widest
 * glyphs. es and ja behave like these and are left to `--langs all`.
 */
const LANGS = ['tr', 'en', 'ar', 'de', 'fr', 'ru'];
const ALL_LANGS = ['tr', 'en', 'ar', 'de', 'fr', 'ru', 'es', 'ja'];

const QUICK = {
  viewports: ['320x640', '390x844@3', '844x390@3', '768x1024', '1280x720'],
  themes: ['dark', 'light'],
  fonts: ['13px', '17px'],
  langs: ['tr', 'ar', 'de'],
};

// ── command line ────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = { port: 5240, mode: 'dev', url: '', json: '', strict: false, quick: false, verbose: false, jobs: 3 };
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--quick') o.quick = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--shots') o.shots = next();
    else if (a === '--port') o.port = Number(next());
    else if (a === '--jobs') o.jobs = Math.max(1, Number(next()) || 1);
    else if (a === '--mode') o.mode = next();
    else if (a === '--url') o.url = next().replace(/\/+$/, '');
    else if (a === '--json') o.json = next();
    else if (a === '--viewports') o.viewports = list(next());
    else if (a === '--themes') o.themes = list(next());
    else if (a === '--fonts') o.fonts = list(next());
    else if (a === '--langs') {
      const v = next();
      o.langs = v === 'all' ? ALL_LANGS : list(v);
    }
    else if (a === '--views') o.views = list(next());
    else throw new Error(`unknown option ${a} (try --help)`);
  }
  return o;
}

const HELP = `audit-layout.cjs — measure the UI for overlaps, clipping, sideways scroll,
small targets and content hidden behind the dock.

  --quick               5 viewports x 2 themes x 2 fonts x 3 languages
  --viewports a,b       names from: ${VIEWPORTS.map((v) => v.name).join(', ')}
  --themes a,b          dark, light, oled
  --fonts a,b           13px, 17px (any value the Font size setting accepts)
  --langs a,b | all     tr, en, ar, de, fr, ru, es, ja
  --views a,b           only these scenarios (names are printed in the header)
  --jobs N              configurations measured side by side (default 3)
  --port N              dev server port (default 5240)
  --mode dev|preview    which vite to start (preview needs a build in dist/)
  --url http://host:N   audit a server that is already running instead
  --json FILE           write every raw finding to FILE
  --shots DIR           save a screenshot of every snapshot into DIR (for triage)
  --strict              exit 1 on warnings as well as errors
  --verbose             print each snapshot as it is taken

The browser is found by scripts/lib/harness.cjs; SESERI_BROWSER overrides it.`;

// ── fixtures ────────────────────────────────────────────────────────

const FEED = 'https://feeds.example.com/audit.xml';
const FEED_ID = 'rss:' + FEED;
const SHOW = 'Design Notes with a Rather Long Show Title: The Podcast';
const AUTHOR = 'Studio FM and the Very Long Collective Name Ltd.';
const WAV = makeWav(120);

/** Titles chosen to break layouts: ordinary, long, unbreakable, and non-Latin. */
const TITLES = [
  'The grid is a promise you make to the reader',
  'Typography as interface',
  'Why the longest episode title in the whole archive keeps going and going: a conversation about naming things, truncation, ellipses and the people who have to design around them',
  'Supercalifragilisticexpialidocious_Supercalifragilisticexpialidocious_Supercalifragilisticexpialidocious',
  'Çok uzun bir Türkçe bölüm başlığı: şımarık öğrencilerin ğüşiöç yolculuğu ve bitmeyen cümleler',
  '#42',
  'Episode 7 — with an em dash and a trailing question mark?',
];
const CHAPTERS = {
  version: '1.2.0',
  chapters: [
    { startTime: 0, title: 'Cold open' },
    { startTime: 30, title: 'A chapter whose title is considerably longer than the others, to see how the list wraps it' },
    { startTime: 60, title: 'Credits' },
  ],
};
const VTT = `WEBVTT

00:00:00.000 --> 00:00:05.000
The first thing that is said, which is long enough to need a second line on a narrow screen.

00:00:05.000 --> 00:00:12.000
The second thing.
`;

function feedXml() {
  const items = Array.from({ length: 24 }, (_, i) => {
    const title = TITLES[i % TITLES.length] + (i >= TITLES.length ? ` (${i + 1})` : '');
    const day = new Date(Date.UTC(2026, 8, 28 - i, 9)).toUTCString();
    return `<item>
      <title>${title.replace(/&/g, '&amp;')}</title>
      <guid>audit-ep-${i + 1}</guid>
      <pubDate>${day}</pubDate>
      <enclosure url="https://cdn.example.com/audit/${i + 1}.wav" type="audio/wav"/>
      <itunes:duration>${i % 3 === 0 ? 120 : 3725}</itunes:duration>
      <podcast:chapters url="https://cdn.example.com/audit/chapters.json" type="application/json+chapters"/>
      <podcast:transcript url="https://cdn.example.com/audit/t.vtt" type="text/vtt" language="en"/>
      <description><![CDATA[<p>Show notes with <a href="https://example.com/a/very/long/path/that/keeps/going/and/going/and/going/index.html">a link</a> and a bare URL https://example.com/a/very/long/path/that/keeps/going/and/going/and/going/and/going/and/going/index.html in the text.</p><ul><li>One</li><li>Two, which is a longer item that has to wrap onto a second line on a phone</li></ul>]]></description>
    </item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel><title>${SHOW}</title><itunes:author>${AUTHOR}</itunes:author>${items}</channel></rss>`;
}

const SEARCH_RESULTS = {
  resultCount: 4,
  results: [
    { wrapperType: 'track', kind: 'podcast', collectionId: 900001, collectionName: SHOW, artistName: AUTHOR, artworkUrl100: '', feedUrl: FEED, trackCount: 240 },
    { wrapperType: 'track', kind: 'podcast', collectionId: 900002, collectionName: 'Kısa', artistName: 'Yazar', artworkUrl100: '', trackCount: 3 },
    { wrapperType: 'track', kind: 'podcast', collectionId: 900003, collectionName: 'Supercalifragilisticexpialidocious_Supercalifragilisticexpialidocious', artistName: 'Unbroken', artworkUrl100: '', trackCount: 12 },
    { wrapperType: 'track', kind: 'podcast', collectionId: 900004, collectionName: 'The Daily', artistName: 'The New York Times', artworkUrl100: '', trackCount: 2676 },
  ],
};

/** What the page's own storage holds before the app first runs. */
function seedFor({ theme, font, lang }) {
  const subs = [
    { id: FEED_ID, name: SHOW, artist: AUTHOR, art: '' },
    { id: 'rss:https://feeds.example.com/two.xml', name: 'Kısa', artist: '', art: '' },
    { id: 'rss:https://feeds.example.com/three.xml', name: 'Süpercalifragilistikeksiyalidoşıs Haftalık Bülten', artist: 'Yazar Adı', art: '' },
    { id: 'rss:https://feeds.example.com/four.xml', name: 'The Daily', artist: 'The New York Times', art: '' },
    { id: 'rss:https://feeds.example.com/five.xml', name: 'Radiolab', artist: 'WNYC Studios', art: '' },
  ];
  const queue = [3, 4, 5, 2].map((n) => ({
    feedId: FEED_ID,
    trackId: `audit-ep-${n}`,
    title: TITLES[(n - 1) % TITLES.length],
    feedName: SHOW,
  }));
  const inbox = [3, 4].map((n) => ({
    feedId: FEED_ID,
    trackId: `audit-ep-${n}`,
    title: TITLES[(n - 1) % TITLES.length],
    feedName: SHOW,
    releaseDate: '2026-09-20T09:00:00Z',
    trackTimeMillis: 3725000,
    art: '',
    foundAt: Date.now(),
  }));
  return {
    pp_settings: { theme, fontSize: font, lang, allowPublicProxies: true },
    pp_favs: subs,
    pp_queue: queue,
    pp_inbox: inbox,
  };
}

// ── the in-page analyser ────────────────────────────────────────────
//
// Runs inside the page, so it cannot close over anything in this file; it gets
// everything through `cfg` and answers with plain data.

/* eslint-disable */
function analyze(cfg) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const roots = (cfg.roots && cfg.roots.length ? cfg.roots : ['body'])
    .map((s) => document.querySelector(s))
    .filter(Boolean);
  if (!roots.length) return { error: 'no root matched ' + JSON.stringify(cfg.roots) };
  if (!document.body.classList.contains('has-track')) return { error: 'no track is loaded: the dock is not on screen' };

  const findings = [];
  const ignored = {};
  const skip = (why) => {
    ignored[why] = (ignored[why] || 0) + 1;
  };
  const add = (f) => findings.push(f);

  // ── style and geometry helpers ───────────────────────────────────
  const csMap = new WeakMap();
  const cs = (el) => {
    let s = csMap.get(el);
    if (!s) csMap.set(el, (s = getComputedStyle(el)));
    return s;
  };
  const opMap = new WeakMap();
  const effOpacity = (el) => {
    if (!el || el === document.documentElement.parentNode) return 1;
    let v = opMap.get(el);
    if (v === undefined) {
      v = parseFloat(cs(el).opacity) * (el.parentElement ? effOpacity(el.parentElement) : 1);
      opMap.set(el, v);
    }
    return v;
  };
  /** Inside a closed <details>, anything but its <summary> is not on screen. */
  const closedDetails = (el) => {
    for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
      if (d.open) continue;
      const summary = d.querySelector(':scope > summary');
      if (!(summary && summary.contains(el))) return true;
    }
    return false;
  };
  const isShown = (el) => {
    if (!el.getClientRects().length) return false;
    if (cs(el).visibility !== 'visible') return false;
    if (closedDetails(el)) return false;
    return effOpacity(el) > 0.05;
  };
  const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  const W = (b) => b.r - b.l;
  const H = (b) => b.b - b.t;
  const area = (b) => Math.max(0, W(b)) * Math.max(0, H(b));
  const meet = (a, b) => ({
    l: Math.max(a.l, b.l),
    t: Math.max(a.t, b.t),
    r: Math.min(a.r, b.r),
    b: Math.min(a.b, b.b),
  });
  const round = (n) => Math.round(n * 10) / 10;

  const SKIP_CLASS = /^(open|show|active|selected|playing|queued|done|working|armed|view-enter|is-|has-)/;
  /** Structure only (no text), so one defect groups across languages. */
  const sig = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = [...el.classList].filter((c) => !SKIP_CLASS.test(c)).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  };
  const key = (el) => {
    const p = el.parentElement;
    return (p && p !== document.body ? sig(p) + ' > ' : '') + sig(el);
  };
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > 24 ? t.slice(0, 23) + '…' : t;
  };

  // ── containing blocks and clipping ──────────────────────────────
  const makesCB = (s) =>
    s.transform !== 'none' ||
    s.perspective !== 'none' ||
    s.filter !== 'none' ||
    s.backdropFilter !== 'none' ||
    /transform|perspective|filter/.test(s.willChange) ||
    /paint|layout|strict|content/.test(s.contain);
  const cbOf = (el) => {
    const s = cs(el);
    if (s.position === 'fixed') {
      for (let n = el.parentElement; n; n = n.parentElement) if (makesCB(cs(n))) return n;
      return null;
    }
    if (s.position === 'absolute') {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const ns = cs(n);
        if (ns.position !== 'static' || makesCB(ns)) return n;
      }
      return null;
    }
    return el.parentElement;
  };
  /**
   * What is actually drawn of `raw`, two ways:
   *   vis   cut by every clipping ancestor, nested scrollers included — what is
   *         on screen, which is what can collide with something else;
   *   hard  cut only by overflow:hidden/clip — what is lost for good, because
   *         the content of a scroller is merely out of sight, not unreachable.
   * The page's own scrollers (.view, the sheet) clip nothing: below the fold is
   * not clipped, and once the chain has passed through one, outer clips are moot.
   * `selfToo` is for text, which its own element's overflow cuts.
   */
  const PAGE_SCROLLER = '.view, .np-sheet';
  const clipOf = (el, raw, selfToo) => {
    let vis = { ...raw };
    let hard = { ...raw };
    let done = false;
    const by = [];
    for (let n = selfToo ? el : cbOf(el); n && n !== document.documentElement; n = cbOf(n)) {
      const s = cs(n);
      const ox = s.overflowX;
      const oy = s.overflowY;
      const page = n.matches(PAGE_SCROLLER);
      const hx = ox === 'hidden' || ox === 'clip';
      const hy = oy === 'hidden' || oy === 'clip';
      const sx = !page && (ox === 'auto' || ox === 'scroll');
      const sy = !page && (oy === 'auto' || oy === 'scroll');
      if (!done && (hx || hy || sx || sy)) {
        const b = n.getBoundingClientRect();
        const l = b.left + n.clientLeft;
        const t = b.top + n.clientTop;
        const rect = (x, y) => ({
          l: x ? l : -Infinity,
          r: x ? l + n.clientWidth : Infinity,
          t: y ? t : -Infinity,
          b: y ? t + n.clientHeight : Infinity,
        });
        vis = meet(vis, rect(hx || sx, hy || sy));
        if (hx || hy) {
          hard = meet(hard, rect(hx, hy));
          by.push(n);
        }
      }
      if (page) done = true;
    }
    return { vis, hard, by };
  };

  // Layers: things that stack on top of the page rather than share its flow.
  const layerMap = new WeakMap();
  const layerOf = (el) => {
    if (!el || el === document.documentElement) return document.documentElement;
    let v = layerMap.get(el);
    if (v) return v;
    const s = cs(el);
    const own =
      s.position === 'fixed' ||
      s.position === 'sticky' ||
      el.matches('dialog[open], [role=listbox], .toast-host');
    v = own ? el : layerOf(el.parentElement);
    layerMap.set(el, v);
    return v;
  };

  // ── gather ──────────────────────────────────────────────────────
  const INTERACTIVE =
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=slider], ' +
    '[role=tab], [role=option], [role=switch], [role=checkbox], [role=link], [contenteditable=""], ' +
    '[contenteditable=true], [tabindex]:not([tabindex="-1"])';
  const NO_TEXT = new Set(['SCRIPT', 'STYLE', 'OPTION', 'OPTGROUP', 'TITLE', 'TEMPLATE', 'TEXTAREA', 'NOSCRIPT']);

  const items = [];
  const seen = { interactive: new Set(), media: new Set(), decor: new Set(), text: new Set() };
  const push = (kind, el, raw) => {
    if (seen[kind].has(el)) return;
    seen[kind].add(el);
    const { vis, hard, by } = clipOf(el, raw, kind === 'text');
    items.push({ kind, el, raw, vis, hard, by, layer: layerOf(el) });
  };

  const paintAlpha = (c) => {
    if (!c || c === 'transparent') return 0;
    const slash = c.lastIndexOf('/');
    if (slash > -1) return parseFloat(c.slice(slash + 1)) || 0;
    const m = c.match(/^rgba\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',');
      return p.length > 3 ? parseFloat(p[3]) : 1;
    }
    return c.startsWith('rgb') || c.startsWith('color') ? 1 : 0;
  };
  const painted = (s) =>
    paintAlpha(s.backgroundColor) > 0.03 ||
    s.backgroundImage !== 'none' ||
    (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none' && paintAlpha(s.borderTopColor) > 0.03) ||
    s.boxShadow !== 'none';

  for (const root of roots) {
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
      if (NO_TEXT.has(el.tagName) && el.tagName !== 'TEXTAREA') continue;
      if (el.closest('[inert]')) continue;
      const shown = isShown(el);
      // A native checkbox is drawn as a track beside it and clicked through its
      // label; the input itself is invisible. The label is the real target.
      if (!shown) {
        if (el.matches('input[type=checkbox], input[type=radio]')) {
          const lab = el.closest('label');
          if (lab && isShown(lab)) push('interactive', lab, box(lab.getBoundingClientRect()));
        }
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) continue;
      const isSvgPart = el instanceof SVGElement && el.tagName !== 'svg';
      if (isSvgPart) continue;
      const interactive =
        el.matches(INTERACTIVE) ||
        // Click handlers without a role: the dock's title area, a collapsed rail.
        (cs(el).cursor === 'pointer' && (!el.parentElement || cs(el.parentElement).cursor !== 'pointer'));
      if (interactive) push('interactive', el, box(r));
      if (el.tagName === 'IMG' || el.tagName === 'CANVAS' || el.tagName === 'VIDEO' || el.tagName === 'svg') {
        if (!(el.tagName === 'svg' && el.parentElement && el.parentElement.closest('svg'))) {
          push('media', el, box(r));
        }
      } else if (
        !interactive &&
        el.children.length === 0 &&
        !(el.textContent || '').trim() &&
        r.width > 0 &&
        r.height > 0 &&
        painted(cs(el))
      ) {
        push('decor', el, box(r));
      }
    }
    // text lines: one box per element that owns text nodes
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const byOwner = new Map();
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const owner = n.parentElement;
      if (!owner || NO_TEXT.has(owner.tagName) || owner.closest('[inert], select, option')) continue;
      if (!isShown(owner)) continue;
      range.selectNodeContents(n);
      let u = null;
      for (const q of range.getClientRects()) {
        if (q.width <= 0 || q.height <= 0) continue;
        const b = box(q);
        u = u ? { l: Math.min(u.l, b.l), t: Math.min(u.t, b.t), r: Math.max(u.r, b.r), b: Math.max(u.b, b.b) } : b;
      }
      if (!u) continue;
      const prev = byOwner.get(owner);
      byOwner.set(
        owner,
        prev
          ? { l: Math.min(prev.l, u.l), t: Math.min(prev.t, u.t), r: Math.max(prev.r, u.r), b: Math.max(prev.b, u.b) }
          : u,
      );
    }
    for (const [owner, raw] of byOwner) push('text', owner, raw);
  }

  const inCross = (el) => (cfg.cross || []).some((s) => el.closest(s));
  const flow = document.documentElement;

  // ── 1. overlaps ─────────────────────────────────────────────────
  const KIND = { interactive: 'control', text: 'text', media: 'icon/image', decor: 'decoration' };
  /**
   * Overlaps that are the design, each with the reason. Everything else that
   * intersects is reported. Counted in the "Skipped on purpose" block.
   */
  const INTENDED = [
    {
      a: '.np-queue-badge',
      b: 'svg',
      why: 'queue count badge pinned to the corner of its own icon',
    },
    {
      a: '.signal-scrub',
      b: '.np-times *',
      why: 'time labels tuck into the scrubber\'s own bottom padding (explicit negative margin); the bars end 12px above them',
    },
  ];
  const intended = (x, y) =>
    INTENDED.find((r) => (x.matches(r.a) && y.matches(r.b)) || (y.matches(r.a) && x.matches(r.b)));
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (area(a.vis) <= 0) continue;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (area(b.vis) <= 0) continue;
      // Layers only meet where an overlay is allowed to sit over the other
      // layer: a toast over the dock, never over a row scrolled beneath it.
      const reaches = (x, y) => inCross(x.el) && (cfg.crossFlow || y.layer !== flow);
      const crossed = a.layer !== b.layer && (reaches(a, b) || reaches(b, a));
      if (a.layer !== b.layer && !crossed) continue;
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const m = meet(a.vis, b.vis);
      if (W(m) <= 1 || H(m) <= 1) continue;
      if (a.kind === 'decor' && b.kind === 'decor') {
        skip('decoration over decoration (waveform base/fill, track and its fill): pairs');
        continue;
      }
      // A toast is a transient overlay on top of the page by design; it only
      // matters when it lands on something the listener has to hit.
      if (crossed && !((a.kind === 'interactive' && inCross(b.el)) || (b.kind === 'interactive' && inCross(a.el)))) {
        skip('transient overlay (toast/banner) over non-interactive content');
        continue;
      }
      const ok = intended(a.el, b.el);
      if (ok) {
        skip('intended overlap: ' + ok.why);
        continue;
      }
      add({
        kind: 'overlap',
        severity: 'error',
        key: [key(a.el), key(b.el)].sort().join('  ×  '),
        text: `${KIND[a.kind]} ${key(a.el)} "${label(a.el)}"  ×  ${KIND[b.kind]} ${key(b.el)} "${label(b.el)}"`,
        measure: `${round(W(m))}x${round(H(m))}px`,
      });
    }
  }

  // ── 2. clipped content ──────────────────────────────────────────
  /**
   * Which cuts are the design: an ellipsis shortens one line sideways, a
   * line-clamp ends a paragraph downward, the marquee drifts the rest into view.
   */
  const intendedClip = (it) => {
    for (let n = it.el; n; n = n.parentElement) {
      const s = cs(n);
      if (n.classList && n.classList.contains('marquee')) return { why: 'marquee', x: true, y: true };
      // text-overflow only reaches a block container's own line boxes: on a
      // flex or grid container the text is an anonymous item, which is cut
      // with no ellipsis whatever the property says.
      if (
        s.textOverflow === 'ellipsis' &&
        /nowrap|pre\b/.test(s.whiteSpace) &&
        (s.overflowX === 'hidden' || s.overflowX === 'clip') &&
        !/flex|grid/.test(s.display)
      ) {
        return { why: 'ellipsis', x: true, y: false };
      }
      const lc = s.getPropertyValue('-webkit-line-clamp');
      if (lc && lc !== 'none') return { why: 'line-clamp', x: false, y: true };
      if (it.by.includes(n)) break;
    }
    return null;
  };
  for (const it of items) {
    if (it.kind === 'decor') continue;
    const full = area(it.raw);
    if (full <= 0) continue;
    const lostX = W(it.raw) - W(it.hard);
    const lostY = H(it.raw) - H(it.hard);
    if (lostX <= 1 && lostY <= 1) continue;
    const kept = area(it.hard) / full;
    if (it.kind === 'text') {
      const d = intendedClip(it);
      if (d && (lostX <= 1 || d.x) && (lostY <= 1 || d.y)) {
        skip('text cut with ' + d.why + ' (the design)');
        continue;
      }
    }
    if (kept >= 0.999) continue;
    add({
      kind: 'clipped',
      severity: 'error',
      key: `${it.kind}|${key(it.el)}|${it.by.map(sig).join('<')}`,
      text: `${KIND[it.kind]} ${key(it.el)} "${label(it.el)}" is cut by ${it.by.map(sig).join(' / ') || 'its container'}`,
      measure: `${Math.round((1 - kept) * 100)}% hidden (${round(Math.max(0, lostX))}px across, ${round(Math.max(0, lostY))}px down)`,
    });
  }

  // <select>/<input> text wider than its box: nothing in the DOM reports it.
  const ctx2d = document.createElement('canvas').getContext('2d');
  const widthOf = (str, s) => {
    ctx2d.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    return ctx2d.measureText(str).width + (parseFloat(s.letterSpacing) || 0) * str.length;
  };
  for (const it of items) {
    if (it.kind !== 'interactive') continue;
    const el = it.el;
    const s = cs(el);
    let str = '';
    let what = '';
    if (el.tagName === 'SELECT') {
      str = (el.selectedOptions[0] || {}).textContent || '';
      what = 'selected option';
    } else if (el.tagName === 'INPUT' && /^(text|search|email|url|tel|number|password)$/.test(el.type || 'text')) {
      str = el.value || el.placeholder || '';
      what = el.value ? 'value' : 'placeholder';
    } else continue;
    if (!str) continue;
    const room = el.clientWidth - (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0);
    const need = widthOf(str, s);
    if (need > room + 1.5) {
      add({
        kind: 'clipped',
        severity: 'warn',
        key: `field|${key(el)}`,
        text: `${el.tagName.toLowerCase()} ${key(el)}: ${what} "${str.length > 30 ? str.slice(0, 29) + '…' : str}" is wider than its box`,
        measure: `needs ${round(need)}px, has ${round(room)}px`,
      });
    }
  }

  // ── 3. outside the viewport, chrome against chrome ──────────────
  for (const it of items) {
    if (it.kind === 'decor') continue;
    // A fixed layer that scrolls itself (the Now Playing sheet) may run past the
    // bottom: what is below is reachable. Only a layer that cannot scroll has
    // to fit inside the viewport.
    const fixedLayer =
      it.layer !== flow &&
      cs(it.layer).position === 'fixed' &&
      !/auto|scroll/.test(cs(it.layer).overflowY);
    const v = it.vis;
    if (area(v) <= 0) continue;
    const sideways = v.l < -0.5 || v.r > vw + 0.5;
    const vertical = (fixedLayer || cfg.fullyVisible) && (v.t < -0.5 || v.b > vh + 0.5);
    if (!sideways && !vertical) continue;
    // A dropdown lives inside the scrolling page: past the bottom edge it is
    // still reachable by scrolling, which makes it a nuisance rather than a loss.
    const popup = !sideways && it.layer !== flow && it.layer.matches('[role=listbox]');
    add({
      kind: 'outside',
      severity: popup ? 'warn' : 'error',
      key: `${it.kind}|${key(it.el)}|${sideways ? 'x' : 'y'}`,
      text: `${KIND[it.kind]} ${key(it.el)} "${label(it.el)}" is drawn past the ${sideways ? 'side' : 'top/bottom'} of the viewport`,
      measure: `x ${round(v.l)}..${round(v.r)} of ${vw}, y ${round(v.t)}..${round(v.b)} of ${vh}`,
    });
  }
  const chromeSel = ['.mini-player', '.app-nav', '.offline-banner', '.toast-host .toast'];
  const chrome = [];
  if (roots.includes(document.body)) {
    for (const sel of chromeSel) {
      for (const el of document.querySelectorAll(sel)) {
        if (isShown(el)) chrome.push({ el, b: box(el.getBoundingClientRect()) });
      }
    }
  }
  for (let i = 0; i < chrome.length; i++) {
    for (let j = i + 1; j < chrome.length; j++) {
      const a = chrome[i];
      const b = chrome[j];
      const m = meet(a.b, b.b);
      if (W(m) <= 0.5 || H(m) <= 0.5) continue;
      // Toasts are meant to sit over the page.
      if (a.el.matches('.toast') || b.el.matches('.toast')) continue;
      add({
        kind: 'outside',
        severity: 'error',
        key: `chrome|${key(a.el)}|${key(b.el)}`,
        text: `fixed ${key(a.el)} overlaps fixed ${key(b.el)}`,
        measure: `${round(W(m))}x${round(H(m))}px`,
      });
    }
  }

  // ── 4. sideways scroll ──────────────────────────────────────────
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1) {
    add({
      kind: 'hscroll',
      severity: 'error',
      key: 'page',
      text: 'the page scrolls sideways',
      measure: `scrollWidth ${Math.max(de.scrollWidth, document.body.scrollWidth)} > ${vw}`,
    });
  }
  for (const el of document.querySelectorAll('body *')) {
    const s = cs(el);
    if (s.overflowX !== 'auto' && s.overflowX !== 'scroll') continue;
    if (!isShown(el) || el.scrollWidth <= el.clientWidth + 1) continue;
    // Whoever it belongs to must be on screen right now.
    if (!roots.some((r) => r.contains(el) || el.contains(r))) continue;
    // A strip that hides its own scrollbar is a carousel on purpose (the
    // episode filter chips); sideways scroll in anything else is a leak.
    if (!el.matches(PAGE_SCROLLER) && s.scrollbarWidth === 'none') {
      skip('deliberate horizontal carousel (overflow-x:auto, scrollbar-width:none)');
      continue;
    }
    add({
      kind: 'hscroll',
      severity: 'error',
      key: key(el),
      text: `${key(el)} scrolls sideways`,
      measure: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
    });
  }

  // ── 5. targets and text size ────────────────────────────────────
  /** A pseudo-element that is a deliberate bigger hit area (inset:-8px etc). */
  const hitArea = (el, r) => {
    let u = box(r);
    for (const pseudo of ['::before', '::after']) {
      const p = getComputedStyle(el, pseudo);
      if (p.content === 'none' || p.position !== 'absolute' || p.pointerEvents === 'none') continue;
      const hw = parseFloat(p.width);
      const hh = parseFloat(p.height);
      const top = parseFloat(p.top);
      const left = parseFloat(p.left);
      if (![hw, hh, top, left].every(Number.isFinite)) continue;
      const bl = r.left + el.clientLeft + left;
      const bt = r.top + el.clientTop + top;
      u = { l: Math.min(u.l, bl), t: Math.min(u.t, bt), r: Math.max(u.r, bl + hw), b: Math.max(u.b, bt + hh) };
    }
    return u;
  };
  for (const it of items) {
    if (it.kind !== 'interactive') continue;
    const el = it.el;
    const s = cs(el);
    // WCAG 2.5.8 exempts a link that sits inside a sentence.
    if (el.tagName === 'A' && s.display === 'inline') {
      skip('inline text link (WCAG 2.5.8 exception)');
      continue;
    }
    if (area(it.vis) <= 0) continue;
    // The episode row is the target: a tap anywhere on it opens the episode
    // (one delegated listener in podcast.ts), and `.ep-open` is the row's
    // keyboard stop. The row itself is measured as its own item.
    if (el.matches('.ep-open') && el.closest('.ep-item')) {
      skip('.ep-open button (its whole .ep-item row is the click target, measured separately)');
      continue;
    }
    const u = hitArea(el, el.getBoundingClientRect());
    const w = W(u);
    const h = H(u);
    if (w >= 43.5 && h >= 43.5) continue;
    add({
      kind: 'target',
      severity: Math.min(w, h) < 24 ? 'error' : 'warn',
      key: key(el),
      text: `${key(el)} "${label(el)}" is a small target`,
      measure: `${round(w)}x${round(h)}px`,
    });
  }
  for (const it of items) {
    if (it.kind !== 'text') continue;
    let fs = parseFloat(cs(it.el).fontSize);
    if (it.el instanceof SVGElement) {
      const m = it.el.getScreenCTM && it.el.getScreenCTM();
      if (m) fs *= Math.hypot(m.a, m.b);
    }
    if (fs >= 11.95) continue;
    // Digits drawn inside an icon (the skip buttons' "15"/"30") scale with the
    // icon's viewBox and are repeated, in words, by the button's aria-label.
    // They are glyph, not copy: a warning, never a failure.
    const glyph = it.el instanceof SVGElement;
    add({
      kind: 'text-size',
      severity: glyph ? 'warn' : 'error',
      key: key(it.el),
      text: `${glyph ? 'icon glyph' : 'text'} ${key(it.el)} "${label(it.el)}" renders under 12px`,
      measure: `${round(fs)}px`,
    });
  }

  return { findings, ignored, count: items.length };
}

/**
 * Scroll `scroller` to its end and report content still under fixed chrome.
 * Separate from `analyze` because it moves the page.
 */
async function bottomReach(cfg) {
  const sc = document.querySelector(cfg.scroller);
  if (!sc) return { error: 'no scroller ' + cfg.scroller };
  sc.scrollTop = sc.scrollHeight;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const out = [];
  const sr = sc.getBoundingClientRect();
  const shown = (el) => el.getClientRects().length && getComputedStyle(el).visibility === 'visible';
  const occluders = [];
  // The sheet is stacked above the dock and the tab bar, so neither covers it.
  for (const sel of cfg.sheet ? [] : ['.mini-player', '.app-nav']) {
    const el = document.querySelector(sel);
    if (!el || !shown(el) || getComputedStyle(el).position !== 'fixed') continue;
    const b = el.getBoundingClientRect();
    // Only what actually sits over this scroller's bottom edge counts.
    if (b.right > sr.left && b.left < sr.right && b.top < sr.bottom && b.bottom > sr.top) {
      occluders.push({ sel, top: b.top });
    }
  }
  const limit = occluders.length ? Math.min(...occluders.map((o) => o.top)) : sr.bottom;
  const SKIP = 'script,style,template,[hidden]';
  let last = null;
  let lastBottom = -Infinity;
  for (const el of sc.querySelectorAll('*')) {
    if (el.matches(SKIP) || el.closest('[hidden]') || !el.getClientRects().length) continue;
    // Inside a closed <details> only the summary is on screen.
    const details = el.closest('details:not([open])');
    if (details) {
      const summary = details.querySelector(':scope > summary');
      if (!(summary && summary.contains(el))) continue;
    }
    const s = getComputedStyle(el);
    if (s.visibility !== 'visible' || s.position === 'fixed') continue;
    // Leaves only: a container's box includes its own padding, which is air.
    const leaf = !el.children.length || [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (!leaf) continue;
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0) continue;
    // Content inside a box with its own scrolling (show notes, the transcript)
    // that lies past that box is in its own scroller, not under the dock.
    let inner = false;
    for (let n = el.parentElement; n && n !== sc; n = n.parentElement) {
      if (getComputedStyle(n).overflowY === 'visible') continue;
      const b = n.getBoundingClientRect();
      if (r.bottom > b.bottom + 0.5 || r.top < b.top - 0.5) inner = true;
    }
    if (inner) continue;
    if (r.bottom > lastBottom) {
      lastBottom = r.bottom;
      last = el;
    }
  }
  if (!last) return { rows: [] };
  const sig = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = [...el.classList].slice(0, 2);
    return s + (c.length ? '.' + c.join('.') : '');
  };
  const behind = lastBottom - limit;
  return {
    last: sig(last),
    lastBottom,
    limit,
    by: occluders.map((o) => o.sel).join(' + ') || 'the view edge',
    behind,
    scrollable: sc.scrollHeight > sc.clientHeight + 1,
  };
}
/* eslint-enable */

// ── scenarios ───────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(page, ms = 100) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await sleep(ms);
}

async function showView(page, nav, view) {
  await page.evaluate((id) => document.getElementById(id).click(), nav);
  await page.waitForFunction((v) => !document.getElementById('view-' + v).hidden, { timeout: 8000 }, view);
  await settle(page);
}

async function closeTransient(page) {
  const hadDialog = await page.evaluate(() => !!document.querySelector('dialog[open]'));
  await page.evaluate(() => {
    document.querySelectorAll('.toast').forEach((n) => n.remove());
    // Order matters: dialogs sit over everything, the sheet over the page.
    for (const d of document.querySelectorAll('dialog[open]')) {
      d.dispatchEvent(new Event('cancel', { cancelable: true }));
    }
    document.querySelectorAll('.lang-menu-pop:not([hidden])').forEach((p) => {
      p.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    if (document.getElementById('npSheet')?.classList.contains('open')) {
      document.getElementById('npClose')?.click();
    }
  });
  // A dialog closes 180ms after it is dismissed, and the next scenario's first
  // click would land on a page that is still inert behind it.
  await sleep(hadDialog ? 260 : 70);
}

async function sheetOpen(page) {
  const open = await page.evaluate(() => document.getElementById('npSheet').classList.contains('open'));
  if (open) return;
  await page.evaluate(() => document.getElementById('miniExpand').click());
  await page.waitForFunction(() => document.getElementById('npSheet').classList.contains('open'), { timeout: 8000 });
  await settle(page);
}

async function openPodcast(page) {
  const there = await page.evaluate(() => !document.getElementById('view-podcast').hidden);
  if (there) return;
  await showView(page, 'navHome', 'home');
  await page.waitForSelector('.home-sub', { timeout: 8000 });
  await page.evaluate(() => document.querySelector('.home-sub').click());
  await page.waitForSelector('.ep-item', { timeout: 15000 });
  await settle(page, 260);
}

/**
 * Each scenario brings the UI to a state and says what to measure there.
 * `roots` are CSS selectors for what is on top; `scroller` is reachable
 * content to test against the dock; `cross` are overlays that are allowed to
 * sit over the page but not over a control.
 */
const SCENARIOS = [
  {
    name: 'home',
    async run(page) {
      await showView(page, 'navHome', 'home');
      return { roots: ['body'], scroller: '#view-home' };
    },
  },
  {
    name: 'home-offline',
    async run(page) {
      await showView(page, 'navHome', 'home');
      await page.setOfflineMode(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await sleep(150);
      // The banner is in the page's flow, so the ordinary overlap rules apply
      // to it: it must push the page down rather than sit on top of it.
      return {
        roots: ['body'],
        after: () =>
          page.setOfflineMode(false).then(() => page.evaluate(() => window.dispatchEvent(new Event('online')))),
      };
    },
  },
  {
    name: 'home-langmenu',
    async run(page) {
      await showView(page, 'navHome', 'home');
      await page.evaluate(() => document.querySelector('#view-home .lang-menu-btn').click());
      await sleep(150);
      return { roots: ['#view-home .lang-menu-pop'], fullyVisible: true };
    },
  },
  {
    name: 'search',
    async run(page) {
      await showView(page, 'navSearch', 'search');
      return { roots: ['body'], scroller: '#view-search' };
    },
  },
  {
    name: 'search-results',
    async run(page) {
      await showView(page, 'navSearch', 'search');
      await page.evaluate(() => {
        const i = document.getElementById('searchInput');
        i.value = 'design';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('searchBtn').click();
      });
      await page.waitForSelector('#resultsList .row', { timeout: 10000 });
      await settle(page);
      return { roots: ['body'], scroller: '#view-search' };
    },
  },
  {
    name: 'library',
    async run(page) {
      await showView(page, 'navLibrary', 'library');
      await page.evaluate(() => document.getElementById('lib-tab-subs').click());
      await settle(page);
      return { roots: ['body'], scroller: '#view-library' };
    },
  },
  {
    name: 'library-downloads',
    async run(page) {
      await showView(page, 'navLibrary', 'library');
      await page.evaluate(() => document.getElementById('lib-tab-downloads').click());
      await settle(page);
      return { roots: ['body'], scroller: '#view-library' };
    },
  },
  {
    name: 'library-confirm',
    async run(page) {
      await showView(page, 'navLibrary', 'library');
      await page.evaluate(() => document.getElementById('lib-tab-subs').click());
      await settle(page);
      await page.evaluate(() => document.querySelector('#lib-panel-subs .icon-btn.faved').click());
      await page.waitForSelector('dialog.confirm-dialog[open].open', { timeout: 5000 });
      return { roots: ['dialog.confirm-dialog[open]'], fullyVisible: true };
    },
  },
  {
    name: 'podcast',
    async run(page) {
      await openPodcast(page);
      return { roots: ['body'], scroller: '#view-podcast' };
    },
  },
  {
    name: 'podcast-trim',
    async run(page) {
      await openPodcast(page);
      await page.evaluate(() => document.getElementById('trimBtn').click());
      await page.waitForSelector('dialog.trim-dialog[open].open', { timeout: 5000 });
      return { roots: ['dialog.trim-dialog[open]'], fullyVisible: true };
    },
  },
  {
    name: 'queue',
    async run(page) {
      await sheetOpen(page);
      await page.evaluate(() => document.getElementById('queueToggle').click());
      await page.waitForFunction(
        () => !document.getElementById('view-queue').hidden && !document.getElementById('npSheet').classList.contains('open'),
        { timeout: 8000 },
      );
      await sleep(250);
      return { roots: ['body'], scroller: '#view-queue' };
    },
  },
  {
    name: 'settings',
    async run(page) {
      await showView(page, 'navSettings', 'settings');
      // The sync block is only rendered when the build has a Worker; a visible
      // block is the widest state, so show every row it can ever contain.
      await page.evaluate(() => {
        for (const id of ['s_syncSection', 'syncCodeRow', 'syncLinkRow']) {
          const n = document.getElementById(id);
          if (n) n.hidden = false;
        }
        const c = document.getElementById('syncCode');
        if (c && !c.textContent) c.textContent = 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY';
      });
      await settle(page);
      return { roots: ['body'], scroller: '#view-settings' };
    },
  },
  {
    name: 'settings-langmenu',
    async run(page) {
      await showView(page, 'navSettings', 'settings');
      await page.evaluate(() => {
        const b = document.querySelector('#s_lang .lang-menu-btn');
        b.scrollIntoView({ block: 'center' });
        b.click();
      });
      await sleep(200);
      return { roots: ['#s_lang .lang-menu-pop'], fullyVisible: true };
    },
  },
  {
    name: 'settings-confirm',
    async run(page) {
      await showView(page, 'navSettings', 'settings');
      await page.evaluate(() => document.getElementById('btnClearAll').click());
      await page.waitForSelector('dialog.confirm-dialog[open].open', { timeout: 5000 });
      return { roots: ['dialog.confirm-dialog[open]'], fullyVisible: true };
    },
  },
  {
    name: 'sheet',
    async run(page) {
      await sheetOpen(page);
      return { roots: ['#npSheet'], scroller: '#npSheet', sheet: true };
    },
  },
  {
    name: 'sheet-expanded',
    async run(page) {
      await sheetOpen(page);
      await page.waitForFunction(() => !document.getElementById('npChapters').hidden, { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => {
        for (const d of document.querySelectorAll('#npSheet details')) {
          if (!d.hidden) d.open = true;
        }
      });
      await settle(page, 250);
      return { roots: ['#npSheet'], scroller: '#npSheet', sheet: true };
    },
  },
  {
    name: 'sheet-toast',
    async run(page) {
      await sheetOpen(page);
      await page.evaluate(() => {
        const s = document.getElementById('sleepSel');
        s.value = '15';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForSelector('.toast.show', { timeout: 3000 });
      await sleep(120);
      return { roots: ['#npSheet', '.toast-host'], cross: ['.toast-host'] };
    },
  },
  {
    name: 'sheet-numprompt',
    async run(page) {
      await sheetOpen(page);
      await page.evaluate(() => {
        const s = document.getElementById('sleepSel');
        s.value = 'custom';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForSelector('dialog.num-prompt[open].open', { timeout: 5000 });
      return { roots: ['dialog.num-prompt[open]'], fullyVisible: true };
    },
  },
  {
    name: 'dock-toast',
    async run(page) {
      await showView(page, 'navHome', 'home');
      await page.evaluate(() => {
        const s = document.getElementById('miniSleep');
        s.value = s.options[2] ? s.options[2].value : '15';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForSelector('.toast.show', { timeout: 3000 });
      await sleep(120);
      return { roots: ['body'], cross: ['.toast-host'] };
    },
  },
  {
    name: 'shortcuts',
    async run(page) {
      await showView(page, 'navHome', 'home');
      await page.evaluate(() => {
        document.activeElement && document.activeElement.blur();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }));
      });
      await page.waitForSelector('dialog.sc-dialog[open].open', { timeout: 5000 });
      return { roots: ['dialog.sc-dialog[open]'], fullyVisible: true };
    },
  },
];

// ── driver ──────────────────────────────────────────────────────────

function installNetwork(page) {
  const xml = feedXml();
  const CORS = { 'access-control-allow-origin': '*' };
  const range = (req) => {
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers().range || '');
    const headers = {
      ...CORS,
      'accept-ranges': 'bytes',
      'access-control-expose-headers': 'content-range,content-length,accept-ranges',
    };
    if (!m) return req.respond({ status: 200, contentType: 'audio/wav', headers, body: WAV }).catch(() => {});
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Number(m[2]) : WAV.length - 1;
    headers['content-range'] = `bytes ${start}-${end}/${WAV.length}`;
    return req
      .respond({ status: 206, contentType: 'audio/wav', headers, body: WAV.subarray(start, end + 1) })
      .catch(() => {});
  };
  return (origin) => {
    page.on('request', (req) => {
      const u = req.url();
      try {
        // The app's own URL carries the feed in `?rss=`, so same-origin has to
        // be answered by the dev server before anything is matched by substring.
        if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) {
          return req.continue().catch(() => {});
        }
        if (u.includes(encodeURIComponent(FEED)) || u.includes(FEED)) {
          return req.respond({ status: 200, contentType: 'application/rss+xml', headers: CORS, body: xml }).catch(() => {});
        }
        if (u.includes('itunes.apple.com/search')) {
          return req.respond({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(SEARCH_RESULTS) }).catch(() => {});
        }
        if (u.includes('audit/chapters.json')) {
          return req.respond({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(CHAPTERS) }).catch(() => {});
        }
        if (u.includes('audit/t.vtt')) {
          return req.respond({ status: 200, contentType: 'text/vtt', headers: CORS, body: VTT }).catch(() => {});
        }
        if (u.includes('cdn.example.com/audit/') && u.endsWith('.wav')) return range(req);
        // Everything else would be the real internet: refuse it, so a run does
        // not depend on (or hit) anything outside this machine.
        return req.abort('failed').catch(() => {});
      } catch {
        /* the page moved on */
      }
    });
  };
}

function groupKey(f) {
  return `${f.severity}|${f.kind}|${f.key}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  const pick = (all, want, nameOf = (x) => x) => {
    if (!want) return all;
    const out = all.filter((x) => want.includes(nameOf(x)));
    const bad = want.filter((w) => !all.some((x) => nameOf(x) === w));
    if (bad.length) throw new Error(`unknown value(s): ${bad.join(', ')}`);
    return out;
  };
  const base = args.quick ? QUICK : {};
  const viewports = pick(VIEWPORTS, args.viewports || base.viewports, (v) => v.name);
  const themes = args.themes || base.themes || THEMES;
  const fonts = args.fonts || base.fonts || FONTS;
  const langs = args.langs || base.langs || LANGS;
  const scenarios = pick(SCENARIOS, args.views, (s) => s.name);

  if (args.shots) fs.mkdirSync(args.shots, { recursive: true });
  const origin = args.url || `http://localhost:${args.port}`;
  const server = args.url ? null : startServer({ port: args.port, mode: args.mode });
  const groups = new Map();
  const ignoredTotals = {};
  const notes = new Set();
  let snapshots = 0;
  let browser;
  const t0 = Date.now();

  try {
    await waitServer(origin + '/');
    // Pages that share a browser must not be treated as background tabs: the
    // dock's timers and the settle waits below would stall in one.
    browser = await puppeteer.launch(
      launchOptions([
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
      ]),
    );
    const combos = [];
    for (const lang of langs) for (const theme of themes) for (const font of fonts) combos.push({ lang, theme, font });
    console.error(
      `audit-layout: ${combos.length} configurations x ${viewports.length} viewports x ${scenarios.length} scenarios` +
        ` = ${combos.length * viewports.length * scenarios.length} snapshots`,
    );
    console.error(`scenarios: ${scenarios.map((s) => s.name).join(', ')}`);

    const attemptCombo = async (combo, state) => {
      // A fresh context per configuration: no storage, IndexedDB or cache is
      // carried over, so each starts from the seeded state and nothing else.
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      try {
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.setRequestInterception(true);
        installNetwork(page)(origin);
        const cdp = await page.createCDPSession();

        await page.goto(origin + '/manifest.webmanifest', { waitUntil: 'domcontentloaded' });
        await page.evaluate((seed) => {
          for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
        }, seedFor(combo));
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(`${origin}/?rss=${encodeURIComponent(FEED)}`, { waitUntil: 'networkidle2' });
        await page.waitForFunction(
          (l) => document.documentElement.lang === l && document.querySelectorAll('.ep-item').length > 0,
          { timeout: 30000 },
          combo.lang,
        );
        await page.evaluate(() => document.querySelector('.ep-item .ep-open').click());
        await page.waitForFunction(() => document.body.classList.contains('is-playing'), { timeout: 20000 });
        state.measuring = true;

        for (const vp of viewports) {
          // `hasTouch`/`isMobile` are left alone here on purpose: puppeteer
          // reloads the page when either changes, and a reload drops the track
          // that is playing, which is what puts the dock on screen. Touch is
          // switched on straight through CDP after the viewport instead.
          await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr });
          await cdp.send(
            'Emulation.setTouchEmulationEnabled',
            vp.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
          );
          try {
            await cdp.send('Emulation.setSafeAreaInsetsOverride', {
              insets: { top: vp.safe[0], right: vp.safe[1], bottom: vp.safe[2], left: vp.safe[3] },
            });
          } catch {
            notes.add('Emulation.setSafeAreaInsetsOverride is unavailable here: safe-area insets were not emulated.');
          }
          await sleep(250);
          const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
          if (vp.touch && !coarse) notes.add('Touch emulation did not switch (pointer: coarse) on; coarse-only rules were not exercised.');
          if (!vp.touch && coarse) notes.add('(pointer: coarse) stayed on for a non-touch viewport.');
          // Every number below is about a dock that is on screen. If the track
          // was lost (a reload, a playback error) say so rather than measure
          // a page that is missing the thing the audit is about.
          const hasTrack = await page.evaluate(() => document.body.classList.contains('has-track'));
          if (!hasTrack) throw new Error(`the dock is gone at ${vp.name}: no track is loaded, nothing measured would be the dock`);

          for (const sc of scenarios) {
            const where = `${vp.name} ${combo.theme} ${combo.font} ${combo.lang} / ${sc.name}`;
            let cfg;
            try {
              const tRun = Date.now();
              cfg = await sc.run(page);
              await sleep(60);
              const tAnalyze = Date.now();
              const { after: _after, ...plain } = cfg;
              const res = await page.evaluate(analyze, plain);
              if (args.verbose) console.error(`  run ${tAnalyze - tRun}ms, analyze ${Date.now() - tAnalyze}ms`);
              if (res.error) throw new Error(res.error);
              snapshots++;
              if (args.verbose) console.error(`${where}: ${res.findings.length} findings over ${res.count} boxes`);
              if (args.shots) {
                const file = `${vp.name}_${combo.theme}_${combo.font}_${combo.lang}_${sc.name}.png`;
                await page.screenshot({ path: path.join(args.shots, file.replace(/[^\w.@-]/g, '-')) });
              }
              for (const [k, n] of Object.entries(res.ignored)) ignoredTotals[k] = (ignoredTotals[k] || 0) + n;
              const found = res.findings;
              if (cfg.scroller) {
                const br = await page.evaluate(bottomReach, plain);
                if (br.error) throw new Error(br.error);
                if (br.last && br.behind > 0.5) {
                  found.push({
                    kind: 'hidden',
                    severity: 'error',
                    key: `${cfg.scroller}|${br.last}`,
                    text: `${cfg.scroller}: scrolled to the end, ${br.last} is still behind ${br.by}`,
                    measure: `${Math.round(br.behind * 10) / 10}px hidden (content ends at ${Math.round(br.lastBottom)}, ${br.by} starts at ${Math.round(br.limit)})`,
                  });
                }
                await page.evaluate((s) => { document.querySelector(s).scrollTop = 0; }, cfg.scroller);
              }
              for (const f of found) {
                const g = groupKey(f);
                let grp = groups.get(g);
                if (!grp) groups.set(g, (grp = { ...f, first: where, n: 0, conds: { vp: new Set(), theme: new Set(), font: new Set(), lang: new Set(), view: new Set() }, worst: f.measure }));
                grp.n++;
                grp.conds.vp.add(vp.name);
                grp.conds.theme.add(combo.theme);
                grp.conds.font.add(combo.font);
                grp.conds.lang.add(combo.lang);
                grp.conds.view.add(sc.name);
              }
            } catch (e) {
              const g = `error|harness|${sc.name}|${String(e.message).slice(0, 60)}`;
              if (!groups.has(g)) {
                groups.set(g, {
                  kind: 'harness',
                  severity: 'error',
                  key: sc.name,
                  text: `scenario ${sc.name} could not be measured: ${String(e.message).split('\n')[0]}`,
                  measure: '',
                  first: where,
                  n: 0,
                  conds: { vp: new Set(), theme: new Set(), font: new Set(), lang: new Set(), view: new Set() },
                });
              }
              const grp = groups.get(g);
              grp.n++;
              grp.conds.vp.add(vp.name);
              grp.conds.view.add(sc.name);
            } finally {
              if (cfg && cfg.after) await cfg.after().catch(() => {});
              await closeTransient(page);
            }
          }
        }
      } finally {
        await context.close().catch(() => {});
      }
    };
    const runCombo = async (combo) => {
      const state = { measuring: false };
      // Set-up is the flaky part (a dev server compiling a language chunk for
      // the first time, three pages at once): retry it, but never a run that
      // had already started measuring, which would double-count.
      for (let attempt = 1; ; attempt++) {
        try {
          await attemptCombo(combo, state);
          break;
        } catch (e) {
          if (!state.measuring && attempt < 3) continue;
          groups.set(`error|harness|setup|${combo.lang}${combo.theme}${combo.font}`, {
            kind: 'harness',
            severity: 'error',
            key: 'setup',
            text: `configuration ${combo.lang} ${combo.theme} ${combo.font} ${state.measuring ? 'stopped while measuring' : 'could not be set up'}: ${String(e.message).split('\n')[0]}`,
            measure: '',
            first: '',
            n: 1,
            conds: { vp: new Set(), theme: new Set(), font: new Set(), lang: new Set(), view: new Set() },
          });
          break;
        }
      }
      console.error(`  done ${combo.lang} ${combo.theme} ${combo.font}  (${snapshots} snapshots, ${Math.round((Date.now() - t0) / 1000)}s)`);
    };
    // Each configuration owns its page and context, so they can run side by
    // side; the analysis itself is a few tens of milliseconds, the rest is
    // waiting for the UI to settle.
    let cursor = 0;
    const lanes = Array.from({ length: Math.min(args.jobs, combos.length) }, async () => {
      while (cursor < combos.length) await runCombo(combos[cursor++]);
    });
    await Promise.all(lanes);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
  }

  // ── report ─────────────────────────────────────────────────────
  const all = [...groups.values()];
  const order = { error: 0, warn: 1 };
  all.sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind) || b.n - a.n);
  const span = (set, whole) => (set.size === whole ? 'all' : [...set].join(','));
  const lines = [];
  for (const sev of ['error', 'warn']) {
    const of = all.filter((g) => g.severity === sev);
    lines.push(`\n== ${sev.toUpperCase()}: ${of.length} distinct ==`);
    for (const g of of) {
      lines.push(`[${g.kind}] ${g.text}`);
      if (g.kind === 'harness') {
        lines.push(`    x${g.n}   first at: ${g.first || 'set-up'}`);
        continue;
      }
      lines.push(`    ${g.measure}   x${g.n}   first at: ${g.first}`);
      lines.push(
        `    viewports: ${span(g.conds.vp, viewports.length)} | themes: ${span(g.conds.theme, themes.length)} | fonts: ${span(g.conds.font, fonts.length)} | langs: ${span(g.conds.lang, langs.length)}`,
      );
      lines.push(`    views: ${[...g.conds.view].join(', ')}`);
    }
  }
  lines.push('\n== Skipped on purpose (counted, never silent) ==');
  for (const [k, n] of Object.entries(ignoredTotals).sort()) lines.push(`  ${String(n).padStart(7)}  ${k}`);
  for (const n of notes) lines.push(`NOTE: ${n}`);
  const errors = all.filter((g) => g.severity === 'error').length;
  const warns = all.filter((g) => g.severity === 'warn').length;
  lines.push(`\n${snapshots} snapshots in ${Math.round((Date.now() - t0) / 1000)}s: ${errors} distinct errors, ${warns} distinct warnings`);
  console.log(lines.join('\n'));

  if (args.json) {
    const raw = all.map((g) => ({ ...g, conds: Object.fromEntries(Object.entries(g.conds).map(([k, v]) => [k, [...v]])) }));
    fs.writeFileSync(args.json, JSON.stringify(raw, null, 2));
  }
  return errors || (args.strict && warns) ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(2);
  },
);
