/**
 * Now Playing sheet — full-screen on mobile, floating panel on desktop.
 * Hero: the signature frequency-line scrubber (waveform.ts). Transport,
 * skip, speed, sleep timer and queue access live here.
 * WP-0 STUB: WP-E implements the real sheet behind this exact signature.
 * Keep the legacy element IDs inside the sheet: nowTitle, progressWrap,
 * waveBase, waveFill, waveHead, waveTip, tCur, tTot, btnPlay, btnPrev,
 * btnNext, btnSkipBack, btnSkipFwd, speedSel, sleepSel.
 * Not a history entry (v1 decision) — Escape/close dismisses.
 */

import type { PlaybackController } from '../playback-controller';
import { must } from '../shell';

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

export function initNowPlaying(deps: NowPlayingDeps): NowPlayingSheet {
  void deps;
  const el = must('npSheet');
  el.innerHTML = `
    <div class="np-inner view-inner">
      <button class="icon-btn np-close" id="npClose" data-i18n-aria="np_close" aria-label="Oynatıcıyı kapat"><svg class="icon" aria-hidden="true"><use href="#ic-chevron-down"/></svg></button>
      <div class="p-now-title" id="nowTitle" data-i18n="pick_episode">Bir bölüm seçin</div>
    </div>`;

  let lastFocus: HTMLElement | null = null;

  function open(): void {
    if (isOpen()) return;
    lastFocus = document.activeElement as HTMLElement | null;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('open');
    must('npClose').focus();
  }
  function close(): void {
    if (!isOpen()) return;
    el.classList.remove('open');
    setTimeout(() => {
      el.hidden = true;
    }, 420);
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
