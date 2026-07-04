/**
 * Minimal signal/effect reactivity — the app's only "framework".
 * A signal holds a value; effects re-run when signals they read change.
 */

type EffectFn = () => void;

let activeEffect: EffectFn | null = null;

export interface Signal<T> {
  (): T;
  set(next: T): void;
  update(fn: (cur: T) => T): void;
  /** Subscribe without the effect system; returns unsubscribe. */
  subscribe(fn: (value: T) => void): () => void;
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const effects = new Set<EffectFn>();
  const subs = new Set<(v: T) => void>();

  const read = (() => {
    if (activeEffect) effects.add(activeEffect);
    return value;
  }) as Signal<T>;

  read.set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    for (const fn of [...effects]) fn();
    for (const fn of [...subs]) fn(value);
  };
  read.update = (fn) => read.set(fn(value));
  read.subscribe = (fn) => {
    subs.add(fn);
    return () => subs.delete(fn);
  };
  return read;
}

/** Run fn now and again whenever any signal it reads changes. */
export function effect(fn: EffectFn): void {
  const run = () => {
    const prev = activeEffect;
    activeEffect = run;
    try {
      fn();
    } finally {
      activeEffect = prev;
    }
  };
  run();
}
