// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getProgress,
  loadProgress,
  progressSnapshot,
  saveProgressNow,
  setProgress,
} from './progress';

const stored = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? 'null');

describe('loadProgress on a value that parses but has the wrong shape', () => {
  beforeEach(() => localStorage.clear());

  // JSON.stringify drops the string keys of an array, so a `pp_prog` that was an
  // array used to load "successfully" and then serialise back as `[]` forever.
  it.each([
    ['an array', '[1, 2, 3]'],
    ['a string', '"junk"'],
    ['a number', '42'],
    ['null', 'null'],
    ['a boolean', 'true'],
  ])('treats %s as empty and keeps persisting afterwards', (_label, raw) => {
    localStorage.setItem('pp_prog', raw);
    loadProgress();
    expect(progressSnapshot().prog).toEqual({});

    setProgress('e1', 120);
    saveProgressNow();
    expect(stored('pp_prog')).toEqual({ e1: 120 });
    expect(getProgress('e1')).toBe(120);
  });

  it('does the same for the position stamps', () => {
    localStorage.setItem('pp_prog_at', '[5]');
    loadProgress();

    setProgress('e1', 120);
    saveProgressNow();
    expect(stored('pp_prog_at')).toEqual({ e1: expect.any(Number) });
  });

  it('drops entries whose value is not a finite number', () => {
    localStorage.setItem(
      'pp_prog',
      JSON.stringify({ ok: 300, text: '300', nothing: null, nested: { t: 1 }, list: [1] }),
    );
    localStorage.setItem('pp_prog_at', JSON.stringify({ ok: 1000, text: 'later' }));
    loadProgress();

    expect(progressSnapshot().prog).toEqual({ ok: 300 });
    expect(getProgress('text')).toBe(0);
    expect(progressSnapshot().progAt).toEqual({ ok: 1000 });
  });
});
