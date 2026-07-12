/**
 * Queue view — the visible face of the up-next queue: ordered rows with
 * keyboard-friendly move/remove controls.
 * WP-0 STUB: WP-F implements the real view behind this exact signature
 * (port the row logic from `git show ed59840:src/ui/queue-panel.ts`).
 */

import type { PlaybackController } from '../playback-controller';
import { registerView, viewEl, type View } from '../views';

export interface QueueViewDeps {
  playback: PlaybackController;
}

export function initQueueView(deps: QueueViewDeps): View {
  void deps;
  const el = viewEl('queue');
  el.innerHTML = `
    <div class="view-inner">
      <h1 class="view-title" data-i18n="queue_title">Çalma kuyruğu</h1>
      <div class="empty-state" data-i18n="queue_empty">Kuyruk boş.</div>
    </div>`;

  const view: View = { name: 'queue', el };
  registerView(view);
  return view;
}
