import type { FeedRequest } from '../feeds/types';
import { ytFromToken, ytToToken } from '../feeds/input-parse';

/**
 * History integration. Query-param URLs stay the canonical deep-link format
 * (?podcast= / ?rss= / ?yt=) so every legacy link keeps working — but we now
 * push real history entries, so the back button navigates feed → home.
 */

export type Route = { kind: 'home' } | { kind: 'feed'; req: FeedRequest };

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
  return { kind: 'home' };
}

export function urlFor(route: Route): string {
  if (route.kind === 'home') return location.pathname;
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
  /** Navigate home programmatically. */
  goHome(): void;
  /** True when history.back() stays inside the app (a home entry exists). */
  canGoBack(): boolean;
}

export function initRouter(handlers: {
  showFeed: (req: FeedRequest) => void;
  showHome: () => void;
}): Router {
  // Deep links land straight on a feed — there is no in-app entry behind us,
  // so the back button must navigate home instead of leaving the site.
  let hasHomeBehind = false;

  window.addEventListener('popstate', () => {
    const route = parseLocation();
    if (route.kind === 'feed') handlers.showFeed(route.req);
    else {
      hasHomeBehind = false;
      handlers.showHome();
    }
  });

  return {
    feedOpened(req, push = true) {
      const url = urlFor({ kind: 'feed', req });
      if (location.pathname + location.search === url) return;
      if (push && parseLocation().kind !== 'home') {
        // feed → feed: replace, so back always returns home in one step
        history.replaceState(null, '', url);
      } else if (push) {
        history.pushState(null, '', url);
        hasHomeBehind = true;
      } else {
        history.replaceState(null, '', url);
      }
    },
    canGoBack: () => hasHomeBehind,
    goHome() {
      if (parseLocation().kind !== 'home') history.pushState(null, '', urlFor({ kind: 'home' }));
      handlers.showHome();
    },
  };
}
