/**
 * Queue panel — the visible face of the play queue. Lists queued episodes
 * with keyboard-friendly move/remove buttons; "up next" order wins over the
 * plain list order, so users need to see and edit it.
 */

import { clearQueue, moveInQueue, queue, removeFromQueue } from '../state/queue';
import { effect } from '../state/signals';
import { t, currentLang } from '../i18n';
import { h, icon } from './h';
import { must } from './shell';

export interface QueuePanel {
  close(): void;
  isOpen(): boolean;
}

export function initQueuePanel(opts: { titleFor(id: string): string }): QueuePanel {
  const toggleBtn = must<HTMLButtonElement>('queueToggle');
  const countEl = must('queueCount');

  const listEl = h('div', { className: 'queue-list', attrs: { role: 'list' } });
  const clearBtn = h('button', {
    className: 's-btn danger queue-clear',
    on: { click: () => clearQueue() },
  });
  const titleEl = h('h3', { className: 'queue-panel-title', id: 'queuePanelTitle' });
  const panel = h(
    'div',
    {
      className: 'queue-panel',
      id: 'queuePanel',
      attrs: { role: 'region', 'aria-labelledby': 'queuePanelTitle', hidden: '' },
    },
    titleEl,
    listEl,
    h('div', { className: 'queue-panel-foot' }, clearBtn),
  );
  toggleBtn.insertAdjacentElement('afterend', panel);

  function open(): boolean {
    return !panel.hasAttribute('hidden');
  }
  function setOpen(v: boolean): void {
    panel.toggleAttribute('hidden', !v);
    toggleBtn.setAttribute('aria-expanded', String(v));
    if (v) render();
  }

  function iconBtn(label: string, name: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { className: 'queue-act', title: label, on: { click: onClick } }, icon(name));
    b.setAttribute('aria-label', label);
    return b;
  }

  function render(): void {
    const q = queue();
    titleEl.textContent = t('queue_title');
    clearBtn.textContent = t('queue_clear');
    clearBtn.hidden = q.length === 0;
    if (!q.length) {
      listEl.replaceChildren(h('div', { className: 'queue-empty' }, t('queue_empty')));
      return;
    }
    listEl.replaceChildren(
      ...q.map((id, i) =>
        h(
          'div',
          { className: 'queue-row', attrs: { role: 'listitem' } },
          h('span', { className: 'queue-pos' }, String(i + 1)),
          h('span', { className: 'queue-name', title: opts.titleFor(id) }, opts.titleFor(id)),
          iconBtn(t('queue_move_up'), 'ic-up', () => moveInQueue(id, -1)),
          iconBtn(t('queue_move_down'), 'ic-down', () => moveInQueue(id, 1)),
          iconBtn(t('queue_remove'), 'ic-x', () => removeFromQueue(id)),
        ),
      ),
    );
  }

  // Reactive: queue changes update the badge always, the list when visible.
  effect(() => {
    const n = queue().length;
    void currentLang(); // re-render labels on language change
    countEl.textContent = n ? String(n) : '';
    countEl.toggleAttribute('hidden', n === 0);
    if (open()) render();
  });

  toggleBtn.addEventListener('click', () => setOpen(!open()));
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      toggleBtn.focus();
    }
  });
  // Light dismiss: click outside closes.
  document.addEventListener('click', (e) => {
    if (open() && !panel.contains(e.target as Node) && !toggleBtn.contains(e.target as Node)) {
      setOpen(false);
    }
  });

  return { close: () => setOpen(false), isOpen: open };
}
