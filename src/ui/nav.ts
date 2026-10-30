/**
 * Navigation controller — one DOM for both the mobile tab bar and the desktop
 * sidebar (CSS switches the layout). Highlights the active destination and
 * forwards taps to the app's navigation intents.
 */

import { currentLang, t } from '../i18n';
import type { LangKey } from '../i18n/types';
import { setSetting, settings } from '../state/settings';
import { modalOpen } from './modal';
import { must } from './shell';
import { onViewChange, type ViewName } from './views';

export type NavDestination = 'home' | 'search' | 'library' | 'settings';

/** Reaching for the rail on purpose should feel immediate … */
const PEEK_OPEN_MS = 120;
/** … and clipping its edge on the way past should not make the panel flap. */
const PEEK_CLOSE_MS = 320;

export function initNav(deps: { go(dest: NavDestination): void }): void {
  const items: Record<NavDestination, HTMLButtonElement> = {
    home: must<HTMLButtonElement>('navHome'),
    search: must<HTMLButtonElement>('navSearch'),
    library: must<HTMLButtonElement>('navLibrary'),
    settings: must<HTMLButtonElement>('navSettings'),
  };
  const collapseBtn = must<HTMLButtonElement>('navCollapse');
  const navEl = must('appNav');

  for (const [dest, btn] of Object.entries(items) as Array<[NavDestination, HTMLButtonElement]>) {
    btn.addEventListener('click', () => deps.go(dest));
  }

  function setActive(view: ViewName): void {
    // The podcast view belongs to no tab; keep the last highlight off.
    for (const [dest, btn] of Object.entries(items) as Array<[NavDestination, HTMLButtonElement]>) {
      const active = view === dest;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  }

  /**
   * Collapse the desktop sidebar to an icon rail. `--nav-w` is redefined on
   * <body> rather than toggled per-rule, so the rail, the mini dock's inset and
   * anything else measuring from the sidebar all move together.
   */
  function applyCollapsed(collapsed: boolean): void {
    document.body.classList.toggle('nav-collapsed', collapsed);
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    relabel(collapsed);
  }

  /**
   * The peek is driven from here rather than by a `:hover` rule, because its
   * delays belong to the pointer alone. Collapsing has to happen the instant
   * it is asked for, and a CSS close-delay applied to that made the rail look
   * like it had hung.
   */
  let peekTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set by a deliberate collapse and cleared when the pointer leaves. */
  let peekBlocked = false;

  function peek(on: boolean, delay: number): void {
    if (peekTimer) clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      peekTimer = null;
      navEl.classList.toggle('nav-peek', on);
    }, delay);
  }

  function endPeek(): void {
    if (peekTimer) clearTimeout(peekTimer);
    peekTimer = null;
    navEl.classList.remove('nav-peek');
  }

  function toggleCollapsed(): void {
    const collapsing = !settings().navCollapsed;
    endPeek();
    // The pointer is still resting on the control that was just used, so
    // without this the rail would peek straight back open and the collapse
    // would look like it had failed.
    peekBlocked = collapsing && navEl.matches(':hover');
    setSetting('navCollapsed', collapsing);
  }

  /**
   * Collapsed, the button is invisible and covers the brand mark, so the label
   * is all a screen reader or a focused keyboard user has to go on.
   */
  function relabel(collapsed: boolean): void {
    const key: LangKey = collapsed ? 'nav_expand' : 'nav_collapse';
    collapseBtn.title = t(key);
    collapseBtn.setAttribute('aria-label', t(key));
  }

  navEl.addEventListener('pointerenter', () => {
    if (peekBlocked || !settings().navCollapsed) return;
    peek(true, PEEK_OPEN_MS);
  });
  navEl.addEventListener('pointerleave', () => {
    peekBlocked = false;
    peek(false, PEEK_CLOSE_MS);
  });

  collapseBtn.addEventListener('click', toggleCollapsed);
  // Collapsed, the rail as a whole opens it — there is no icon to hit. The
  // destinations keep their own job: clicking one navigates and leaves the
  // rail collapsed, so it closes again when the pointer moves off.
  navEl.addEventListener('click', (e) => {
    if (!settings().navCollapsed) return;
    if ((e.target as HTMLElement).closest('button')) return;
    toggleCollapsed();
  });
  // `[` matches the app's other shortcuts, which are all unmodified keys, and
  // steps on nothing the browser owns. Matched by physical key as well as by
  // character: on a Turkish Q layout that key types `ğ` and `[` needs AltGr,
  // so `code` is what makes the shortcut reachable there at all.
  document.addEventListener('keydown', (e) => {
    const isToggleKey = e.key === '[' || e.code === 'BracketLeft';
    if (!isToggleKey || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || target.isContentEditable) {
      return;
    }
    if (modalOpen()) return;
    // There is no rail to collapse under the mobile tab bar.
    if (!window.matchMedia('(min-width: 900px)').matches) return;
    e.preventDefault();
    toggleCollapsed();
  });
  settings.subscribe((s) => applyCollapsed(s.navCollapsed));
  currentLang.subscribe(() => relabel(settings().navCollapsed));
  applyCollapsed(settings().navCollapsed);

  onViewChange(setActive);
}
