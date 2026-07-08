import { effect, type Signal } from '../state/signals';
import { currentLang, t, LANGS } from '../i18n';
import type { LangKey } from '../i18n/types';

/**
 * Localize static shell markup via data-i18n attributes (ported from legacy
 * applyLang): text, placeholder, title and aria-label variants. Runs inside
 * an effect, so it re-applies whenever the language changes.
 */
export function bindI18nDom(root: ParentNode = document): void {
  effect(() => {
    const dict = LANGS[currentLang()];
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n as LangKey | undefined;
      if (!key) return;
      const v = dict[key];
      if (v !== undefined && typeof v !== 'function') el.textContent = v;
    });
    root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => {
      const key = el.dataset.i18nPh as LangKey | undefined;
      if (key) el.placeholder = t(key);
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
      const key = el.dataset.i18nTitle as LangKey | undefined;
      if (key) el.title = t(key);
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
      const key = el.dataset.i18nAria as LangKey | undefined;
      if (key) el.setAttribute('aria-label', t(key));
    });
  });
}

/** Keep a <select>'s value in sync with a signal (both directions). */
export function bindSelect<T extends string>(sel: HTMLSelectElement, sig: Signal<T>): void {
  effect(() => {
    sel.value = sig();
  });
  sel.addEventListener('change', () => sig.set(sel.value as T));
}
