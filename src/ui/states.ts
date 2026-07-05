// Unified loading / empty / error boxes for list containers.
// One visual language for every "no content" moment in the app.
import { h } from './h';
import { t } from '../i18n';

export type StateKind = 'loading' | 'empty' | 'error';

export function stateBox(
  kind: StateKind,
  msg: string,
  opts: { onRetry?: (() => void) | undefined } = {},
): HTMLElement {
  const box = h(
    'div',
    {
      className: 'empty-state' + (kind === 'error' ? ' empty-state--error' : ''),
      ...(kind === 'error' ? { attrs: { role: 'alert' } } : {}),
    },
    msg,
  );
  if (opts.onRetry) {
    const btn = h('button', { className: 'retry-btn' }, t('btn_retry'));
    btn.addEventListener('click', opts.onRetry);
    box.append(h('br'), h('br'), btn);
  }
  return box;
}
