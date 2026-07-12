import { t } from '../i18n';
import { httpsOnly } from '../lib/safe';
import { onEngine, pbPause, pbPaused, pbPlay } from '../player/engine';
import { nowPlaying } from '../state/now-playing';
import { must } from './shell';

/**
 * Persistent mini transport, shown on the home screen while something is
 * loaded — leaving a feed no longer stops playback; this is the way back.
 */
/** Slim frequency-line bars drawn on the mini dock (animated via CSS while
 * body.is-playing; a clean static line when paused or under reduced motion). */
const MINI_BARS = 24;

export function initMiniPlayer(deps: { onOpen: () => void }): void {
  const bar = must('miniPlayer');
  const art = must<HTMLImageElement>('miniArt');
  const title = must('miniTitle');
  const feed = must('miniFeed');
  const btn = must<HTMLButtonElement>('miniPlay');
  const progress = must('miniProgress');
  const signal = must('miniSignal');

  const bars = document.createDocumentFragment();
  for (let i = 0; i < MINI_BARS; i++) bars.appendChild(document.createElement('i'));
  signal.replaceChildren(bars);

  function setIcon(playing: boolean): void {
    const u = btn.querySelector('use');
    if (u) u.setAttribute('href', playing ? '#ic-pause' : '#ic-play');
    btn.setAttribute('aria-label', playing ? t('pause') : t('play'));
  }

  nowPlaying.subscribe((now) => {
    document.body.classList.toggle('has-track', now !== null);
    if (!now) return;
    title.textContent = now.title;
    feed.textContent = now.feedName;
    const src = httpsOnly(now.art);
    if (src) art.src = src;
    art.style.display = src ? '' : 'none';
  });

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
      case 'timeupdate':
        progress.style.width = e.duration ? `${(e.current / e.duration) * 100}%` : '0%';
        break;
    }
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pbPaused()) pbPlay();
    else pbPause();
  });
  bar.addEventListener('click', deps.onOpen);
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      deps.onOpen();
    }
  });
}
