import type { Lang, LangCode, LangKey } from './types';
import { signal } from '../state/signals';
import tr from './langs/tr';
import en from './langs/en';
import de from './langs/de';
import fr from './langs/fr';
import es from './langs/es';
import ar from './langs/ar';
import ja from './langs/ja';
import ru from './langs/ru';

export const LANGS: Record<LangCode, Lang> = { tr, en, de, fr, es, ar, ja, ru };
export const LANG_CODES = Object.keys(LANGS) as LangCode[];

export function isLangCode(code: string): code is LangCode {
  return code in LANGS;
}

/** Reaktif geçerli dil — UI modülleri effect() ile buna abone olur. */
export const currentLang = signal<LangCode>('tr');

/** Çeviri: eksik anahtar İngilizceye düşer (legacy davranışı korunur). */
export function t(key: LangKey, ...args: Array<string | number>): string {
  const dict = LANGS[currentLang()];
  const val = dict[key] ?? LANGS.en[key];
  if (typeof val === 'function') return val(...args);
  return val;
}

export function applyLang(code: LangCode): void {
  document.documentElement.setAttribute('dir', LANGS[code].dir);
  document.documentElement.setAttribute('lang', code);
  currentLang.set(code);
}

/** İlk açılışta tarayıcı diline uy (kayıtlı tercih yoksa). */
export function detectLang(): LangCode {
  const code = (navigator.language || 'tr').slice(0, 2).toLowerCase();
  return isLangCode(code) ? code : 'tr';
}
