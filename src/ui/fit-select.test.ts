// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetMeasurerForTests, fitSelect, fitSelectNow } from './fit-select';

/**
 * jsdom has neither a 2D canvas nor resolved logical box properties, so both
 * are stubbed: glyphs are exactly 10px wide and the select carries 18px of
 * padding + border. The assertions are then about the arithmetic — which label
 * gets measured, what is added around it, when the floor wins — rather than
 * about any real font's metrics.
 */
const GLYPH_PX = 10;
const CHROME_PX = 12 + 4 + 1 + 1;

function stubMeasurer(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (text: string) => ({ width: text.length * GLYPH_PX }),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    fontStyle: 'normal',
    fontWeight: '400',
    fontSize: '12px',
    fontFamily: 'monospace',
    paddingInlineStart: '12px',
    paddingInlineEnd: '4px',
    borderInlineStartWidth: '1px',
    borderInlineEndWidth: '1px',
  } as unknown as CSSStyleDeclaration);
}

function makeSelect(labels: string[], selected = 0): HTMLSelectElement {
  const sel = document.createElement('select');
  for (const text of labels) {
    const o = document.createElement('option');
    o.textContent = text;
    sel.appendChild(o);
  }
  sel.selectedIndex = selected;
  document.body.appendChild(sel);
  return sel;
}

beforeEach(__resetMeasurerForTests);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('fitSelectNow', () => {
  it('sizes to the selected option, not the widest one', () => {
    stubMeasurer();
    const sel = makeSelect(['—', 'End of episode']);
    fitSelectNow(sel);
    // +1 absorbs sub-pixel rounding, per the implementation.
    expect(sel.style.inlineSize).toBe(`${GLYPH_PX + CHROME_PX + 1}px`);
  });

  it('grows when a longer option is chosen', () => {
    stubMeasurer();
    const sel = makeSelect(['—', '30 min'], 1);
    fitSelectNow(sel);
    expect(sel.style.inlineSize).toBe(`${6 * GLYPH_PX + CHROME_PX + 1}px`);
  });

  it('never goes under the floor', () => {
    stubMeasurer();
    const sel = makeSelect(['—']);
    fitSelectNow(sel, 60);
    expect(sel.style.inlineSize).toBe('60px');
  });

  it('leaves the intrinsic width alone when there is no 2D context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const sel = makeSelect(['End of episode']);
    fitSelectNow(sel);
    expect(sel.style.inlineSize).toBe('');
  });
});

describe('fitSelect', () => {
  it('waits for the next frame, so a view writing its DOM is not forced into a style recalc', () => {
    stubMeasurer();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    const sel = makeSelect(['—']);

    fitSelect(sel);
    expect(getComputedStyle).not.toHaveBeenCalled();
    expect(sel.style.inlineSize).toBe('');

    frames.forEach((cb) => cb(0));
    expect(sel.style.inlineSize).toBe(`${GLYPH_PX + CHROME_PX + 1}px`);
  });

  it('collapses several calls in one frame into one fit, with the latest floor', () => {
    stubMeasurer();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    const sel = makeSelect(['—']);

    fitSelect(sel, 10);
    fitSelect(sel, 20);
    fitSelect(sel, 60);
    expect(frames).toHaveLength(1);
    frames.forEach((cb) => cb(0));

    expect(getComputedStyle).toHaveBeenCalledTimes(1);
    expect(sel.style.inlineSize).toBe('60px');
  });
});

describe('fitSelectNow, repeated', () => {
  it('skips the style read when the label has not changed, as on a countdown tick', () => {
    stubMeasurer();
    const sel = makeSelect(['—', '30 min']);
    fitSelectNow(sel);
    fitSelectNow(sel);
    fitSelectNow(sel);
    expect(getComputedStyle).toHaveBeenCalledTimes(1);
  });

  it('measures again once the label changes', () => {
    stubMeasurer();
    const sel = makeSelect(['—', '30 min']);
    fitSelectNow(sel);
    sel.selectedIndex = 1;
    fitSelectNow(sel);
    expect(getComputedStyle).toHaveBeenCalledTimes(2);
    expect(sel.style.inlineSize).toBe(`${6 * GLYPH_PX + CHROME_PX + 1}px`);
  });
});
