import { describe, expect, it } from 'vitest';
import { fmtDur, fmtTime } from './format';

describe('fmtTime', () => {
  it('formats m:ss under an hour', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(61)).toBe('1:01');
    expect(fmtTime(599.9)).toBe('9:59');
  });
  it('formats h:mm:ss above an hour', () => {
    expect(fmtTime(3600)).toBe('1:00:00');
    expect(fmtTime(3725)).toBe('1:02:05');
  });
  it('is defensive about junk input', () => {
    expect(fmtTime(NaN)).toBe('0:00');
    expect(fmtTime(Infinity)).toBe('0:00');
  });
});

describe('fmtDur', () => {
  it('renders minutes-only durations', () => {
    expect(fmtDur(42 * 60 * 1000)).toMatch(/^42/);
  });
  it('renders hour durations with padded minutes', () => {
    expect(fmtDur(3900 * 1000)).toMatch(/^1\D+05/);
  });
  it('returns empty for unknown duration', () => {
    expect(fmtDur(0)).toBe('');
  });
});
