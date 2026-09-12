/**
 * Now Playing sheet — full-screen at every size.
 * Hero: the signature frequency-line scrubber (waveform.ts). Transport,
 * skip, speed, sleep timer and queue access live here.
 * Sheet chrome (open/close animation) lives in overlays.css; the inner
 * content is styled in views/now-playing.css + the shared signal-line.css.
 * Not a history entry (v1 decision) — Escape/close dismisses.
 */

import { currentLang, t } from '../../i18n';
import type { Episode } from '../../feeds/types';
import { requestFromFeedId } from '../../feeds/feed-id';
import { fetchChapters, chapterAt, type Chapter } from '../../player/chapters';
import {
  cueAt,
  fetchTranscript,
  pickTranscript,
  type Cue,
} from '../../player/transcript';
import { artAt, artSrcset } from '../../lib/art';
import { fmtTime } from '../../lib/format';
import { shareUrlFor } from '../router';
import { toast } from '../toast';
import { httpsOnly } from '../../lib/safe';
import { onEngine, pbCurrent, pbDuration, pbSeekTo, pbSetRate } from '../../player/engine';
import { loadEpisodeNotes } from '../../feeds/episode-notes';
import { hasShowNotes, parseShowNotes } from '../../feeds/show-notes';
import { updateAmbient } from '../ambient';
import { h } from '../h';
import { initMarquee } from '../marquee';
import { initSleepControl } from '../sleep-control';
import { initVolumeControl } from '../volume-control';
import {
  nowPlayingLabel,
  playing,
  type NowPlayingLabel,
  type PlayingSession,
} from '../../player/session';
import { queue } from '../../state/queue';
import { setSetting, settings, type Settings } from '../../state/settings';
import { feedSpeedRevision, hasOwnSpeed, setFeedSpeed, speedFor } from '../../state/feed-speed';
import type { PlaybackController } from '../playback-controller';
import { must } from '../shell';
import { initWaveform, type WaveformController } from '../waveform';

export interface NowPlayingDeps {
  playback: PlaybackController;
  /** Navigate to the queue view. */
  openQueue(): void;
}

export interface NowPlayingSheet {
  open(): void;
  close(): void;
  isOpen(): boolean;
  el: HTMLElement;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];

export function initNowPlaying(deps: NowPlayingDeps): NowPlayingSheet {
  const { playback } = deps;
  const el = must('npSheet');

  el.innerHTML = `
    <div class="np-inner">
      <header class="np-top">
        <button class="icon-btn np-close" id="npClose" data-i18n-aria="np_close" aria-label="Oynatıcıyı kapat"><svg class="icon" aria-hidden="true"><use href="#ic-chevron-down"/></svg></button>
        <span class="np-feed" id="npFeed"></span>
        <button class="icon-btn np-share" id="npShare" data-i18n-aria="share_episode" aria-label="Bölümü paylaş"><svg class="icon" aria-hidden="true"><use href="#ic-share"/></svg></button>
      </header>

      <div class="np-player" id="npPlayer">
        <div class="np-stage">
          <picture class="np-pic">
            <source id="npArtWebp" type="image/webp">
            <img class="np-art" id="npArt" alt="" width="640" height="640" fetchpriority="high" decoding="async">
          </picture>
        </div>

        <div class="np-controls">
        <h1 class="np-title" id="nowTitle">Bir bölüm seçin</h1>

        <div class="signal-scrub" id="progressWrap" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-i18n-aria="seek_label" aria-label="Konum">
          <div class="signal-layers">
            <div class="signal-base" id="waveBase" aria-hidden="true"></div>
            <div class="signal-fill" id="waveFill" aria-hidden="true"></div>
            <div class="signal-baseline" aria-hidden="true"></div>
            <div class="signal-head" id="waveHead" aria-hidden="true"></div>
            <div class="signal-tip" id="waveTip" aria-hidden="true"></div>
            <div class="signal-chapters" id="waveChapters" aria-hidden="true"></div>
          </div>
        </div>

        <div class="np-times">
          <span class="np-time" id="tCur">0:00</span>
          <span class="np-time" id="tTot">0:00</span>
        </div>

        <div class="np-transport">
          <button class="icon-btn np-tp" id="btnPrev" data-i18n-aria="btn_prev" aria-label="Önceki"><svg class="icon" aria-hidden="true"><use href="#ic-prev"/></svg></button>
          <button class="icon-btn np-tp" id="btnSkipBack" data-i18n-aria="s_skip_back" aria-label="Geri Atla"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-rewind"/><text class="skip-n" id="lblSkipBack" x="12" y="12" text-anchor="middle" dominant-baseline="central">15</text></svg></button>
          <button class="np-play" id="btnPlay" data-i18n-aria="play" aria-label="Oynat"><svg class="icon icon-fill" aria-hidden="true"><use href="#ic-play"/></svg></button>
          <button class="icon-btn np-tp" id="btnSkipFwd" data-i18n-aria="s_skip_fwd" aria-label="İleri Atla"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-forward"/><text class="skip-n" id="lblSkipFwd" x="12" y="12" text-anchor="middle" dominant-baseline="central">30</text></svg></button>
          <button class="icon-btn np-tp" id="btnNext" data-i18n-aria="btn_next" aria-label="Sonraki"><svg class="icon" aria-hidden="true"><use href="#ic-next"/></svg></button>
        </div>

        <div class="vol np-volume" id="npVolume">
          <button class="icon-btn vol-btn np-vol-btn" id="npVolBtn" type="button" aria-label="Sesi kapat"><svg class="icon" aria-hidden="true"><use href="#ic-volume"/></svg></button>
          <input class="range np-vol-range" id="npVolRange" type="range" min="0" max="100" step="1" value="100" data-i18n-aria="volume_label" aria-label="Ses düzeyi">
        </div>

        <div class="np-secondary">
          <label class="np-sec-ctl np-sleep">
            <svg class="icon" aria-hidden="true"><use href="#ic-moon"/></svg>
            <select class="seri-select np-sel" id="sleepSel" data-i18n-aria="sleep_timer" aria-label="Uyku zamanlayıcısı (dk)"></select>
            <span class="np-sleep-left mono" id="sleepLeft" data-i18n-aria="sleep_remaining" aria-label="Kalan uyku süresi" aria-live="off" hidden></span>
            <button class="np-sleep-plus" id="sleepPlus" type="button" title="+5" hidden>+5</button>
          </label>
          <label class="np-sec-ctl">
            <span class="np-sec-glyph" aria-hidden="true">×</span>
            <select class="seri-select np-sel" id="speedSel" data-i18n-aria="speed_label" aria-label="Oynatma hızı"></select>
          </label>
          <button class="icon-btn np-queue" id="queueToggle" data-i18n-aria="queue_title" aria-label="Çalma kuyruğu"><svg class="icon" aria-hidden="true"><use href="#ic-queue"/></svg><span class="np-queue-badge" id="queueCount" aria-hidden="true">0</span></button>
        </div>

        <details class="np-notes np-chapters" id="npChapters" hidden>
          <summary class="np-notes-toggle" id="npChaptersToggle">Bölüm işaretleri</summary>
          <div class="np-chapter-list" id="npChapterList" role="list"></div>
        </details>

        <details class="np-notes np-transcript" id="npTranscript" hidden>
          <summary class="np-notes-toggle" data-i18n="np_transcript">Konuşma metni</summary>
          <div class="np-transcript-body" id="npTranscriptBody" role="list"></div>
        </details>

        <details class="np-notes" id="npNotes" hidden>
          <summary class="np-notes-toggle" data-i18n="np_notes">Bölüm notları</summary>
          <div class="np-notes-body" id="npNotesBody"></div>
        </details>
        </div>
      </div>
    </div>`;

  // ── element cache ────────────────────────────────────────────────
  const player = must('npPlayer');
  const art = must<HTMLImageElement>('npArt');
  const artWebp = must<HTMLSourceElement>('npArtWebp');
  const feedLine = initMarquee(must('npFeed'));
  const titleEl = must('nowTitle');
  const elTCur = must('tCur');
  const elTTot = must('tTot');
  const btnPlay = must<HTMLButtonElement>('btnPlay');
  const btnPrev = must<HTMLButtonElement>('btnPrev');
  const btnNext = must<HTMLButtonElement>('btnNext');
  const btnSkipBack = must<HTMLButtonElement>('btnSkipBack');
  const btnSkipFwd = must<HTMLButtonElement>('btnSkipFwd');
  const lblSkipBack = must('lblSkipBack');
  const lblSkipFwd = must('lblSkipFwd');
  const speedSel = must<HTMLSelectElement>('speedSel');
  const queueBtn = must<HTMLButtonElement>('queueToggle');
  const queueCount = must('queueCount');
  const notesEl = must<HTMLDetailsElement>('npNotes');
  const notesBody = must('npNotesBody');
  const shareBtn = must<HTMLButtonElement>('npShare');
  const chaptersEl = must<HTMLDetailsElement>('npChapters');
  const chaptersToggle = must('npChaptersToggle');
  const chapterListEl = must('npChapterList');
  const waveChapters = must('waveChapters');
  const transcriptEl = must<HTMLDetailsElement>('npTranscript');
  const transcriptBody = must('npTranscriptBody');

  // ── waveform / frequency line ────────────────────────────────────
  const wave: WaveformController = initWaveform(
    {
      wrap: must('progressWrap'),
      base: must('waveBase'),
      fill: must('waveFill'),
      head: must('waveHead'),
      tip: must('waveTip'),
    },
    {
      seekRel: (s) => playback.seekRel(s),
      skipBack: () => settings().skipBack,
      skipFwd: () => settings().skipForward,
    },
  );
  wave.build('seseri'); // placeholder line until the first episode loads

  // ── select options ───────────────────────────────────────────────
  for (const v of SPEEDS) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = v + '×';
    speedSel.appendChild(o);
  }
  initSleepControl({
    select: must<HTMLSelectElement>('sleepSel'),
    countdown: must('sleepLeft'),
    extend: must<HTMLButtonElement>('sleepPlus'),
  });
  initVolumeControl({
    root: must('npVolume'),
    button: must<HTMLButtonElement>('npVolBtn'),
    slider: must<HTMLInputElement>('npVolRange'),
  });

  // ── play icon / title crossfade ──────────────────────────────────
  let iconShowsPlaying = false;
  function setPlayIcon(isPlaying: boolean): void {
    const u = btnPlay.querySelector('use');
    if (u) u.setAttribute('href', isPlaying ? '#ic-pause' : '#ic-play');
    btnPlay.setAttribute('aria-label', isPlaying ? t('pause') : t('play'));
  }

  let titleTimer: ReturnType<typeof setTimeout> | null = null;
  function setNowTitle(text: string): void {
    if (titleEl.textContent === text) return;
    titleEl.classList.add('swapping');
    if (titleTimer) clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      titleEl.textContent = text;
      // Three lines cover almost everything; the rest stays on hover.
      titleEl.title = text;
      titleEl.classList.remove('swapping');
    }, 150);
  }

  function updateQueueCount(n: number): void {
    queueCount.textContent = String(n);
    queueBtn.classList.toggle('has-queue', n > 0);
  }

  /**
   * Share the episode, and the moment when there is one.
   *
   * Past 30 seconds the listener is somewhere in the middle of something, and
   * "listen to this bit" is what they mean; before that they mean "listen to
   * this". The label says which, so the link is never a surprise.
   */
  const SHARE_POSITION_FLOOR_SEC = 30;

  function sharePayload(): { url: string; at: number } | null {
    const s = playing();
    if (!s) return null;
    const req = requestFromFeedId(s.feedId);
    if (!req) return null;
    const current = pbCurrent();
    const at = Number.isFinite(current) && current > SHARE_POSITION_FLOOR_SEC ? Math.floor(current) : 0;
    return { url: shareUrlFor(req, { episodeId: s.trackId, ...(at ? { at } : {}) }), at };
  }

  function refreshShareLabel(): void {
    const payload = sharePayload();
    shareBtn.hidden = !payload;
    if (!payload) return;
    const label = payload.at ? t('share_episode_at', fmtTime(payload.at)) : t('share_episode');
    shareBtn.setAttribute('aria-label', label);
    shareBtn.title = label;
  }

  shareBtn.addEventListener('click', () => {
    const payload = sharePayload();
    if (!payload) return;
    const label = nowPlayingLabel(playing());
    const title = label?.title || 'Seseri';
    if (navigator.share) {
      navigator.share({ title, url: payload.url }).catch(() => {
        /* user cancelled */
      });
      return;
    }
    void navigator.clipboard
      ?.writeText(payload.url)
      .then(() => toast(payload.at ? t('link_copied_at', fmtTime(payload.at)) : t('link_copied')))
      .catch(() => {
        /* clipboard unavailable */
      });
  });

  /**
   * Chapters and the transcript.
   *
   * Both are per-episode files hosted wherever the publisher put them, so both
   * are fetched rather than parsed out of the feed — and both are optional in
   * the strongest sense: an episode with neither shows neither panel, and a
   * host that refuses the request is the same as an episode with neither.
   *
   * Chapters load as soon as the episode does, because they also draw the
   * markers on the scrubber. The transcript waits until somebody opens the
   * panel: it can be half a megabyte, and fetching one per episode for a
   * listener who never reads them would be pure waste.
   */
  let chapters: Chapter[] = [];
  let activeChapter = -1;
  /** The duration the markers were laid out for; 0 until one is known. */
  let markedFor = 0;
  const chapterRows: HTMLElement[] = [];
  let chapterLoad: AbortController | null = null;

  let cues: Cue[] = [];
  let activeCue = -1;
  const cueRows: HTMLElement[] = [];
  let transcriptLoad: AbortController | null = null;
  let transcriptState: 'none' | 'idle' | 'loading' | 'ready' | 'failed' = 'none';
  /** The episode the transcript belongs to, so a late answer can be dropped. */
  let transcriptFor: string | null = null;

  function clearChapters(): void {
    chapterLoad?.abort();
    chapterLoad = null;
    chapters = [];
    activeChapter = -1;
    markedFor = 0;
    chapterRows.length = 0;
    chapterListEl.replaceChildren();
    waveChapters.replaceChildren();
    chaptersEl.hidden = true;
    chaptersEl.open = false;
  }

  function clearTranscript(): void {
    transcriptLoad?.abort();
    transcriptLoad = null;
    cues = [];
    activeCue = -1;
    cueRows.length = 0;
    transcriptBody.replaceChildren();
    transcriptEl.hidden = true;
    transcriptEl.open = false;
    transcriptState = 'none';
    transcriptFor = null;
  }

  function renderChapters(): void {
    chapterRows.length = 0;
    const rows = chapters.map((chapter, i) => {
      const title = chapter.title || t('chapter_untitled');
      const time = fmtTime(chapter.startTime);
      const row = h(
        'button',
        {
          className: 'np-chapter',
          type: 'button',
          attrs: { role: 'listitem', 'aria-label': t('chapter_jump', title, time) },
          on: {
            click: () => {
              pbSeekTo(chapter.startTime);
              // The highlight follows `timeupdate`, which a paused element does
              // not fire — so move it now rather than a second later.
              markChapter(i);
            },
          },
        },
        h('span', { className: 'np-chapter-time mono' }, time),
        h('span', { className: 'np-chapter-title' }, title),
      );
      chapterRows.push(row);
      return row;
    });
    chapterListEl.replaceChildren(...rows);
    chaptersToggle.textContent = t('np_chapters', chapters.length);
    chaptersEl.hidden = chapters.length === 0;
  }

  /**
   * Ticks on the scrubber, so the chapters are visible without opening a list.
   *
   * The element's duration arrives with the metadata, which is often after the
   * chapters do — so the feed's own `<itunes:duration>` stands in until then.
   * Without that the markers waited for the first `timeupdate`, which on a
   * paused episode never comes.
   */
  function renderChapterMarks(): void {
    const fromElement = pbDuration();
    const p = playing();
    const declared = (p?.episodes[p.index]?.trackTimeMillis ?? 0) / 1000;
    const total = Number.isFinite(fromElement) && fromElement > 0 ? fromElement : declared;
    if (!chapters.length || !Number.isFinite(total) || total <= 0) {
      waveChapters.replaceChildren();
      return;
    }
    waveChapters.replaceChildren(
      ...chapters
        // A marker at zero sits under the left edge and reads as a rendering
        // artefact rather than as a chapter.
        .filter((c) => c.startTime > 0 && c.startTime < total)
        .map((c) =>
          h('i', { style: `inset-inline-start:${((c.startTime / total) * 100).toFixed(3)}%` }),
        ),
    );
  }

  function markChapter(index: number): void {
    if (index === activeChapter) return;
    chapterRows[activeChapter]?.classList.remove('active');
    chapterRows[index]?.classList.add('active');
    activeChapter = index;
  }

  function renderCues(): void {
    cueRows.length = 0;
    const rows = cues.map((cue, i) =>
      h(
        'button',
        {
          className: 'np-cue',
          type: 'button',
          attrs: { role: 'listitem' },
          on: {
            click: () => {
              pbSeekTo(cue.start);
              // Same reason as the chapter rows: a paused element fires no
              // `timeupdate`, so the highlight would stay where it was.
              markCue(i);
            },
          },
        },
        h('span', { className: 'np-cue-time mono' }, fmtTime(cue.start)),
        h('span', { className: 'np-cue-text' }, cue.text),
      ),
    );
    for (const row of rows) cueRows.push(row);
    transcriptBody.replaceChildren(...rows);
  }

  function markCue(index: number): void {
    if (index === activeCue) return;
    cueRows[activeCue]?.classList.remove('active');
    const row = cueRows[index];
    if (row) {
      row.classList.add('active');
      // Only while the panel is open: scrolling a collapsed container is
      // wasted work, and `scrollIntoView` on a hidden element can move the
      // page instead.
      if (transcriptEl.open) row.scrollIntoView({ block: 'nearest' });
    }
    activeCue = index;
  }

  function loadChaptersFor(ep: Episode | undefined): void {
    clearChapters();
    if (!ep?.chaptersUrl) return;
    const wanted = String(ep.trackId);
    chapterLoad = new AbortController();
    void fetchChapters(ep.chaptersUrl, chapterLoad.signal).then((list) => {
      if (!list.length || playing()?.trackId !== wanted) return;
      chapters = list;
      renderChapters();
      renderChapterMarks();
    });
  }

  function prepareTranscript(ep: Episode | undefined): void {
    clearTranscript();
    const pick = pickTranscript(ep?.transcripts, currentLang());
    if (!pick || !ep) return;
    transcriptFor = String(ep.trackId);
    transcriptState = 'idle';
    transcriptEl.hidden = false;

    /** Fetched on first open — see the note above about half-megabyte files. */
    const load = (): void => {
      if (transcriptState !== 'idle') return;
      transcriptState = 'loading';
      transcriptBody.replaceChildren(h('p', { className: 'np-note-p' }, t('np_transcript_loading')));
      transcriptLoad = new AbortController();
      void fetchTranscript(pick.url, transcriptLoad.signal).then((list) => {
        if (transcriptFor !== String(ep.trackId)) return;
        if (!list.length) {
          transcriptState = 'failed';
          transcriptBody.replaceChildren(
            h('p', { className: 'np-note-p' }, t('np_transcript_failed')),
          );
          return;
        }
        cues = list;
        transcriptState = 'ready';
        renderCues();
        markCue(cueAt(cues, pbCurrent()));
      });
    };
    transcriptEl.addEventListener('toggle', () => {
      if (transcriptEl.open) load();
    });
  }

  // ── playing session → title, waveform, nav buttons, notes ───────
  let lastTrackId: string | null | undefined;
  function applyPlaying(s: PlayingSession | null): void {
    const label = nowPlayingLabel(s);
    const ep = s ? s.episodes[s.index] : undefined;
    setNowTitle(label ? label.title : t('pick_episode'));

    const trackId = s ? s.trackId : null;
    if (trackId !== lastTrackId) {
      lastTrackId = trackId;
      wave.build(trackId || 'seseri');
      wave.setProgress(0);
      if (!s) {
        elTCur.textContent = '0:00';
        elTTot.textContent = '0:00';
      }
    }

    btnPrev.disabled = !s || s.index <= 0;
    btnNext.disabled = !s || s.index >= s.episodes.length - 1;
    refreshShareLabel();
    applyNotes(ep?.description);
    if (trackId !== lastTrackId || !chapters.length) {
      loadChaptersFor(ep);
      prepareTranscript(ep);
    }
    // A different show may play at a different speed.
    refreshSpeed();
    /**
     * A list that came from the Worker arrives without notes (they are most of
     * a feed's bytes and none of a list's content), so the one episode on
     * screen asks for its own. Resolves instantly when they are already there.
     */
    if (s && ep && !ep.description) {
      const wanted = s.trackId;
      void loadEpisodeNotes(s.feedId, ep).then((notes) => {
        // The listener may be two episodes further on by the time this lands.
        if (notes && playing()?.trackId === wanted) applyNotes(notes);
      });
    }
    applyArt(label);
  }

  /**
   * Show notes are untrusted feed HTML, so they are reduced to text plus
   * https-only links and rebuilt as real nodes — no markup string ever reaches
   * the DOM. See feeds/show-notes.ts.
   */
  let notesFor: string | undefined;
  function applyNotes(description: string | undefined): void {
    if (description === notesFor) return;
    notesFor = description;
    const notes = parseShowNotes(description);
    if (!hasShowNotes(notes)) {
      notesEl.hidden = true;
      notesBody.replaceChildren();
      return;
    }
    const nodes: HTMLElement[] = notes.paragraphs.map((p) =>
      h('p', { className: 'np-note-p' }, p),
    );
    if (notes.links.length) {
      nodes.push(
        h(
          'ul',
          { className: 'np-note-links' },
          ...notes.links.map((l) =>
            h(
              'li',
              {},
              h(
                'a',
                {
                  href: l.href,
                  className: 'np-note-link',
                  attrs: { target: '_blank', rel: 'noopener noreferrer' },
                },
                l.text,
              ),
            ),
          ),
        ),
      );
    }
    notesBody.replaceChildren(...nodes);
    notesEl.hidden = false;
    notesEl.open = false;
  }

  // ── now-playing → artwork + feed name ────────────────────────────
  // The hero renders up to 320 CSS px (300 on desktop), so a retina screen
  // wants ~1024. Feed metadata often only advertises a 100px thumbnail — see
  // lib/art.ts for how a real rendition is derived from it.
  const HERO_WIDTHS = [320, 640, 1024];
  /**
   * Mirrors `.np-stage` in views/now-playing.css, minus its `34dvh` cap, which
   * `sizes` has no way to express — a short screen therefore fetches a
   * rendition a step larger than it strictly needs, which is the harmless
   * direction to be wrong in. Set from here rather than in the markup because
   * <source> needs its own copy: `sizes` on the <img> does not apply to a
   * <source>, and without it the default is 100vw, which makes the browser
   * always pick the largest candidate.
   */
  const HERO_SIZES = '(min-width: 900px) 300px, 72vw';
  art.sizes = HERO_SIZES;
  artWebp.sizes = HERO_SIZES;

  function clearArt(): void {
    artWebp.removeAttribute('srcset');
    art.removeAttribute('srcset');
    art.removeAttribute('src');
    art.style.display = 'none';
  }

  /** True once the WebP rendition has been given up on for this URL. */
  let webpFailedFor = '';

  function applyArt(now: NowPlayingLabel | null): void {
    const src = now ? httpsOnly(now.art) : '';
    feedLine.set(now?.feedName ?? '');
    if (src) {
      // WebP is ~4× lighter at this size. <picture> picks it by MIME support
      // alone and does *not* fall back if the chosen resource 404s, hence the
      // error handler below.
      const webp = src === webpFailedFor ? '' : artSrcset(src, HERO_WIDTHS, { webp: true });
      const same = artSrcset(src, HERO_WIDTHS);
      setSrcset(artWebp, webp);
      setSrcset(art, same);
      art.src = artAt(src, 640);
      art.style.display = '';
    } else {
      clearArt();
    }
    updateAmbient(settings().ambientArt ? src : '');
    // Artless feeds: collapse the stage so the title doesn't float in a void.
    player.classList.toggle('no-art', !src);
  }

  function setSrcset(el: HTMLImageElement | HTMLSourceElement, value: string): void {
    if (value) el.srcset = value;
    else el.removeAttribute('srcset');
  }

  // Dead artwork: retry once without WebP, then collapse the stage rather than
  // leave a broken image box.
  art.addEventListener('error', () => {
    if (!art.getAttribute('src')) return; // our own clearArt(), not a failure
    const label = nowPlayingLabel(playing());
    const src = httpsOnly(label?.art);
    if (src && artWebp.getAttribute('srcset')) {
      webpFailedFor = src;
      applyArt(label);
      return;
    }
    clearArt();
    player.classList.add('no-art');
  });

  // Artwork, title, notes and transport availability all come from the playing
  // session now — one subscription instead of two that had to stay in sync.
  // Subscribed here, below every `let` it reads, so the closure is never
  // entered before its own state is initialised.
  playing.subscribe(applyPlaying);
  applyPlaying(playing());

  // ── queue badge ──────────────────────────────────────────────────
  queue.subscribe((q) => updateQueueCount(q.length));
  updateQueueCount(queue().length);

  // ── engine events ────────────────────────────────────────────────
  onEngine((e) => {
    switch (e.type) {
      case 'play':
        iconShowsPlaying = true;
        setPlayIcon(true);
        player.classList.add('playing');
        break;
      case 'pause':
      case 'error':
        iconShowsPlaying = false;
        setPlayIcon(false);
        player.classList.remove('playing');
        break;
      case 'timeupdate': {
        // The sheet is only ever visibility:hidden when dismissed, never
        // display:none, so guard explicitly rather than relying on layout.
        if (document.hidden || !isOpen()) break;
        if (!wave.isScrubbing()) wave.setProgress(e.duration ? (e.current / e.duration) * 100 : 0);
        elTCur.textContent = fmtTime(e.current);
        elTTot.textContent = fmtTime(e.duration);
        /**
         * The markers need a duration to be placed against, and that only
         * arrives with the metadata — after the chapters usually have. Drawing
         * them here costs one DOM write per episode, because `markedFor` stops
         * it repeating four times a second.
         */
        if (chapters.length && Number.isFinite(e.duration) && e.duration > 0 && markedFor !== e.duration) {
          markedFor = e.duration;
          renderChapterMarks();
        }
        if (chapters.length) markChapter(chapterAt(chapters, e.current));
        if (cues.length) markCue(cueAt(cues, e.current));
        break;
      }
    }
  });

  // ── transport wiring ─────────────────────────────────────────────
  btnPlay.addEventListener('click', () => playback.togglePlay());
  btnPrev.addEventListener('click', () => playback.prev());
  btnNext.addEventListener('click', () => playback.next());
  btnSkipBack.addEventListener('click', () => playback.seekRel(-settings().skipBack));
  btnSkipFwd.addEventListener('click', () => playback.seekRel(settings().skipForward));
  queueBtn.addEventListener('click', () => deps.openQueue());

  /**
   * Sets the speed for THIS show when one is playing, and the global default
   * otherwise. A speed chosen while listening is a statement about the show in
   * front of you, not about every show you follow — which is what this control
   * used to mean.
   */
  speedSel.addEventListener('change', () => {
    const speed = parseFloat(speedSel.value) || 1;
    const feedId = playing()?.feedId;
    if (feedId) setFeedSpeed(feedId, speed);
    else setSetting('defaultSpeed', speed);
    pbSetRate(speed);
  });

  // ── settings → skip labels + speed value ─────────────────────────
  function applySettings(s: Settings): void {
    lblSkipBack.textContent = String(s.skipBack);
    lblSkipFwd.textContent = String(s.skipForward);
    refreshSpeed();
    // Toggling the preference takes effect without waiting for a track change.
    updateAmbient(s.ambientArt ? httpsOnly(nowPlayingLabel(playing())?.art) : '');
  }
  /** Whatever the show in front of the listener actually plays at. */
  function refreshSpeed(): void {
    const feedId = playing()?.feedId;
    speedSel.value = String(speedFor(feedId));
    speedSel.classList.toggle('has-own', hasOwnSpeed(feedId));
  }
  settings.subscribe(applySettings);
  feedSpeedRevision.subscribe(refreshSpeed);
  applySettings(settings());

  // ── language → dynamic labels ────────────────────────────────────
  currentLang.subscribe(() => {
    setPlayIcon(iconShowsPlaying);
    // The sleep control relabels itself (sleep-control.ts). The title can be a
    // localized "Episode N" placeholder, so re-derive it too.
    applyPlaying(playing());
  });

  // ── open / close ─────────────────────────────────────────────────
  // The closed sheet stays rendered (visibility:hidden, never display:none) so
  // the slide transition has something to animate in both directions.
  let lastFocus: HTMLElement | null = null;

  /**
   * Real modal semantics without `display: none`, which would restart the
   * enter animation. Marking everything *behind* the sheet inert takes it out of the tab
   * order and the accessibility tree, so the platform provides the focus trap;
   * while dismissed the sheet itself is inert for the same reason.
   */
  function setBackgroundInert(on: boolean): void {
    for (const sel of ['.app-frame', '#miniPlayer']) {
      const node = document.querySelector<HTMLElement>(sel);
      if (node) node.inert = on;
    }
    el.inert = !on;
    el.setAttribute('aria-modal', on ? 'true' : 'false');
  }

  function open(): void {
    if (isOpen()) return;
    lastFocus = document.activeElement as HTMLElement | null;
    el.classList.add('open');
    setBackgroundInert(true);
    // The timeupdate handler skips work while dismissed, so sync from the
    // engine on the way in — otherwise a seek made while paused shows stale.
    const cur = pbCurrent();
    const dur = pbDuration();
    elTCur.textContent = fmtTime(cur);
    elTTot.textContent = fmtTime(dur);
    if (!wave.isScrubbing()) wave.setProgress(dur ? (cur / dur) * 100 : 0);
    must('npClose').focus();
  }
  function close(): void {
    if (!isOpen()) return;
    el.classList.remove('open');
    setBackgroundInert(false);
    lastFocus?.focus({ preventScroll: true });
    lastFocus = null;
  }

  // Dismissed at boot: keep it out of the tab order until it is opened.
  setBackgroundInert(false);
  function isOpen(): boolean {
    return el.classList.contains('open');
  }

  must('npClose').addEventListener('click', close);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  return { open, close, isOpen, el };
}
