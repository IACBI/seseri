import { describe, expect, it } from 'vitest';
import { LANGS, LANG_CODES } from './index';

describe('i18n completeness', () => {
  const enKeys = Object.keys(LANGS.en).sort();
  for (const code of LANG_CODES) {
    it(`${code} has exactly the en key set`, () => {
      expect(Object.keys(LANGS[code]).sort()).toEqual(enKeys);
    });
    it(`${code} has a valid dir`, () => {
      expect(['ltr', 'rtl']).toContain(LANGS[code].dir);
    });
  }
  it('ar is rtl', () => {
    expect(LANGS.ar.dir).toBe('rtl');
  });
});
