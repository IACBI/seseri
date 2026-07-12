import type { FeedRequest } from '../feeds/types';
import { ytFromToken, ytToToken } from '../feeds/input-parse';

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
  | { kind: 'feed'; req: FeedRequest }
  | { kind: 'view'; view: AppView };

export function parseLocation(): Route {
  const p = new URLSearchParams(location.search);
  const pid = p.get('podcast');
  const rss = p.get('rss');
  const yt = p.get('yt');
  if (pid && /^\d{4,14}$/.test(pid)) return { kind: 'feed', req: { kind: 'itunes', id: pid } };
  if (rss && /^https?:\/\//i.test(rss)) return { kind: 'feed', req: { kind: 'rss', url: rss } };
  if (yt) {
    const ref = ytFromToken(yt);
    if (ref) return { kind: 'feed', req: { kind: 'yt', info: ref } };
  }
  const view = p.get('view');
  if (view && APP_VIEWS.includes(view)) return { kind: 'view', view: view as AppView };
  return { kind: 'home' };
}

export function urlFor(route: Route): string {
  if (route.kind === 'home') return location.pathname;
  if (route.kind === 'view') return location.pathname + '?view=' + route.view;
  const req = route.req;
  switch (req.kind) {
    case 'itunes':
      return location.pathname + '?podcast=' + encodeURIComponent(req.id);
    case 'rss':
      return location.pathname + '?rss=' + encodeURIComponent(req.url);
    case 'yt':
      return location.pathname + '?yt=' + encodeURIComponent(ytToToken(req.info));
  }
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

  /** Shared push/replace policy: one back step always returns home. */
  function reflect(url: string, push: boolean): void {
    if (location.pathname + location.search === url) return;
    if (push && parseLocation().kind !== 'home') {
      // feed/view → feed/view: replace, so back always returns home in one step
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
      reflect(urlFor({ kind: 'feed', req }), push);
    },
    viewOpened(view, push = true) {
      reflect(urlFor({ kind: 'view', view }), push);
    },
    canGoBack: () => hasHomeBehind,
    goHome() {
      if (parseLocation().kind !== 'home') history.pushState(null, '', urlFor({ kind: 'home' }));
      handlers.showHome();
    },
  };
}
