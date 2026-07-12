import { fmtTime } from '../lib/format';
import { pbCurrent, pbDuration, pbSeekTo } from '../player/engine';

const WAVE_BARS = 56;

/** Deterministic PRNG (mulberry32 + string hash) — each episode gets a stable,
 * real-looking amplitude waveform without audio analysis. */
function waveSeed(str: string): () => number {
  let hSeed = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    hSeed = Math.imul(hSeed ^ str.charCodeAt(i), 3432918353);
    hSeed = (hSeed << 13) | (hSeed >>> 19);
  }
  return () => {
    hSeed = Math.imul(hSeed ^ (hSeed >>> 16), 2246822507);
    hSeed = Math.imul(hSeed ^ (hSeed >>> 13), 3266489909);
    return ((hSeed ^= hSeed >>> 16) >>> 0) / 4294967296;
  };
}

export interface WaveformController {
  build(id: string): void;
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

  function build(id: string): void {
    const rand = waveSeed(String(id || 'seseri'));
    base.replaceChildren();
    fill.replaceChildren();
    const mk = () => {
      const frag = document.createDocumentFragment();
      const rand2 = waveSeed(String(id || 'seseri')); // same sequence for both layers
      for (let i = 0; i < WAVE_BARS; i++) {
        const t = i / (WAVE_BARS - 1);
        const swell = 0.4 + 0.6 * Math.abs(Math.sin(t * Math.PI + rand2() * 0.5));
        const hgt = Math.max(0.14, Math.min(1, swell * (0.5 + rand2() * 0.75)));
        const bar = document.createElement('i');
        bar.style.height = (hgt * 100).toFixed(1) + '%';
        frag.appendChild(bar);
      }
      return frag;
    };
    base.appendChild(mk());
    fill.appendChild(mk());
    void rand;
  }

  function setProgress(pctIn: number): void {
    const pct = Math.max(0, Math.min(100, pctIn || 0));
    fill.style.clipPath = `inset(0 ${(100 - pct).toFixed(2)}% 0 0)`;
    head.style.left = pct + '%';
    wrap.setAttribute('aria-valuenow', String(Math.round(pct)));
    const dur = pbDuration();
    if (dur) wrap.setAttribute('aria-valuetext', fmtTime(pbCurrent()) + ' / ' + fmtTime(dur));
  }

  function frac(clientX: number): number {
    const rect = wrap.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // .signal-layers is mirrored under [dir="rtl"] — invert so the visual
    // start (right edge) maps to 0, matching the mini player's math.
    return document.documentElement.dir === 'rtl' ? 1 - f : f;
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
    tip.style.left = f * 100 + '%';
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
  wrap.addEventListener('pointermove', (e) => {
    showTip(e.clientX);
    if (scrubbing) seekAt(e.clientX);
  });
  wrap.addEventListener('pointerup', endScrub);
  wrap.addEventListener('pointercancel', endScrub);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      opts.seekRel(-opts.skipBack());
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      opts.seekRel(opts.skipFwd());
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

  return { build, setProgress, isScrubbing: () => scrubbing };
}
