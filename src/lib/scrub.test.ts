import { describe, expect, it } from 'vitest';
import { scrubFraction, seekDirection } from './scrub';

const rect = { left: 100, width: 200 };

describe('scrubFraction', () => {
  it('measures from the left edge in LTR', () => {
    expect(scrubFraction(100, rect, false)).toBe(0);
    expect(scrubFraction(150, rect, false)).toBe(0.25);
    expect(scrubFraction(300, rect, false)).toBe(1);
  });

  it('measures from the right edge in RTL', () => {
    expect(scrubFraction(300, rect, true)).toBe(0);
    expect(scrubFraction(250, rect, true)).toBe(0.25);
    expect(scrubFraction(100, rect, true)).toBe(1);
  });

  it('clamps a pointer that left the bar', () => {
    expect(scrubFraction(-50, rect, false)).toBe(0);
    expect(scrubFraction(900, rect, false)).toBe(1);
    expect(scrubFraction(-50, rect, true)).toBe(1);
    expect(scrubFraction(900, rect, true)).toBe(0);
  });

  it('reads a zero-width bar as the start', () => {
    expect(scrubFraction(10, { left: 0, width: 0 }, false)).toBe(0);
    expect(scrubFraction(10, { left: 0, width: 0 }, true)).toBe(0);
  });
});

describe('seekDirection', () => {
  it('seeks with the arrows in LTR', () => {
    expect(seekDirection('ArrowLeft', false)).toBe(-1);
    expect(seekDirection('ArrowRight', false)).toBe(1);
  });

  it('mirrors the arrows in RTL', () => {
    expect(seekDirection('ArrowLeft', true)).toBe(1);
    expect(seekDirection('ArrowRight', true)).toBe(-1);
  });

  it('ignores other keys', () => {
    expect(seekDirection('Enter', false)).toBe(0);
    expect(seekDirection('ArrowUp', true)).toBe(0);
  });
});
