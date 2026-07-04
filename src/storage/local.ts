/** Safe localStorage wrapper — ported from legacy `store` (quota-aware). */

export const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, val: unknown, onQuota?: () => void): void {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      const err = e as { name?: string; code?: number };
      if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
        onQuota?.();
        try {
          localStorage.setItem(key, JSON.stringify(val));
          return;
        } catch {
          /* still full — give up quietly */
        }
      }
      console.warn('storage write failed:', key, err?.name);
    }
  },
  rawGet(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  rawSet(key: string, val: string): void {
    try {
      localStorage.setItem(key, val);
    } catch {
      /* quota/private mode */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  clear(): void {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  },
};
