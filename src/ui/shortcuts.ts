/**
 * Keyboard shortcut cheatsheet, opened with `?`.
 *
 * The shortcuts themselves already existed (playback-controller wires them) but
 * were undocumented anywhere in the UI, so nobody could discover them. Uses the
 * same native <dialog> idiom as confirm.ts, which brings the focus trap and Esc.
 */

import { currentLang, t } from '../i18n';
import type { LangKey } from '../i18n/types';
import { h } from './h';

/** [keycap, description key] — keycaps are symbols, so they are not translated. */
const ROWS: ReadonlyArray<readonly [string, LangKey]> = [
  ['Space', 'sc_playpause'],
  ['←', 'sc_back'],
  ['→', 'sc_forward'],
  ['↑', 'sc_prev'],
  ['↓', 'sc_next'],
  ['Home / End', 'sc_seek_edges'],
  // The list has its own meaning for the arrows while it has focus; without a
  // line here the sheet claims they always seek.
  ['↑ ↓ ← →', 'sc_list'],
  ['[', 'sc_sidebar'],
  ['Esc', 'sc_close'],
  ['?', 'sc_help'],
];

let dialog: HTMLDialogElement | null = null;
let titleEl: HTMLHeadingElement;
let listEl: HTMLElement;
let closeBtn: HTMLButtonElement;

function settle(): void {
  if (!dialog?.open) return;
  dialog.classList.remove('open');
  setTimeout(() => dialog?.close(), 180);
}

function render(): void {
  titleEl.textContent = t('sc_title');
  closeBtn.textContent = t('confirm_cancel');
  listEl.replaceChildren(
    ...ROWS.map(([cap, key]) =>
      h(
        'div',
        { className: 'sc-row' },
        h('kbd', { className: 'sc-key' }, cap),
        h('span', { className: 'sc-desc' }, t(key)),
      ),
    ),
  );
}

function build(): HTMLDialogElement {
  titleEl = h('h2', { className: 'confirm-title', id: 'scTitle' });
  listEl = h('div', { className: 'sc-list' });
  closeBtn = h('button', { className: 's-btn', on: { click: settle } });
  const d = h(
    'dialog',
    { className: 'confirm-dialog sc-dialog', attrs: { 'aria-labelledby': 'scTitle' } },
    titleEl,
    listEl,
    h('div', { className: 'confirm-actions' }, closeBtn),
  );
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    settle();
  });
  d.addEventListener('click', (e) => {
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      settle();
    }
  });
  document.body.appendChild(d);
  currentLang.subscribe(() => {
    if (dialog) render();
  });
  return d;
}

export function openShortcuts(): void {
  dialog ??= build();
  if (dialog.open) return;
  render();
  dialog.showModal();
  requestAnimationFrame(() => dialog?.classList.add('open'));
  closeBtn.focus();
}

/** Global `?` handler. Ignores typing contexts, like the transport keys do. */
export function initShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    if (e.key !== '?' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || target.isContentEditable) {
      return;
    }
    e.preventDefault();
    openShortcuts();
  });
}
