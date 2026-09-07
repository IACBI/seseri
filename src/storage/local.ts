/** Safe localStorage wrapper — ported from legacy `store` (quota-aware). */

/**
 * Absent in the node test environment (and in some embedded webviews). Checked
 * per call rather than once at import: test files pick their own environment,
 * so the answer is not the same for every importer.
 */
function unavailable(): boolean {
  return typeof localStorage === 'undefined';
}

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
    if (unavailable()) return; // not a failure worth warning about
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
  /**
   * Stored keys starting with `prefix`. The only enumeration in the app: the
   * `pp_last_<feedId>` pointers are one key per feed and sync has to find them
   * all, which nothing needed before.
   */
  keys(prefix: string): string[] {
    if (unavailable()) return [];
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    } catch {
      return []; // private mode
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
