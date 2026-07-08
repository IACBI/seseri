/**
 * Offline banner — a quiet, fixed strip that appears while the network is
 * down. Downloads keep working offline, so the message reassures rather
 * than alarms.
 */

import { currentLang, t } from '../i18n';
import { effect } from '../state/signals';
import { h } from './h';

export function initOfflineBanner(): void {
  const el = h('div', {
    className: 'offline-banner',
    attrs: { role: 'status', hidden: '' },
  });
  document.body.appendChild(el);

  const sync = (): void => {
    el.toggleAttribute('hidden', navigator.onLine);
  };
  effect(() => {
    void currentLang();
    el.textContent = t('offline_banner');
  });
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
}
