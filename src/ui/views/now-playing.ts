/**
 * Now Playing sheet — full-screen on mobile, floating panel on desktop.
 * Hero: the signature frequency-line scrubber (waveform.ts). Transport,
 * skip, speed, sleep timer and queue access live here.
 * Sheet chrome (open/close animation) lives in overlays.css; the inner
 * content is styled in views/now-playing.css + the shared signal-line.css.
 * Not a history entry (v1 decision) — Escape/close dismisses.
 */

import { currentLang, t } from '../../i18n';
import { fmtTime } from '../../lib/format';
import { httpsOnly } from '../../lib/safe';
import { isUsingEmbed, onEngine, pbSetRate } from '../../player/engine';
import { setSleepTimer } from '../../player/sleep-timer';
import { nowPlaying, type NowPlaying } from '../../state/now-playing';
import { queue } from '../../state/queue';
import { setSetting, settings, type Settings } from '../../state/settings';
import type { PlaybackController, PlaybackSession } from '../playback-controller';
import { must } from '../shell';
import { toast } from '../toast';
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
const SLEEPS = [0, 15, 30, 60];
/** Matches the sheet transition (--d-slow) so we re-hide only after it ends. */
const CLOSE_MS = 420;

export function initNowPlaying(deps: NowPlayingDeps): NowPlayingSheet {
  const { playback } = deps;
  const el = must('npSheet');

  el.innerHTML = `
    <div class="np-inner">
      <header class="np-top">
        <button class="icon-btn np-close" id="npClose" data-i18n-aria="np_close" aria-label="Oynatıcıyı kapat"><svg class="icon" aria-hidden="true"><use href="#ic-chevron-down"/></svg></button>
        <span class="np-feed" id="npFeed"></span>
      </header>

      <div class="np-player" id="npPlayer">
        <div class="np-stage">
          <img class="np-art" id="npArt" alt="" decoding="async">
          <div class="yt-frame" id="ytFrame"><div id="ytHost"></div></div>
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
          </div>
        </div>

        <div class="np-times">
          <span class="np-time" id="tCur">0:00</span>
          <span class="np-time" id="tTot">0:00</span>
        </div>

        <div class="np-transport">
          <button class="icon-btn np-tp" id="btnPrev" data-i18n-aria="btn_prev" aria-label="Önceki"><svg class="icon" aria-hidden="true"><use href="#ic-prev"/></svg></button>
          <button class="icon-btn np-tp np-skip" id="btnSkipBack" data-i18n-aria="s_skip_back" aria-label="Geri Atla"><svg class="icon" aria-hidden="true"><use href="#ic-rewind"/></svg><span class="np-skip-n" id="lblSkipBack">15</span></button>
          <button class="np-play" id="btnPlay" data-i18n-aria="play" aria-label="Oynat"><svg class="icon icon-fill" aria-hidden="true"><use href="#ic-play"/></svg></button>
          <button class="icon-btn np-tp np-skip" id="btnSkipFwd" data-i18n-aria="s_skip_fwd" aria-label="İleri Atla"><svg class="icon" aria-hidden="true"><use href="#ic-forward"/></svg><span class="np-skip-n" id="lblSkipFwd">30</span></button>
          <button class="icon-btn np-tp" id="btnNext" data-i18n-aria="btn_next" aria-label="Sonraki"><svg class="icon" aria-hidden="true"><use href="#ic-next"/></svg></button>
        </div>

        <div class="np-secondary">
          <label class="np-sec-ctl">
            <svg class="icon" aria-hidden="true"><use href="#ic-moon"/></svg>
            <select class="seri-select np-sel" id="sleepSel" data-i18n-aria="sleep_timer" aria-label="Uyku zamanlayıcısı (dk)"></select>
          </label>
          <label class="np-sec-ctl">
            <span class="np-sec-glyph" aria-hidden="true">×</span>
            <select class="seri-select np-sel" id="speedSel" data-i18n-aria="speed_label" aria-label="Oynatma hızı"></select>
          </label>
          <button class="icon-btn np-queue" id="queueToggle" data-i18n-aria="queue_title" aria-label="Çalma kuyruğu"><svg class="icon" aria-hidden="true"><use href="#ic-queue"/></svg><span class="np-queue-badge" id="queueCount" aria-hidden="true">0</span></button>
        </div>
        </div>
      </div>
    </div>`;

  // ── element cache ────────────────────────────────────────────────
  const player = must('npPlayer');
  const art = must<HTMLImageElement>('npArt');
  const feedEl = must('npFeed');
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
  const sleepSel = must<HTMLSelectElement>('sleepSel');
  const queueBtn = must<HTMLButtonElement>('queueToggle');
  const queueCount = must('queueCount');

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
  function buildSleepOptions(): void {
    const cur = sleepSel.value || '0';
    sleepSel.replaceChildren();
    for (const n of SLEEPS) {
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = n === 0 ? '—' : n + ' ' + t('dur_m');
      sleepSel.appendChild(o);
    }
    sleepSel.value = cur;
  }
  buildSleepOptions();

  // ── play icon / title crossfade ──────────────────────────────────
  let playing = false;
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
      titleEl.classList.remove('swapping');
    }, 150);
  }

  function updateQueueCount(n: number): void {
    queueCount.textContent = String(n);
    queueBtn.classList.toggle('has-queue', n > 0);
  }

  /** Show the embedded video frame only when a track actually falls back to it. */
  function updateYtMode(): void {
    player.classList.toggle('yt-mode', playback.session().isYT && isUsingEmbed());
  }

  // ── session → title, waveform, nav buttons, yt-mode ──────────────
  let lastTrackId: string | null | undefined;
  function applySession(s: PlaybackSession): void {
    const ep = s.currentIndex >= 0 ? s.filtered[s.currentIndex] : undefined;
    setNowTitle(ep ? ep.trackName || t('ep_fallback', s.currentIndex + 1) : t('pick_episode'));

    if (s.currentTrackId !== lastTrackId) {
      lastTrackId = s.currentTrackId;
      wave.build(s.currentTrackId || 'seseri');
      wave.setProgress(0);
      if (s.currentIndex < 0) {
        elTCur.textContent = '0:00';
        elTTot.textContent = '0:00';
      }
    }

    btnPrev.disabled = s.currentIndex <= 0;
    btnNext.disabled = s.currentIndex < 0 || s.currentIndex >= s.filtered.length - 1;
    updateYtMode();
  }
  playback.session.subscribe(applySession);
  applySession(playback.session());

  // ── now-playing → artwork + feed name ────────────────────────────
  function applyNow(now: NowPlaying | null): void {
    const src = now ? httpsOnly(now.art) : '';
    feedEl.textContent = now?.feedName ?? '';
    if (src) {
      art.src = src;
      art.style.display = '';
    } else {
      art.removeAttribute('src');
      art.style.display = 'none';
    }
    // Artless feeds: collapse the stage so the title doesn't float in a void
    // (yt-mode CSS re-shows the stage for the embedded video).
    player.classList.toggle('no-art', !src);
  }
  nowPlaying.subscribe(applyNow);
  applyNow(nowPlaying());

  // ── queue badge ──────────────────────────────────────────────────
  queue.subscribe((q) => updateQueueCount(q.length));
  updateQueueCount(queue().length);

  // ── engine events ────────────────────────────────────────────────
  onEngine((e) => {
    switch (e.type) {
      case 'play':
        playing = true;
        setPlayIcon(true);
        player.classList.add('playing');
        updateYtMode();
        break;
      case 'pause':
      case 'error':
        playing = false;
        setPlayIcon(false);
        player.classList.remove('playing');
        break;
      case 'timeupdate':
        if (!wave.isScrubbing()) wave.setProgress(e.duration ? (e.current / e.duration) * 100 : 0);
        elTCur.textContent = fmtTime(e.current);
        elTTot.textContent = fmtTime(e.duration);
        break;
    }
  });

  // ── transport wiring ─────────────────────────────────────────────
  btnPlay.addEventListener('click', () => playback.togglePlay());
  btnPrev.addEventListener('click', () => playback.prev());
  btnNext.addEventListener('click', () => playback.next());
  btnSkipBack.addEventListener('click', () => playback.seekRel(-settings().skipBack));
  btnSkipFwd.addEventListener('click', () => playback.seekRel(settings().skipForward));
  queueBtn.addEventListener('click', () => deps.openQueue());

  speedSel.addEventListener('change', () => {
    const speed = parseFloat(speedSel.value) || 1;
    setSetting('defaultSpeed', speed);
    pbSetRate(speed);
  });
  sleepSel.addEventListener('change', () => {
    const min = parseInt(sleepSel.value) || 0;
    sleepSel.classList.toggle('active', min > 0);
    if (min > 0) toast(t('sleep_set', min));
    setSleepTimer(min, () => {
      sleepSel.value = '0';
      sleepSel.classList.remove('active');
      toast(t('sleep_done'));
    });
  });

  // ── settings → skip labels + speed value ─────────────────────────
  function applySettings(s: Settings): void {
    lblSkipBack.textContent = String(s.skipBack);
    lblSkipFwd.textContent = String(s.skipForward);
    speedSel.value = String(s.defaultSpeed);
  }
  settings.subscribe(applySettings);
  applySettings(settings());

  // ── language → dynamic labels ────────────────────────────────────
  currentLang.subscribe(() => {
    setPlayIcon(playing);
    buildSleepOptions();
    const s = playback.session();
    if (s.currentIndex < 0) titleEl.textContent = t('pick_episode');
  });

  // ── open / close ─────────────────────────────────────────────────
  let lastFocus: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function open(): void {
    if (isOpen()) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    lastFocus = document.activeElement as HTMLElement | null;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('open');
    must('npClose').focus();
  }
  function close(): void {
    if (!isOpen()) return;
    el.classList.remove('open');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      el.hidden = true;
      hideTimer = null;
    }, CLOSE_MS);
    lastFocus?.focus({ preventScroll: true });
    lastFocus = null;
  }
  function isOpen(): boolean {
    return !el.hidden;
  }

  must('npClose').addEventListener('click', close);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  return { open, close, isOpen, el };
}
