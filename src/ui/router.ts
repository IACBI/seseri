import type { FeedRequest } from '../feeds/types';

/**
 * History integration. Query-param URLs stay the canonical deep-link format
 * (?podcast= / ?rss= / ?yt= for feeds — every legacy link keeps working — and
 * ?view= for top-level views). Real history entries, so the back button
 * navigates feed/view → home.
 */

/** Deep-linkable top-level views (home is the bare pathname). */
export type AppView = 'search' | 'library' | 'queue' | 'settings';
const APP_VIEWS: readonly string[] = ['search', 'library', 'queue', 'settings'];

export type Route =
  | { kind: 'home' }
  | { kind: 'feed'; req: FeedRequest; episodeId?: string; at?: number }
  | { kind: 'view'; view: AppView };

/**
 * Longest episode id we will carry in a URL.
 *
 * A `<guid>` is whatever the publisher put there — some feeds use a full URL,
 * some a UUID, a few something much longer. Past this the link is not shareable
 * anyway and the value is more likely to be junk than an id.
 */
const MAX_EPISODE_ID = 300;

/** `?ep=` / `&t=`, validated. Both are attacker-craftable. */
function episodeFrom(p: URLSearchParams): { episodeId?: string; at?: number } {
  const out: { episodeId?: string; at?: number } = {};
  const ep = p.get('ep');
  if (ep && ep.length <= MAX_EPISODE_ID) out.episodeId = ep;
  const t = p.get('t');
  if (t) {
    const seconds = Number(t);
    // A negative or absurd offset is not a position; 24 h covers any episode.
    if (Number.isFinite(seconds) && seconds > 0 && seconds < 86_400) out.at = Math.floor(seconds);
  }
  return out;
}

export function parseLocation(): Route {
  const p = new URLSearchParams(location.search);
  const pid = p.get('podcast');
  const rss = p.get('rss');
  const ep = episodeFrom(p);
  if (pid && /^\d{4,14}$/.test(pid)) {
    return { kind: 'feed', req: { kind: 'itunes', id: pid }, ...ep };
  }
  // https only: ?rss= is attacker-craftable, so it must not be a lever for
  // making the app fetch arbitrary plaintext URLs.
  if (rss && /^https:\/\//i.test(rss)) {
    return { kind: 'feed', req: { kind: 'rss', url: rss }, ...ep };
  }
  const view = p.get('view');
  if (view && APP_VIEWS.includes(view)) return { kind: 'view', view: view as AppView };
  return { kind: 'home' };
}

export function urlFor(route: Route): string {
  if (route.kind === 'home') return location.pathname;
  if (route.kind === 'view') return location.pathname + '?view=' + route.view;
  const req = route.req;
  const base =
    req.kind === 'itunes'
      ? location.pathname + '?podcast=' + encodeURIComponent(req.id)
      : location.pathname + '?rss=' + encodeURIComponent(req.url);
  // The episode is deliberately NOT reflected into history as the user plays:
  // `feedOpened` never passes one. It exists so a shared link can name an
  // episode, and so `shareUrlFor` can build one.
  const ep = route.episodeId ? '&ep=' + encodeURIComponent(route.episodeId) : '';
  const at = route.at ? '&t=' + String(route.at) : '';
  return base + ep + at;
}

/**
 * An absolute, shareable link. `urlFor` builds a path for `history`; this is
 * what goes on a clipboard, so it carries the origin.
 */
export function shareUrlFor(
  req: FeedRequest,
  opts: { episodeId?: string; at?: number } = {},
): string {
  const route: Route = { kind: 'feed', req };
  if (opts.episodeId) route.episodeId = opts.episodeId;
  if (opts.at && opts.at > 0) route.at = Math.floor(opts.at);
  return location.origin + urlFor(route);
}

/**
 * The open Now Playing sheet as a history entry, so the platform's back
 * gesture (Android back, a mouse's back button) dismisses the sheet instead of
 * leaving the page.
 *
 * Opening pushes an entry at the SAME URL, tagged in `history.state`. Every
 * popstate is classified by comparing the tag and the URL against the previous
 * one: a change of tag alone is the sheet opening or closing and the router
 * must not re-run `showFeed` for it; a change of URL is real navigation and
 * the router handles it as before. The sheet follows `history` rather than the
 * other way round, so back, forward, Esc and the close button cannot disagree.
 */
const SHEET_KEY = 'npSheet';
/** A sheet entry the sheet gave up without popping — see `closed(true)`. */
const SHEET_SPENT_KEY = 'npSheetSpent';

function stateHas(key: string): boolean {
  const s: unknown = history.state;
  return typeof s === 'object' && s !== null && key in s;
}

let onSheetEntry = stateHas(SHEET_KEY);
/**
 * The URL of the current entry as this module last knew it. pushState and
 * replaceState fire no event, so every write goes through `writeEntry`.
 */
let lastUrl = location.pathname + location.search;

function writeEntry(mode: 'push' | 'replace', state: unknown, url: string): void {
  if (mode === 'push') history.pushState(state, '', url);
  else history.replaceState(state, '', url);
  lastUrl = location.pathname + location.search;
}

/** Result of the latest popstate, for whoever listens after the tracker. */
let transition: 'enter' | 'leave' | null = null;
let trackerBound = false;

/** Runs first (it is bound by the first of `initRouter` / `bindSheetHistory`). */
function bindTracker(): void {
  if (trackerBound) return;
  trackerBound = true;
  window.addEventListener('popstate', () => {
    const was = onSheetEntry;
    const url = location.pathname + location.search;
    onSheetEntry = stateHas(SHEET_KEY);
    transition = was === onSheetEntry ? null : onSheetEntry ? 'enter' : 'leave';
    // A tag change with a different URL (history.go(-2) across the sheet's
    // entry) is navigation too: let the router see it.
    if (url !== lastUrl) transition = null;
    lastUrl = url;
  });
}

export interface SheetHistory {
  /** The sheet just opened: push its entry unless one is already current. */
  opened(): void;
  /**
   * The sheet just closed. By default the entry is popped with `back()`. A
   * caller that is about to navigate passes `true`: `back()` is asynchronous
   * and would land after the navigation's own push, so the entry is instead
   * marked spent and the router's next push replaces it.
   */
  closed(navigating?: boolean): void;
}

export function bindSheetHistory(sheet: {
  open(): void;
  close(): void;
  isOpen(): boolean;
}): SheetHistory {
  bindTracker();
  // A reload on the sheet's entry restores its state but not the sheet.
  if (onSheetEntry && !sheet.isOpen()) {
    history.replaceState({ [SHEET_SPENT_KEY]: true }, '');
    onSheetEntry = false;
  }
  window.addEventListener('popstate', () => {
    // Follows the entry, whatever the URL did: a sheet must not stay open
    // over a page the traversal has moved away from.
    if (!onSheetEntry && sheet.isOpen()) sheet.close();
    else if (onSheetEntry && !sheet.isOpen()) sheet.open();
  });
  return {
    opened() {
      if (!onSheetEntry) {
        writeEntry('push', { [SHEET_KEY]: true }, location.href);
        onSheetEntry = true;
      }
    },
    closed(navigating = false) {
      if (!onSheetEntry) return;
      if (navigating) {
        history.replaceState({ [SHEET_SPENT_KEY]: true }, '');
        onSheetEntry = false;
      } else {
        history.back();
      }
    },
  };
}

/** A spent sheet entry is a duplicate of the one before it: take its place. */
function pushOrReplaceSpent(url: string): void {
  writeEntry(stateHas(SHEET_SPENT_KEY) ? 'replace' : 'push', null, url);
}

export interface Router {
  /** Reflect an opened feed in the URL (pushes unless it's the initial load). */
  feedOpened(req: FeedRequest, push?: boolean): void;
  /** Reflect an opened top-level view in the URL (same push semantics). */
  viewOpened(view: AppView, push?: boolean): void;
  /** Navigate home programmatically. */
  goHome(): void;
  /** True when history.back() stays inside the app (a home entry exists). */
  canGoBack(): boolean;
}

export function initRouter(handlers: {
  showFeed: (req: FeedRequest) => void;
  showHome: () => void;
  showView: (view: AppView) => void;
}): Router {
  // Deep links land straight on a feed/view — there is no in-app entry behind
  // us, so the back button must navigate home instead of leaving the site.
  let hasHomeBehind = false;

  bindTracker();
  window.addEventListener('popstate', () => {
    if (transition !== null) return; // the sheet opening or closing, not navigation
    const route = parseLocation();
    if (route.kind === 'feed') handlers.showFeed(route.req);
    else if (route.kind === 'view') handlers.showView(route.view);
    else {
      hasHomeBehind = false;
      handlers.showHome();
    }
  });

  /** Shared push/replace policy: same-kind hops collapse (feed→feed, tab→tab
   *  replace so history never stacks), but view→feed pushes so back returns
   *  to the search/library position the feed was opened from. */
  function reflect(route: Route, push: boolean): void {
    const url = urlFor(route);
    if (location.pathname + location.search === url) return;
    const cur = parseLocation().kind;
    if (push && cur !== 'home' && !(cur === 'view' && route.kind === 'feed')) {
      writeEntry('replace', null, url);
    } else if (push) {
      pushOrReplaceSpent(url);
      hasHomeBehind = true;
    } else {
      writeEntry('replace', null, url);
    }
  }

  return {
    feedOpened(req, push = true) {
      reflect({ kind: 'feed', req }, push);
    },
    viewOpened(view, push = true) {
      reflect({ kind: 'view', view }, push);
    },
    canGoBack: () => hasHomeBehind,
    goHome() {
      if (parseLocation().kind !== 'home') pushOrReplaceSpent(urlFor({ kind: 'home' }));
      handlers.showHome();
    },
  };
}
