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

  window.addEventListener('popstate', () => {
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
      history.replaceState(null, '', url);
    } else if (push) {
      history.pushState(null, '', url);
      hasHomeBehind = true;
    } else {
      history.replaceState(null, '', url);
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
      if (parseLocation().kind !== 'home') history.pushState(null, '', urlFor({ kind: 'home' }));
      handlers.showHome();
    },
  };
}
