import { fmtTime } from '../lib/format';
import { scrubFraction, seekDirection } from '../lib/scrub';
import { pbCurrent, pbDuration, pbSeekTo } from '../player/engine';
import { PEAK_BARS } from '../player/peaks';

const WAVE_BARS = PEAK_BARS;
/** Bar height while the episode's loudness is unknown: a level line, not a guess. */
const FLAT = 0.14;

export interface WaveformController {
  /** Start a new episode's line, flat until `setPeaks` measures it. */
  build(id: string): void;
  /** Real bar heights (0–1) for `id`; ignored if another episode is up by now. */
  setPeaks(id: string, peaks: readonly number[]): void;
  setProgress(pct: number): void;
  isScrubbing(): boolean;
}

export interface WaveformElements {
  wrap: HTMLElement;
  base: HTMLElement;
  fill: HTMLElement;
  head: HTMLElement;
  tip: HTMLElement;
}

export function initWaveform(
  els: WaveformElements,
  opts: { seekRel: (s: number) => void; skipBack: () => number; skipFwd: () => number },
): WaveformController {
  const { wrap, base, fill, head, tip } = els;
  let scrubbing = false;

  let current = '';

  function draw(heights: readonly number[]): void {
    const mk = (): DocumentFragment => {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < WAVE_BARS; i++) {
        const bar = document.createElement('i');
        bar.style.height = (Math.max(0, Math.min(1, heights[i] ?? FLAT)) * 100).toFixed(1) + '%';
        frag.appendChild(bar);
      }
      return frag;
    };
    base.replaceChildren(mk());
    fill.replaceChildren(mk());
  }

  function build(id: string): void {
    current = id;
    wrap.classList.remove('measured');
    draw([]);
  }

  function setPeaks(id: string, peaks: readonly number[]): void {
    if (id !== current || peaks.length !== WAVE_BARS) return;
    wrap.classList.add('measured');
    draw(peaks);
  }

  function setProgress(pctIn: number): void {
    const pct = Math.max(0, Math.min(100, pctIn || 0));
    fill.style.clipPath = `inset(0 ${(100 - pct).toFixed(2)}% 0 0)`;
    head.style.left = pct + '%';
    wrap.setAttribute('aria-valuenow', String(Math.round(pct)));
    const dur = pbDuration();
    if (dur) wrap.setAttribute('aria-valuetext', fmtTime(pbCurrent()) + ' / ' + fmtTime(dur));
  }

  // The hover bubble means pointermove fires at raw device rate (up to 1 kHz on
  // a high-polling-rate mouse), and every call used to force a layout. Cache the
  // rect and invalidate it only when it can actually have moved.
  let cachedRect: DOMRect | null = null;
  function rect(): DOMRect {
    if (!cachedRect) cachedRect = wrap.getBoundingClientRect();
    return cachedRect;
  }
  const invalidateRect = (): void => {
    cachedRect = null;
  };
  wrap.addEventListener('pointerenter', invalidateRect);
  window.addEventListener('resize', invalidateRect);
  window.addEventListener('scroll', invalidateRect, { passive: true, capture: true });

  // .signal-layers is mirrored under [dir="rtl"], so the visual start (right
  // edge) has to map to 0 — scrubFraction does that, as the mini dock does.
  function frac(clientX: number): number {
    return scrubFraction(clientX, rect());
  }
  function seekAt(clientX: number): void {
    const dur = pbDuration();
    if (!dur) return;
    const f = frac(clientX);
    pbSeekTo(f * dur);
    setProgress(f * 100);
  }
  function showTip(clientX: number): void {
    const f = frac(clientX);
    const dur = pbDuration();
    // A custom property read by a transform: moving the bubble must not
    // dirty layout on every pointermove.
    tip.style.setProperty('--tip-x', f * rect().width + 'px');
    tip.textContent = dur ? fmtTime(f * dur) : '0:00';
  }
  function endScrub(): void {
    scrubbing = false;
    wrap.classList.remove('scrubbing');
  }

  wrap.addEventListener('pointerdown', (e) => {
    if (!pbDuration()) return;
    scrubbing = true;
    wrap.classList.add('scrubbing');
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch {
      /* unsupported */
    }
    seekAt(e.clientX);
    showTip(e.clientX);
  });
  // Coalesce to one update per frame: several pointermoves can arrive between
  // paints and only the last one is visible.
  let pendingX: number | null = null;
  let moveRaf = 0;
  wrap.addEventListener('pointermove', (e) => {
    pendingX = e.clientX;
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      const x = pendingX;
      pendingX = null;
      if (x === null) return;
      showTip(x);
      if (scrubbing) seekAt(x);
    });
  });
  wrap.addEventListener('pointerup', endScrub);
  wrap.addEventListener('pointercancel', endScrub);
  wrap.addEventListener('keydown', (e) => {
    // Alt/Cmd+arrow is Back/Forward and Ctrl/Cmd+Home/End scroll the page.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = seekDirection(e.key);
    if (dir !== 0) {
      e.preventDefault();
      opts.seekRel(dir < 0 ? -opts.skipBack() : opts.skipFwd());
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (pbDuration()) {
        pbSeekTo(0);
        setProgress(0);
      }
    } else if (e.key === 'End') {
      const d = pbDuration();
      if (d) {
        e.preventDefault();
        pbSeekTo(Math.max(0, d - 1));
      }
    }
  });

  return { build, setPeaks, setProgress, isScrubbing: () => scrubbing };
}
