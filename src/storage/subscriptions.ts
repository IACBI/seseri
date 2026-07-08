import type { Subscription } from '../feeds/types';
import { local } from './local';
import { signal } from '../state/signals';

/** Subscriptions ("favorites") — legacy key `pp_favs`, same entry shape. */
export const subscriptions = signal<Subscription[]>([]);

export function loadSubscriptions(): void {
  const favs = local.get<Subscription[]>('pp_favs', []);
  subscriptions.set(Array.isArray(favs) ? favs : []);
}

function persist(list: Subscription[]): void {
  subscriptions.set(list);
  local.set('pp_favs', list);
}

export function isSubscribed(id: string): boolean {
  return subscriptions().some((f) => String(f.id) === String(id));
}

export function toggleSubscription(meta: Subscription): void {
  const list = subscriptions();
  persist(
    isSubscribed(meta.id) ? list.filter((f) => String(f.id) !== String(meta.id)) : [...list, meta],
  );
}

export function removeSubscription(id: string): void {
  persist(subscriptions().filter((f) => String(f.id) !== String(id)));
}
