/**
 * Styled confirmation dialog — replaces native confirm() so destructive
 * actions share one look, translate in place and stay keyboard-friendly.
 * Native <dialog> gives the focus trap, Esc and backdrop for free; Cancel is
 * the default-focused button so Enter never destroys anything by accident.
 */

import { h } from './h';
import { t } from '../i18n';
import type { LangKey } from '../i18n/types';

let dialog: HTMLDialogElement | null = null;
let msgEl: HTMLParagraphElement;
let titleEl: HTMLHeadingElement;
let okBtn: HTMLButtonElement;
let cancelBtn: HTMLButtonElement;
let resolveOpen: ((ok: boolean) => void) | null = null;

function settle(ok: boolean): void {
  if (!dialog?.open) return;
  const resolve = resolveOpen;
  resolveOpen = null;
  dialog.classList.remove('open');
  setTimeout(() => dialog?.close(), 180);
  resolve?.(ok);
}

function build(): HTMLDialogElement {
  okBtn = h('button', { className: 's-btn danger confirm-ok', on: { click: () => settle(true) } });
  cancelBtn = h('button', { className: 's-btn confirm-cancel', on: { click: () => settle(false) } });
  titleEl = h('h2', { className: 'confirm-title', id: 'confirmTitle' });
  msgEl = h('p', { className: 'confirm-msg' });
  const d = h(
    'dialog',
    { className: 'confirm-dialog', attrs: { 'aria-labelledby': 'confirmTitle' } },
    titleEl,
    msgEl,
    h('div', { className: 'confirm-actions' }, cancelBtn, okBtn),
  );
  d.addEventListener('cancel', (e) => {
    e.preventDefault(); // Esc → animated close, resolved as "no"
    settle(false);
  });
  d.addEventListener('click', (e) => {
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      settle(false); // backdrop click
    }
  });
  document.body.appendChild(d);
  return d;
}

/** Ask the user to confirm a destructive action. Resolves false on Esc/backdrop. */
export function confirmDialog(messageKey: LangKey): Promise<boolean> {
  dialog ??= build();
  if (dialog.open) settle(false); // defensive: never stack two prompts
  titleEl.textContent = t('confirm_title');
  msgEl.textContent = t(messageKey);
  okBtn.textContent = t('confirm_ok');
  cancelBtn.textContent = t('confirm_cancel');
  dialog.showModal();
  requestAnimationFrame(() => dialog?.classList.add('open'));
  cancelBtn.focus();
  return new Promise((resolve) => {
    resolveOpen = resolve;
  });
}
