/**
 * Home view — compact brand header, a "Devam Et" (continue-listening) rail and
 * a "Aboneliklerim" (subscriptions) grid. Falls back to an inviting empty state.
 * Read-only data comes from src/ui/data/continue-listening.ts.
 */

import type { FeedRequest, Subscription } from '../../feeds/types';
import { registerView, viewEl, type View } from '../views';
import { h } from '../h';
import { t, currentLang } from '../../i18n';
import { httpsOnly } from '../../lib/safe';
import { fmtTime } from '../../lib/format';
import { BRAND_MARK } from '../icons';
import { subscriptions } from '../../storage/subscriptions';
import {
  continueListening,
  requestFromSubscription,
  type ContinueItem,
} from '../data/continue-listening';

export interface HomeViewDeps {
  openFeed(req: FeedRequest): void;
}

export interface HomeView extends View {
  /** Re-render dynamic content (continue rows / subscriptions). */
  refresh(): void;
}

export function initHomeView(deps: HomeViewDeps): HomeView {
  const el = viewEl('home');
  el.innerHTML = `
    <div class="view-inner home">
      <header class="home-brand">
        <span class="home-brand-mark" aria-hidden="true">${BRAND_MARK}</span>
        <div class="home-brand-text">
          <h1 class="home-wordmark" tabindex="-1">Seseri</h1>
          <p class="home-tagline" data-i18n="home_tagline">Ücretsiz, hesapsız podcast çalar</p>
        </div>
      </header>
      <div class="home-sections"></div>
    </div>`;

  const heading = el.querySelector<HTMLElement>('.home-wordmark')!;
  const sectionsEl = el.querySelector<HTMLElement>('.home-sections')!;
  let renderToken = 0;

  /** Wire pointer + keyboard activation onto a role="button" element. */
  function activate(node: HTMLElement, onOpen: () => void): void {
    node.addEventListener('click', onOpen);
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onOpen();
    });
  }

  function sectionLabel(key: 'home_continue' | 'favs_title'): HTMLElement {
    return h('div', { className: 'search-hint', dataset: { i18n: key } }, t(key));
  }

  /** Artwork img, or a calm placeholder tile when the feed has no art. */
  function artOrTile(className: string, art: string): HTMLElement {
    const src = httpsOnly(art);
    if (!src) return h('div', { className });
    return h('img', {
      className,
      src,
      alt: '',
      attrs: { loading: 'lazy', decoding: 'async' },
    });
  }

  function continueRow(item: ContinueItem): HTMLElement {
    const row = h(
      'div',
      { className: 'row home-row', role: 'button', tabIndex: 0, dataset: { homeRow: '1' } },
      artOrTile('row-art', item.episode.art || item.feed.art),
      h(
        'div',
        { className: 'row-info' },
        h('div', { className: 'row-name' }, item.episode.trackName || '—'),
        h('div', { className: 'row-sub' }, item.feed.name || item.feed.artist || ''),
      ),
      h('div', { className: 'row-meta' }, fmtTime(item.positionSec)),
    );
    activate(row, () => deps.openFeed(item.req));

    const bar = h(
      'div',
      { className: 'home-progress' },
      h('div', { className: 'home-progress-fill', style: `inline-size:${item.percent}%` }),
    );
    return h('div', { className: 'home-continue-item' }, row, bar);
  }

  function subTile(sub: Subscription): HTMLElement | null {
    const req = requestFromSubscription(sub);
    if (!req) return null;
    const tile = h(
      'div',
      {
        className: 'home-sub',
        role: 'button',
        tabIndex: 0,
        dataset: { homeRow: '1' },
        title: sub.name || sub.artist || '',
      },
      artOrTile('home-sub-art', sub.art),
      h('div', { className: 'home-sub-name' }, sub.name || sub.artist || '—'),
    );
    activate(tile, () => deps.openFeed(req));
    return tile;
  }

  async function render(): Promise<void> {
    const token = ++renderToken;
    const subs = subscriptions();
    const items = await continueListening();
    if (token !== renderToken) return; // superseded by a newer render

    const nodes: Node[] = [];

    if (items.length) {
      nodes.push(sectionLabel('home_continue'));
      for (const item of items) nodes.push(continueRow(item));
    }

    if (subs.length) {
      nodes.push(sectionLabel('favs_title'));
      const grid = h('div', { className: 'home-subs' });
      for (const sub of subs) {
        const tile = subTile(sub);
        if (tile) grid.append(tile);
      }
      nodes.push(grid);
    }

    if (!items.length && !subs.length) {
      nodes.push(
        h(
          'div',
          { className: 'empty-state' },
          h('div', { dataset: { i18n: 'home_empty' } }, t('home_empty')),
          h(
            'div',
            { className: 'empty-state-hint', dataset: { i18n: 'home_empty_hint' } },
            t('home_empty_hint'),
          ),
        ),
      );
    }

    sectionsEl.replaceChildren(...nodes);
  }

  // Rebuild when subscriptions change or the language switches (localizes the
  // dynamically-built section labels / empty-state text).
  subscriptions.subscribe(() => void render());
  currentLang.subscribe(() => void render());

  const view: HomeView = {
    name: 'home',
    el,
    refresh() {
      void render();
    },
    onShow() {
      this.refresh();
    },
    focusTarget() {
      const row = el.querySelector<HTMLElement>('[data-home-row]');
      if (row) return row;
      return heading.offsetParent !== null ? heading : null;
    },
  };
  registerView(view);
  return view;
}
