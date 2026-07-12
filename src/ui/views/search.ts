/**
 * Search view — iTunes search + URL/RSS/YouTube paste, progressive dual-source
 * results. WP-0 STUB: WP-B ports the legacy behavior
 * (`git show ed59840:src/ui/screens/search.ts`) behind this exact signature.
 * Keep the legacy element IDs: searchInput, searchBtn, resultsList.
 */

import type { FeedRequest } from '../../feeds/types';
import { must } from '../shell';
import { registerView, viewEl, type View } from '../views';

export interface SearchViewDeps {
  openFeed(req: FeedRequest): void;
}

export interface SearchView extends View {
  focusInput(): void;
  /** Return keyboard focus to the row/input that opened a feed (back nav). */
  restoreFocus(): void;
}

export function initSearchView(deps: SearchViewDeps): SearchView {
  void deps;
  const el = viewEl('search');
  el.innerHTML = `
    <div class="view-inner">
      <h1 class="view-title" data-i18n="nav_search">Ara</h1>
      <div class="search-row">
        <input class="text-input search-input" id="searchInput" type="text"
          placeholder="Podcast adı, Apple Podcasts veya YouTube linki..." data-i18n-ph="search_placeholder" />
        <button class="btn btn-primary search-btn" id="searchBtn" data-i18n="btn_search">Ara →</button>
      </div>
      <div class="results-list" id="resultsList" aria-live="polite"></div>
    </div>`;

  const input = must<HTMLInputElement>('searchInput');

  const view: SearchView = {
    name: 'search',
    el,
    focusTarget: () => input,
    focusInput: () => input.focus(),
    restoreFocus: () => input.focus({ preventScroll: false }),
  };
  registerView(view);
  return view;
}
