/**
 * View registry — one shell, class/hidden-switched views. Each view module
 * registers itself once; showView() handles visibility, the enter animation,
 * body state classes and keyboard-focus hand-off.
 */

import { must } from './shell';

export type ViewName = 'home' | 'search' | 'library' | 'podcast' | 'queue' | 'settings';

export interface View {
  name: ViewName;
  /** The static `#view-…` section this view rendered itself into. */
  el: HTMLElement;
  /** Called after the view becomes visible. */
  onShow?(): void;
  /** Called before the view is hidden. */
  onHide?(): void;
  /** Preferred keyboard landing point when navigation moves focus. */
  focusTarget?(): HTMLElement | null;
}

const views = new Map<ViewName, View>();
const changeListeners = new Set<(name: ViewName) => void>();
let current: ViewName | null = null;

export function viewEl(name: ViewName): HTMLElement {
  return must('view-' + name);
}

export function registerView(view: View): void {
  views.set(view.name, view);
}

export function currentView(): ViewName | null {
  return current;
}

/** Subscribe to view changes (nav active state, analytics-free). */
export function onViewChange(fn: (name: ViewName) => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export interface ShowOptions {
  /** Move keyboard focus into the view (default true — pass false on cold deep links). */
  focus?: boolean;
}

export function showView(name: ViewName, opts: ShowOptions = {}): void {
  const next = views.get(name);
  if (!next) throw new Error(`view "${name}" not registered`);
  if (current === name) {
    next.onShow?.();
    return;
  }
  const prev = current ? views.get(current) : null;
  if (prev) {
    prev.onHide?.();
    prev.el.hidden = true;
  }
  current = name;

  // Body state: views style against data-view; feed-open keeps the legacy
  // playback-shortcut / layout contract for the podcast view.
  document.body.dataset.view = name;
  document.body.classList.toggle('feed-open', name === 'podcast');

  next.el.hidden = false;
  next.el.classList.remove('view-enter');
  void next.el.offsetWidth; // restart the enter animation
  next.el.classList.add('view-enter');
  next.el.scrollTop = 0;
  next.onShow?.();

  if (opts.focus !== false) {
    const target = next.focusTarget?.() ?? next.el;
    target.focus({ preventScroll: true });
  }

  for (const fn of [...changeListeners]) fn(name);
}
