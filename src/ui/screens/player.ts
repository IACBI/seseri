import type { Episode, FeedMeta, FeedRequest } from '../../feeds/types';
import { resolveFeed } from '../../feeds/resolve';
import { t, currentLang } from '../../i18n';
import { fmtDate, fmtDur, fmtTime } from '../../lib/format';
import { httpsOnly } from '../../lib/safe';
import {
  audio,
  embedStop,
  handleEmbedState,
  isUsingEmbed,
  onEngine,
  pbCurrent,
  pbDuration,
  pbPause,
  pbPaused,
  pbPlay,
  pbSeekTo,
  pbSetRate,
  setUsingEmbed,
} from '../../player/engine';
import { downloadEpisode } from '../../player/downloads';
import { setMediaMetadata } from '../../player/media-session';
import { setSleepTimer } from '../../player/sleep-timer';
import { getLastPlayed, getProgress, setLastPlayed, setProgress } from '../../storage/progress';
import { isSubscribed, toggleSubscription } from '../../storage/subscriptions';
import { settings, setSetting } from '../../state/settings';
import { ensureEmbed, getEmbed, onEmbedError, onEmbedStateChange, ytPlaylistIds, YT_STATE } from '../../youtube/embed';
import { ytServiceAudioUrl } from '../../youtube/piped';
import { svcJson } from '../../feeds/proxy-chain';
import { h, icon } from '../h';
import { must } from '../shell';
import { toast } from '../toast';
import { initWaveform, type WaveformController } from '../waveform';

export interface PlayerScreenDeps {
  /** Update the address bar for the opened feed (router integration). */
  onFeedOpened: (req: FeedRequest) => void;
  onClosed: () => void;
}

export interface PlayerScreen {
  openFeed(req: FeedRequest): void;
  /** Stop playback and reset session (called when routing back home). */
  reset(): void;
  isOpen(): boolean;
  el: HTMLElement;
}

export function initPlayerScreen(deps: PlayerScreenDeps): PlayerScreen {
  // ── element cache ────────────────────────────────────────────────
  const screen = must('playerScreen');
  const elDot = must('dot');
  const elStatusText = must('statusText');
  const elNowTitle = must('nowTitle');
  const elProgressWrap = must('progressWrap');
  const elTCur = must('tCur');
  const elTTot = must('tTot');
  const elBtnPlay = must<HTMLButtonElement>('btnPlay');
  const elPlayer = must('pPlayer');
  const elBtnPrev = must<HTMLButtonElement>('btnPrev');
  const elBtnNext = must<HTMLButtonElement>('btnNext');
  const elBtnSkipBack = must<HTMLButtonElement>('btnSkipBack');
  const elBtnSkipFwd = must<HTMLButtonElement>('btnSkipFwd');
  const elSpeedSel = must<HTMLSelectElement>('speedSel');
  const elSleepSel = must<HTMLSelectElement>('sleepSel');
  const elSortInfo = must('sortInfo');
  const elSortToggle = must<HTMLButtonElement>('sortToggle');
  const elEpList = must('epList');
  const elPEpCount = must('pEpCount');
  const elLblSkipBack = must('lblSkipBack');
  const elLblSkipFwd = must('lblSkipFwd');
  const elFilterInput = must<HTMLInputElement>('filterInput');
  const elPTitle = must('pTitle');
  const elPAuthor = must('pAuthor');
  const elPThumb = must<HTMLImageElement>('pThumb');
  const elFavBtn = must<HTMLButtonElement>('favBtn');
  const elShareBtn = must<HTMLButtonElement>('shareBtn');
  const elBackBtn = must<HTMLButtonElement>('backBtn');

  // ── session state ────────────────────────────────────────────────
  let episodes: Episode[] = [];
  let filteredEps: Episode[] = [];
  let currentIndex = -1;
  let currentTrackId: string | null = null;
  let currentMeta: FeedMeta | null = null;
  let feedIsYT = false;
  let ytLimited = false;
  let sortAsc = true;
  let loadAbort: AbortController | null = null;
  let animateNextRender = false;
  let enterTimer: ReturnType<typeof setTimeout> | null = null;

  // ── waveform ─────────────────────────────────────────────────────
  const wave: WaveformController = initWaveform(
    {
      wrap: elProgressWrap,
      base: must('waveBase'),
      fill: must('waveFill'),
      head: must('waveHead'),
      tip: must('waveTip'),
    },
    {
      seekRel,
      skipBack: () => settings().skipBack,
      skipFwd: () => settings().skipForward,
    },
  );
  wave.build('seseri'); // placeholder until the first episode loads

  // ── status strip ─────────────────────────────────────────────────
  function setStatus(type: 'loading' | 'ok' | 'error', txt: string): void {
    elDot.className = 'dot ' + type;
    elStatusText.textContent = txt;
  }
  let statusRestore: ReturnType<typeof setTimeout> | null = null;
  function flashStatus(msg: string): void {
    setStatus('ok', msg);
    if (statusRestore) clearTimeout(statusRestore);
    statusRestore = setTimeout(() => {
      if (episodes.length) setStatus('ok', okStatusText());
    }, 3000);
  }
  function okStatusText(): string {
    return t('status_ok', episodes.length) + (ytLimited ? ' · ' + t('yt_limit_note') : '');
  }

  // ── now-playing title crossfade ──────────────────────────────────
  let titleTimer: ReturnType<typeof setTimeout> | null = null;
  function setNowTitle(text: string): void {
    if (elNowTitle.textContent === text) return;
    elNowTitle.classList.add('swapping');
    if (titleTimer) clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      elNowTitle.textContent = text;
      elNowTitle.classList.remove('swapping');
    }, 150);
  }

  // ── idle / play icon / nav buttons ───────────────────────────────
  function setPlayerIdle(idle: boolean): void {
    elPlayer.classList.toggle('idle', idle);
    elBtnPlay.disabled = idle;
    elBtnSkipBack.disabled = idle;
    elBtnSkipFwd.disabled = idle;
    elProgressWrap.setAttribute('aria-disabled', idle ? 'true' : 'false');
    if (idle) elProgressWrap.removeAttribute('tabindex');
    else elProgressWrap.setAttribute('tabindex', '0');
  }
  function setPlayIcon(playing: boolean): void {
    const u = elBtnPlay.querySelector('use');
    if (u) u.setAttribute('href', playing ? '#ic-pause' : '#ic-play');
    elBtnPlay.setAttribute('aria-label', playing ? t('pause') : t('play'));
  }
  function updateNavButtons(): void {
    elBtnPrev.disabled = currentIndex <= 0;
    elBtnNext.disabled = currentIndex < 0 || currentIndex >= filteredEps.length - 1;
  }

  // ── episode list rendering (typed DOM, no innerHTML with data) ───
  function render(): void {
    if (!filteredEps.length) {
      elEpList.replaceChildren(h('div', { className: 'empty-state' }, t('ep_not_found')));
      return;
    }
    const S = settings();
    const frag = document.createDocumentFragment();
    filteredEps.forEach((ep, i) => {
      const id = String(ep.trackId);
      const hasSaved = S.resumePos && getProgress(id) > 5;
      const active = i === currentIndex;

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
      if (hasSaved) {
        dateDur.append(' ', h('span', { className: 'ep-saved-badge' }, t('ep_saved_badge')));
      }

      const row = h(
        'div',
        {
          className: 'ep-item' + (active ? ' active' : ''),
          role: 'button',
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
      if (S.showDl) {
        row.append(
          h(
            'div',
            { className: 'ep-actions' },
            h(
              'button',
              {
                className: 'ep-dl-btn',
                dataset: { idx: String(i) },
                attrs: { 'aria-label': t('dl_label') },
              },
              icon('ic-download'),
            ),
          ),
        );
      }
      frag.append(row);
    });
    elEpList.replaceChildren(frag);

    if (animateNextRender) {
      animateNextRender = false;
      elEpList.classList.add('entering');
      if (enterTimer) clearTimeout(enterTimer);
      enterTimer = setTimeout(() => elEpList.classList.remove('entering'), 700);
    }
    if (currentIndex >= 0) {
      elEpList.querySelector('.ep-item.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function showSkeleton(rows = 8): void {
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
    elEpList.replaceChildren(list);
  }

  function showError(message: string): void {
    setStatus('error', t('status_err') + message);
    elEpList.replaceChildren(
      h(
        'div',
        { className: 'empty-state', style: 'color:var(--red)' },
        message,
        h('br'),
        h('br'),
        t('retry'),
      ),
    );
  }

  // ── feed opening (unified — replaces loadPodcast/loadRss/loadYouTube) ──
  function openFeed(req: FeedRequest): void {
    loadAbort?.abort();
    loadAbort = new AbortController();
    const signal = loadAbort.signal;
    const timeout = setTimeout(() => loadAbort?.abort(), req.kind === 'itunes' ? 10000 : 25000);

    embedStop();
    setUsingEmbed(false);
    feedIsYT = req.kind === 'yt';
    elPlayer.classList.toggle('yt-mode', feedIsYT);
    currentMeta = null;
    currentIndex = -1;
    currentTrackId = null;
    episodes = [];
    filteredEps = [];

    screen.style.display = 'flex';
    must('searchScreen').style.display = 'none';
    screen.classList.remove('screen-enter');
    void screen.offsetWidth;
    screen.classList.add('screen-enter');

    setPlayerIdle(true);
    setStatus('loading', t('status_loading'));
    showSkeleton();
    elNowTitle.textContent = t('pick_episode');
    updateFavBtn();
    deps.onFeedOpened(req);

    void (async () => {
      try {
        const resolved = await resolveFeed(req, {
          signal,
          ytVideoTitle: t('yt_video'),
          playlistIds: ytPlaylistIds,
        });
        clearTimeout(timeout);
        if (signal.aborted) return;

        currentMeta = resolved.meta;
        ytLimited = resolved.limited;
        elPTitle.textContent = resolved.meta.name || '—';
        elPAuthor.textContent = resolved.meta.artist || '';
        elPThumb.src = httpsOnly(resolved.meta.art);
        document.title = `${resolved.meta.name || 'Podcast'} – Seseri`;
        updateFavBtn();

        const eps = resolved.episodes;
        if (!eps.length) throw new Error(t('ep_not_found'));

        const S = settings();
        sortAsc = S.defaultSort === 'asc';
        const hasDates = eps.some((e) => e.releaseDate);
        episodes = hasDates
          ? eps.slice().sort((a, b) => +new Date(a.releaseDate || 0) - +new Date(b.releaseDate || 0))
          : eps.slice().reverse(); // newest-first source order → oldest-first
        if (!sortAsc) episodes.reverse();
        elSortInfo.textContent = sortAsc ? t('sort_asc_label') : t('sort_desc_label');
        filteredEps = episodes.slice();
        elFilterInput.value = '';
        elPEpCount.textContent = String(episodes.length);
        setStatus('ok', okStatusText());
        elSpeedSel.value = String(S.defaultSpeed);
        audio.playbackRate = S.defaultSpeed;
        animateNextRender = true;
        render();

        // Embed fallback may leave title-less items — fill real titles in bg
        if (feedIsYT && episodes.some((e) => e.ytId && !e.trackName)) {
          void fillEmbedTitles(signal);
        }

        const lastId = getLastPlayed(currentMeta.id);
        if (lastId) {
          const idx = filteredEps.findIndex((e) => String(e.trackId) === lastId);
          if (idx >= 0) loadEp(idx, false);
        }
      } catch (e) {
        clearTimeout(timeout);
        const err = e as Error;
        if (err.name === 'AbortError') return;
        showError(err.message || String(err));
      }
    })();
  }

  /** Background-fill real titles via noembed (embed fallback items). */
  async function fillEmbedTitles(signal: AbortSignal): Promise<void> {
    const targets = episodes.filter((e) => e.ytId && !e.trackName);
    if (!targets.length) return;
    let i = 0;
    let since = 0;
    const reRender = () => {
      if (feedIsYT && !signal.aborted) render();
    };
    const worker = async () => {
      while (i < targets.length) {
        if (signal.aborted) return;
        const ep = targets[i++];
        if (!ep) break;
        try {
          const r = await svcJson<{ title?: string }>(
            'https://noembed.com/embed?url=https://www.youtube.com/watch?v=' +
              encodeURIComponent(ep.ytId ?? ''),
            signal,
            8000,
          );
          if (r?.title) {
            ep.trackName = r.title;
            if (++since >= 6) {
              since = 0;
              reRender();
            }
          }
        } catch {
          /* title stays a fallback */
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    reRender();
  }

  // ── playback ─────────────────────────────────────────────────────
  function loadEp(idx: number, autoplay: boolean): void {
    if (idx < 0 || idx >= filteredEps.length) return;
    currentIndex = idx;
    const ep = filteredEps[idx];
    if (!ep) return;
    const id = String(ep.trackId);
    currentTrackId = id;
    const src = ep.episodeUrl || '';

    setPlayerIdle(false);
    setNowTitle(ep.trackName || t('ep_fallback', idx + 1));
    wave.build(id);
    wave.setProgress(0);
    elTCur.textContent = '0:00';
    elTTot.textContent = '0:00';

    if (feedIsYT) {
      void ytResolveAndPlay(ep, id, autoplay);
    } else {
      startAudio(src, id, autoplay);
    }

    setMediaMetadata({
      title: ep.trackName || '',
      artist: elPAuthor.textContent || '',
      album: elPTitle.textContent || '',
      artworkUrl: elPThumb.src || '',
    });

    elSpeedSel.value = String(settings().defaultSpeed);
    updateNavButtons();
    if (currentMeta) setLastPlayed(currentMeta.id, id);
    render();
  }

  function startAudio(src: string, id: string, autoplay: boolean): void {
    embedStop();
    setUsingEmbed(false);
    audio.src = src;
    audio.load();
    const applyPrefs = () => {
      const S = settings();
      audio.playbackRate = S.defaultSpeed;
      if (S.resumePos) {
        const saved = getProgress(id);
        if (saved > 5 && isFinite(audio.duration) && saved < audio.duration - 2) {
          audio.currentTime = saved;
        }
      }
      if (isFinite(audio.duration) && audio.duration) {
        wave.setProgress((audio.currentTime / audio.duration) * 100);
        elTCur.textContent = fmtTime(audio.currentTime);
        elTTot.textContent = fmtTime(audio.duration);
      }
    };
    if (audio.readyState >= 2) applyPrefs();
    else audio.addEventListener('canplay', applyPrefs, { once: true });
    if (autoplay) {
      audio.play().catch(() => {
        /* autoplay blocked */
      });
    }
  }

  async function ytResolveAndPlay(ep: Episode, id: string, autoplay: boolean): Promise<void> {
    audio.pause();
    setStatus('loading', t('status_loading'));
    let url: string | null = null;
    try {
      url = await ytServiceAudioUrl(ep.ytId ?? '', loadAbort?.signal);
    } catch {
      url = null;
    }
    if (!feedIsYT || currentTrackId !== id) return; // user moved on
    if (url) {
      ep.episodeUrl = url; // real media URL → download works too
      startAudio(url, id, autoplay);
      setStatus('ok', okStatusText());
    } else {
      setUsingEmbed(true);
      await embedLoadEp(ep, autoplay);
    }
  }

  async function embedLoadEp(ep: Episode, autoplay: boolean): Promise<void> {
    setStatus('loading', t('status_loading'));
    try {
      await ensureEmbed();
    } catch {
      setStatus('error', t('yt_embed_blocked'));
      return;
    }
    if (!feedIsYT || currentTrackId !== String(ep.trackId)) return;
    const S = settings();
    const savedPos = S.resumePos && getProgress(String(ep.trackId)) > 5 ? getProgress(String(ep.trackId)) : 0;
    const p = getEmbed();
    if (!p) return;
    try {
      const opts = { videoId: ep.ytId ?? '', startSeconds: savedPos, suggestedQuality: 'small' };
      if (autoplay) p.loadVideoById(opts);
      else p.cueVideoById(opts);
      try {
        p.setPlaybackQuality('small');
      } catch {
        /* older API */
      }
      pbSetRate(S.defaultSpeed);
    } catch {
      setStatus('error', t('yt_embed_blocked'));
      return;
    }
    setStatus('ok', okStatusText());
  }

  function togglePlay(): void {
    if (!feedIsYT && !audio.src) return;
    if (currentTrackId == null) return;
    if (pbPaused()) pbPlay();
    else pbPause();
  }

  function seekRel(s: number): void {
    const dur = pbDuration();
    if (!feedIsYT && !audio.src) return;
    if (!Number.isFinite(dur) || !dur) return;
    pbSeekTo(Math.max(0, Math.min(pbCurrent() + s, dur)));
  }

  function prevEp(): void {
    if (currentIndex > 0) loadEp(currentIndex - 1, !pbPaused());
  }
  function nextEp(): void {
    if (currentIndex >= 0 && currentIndex < filteredEps.length - 1) loadEp(currentIndex + 1, !pbPaused());
  }

  // ── sort & filter ────────────────────────────────────────────────
  function toggleSort(): void {
    sortAsc = !sortAsc;
    episodes.reverse();
    filteredEps.reverse();
    if (currentTrackId != null) {
      currentIndex = filteredEps.findIndex((e) => String(e.trackId) === currentTrackId);
    }
    elSortInfo.textContent = sortAsc ? t('sort_asc_label') : t('sort_desc_label');
    updateNavButtons();
    render();
  }

  let filterTimer: ReturnType<typeof setTimeout> | null = null;
  function filterEps(): void {
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      const q = elFilterInput.value.trim().toLowerCase();
      filteredEps = q
        ? episodes.filter((e) => (e.trackName || '').toLowerCase().includes(q))
        : episodes.slice();
      currentIndex =
        currentTrackId != null
          ? filteredEps.findIndex((e) => String(e.trackId) === currentTrackId)
          : -1;
      updateNavButtons();
      render();
    }, 200);
  }

  // ── favorites / share ────────────────────────────────────────────
  function updateFavBtn(): void {
    elFavBtn.classList.toggle('faved', !!(currentMeta && isSubscribed(currentMeta.id)));
  }
  function share(): void {
    if (!currentMeta) return;
    const id = String(currentMeta.id);
    const url =
      location.origin +
      location.pathname +
      (id.startsWith('yt:')
        ? '?yt=' + encodeURIComponent(currentMeta.yt || '')
        : id.startsWith('rss:')
          ? '?rss=' + encodeURIComponent(id.slice(4))
          : '?podcast=' + encodeURIComponent(id));
    if (navigator.share) {
      navigator.share({ title: currentMeta.name || 'Podcast', url }).catch(() => {
        /* user cancelled */
      });
      return;
    }
    navigator.clipboard
      ?.writeText(url)
      .then(() => flashStatus(t('link_copied')))
      .catch(() => {
        /* clipboard unavailable */
      });
  }

  // ── downloads ────────────────────────────────────────────────────
  async function onDownload(idx: number, btn: HTMLButtonElement): Promise<void> {
    const ep = filteredEps[idx];
    if (!ep) return;
    btn.textContent = '⏳';
    const outcome = await downloadEpisode(ep, feedIsYT);
    if (outcome === 'no-url') {
      btn.textContent = '⤓';
      toast(t('dl_not_found'), 'error');
      return;
    }
    setTimeout(() => {
      btn.textContent = '✓';
      btn.className = 'ep-dl-btn done';
    }, 1000);
  }

  // ── progress persistence + engine events ────────────────────────
  function updateProgressUI(current: number, duration: number): void {
    const pct = duration ? (current / duration) * 100 : 0;
    if (!wave.isScrubbing()) wave.setProgress(pct);
    elTCur.textContent = fmtTime(current);
    elTTot.textContent = fmtTime(duration);
    const ep = currentIndex >= 0 ? filteredEps[currentIndex] : undefined;
    if (ep && current > 5) setProgress(String(ep.trackId), current);
  }

  onEngine((e) => {
    switch (e.type) {
      case 'play':
        setPlayIcon(true);
        elPlayer.classList.add('playing');
        document.body.classList.add('is-playing');
        // Fill title from embed video data when missing (single-video feeds)
        if (isUsingEmbed()) {
          try {
            const ep = currentIndex >= 0 ? filteredEps[currentIndex] : undefined;
            const d = getEmbed()?.getVideoData?.();
            if (ep && !ep.trackName && d?.title) {
              ep.trackName = d.title;
              setNowTitle(d.title);
              render();
            }
          } catch {
            /* embed data unavailable */
          }
        }
        break;
      case 'pause':
        setPlayIcon(false);
        elPlayer.classList.remove('playing');
        document.body.classList.remove('is-playing');
        break;
      case 'ended':
        if (settings().autoNext && currentIndex < filteredEps.length - 1) {
          loadEp(currentIndex + 1, true);
        }
        break;
      case 'timeupdate':
        updateProgressUI(e.current, e.duration);
        break;
      case 'error':
        setStatus('error', t('audio_err'));
        setPlayIcon(false);
        elPlayer.classList.remove('playing');
        document.body.classList.remove('is-playing');
        break;
    }
  });
  onEmbedStateChange(handleEmbedState);
  onEmbedError(() => setStatus('error', t('yt_embed_blocked')));

  // Also route ENDED from embed into auto-next via engine 'ended' (already
  // emitted by handleEmbedState), and PLAYING fills titles via 'play' above.
  void YT_STATE;

  // ── event wiring (no inline handlers) ───────────────────────────
  elEpList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const dlBtn = target.closest<HTMLButtonElement>('.ep-dl-btn');
    if (dlBtn) {
      e.stopPropagation();
      void onDownload(parseInt(dlBtn.dataset.idx ?? '-1'), dlBtn);
      return;
    }
    const row = target.closest<HTMLElement>('.ep-item[data-idx]');
    if (row) loadEp(parseInt(row.dataset.idx ?? '-1'), true);
  });
  elEpList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.ep-item[data-idx]');
    if (row) {
      e.preventDefault();
      e.stopPropagation();
      loadEp(parseInt(row.dataset.idx ?? '-1'), true);
    }
  });

  elBtnPlay.addEventListener('click', togglePlay);
  elBtnPrev.addEventListener('click', prevEp);
  elBtnNext.addEventListener('click', nextEp);
  elBtnSkipBack.addEventListener('click', () => seekRel(-settings().skipBack));
  elBtnSkipFwd.addEventListener('click', () => seekRel(settings().skipForward));
  elSortToggle.addEventListener('click', toggleSort);
  elFilterInput.addEventListener('input', filterEps);
  elFavBtn.addEventListener('click', () => {
    if (currentMeta) {
      toggleSubscription(currentMeta);
      updateFavBtn();
    }
  });
  elShareBtn.addEventListener('click', share);
  elBackBtn.addEventListener('click', () => history.back());

  elSpeedSel.addEventListener('change', () => {
    const speed = parseFloat(elSpeedSel.value) || 1;
    setSetting('defaultSpeed', speed);
    pbSetRate(speed);
  });
  elSleepSel.addEventListener('change', () => {
    const min = parseInt(elSleepSel.value) || 0;
    elSleepSel.classList.toggle('active', min > 0);
    if (min > 0) flashStatus(t('sleep_set', min));
    setSleepTimer(min, () => {
      elSleepSel.value = '0';
      elSleepSel.classList.remove('active');
      flashStatus(t('sleep_done'));
    });
  });

  // Global keyboard shortcuts (player screen only)
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || target.isContentEditable) return;
    if (screen.style.display !== 'flex') return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekRel(-settings().skipBack);
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekRel(settings().skipForward);
        break;
      case 'ArrowUp':
        e.preventDefault();
        prevEp();
        break;
      case 'ArrowDown':
        e.preventDefault();
        nextEp();
        break;
    }
  });

  // Language change → re-render list dates/durations + dynamic labels
  currentLang.subscribe(() => {
    if (elBtnPlay) setPlayIcon(!pbPaused() && currentTrackId != null);
    elSortInfo.textContent = sortAsc ? t('sort_asc_label') : t('sort_desc_label');
    if (currentTrackId == null) elNowTitle.textContent = t('pick_episode');
    if (episodes.length) render();
  });

  // Settings change → skip labels + dl button visibility
  settings.subscribe((S) => {
    elLblSkipBack.textContent = String(S.skipBack);
    elLblSkipFwd.textContent = String(S.skipForward);
    if (episodes.length) render();
  });

  function reset(): void {
    audio.pause();
    embedStop();
    setUsingEmbed(false);
    feedIsYT = false;
    loadAbort?.abort();
    episodes = [];
    filteredEps = [];
    currentIndex = -1;
    currentTrackId = null;
    currentMeta = null;
    document.title = 'Seseri';
    elNowTitle.textContent = t('pick_episode');
    wave.setProgress(0);
    elTCur.textContent = '0:00';
    elTTot.textContent = '0:00';
    setPlayIcon(false);
    elFilterInput.value = '';
    screen.style.display = 'none';
    deps.onClosed();
  }

  return {
    openFeed,
    reset,
    isOpen: () => screen.style.display === 'flex',
    el: screen,
  };
}
