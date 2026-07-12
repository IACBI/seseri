/**
 * Library view — tabs: subscriptions / downloads.
 * WP-0 STUB: WP-C implements the real view behind this exact signature.
 * Data: storage/subscriptions (signal), storage/db listDownloads,
 * player/offline removeDownload/storageInfo.
 */

import type { FeedRequest } from '../../feeds/types';
import { registerView, viewEl, type View } from '../views';

export interface LibraryViewDeps {
  openFeed(req: FeedRequest): void;
}

export function initLibraryView(deps: LibraryViewDeps): View {
  void deps;
  const el = viewEl('library');
  el.innerHTML = `
    <div class="view-inner">
      <h1 class="view-title" data-i18n="nav_library">Kütüphane</h1>
      <div class="empty-state">
        <div data-i18n="lib_empty_subs">Henüz abonelik yok.</div>
        <div class="empty-state-hint" data-i18n="lib_empty_subs_hint">Bir podcast açıp yıldıza dokunarak abone ol.</div>
      </div>
    </div>`;

  const view: View = { name: 'library', el };
  registerView(view);
  return view;
}
