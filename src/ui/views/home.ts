/**
 * Home view — compact brand header, a "Devam Et" (continue-listening) rail and
 * a "Aboneliklerim" (subscriptions) grid. Falls back to an inviting empty state.
 * Read-only data comes from src/ui/data/continue-listening.ts.
 */

import type { FeedRequest, Subscription } from '../../feeds/types';
import { registerView, viewEl, type View } from '../views';
import { h, icon } from '../h';
import { t, currentLang } from '../../i18n';
import { artTile, ROW_ART_PX, SUB_TILE_PX } from '../art-tile';
import { fmtDate, fmtDur, fmtTime } from '../../lib/format';
import { BRAND_MARK } from '../icons';
import { createLangMenu } from '../lang-menu';
import {
  clearInbox,
  dismissInboxItem,
  inbox,
  pendingInbox,
  type InboxItem,
} from '../../feeds/inbox';
import { subscriptions } from '../../storage/subscriptions';
import {
  continueListening,
  requestFromSubscription,
  type ContinueItem,
} from '../data/continue-listening';
import { requestFromFeedId } from '../../feeds/feed-id';

export interface HomeViewDeps {
  openFeed(req: FeedRequest): void;
  /** Open a feed AND load its last-played episode — the continue rail's whole job. */
  resumeFeed(req: FeedRequest): void;
  /** Open a feed and start one particular episode — the new-episodes rail. */
  playEpisode(req: FeedRequest, trackId: string): void;
  /** Re-check the subscriptions now. Resolves when the sweep is done. */
  checkForNew(): Promise<void>;
}

export interface HomeView extends View {
  /** Re-render dynamic content (continue rows / subscriptions). */
  refresh(): void;
}

// Built at module scope from the brand-mark constant, so the innerHTML
// assignment below is plainly static — no runtime data can reach it.
const MARKUP = `
    <div class="view-inner home">
      <header class="home-brand">
        <div class="home-brand-id">
          <span class="home-brand-mark" aria-hidden="true">${BRAND_MARK}</span>
          <div class="home-brand-text">
            <h1 class="home-wordmark wm" tabindex="-1">Seseri</h1>
            <p class="home-tagline" data-i18n="home_tagline">Ücretsiz, hesapsız podcast çalar</p>
          </div>
        </div>
        <div class="home-lang" id="homeLangSel"></div>
      </header>
      <div class="home-sections"></div>
    </div>`;

export function initHomeView(deps: HomeViewDeps): HomeView {
  const el = viewEl('home');
  el.innerHTML = MARKUP;

  el.querySelector('.home-lang')?.append(createLangMenu({ compact: true }));

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

  function sectionLabel(key: 'home_continue' | 'favs_title' | 'home_new'): HTMLElement {
    return h('div', { className: 'search-hint', dataset: { i18n: key } }, t(key));
  }

  /**
   * The new-episodes rail.
   *
   * A row opens the show AND starts the episode: the listener tapped a
   * specific thing, not a place to browse. Dismissing is separate and
   * deliberate — the rail is a list of decisions to make, so it needs a way to
   * say "not this one" that is not "play it".
   */
  function newRow(item: InboxItem): HTMLElement {
    const req = requestFromFeedId(item.feedId);
    const meta = [fmtDate(item.releaseDate), item.trackTimeMillis ? fmtDur(item.trackTimeMillis) : '']
      .filter(Boolean)
      .join(' · ');

    const dismiss = h(
      'button',
      {
        className: 'icon-btn home-new-x',
        type: 'button',
        title: t('home_new_dismiss'),
        attrs: { 'aria-label': t('home_new_dismiss') },
        on: {
          click: (e) => {
            e.stopPropagation();
            dismissInboxItem(item.feedId, item.trackId);
          },
        },
      },
      icon('ic-x'),
    );

    const row = h(
      'div',
      { className: 'row home-row home-new-row', role: 'button', tabIndex: 0, dataset: { homeRow: '1' } },
      artTile('row-art', item.art, ROW_ART_PX),
      h(
        'div',
        { className: 'row-info' },
        h('div', { className: 'row-name' }, item.title || '—'),
        h('div', { className: 'row-sub' }, [item.feedName, meta].filter(Boolean).join(' · ')),
      ),
      dismiss,
    );
    if (req) activate(row, () => deps.playEpisode(req, item.trackId));
    return row;
  }


  /**
   * Manual re-check. The automatic sweep skips a feed checked in the last half
   * hour, which is right for an app that runs it on every open and wrong for a
   * listener who knows an episode just dropped — so this one forces it.
   */
  let checking = false;
  function checkNowButton(): HTMLElement {
    const btn = h('button', { className: 's-btn home-check', type: 'button' });
    const paint = (): void => {
      btn.textContent = checking ? t('home_checking') : t('home_check_now');
      btn.disabled = checking;
    };
    paint();
    btn.addEventListener('click', () => {
      if (checking) return;
      checking = true;
      paint();
      void deps.checkForNew().finally(() => {
        checking = false;
        // The sweep re-renders through the inbox signal when it finds
        // something; when it finds nothing this is the only repaint.
        paint();
      });
    });
    return btn;
  }

  function continueRow(item: ContinueItem): HTMLElement {
    const row = h(
      'div',
      { className: 'row home-row', role: 'button', tabIndex: 0, dataset: { homeRow: '1' } },
      artTile('row-art', item.episode.art || item.feed.art, ROW_ART_PX),
      h(
        'div',
        { className: 'row-info' },
        h('div', { className: 'row-name' }, item.episode.trackName || '—'),
        h('div', { className: 'row-sub' }, item.feed.name || item.feed.artist || ''),
      ),
      h('div', { className: 'row-meta' }, fmtTime(item.positionSec)),
    );
    activate(row, () => deps.resumeFeed(item.req));

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
      artTile('home-sub-art', sub.art, SUB_TILE_PX),
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

    const fresh = pendingInbox();
    if (fresh.length) {
      const head = h(
        'div',
        { className: 'home-new-head' },
        sectionLabel('home_new'),
        h('button', {
          className: 's-btn home-new-clear',
          type: 'button',
          on: { click: () => clearInbox() },
        }, t('home_new_clear')),
      );
      nodes.push(head);
      for (const item of fresh) nodes.push(newRow(item));
    }

    if (items.length) {
      nodes.push(sectionLabel('home_continue'));
      for (const item of items) nodes.push(continueRow(item));
    }

    if (subs.length) {
      nodes.push(
        h(
          'div',
          { className: 'home-new-head' },
          sectionLabel('favs_title'),
          checkNowButton(),
        ),
      );
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
  // A sweep finishing, or a row being dismissed, changes the rail.
  inbox.subscribe(() => void render());

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
