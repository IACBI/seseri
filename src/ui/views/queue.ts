/**
 * Queue view — the visible face of the up-next queue: ordered rows with
 * keyboard-friendly move/remove controls. Ported from the retired dropdown
 * panel (`ed59840:src/ui/queue-panel.ts`) into a full page view.
 *
 * Rows render from the queue entries themselves (title + feed name captured at
 * enqueue time) rather than looking titles up in the loaded feed: the queue
 * spans feeds now, so most entries do not belong to whatever is on screen.
 */

import { clearQueue, moveInQueue, queue, removeFromQueue, sameItem, type QueueItem } from '../../state/queue';
import { effect } from '../../state/signals';
import { t, currentLang } from '../../i18n';
import { registerView, viewEl, type View } from '../views';
import { h, icon } from '../h';

/** A control inside a row: which episode it belongs to, and where that row was. */
interface RowFocus {
  item: QueueItem;
  action: string;
  index: number;
}

export function initQueueView(): View {
  const el = viewEl('queue');
  el.innerHTML = `
    <div class="view-inner queue-inner">
      <h1 class="view-title" data-i18n="queue_title">Çalma kuyruğu</h1>
    </div>`;
  const inner = el.querySelector<HTMLElement>('.queue-inner')!;

  const listEl = h('div', { className: 'queue-list', attrs: { role: 'list', tabindex: '-1' } });
  const emptyEl = h('div', { className: 'empty-state' });
  const clearBtn = h('button', {
    className: 's-btn danger queue-clear',
    on: { click: () => clearQueue() },
  });
  inner.append(emptyEl, listEl, h('div', { className: 'queue-foot' }, clearBtn));

  function iconBtn(
    label: string,
    name: string,
    action: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = h('button', { className: 'icon-btn', title: label, on: { click: onClick } }, icon(name));
    b.setAttribute('aria-label', label);
    b.dataset.action = action;
    return b;
  }

  function row(item: QueueItem, i: number): HTMLElement {
    const title = item.title || t('ep_fallback', i + 1);
    return h(
      'div',
      { className: 'queue-row', attrs: { role: 'listitem' } },
      h('span', { className: 'queue-pos' }, String(i + 1)),
      h(
        'div',
        { className: 'queue-info' },
        h('span', { className: 'queue-name', title }, title),
        item.feedName ? h('span', { className: 'queue-feed' }, item.feedName) : null,
      ),
      iconBtn(t('queue_move_up'), 'ic-up', 'up', () => moveInQueue(item, -1)),
      iconBtn(t('queue_move_down'), 'ic-down', 'down', () => moveInQueue(item, 1)),
      iconBtn(t('queue_remove'), 'ic-x', 'remove', () => removeFromQueue(item)),
    );
  }

  /** The items the rows on screen were built from: the queue has already changed by the time render runs. */
  let shown: QueueItem[] = [];

  /** The row control the keyboard is on, if it is one of the list's. */
  function focusedRowControl(): RowFocus | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !listEl.contains(active)) return null;
    const rowEl = active.closest<HTMLElement>('.queue-row');
    const action = active.dataset.action;
    if (!rowEl || !action) return null;
    const index = Array.from(listEl.children).indexOf(rowEl);
    const item = shown[index];
    return item ? { item, action, index } : null;
  }

  /**
   * A re-render replaces every row, so focus would drop to the body. Put it on
   * the same control of the same episode, else of the row that took its place,
   * else the clear button, else the list itself.
   */
  function restoreFocus(f: RowFocus, q: QueueItem[]): void {
    const moved = q.findIndex((x) => sameItem(x, f.item));
    const index = moved >= 0 ? moved : Math.min(f.index, q.length - 1);
    const target = index >= 0 ? listEl.children[index] : undefined;
    const control = target?.querySelector<HTMLButtonElement>(`[data-action="${f.action}"]`);
    if (control) control.focus();
    else if (!clearBtn.hidden) clearBtn.focus();
    else listEl.focus();
  }

  function render(): void {
    const focus = focusedRowControl();
    const q = queue();
    clearBtn.textContent = t('queue_clear');
    clearBtn.hidden = q.length === 0;
    emptyEl.textContent = t('queue_empty');
    emptyEl.hidden = q.length !== 0;
    listEl.replaceChildren(...q.map(row));
    shown = q;
    if (focus) restoreFocus(focus, q);
  }

  // Reactive: re-render on queue mutation and on language change.
  effect(() => {
    void queue();
    void currentLang();
    render();
  });

  const view: View = { name: 'queue', el };
  registerView(view);
  return view;
}
