/**
 * Podcast detail view — feed header (art, title, subscribe/share), status
 * strip, sort/filter bar, episode list. Playback state lives in the
 * playback-controller; this view renders playback.session reactively.
 * Ported from `git show ed59840:src/ui/screens/player.ts` (list/header half),
 * re-skinned onto the "Sinyal" design system.
 * Element IDs kept for the smoke-test contract: backBtn, pThumb, pTitle,
 * pAuthor, pEpCount, favBtn, shareBtn, dot, statusText, sortToggle, sortInfo,
 * filterInput, epList.
 */

import type { PlaybackController, PlaybackSession } from '../playback-controller';
import { registerView, viewEl, type View } from '../views';
import { h, icon } from '../h';
import { stateBox } from '../states';
import { fmtDate, fmtDur } from '../../lib/format';
import { httpsOnly } from '../../lib/safe';
import { t } from '../../i18n';
import { getProgress } from '../../storage/progress';
import { queuePosition } from '../../state/queue';
import { settings } from '../../state/settings';
import { isSubscribed, toggleSubscription } from '../../storage/subscriptions';
import { confirmDialog } from '../confirm';
import { toast } from '../toast';

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
  const { playback } = deps;
  const el = viewEl('podcast');
  el.innerHTML = `
    <div class="view-inner p-inner">
      <div class="p-header">
        <button class="icon-btn p-back" id="backBtn" data-i18n-aria="btn_back" aria-label="Geri"><svg class="icon icon-flip" aria-hidden="true"><use href="#ic-back"/></svg></button>
        <img class="p-art" id="pThumb" alt="" loading="lazy" decoding="async" />
        <div class="p-meta">
          <h1 class="p-title" id="pTitle" tabindex="-1">—</h1>
          <div class="p-author" id="pAuthor"></div>
          <div class="p-count"><span id="pEpCount">0</span> <span data-i18n="ep_count_unit">bölüm</span></div>
        </div>
        <div class="p-header-actions">
          <button class="icon-btn p-fav" id="favBtn" data-i18n-aria="fav_btn" aria-label="Abonelik ekle/çıkar"><svg class="icon icon-fill" aria-hidden="true"><use href="#ic-star"/></svg></button>
          <button class="icon-btn p-share" id="shareBtn" data-i18n-aria="share_btn" aria-label="Linki paylaş"><svg class="icon" aria-hidden="true"><use href="#ic-share"/></svg></button>
        </div>
      </div>
      <div class="p-status" aria-live="polite">
        <span class="dot" id="dot" aria-hidden="true"></span>
        <span class="p-status-text" id="statusText"></span>
      </div>
      <div class="p-listbar">
        <button class="p-sort" id="sortToggle" data-i18n-aria="btn_sort" aria-label="Sıra">
          <svg class="icon" aria-hidden="true"><use href="#ic-sort"/></svg>
          <span data-i18n="btn_sort">Sıra</span>
        </button>
        <span class="p-sort-info" id="sortInfo"></span>
        <input class="text-input p-filter" id="filterInput" type="text" placeholder="Bölüm ara..." data-i18n-ph="filter_placeholder" />
      </div>
      <div class="ep-list" id="epList" role="list"></div>
    </div>`;

  const q = <T extends HTMLElement = HTMLElement>(id: string): T =>
    el.querySelector<T>('#' + id) as T;

  const titleEl = q('pTitle');
  const authorEl = q('pAuthor');
  const thumbEl = q<HTMLImageElement>('pThumb');
  const countEl = q('pEpCount');
  const favBtn = q<HTMLButtonElement>('favBtn');
  const shareBtn = q<HTMLButtonElement>('shareBtn');
  const dotEl = q('dot');
  const statusTextEl = q('statusText');
  const sortToggle = q<HTMLButtonElement>('sortToggle');
  const sortInfoEl = q('sortInfo');
  const filterInput = q<HTMLInputElement>('filterInput');
  const epList = q('epList');

  // ── episode list rendering ───────────────────────────────────────
  function skeleton(rows = 8): HTMLElement {
    const list = h('div', { className: 'skeleton-list' });
    for (let i = 0; i < rows; i++) {
      list.append(
        h(
          'div',
          { className: 'skeleton-row' },
          h('span', { className: 'sk sk-num' }),
          h(
            'div',
            { className: 'ep-info' },
            h('div', { className: 'sk sk-line1' }),
            h('div', { className: 'sk sk-line2' }),
          ),
        ),
      );
    }
    return list;
  }

  function episodeRow(ep: PlaybackSession['filtered'][number], i: number, s: PlaybackSession): HTMLElement {
    const S = settings();
    const id = String(ep.trackId);
    const savedSec = getProgress(id);
    const hasSaved = S.resumePos && savedSec > 5;
    const durSec = ep.trackTimeMillis ? ep.trackTimeMillis / 1000 : 0;
    const pct = durSec && savedSec > 5 ? Math.min(100, (savedSec / durSec) * 100) : 0;
    const listened = pct >= 96;
    const active = i === s.currentIndex;

    const num = h('span', { className: 'ep-num' });
    if (active) {
      const eq = h('span', { className: 'ep-eq', attrs: { 'aria-hidden': 'true' } });
      eq.append(h('i'), h('i'), h('i'));
      num.append(eq);
    } else {
      num.textContent = String(i + 1);
    }

    const dateDur = h(
      'div',
      { className: 'ep-date-dur' },
      fmtDate(ep.releaseDate),
      ep.trackTimeMillis ? ' · ' + fmtDur(ep.trackTimeMillis) : '',
    );
    if (listened) {
      dateDur.append(' ', h('span', { className: 'ep-done-badge badge badge-done' }, '✓'));
    } else if (hasSaved) {
      dateDur.append(' ', h('span', { className: 'ep-saved-badge badge' }, t('ep_saved_badge')));
    }

    const row = h(
      'div',
      {
        className: 'ep-item' + (active ? ' active' : '') + (listened ? ' listened' : ''),
        role: 'listitem',
        tabIndex: 0,
        dataset: { idx: String(i) },
        ...(active ? { attrs: { 'aria-current': 'true' } } : {}),
      },
      num,
      h(
        'div',
        { className: 'ep-info' },
        h('div', { className: 'ep-name' }, ep.trackName || t('ep_fallback', i + 1)),
        dateDur,
      ),
    );

    const actions = h('div', { className: 'ep-actions' });
    const qPos = queuePosition(id);
    actions.append(
      h(
        'button',
        {
          className: 'ep-act ep-q-btn icon-btn' + (qPos ? ' queued' : ''),
          dataset: { idx: String(i), act: 'queue' },
          attrs: { 'aria-label': t('btn_queue'), title: t('btn_queue') },
        },
        qPos ? h('span', { className: 'ep-q-pos' }, String(qPos)) : icon('ic-queue'),
      ),
    );
    if (S.showDl) {
      const done = s.downloadedIds.has(id);
      actions.append(
        h(
          'button',
          {
            className: 'ep-act ep-dl-btn icon-btn' + (done ? ' done' : ''),
            dataset: { idx: String(i), act: 'dl' },
            attrs: { 'aria-label': t('dl_label'), title: t('dl_label') },
          },
          done ? '✓' : icon('ic-download'),
        ),
      );
    }
    row.append(actions);

    if (pct > 0 && !listened) {
      row.append(
        h(
          'div',
          { className: 'ep-progress', attrs: { 'aria-hidden': 'true' } },
          h('i', { style: `inline-size:${pct.toFixed(1)}%` }),
        ),
      );
    }
    return row;
  }

  function renderList(s: PlaybackSession): void {
    const loading = s.status.kind === 'loading';
    if (!s.filtered.length) {
      if (loading) {
        epList.replaceChildren(skeleton());
        epList.setAttribute('aria-busy', 'true');
        return;
      }
      epList.setAttribute('aria-busy', 'false');
      if (s.status.kind === 'error') {
        epList.replaceChildren(
          stateBox('error', s.status.message || t('ep_not_found'), { onRetry: () => playback.retry() }),
        );
      } else {
        epList.replaceChildren(stateBox('empty', t('ep_not_found')));
      }
      return;
    }
    const frag = document.createDocumentFragment();
    s.filtered.forEach((ep, i) => frag.append(episodeRow(ep, i, s)));
    epList.replaceChildren(frag);
    epList.setAttribute('aria-busy', 'false');

    if (s.currentIndex >= 0) {
      epList.querySelector('.ep-item.active')?.scrollIntoView({ block: 'nearest' });
    }
  }

  // ── reactive header + status render ──────────────────────────────
  function render(s: PlaybackSession): void {
    const meta = s.meta;
    titleEl.textContent = meta?.name || '—';
    authorEl.textContent = meta?.artist || '';
    const art = meta?.art ? httpsOnly(meta.art) : '';
    if (art) thumbEl.src = art;
    else thumbEl.removeAttribute('src');
    thumbEl.classList.toggle('has-art', !!art);
    countEl.textContent = String(s.episodes.length);
    favBtn.classList.toggle('faved', !!(meta && isSubscribed(meta.id)));

    dotEl.className = 'dot ' + s.status.kind;
    statusTextEl.textContent = s.status.message;

    sortInfoEl.textContent = s.sortAsc ? t('sort_asc_label') : t('sort_desc_label');

    // Sticky filter — sync the input unless the user is mid-edit.
    if (document.activeElement !== filterInput && filterInput.value !== s.filter) {
      filterInput.value = s.filter;
    }

    if (!el.hidden && meta) document.title = `${meta.name} – Seseri`;

    renderList(s);
  }

  // ── event wiring ─────────────────────────────────────────────────
  q<HTMLButtonElement>('backBtn').addEventListener('click', () => deps.onBack());

  sortToggle.addEventListener('click', () => playback.toggleSort());

  let filterTimer: ReturnType<typeof setTimeout> | null = null;
  filterInput.addEventListener('input', () => {
    if (filterTimer) clearTimeout(filterTimer);
    const value = filterInput.value;
    filterTimer = setTimeout(() => playback.setFilter(value), 200);
  });

  favBtn.addEventListener('click', () => {
    const meta = playback.session().meta;
    if (!meta) return;
    if (isSubscribed(meta.id)) {
      // Unsubscribing loses the star + list placement — confirm first.
      void confirmDialog('confirm_unsubscribe').then((ok) => {
        const m = playback.session().meta;
        if (ok && m) {
          toggleSubscription(m);
          favBtn.classList.toggle('faved', isSubscribed(m.id));
        }
      });
    } else {
      toggleSubscription(meta);
      favBtn.classList.toggle('faved', isSubscribed(meta.id));
    }
  });

  shareBtn.addEventListener('click', () => {
    const meta = playback.session().meta;
    if (!meta) return;
    const id = String(meta.id);
    const url =
      location.origin +
      location.pathname +
      (id.startsWith('yt:')
        ? '?yt=' + encodeURIComponent(meta.yt || '')
        : id.startsWith('rss:')
          ? '?rss=' + encodeURIComponent(id.slice(4))
          : '?podcast=' + encodeURIComponent(id));
    if (navigator.share) {
      navigator.share({ title: meta.name || 'Podcast', url }).catch(() => {
        /* user cancelled */
      });
      return;
    }
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast(t('link_copied')))
      .catch(() => {
        /* clipboard unavailable */
      });
  });

  // Episode list — event delegation (no per-row listeners).
  epList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const actBtn = target.closest<HTMLButtonElement>('.ep-act');
    if (actBtn) {
      e.stopPropagation();
      const idx = parseInt(actBtn.dataset.idx ?? '-1', 10);
      if (actBtn.dataset.act === 'queue') {
        playback.toggleQueued(idx);
      } else {
        actBtn.textContent = '⏳';
        actBtn.disabled = true;
        void playback.downloadToggle(idx);
      }
      return;
    }
    const row = target.closest<HTMLElement>('.ep-item[data-idx]');
    if (row) activateRow(parseInt(row.dataset.idx ?? '-1', 10));
  });
  epList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as HTMLElement;
    if (target.closest('.ep-act')) return; // let the button handle its own keys
    const row = target.closest<HTMLElement>('.ep-item[data-idx]');
    if (row) {
      e.preventDefault();
      activateRow(parseInt(row.dataset.idx ?? '-1', 10));
    }
  });

  /** Clicking the already-active row opens the full player; else load+play. */
  function activateRow(idx: number): void {
    if (idx < 0) return;
    if (idx === playback.session().currentIndex) deps.openNowPlaying();
    else playback.playEpisode(idx, true);
  }

  // ── reactivity ───────────────────────────────────────────────────
  playback.session.subscribe(render);
  render(playback.session());

  const view: PodcastView = {
    name: 'podcast',
    el,
    focusTarget: () => titleEl,
    focusTitle: () => titleEl.focus({ preventScroll: false }),
    onShow() {
      render(playback.session());
    },
  };
  registerView(view);
  return view;
}
