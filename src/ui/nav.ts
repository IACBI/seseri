/**
 * Navigation controller — one DOM for both the mobile tab bar and the desktop
 * sidebar (CSS switches the layout). Highlights the active destination and
 * forwards taps to the app's navigation intents.
 */

import { must } from './shell';
import { onViewChange, type ViewName } from './views';

export type NavDestination = 'home' | 'search' | 'library' | 'settings';

export function initNav(deps: { go(dest: NavDestination): void }): void {
  const items: Record<NavDestination, HTMLButtonElement> = {
    home: must<HTMLButtonElement>('navHome'),
    search: must<HTMLButtonElement>('navSearch'),
    library: must<HTMLButtonElement>('navLibrary'),
    settings: must<HTMLButtonElement>('navSettings'),
  };

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

  onViewChange(setActive);
}
