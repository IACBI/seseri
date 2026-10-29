import type { Lang, LangCode, LangKey } from './types';
import { signal } from '../state/signals';
import tr from './langs/tr';
import en from './langs/en';

/**
 * Only the default and the fallback ship in the main chunk. The other six were
 * about a quarter of it, and a listener only ever reads one of them; each is
 * its own chunk now, precached by the service worker like any other asset.
 */
const LOADERS: Record<LangCode, () => Promise<Lang>> = {
  tr: () => Promise.resolve(tr),
  en: () => Promise.resolve(en),
  de: () => import('./langs/de').then((m) => m.default),
  fr: () => import('./langs/fr').then((m) => m.default),
  es: () => import('./langs/es').then((m) => m.default),
  ar: () => import('./langs/ar').then((m) => m.default),
  ja: () => import('./langs/ja').then((m) => m.default),
  ru: () => import('./langs/ru').then((m) => m.default),
};

export const LANG_CODES = Object.keys(LOADERS) as LangCode[];

const loaded: Partial<Record<LangCode, Lang>> = { tr, en };

export function isLangCode(code: string): code is LangCode {
  return Object.prototype.hasOwnProperty.call(LOADERS, code);
}

/** The dictionary for `code`, or the English fallback until it has loaded. */
export function langDict(code: LangCode): Lang {
  return loaded[code] ?? en;
}

/** Fetch a language's dictionary once. Rejects only if its chunk cannot load. */
export async function loadLang(code: LangCode): Promise<Lang> {
  const have = loaded[code];
  if (have) return have;
  const dict = await LOADERS[code]();
  loaded[code] = dict;
  return dict;
}

/** Reaktif geçerli dil — UI modülleri effect() ile buna abone olur. */
export const currentLang = signal<LangCode>('tr');

/** Çeviri: eksik anahtar İngilizceye düşer (legacy davranışı korunur). */
export function t(key: LangKey, ...args: Array<string | number>): string {
  const dict = langDict(currentLang());
  const val = dict[key] ?? en[key];
  if (typeof val === 'function') return val(...args);
  return val;
}

/**
 * True once `applyLang` has run. The crash-recovery screen needs to know: it
 * can be reached before `boot()` got as far as applying the saved language, and
 * `currentLang`'s initial value is a default rather than an answer.
 */
let applied = false;
export function langApplied(): boolean {
  return applied;
}

/** The last language asked for, so a slow chunk cannot override a later pick. */
let wanted: LangCode | null = null;

function commit(code: LangCode, dict: Lang): void {
  document.documentElement.setAttribute('dir', dict.dir);
  document.documentElement.setAttribute('lang', code);
  currentLang.set(code);
  applied = true;
}

/**
 * Switch language. Synchronous when the dictionary is already loaded (always
 * true for tr and en), so the shell never paints in a half-applied state; the
 * other languages switch — direction, `lang` and strings together — once their
 * chunk arrives. If it cannot load, the current language stays.
 */
export function applyLang(code: LangCode): Promise<void> {
  wanted = code;
  const ready = loaded[code];
  if (ready) {
    commit(code, ready);
    return Promise.resolve();
  }
  return loadLang(code).then(
    (dict) => {
      if (wanted === code) commit(code, dict);
    },
    () => undefined,
  );
}

/** İlk açılışta tarayıcı diline uy (kayıtlı tercih yoksa). */
export function detectLang(): LangCode {
  const code = (navigator.language || 'tr').slice(0, 2).toLowerCase();
  return isLangCode(code) ? code : 'tr';
}
