import { currentLang, t } from '../i18n';
import { artAt, artSrcset } from '../lib/art';
import { dprWidths, MINI_ART_PX } from './art-tile';
import { fmtTime } from '../lib/format';
import { onEngine, pbDuration, pbSeekTo, pbSetRate } from '../player/engine';
import { initMarquee } from './marquee';
import { initSleepControl } from './sleep-control';
import { initVolumeControl } from './volume-control';
import { nowPlayingLabel, playing } from '../player/session';
import { setSetting, settings } from '../state/settings';
import { feedSpeedRevision, hasOwnSpeed, setFeedSpeed, speedFor } from '../state/feed-speed';
import type { PlaybackController } from './playback-controller';
import { must } from './shell';

/**
 * Persistent mini transport — a real transport bar, not just a "reopen"
 * handle: skip back/forward, play/pause, prev/next + speed (wider screens)
 * and a tap-to-seek progress hairline live right in the dock. The expand
 * chevron (or the title area) opens the full Now Playing sheet for the
 * scrubber, sleep timer and queue.
 */

/** Slim frequency-line bars drawn on the mini dock (animated via CSS while
 * body.is-playing; a clean static line when paused or under reduced motion). */
const MINI_BARS = 24;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];

export function initMiniPlayer(deps: { playback: PlaybackController; onOpen: () => void }): void {
  const { playback } = deps;
  const main = must('miniMain');
  const art = must<HTMLImageElement>('miniArt');
  const title = initMarquee(must('miniTitle'));
  const feed = must('miniFeed');
  const btnPlay = must<HTMLButtonElement>('miniPlay');
  const btnPrev = must<HTMLButtonElement>('miniPrev');
  const btnNext = must<HTMLButtonElement>('miniNext');
  const btnBack = must<HTMLButtonElement>('miniBack');
  const btnFwd = must<HTMLButtonElement>('miniFwd');
  const lblBack = must('miniLblBack');
  const lblFwd = must('miniLblFwd');
  const speedSel = must<HTMLSelectElement>('miniSpeed');
  const sleepSel = must<HTMLSelectElement>('miniSleep');
  const expand = must<HTMLButtonElement>('miniExpand');
  const scrub = must('miniScrub');
  const progress = must('miniProgress');
  const signal = must('miniSignal');

  const bars = document.createDocumentFragment();
  for (let i = 0; i < MINI_BARS; i++) bars.appendChild(document.createElement('i'));
  signal.replaceChildren(bars);

  for (const v of SPEEDS) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = v + '×';
    speedSel.appendChild(o);
  }
  // The dock has no room for a countdown; the sheet shows that.
  initSleepControl({ select: sleepSel });
  initVolumeControl({
    root: must('miniVolume'),
    button: must<HTMLButtonElement>('miniVolBtn'),
    slider: must<HTMLInputElement>('miniVolRange'),
  });

  function setIcon(playing: boolean): void {
    const u = btnPlay.querySelector('use');
    if (u) u.setAttribute('href', playing ? '#ic-pause' : '#ic-play');
    btnPlay.setAttribute('aria-label', playing ? t('pause') : t('play'));
  }

  function renderTrack(): void {
    const s = playing();
    const now = nowPlayingLabel(s);
    document.body.classList.toggle('has-track', now !== null);
    // prev/next follow the PLAYING feed, not whichever list is on screen.
    btnPrev.disabled = !s || s.index <= 0;
    btnNext.disabled = !s || s.index >= s.episodes.length - 1;
    if (!now) return;
    title.set(now.title);
    feed.textContent = now.feedName;
    feed.title = now.feedName;
    const src = artAt(now.art, MINI_ART_PX);
    if (src) {
      art.src = src;
      const set = artSrcset(now.art, dprWidths(MINI_ART_PX));
      if (set) {
        art.srcset = set;
        art.sizes = `${MINI_ART_PX}px`;
      } else {
        art.removeAttribute('srcset');
      }
    } else {
      // Must be cleared, or the previous podcast's cover stays on a track
      // that has none.
      art.removeAttribute('srcset');
      art.removeAttribute('src');
    }
    art.style.display = src ? '' : 'none';
  }

  playing.subscribe(renderTrack);
  // The title can be a localized "Episode N" placeholder, so it is re-derived
  // on a language switch rather than frozen at play time.
  currentLang.subscribe(renderTrack);
  renderTrack();

  onEngine((e) => {
    switch (e.type) {
      case 'play':
        // Own body.is-playing so the frequency line animates regardless of
        // which module drove playback (idempotent add/remove — safe to share).
        document.body.classList.add('is-playing');
        setIcon(true);
        break;
      case 'pause':
      case 'error':
        document.body.classList.remove('is-playing');
        setIcon(false);
        break;
      case 'timeupdate': {
        // 4 Hz, and nothing here is observable while the tab is hidden.
        if (document.hidden) break;
        const pct = e.duration ? (e.current / e.duration) * 100 : 0;
        progress.style.width = pct + '%';
        scrub.setAttribute('aria-valuenow', String(Math.round(pct)));
        if (e.duration) {
          scrub.setAttribute('aria-valuetext', fmtTime(e.current) + ' / ' + fmtTime(e.duration));
        }
        break;
      }
    }
  });

  // ── transport ────────────────────────────────────────────────────
  btnPlay.addEventListener('click', () => playback.togglePlay());
  btnBack.addEventListener('click', () => playback.seekRel(-settings().skipBack));
  btnFwd.addEventListener('click', () => playback.seekRel(settings().skipForward));
  btnPrev.addEventListener('click', () => playback.prev());
  btnNext.addEventListener('click', () => playback.next());
  // Per show while something is playing, global otherwise — the same rule the
  // Now Playing sheet's control follows.
  speedSel.addEventListener('change', () => {
    const v = parseFloat(speedSel.value) || 1;
    const feedId = playing()?.feedId;
    if (feedId) setFeedSpeed(feedId, v);
    else setSetting('defaultSpeed', v);
    pbSetRate(v);
  });

  const refreshSpeed = (): void => {
    const feedId = playing()?.feedId;
    speedSel.value = String(speedFor(feedId));
    speedSel.classList.toggle('has-own', hasOwnSpeed(feedId));
  };

  settings.subscribe((S) => {
    lblBack.textContent = String(S.skipBack);
    lblFwd.textContent = String(S.skipForward);
    refreshSpeed();
  });
  feedSpeedRevision.subscribe(refreshSpeed);
  lblBack.textContent = String(settings().skipBack);
  lblFwd.textContent = String(settings().skipForward);
  refreshSpeed();

  // ── tap/drag-to-seek on the progress hairline ────────────────────
  let scrubbing = false;
  function seekAt(clientX: number): void {
    const dur = pbDuration();
    if (!dur) return;
    const rect = scrub.getBoundingClientRect();
    let f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (document.documentElement.dir === 'rtl') f = 1 - f;
    pbSeekTo(f * dur);
    progress.style.width = f * 100 + '%';
  }
  scrub.addEventListener('pointerdown', (e) => {
    if (!pbDuration()) return;
    scrubbing = true;
    try {
      scrub.setPointerCapture(e.pointerId);
    } catch {
      /* unsupported */
    }
    seekAt(e.clientX);
  });
  scrub.addEventListener('pointermove', (e) => {
    if (scrubbing) seekAt(e.clientX);
  });
  const endScrub = (): void => {
    scrubbing = false;
  };
  scrub.addEventListener('pointerup', endScrub);
  scrub.addEventListener('pointercancel', endScrub);
  scrub.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      playback.seekRel(-settings().skipBack);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      playback.seekRel(settings().skipForward);
    }
  });

  // ── expand to the full Now Playing sheet ─────────────────────────
  expand.addEventListener('click', deps.onOpen);
  main.addEventListener('click', deps.onOpen);
  main.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      deps.onOpen();
    }
  });
}
