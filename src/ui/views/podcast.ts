/**
 * Podcast detail view — feed header (art, title, subscribe/share), status
 * strip, sort/filter bar, episode list. Playback state lives in the
 * playback-controller; this view renders playback.session reactively.
 * WP-0 STUB: WP-D implements the real view behind this exact signature.
 * Keep the legacy element IDs: backBtn, pThumb, pTitle, pAuthor, pEpCount,
 * favBtn, shareBtn, dot, statusText, sortToggle, sortInfo, filterInput, epList.
 */

import type { PlaybackController } from '../playback-controller';
import { registerView, viewEl, type View } from '../views';

export interface PodcastViewDeps {
  playback: PlaybackController;
  /** Back button: in-app history back, or home when we deep-linked in. */
  onBack(): void;
  /** Open the full-screen Now Playing sheet (mobile flow). */
  openNowPlaying(): void;
}

export interface PodcastView extends View {
  /** Land keyboard focus on the feed title (accessible landing point). */
  focusTitle(): void;
}

export function initPodcastView(deps: PodcastViewDeps): PodcastView {
  const el = viewEl('podcast');
  el.innerHTML = `
    <div class="view-inner">
      <div class="p-header">
        <button class="icon-btn p-back" id="backBtn" data-i18n-aria="btn_back" aria-label="Geri"><svg class="icon icon-flip" aria-hidden="true"><use href="#ic-back"/></svg></button>
        <h1 class="view-title" id="pTitle" tabindex="-1">—</h1>
      </div>
      <div class="empty-state" data-i18n="loading_eps">Yükleniyor...</div>
    </div>`;

  el.querySelector('#backBtn')?.addEventListener('click', () => deps.onBack());

  const titleEl = el.querySelector<HTMLElement>('#pTitle');
  const view: PodcastView = {
    name: 'podcast',
    el,
    focusTarget: () => titleEl,
    focusTitle: () => titleEl?.focus({ preventScroll: false }),
  };
  registerView(view);
  return view;
}
