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

import {
  EPISODE_FILTERS,
  type EpisodeFilter,
  type PlaybackController,
  type PlaybackSession,
} from '../playback-controller';
import { registerView, viewEl, type View } from '../views';
import { h, icon } from '../h';
import { stateBox } from '../states';
import { fmtDate, fmtDur } from '../../lib/format';
import { artAt, artSrcset } from '../../lib/art';
import { dprWidths, HEADER_ART_PX } from '../art-tile';
import { t } from '../../i18n';
import { getProgress } from '../../storage/progress';
import { isExplicitlyUnplayed, isPlayed, playedRevision } from '../../storage/played';
import { downloadJobs, jobFraction, isDownloading } from '../../player/download-jobs';
import { queue, queuePositions } from '../../state/queue';
import { settings, type Settings } from '../../state/settings';
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
      <div class="p-modes" id="epModes" role="group" data-i18n-aria="btn_sort" aria-label="Filtre"></div>
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
  const modesEl = q('epModes');
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

  type Episode = PlaybackSession['filtered'][number];

  /**
   * Everything about a row that can change without the list itself changing.
   * Compared per row so an unrelated session update touches no DOM at all.
   */
  function rowSignature(
    ep: Episode,
    i: number,
    s: PlaybackSession,
    S: Settings,
    qPos: Map<string, number>,
  ): string {
    const id = String(ep.trackId);
    const state = rowState(ep);
    return [
      i === s.currentIndex ? 1 : 0,
      qPos.get(id) ?? 0,
      s.downloadedIds.has(id) ? 1 : 0,
      state.pct.toFixed(1),
      state.played ? 1 : 0,
      dlLabel(id),
      S.resumePos ? 1 : 0,
      S.showDl ? 1 : 0,
      ep.trackName,
    ].join('\u0001');
  }

  /**
   * The three things about an episode that are not in the session snapshot: how
   * far in it is, whether it counts as heard, and whether the listener said so
   * by hand. An explicit "unplayed" also hides the position — "play this again"
   * means from the start, so a leftover hairline would be a lie.
   */
  function rowState(ep: Episode): { pct: number; played: boolean; saved: number } {
    const id = String(ep.trackId);
    if (isExplicitlyUnplayed(id)) return { pct: 0, played: false, saved: 0 };
    const savedSec = getProgress(id);
    const durSec = ep.trackTimeMillis ? ep.trackTimeMillis / 1000 : 0;
    const pct = durSec && savedSec > 5 ? Math.min(100, (savedSec / durSec) * 100) : 0;
    return { pct, played: isPlayed(id, ep.trackTimeMillis), saved: savedSec };
  }

  /**
   * What the download button reads while a transfer is running: a percentage
   * when the host declared a length, and a plain "downloading" when it did
   * not. `''` means there is no download in flight.
   */
  function dlLabel(id: string): string {
    if (!isDownloading(id)) return '';
    const fraction = jobFraction(id);
    return fraction === null ? '…' : String(Math.round(fraction * 100));
  }

  function episodeRow(
    ep: Episode,
    i: number,
    s: PlaybackSession,
    S: Settings,
    qPos: Map<string, number>,
  ): HTMLElement {
    const id = String(ep.trackId);
    const { pct, played: listened, saved: savedSec } = rowState(ep);
    const hasSaved = S.resumePos && savedSec > 5 && !listened;
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

    /**
     * The row's primary action is a real button.
     *
     * It used to be a `role="listitem"` div with a `tabindex` and a keydown
     * handler, which announces as "list item" and gives a screen-reader user
     * nothing to suggest that pressing Enter does anything. A button says what
     * it is, brings its own Enter/Space handling, and keeps the list semantics
     * of the row around it.
     */
    const title = ep.trackName || t('ep_fallback', i + 1);
    const open = h(
      'button',
      {
        className: 'ep-open',
        type: 'button',
        // Roving tabindex: one stop for the whole list, not one per episode.
        tabIndex: -1,
        dataset: { idx: String(i), act: 'open' },
        attrs: { 'aria-label': t('ep_open', title, i + 1, s.filtered.length) },
      },
      num,
      h('div', { className: 'ep-info' }, h('div', { className: 'ep-name', title }, title), dateDur),
    );

    const row = h(
      'div',
      {
        className: 'ep-item' + (active ? ' active' : '') + (listened ? ' listened' : ''),
        role: 'listitem',
        dataset: { idx: String(i) },
        ...(active ? { attrs: { 'aria-current': 'true' } } : {}),
      },
      open,
    );

    const actions = h('div', { className: 'ep-actions' });
    const pos = qPos.get(id) ?? 0;
    actions.append(
      h(
        'button',
        {
          className: 'ep-act ep-played-btn icon-btn' + (listened ? ' done' : ''),
          tabIndex: -1,
          dataset: { idx: String(i), act: 'played' },
          attrs: {
            'aria-label': listened ? t('mark_unplayed') : t('mark_played'),
            'aria-pressed': String(listened),
            title: listened ? t('mark_unplayed') : t('mark_played'),
          },
        },
        icon('ic-check'),
      ),
    );
    actions.append(
      h(
        'button',
        {
          className: 'ep-act ep-q-btn icon-btn' + (pos ? ' queued' : ''),
          tabIndex: -1,
          dataset: { idx: String(i), act: 'queue' },
          attrs: { 'aria-label': t('btn_queue'), title: t('btn_queue') },
        },
        pos ? h('span', { className: 'ep-q-pos' }, String(pos)) : icon('ic-queue'),
      ),
    );
    if (S.showDl) {
      const done = s.downloadedIds.has(id);
      const running = dlLabel(id);
      /**
       * Three states in one control: download, cancel (with a percentage), and
       * remove. A tap means the obvious thing in each of them, and the label
       * says which — it used to become an hourglass and stop responding.
       */
      /**
       * Each state says what a tap will do. The finished state used to say
       * "download this episode" on a button that deletes it, which is the one
       * reading a listener must not be given.
       */
      const label = running
        ? running === '…'
          ? t('dl_working')
          : t('dl_progress', running)
        : done
          ? t('lib_delete_download')
          : t('dl_label');
      const button = h(
        'button',
        {
          className:
            'ep-act ep-dl-btn icon-btn' + (done ? ' done' : '') + (running ? ' working' : ''),
          tabIndex: -1,
          dataset: { idx: String(i), act: 'dl' },
          attrs: {
            'aria-label': running ? t('dl_cancel') : label,
            title: label,
            ...(running && running !== '…'
              ? {
                  role: 'progressbar',
                  'aria-valuenow': running,
                  'aria-valuemin': '0',
                  'aria-valuemax': '100',
                }
              : {}),
          },
        },
        running
          ? h('span', { className: 'ep-dl-pct' }, running === '…' ? '…' : running + '%')
          : done
            ? '✓'
            : icon('ic-download'),
      );
      actions.append(button);
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

  /**
   * `render` runs on every session change, and most of those affect one row or
   * none: a settings edit, a queue toggle, a background title arriving, a
   * status transition. Rebuilding a full archive each time (feeds routinely
   * carry thousands of items and there is no virtualization) was the app's
   * biggest source of jank. So the list is keyed by trackId and only rows whose
   * signature actually changed are replaced.
   */
  let renderedIds: string[] = [];
  const rowEls = new Map<string, HTMLElement>();
  const rowSigs = new Map<string, string>();
  let lastScrolledTrackId: string | null = null;

  /**
   * How many rows are in the DOM.
   *
   * The archive switch turned a 41-row list into a 2900-row one. Measured on
   * The Daily's full archive, building all of it cost ~125 ms of DOM work and
   * ~390 ms of layout on a desktop — half a second of blocked main thread for
   * rows nobody had scrolled to, and several times that on a phone.
   *
   * `content-visibility` on the row (see podcast.css) removes most of the
   * layout; this removes the rest by not creating the rows at all until
   * something asks for them. Sorting and filtering are unaffected: they happen
   * on the data in the controller, so the whole archive is always searched
   * whatever is currently on screen.
   */
  const RENDER_BATCH = 200;
  let renderLimit = RENDER_BATCH;
  let growObserver: IntersectionObserver | null = null;

  function resetRowCache(): void {
    renderedIds = [];
    rowEls.clear();
    rowSigs.clear();
  }

  /**
   * The end of the rendered window: a real button, so this works without an
   * IntersectionObserver and gives a keyboard user somewhere to go. The
   * observer just saves them the tap.
   */
  function growButton(remaining: number): HTMLElement {
    const btn = h(
      'button',
      {
        className: 's-btn ep-more',
        type: 'button',
        on: { click: () => grow() },
      },
      t('ep_show_more', remaining),
    );
    growObserver?.disconnect();
    growObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) grow();
      },
      // Start the next batch before the reader reaches the end, so scrolling a
      // long archive never stops at a button.
      { root: null, rootMargin: '600px' },
    );
    growObserver.observe(btn);
    return btn;
  }

  function grow(): void {
    const total = playback.session().filtered.length;
    if (renderLimit >= total) return;
    renderLimit = Math.min(total, renderLimit + RENDER_BATCH);
    renderList(playback.session());
  }

  /** Make sure an index is in the DOM — the playing row has to be scrollable to. */
  function ensureRendered(index: number): void {
    if (index < 0 || index < renderLimit) return;
    renderLimit = Math.min(
      playback.session().filtered.length,
      Math.ceil((index + 1) / RENDER_BATCH) * RENDER_BATCH,
    );
  }

  /** Identity of the list the window belongs to: feed, order and filters. */
  let windowKey = '';

  function renderList(s: PlaybackSession): void {
    const key = [s.meta?.id ?? '', s.sortAsc ? 'a' : 'd', s.mode, s.filter].join('\u0000');
    if (key !== windowKey) {
      windowKey = key;
      renderLimit = RENDER_BATCH;
      /**
       * A different list starts at its top. Keeping the old scroll offset left
       * the reader at an arbitrary point in a re-ordered archive, and with the
       * window back to one batch the browser clamped them onto the grow
       * sentinel, which then asked for the next batch straight away.
       */
      el.scrollTop = 0;
    }
    const loading = s.status.kind === 'loading';
    if (!s.filtered.length) {
      resetRowCache();
      if (loading) {
        epList.replaceChildren(skeleton());
        epList.setAttribute('aria-busy', 'true');
        return;
      }
      epList.setAttribute('aria-busy', 'false');
      if (s.status.kind === 'error') {
        epList.replaceChildren(
          stateBox('error', s.status.message || t('ep_not_found'), {
            onRetry: () => playback.retry(),
          }),
        );
      } else if (s.episodes.length) {
        // The show has episodes; a filter is what is hiding them.
        epList.replaceChildren(stateBox('empty', t('filter_no_match')));
      } else {
        epList.replaceChildren(stateBox('empty', t('ep_not_found')));
      }
      return;
    }

    const S = settings();
    // Built once per render: a per-row queuePosition() lookup would make this
    // O(episodes × queue) on every session change. Scoped to this feed — the
    // queue spans feeds now.
    const qPos = queuePositions(s.meta?.id ?? '');
    // The playing row has to be reachable even when it is past the window.
    ensureRendered(s.currentIndex);
    const window = s.filtered.slice(0, renderLimit);
    const ids = window.map((ep) => String(ep.trackId));
    const sameList =
      ids.length === renderedIds.length && ids.every((id, i) => renderedIds[i] === id);

    if (!sameList) {
      // Order, filter, feed or window changed — rebuild once.
      resetRowCache();
      const frag = document.createDocumentFragment();
      window.forEach((ep, i) => {
        const id = ids[i] as string;
        const row = episodeRow(ep, i, s, S, qPos);
        rowEls.set(id, row);
        rowSigs.set(id, rowSignature(ep, i, s, S, qPos));
        frag.append(row);
      });
      const remaining = s.filtered.length - window.length;
      if (remaining > 0) frag.append(growButton(remaining));
      else growObserver?.disconnect();
      renderedIds = ids;
      epList.replaceChildren(frag);
      applyRovingTabindex();
    } else {
      window.forEach((ep, i) => {
        const id = ids[i] as string;
        const sig = rowSignature(ep, i, s, S, qPos);
        if (rowSigs.get(id) === sig) return;
        const next = episodeRow(ep, i, s, S, qPos);
        rowEls.get(id)?.replaceWith(next);
        rowEls.set(id, next);
        rowSigs.set(id, sig);
      });
      applyRovingTabindex();
    }
    epList.setAttribute('aria-busy', 'false');

    // Only follow the playing episode when it actually changes. Doing it on
    // every render yanked the list out from under anyone browsing it.
    if (s.currentIndex >= 0 && s.currentTrackId !== lastScrolledTrackId) {
      lastScrolledTrackId = s.currentTrackId ?? null;
      rowEls.get(String(s.currentTrackId))?.scrollIntoView({ block: 'nearest' });
    } else if (s.currentIndex < 0) {
      lastScrolledTrackId = null;
    }
  }

  // ── reactive header + status render ──────────────────────────────
  function render(s: PlaybackSession): void {
    const meta = s.meta;
    titleEl.textContent = meta?.name || '—';
    authorEl.textContent = meta?.artist || '';
    const art = artAt(meta?.art, HEADER_ART_PX);
    if (art) {
      thumbEl.src = art;
      const set = artSrcset(meta?.art, dprWidths(HEADER_ART_PX));
      if (set) {
        thumbEl.srcset = set;
        thumbEl.sizes = `${HEADER_ART_PX}px`;
      } else {
        thumbEl.removeAttribute('srcset');
      }
    } else {
      thumbEl.removeAttribute('srcset');
      thumbEl.removeAttribute('src');
    }
    thumbEl.classList.toggle('has-art', !!art);
    countEl.textContent = String(s.episodes.length);
    favBtn.classList.toggle('faved', !!(meta && isSubscribed(meta.id)));

    dotEl.className = 'dot ' + s.status.kind;
    statusTextEl.textContent = s.status.message;

    sortInfoEl.textContent = s.sortAsc ? t('sort_asc_label') : t('sort_desc_label');
    renderModes(s);

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

  /**
   * Built here rather than written into the static markup: the labels are
   * translated, and `EPISODE_FILTERS` is the controller's own list, so a mode
   * added there shows up without a second edit.
   */
  const MODE_LABEL: Record<
    EpisodeFilter,
    'filter_all' | 'filter_unplayed' | 'filter_inprogress' | 'filter_downloaded'
  > = {
    all: 'filter_all',
    unplayed: 'filter_unplayed',
    inprogress: 'filter_inprogress',
    downloaded: 'filter_downloaded',
  };
  const modeButtons = new Map<EpisodeFilter, HTMLButtonElement>();
  // The chips scroll, the note does not: on a narrow screen four chips
  // overflow, and a count pushed off the end of a scroller is a count nobody
  // reads.
  const strip = h('div', { className: 'p-modes-strip' });
  for (const mode of EPISODE_FILTERS) {
    const btn = h('button', {
      className: 'p-mode',
      type: 'button',
      dataset: { mode },
      on: { click: () => playback.setFilterMode(mode) },
    });
    modeButtons.set(mode, btn);
    strip.append(btn);
  }
  const hiddenNote = h('span', { className: 'p-mode-note' });
  modesEl.append(strip, hiddenNote);

  function renderModes(s: PlaybackSession): void {
    for (const [mode, btn] of modeButtons) {
      btn.textContent = t(MODE_LABEL[mode]);
      const on = s.mode === mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    hiddenNote.textContent = s.hiddenByMode ? t('filter_hidden', s.hiddenByMode) : '';
    hiddenNote.hidden = !s.hiddenByMode;
  }

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
      (id.startsWith('rss:')
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
      if (actBtn.dataset.act === 'played') {
        const target = playback.session().filtered[idx];
        const wasPlayed = !!target && isPlayed(String(target.trackId), target.trackTimeMillis);
        playback.togglePlayed(idx);
        toast(wasPlayed ? t('toast_marked_unplayed') : t('toast_marked_played'));
      } else if (actBtn.dataset.act === 'queue') {
        playback.toggleQueued(idx);
      } else {
        // No optimistic label: the job registry publishes the real state, and
        // a hand-written one here would be overwritten a frame later anyway.
        void playback.downloadToggle(idx);
      }
      return;
    }
    const row = target.closest<HTMLElement>('.ep-item[data-idx]');
    if (row) activateRow(parseInt(row.dataset.idx ?? '-1', 10));
  });
  /**
   * Roving tabindex, plus the arrow-key model of a grid.
   *
   * One tab stop for the list rather than one per control: a 2900-episode
   * archive was 2900 tab stops before the window, and three times that counting
   * the queue and download buttons. `Tab` now lands on the list once; `↑`/`↓`
   * move between episodes and `←`/`→` between the controls of the row you are
   * on. Everything preventDefaults, so the global transport shortcuts (which
   * skip an event that has been handled) stay out of the way while the list has
   * focus.
   */
  let focusIndex = 0;

  /** The focusable controls of one row, in reading order. */
  function rowControls(row: HTMLElement): HTMLElement[] {
    return [...row.querySelectorAll<HTMLElement>('.ep-open, .ep-act')];
  }

  function renderedRows(): HTMLElement[] {
    return [...epList.querySelectorAll<HTMLElement>('.ep-item')];
  }

  /** Exactly one control in the whole list is tabbable. */
  function applyRovingTabindex(): void {
    const rows = renderedRows();
    if (!rows.length) return;
    focusIndex = Math.max(0, Math.min(focusIndex, rows.length - 1));
    for (const [i, row] of rows.entries()) {
      const open = row.querySelector<HTMLElement>('.ep-open');
      if (open) open.tabIndex = i === focusIndex ? 0 : -1;
    }
  }

  function focusRow(index: number): void {
    const rows = renderedRows();
    if (!rows.length) return;
    focusIndex = Math.max(0, Math.min(index, rows.length - 1));
    applyRovingTabindex();
    rows[focusIndex]?.querySelector<HTMLElement>('.ep-open')?.focus();
  }

  epList.addEventListener('focusin', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.ep-item');
    if (!row) return;
    const at = renderedRows().indexOf(row);
    if (at >= 0 && at !== focusIndex) {
      focusIndex = at;
      applyRovingTabindex();
    }
  });

  epList.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('.ep-item');
    if (!row) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRow(focusIndex + 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        focusRow(focusIndex - 1);
        return;
      case 'Home':
        e.preventDefault();
        focusRow(0);
        return;
      case 'End':
        e.preventDefault();
        focusRow(renderedRows().length - 1);
        return;
      case 'ArrowRight':
      case 'ArrowLeft': {
        const controls = rowControls(row);
        const at = controls.indexOf(target);
        if (at < 0) return;
        e.preventDefault();
        // Mirrored in RTL, so "next" always means "further along the row".
        const forward = (e.key === 'ArrowRight') !== (document.documentElement.dir === 'rtl');
        const next = controls[at + (forward ? 1 : -1)];
        next?.focus();
        return;
      }
      default:
        return;
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
  // The queue is no longer feed-scoped, so a mutation from anywhere (the queue
  // view, auto-next consuming an entry) must refresh this list's badges.
  queue.subscribe(() => render(playback.session()));
  // A mark changes a row badge and, under a state filter, the list itself. The
  // controller recomputes the session; this only has to repaint.
  playedRevision.subscribe(() => render(playback.session()));
  // A percentage moving is a row change like any other.
  downloadJobs.subscribe(() => render(playback.session()));
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
