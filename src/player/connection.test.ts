// @vitest-environment jsdom
/**
 * When a background transfer is allowed.
 *
 * Shared by the playing-episode prefetch and by auto-downloading new episodes,
 * and deliberately asymmetric: it backs off only when the browser positively
 * reports a problem. iOS reports nothing at all, so a rule that required proof
 * of wifi would switch both features off for every iPhone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transferAllowed } from './connection';

function withConnection(connection: unknown): void {
  vi.stubGlobal('navigator', { ...navigator, connection });
}

afterEach(() => vi.unstubAllGlobals());

describe('transferAllowed', () => {
  it('is never allowed when the policy says never', () => {
    withConnection({ type: 'wifi' });
    expect(transferAllowed('never')).toBe(false);
  });

  it('is allowed on wifi', () => {
    withConnection({ type: 'wifi', effectiveType: '4g' });
    expect(transferAllowed('wifi')).toBe(true);
    expect(transferAllowed('always')).toBe(true);
  });

  it('backs off on cellular unless asked to always transfer', () => {
    withConnection({ type: 'cellular', effectiveType: '4g' });
    expect(transferAllowed('wifi')).toBe(false);
    expect(transferAllowed('always')).toBe(true);
  });

  it('honours Save Data whatever the policy', () => {
    // The listener told the browser to spare their data; that outranks a
    // setting they last thought about weeks ago.
    withConnection({ saveData: true, type: 'wifi' });
    expect(transferAllowed('wifi')).toBe(false);
    expect(transferAllowed('always')).toBe(false);
  });

  it.each(['2g', 'slow-2g'])('refuses a %s radio, which cannot finish anyway', (effectiveType) => {
    withConnection({ effectiveType, type: 'cellular' });
    expect(transferAllowed('always')).toBe(false);
  });

  it('assumes it is fine when the browser says nothing — which is iOS', () => {
    withConnection(undefined);
    expect(transferAllowed('wifi')).toBe(true);
    expect(transferAllowed('always')).toBe(true);
    expect(transferAllowed('never')).toBe(false);
  });

  it('treats an unknown connection type as not-cellular', () => {
    withConnection({ type: 'ethernet', effectiveType: '4g' });
    expect(transferAllowed('wifi')).toBe(true);
  });
});
