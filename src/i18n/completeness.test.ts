import { describe, expect, it } from 'vitest';
import { LANG_CODES, isLangCode, loadLang } from './index';
import type { Lang, LangCode } from './types';

describe('i18n completeness', async () => {
  const dicts = Object.fromEntries(
    await Promise.all(LANG_CODES.map(async (c) => [c, await loadLang(c)] as const)),
  ) as Record<LangCode, Lang>;
  const enKeys = Object.keys(dicts.en).sort();
  for (const code of LANG_CODES) {
    it(`${code} has exactly the en key set`, () => {
      expect(Object.keys(dicts[code]).sort()).toEqual(enKeys);
    });
    it(`${code} has a valid dir`, () => {
      expect(['ltr', 'rtl']).toContain(dicts[code].dir);
    });
  }
  it('ar is rtl', () => {
    expect(dicts.ar.dir).toBe('rtl');
  });
  it('knows every language and nothing else', () => {
    expect([...LANG_CODES].sort()).toEqual(['ar', 'de', 'en', 'es', 'fr', 'ja', 'ru', 'tr']);
    expect(isLangCode('xx')).toBe(false);
    expect(isLangCode('toString')).toBe(false);
  });
});
