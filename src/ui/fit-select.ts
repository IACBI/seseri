/**
 * Size a <select> to the option it is actually showing.
 *
 * A native select is as wide as its widest option, so the sleep timer — whose
 * longest entry is "End of episode" — sat there as a 120px box while reading
 * "—", twice the width of the speed control beside it. Measuring the selected
 * label and writing the width back makes the control the size of what it says,
 * and it grows only for as long as a long option is chosen.
 */

// One measuring context for the app's lifetime; `undefined` means "not asked
// yet", `null` means "asked, and this host has no 2D canvas".
let ctx: CanvasRenderingContext2D | null | undefined;

/** Drop the cached context so a test can vary what the host provides. */
export function __resetMeasurerForTests(): void {
  ctx = undefined;
}

function textWidth(text: string, font: string): number {
  if (ctx === undefined) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 0;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * Bumped when a web font finishes loading: a label measured against the
 * fallback face is the wrong width once the real one arrives.
 */
let fontGeneration = 0;
if (typeof document !== 'undefined') {
  document.fonts?.addEventListener?.('loadingdone', () => fontGeneration++);
}

/** What each select was last sized for, so an unchanged label costs nothing. */
const fitted = new WeakMap<HTMLSelectElement, string>();
const queued = new Map<HTMLSelectElement, number>();
let frame = 0;

/**
 * Size `sel` on the next frame.
 *
 * Reading the computed style is what costs: called while a view is still
 * writing its DOM, it forces the whole page's style to be resolved there and
 * then. Measured opening a 6000-episode feed on a CPU slowed to a mid-range
 * phone's, that one read inside the sleep control was a 121 ms stall. On the
 * next frame the browser resolves style anyway, so the read rides along with
 * it, and several calls in one frame collapse into one fit per select.
 *
 * @param minPx Floor, so a one-glyph label ("—") still reads as a control.
 */
export function fitSelect(sel: HTMLSelectElement, minPx = 0): void {
  queued.set(sel, minPx);
  if (frame) return;
  if (typeof requestAnimationFrame !== 'function') {
    flush();
    return;
  }
  frame = requestAnimationFrame(flush);
}

function flush(): void {
  frame = 0;
  const batch = [...queued];
  queued.clear();
  for (const [sel, minPx] of batch) fitSelectNow(sel, minPx);
}

/**
 * Size `sel` now. The sleep control calls in on every countdown tick with the
 * label unchanged, which is skipped; the select's font comes from a fixed
 * token, not from a setting, so the label is the only thing that moves it.
 */
export function fitSelectNow(sel: HTMLSelectElement, minPx = 0): void {
  const label = sel.options[sel.selectedIndex]?.text ?? '';
  const key = `${fontGeneration}|${minPx}|${label}`;
  if (fitted.get(sel) === key && sel.style.inlineSize) return;
  const cs = getComputedStyle(sel);
  const w = textWidth(label, `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`);
  if (!w) return; // no 2D context here — leave the intrinsic width alone
  // A host that does not resolve the logical properties would otherwise turn
  // the whole sum into NaN and hand the element an invalid width.
  const px = (v: string): number => parseFloat(v) || 0;
  const chrome =
    px(cs.paddingInlineStart) +
    px(cs.paddingInlineEnd) +
    px(cs.borderInlineStartWidth) +
    px(cs.borderInlineEndWidth);
  // +1 absorbs sub-pixel rounding and the letter-spacing canvas cannot see.
  sel.style.inlineSize = Math.max(minPx, Math.ceil(w + chrome) + 1) + 'px';
  fitted.set(sel, key);
}
