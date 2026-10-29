/**
 * Pointer and keyboard maths shared by the two seek bars (the Now Playing
 * scrubber and the mini dock's hairline). Both draw the start of the episode at
 * the inline-start edge, so under `dir="rtl"` the start is the RIGHT edge and
 * both the pointer fraction and the arrow keys have to mirror.
 */

export function isRtl(): boolean {
  return document.documentElement.dir === 'rtl';
}

/**
 * How far along a bar of `rect` a pointer at `clientX` is, from 0 (start of
 * the episode) to 1, clamped. A zero-width rect (a hidden bar) reads as 0
 * rather than NaN.
 */
export function scrubFraction(
  clientX: number,
  rect: { left: number; width: number },
  rtl: boolean = isRtl(),
): number {
  if (!(rect.width > 0)) return 0;
  const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return rtl ? 1 - f : f;
}

/**
 * Which way an arrow key seeks: -1 back, 1 forward, 0 for any other key. The
 * arrows follow what is drawn, so in RTL the left arrow moves forward.
 */
export function seekDirection(key: string, rtl: boolean = isRtl()): -1 | 0 | 1 {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return 0;
  return (key === 'ArrowRight') !== rtl ? 1 : -1;
}
