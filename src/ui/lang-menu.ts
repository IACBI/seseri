/**
 * Language menu — a custom accessible dropdown (native <option> can't render
 * images, and Windows draws no emoji flags, so a real listbox with inline SVG
 * flags is the only way to show them). Used on Home (compact: flag + code)
 * and in Settings (full: flag + native name).
 */

import { applyLang, currentLang, t, LANG_CODES } from '../i18n';
import type { LangCode } from '../i18n/types';
import { setSetting, settings } from '../state/settings';
import { FLAGS, NATIVE_NAMES } from './flags';
import { h, icon } from './h';

export function createLangMenu(opts: { compact?: boolean } = {}): HTMLElement {
  const compact = opts.compact ?? false;

  const triggerFlag = h('span', { className: 'lang-menu-flag' });
  const triggerLabel = h('span', { className: 'lang-menu-label' });
  const trigger = h(
    'button',
    {
      className: 'lang-menu-btn' + (compact ? ' compact' : ''),
      type: 'button',
      attrs: { 'aria-haspopup': 'listbox', 'aria-expanded': 'false' },
    },
    triggerFlag,
    triggerLabel,
    icon('ic-chevron-down', 'lang-menu-chev'),
  );
  const pop = h('div', {
    className: 'lang-menu-pop',
    role: 'listbox',
    attrs: { hidden: '', tabindex: '-1' },
  });
  const root = h('div', { className: 'lang-menu' }, trigger, pop);

  function syncTrigger(): void {
    const code = currentLang();
    triggerFlag.innerHTML = FLAGS[code]; // constant markup, no data
    triggerLabel.textContent = compact ? code.toUpperCase() : NATIVE_NAMES[code];
    trigger.setAttribute('aria-label', t('lang_select_label') + ': ' + NATIVE_NAMES[code]);
  }

  function optionRow(code: LangCode): HTMLElement {
    const selected = code === currentLang();
    const flag = h('span', { className: 'lang-menu-flag' });
    flag.innerHTML = FLAGS[code]; // constant markup, no data
    const row = h(
      'button',
      {
        className: 'lang-menu-opt' + (selected ? ' selected' : ''),
        type: 'button',
        role: 'option',
        attrs: { 'aria-selected': String(selected), 'data-lang': code },
      },
      flag,
      h('span', { className: 'lang-menu-name' }, NATIVE_NAMES[code]),
      selected ? icon('ic-check', 'lang-menu-check') : null,
    );
    row.addEventListener('click', () => {
      setSetting('lang', code);
      applyLang(code);
      close();
      trigger.focus();
    });
    return row;
  }

  function isOpen(): boolean {
    return !pop.hasAttribute('hidden');
  }
  function open(): void {
    if (isOpen()) return;
    pop.replaceChildren(...LANG_CODES.map(optionRow));
    pop.removeAttribute('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    pop.querySelector<HTMLElement>('.lang-menu-opt.selected')?.focus();
  }
  function close(): void {
    if (!isOpen()) return;
    pop.setAttribute('hidden', '');
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', () => (isOpen() ? close() : open()));
  pop.addEventListener('keydown', (e) => {
    const opts_ = [...pop.querySelectorAll<HTMLElement>('.lang-menu-opt')];
    const i = opts_.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      trigger.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      opts_[Math.min(i + 1, opts_.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      opts_[Math.max(i - 1, 0)]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      opts_[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      opts_[opts_.length - 1]?.focus();
    }
  });
  // Light dismiss: click outside closes.
  document.addEventListener('click', (e) => {
    if (isOpen() && !root.contains(e.target as Node)) close();
  });

  // Language may change from anywhere (another menu instance, settings sync).
  currentLang.subscribe(() => {
    syncTrigger();
    if (isOpen()) pop.replaceChildren(...LANG_CODES.map(optionRow));
  });
  settings.subscribe(syncTrigger);
  syncTrigger();

  return root;
}
