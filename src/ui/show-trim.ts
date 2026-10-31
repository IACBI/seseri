/**
 * The show's intro/outro skip, opened from the podcast header.
 *
 * Same dialog shell as confirm.ts and number-prompt.ts. A choice applies the
 * moment it is made, as the speed selects do — there is nothing to confirm, and
 * a Cancel that had to undo two selects would only be a second way to close.
 */

import { h } from './h';
import { t } from '../i18n';
import { TRIMS, setFeedTrim, trimFor, type FeedTrim } from '../state/feed-trim';

let dialog: HTMLDialogElement | null = null;
let titleEl: HTMLHeadingElement;
let hintEl: HTMLParagraphElement;
let doneBtn: HTMLButtonElement;
const rows: Record<keyof FeedTrim, { label: HTMLLabelElement; select: HTMLSelectElement }> =
  Object.create(null);
let feedId = '';
let closing: ReturnType<typeof setTimeout> | undefined;

function close(): void {
  if (!dialog?.open) return;
  dialog.classList.remove('open');
  closing = setTimeout(() => dialog?.close(), 180);
}

function row(part: keyof FeedTrim): HTMLDivElement {
  const id = `trim_${part}`;
  const select = h('select', {
    className: 'seri-select trim-sel',
    id,
    on: { change: () => setFeedTrim(feedId, part, Number(select.value)) },
  });
  const label = h('label', { className: 'trim-label', attrs: { for: id } });
  rows[part] = { label, select };
  return h('div', { className: 'trim-row' }, label, select);
}

function build(): HTMLDialogElement {
  titleEl = h('h2', { className: 'confirm-title', id: 'trimTitle' });
  hintEl = h('p', { className: 'confirm-msg trim-hint', id: 'trimHint' });
  doneBtn = h('button', { className: 's-btn primary', on: { click: close } });
  const d = h(
    'dialog',
    {
      className: 'confirm-dialog trim-dialog',
      attrs: { 'aria-labelledby': 'trimTitle', 'aria-describedby': 'trimHint' },
    },
    titleEl,
    row('intro'),
    row('outro'),
    hintEl,
    h('div', { className: 'confirm-actions' }, doneBtn),
  );
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  d.addEventListener('click', (e) => {
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      close();
    }
  });
  document.body.appendChild(d);
  return d;
}

/** Open the trim settings for one show. The labels are rendered per open, in the current language. */
export function openShowTrim(forFeed: string): void {
  if (!forFeed) return;
  dialog ??= build();
  feedId = forFeed;
  titleEl.textContent = t('trim_title');
  hintEl.textContent = t('trim_hint');
  doneBtn.textContent = t('close');
  const current = trimFor(feedId);
  for (const part of ['intro', 'outro'] as const) {
    const { label, select } = rows[part];
    label.textContent = t(part === 'intro' ? 'trim_intro' : 'trim_outro');
    select.replaceChildren(
      ...TRIMS.map((s) =>
        h('option', { value: String(s) }, s === 0 ? t('trim_off') : t('trim_len', s)),
      ),
    );
    select.value = String(current[part]);
  }
  // Reopened inside the closing animation: keep the dialog instead of letting
  // the pending close take it away under the listener.
  clearTimeout(closing);
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => dialog?.classList.add('open'));
  rows.intro.select.focus();
}
