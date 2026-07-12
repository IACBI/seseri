/**
 * Home view — continue-listening rail, subscriptions shortcuts, favorites.
 * WP-0 STUB: WP-A implements the real view behind this exact signature.
 * Data comes from src/ui/data/continue-listening.ts (read-only aggregator).
 */

import type { FeedRequest } from '../../feeds/types';
import { registerView, viewEl, type View } from '../views';

export interface HomeViewDeps {
  openFeed(req: FeedRequest): void;
}

export interface HomeView extends View {
  /** Re-render dynamic content (favorites/continue rows). */
  refresh(): void;
}

export function initHomeView(deps: HomeViewDeps): HomeView {
  void deps;
  const el = viewEl('home');
  el.innerHTML = `
    <div class="view-inner">
      <h1 class="view-title" data-i18n="nav_home">Ana Sayfa</h1>
      <div class="empty-state">
        <div data-i18n="home_empty">Henüz bir şey dinlemedin.</div>
        <div class="empty-state-hint" data-i18n="home_empty_hint">Bir podcast ara ve dinlemeye başla — son dinlediklerin burada görünecek.</div>
      </div>
    </div>`;

  const view: HomeView = {
    name: 'home',
    el,
    refresh: () => undefined,
    onShow() {
      this.refresh();
    },
  };
  registerView(view);
  return view;
}
