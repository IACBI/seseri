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

/** Non-blocking notification — replaces legacy alert(). */
export function toast(message: string, kind: 'info' | 'error' = 'info', ms = 3500): void {
  const el = h('div', { className: `toast toast-${kind}` }, message);
  ensureHost().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
