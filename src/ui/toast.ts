import { h } from './h';

let host: HTMLDivElement | null = null;

function ensureHost(): HTMLDivElement {
  if (!host) {
    host = h('div', {
      className: 'toast-host',
      attrs: { 'aria-live': 'polite', 'aria-atomic': 'false' },
    });
    document.body.appendChild(host);
  }
  return host;
}

/**
 * Put the live region in the page. It has to exist BEFORE the first message is
 * added to it: a region that is inserted already holding its text is the case
 * assistive tech most often fails to announce, and the first toast of a
 * session was exactly that. Called once from boot.
 */
export function initToast(): void {
  ensureHost();
}

/** Non-blocking notification — replaces legacy alert(). */
export function toast(message: string, kind: 'info' | 'error' = 'info', ms = 3500): void {
  const el = h('div', { className: `toast toast-${kind}` }, message);
  // An error interrupts whatever is being read; the host's polite region would
  // wait for a pause.
  if (kind === 'error') el.setAttribute('role', 'alert');
  ensureHost().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
